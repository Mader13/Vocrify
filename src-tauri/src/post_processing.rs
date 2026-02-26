use std::collections::{BTreeMap, BTreeSet};

use crate::transcription_manager::{SpeakerTurn, TranscriptionSegment};

pub struct PostProcessing;

impl PostProcessing {
    const EPS: f64 = 1e-6;
    const MERGE_GAP_SEC: f64 = 0.20;

    fn overlap(start_a: f64, end_a: f64, start_b: f64, end_b: f64) -> f64 {
        let start = start_a.max(start_b);
        let end = end_a.min(end_b);
        (end - start).max(0.0)
    }

    fn distance_to_interval(point: f64, start: f64, end: f64) -> f64 {
        if point < start {
            start - point
        } else if point > end {
            point - end
        } else {
            0.0
        }
    }

    fn normalize_diarization_turns(speaker_segments: &[TranscriptionSegment]) -> Vec<SpeakerTurn> {
        let raw_turns: Vec<SpeakerTurn> = speaker_segments
            .iter()
            .filter_map(|segment| {
                let speaker = segment.speaker.clone()?;
                if segment.end <= segment.start + Self::EPS {
                    return None;
                }
                Some(SpeakerTurn {
                    start: segment.start.max(0.0),
                    end: segment.end.max(0.0),
                    speaker,
                })
            })
            .collect();
        if raw_turns.is_empty() {
            return Vec::new();
        }

        let mut boundaries: Vec<f64> = raw_turns
            .iter()
            .flat_map(|turn| [turn.start, turn.end])
            .filter(|time| time.is_finite())
            .collect();
        boundaries.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        boundaries.dedup_by(|a, b| (*a - *b).abs() <= Self::EPS);

        let mut micro_turns: Vec<SpeakerTurn> = Vec::new();
        for pair in boundaries.windows(2) {
            let start = pair[0];
            let end = pair[1];
            if end <= start + Self::EPS {
                continue;
            }

            let midpoint = (start + end) / 2.0;
            let mut overlap_by_speaker: BTreeMap<String, f64> = BTreeMap::new();
            let mut latest_start_by_speaker: BTreeMap<String, f64> = BTreeMap::new();

            for turn in &raw_turns {
                if midpoint < turn.start || midpoint >= turn.end {
                    continue;
                }

                let overlap = Self::overlap(start, end, turn.start, turn.end);
                if overlap <= Self::EPS {
                    continue;
                }

                *overlap_by_speaker
                    .entry(turn.speaker.clone())
                    .or_insert(0.0) += overlap;
                let latest = latest_start_by_speaker
                    .entry(turn.speaker.clone())
                    .or_insert(turn.start);
                *latest = latest.max(turn.start);
            }

            let chosen_speaker = overlap_by_speaker
                .into_iter()
                .max_by(|(speaker_a, overlap_a), (speaker_b, overlap_b)| {
                    overlap_a
                        .partial_cmp(overlap_b)
                        .unwrap_or(std::cmp::Ordering::Equal)
                        .then_with(|| {
                            let start_a = latest_start_by_speaker
                                .get(speaker_a)
                                .copied()
                                .unwrap_or(f64::NEG_INFINITY);
                            let start_b = latest_start_by_speaker
                                .get(speaker_b)
                                .copied()
                                .unwrap_or(f64::NEG_INFINITY);
                            start_a
                                .partial_cmp(&start_b)
                                .unwrap_or(std::cmp::Ordering::Equal)
                        })
                        .then_with(|| speaker_b.cmp(speaker_a))
                })
                .map(|(speaker, _)| speaker);

            if let Some(speaker) = chosen_speaker {
                micro_turns.push(SpeakerTurn {
                    start,
                    end,
                    speaker,
                });
            }
        }

        let mut normalized: Vec<SpeakerTurn> = Vec::with_capacity(micro_turns.len());
        for turn in micro_turns {
            let Some(last) = normalized.last_mut() else {
                normalized.push(turn);
                continue;
            };

            if turn.speaker == last.speaker && turn.start <= last.end + Self::MERGE_GAP_SEC {
                last.end = last.end.max(turn.end);
            } else {
                normalized.push(turn);
            }
        }

        normalized
    }

    fn nearest_turn_speaker(
        midpoint: f64,
        turns: &[SpeakerTurn],
        turn_index: usize,
    ) -> Option<String> {
        let mut best: Option<(f64, &str)> = None;
        for idx in [
            turn_index.checked_sub(1),
            Some(turn_index),
            Some(turn_index + 1),
        ] {
            let Some(idx) = idx else {
                continue;
            };
            let Some(turn) = turns.get(idx) else {
                continue;
            };
            let distance = Self::distance_to_interval(midpoint, turn.start, turn.end);
            match best {
                None => best = Some((distance, turn.speaker.as_str())),
                Some((best_distance, best_speaker))
                    if distance < best_distance - Self::EPS
                        || ((distance - best_distance).abs() <= Self::EPS
                            && turn.speaker.as_str() < best_speaker) =>
                {
                    best = Some((distance, turn.speaker.as_str()));
                }
                _ => {}
            }
        }

        best.map(|(_, speaker)| speaker.to_string())
    }

    fn align_segments_with_turns(
        transcription_segments: &[TranscriptionSegment],
        turns: &[SpeakerTurn],
    ) -> Vec<TranscriptionSegment> {
        if turns.is_empty() {
            return transcription_segments.to_vec();
        }

        let mut aligned = Vec::with_capacity(transcription_segments.len());
        let mut turn_index = 0usize;
        let mut previous_speaker: Option<String> = None;

        for segment in transcription_segments {
            while turn_index < turns.len() && turns[turn_index].end <= segment.start + Self::EPS {
                turn_index += 1;
            }

            let midpoint = (segment.start + segment.end) / 2.0;
            let mut overlap_by_speaker: BTreeMap<String, f64> = BTreeMap::new();
            let mut midpoint_distance_by_speaker: BTreeMap<String, f64> = BTreeMap::new();
            let mut midpoint_speakers: BTreeSet<String> = BTreeSet::new();

            let mut scan_index = turn_index;
            while scan_index < turns.len() && turns[scan_index].start < segment.end - Self::EPS {
                let turn = &turns[scan_index];
                let overlap = Self::overlap(segment.start, segment.end, turn.start, turn.end);
                if overlap > Self::EPS {
                    *overlap_by_speaker
                        .entry(turn.speaker.clone())
                        .or_insert(0.0) += overlap;
                }

                if midpoint >= turn.start && midpoint < turn.end {
                    midpoint_speakers.insert(turn.speaker.clone());
                }

                let distance = Self::distance_to_interval(midpoint, turn.start, turn.end);
                let min_distance = midpoint_distance_by_speaker
                    .entry(turn.speaker.clone())
                    .or_insert(f64::INFINITY);
                *min_distance = min_distance.min(distance);
                scan_index += 1;
            }

            let speaker = if !overlap_by_speaker.is_empty() {
                let max_overlap = overlap_by_speaker.values().copied().fold(0.0f64, f64::max);
                let mut candidates: Vec<String> = overlap_by_speaker
                    .into_iter()
                    .filter(|(_, overlap)| (*overlap - max_overlap).abs() <= Self::EPS)
                    .map(|(speaker, _)| speaker)
                    .collect();

                if candidates.len() > 1 {
                    let midpoint_candidates: Vec<String> = candidates
                        .iter()
                        .filter(|speaker| midpoint_speakers.contains(*speaker))
                        .cloned()
                        .collect();
                    if !midpoint_candidates.is_empty() {
                        candidates = midpoint_candidates;
                    }
                }

                if candidates.len() > 1 {
                    let min_distance = candidates
                        .iter()
                        .map(|speaker| {
                            midpoint_distance_by_speaker
                                .get(speaker)
                                .copied()
                                .unwrap_or(f64::INFINITY)
                        })
                        .fold(f64::INFINITY, f64::min);
                    candidates.retain(|speaker| {
                        let distance = midpoint_distance_by_speaker
                            .get(speaker)
                            .copied()
                            .unwrap_or(f64::INFINITY);
                        (distance - min_distance).abs() <= Self::EPS
                    });
                }

                if candidates.len() > 1 {
                    if let Some(previous) = previous_speaker.as_deref() {
                        if let Some(next) = candidates
                            .iter()
                            .find(|speaker| speaker.as_str() != previous)
                        {
                            Some(next.clone())
                        } else {
                            candidates.into_iter().next()
                        }
                    } else {
                        candidates.into_iter().next()
                    }
                } else {
                    candidates.into_iter().next()
                }
            } else {
                Self::nearest_turn_speaker(midpoint, turns, turn_index)
            };

            let mut with_speaker = segment.clone();
            with_speaker.speaker = speaker.clone();
            if let Some(speaker) = speaker {
                previous_speaker = Some(speaker);
            }
            aligned.push(with_speaker);
        }

        aligned
    }

    fn speaker_set_from_turns(turns: &[SpeakerTurn]) -> BTreeSet<String> {
        turns.iter().map(|turn| turn.speaker.clone()).collect()
    }

    fn speaker_duration_from_turns(turns: &[SpeakerTurn]) -> BTreeMap<String, f64> {
        let mut durations = BTreeMap::new();
        for turn in turns {
            let duration = (turn.end - turn.start).max(0.0);
            *durations.entry(turn.speaker.clone()).or_insert(0.0) += duration;
        }
        durations
    }

    fn speaker_set_from_segments(segments: &[TranscriptionSegment]) -> BTreeSet<String> {
        segments
            .iter()
            .filter_map(|segment| segment.speaker.clone())
            .collect()
    }

    fn ensure_speaker_coverage_from_turns(
        segments: &mut [TranscriptionSegment],
        turns: &[SpeakerTurn],
    ) {
        let diarization_speakers = Self::speaker_set_from_turns(turns);
        let assigned_speakers = Self::speaker_set_from_segments(segments);
        if diarization_speakers.len() <= assigned_speakers.len() {
            return;
        }

        for missing_speaker in diarization_speakers.difference(&assigned_speakers) {
            let mut best_choice: Option<(usize, f64)> = None;
            for (index, segment) in segments.iter().enumerate() {
                let overlap = turns
                    .iter()
                    .filter(|turn| turn.speaker == *missing_speaker)
                    .map(|turn| Self::overlap(segment.start, segment.end, turn.start, turn.end))
                    .sum::<f64>();
                if overlap <= Self::EPS {
                    continue;
                }

                match best_choice {
                    None => best_choice = Some((index, overlap)),
                    Some((best_index, best_overlap))
                        if overlap > best_overlap + Self::EPS
                            || ((overlap - best_overlap).abs() <= Self::EPS
                                && index < best_index) =>
                    {
                        best_choice = Some((index, overlap));
                    }
                    _ => {}
                }
            }

            if let Some((index, _)) = best_choice {
                segments[index].speaker = Some(missing_speaker.clone());
            }
        }
    }

    pub fn filter_hallucinations(segments: &[TranscriptionSegment]) -> Vec<TranscriptionSegment> {
        const MAX_SPARSE_DURATION: f64 = 20.0;
        const MIN_WORDS_PER_SEC: f64 = 0.08;
        const MAX_CREDIT_WORDS: usize = 8;
        const MAX_CREDIT_DURATION: f64 = 10.0;

        let hallucination_phrases: &[&str] = &[
            "thank you for watching",
            "thanks for watching",
            "please subscribe",
            "like and subscribe",
            "see you next time",
            "see you in the next video",
            "редактор субтитров",
            "субтитры сделал",
            "субтитры делал",
            "субтитры подготовил",
            "subtitles by",
            "subtitle editor",
            "captions by",
            "amara.org",
        ];

        segments
            .iter()
            .filter(|seg| {
                let text = seg.text.trim();

                if text.is_empty() || text.len() <= 1 {
                    return false;
                }

                let lower = text.to_lowercase();

                let punctuation_only = lower
                    .chars()
                    .all(|ch: char| ch.is_whitespace() || ch == '.' || ch == '*' || ch == '-');
                if punctuation_only {
                    return false;
                }

                let exact_or_prefix_hallucination = hallucination_phrases.iter().any(|phrase| {
                    lower == *phrase
                        || (lower.starts_with(phrase)
                            && lower
                                .as_bytes()
                                .get(phrase.len())
                                .map(|ch| *ch == b' ')
                                .unwrap_or(false))
                });
                if exact_or_prefix_hallucination {
                    eprintln!("[VAD] Dropping hallucination phrase: \"{}\" [{:.2}s-{:.2}s]",
                        text, seg.start, seg.end);
                    return false;
                }

                // Common Whisper silence hallucination pattern:
                // short subtitle/credits fragments such as "Редактор субтитров ...".
                let duration = seg.end - seg.start;
                let words: Vec<&str> = text.split_whitespace().collect();
                let looks_like_credit = words.len() <= MAX_CREDIT_WORDS
                    && duration <= MAX_CREDIT_DURATION
                    && (lower.contains("редактор субтитров")
                        || lower.contains("субтитры сделал")
                        || lower.contains("субтитры делал")
                        || lower.contains("субтитры подготовил")
                        || lower.contains("subtitles by")
                        || lower.contains("subtitle editor")
                        || lower.contains("captions by"));
                if looks_like_credit {
                    eprintln!(
                        "[VAD] Dropping subtitle-credit hallucination: \"{}\" [{:.2}s-{:.2}s]",
                        text, seg.start, seg.end
                    );
                    return false;
                }

                let alnum_count = lower.chars().filter(|ch: &char| ch.is_alphanumeric()).count();
                let symbol_count = lower
                    .chars()
                    .filter(|ch: &char| !ch.is_alphanumeric() && !ch.is_whitespace())
                    .count();
                if alnum_count > 0 && symbol_count > alnum_count * 2 {
                    eprintln!(
                        "[VAD] Dropping symbol-heavy segment: \"{}\" [{:.2}s-{:.2}s]",
                        text, seg.start, seg.end
                    );
                    return false;
                }

                if duration >= MAX_SPARSE_DURATION {
                    let word_count = text.split_whitespace().count() as f64;
                    let wps = word_count / duration;
                    if wps < MIN_WORDS_PER_SEC && word_count <= 3.0 {
                        eprintln!(
                            "[VAD] Dropping sparse segment ({:.1} wps, {:.1}s): \"{}\" [{:.2}s-{:.2}s]",
                            wps, duration, text, seg.start, seg.end
                        );
                        return false;
                    }
                }

                if words.len() >= 5 {
                    let first = words[0].to_lowercase();
                    let all_same = words.iter().all(|w: &&str| w.to_lowercase() == first);
                    if all_same {
                        eprintln!("[VAD] Dropping repetitive segment: \"{}\" [{:.2}s-{:.2}s]",
                            text, seg.start, seg.end);
                        return false;
                    }
                }

                let mut prev_char: Option<char> = None;
                let mut run_len = 0usize;
                let mut max_run_len = 0usize;
                for ch in lower.chars().filter(|ch: &char| !ch.is_whitespace()) {
                    if Some(ch) == prev_char {
                        run_len += 1;
                    } else {
                        run_len = 1;
                        prev_char = Some(ch);
                    }
                    max_run_len = max_run_len.max(run_len);
                }
                if max_run_len >= 10 {
                    eprintln!(
                        "[VAD] Dropping repeated-char segment: \"{}\" [{:.2}s-{:.2}s]",
                        text, seg.start, seg.end
                    );
                    return false;
                }

                true
            })
            .cloned()
            .collect()
    }

    /// Split transcription segments at speaker turn boundaries.
    ///
    /// If a transcription segment spans multiple speaker turns, it is divided
    /// into sub-segments so that each sub-segment falls within exactly one
    /// speaker turn.  The original text is distributed proportionally by
    /// duration across the sub-segments (word-level splitting).
    fn split_segments_by_turns(
        transcription_segments: &[TranscriptionSegment],
        turns: &[SpeakerTurn],
    ) -> Vec<TranscriptionSegment> {
        if turns.is_empty() {
            return transcription_segments.to_vec();
        }

        let mut result: Vec<TranscriptionSegment> = Vec::new();

        for segment in transcription_segments {
            // Collect all turns that overlap with this segment
            let overlapping_turns: Vec<&SpeakerTurn> = turns
                .iter()
                .filter(|turn| {
                    let ov = Self::overlap(segment.start, segment.end, turn.start, turn.end);
                    ov > Self::EPS
                })
                .collect();

            // If 0 or 1 turn overlaps — no splitting needed
            if overlapping_turns.len() <= 1 {
                result.push(segment.clone());
                continue;
            }

            // Build time slices from overlapping turns within the segment
            let mut slices: Vec<(f64, f64, &str)> = Vec::new();
            for turn in &overlapping_turns {
                let slice_start = segment.start.max(turn.start);
                let slice_end = segment.end.min(turn.end);
                if slice_end > slice_start + Self::EPS {
                    slices.push((slice_start, slice_end, turn.speaker.as_str()));
                }
            }

            if slices.is_empty() {
                result.push(segment.clone());
                continue;
            }

            // Sort slices by start time
            slices.sort_by(|a, b| {
                a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal)
            });

            // Merge adjacent slices from the same speaker
            let mut merged_slices: Vec<(f64, f64, &str)> = Vec::new();
            for (start, end, speaker) in &slices {
                if let Some(last) = merged_slices.last_mut() {
                    if last.2 == *speaker && *start <= last.1 + Self::MERGE_GAP_SEC {
                        last.1 = last.1.max(*end);
                        continue;
                    }
                }
                merged_slices.push((*start, *end, speaker));
            }

            // If after merging there's only one slice, no split needed
            if merged_slices.len() <= 1 {
                let mut seg = segment.clone();
                if let Some((_, _, speaker)) = merged_slices.first() {
                    seg.speaker = Some(speaker.to_string());
                }
                result.push(seg);
                continue;
            }

            // Proportionally distribute words across sub-segments
            let words: Vec<&str> = segment.text.split_whitespace().collect();
            let total_duration = merged_slices
                .iter()
                .map(|(s, e, _)| e - s)
                .sum::<f64>()
                .max(Self::EPS);

            let mut word_offset: usize = 0;
            for (i, (start, end, speaker)) in merged_slices.iter().enumerate() {
                let slice_duration = end - start;
                let proportion = slice_duration / total_duration;

                let word_count = if i == merged_slices.len() - 1 {
                    // Last slice gets remaining words
                    words.len().saturating_sub(word_offset)
                } else {
                    let float_count = proportion * words.len() as f64;
                    (float_count.round() as usize).min(words.len().saturating_sub(word_offset))
                };

                let slice_words = &words
                    [word_offset..(word_offset + word_count).min(words.len())];
                let text = slice_words.join(" ");
                word_offset += word_count;

                result.push(TranscriptionSegment {
                    start: *start,
                    end: *end,
                    text,
                    speaker: Some(speaker.to_string()),
                    confidence: segment.confidence,
                });
            }
        }

        result
    }

    /// Merge transcription segments with speaker diarization
    pub fn merge_diarization(
        transcription_segments: &[TranscriptionSegment],
        speaker_segments: &[TranscriptionSegment],
    ) -> (Vec<SpeakerTurn>, Vec<TranscriptionSegment>) {
        eprintln!(
            "[INFO] Merging {} transcription segments with {} speaker segments",
            transcription_segments.len(),
            speaker_segments.len()
        );

        let diarization_turns = Self::normalize_diarization_turns(speaker_segments);

        // First split transcription segments at speaker turn boundaries,
        // then align each sub-segment with the correct speaker.
        let split_segments =
            Self::split_segments_by_turns(transcription_segments, &diarization_turns);
        eprintln!(
            "[INFO] Split {} transcription segments into {} sub-segments at speaker boundaries",
            transcription_segments.len(),
            split_segments.len()
        );

        let mut result_segments =
            Self::align_segments_with_turns(&split_segments, &diarization_turns);
        Self::ensure_speaker_coverage_from_turns(&mut result_segments, &diarization_turns);

        let diarization_speakers = Self::speaker_set_from_turns(&diarization_turns);
        let diarization_durations = Self::speaker_duration_from_turns(&diarization_turns);
        let assigned_speakers = Self::speaker_set_from_segments(&result_segments);
        eprintln!(
            "[INFO] Normalized diarization turns: raw={} normalized={}",
            speaker_segments.len(),
            diarization_turns.len()
        );
        eprintln!(
            "[INFO] Diarization speakers detected: {} ({:?})",
            diarization_speakers.len(),
            diarization_speakers
        );
        eprintln!(
            "[INFO] Diarization speaker durations (s): {:?}",
            diarization_durations
        );
        eprintln!(
            "[INFO] Segment speaker assignment: {} ({:?})",
            assigned_speakers.len(),
            assigned_speakers
        );

        if !diarization_speakers.is_empty() && assigned_speakers.is_empty() {
            eprintln!(
                "[WARN] No speakers assigned to transcription segments despite diarization turns being present"
            );
        }

        eprintln!(
            "[INFO] Merged into {} final segments, {} turns",
            result_segments.len(),
            diarization_turns.len()
        );

        (diarization_turns, result_segments)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::PostProcessing;
    use crate::types::{SpeakerTurn, TranscriptionSegment};

    fn segment(start: f64, end: f64, speaker: Option<&str>) -> TranscriptionSegment {
        TranscriptionSegment {
            start,
            end,
            text: String::new(),
            speaker: speaker.map(str::to_string),
            confidence: 1.0,
        }
    }

    fn segment_with_text(start: f64, end: f64, text: &str, speaker: Option<&str>) -> TranscriptionSegment {
        TranscriptionSegment {
            start,
            end,
            text: text.to_string(),
            speaker: speaker.map(str::to_string),
            confidence: 1.0,
        }
    }

    #[test]
    fn merge_diarization_avoids_single_speaker_collapse_on_ties() {
        let transcription_segments = vec![segment(0.0, 4.0, None), segment(4.0, 8.0, None)];
        let speaker_segments = vec![
            segment(0.0, 2.0, Some("SPEAKER_00")),
            segment(4.0, 6.0, Some("SPEAKER_00")),
            segment(2.0, 4.0, Some("SPEAKER_01")),
            segment(6.0, 8.0, Some("SPEAKER_01")),
        ];

        let (_turns, merged_segments) =
            PostProcessing::merge_diarization(&transcription_segments, &speaker_segments);

        assert_eq!(merged_segments[0].speaker.as_deref(), Some("SPEAKER_00"));
        assert_eq!(merged_segments[1].speaker.as_deref(), Some("SPEAKER_01"));
    }

    #[test]
    fn merge_diarization_recovers_missing_diarization_speaker_in_segments() {
        let transcription_segments = vec![segment(0.0, 4.0, None), segment(4.0, 8.0, None)];
        let speaker_segments = vec![
            segment(0.0, 2.1, Some("SPEAKER_00")),
            segment(2.1, 4.0, Some("SPEAKER_01")),
            segment(4.0, 6.1, Some("SPEAKER_00")),
            segment(6.1, 8.0, Some("SPEAKER_01")),
        ];

        let (_turns, merged_segments) =
            PostProcessing::merge_diarization(&transcription_segments, &speaker_segments);

        let speakers: HashSet<&str> = merged_segments
            .iter()
            .filter_map(|segment| segment.speaker.as_deref())
            .collect();
        assert!(speakers.contains("SPEAKER_00"));
        assert!(speakers.contains("SPEAKER_01"));
    }

    #[test]
    fn normalize_diarization_turns_resolves_overlap_and_merges_gap() {
        let raw = vec![
            segment(0.0, 1.0, Some("SPEAKER_00")),
            segment(1.05, 2.0, Some("SPEAKER_00")),
            segment(1.8, 3.0, Some("SPEAKER_01")),
        ];

        let turns = PostProcessing::normalize_diarization_turns(&raw);
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[0].speaker, "SPEAKER_00");
        assert!((turns[0].start - 0.0).abs() < 0.001);
        assert!(turns[0].end > 1.7 && turns[0].end < 1.95);
        assert_eq!(turns[1].speaker, "SPEAKER_01");
        assert!((turns[1].start - turns[0].end).abs() < 0.001);
        assert!((turns[1].end - 3.0).abs() < 0.001);
    }

    #[test]
    fn align_segments_with_turns_assigns_nearest_when_no_overlap() {
        let segments = vec![segment(2.1, 2.4, None)];
        let turns = vec![
            SpeakerTurn {
                start: 0.0,
                end: 2.0,
                speaker: "SPEAKER_00".to_string(),
            },
            SpeakerTurn {
                start: 3.0,
                end: 4.0,
                speaker: "SPEAKER_01".to_string(),
            },
        ];

        let aligned = PostProcessing::align_segments_with_turns(&segments, &turns);
        assert_eq!(aligned.len(), 1);
        assert_eq!(aligned[0].speaker.as_deref(), Some("SPEAKER_00"));
    }

    #[test]
    fn normalize_diarization_turns_keeps_secondary_speaker_under_overlap() {
        let raw = vec![
            segment(0.0, 4.0, Some("SPEAKER_00")),
            segment(3.9, 7.8, Some("SPEAKER_00")),
            segment(3.95, 4.2, Some("SPEAKER_01")),
            segment(4.2, 4.5, Some("SPEAKER_01")),
        ];

        let turns = PostProcessing::normalize_diarization_turns(&raw);
        let speakers: HashSet<&str> = turns.iter().map(|turn| turn.speaker.as_str()).collect();

        assert!(speakers.contains("SPEAKER_00"));
        assert!(speakers.contains("SPEAKER_01"));
    }

    #[test]
    fn split_segments_by_turns_splits_long_segment_across_two_speakers() {
        // Simulates the user's problem: a 30-second transcription segment
        // that spans two speakers, where speaker B has most of the time.
        let transcription_segments = vec![
            segment_with_text(0.0, 30.0, "word1 word2 word3 word4 word5 word6 word7 word8 word9 word10", None),
        ];
        let turns = vec![
            SpeakerTurn {
                start: 0.0,
                end: 8.0,
                speaker: "SPEAKER_00".to_string(),
            },
            SpeakerTurn {
                start: 8.0,
                end: 30.0,
                speaker: "SPEAKER_01".to_string(),
            },
        ];

        let split = PostProcessing::split_segments_by_turns(&transcription_segments, &turns);

        assert_eq!(split.len(), 2, "Expected segment to be split into 2 parts");
        assert_eq!(split[0].speaker.as_deref(), Some("SPEAKER_00"));
        assert_eq!(split[1].speaker.as_deref(), Some("SPEAKER_01"));
        // SPEAKER_00 has 8/30 ~ 27% of time, should get ~3 words
        assert!(!split[0].text.is_empty(), "First sub-segment should have text");
        assert!(!split[1].text.is_empty(), "Second sub-segment should have text");
        // Combined text should contain all words
        let combined = format!("{} {}", split[0].text, split[1].text);
        assert_eq!(combined, "word1 word2 word3 word4 word5 word6 word7 word8 word9 word10");
    }

    #[test]
    fn split_segments_preserves_single_speaker_segment() {
        let transcription_segments = vec![
            segment_with_text(0.0, 5.0, "hello world", None),
        ];
        let turns = vec![
            SpeakerTurn {
                start: 0.0,
                end: 10.0,
                speaker: "SPEAKER_00".to_string(),
            },
        ];

        let split = PostProcessing::split_segments_by_turns(&transcription_segments, &turns);
        assert_eq!(split.len(), 1);
        assert_eq!(split[0].text, "hello world");
    }

    #[test]
    fn merge_diarization_distributes_speakers_on_skewed_input() {
        // Simulates the user's actual issue: majority of diarization time for SPEAKER_00,
        // tiny amount for SPEAKER_01, but transcription has segments spanning both.
        let transcription_segments = vec![
            segment_with_text(0.0, 15.0, "first speaker talks here a lot of words", None),
            segment_with_text(15.0, 30.0, "second speaker talks here even more words", None),
        ];
        // Diarization says: SPEAKER_00=0-10, SPEAKER_01=10-30
        let speaker_segments = vec![
            segment(0.0, 10.0, Some("SPEAKER_00")),
            segment(10.0, 30.0, Some("SPEAKER_01")),
        ];

        let (_turns, merged) = PostProcessing::merge_diarization(&transcription_segments, &speaker_segments);

        let speakers: HashSet<&str> = merged
            .iter()
            .filter_map(|seg| seg.speaker.as_deref())
            .collect();
        assert!(speakers.contains("SPEAKER_00"), "SPEAKER_00 must be present");
        assert!(speakers.contains("SPEAKER_01"), "SPEAKER_01 must be present");

        // First transcription segment [0-15] overlaps both speakers,
        // so it should be split — resulting in 3+ merged segments total
        assert!(merged.len() >= 3, "Long segments should be split at speaker boundaries, got {}", merged.len());
    }
}

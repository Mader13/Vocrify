use crate::transcription_manager::TranscriptionSegment as AppTranscriptionSegment;

pub struct TimelineNormalizer;

impl TimelineNormalizer {
    /// Normalizes transcriber output to resolve negative durations, overlaps, and out-of-bounds segments.
    pub fn normalize_segment_timeline(
        segments: &[AppTranscriptionSegment],
        total_duration: f64,
    ) -> Vec<AppTranscriptionSegment> {
        let mut normalized: Vec<AppTranscriptionSegment> = Vec::with_capacity(segments.len());
        let mut last_end = 0.0f64;

        for seg in segments {
            // Fix 1: Discard entirely out-of-bounds segments
            if seg.start >= total_duration || seg.end <= 0.0 {
                continue;
            }

            let mut start = seg.start.clamp(0.0, total_duration);
            let mut end = seg.end.clamp(0.0, total_duration);

            // Fix 2: Handle negative duration
            if end < start {
                std::mem::swap(&mut start, &mut end);
            }

            // Fix 3: Handle zero duration
            if (end - start).abs() < f64::EPSILON {
                // If text exists, give it a token 0.1s minimum duration
                if !seg.text.trim().is_empty() {
                    end = (start + 0.1).min(total_duration);
                    if (end - start).abs() < f64::EPSILON {
                        start = (end - 0.1).max(0.0);
                    }
                } else {
                    continue; // pure zero-duration silence is discarded
                }
            }

            // Fix 4: Prevent timeline overlaps that break subtitle rendering
            // If this segment starts *before* the last one ended
            if start < last_end {
                // Heuristic: If overlap is small (< 500ms), push the start time forward
                if last_end - start < 0.5 {
                    start = last_end;
                    // Check if pushing start forward squashed the segment completely
                    if start >= end {
                        continue; // Segment was too short, covered by previous
                    }
                } else {
                    // Huge overlap.
                    // This often means hallucination or the transcriber restarted its internal clock.
                    // We trust the *end* of the sequence more, so we push the *last* segment back.
                    if let Some(mut prev) = normalized.pop() {
                        prev.end = start;
                        if prev.end > prev.start && !prev.text.trim().is_empty() {
                            normalized.push(prev);
                        } else {
                            // The previous segment was completely subsumed or now zero-duration.
                            // We drop it.
                            eprintln!(
                                "[ASR] Dropped previous segment due to massive overlap: [{:.2}s -> {:.2}s]",
                                prev.start, prev.end
                            );
                        }
                    }
                }
            }

            last_end = end;
            normalized.push(AppTranscriptionSegment {
                start,
                end,
                text: seg.text.clone(),
                speaker: seg.speaker.clone(),
                confidence: seg.confidence,
            });
        }

        normalized
    }
}

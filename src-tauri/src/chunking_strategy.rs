use crate::EngineType;

const MAX_CHUNK_SAMPLES: usize = 16000 * 30; // 30 seconds
const MERGE_GAP_SAMPLES: usize = 16000 * 2; // 2 seconds
const VAD_CONTEXT_PADDING_SAMPLES: usize = 16000 * 400 / 1000; // 400ms

pub struct ChunkingStrategy;

impl ChunkingStrategy {
    #[cfg(feature = "rust-transcribe")]
    pub fn build_chunk_plan_from_vad(
        audio_data: &[f32],
        _engine_type: EngineType,
        adaptive_enabled: bool,
        engine_name: &str,
    ) -> Result<Vec<(usize, usize)>, crate::TranscriptionError> {
        let max_chunk_samples = MAX_CHUNK_SAMPLES;
        if !Self::asr_vad_chunking_enabled() {
            let chunks = Self::build_dense_chunks(audio_data.len());
            let coverage_ratio = Self::chunk_coverage_ratio(&chunks, audio_data.len());
            eprintln!(
                "[ASR] {} chunk plan: mode=dense, {} chunk(s), coverage={:.1}%, chunk_size={:.1}s",
                engine_name,
                chunks.len(),
                coverage_ratio * 100.0,
                max_chunk_samples as f64 / 16_000.0
            );
            return Ok(chunks);
        }

        let mut vad_manager = match crate::audio::vad::VadManager::new() {
            Ok(manager) => manager,
            Err(e) => {
                eprintln!(
                    "[WARN] {} VAD init failed ({}). Falling back to dense chunking.",
                    engine_name, e
                );
                let chunks = Self::build_dense_chunks(audio_data.len());
                let coverage_ratio = Self::chunk_coverage_ratio(&chunks, audio_data.len());
                eprintln!(
                    "[ASR] {} chunk plan: mode=dense-fallback, {} chunk(s), coverage={:.1}%, chunk_size={:.1}s",
                    engine_name,
                    chunks.len(),
                    coverage_ratio * 100.0,
                    max_chunk_samples as f64 / 16_000.0
                );
                return Ok(chunks);
            }
        };

        let vad_segments = match vad_manager.get_speech_segments(audio_data) {
            Ok(segments) => segments,
            Err(e) => {
                eprintln!(
                    "[WARN] {} VAD inference failed ({}). Falling back to dense chunking.",
                    engine_name, e
                );
                let chunks = Self::build_dense_chunks(audio_data.len());
                let coverage_ratio = Self::chunk_coverage_ratio(&chunks, audio_data.len());
                eprintln!(
                    "[ASR] {} chunk plan: mode=dense-fallback, {} chunk(s), coverage={:.1}%, chunk_size={:.1}s",
                    engine_name,
                    chunks.len(),
                    coverage_ratio * 100.0,
                    max_chunk_samples as f64 / 16_000.0
                );
                return Ok(chunks);
            }
        };

        eprintln!(
            "[INFO] {} VAD detected {} speech segments",
            engine_name,
            vad_segments.len()
        );

        let chunks = if adaptive_enabled {
            Self::build_vad_chunks(audio_data.len(), vad_segments.clone())
        } else if vad_segments.is_empty() {
            Self::build_dense_chunks(audio_data.len())
        } else {
            vad_segments
        };

        let coverage_ratio = Self::chunk_coverage_ratio(&chunks, audio_data.len());
        eprintln!(
            "[ASR] {} chunk plan: mode=vad, {} chunk(s), coverage={:.1}%, adaptive={}",
            engine_name,
            chunks.len(),
            coverage_ratio * 100.0,
            adaptive_enabled
        );

        Ok(chunks)
    }

    #[cfg(feature = "rust-transcribe")]
    fn build_vad_chunks(
        audio_len_samples: usize,
        vad_segments: Vec<(usize, usize)>,
    ) -> Vec<(usize, usize)> {
        const MIN_SPEECH_SAMPLES: usize = 1_600; // 100ms at 16kHz

        if audio_len_samples == 0 {
            return Vec::new();
        }

        let mut normalized: Vec<(usize, usize)> = vad_segments
            .into_iter()
            .filter_map(|(start, end)| {
                let clamped_start = start.min(audio_len_samples);
                let clamped_end = end.min(audio_len_samples);
                if clamped_end > clamped_start + MIN_SPEECH_SAMPLES {
                    Some((clamped_start, clamped_end))
                } else {
                    None
                }
            })
            .collect();

        if normalized.is_empty() {
            normalized.push((0, audio_len_samples));
        }

        normalized.sort_unstable_by_key(|(start, _)| *start);

        let mut merged: Vec<(usize, usize)> = Vec::with_capacity(normalized.len());
        for (start, end) in normalized {
            if let Some((last_start, last_end)) = merged.last_mut() {
                if start <= *last_end + MERGE_GAP_SAMPLES {
                    let proposed_end = (*last_end).max(end);
                    let proposed_len = proposed_end.saturating_sub(*last_start);
                    
                    // We only merge if the resulting chunk length leaves room for VAD padding 
                    // and doesn't exceed the rigorous 30s limit. This prevents arbitrary cuts 
                    // right through active speech.
                    let safe_max_len = MAX_CHUNK_SAMPLES.saturating_sub(VAD_CONTEXT_PADDING_SAMPLES * 2);
                    if proposed_len <= safe_max_len {
                        *last_end = proposed_end;
                        continue;
                    }
                }
            }
            merged.push((start, end));
        }

        let padded = merged
            .into_iter()
            .map(|(start, end)| {
                let padded_start = start.saturating_sub(VAD_CONTEXT_PADDING_SAMPLES);
                let padded_end = (end + VAD_CONTEXT_PADDING_SAMPLES).min(audio_len_samples);
                (padded_start, padded_end)
            })
            .collect::<Vec<(usize, usize)>>();

        let normalized = Self::normalize_non_overlapping_chunks(padded);

        let mut chunks = Vec::new();
        for (start, end) in normalized {
            Self::split_chunk_with_limit(start, end, MAX_CHUNK_SAMPLES, &mut chunks);
        }

        if chunks.is_empty() {
            vec![(0, audio_len_samples)]
        } else {
            chunks
        }
    }

    #[cfg(feature = "rust-transcribe")]
    pub fn build_dense_chunks(audio_len: usize) -> Vec<(usize, usize)> {
        let mut chunks = Vec::new();
        let mut start = 0;
        while start < audio_len {
            let end = (start + MAX_CHUNK_SAMPLES).min(audio_len);
            chunks.push((start, end));
            start = end;
        }
        chunks
    }

    #[cfg(feature = "rust-transcribe")]
    fn split_chunk_with_limit(
        start: usize,
        end: usize,
        limit: usize,
        chunks: &mut Vec<(usize, usize)>,
    ) {
        let duration = end.saturating_sub(start);
        if duration <= limit {
            chunks.push((start, end));
        } else {
            let mut curr = start;
            while curr < end {
                let next = (curr + limit).min(end);
                chunks.push((curr, next));
                curr = next;
            }
        }
    }

    #[cfg(feature = "rust-transcribe")]
    fn chunk_coverage_ratio(chunks: &[(usize, usize)], total_samples: usize) -> f64 {
        if total_samples == 0 {
            return 0.0;
        }
        let covered_samples: usize = chunks
            .iter()
            .map(|(start, end)| end.saturating_sub(*start))
            .sum();
        (covered_samples as f64 / total_samples as f64).min(1.0)
    }

    #[cfg(feature = "rust-transcribe")]
    fn normalize_non_overlapping_chunks(mut chunks: Vec<(usize, usize)>) -> Vec<(usize, usize)> {
        if chunks.is_empty() {
            return chunks;
        }

        chunks.sort_unstable_by_key(|(start, _)| *start);

        let mut normalized: Vec<(usize, usize)> = Vec::with_capacity(chunks.len());
        for (start, end) in chunks {
            if end <= start {
                continue;
            }

            if let Some((last_start, last_end)) = normalized.last_mut() {
                if start < *last_end {
                    // Overlap after padding!
                    // Instead of blindly merging (which defeats our max chunk lengths),
                    // we split the overlap evenly between the two contiguous chunks.
                    let overlap = *last_end - start;
                    let midpoint = start + overlap / 2;
                    
                    if midpoint <= *last_start {
                        // The entire last chunk is swallowd, drop it.
                        normalized.pop();
                        normalized.push((start, end));
                    } else {
                        *last_end = midpoint;
                        if end > midpoint {
                            normalized.push((midpoint, end));
                        }
                    }
                    continue;
                }
            }

            normalized.push((start, end));
        }

        normalized
    }

    fn asr_vad_chunking_enabled() -> bool {
        // VAD chunking is the default for speed.
        // It can be disabled explicitly via TRANSCRIBE_ASR_USE_VAD_CHUNKS=false/0/off.
        std::env::var("TRANSCRIBE_ASR_USE_VAD_CHUNKS")
            .map(|v| {
                let normalized = v.trim().to_ascii_lowercase();
                !matches!(normalized.as_str(), "0" | "false" | "off")
            })
            .unwrap_or(true)
    }
}

#[cfg(all(test, feature = "rust-transcribe"))]
mod tests {
    use super::ChunkingStrategy;

    #[test]
    fn vad_chunks_apply_padding_and_stay_bounded() {
        let audio_len = 16_000 * 60;
        let chunks = ChunkingStrategy::build_vad_chunks(
            audio_len,
            vec![(16_000 * 10, 16_000 * 12)],
        );

        assert_eq!(chunks.len(), 1);
        let (start, end) = chunks[0];
        assert_eq!(start, 16_000 * 10 - 6_400);
        assert_eq!(end, 16_000 * 12 + 6_400);
        assert!(start < end);
        assert!(end <= audio_len);
    }

    #[test]
    fn padded_vad_chunks_do_not_overlap_after_normalization() {
        let audio_len = 16_000 * 120;
        let chunks = ChunkingStrategy::build_vad_chunks(
            audio_len,
            vec![
                (16_000 * 10, 16_000 * 11),
                (16_000 * 12, 16_000 * 13),
                (16_000 * 14, 16_000 * 15),
            ],
        );

        for window in chunks.windows(2) {
            let (_, prev_end) = window[0];
            let (next_start, _) = window[1];
            assert!(prev_end <= next_start);
        }
    }
}

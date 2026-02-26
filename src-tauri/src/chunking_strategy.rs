use crate::EngineType;

const MAX_CHUNK_SAMPLES: usize = 16000 * 30; // 30 seconds
#[allow(dead_code)]
const MERGE_GAP_SAMPLES: usize = 16000 * 2; // 2 seconds

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
        const MERGE_GAP_SAMPLES: usize = 3_200; // 200ms at 16kHz

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
            if let Some((_, last_end)) = merged.last_mut() {
                if start <= *last_end + MERGE_GAP_SAMPLES {
                    *last_end = (*last_end).max(end);
                    continue;
                }
            }
            merged.push((start, end));
        }

        let mut chunks = Vec::new();
        for (start, end) in merged {
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

    fn asr_vad_chunking_enabled() -> bool {
        // Dense chunking is the default for stability and portability.
        // VAD chunking is opt-in via TRANSCRIBE_ASR_USE_VAD_CHUNKS=true.
        std::env::var("TRANSCRIBE_ASR_USE_VAD_CHUNKS")
            .map(|v| v.to_lowercase() == "true" || v == "1")
            .unwrap_or(false)
    }
}

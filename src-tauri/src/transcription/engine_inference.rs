#[cfg(feature = "rust-transcribe")]
use std::path::Path;
#[cfg(feature = "rust-transcribe")]
use std::sync::Arc;

#[cfg(feature = "rust-transcribe")]
use crate::chunking_strategy::ChunkingStrategy;
#[cfg(feature = "rust-transcribe")]
use crate::quality_gate::QualityGate;
#[cfg(feature = "rust-transcribe")]
use crate::transcription::{
    adaptive_asr_enabled, find_ggml_file, normalize_and_filter_segments, should_try_full_audio_first,
    to_internal_segments, EngineType, TranscriptionError, TranscriptionOptions,
};
#[cfg(feature = "rust-transcribe")]
use crate::types::TranscriptionResult;
#[cfg(feature = "rust-transcribe")]
use transcribe_rs::TranscriptionEngine;

#[cfg(feature = "rust-transcribe")]
pub async fn transcribe_with_whisper(
    audio_data: Arc<[f32]>,
    model_path: &Path,
    options: &TranscriptionOptions,
) -> Result<TranscriptionResult, TranscriptionError> {
    use transcribe_rs::engines::whisper::{WhisperEngine, WhisperInferenceParams};

    let ggml_file = find_ggml_file(model_path)?;
    eprintln!("[INFO] Loading Whisper model: {:?}", ggml_file);

    let language = options.language.clone();
    let ggml_file_clone = ggml_file.clone();
    let is_noisy = options.audio_profile.as_deref() == Some("noisy");
    let adaptive_enabled = adaptive_asr_enabled();

    let (all_segments, elapsed, total_audio_duration, used_retry) =
        tokio::task::spawn_blocking(move || {
            let mut engine = WhisperEngine::new();
            engine
                .load_model(&ggml_file_clone)
                .map_err(|e| TranscriptionError::ModelLoad(format!("{:?}", e)))?;

            let start_time = std::time::Instant::now();
            let total_dur = audio_data.len() as f64 / 16000.0;

            let primary_params = WhisperInferenceParams {
                language: language.clone(),
                no_speech_thold: if is_noisy { 0.50 } else { 0.60 },
                initial_prompt: None,
                ..Default::default()
            };
            let retry_params = WhisperInferenceParams {
                language: language.clone(),
                no_speech_thold: if is_noisy { 0.40 } else { 0.45 },
                initial_prompt: None,
                ..Default::default()
            };

            let full_audio_plan = vec![(0, audio_data.len())];
            let use_full_audio_first = should_try_full_audio_first(EngineType::Whisper, total_dur);
            let primary_plan = if use_full_audio_first {
                full_audio_plan.clone()
            } else {
                ChunkingStrategy::build_chunk_plan_from_vad(
                    &audio_data,
                    EngineType::Whisper,
                    adaptive_enabled,
                    "Whisper",
                )?
            };

            let mut transcribe_chunk_with_params = |start_idx: usize,
                                                    end_idx: usize,
                                                    params: &WhisperInferenceParams|
             -> Result<Vec<transcribe_rs::TranscriptionSegment>, TranscriptionError> {
                let chunk = audio_data[start_idx..end_idx].to_vec();
                let offset_s = start_idx as f32 / 16000.0;
                let res = engine
                    .transcribe_samples(chunk, Some(params.clone()))
                    .map_err(|e| TranscriptionError::Transcription(format!("{:?}", e)))?;
                let mut segments = res.segments.unwrap_or_default();
                for seg in &mut segments {
                    seg.start += offset_s;
                    seg.end += offset_s;
                }
                Ok(segments)
            };

            let mut chunk_segments: Vec<Vec<transcribe_rs::TranscriptionSegment>> = Vec::new();
            let mut deferred_retries: Vec<(usize, usize, usize)> = Vec::new();
            let mut retried_chunks = 0usize;

            for (idx, (start_idx, end_idx)) in primary_plan.iter().enumerate() {
                let chunk_start_s = *start_idx as f64 / 16000.0;
                let chunk_end_s = *end_idx as f64 / 16000.0;

                let primary_segments =
                    transcribe_chunk_with_params(*start_idx, *end_idx, &primary_params)?;
                let should_retry_chunk = adaptive_enabled
                    && QualityGate::should_retry_chunk(
                        &primary_segments,
                        chunk_start_s,
                        chunk_end_s,
                        is_noisy,
                        "Whisper",
                    );

                if should_retry_chunk {
                    deferred_retries.push((idx, *start_idx, *end_idx));
                }

                chunk_segments.push(primary_segments);
            }

            for (idx, start_idx, end_idx) in deferred_retries {
                let chunk_start_s = start_idx as f64 / 16000.0;
                let chunk_end_s = end_idx as f64 / 16000.0;
                let primary_segments = &chunk_segments[idx];
                let retry_segments = transcribe_chunk_with_params(start_idx, end_idx, &retry_params)?;

                if QualityGate::is_retry_result_better(
                    primary_segments,
                    &retry_segments,
                    chunk_start_s,
                    chunk_end_s,
                    is_noisy,
                ) {
                    chunk_segments[idx] = retry_segments;
                    retried_chunks += 1;
                }
            }

            let mut all_transcribed_segments = Vec::new();
            for segments in chunk_segments {
                all_transcribed_segments.extend(segments);
            }

            let mut used_retry = retried_chunks > 0;
            if retried_chunks > 0 {
                eprintln!(
                    "[ASR] Whisper chunk-level retry replaced {} chunk(s)",
                    retried_chunks
                );
            }

            if adaptive_enabled
                && !used_retry
                && total_dur <= 120.0
                && QualityGate::should_retry_with_chunk_fallback(
                    &all_transcribed_segments,
                    total_dur,
                    is_noisy,
                    "Whisper",
                )
            {
                let fallback_plan = if use_full_audio_first {
                    ChunkingStrategy::build_chunk_plan_from_vad(
                        &audio_data,
                        EngineType::Whisper,
                        adaptive_enabled,
                        "Whisper",
                    )?
                } else {
                    full_audio_plan
                };
                eprintln!(
                    "[ASR] Whisper global fallback enabled for short file: {} chunk(s)",
                    fallback_plan.len()
                );
                let mut fallback_segments = Vec::new();
                for (start_idx, end_idx) in fallback_plan {
                    let segs = transcribe_chunk_with_params(start_idx, end_idx, &retry_params)?;
                    fallback_segments.extend(segs);
                }
                if QualityGate::is_retry_result_better(
                    &all_transcribed_segments,
                    &fallback_segments,
                    0.0,
                    total_dur,
                    is_noisy,
                ) {
                    all_transcribed_segments = fallback_segments;
                    used_retry = true;
                } else {
                    eprintln!(
                        "[ASR] Whisper global fallback rejected by quality gate; keeping primary result"
                    );
                }
            }

            Ok::<_, TranscriptionError>((
                all_transcribed_segments,
                start_time.elapsed(),
                total_dur,
                used_retry,
            ))
        })
        .await
        .map_err(|e| TranscriptionError::Transcription(format!("Spawn blocking failed: {}", e)))??;

    let realtime_factor = total_audio_duration / elapsed.as_secs_f64();

    eprintln!(
        "[INFO] Transcription complete: {:.2}s audio in {:.2}s (RTF: {:.2}x, retry={})",
        total_audio_duration,
        elapsed.as_secs_f64(),
        realtime_factor,
        used_retry
    );

    let raw_segments = to_internal_segments(all_segments);
    let segments = normalize_and_filter_segments(raw_segments, total_audio_duration, "Whisper");

    let language = options
        .language
        .as_ref()
        .cloned()
        .unwrap_or_else(|| "auto".to_string());

    Ok(TranscriptionResult {
        segments,
        language,
        duration: total_audio_duration,
        speaker_turns: None,
        speaker_segments: None,
        metrics: None,
    })
}

#[cfg(feature = "rust-transcribe")]
pub async fn transcribe_with_parakeet(
    audio_data: Arc<[f32]>,
    model_path: &Path,
    options: &TranscriptionOptions,
) -> Result<TranscriptionResult, TranscriptionError> {
    use transcribe_rs::engines::parakeet::{
        ParakeetEngine, ParakeetInferenceParams, ParakeetModelParams, TimestampGranularity,
    };

    eprintln!("[INFO] Loading Parakeet model from: {:?}", model_path);

    if let Some(language) = options.language.as_ref() {
        let normalized = language.trim().to_ascii_lowercase();
        if !normalized.is_empty() && !normalized.starts_with("en") {
            return Err(TranscriptionError::UnsupportedFormat(format!(
                "Parakeet supports English only (requested language: {})",
                language
            )));
        }
    } else {
        return Err(TranscriptionError::UnsupportedFormat(
            "Parakeet requires explicit language='en' for stable quality/timestamps. Use Whisper for language auto-detection.".to_string(),
        ));
    }

    let files_to_migrate = [
        ("encoder-model.int8.onnx", "encoder-model.onnx"),
        ("decoder_joint-model.int8.onnx", "decoder_joint-model.onnx"),
        ("model.int8.onnx", "model.onnx"),
    ];

    for (src_name, dst_name) in &files_to_migrate {
        let src_path = model_path.join(src_name);
        let dst_path = model_path.join(dst_name);

        if src_path.exists() && !dst_path.exists() {
            eprintln!(
                "[INFO] Migrating Parakeet file {:?} to {:?}",
                src_name, dst_name
            );
            if let Err(e) = std::fs::rename(&src_path, &dst_path) {
                eprintln!(
                    "[WARN] Failed to rename {:?} to {:?}: {}",
                    src_path, dst_path, e
                );
            }
        }
    }

    let model_path_clone = model_path.to_path_buf();
    let is_noisy = options.audio_profile.as_deref() == Some("noisy");
    let adaptive_enabled = adaptive_asr_enabled();

    let (all_segments, elapsed, total_audio_duration, used_retry) =
        tokio::task::spawn_blocking(move || {
            let mut engine = ParakeetEngine::new();
            engine
                .load_model_with_params(&model_path_clone, ParakeetModelParams::int8())
                .map_err(|e| TranscriptionError::ModelLoad(format!("{:?}", e)))?;

            let start_time = std::time::Instant::now();
            let total_dur = audio_data.len() as f64 / 16000.0;

            let params = ParakeetInferenceParams {
                timestamp_granularity: TimestampGranularity::Segment,
            };

            let full_audio_plan = vec![(0, audio_data.len())];
            let use_full_audio_first = should_try_full_audio_first(EngineType::Parakeet, total_dur);
            let primary_plan = if use_full_audio_first {
                full_audio_plan.clone()
            } else {
                ChunkingStrategy::build_chunk_plan_from_vad(
                    &audio_data,
                    EngineType::Parakeet,
                    adaptive_enabled,
                    "Parakeet",
                )?
            };

            let mut transcribe_chunks =
                |plan: &[(usize, usize)]|
                 -> Result<Vec<transcribe_rs::TranscriptionSegment>, TranscriptionError> {
                    let mut all_transcribed_segments = Vec::new();

                    for (start_idx, end_idx) in plan {
                        let chunk = audio_data[*start_idx..*end_idx].to_vec();
                        let offset_s = *start_idx as f32 / 16000.0;
                        let res = engine
                            .transcribe_samples(chunk, Some(params.clone()))
                            .map_err(|e| TranscriptionError::Transcription(format!("{:?}", e)))?;
                        let segments = res.segments.unwrap_or_default();

                        for mut seg in segments {
                            seg.start += offset_s;
                            seg.end += offset_s;
                            all_transcribed_segments.push(seg);
                        }
                    }

                    Ok(all_transcribed_segments)
                };

            let mut all_transcribed_segments = transcribe_chunks(&primary_plan)?;
            let mut used_retry = false;

            if adaptive_enabled
                && total_dur <= 120.0
                && QualityGate::should_retry_with_chunk_fallback(
                    &all_transcribed_segments,
                    total_dur,
                    is_noisy,
                    "Parakeet",
                )
            {
                let retry_plan = if use_full_audio_first {
                    ChunkingStrategy::build_chunk_plan_from_vad(
                        &audio_data,
                        EngineType::Parakeet,
                        adaptive_enabled,
                        "Parakeet",
                    )?
                } else if total_dur <= 30.0 {
                    full_audio_plan
                } else {
                    primary_plan.clone()
                };
                eprintln!(
                    "[ASR] Parakeet retry pass: switching strategy (full_audio_first={}, fallback_to_full={})",
                    use_full_audio_first,
                    retry_plan.len() == 1 && retry_plan[0].1 == audio_data.len()
                );
                let retry_segments = transcribe_chunks(&retry_plan)?;
                if QualityGate::is_retry_result_better(
                    &all_transcribed_segments,
                    &retry_segments,
                    0.0,
                    total_dur,
                    is_noisy,
                ) {
                    all_transcribed_segments = retry_segments;
                    used_retry = true;
                } else {
                    eprintln!(
                        "[ASR] Parakeet retry result rejected by quality gate; keeping primary result"
                    );
                }
            }

            Ok::<_, TranscriptionError>((
                all_transcribed_segments,
                start_time.elapsed(),
                total_dur,
                used_retry,
            ))
        })
        .await
        .map_err(|e| TranscriptionError::Transcription(format!("Spawn blocking failed: {}", e)))??;

    let realtime_factor = total_audio_duration / elapsed.as_secs_f64();

    eprintln!(
        "[INFO] Transcription complete: {:.2}s audio in {:.2}s (RTF: {:.2}x, retry={})",
        total_audio_duration,
        elapsed.as_secs_f64(),
        realtime_factor,
        used_retry
    );

    let raw_segments = to_internal_segments(all_segments);
    let segments = normalize_and_filter_segments(raw_segments, total_audio_duration, "Parakeet");

    Ok(TranscriptionResult {
        segments,
        language: "en".to_string(),
        duration: total_audio_duration,
        speaker_turns: None,
        speaker_segments: None,
        metrics: None,
    })
}

#[cfg(feature = "rust-transcribe")]
pub async fn transcribe_with_moonshine(
    audio_data: Arc<[f32]>,
    model_path: &Path,
) -> Result<TranscriptionResult, TranscriptionError> {
    use transcribe_rs::engines::moonshine::{
        ModelVariant, MoonshineEngine, MoonshineModelParams,
    };

    eprintln!("[INFO] Loading Moonshine model from: {:?}", model_path);

    let variant = if model_path.to_string_lossy().contains("tiny") {
        ModelVariant::Tiny
    } else {
        ModelVariant::Base
    };

    let model_path_clone = model_path.to_path_buf();
    let (result, elapsed) = tokio::task::spawn_blocking(move || {
        let mut engine = MoonshineEngine::new();
        engine
            .load_model_with_params(&model_path_clone, MoonshineModelParams::variant(variant))
            .map_err(|e| TranscriptionError::ModelLoad(format!("{:?}", e)))?;

        let start_time = std::time::Instant::now();
        let res = engine
            .transcribe_samples(audio_data.to_vec(), None)
            .map_err(|e| TranscriptionError::Transcription(format!("{:?}", e)))?;

        Ok::<_, TranscriptionError>((res, start_time.elapsed()))
    })
    .await
    .map_err(|e| TranscriptionError::Transcription(format!("Spawn blocking failed: {}", e)))??;

    let segments_0_2_2 = result.segments.unwrap_or_default();
    let duration = segments_0_2_2.last().map(|s| s.end as f64).unwrap_or(0.0);
    let realtime_factor = duration / elapsed.as_secs_f64();

    eprintln!(
        "[INFO] Transcription complete: {:.2}s audio in {:.2}s (RTF: {:.2}x)",
        duration,
        elapsed.as_secs_f64(),
        realtime_factor
    );

    let segments = segments_0_2_2
        .into_iter()
        .map(|s| crate::types::TranscriptionSegment {
            start: s.start as f64,
            end: s.end as f64,
            text: s.text,
            speaker: None,
            confidence: 1.0,
        })
        .collect();

    Ok(TranscriptionResult {
        segments,
        language: "en".to_string(),
        duration,
        speaker_turns: None,
        speaker_segments: None,
        metrics: None,
    })
}

#[cfg(feature = "rust-transcribe")]
pub async fn transcribe_with_gigaam(
    audio_data: Arc<[f32]>,
    model_path: &Path,
    options: &TranscriptionOptions,
) -> Result<TranscriptionResult, TranscriptionError> {
    crate::transcription::gigaam_inference::transcribe_with_gigaam_impl(audio_data, model_path, options)
        .await
}

#[cfg(feature = "rust-transcribe")]
pub async fn transcribe_with_sensevoice() -> Result<TranscriptionResult, TranscriptionError> {
    Err(TranscriptionError::UnsupportedFormat(
        "SenseVoice is not supported in transcribe-rs 0.2.2".to_string(),
    ))
}

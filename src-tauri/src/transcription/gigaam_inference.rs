#[cfg(feature = "rust-transcribe")]
use std::path::Path;
#[cfg(feature = "rust-transcribe")]
use std::sync::Arc;

#[cfg(feature = "rust-transcribe")]
use crate::chunking_strategy::ChunkingStrategy;
#[cfg(feature = "rust-transcribe")]
use crate::transcription::{
    adaptive_asr_enabled, find_onnx_file, normalize_and_filter_segments, EngineType,
    TranscriptionError, TranscriptionOptions,
};
#[cfg(feature = "rust-transcribe")]
use crate::types::{TranscriptionResult, TranscriptionSegment};
#[cfg(feature = "rust-transcribe")]
use transcribe_rs::TranscriptionEngine;

#[cfg(feature = "rust-transcribe")]
pub async fn transcribe_with_gigaam_impl(
    audio_data: Arc<[f32]>,
    model_path: &Path,
    options: &TranscriptionOptions,
) -> Result<TranscriptionResult, TranscriptionError> {
    use transcribe_rs::engines::gigaam::GigaAMEngine;

    let onnx_file = find_onnx_file(model_path)?;
    eprintln!("[INFO] Loading GigaAM model: {:?}", onnx_file);
    let adaptive_enabled = adaptive_asr_enabled();

    let (raw_segments, elapsed, total_audio_duration, used_fallback) =
        tokio::task::spawn_blocking(move || {
            let mut engine = GigaAMEngine::new();
            engine
                .load_model(&onnx_file)
                .map_err(|e| TranscriptionError::ModelLoad(format!("{:?}", e)))?;

            let start_time = std::time::Instant::now();
            let total_dur = audio_data.len() as f64 / 16000.0;
            let chunk_plan = ChunkingStrategy::build_chunk_plan_from_vad(
                &audio_data,
                EngineType::GigaAM,
                adaptive_enabled,
                "GigaAM",
            )?;

            let mut chunk_segments = Vec::new();
            for (start_idx, end_idx) in chunk_plan {
                let chunk_result = engine
                    .transcribe_samples(audio_data[start_idx..end_idx].to_vec(), None)
                    .map_err(|e| TranscriptionError::Transcription(format!("{:?}", e)))?;
                let text = chunk_result.text.trim().to_string();
                if text.is_empty() {
                    continue;
                }
                chunk_segments.push(TranscriptionSegment {
                    start: start_idx as f64 / 16000.0,
                    end: end_idx as f64 / 16000.0,
                    text,
                    speaker: None,
                    confidence: 1.0,
                });
            }

            let mut used_fallback = false;
            if chunk_segments.is_empty() {
                let full_result = engine
                    .transcribe_samples(audio_data.to_vec(), None)
                    .map_err(|e| TranscriptionError::Transcription(format!("{:?}", e)))?;
                let full_text = full_result.text.trim().to_string();
                if !full_text.is_empty() {
                    chunk_segments.push(TranscriptionSegment {
                        start: 0.0,
                        end: total_dur,
                        text: full_text,
                        speaker: None,
                        confidence: 1.0,
                    });
                    used_fallback = true;
                }
            }

            Ok::<_, TranscriptionError>((chunk_segments, start_time.elapsed(), total_dur, used_fallback))
        })
        .await
        .map_err(|e| TranscriptionError::Transcription(format!("Spawn blocking failed: {}", e)))??;

    eprintln!(
        "[INFO] GigaAM transcription complete: {:.2}s audio in {:.2}s (RTF: {:.2}x, fallback={})",
        total_audio_duration,
        elapsed.as_secs_f64(),
        total_audio_duration / elapsed.as_secs_f64(),
        used_fallback
    );

    let segments = normalize_and_filter_segments(raw_segments, total_audio_duration, "GigaAM");
    let language = options
        .language
        .as_ref()
        .filter(|lang| !lang.trim().is_empty())
        .cloned()
        .unwrap_or_else(|| "ru".to_string());

    Ok(TranscriptionResult {
        segments,
        language,
        duration: total_audio_duration,
        speaker_turns: None,
        speaker_segments: None,
        metrics: None,
    })
}

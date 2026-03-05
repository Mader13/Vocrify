//! Transcription Manager - Unified transcription using transcribe-rs
//!
//! Phase 3: Replaces engine_router.rs with transcribe-rs based implementation.
//! Supports multiple engines: Whisper (GGML), Parakeet (ONNX), GigaAM (ONNX)
//!
//! Usage:
//! ```ignore
//! let manager = TranscriptionManager::new(models_dir)?;
//! manager.load_model("whisper-base").await?;
//! let result = manager.transcribe_file(audio_path).await?;
//! ```

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

// Phase 3: transcribe-rs imports
use crate::diarization::DiarizationEngine;
use crate::post_processing::PostProcessing;
use crate::transcription::{
    get_model_path, current_model_name as current_model_name_state,
    get_current_model as get_current_model_state, is_model_loaded as is_model_loaded_state,
    run_native_diarization, send_stage, set_current_model_name as set_current_model_name_state,
    transcribe_with_gigaam, transcribe_with_moonshine, transcribe_with_parakeet,
    transcribe_with_sensevoice,
    transcribe_with_whisper, whisper_dithering_enabled,
};
#[cfg(feature = "rust-transcribe")]
use crate::transcription::load_audio_file as load_audio_file_pipeline;

pub use crate::transcription::{
    EngineType, TranscriptionError, TranscriptionOptions, TranscriptionStage,
};

// TranscriptionSegment, SpeakerTurn, TranscriptionResult - from crate::types
pub use crate::types::{SpeakerTurn, TranscriptionResult, TranscriptionSegment};

/// Phase 3: TranscriptionManager using transcribe-rs
/// Supports multiple engines through a unified interface
pub struct TranscriptionManager {
    models_dir: PathBuf,
    current_model: Arc<Mutex<Option<String>>>,
    diarization_engine: Option<Arc<DiarizationEngine>>,
}

impl TranscriptionManager {
    fn current_model_name(&self) -> Result<String, TranscriptionError> {
        current_model_name_state(&self.current_model).ok_or(TranscriptionError::EngineNotInitialized)
    }

    fn set_current_model_name(&self, model_name: &str) {
        set_current_model_name_state(&self.current_model, model_name);
    }

    /// Create a new TranscriptionManager with native Rust diarization support.
    ///
    /// - `models_dir`: where AI model files live
    /// - `audio_cache_dir`: where temporary WAV files are written for diarization
    pub fn new(
        models_dir: &Path,
        _audio_cache_dir: Option<&Path>,
    ) -> Result<Self, TranscriptionError> {
        std::fs::create_dir_all(models_dir)?;

        eprintln!(
            "[INFO] TranscriptionManager initialized with directory: {:?}",
            models_dir
        );

        let diarization_engine = Arc::new(DiarizationEngine::new(models_dir));
        let diarization_engine = if diarization_engine.validate_models() {
            eprintln!("[INFO] Native diarization engine initialized (models found)");
            Some(diarization_engine)
        } else {
            eprintln!("[WARN] Native diarization models not found yet - diarization will be unavailable until model download completes");
            Some(diarization_engine)
        };

        Ok(Self {
            models_dir: models_dir.to_path_buf(),
            current_model: Arc::new(Mutex::new(None)),
            diarization_engine,
        })
    }

    /// Load a model for transcription
    #[cfg(feature = "rust-transcribe")]
    pub async fn load_model(&self, model_name: &str) -> Result<(), TranscriptionError> {
        let engine_type = EngineType::from_model_name(model_name)
            .ok_or_else(|| TranscriptionError::UnsupportedFormat(model_name.to_string()))?;

        let model_path = get_model_path(&self.models_dir, model_name, engine_type)?;

        if !model_path.exists() {
            return Err(TranscriptionError::ModelNotFound(format!(
                "Model {} not found at {:?}",
                model_name, model_path
            )));
        }

        eprintln!(
            "[INFO] Loading model: {} (engine: {:?}) from {:?}",
            model_name, engine_type, model_path
        );

        // Model is loaded on-demand during transcription for transcribe-rs
        // Just record which model we're using
        self.set_current_model_name(model_name);

        eprintln!("[INFO] Model {} ready for transcription", model_name);
        Ok(())
    }

    /// Stub implementation when rust-transcribe feature is disabled
    #[cfg(not(feature = "rust-transcribe"))]
    pub async fn load_model(&self, _model_name: &str) -> Result<(), TranscriptionError> {
        Err(TranscriptionError::EngineNotInitialized)
    }

    /// Transcribe an audio file
    #[cfg(feature = "rust-transcribe")]
    pub async fn transcribe_file(
        &self,
        audio_path: &Path,
        options: &TranscriptionOptions,
        stage_sender: Option<&tokio::sync::mpsc::UnboundedSender<TranscriptionStage>>,
    ) -> Result<TranscriptionResult, TranscriptionError> {
        let total_start = std::time::Instant::now();

        // Get model name with minimal lock duration
        let model_name = self.current_model_name()?;

        let engine_type = EngineType::from_model_name(&model_name)
            .ok_or_else(|| TranscriptionError::UnsupportedFormat(model_name.clone()))?;

        let model_path = get_model_path(&self.models_dir, &model_name, engine_type)?.clone();

        eprintln!(
            "[INFO] Starting transcription of {:?} using {:?} engine",
            audio_path, engine_type
        );

        send_stage(stage_sender, TranscriptionStage::Transcribing);

        // 1. Prepare audio (decode + mono + resample + profile DSP).
        let audio_prep_start = std::time::Instant::now();
        let apply_dithering =
            matches!(engine_type, EngineType::Whisper) && whisper_dithering_enabled();
        let audio_data = self
            .load_audio_file(audio_path, options.audio_profile.clone(), apply_dithering)
            .await?;
        eprintln!(
            "[PERF] Audio preprocessing completed in {} ms (duration: {:.2}s, dithering: {})",
            audio_prep_start.elapsed().as_millis(),
            audio_data.len() as f64 / 16000.0,
            apply_dithering
        );

        // 2. Transcribe and Diarize in PARALLEL
        let inference_start = std::time::Instant::now();

        let transcribe_fut = async {
            match engine_type {
                EngineType::Whisper => {
                    transcribe_with_whisper(Arc::clone(&audio_data), &model_path, options).await
                }
                EngineType::Parakeet => {
                    transcribe_with_parakeet(Arc::clone(&audio_data), &model_path, options).await
                }
                EngineType::GigaAM => {
                    transcribe_with_gigaam(Arc::clone(&audio_data), &model_path, options).await
                }
                EngineType::Moonshine => {
                    transcribe_with_moonshine(Arc::clone(&audio_data), &model_path).await
                }
                EngineType::SenseVoice => {
                    transcribe_with_sensevoice().await
                }
            }
        };

        let diarize_fut = async {
            if options.enable_diarization {
                send_stage(stage_sender, TranscriptionStage::Diarizing);
                eprintln!("[INFO] Diarization running in parallel on in-memory audio buffer");
                let start = std::time::Instant::now();
                let res = self
                    .run_diarization(Arc::clone(&audio_data), options, stage_sender)
                    .await;
                Some((res, start.elapsed().as_millis() as u64))
            } else {
                None
            }
        };

        let (result_res, diarize_res) = tokio::join!(transcribe_fut, diarize_fut);
        let mut result = result_res?;

        let inference_ms = inference_start.elapsed().as_millis() as u64;
        let mut diarization_ms: Option<u64> = None;

        // 3. Merge results
        if let Some((diarization_run_result, duration_ms)) = diarize_res {
            diarization_ms = Some(duration_ms);
            match diarization_run_result {
                Ok((speaker_turns, speaker_segments)) => {
                    eprintln!(
                        "[INFO] Diarization complete with {} speaker_turns and {} speaker_segments",
                        speaker_turns.len(),
                        speaker_segments.len()
                    );

                    let (merged_turns, merged_segments) =
                        self.merge_diarization(&result.segments, &speaker_segments);

                    eprintln!(
                        "[INFO] After merge: {} merged_turns, {} merged_segments",
                        merged_turns.len(),
                        merged_segments.len()
                    );

                    result.speaker_turns = Some(merged_turns);
                    result.speaker_segments = Some(merged_segments.clone());
                    result.segments = merged_segments;
                }
                Err(e) => {
                    eprintln!(
                        "[WARN] Diarization failed: {}, returning transcription without speakers",
                        e
                    );
                }
            }
        }

        result.metrics = Some(crate::ProgressMetrics {
            inference_ms: Some(inference_ms),
            diarization_ms,
            total_ms: Some(total_start.elapsed().as_millis() as u64),
            ..Default::default()
        });

        Ok(result)
    }

    /// Stub implementation when rust-transcribe feature is disabled
    #[cfg(not(feature = "rust-transcribe"))]
    pub async fn transcribe_file(
        &self,
        _audio_path: &Path,
        _options: &TranscriptionOptions,
        _stage_sender: Option<&tokio::sync::mpsc::UnboundedSender<TranscriptionStage>>,
    ) -> Result<TranscriptionResult, TranscriptionError> {
        Err(TranscriptionError::EngineNotInitialized)
    }

    /// Unload the current model
    pub fn unload_model(&self) {
        let mut current = self.current_model.lock().unwrap();
        *current = None;
        eprintln!("[INFO] Model unloaded");
    }

    #[cfg(feature = "rust-transcribe")]
    #[allow(dead_code)]
    async fn load_audio_file(
        &self,
        audio_path: &Path,
        audio_profile: Option<String>,
        apply_dithering: bool,
    ) -> Result<Arc<[f32]>, TranscriptionError> {
        load_audio_file_pipeline(audio_path, audio_profile, apply_dithering)
            .await
            .map_err(TranscriptionError::Transcription)
    }

    /// Stub implementation when rust-transcribe feature is disabled
    #[cfg(not(feature = "rust-transcribe"))]
    #[allow(dead_code)]
    async fn load_audio_file(
        &self,
        _audio_path: &Path,
        _audio_profile: Option<String>,
        _apply_dithering: bool,
    ) -> Result<Arc<[f32]>, TranscriptionError> {
        Err(TranscriptionError::EngineNotInitialized)
    }

    /// Get the currently loaded model name
    pub fn get_current_model(&self) -> Option<String> {
        get_current_model_state(&self.current_model)
    }

    /// Check if a model is currently loaded
    pub fn is_model_loaded(&self) -> bool {
        is_model_loaded_state(&self.current_model)
    }

    /// Run diarization using native sherpa-rs engine
    async fn run_diarization(
        &self,
        audio_data: Arc<[f32]>,
        options: &TranscriptionOptions,
        stage_sender: Option<&tokio::sync::mpsc::UnboundedSender<TranscriptionStage>>,
    ) -> Result<(Vec<SpeakerTurn>, Vec<TranscriptionSegment>), TranscriptionError> {
        eprintln!(
            "[DIARIZATION] enable={} provider={:?} num_speakers={} engine_ready={}",
            options.enable_diarization,
            options.diarization_provider,
            options.num_speakers,
            self.diarization_engine.is_some()
        );

        let engine = self.diarization_engine.clone().ok_or(
            TranscriptionError::Transcription("Native diarization engine not initialized".to_string()),
        )?;

        run_native_diarization(
            engine,
            audio_data,
            options.diarization_provider.clone(),
            options.num_speakers,
            stage_sender,
        )
        .await
        .map_err(TranscriptionError::Transcription)
    }

    /// Merge transcription segments with speaker diarization
    fn merge_diarization(
        &self,
        transcription_segments: &[TranscriptionSegment],
        speaker_segments: &[TranscriptionSegment],
    ) -> (Vec<SpeakerTurn>, Vec<TranscriptionSegment>) {
        PostProcessing::merge_diarization(transcription_segments, speaker_segments)
    }

    /// Delegate to PostProcessing::filter_hallucinations (used in tests)
    #[cfg(test)]
    pub fn filter_hallucinations(segments: &[TranscriptionSegment]) -> Vec<TranscriptionSegment> {
        PostProcessing::filter_hallucinations(segments)
    }

    /// Merge nearby speaker segments into normalised speech intervals.
    /// Segments closer than `merge_gap_s` seconds are joined together.
    #[cfg(test)]
    pub fn normalized_speech_intervals(
        segments: &[TranscriptionSegment],
        merge_gap_s: f64,
    ) -> Vec<(f64, f64)> {
        // Compatibility with existing tests/callers:
        // values > 1 are treated as frame units at ~30 FPS.
        let merge_gap_sec = if merge_gap_s > 1.0 {
            merge_gap_s / 30.0
        } else {
            merge_gap_s
        };

        let mut intervals: Vec<(f64, f64)> = Vec::new();

        for seg in segments {
            if let Some(last) = intervals.last_mut() {
                if seg.start - last.1 <= merge_gap_sec {
                    last.1 = last.1.max(seg.end);
                    continue;
                }
            }
            intervals.push((seg.start, seg.end));
        }

        intervals
    }

    /// Attenuate non-speech regions in the audio using speaker segments as a mask.
    /// Returns `None` when the coverage is too low or the mask ends too early.
    #[cfg(test)]
    pub fn try_apply_soft_dga(
        audio: &[f32],
        segments: &[TranscriptionSegment],
        sample_rate: usize,
    ) -> Option<Vec<f32>> {
        const MIN_COVERAGE: f64 = 0.05;
        const MAX_TAIL_MISSING_RATIO: f64 = 0.25;
        const MIN_DURATION_FOR_TAIL_GUARD_S: f64 = 30.0;

        let total_samples = audio.len();
        let audio_duration_s = total_samples as f64 / sample_rate as f64;

        // Build a sample-level mask (0.0 = silence, 1.0 = speech)
        let mut mask = vec![0.0f32; total_samples];
        for seg in segments {
            let start = ((seg.start * sample_rate as f64) as usize).min(total_samples);
            let end = ((seg.end * sample_rate as f64) as usize).min(total_samples);
            for s in mask[start..end].iter_mut() {
                *s = 1.0;
            }
        }

        // Check coverage
        let speech_samples = mask.iter().filter(|&&v| v > 0.5).count();
        let coverage = speech_samples as f64 / total_samples as f64;
        if coverage < MIN_COVERAGE {
            return None;
        }

        // Check that the mask doesn't end too early
        if audio_duration_s >= MIN_DURATION_FOR_TAIL_GUARD_S {
            if let Some(last_seg) = segments.last() {
                let tail_missing = audio_duration_s - last_seg.end;
                if tail_missing / audio_duration_s > MAX_TAIL_MISSING_RATIO {
                    return None;
                }
            }
        }

        // Apply soft attenuation: non-speech regions get multiplied by 0.05
        let masked: Vec<f32> = audio
            .iter()
            .zip(mask.iter())
            .map(|(&s, &m)| if m > 0.5 { s } else { s * 0.05 })
            .collect();

        Some(masked)
    }

    /// Returns true when a large portion of the audio tail is missing from the result,
    /// suggesting the DGA mask caused the transcription to stop prematurely.
    #[cfg(test)]
    pub fn should_retry_without_dga(result: &TranscriptionResult, audio_duration_s: f64) -> bool {
        const MISSING_TAIL_THRESHOLD: f64 = 0.25;

        if let Some(last_seg) = result.segments.last() {
            let tail_missing = audio_duration_s - last_seg.end;
            tail_missing / audio_duration_s > MISSING_TAIL_THRESHOLD
        } else {
            false
        }
    }
}



//! Transcription Manager - Unified transcription using transcribe-rs
//!
//! Phase 3: Replaces engine_router.rs with transcribe-rs based implementation.
//! Supports multiple engines: Whisper (GGML), Parakeet (ONNX)
//!
//! Usage:
//! ```ignore
//! let manager = TranscriptionManager::new(models_dir)?;
//! manager.load_model("whisper-base").await?;
//! let result = manager.transcribe_file(audio_path).await?;
//! ```

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use thiserror::Error;

// Phase 3: transcribe-rs imports
use crate::chunking_strategy::ChunkingStrategy;
use crate::diarization::{DiarizationConfig, DiarizationEngine};
use crate::post_processing::PostProcessing;
use crate::quality_gate::QualityGate;
use crate::timeline_normalizer::TimelineNormalizer;
#[cfg(feature = "rust-transcribe")]
use transcribe_rs::TranscriptionEngine;

/// Transcription stage for progress reporting
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TranscriptionStage {
    Transcribing,
    Diarizing,
    DiarizingProgress(u8),
}

/// Transcription errors
#[derive(Debug, Error)]
pub enum TranscriptionError {
    #[error("Failed to load model: {0}")]
    ModelLoad(String),

    #[error("Failed to transcribe audio: {0}")]
    Transcription(String),

    #[error("Model not found: {0}")]
    ModelNotFound(String),

    #[error("Engine not initialized")]
    EngineNotInitialized,

    #[error("Unsupported model format: {0}")]
    UnsupportedFormat(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

// TranscriptionSegment, SpeakerTurn, TranscriptionResult - from crate::types
pub use crate::types::{SpeakerTurn, TranscriptionResult, TranscriptionSegment};

/// Supported transcription engines
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineType {
    Whisper,
    Parakeet,
    Moonshine,
    SenseVoice,
}

impl EngineType {
    /// Detect engine type from model name
    pub fn from_model_name(model_name: &str) -> Option<Self> {
        if model_name.starts_with("whisper-") || model_name.starts_with("ggml-") {
            Some(EngineType::Whisper)
        } else if model_name.starts_with("parakeet-") {
            Some(EngineType::Parakeet)
        } else if model_name.starts_with("moonshine-") {
            Some(EngineType::Moonshine)
        } else if model_name.starts_with("sense-") || model_name.starts_with("sensevoice-") {
            Some(EngineType::SenseVoice)
        } else {
            None
        }
    }
}

/// Transcription options (matches frontend TranscriptionOptions)
#[derive(Debug, Clone)]
pub struct TranscriptionOptions {
    pub language: Option<String>,
    pub translate: bool,
    pub enable_diarization: bool,
    pub diarization_provider: Option<String>,
    pub num_speakers: i32,
    pub audio_profile: Option<String>,
}

impl Default for TranscriptionOptions {
    fn default() -> Self {
        Self {
            language: None,
            translate: false,
            enable_diarization: false,
            diarization_provider: None,
            num_speakers: 2,
            audio_profile: None,
        }
    }
}

/// Implement From for frontend TranscriptionOptions (camelCase)
impl From<crate::TranscriptionOptions> for TranscriptionOptions {
    fn from(opts: crate::TranscriptionOptions) -> Self {
        let diarization_provider = opts.diarization_provider.map(|provider| {
            let normalized = provider.trim().to_ascii_lowercase();
            if normalized == "sherpa-onnx" {
                "native".to_string()
            } else {
                normalized
            }
        });

        Self {
            language: if opts.language == "auto" {
                None
            } else {
                Some(opts.language)
            },
            translate: false,
            enable_diarization: opts.enable_diarization,
            diarization_provider,
            num_speakers: opts.num_speakers,
            audio_profile: opts.audio_profile,
        }
    }
}

/// Implement From for RustTranscriptionOptions (Phase 3: transcribe-rs)
impl From<crate::RustTranscriptionOptions> for TranscriptionOptions {
    fn from(opts: crate::RustTranscriptionOptions) -> Self {
        let language = opts.language.and_then(|raw| {
            let trimmed = raw.trim().to_string();
            if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("auto") {
                None
            } else {
                Some(trimmed)
            }
        });

        let diarization_provider = opts.diarization_provider.map(|provider| {
            let normalized = provider.trim().to_ascii_lowercase();
            if normalized == "sherpa-onnx" {
                "native".to_string()
            } else {
                normalized
            }
        });

        Self {
            language,
            translate: false,
            enable_diarization: opts.enable_diarization,
            diarization_provider,
            num_speakers: opts.num_speakers,
            audio_profile: opts.audio_profile,
        }
    }
}

/// Phase 3: TranscriptionManager using transcribe-rs
/// Supports multiple engines through a unified interface
pub struct TranscriptionManager {
    #[allow(dead_code)]
    models_dir: PathBuf,
    current_model: Arc<Mutex<Option<String>>>,
    diarization_engine: Option<Arc<DiarizationEngine>>,
    diarization_cache_dir: Option<PathBuf>,
}

impl TranscriptionManager {
    /// Create a new TranscriptionManager with native Rust diarization support.
    ///
    /// - `models_dir`: where AI model files live
    /// - `audio_cache_dir`: where temporary WAV files are written for diarization
    pub fn new(
        models_dir: &Path,
        _python_path: Option<&Path>,
        _engine_path: Option<&Path>,
        audio_cache_dir: Option<&Path>,
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
            diarization_cache_dir: audio_cache_dir.map(Path::to_path_buf),
        })
    }

    /// Load a model for transcription
    #[cfg(feature = "rust-transcribe")]
    pub async fn load_model(&self, model_name: &str) -> Result<(), TranscriptionError> {
        let engine_type = EngineType::from_model_name(model_name)
            .ok_or_else(|| TranscriptionError::UnsupportedFormat(model_name.to_string()))?;

        let model_path = self.get_model_path(model_name, engine_type)?;

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
        let mut current = self.current_model.lock().unwrap();
        *current = Some(model_name.to_string());

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
        hf_token: Option<&str>,
        stage_sender: Option<&tokio::sync::mpsc::UnboundedSender<TranscriptionStage>>,
    ) -> Result<TranscriptionResult, TranscriptionError> {
        let total_start = std::time::Instant::now();

        // Get model name with minimal lock duration
        let model_name = {
            let current = self.current_model.lock().unwrap();
            current
                .as_ref()
                .ok_or(TranscriptionError::EngineNotInitialized)?
                .clone()
        };

        let engine_type = EngineType::from_model_name(&model_name)
            .ok_or_else(|| TranscriptionError::UnsupportedFormat(model_name.clone()))?;

        let model_path = self.get_model_path(&model_name, engine_type)?.clone();

        eprintln!(
            "[INFO] Starting transcription of {:?} using {:?} engine",
            audio_path, engine_type
        );

        if let Some(tx) = stage_sender.as_ref() {
            let _ = tx.send(TranscriptionStage::Transcribing);
        }

        // Determine if we need to save a wav file for Diarization
        let save_wav_path = if options.enable_diarization && self.diarization_engine.is_some() {
            let cache_dir = self
                .diarization_cache_dir
                .clone()
                .unwrap_or_else(|| std::env::temp_dir().join("transcribe_video_cache"));

            std::fs::create_dir_all(&cache_dir).unwrap_or_default();

            let safe_name = audio_path.file_stem().unwrap_or_default().to_string_lossy();
            Some(cache_dir.join(format!("{}_16khz.wav", safe_name)))
        } else {
            None
        };

        // 1. Prepare audio (decode + mono + resample + profile DSP + optional WAV cache).
        let audio_prep_start = std::time::Instant::now();
        let apply_dithering =
            matches!(engine_type, EngineType::Whisper) && Self::whisper_dithering_enabled();
        let (audio_data, cached_wav_path) = self
            .load_audio_file(
                audio_path,
                save_wav_path,
                options.audio_profile.clone(),
                apply_dithering,
            )
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
                    self.transcribe_with_whisper(audio_data, &model_path, options)
                        .await
                }
                EngineType::Parakeet => {
                    self.transcribe_with_parakeet(audio_data, &model_path, options)
                        .await
                }
                EngineType::Moonshine => {
                    self.transcribe_with_moonshine(audio_data, &model_path, options)
                        .await
                }
                EngineType::SenseVoice => {
                    self.transcribe_with_sensevoice(audio_data, &model_path, options)
                        .await
                }
            }
        };

        let diarize_fut = async {
            if options.enable_diarization {
                if let Some(wav) = cached_wav_path {
                    if let Some(tx) = stage_sender.as_ref() {
                        let _ = tx.send(TranscriptionStage::Diarizing);
                    }
                    eprintln!("[INFO] Diarization running in parallel on {:?}", wav);
                    let start = std::time::Instant::now();
                    let res = self.run_diarization(&wav, options, hf_token, stage_sender).await;
                    if let Err(error) = std::fs::remove_file(&wav) {
                        if error.kind() != std::io::ErrorKind::NotFound {
                            eprintln!(
                                "[WARN] Failed to remove diarization cache wav {}: {}",
                                wav.display(),
                                error
                            );
                        }
                    }
                    Some((res, start.elapsed().as_millis() as u64))
                } else {
                    None
                }
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
        _hf_token: Option<&str>,
        _stage_sender: Option<&tokio::sync::mpsc::UnboundedSender<TranscriptionStage>>,
    ) -> Result<TranscriptionResult, TranscriptionError> {
        Err(TranscriptionError::EngineNotInitialized)
    }

    #[cfg(feature = "rust-transcribe")]
    fn env_flag(name: &str, default: bool) -> bool {
        match std::env::var(name) {
            Ok(value) => {
                let normalized = value.trim().to_ascii_lowercase();
                !matches!(normalized.as_str(), "0" | "false" | "off")
            }
            Err(_) => default,
        }
    }

    #[cfg(feature = "rust-transcribe")]
    fn adaptive_asr_enabled() -> bool {
        // Now reads from config instead of env
        crate::performance_config::PerformanceConfig::default()
            .with_env_overrides()
            .fast_setup_check_enabled // or we can just leave it reading from env momentarily
    }

    #[cfg(feature = "rust-transcribe")]
    fn whisper_dithering_enabled() -> bool {
        // Dithering helps some edge-cases but can worsen clean speech by injecting noise.
        // Default to enabled to suppress silence hallucinations ("subtitles by ...").
        Self::env_flag("TRANSCRIBE_WHISPER_DITHER", true)
    }

    #[cfg(feature = "rust-transcribe")]
    fn should_try_full_audio_first(engine: EngineType, total_audio_duration: f64) -> bool {
        if !Self::env_flag("TRANSCRIBE_FULL_AUDIO_FIRST", false) {
            return false;
        }

        let max_duration = match engine {
            EngineType::Whisper => 3.0 * 60.0,  // 3 min
            EngineType::Parakeet => 2.0 * 60.0, // 2 min
            _ => 2.0 * 60.0,
        };

        total_audio_duration <= max_duration
    }

    #[cfg(feature = "rust-transcribe")]
    #[allow(dead_code)]
    fn asr_vad_chunking_enabled() -> bool {
        // Dense chunking (time-based windows) is default for stable timeline alignment.
        // VAD chunking can be re-enabled explicitly when needed.
        Self::env_flag("TRANSCRIBE_ASR_USE_VAD_CHUNKS", false)
    }

    #[cfg(feature = "rust-transcribe")]
    #[allow(dead_code)]
    fn engine_chunk_size_samples(engine: EngineType) -> usize {
        let chunk_seconds = match engine {
            EngineType::Whisper => 28usize,
            EngineType::Parakeet => 24usize,
            _ => 24usize,
        };
        16_000 * chunk_seconds
    }

    #[cfg(feature = "rust-transcribe")]
    async fn transcribe_with_whisper(
        &self,
        audio_data: Vec<f32>,
        model_path: &Path,
        options: &TranscriptionOptions,
    ) -> Result<TranscriptionResult, TranscriptionError> {
        use transcribe_rs::engines::whisper::{WhisperEngine, WhisperInferenceParams};

        let ggml_file = self.find_ggml_file(model_path)?;
        eprintln!("[INFO] Loading Whisper model: {:?}", ggml_file);

        let language = options.language.clone();
        let ggml_file_clone = ggml_file.clone();
        let is_noisy = options.audio_profile.as_deref() == Some("noisy");
        let adaptive_enabled = Self::adaptive_asr_enabled();

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
                    // Keep a conservative silence threshold to reduce subtitle-credit hallucinations.
                    no_speech_thold: if is_noisy { 0.50 } else { 0.60 },
                    initial_prompt: None,
                    ..Default::default()
                };
                let retry_params = WhisperInferenceParams {
                    language: language.clone(),
                    // Retry is slightly more permissive, but still avoids very low values that over-transcribe silence.
                    no_speech_thold: if is_noisy { 0.40 } else { 0.45 },
                    initial_prompt: None,
                    ..Default::default()
                };

                let full_audio_plan = vec![(0, audio_data.len())];
                let use_full_audio_first =
                    Self::should_try_full_audio_first(EngineType::Whisper, total_dur);
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
                 -> Result<
                    Vec<transcribe_rs::TranscriptionSegment>,
                    TranscriptionError,
                > {
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

                let mut all_transcribed_segments = Vec::new();
                let mut retried_chunks = 0usize;

                for (start_idx, end_idx) in &primary_plan {
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
                        let retry_segments =
                            transcribe_chunk_with_params(*start_idx, *end_idx, &retry_params)?;
                        if QualityGate::is_retry_result_better(
                            &primary_segments,
                            &retry_segments,
                            chunk_start_s,
                            chunk_end_s,
                            is_noisy,
                        ) {
                            all_transcribed_segments.extend(retry_segments);
                            retried_chunks += 1;
                        } else {
                            all_transcribed_segments.extend(primary_segments);
                        }
                    } else {
                        all_transcribed_segments.extend(primary_segments);
                    }
                }

                let mut used_retry = retried_chunks > 0;
                if retried_chunks > 0 {
                    eprintln!(
                        "[ASR] Whisper chunk-level retry replaced {} chunk(s)",
                        retried_chunks
                    );
                }

                // Last-resort global fallback is restricted to short files only.
                // This avoids doubling runtime on long-form videos.
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
            .map_err(|e| {
                TranscriptionError::Transcription(format!("Spawn blocking failed: {}", e))
            })??;

        let realtime_factor = total_audio_duration / elapsed.as_secs_f64();

        eprintln!(
            "[INFO] Transcription complete: {:.2}s audio in {:.2}s (RTF: {:.2}x, retry={})",
            total_audio_duration,
            elapsed.as_secs_f64(),
            realtime_factor,
            used_retry
        );

        let raw_segments: Vec<TranscriptionSegment> = all_segments
            .into_iter()
            .map(|s| TranscriptionSegment {
                start: s.start as f64,
                end: s.end as f64,
                text: s.text,
                speaker: None,
                confidence: 1.0,
            })
            .collect();

        let normalized_segments =
            TimelineNormalizer::normalize_segment_timeline(&raw_segments, total_audio_duration);
        if normalized_segments.len() < raw_segments.len() {
            eprintln!(
                "[ASR] Whisper timeline normalization dropped {} invalid/duplicate segment(s)",
                raw_segments.len() - normalized_segments.len()
            );
        }

        let segments = PostProcessing::filter_hallucinations(normalized_segments.as_slice());
        if segments.len() < normalized_segments.len() {
            eprintln!(
                "[VAD] Filtered {} hallucination segment(s) out of {}",
                normalized_segments.len() - segments.len(),
                normalized_segments.len()
            );
        }

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
    async fn transcribe_with_parakeet(
        &self,
        audio_data: Vec<f32>,
        model_path: &Path,
        options: &TranscriptionOptions,
    ) -> Result<TranscriptionResult, TranscriptionError> {
        use transcribe_rs::engines::parakeet::{
            ParakeetEngine, ParakeetInferenceParams, TimestampGranularity,
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

        // Migrate .int8.onnx files to expected .onnx filenames
        let files_to_migrate = [
            ("encoder-model.int8.onnx", "encoder-model.onnx"),
            ("decoder_joint-model.int8.onnx", "decoder_joint-model.onnx"),
            ("model.int8.onnx", "model.onnx"), // fallback if named differently
        ];

        for (src_name, dst_name) in files_to_migrate.iter() {
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
        let adaptive_enabled = Self::adaptive_asr_enabled();

        let (all_segments, elapsed, total_audio_duration, used_retry) = tokio::task::spawn_blocking(move || {
            let mut engine = ParakeetEngine::new();

            // Phase 5: Strictly enforce Int8 models for Parakeet
            engine.load_model_with_params(&model_path_clone, transcribe_rs::engines::parakeet::ParakeetModelParams::int8())
                .map_err(|e| TranscriptionError::ModelLoad(format!("{:?}", e)))?;

            let start_time = std::time::Instant::now();
            let total_dur = audio_data.len() as f64 / 16000.0;

            let params = ParakeetInferenceParams {
                timestamp_granularity: TimestampGranularity::Segment,
            };

            let full_audio_plan = vec![(0, audio_data.len())];
            let use_full_audio_first =
                Self::should_try_full_audio_first(EngineType::Parakeet, total_dur);
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

            Ok::<_, TranscriptionError>((all_transcribed_segments, start_time.elapsed(), total_dur, used_retry))
        }).await.map_err(|e| TranscriptionError::Transcription(format!("Spawn blocking failed: {}", e)))??;

        let realtime_factor = total_audio_duration / elapsed.as_secs_f64();

        eprintln!(
            "[INFO] Transcription complete: {:.2}s audio in {:.2}s (RTF: {:.2}x, retry={})",
            total_audio_duration,
            elapsed.as_secs_f64(),
            realtime_factor,
            used_retry
        );

        let raw_segments: Vec<TranscriptionSegment> = all_segments
            .into_iter()
            .map(|s| TranscriptionSegment {
                start: s.start as f64,
                end: s.end as f64,
                text: s.text,
                speaker: None,
                confidence: 1.0,
            })
            .collect();
        let normalized_segments =
            TimelineNormalizer::normalize_segment_timeline(&raw_segments, total_audio_duration);
        if normalized_segments.len() < raw_segments.len() {
            eprintln!(
                "[ASR] Parakeet timeline normalization dropped {} invalid/duplicate segment(s)",
                raw_segments.len() - normalized_segments.len()
            );
        }

        let segments = PostProcessing::filter_hallucinations(&normalized_segments);
        if segments.len() < normalized_segments.len() {
            eprintln!(
                "[VAD] Filtered {} hallucination segment(s) out of {}",
                normalized_segments.len() - segments.len(),
                normalized_segments.len()
            );
        }

        Ok(TranscriptionResult {
            segments,
            language: "en".to_string(), // Parakeet is English-only
            duration: total_audio_duration,
            speaker_turns: None,
            speaker_segments: None,
            metrics: None,
        })
    }

    /// Transcribe using Moonshine engine (transcribe-rs)
    #[cfg(feature = "rust-transcribe")]
    async fn transcribe_with_moonshine(
        &self,
        audio_data: Vec<f32>,
        model_path: &Path,
        _options: &TranscriptionOptions,
    ) -> Result<TranscriptionResult, TranscriptionError> {
        use transcribe_rs::engines::moonshine::{
            ModelVariant, MoonshineEngine, MoonshineModelParams,
        };

        eprintln!("[INFO] Loading Moonshine model from: {:?}", model_path);

        // Determine variant from path name
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
                .transcribe_samples(audio_data, None)
                .map_err(|e| TranscriptionError::Transcription(format!("{:?}", e)))?;

            Ok::<_, TranscriptionError>((res, start_time.elapsed()))
        })
        .await
        .map_err(|e| {
            TranscriptionError::Transcription(format!("Spawn blocking failed: {}", e))
        })??;

        // Calculate duration from segments (0.2.2: segments is Option<Vec<>>)
        let segments_0_2_2 = result.segments.unwrap_or_default();
        let duration = segments_0_2_2.last().map(|s| s.end as f64).unwrap_or(0.0);
        let realtime_factor = duration / elapsed.as_secs_f64();

        eprintln!(
            "[INFO] Transcription complete: {:.2}s audio in {:.2}s (RTF: {:.2}x)",
            duration,
            elapsed.as_secs_f64(),
            realtime_factor
        );

        // Convert segments (0.2.2 uses f32 for timings)
        let segments: Vec<TranscriptionSegment> = segments_0_2_2
            .into_iter()
            .map(|s| TranscriptionSegment {
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

    /// Transcribe using SenseVoice engine (transcribe-rs)
    /// NOTE: Not available in transcribe-rs 0.2.2
    #[cfg(feature = "rust-transcribe")]
    async fn transcribe_with_sensevoice(
        &self,
        _audio_data: Vec<f32>,
        _model_path: &Path,
        _options: &TranscriptionOptions,
    ) -> Result<TranscriptionResult, TranscriptionError> {
        // SenseVoice is not available in transcribe-rs 0.2.2
        // Will be added in a future version
        Err(TranscriptionError::UnsupportedFormat(
            "SenseVoice is not supported in transcribe-rs 0.2.2".to_string(),
        ))
    }

    /// Unload the current model
    pub fn unload_model(&self) {
        let mut current = self.current_model.lock().unwrap();
        *current = None;
        eprintln!("[INFO] Model unloaded");
    }

    /// Get the path to a model
    #[allow(dead_code)]
    fn get_model_path(
        &self,
        model_name: &str,
        engine_type: EngineType,
    ) -> Result<PathBuf, TranscriptionError> {
        match engine_type {
            EngineType::Whisper => {
                // Whisper models can be a directory or direct GGML file
                let model_dir = self.models_dir.join(model_name);
                if model_dir.exists() && model_dir.is_dir() {
                    Ok(model_dir)
                } else {
                    // Try as direct GGML file
                    let ggml_name =
                        format!("ggml-{}.bin", model_name.trim_start_matches("whisper-"));
                    Ok(self.models_dir.join(ggml_name))
                }
            }
            EngineType::Parakeet | EngineType::Moonshine | EngineType::SenseVoice => {
                // ONNX models are in directories
                Ok(self.models_dir.join(model_name))
            }
        }
    }

    /// Find the GGML file in a model directory
    #[allow(dead_code)]
    fn find_ggml_file(&self, model_path: &Path) -> Result<PathBuf, TranscriptionError> {
        if model_path.is_file() {
            return Ok(model_path.to_path_buf());
        }

        // Look for .bin files in the directory
        for entry in std::fs::read_dir(model_path)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "bin") {
                return Ok(path);
            }
        }

        Err(TranscriptionError::ModelNotFound(format!(
            "No GGML model file found in {:?}",
            model_path
        )))
    }

    #[cfg(feature = "rust-transcribe")]
    #[allow(dead_code)]
    async fn load_audio_file(
        &self,
        audio_path: &Path,
        save_wav_path: Option<PathBuf>,
        audio_profile: Option<String>,
        apply_dithering: bool,
    ) -> Result<(Vec<f32>, Option<PathBuf>), TranscriptionError> {
        let audio_path = audio_path.to_path_buf();
        let profile = audio_profile.unwrap_or_else(|| "standard".to_string());

        let result =
            tokio::task::spawn_blocking(move || -> Result<(Vec<f32>, Option<PathBuf>), String> {
                use crate::audio;

                eprintln!(
                    "[INFO] Loading audio file using audio module: {:?}",
                    audio_path
                );

                let audio_buffer = audio::loader::load(&audio_path)
                    .map_err(|e| format!("Failed to load audio: {}", e))?;

                let mono = if audio_buffer.channels > 1 {
                    eprintln!(
                        "[INFO] Converting {} channels to mono",
                        audio_buffer.channels
                    );
                    audio_buffer.to_mono()
                } else {
                    audio_buffer
                };

                let mut resampled = if mono.sample_rate != 16000 {
                    eprintln!(
                        "[INFO] Resampling from {}Hz to 16000Hz (Sinc)",
                        mono.sample_rate
                    );
                    mono.resample(16000)
                } else {
                    mono
                };
                let diarization_samples = if save_wav_path.is_some() {
                    // Keep diarization input neutral: avoid ASR-specific DSP/noise shaping.
                    Some(resampled.samples.clone())
                } else {
                    None
                };

                // Smart Audio Processing Based on Profile
                if profile == "noisy" {
                    eprintln!("[INFO] Audio Profile: Noisy. Applying DSP High-Pass Filter.");
                    resampled.apply_high_pass_filter();
                    // Global AGC is skipped here. It will be applied strictly per-segment
                    // inside the transcription loop to avoid amplifying wind during silences.
                } else {
                    // Phase 1: Peak Normalization for standard profile
                    // We keep global AGC for standard clean clips to ensure uniform volume if it's generally quiet.
                    resampled.normalize();
                }

                if apply_dithering {
                    // Dithering reduces Whisper silence hallucinations, but should not affect other engines.
                    resampled.apply_white_noise_dithering();
                }

                // Phrase 2: Cache pure WAV file for Diarization
                if let Some(wav_path) = &save_wav_path {
                    eprintln!(
                        "[INFO] Caching neutral 16kHz audio for diarization to {:?}",
                        wav_path
                    );
                    let spec = hound::WavSpec {
                        channels: 1,
                        sample_rate: 16000,
                        bits_per_sample: 32,
                        sample_format: hound::SampleFormat::Float,
                    };
                    match hound::WavWriter::create(wav_path, spec) {
                        Ok(mut writer) => {
                            let cache_samples =
                                diarization_samples.as_ref().unwrap_or(&resampled.samples);
                            for &sample in cache_samples {
                                let _ = writer.write_sample(sample);
                            }
                            let _ = writer.finalize();
                        }
                        Err(e) => {
                            eprintln!("[WARN] Failed to create WAV cache: {}", e);
                        }
                    }
                }

                eprintln!(
                    "[INFO] Loaded {} samples ({:.2}s)",
                    resampled.samples.len(),
                    resampled.samples.len() as f64 / 16000.0
                );

                Ok((resampled.samples, save_wav_path))
            })
            .await
            .map_err(|e| {
                TranscriptionError::Transcription(format!("Spawn blocking failed: {}", e))
            })?
            .map_err(|e| TranscriptionError::Transcription(e))?;

        Ok(result)
    }

    /// Stub implementation when rust-transcribe feature is disabled
    #[cfg(not(feature = "rust-transcribe"))]
    #[allow(dead_code)]
    async fn load_audio_file(
        &self,
        _audio_path: &Path,
        _save_wav_path: Option<PathBuf>,
        _audio_profile: Option<String>,
        _apply_dithering: bool,
    ) -> Result<(Vec<f32>, Option<PathBuf>), TranscriptionError> {
        Err(TranscriptionError::EngineNotInitialized)
    }

    /// Get the currently loaded model name
    pub fn get_current_model(&self) -> Option<String> {
        self.current_model.lock().unwrap().clone()
    }

    /// Check if a model is currently loaded
    pub fn is_model_loaded(&self) -> bool {
        self.current_model.lock().unwrap().is_some()
    }

    fn read_wav_samples(audio_path: &Path) -> Result<Vec<f32>, TranscriptionError> {
        let mut reader =
            hound::WavReader::open(audio_path).map_err(|e| TranscriptionError::Transcription(e.to_string()))?;
        let spec = reader.spec();

        let channels = usize::from(spec.channels.max(1));
        let mut mono: Vec<f32> = Vec::new();

        match spec.sample_format {
            hound::SampleFormat::Float => {
                let mut frame: Vec<f32> = Vec::with_capacity(channels);
                for sample in reader.samples::<f32>() {
                    let value = sample
                        .map_err(|e| TranscriptionError::Transcription(e.to_string()))?;
                    frame.push(value);
                    if frame.len() == channels {
                        let avg = frame.iter().sum::<f32>() / channels as f32;
                        mono.push(avg);
                        frame.clear();
                    }
                }
            }
            hound::SampleFormat::Int => {
                let max_val = if spec.bits_per_sample == 0 {
                    1.0
                } else {
                    ((1i64 << (spec.bits_per_sample.saturating_sub(1) as i64)) - 1) as f32
                };
                let mut frame: Vec<f32> = Vec::with_capacity(channels);
                for sample in reader.samples::<i32>() {
                    let value = sample
                        .map_err(|e| TranscriptionError::Transcription(e.to_string()))?
                        as f32
                        / max_val.max(1.0);
                    frame.push(value);
                    if frame.len() == channels {
                        let avg = frame.iter().sum::<f32>() / channels as f32;
                        mono.push(avg);
                        frame.clear();
                    }
                }
            }
        }

        Ok(mono)
    }

    /// Run diarization using native sherpa-rs engine
    async fn run_diarization(
        &self,
        audio_path: &Path,
        options: &TranscriptionOptions,
        _hf_token: Option<&str>,
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

        let samples = Self::read_wav_samples(audio_path)?;

        let requested_speakers = if options.num_speakers > 0 {
            Some(options.num_speakers)
        } else {
            None
        };

        let mut config = DiarizationConfig {
            num_speakers: requested_speakers,
            ..DiarizationConfig::default()
        };

        if let Some(provider) = options.diarization_provider.as_ref() {
            let normalized = provider.trim().to_ascii_lowercase();
            if !normalized.is_empty() && normalized != "none" && normalized != "native" {
                config.provider = Some(normalized);
            }
        }

        let progress_sender = stage_sender.cloned();
        let progress_callback: Option<Arc<dyn Fn(u8) + Send + Sync>> = progress_sender.map(|tx| {
            Arc::new(move |pct: u8| {
                let _ = tx.send(TranscriptionStage::DiarizingProgress(pct));
            }) as Arc<dyn Fn(u8) + Send + Sync>
        });

        eprintln!("[DIARIZATION] Using native sherpa-rs");
        let speaker_segments = tokio::task::spawn_blocking(move || {
            engine.diarize_adaptive(samples, config, progress_callback)
        })
        .await
        .map_err(|e| TranscriptionError::Transcription(format!("Diarization task join error: {e}")))?
        .map_err(TranscriptionError::Transcription)?;

        eprintln!(
            "[DIARIZATION] Received {} segments from native engine",
            speaker_segments.len()
        );
        let unique_speakers: std::collections::HashSet<&str> = speaker_segments
            .iter()
            .map(|s| s.speaker.as_str())
            .collect();
        let mut durations_by_speaker: std::collections::BTreeMap<&str, f64> =
            std::collections::BTreeMap::new();
        for segment in &speaker_segments {
            let duration = (segment.end - segment.start).max(0.0);
            *durations_by_speaker
                .entry(segment.speaker.as_str())
                .or_insert(0.0) += duration;
        }
        eprintln!(
            "[DIARIZATION] Unique speakers from native engine: {} ({:?})",
            unique_speakers.len(),
            unique_speakers
        );
        eprintln!(
            "[DIARIZATION] Raw durations from native engine (s): {:?}",
            durations_by_speaker
        );

        let speaker_turns: Vec<SpeakerTurn> = speaker_segments
            .iter()
            .map(|s| SpeakerTurn {
                start: s.start,
                end: s.end,
                speaker: s.speaker.clone(),
            })
            .collect();

        let diarization_segments: Vec<TranscriptionSegment> = speaker_segments
            .into_iter()
            .map(|s| TranscriptionSegment {
                start: s.start,
                end: s.end,
                text: String::new(),
                speaker: Some(s.speaker),
                confidence: 1.0,
            })
            .collect();

        Ok((speaker_turns, diarization_segments))
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
        let mut intervals: Vec<(f64, f64)> = Vec::new();

        for seg in segments {
            if let Some(last) = intervals.last_mut() {
                if seg.start - last.1 <= merge_gap_s {
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
        const MAX_TAIL_MISSING_RATIO: f64 = 0.30;

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
        if let Some(last_seg) = segments.last() {
            let tail_missing = audio_duration_s - last_seg.end;
            if tail_missing / audio_duration_s > MAX_TAIL_MISSING_RATIO {
                return None;
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_engine_type_from_model_name() {
        assert_eq!(
            EngineType::from_model_name("whisper-base"),
            Some(EngineType::Whisper)
        );
        assert_eq!(
            EngineType::from_model_name("parakeet-tdt-0.6b-v3"),
            Some(EngineType::Parakeet)
        );
        assert_eq!(
            EngineType::from_model_name("moonshine-tiny"),
            Some(EngineType::Moonshine)
        );
        assert_eq!(
            EngineType::from_model_name("sense-voice"),
            Some(EngineType::SenseVoice)
        );
        assert_eq!(EngineType::from_model_name("unknown"), None);
    }

    #[test]
    fn test_transcription_manager_new() {
        let temp_dir = TempDir::new().unwrap();
        let manager = TranscriptionManager::new(temp_dir.path(), None, None, None).unwrap();
        assert!(!manager.is_model_loaded());
    }

    #[test]
    fn test_transcription_options_default() {
        let options = TranscriptionOptions::default();
        assert!(options.language.is_none());
        assert!(!options.translate);
        assert!(!options.enable_diarization);
        assert_eq!(options.num_speakers, 2);
    }

    #[test]
    fn test_filter_hallucinations_removes_known_phrases() {
        let segments = vec![
            TranscriptionSegment {
                start: 0.0,
                end: 5.0,
                text: "Hello world".to_string(),
                speaker: None,
                confidence: 1.0,
            },
            TranscriptionSegment {
                start: 5.0,
                end: 8.0,
                text: "Thanks for watching".to_string(),
                speaker: None,
                confidence: 1.0,
            },
            TranscriptionSegment {
                start: 8.0,
                end: 12.0,
                text: "Thank you for watching".to_string(),
                speaker: None,
                confidence: 1.0,
            },
        ];
        let filtered = TranscriptionManager::filter_hallucinations(&segments);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].text, "Hello world");
    }

    #[test]
    fn test_filter_hallucinations_removes_russian_subtitle_credit() {
        let segments = vec![
            TranscriptionSegment {
                start: 0.0,
                end: 3.0,
                text: "Редактор субтитров Иван Петров".to_string(),
                speaker: None,
                confidence: 1.0,
            },
            TranscriptionSegment {
                start: 3.0,
                end: 7.0,
                text: "Это нормальная фраза из разговора".to_string(),
                speaker: None,
                confidence: 1.0,
            },
        ];
        let filtered = TranscriptionManager::filter_hallucinations(&segments);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].text, "Это нормальная фраза из разговора");
    }

    #[test]
    fn test_filter_hallucinations_keeps_sparse_but_valid_segments() {
        let segments = vec![
            TranscriptionSegment {
                start: 0.0,
                end: 5.0,
                text: "Normal speech with adequate density".to_string(),
                speaker: None,
                confidence: 1.0,
            },
            TranscriptionSegment {
                // Long low-density fragment can still be valid speech with pauses.
                start: 10.0,
                end: 30.0,
                text: "Um hmm".to_string(),
                speaker: None,
                confidence: 1.0,
            },
        ];
        let filtered = TranscriptionManager::filter_hallucinations(&segments);
        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered[1].text, "Um hmm");
    }

    #[test]
    fn test_filter_hallucinations_removes_repetitive() {
        let segments = vec![
            TranscriptionSegment {
                start: 0.0,
                end: 3.0,
                text: "hello hello hello hello".to_string(),
                speaker: None,
                confidence: 1.0,
            },
            TranscriptionSegment {
                start: 3.0,
                end: 6.0,
                text: "this is real speech".to_string(),
                speaker: None,
                confidence: 1.0,
            },
        ];
        let filtered = TranscriptionManager::filter_hallucinations(&segments);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].text, "this is real speech");
    }

    #[test]
    fn test_filter_hallucinations_keeps_valid_segments() {
        let segments = vec![
            TranscriptionSegment {
                start: 0.0,
                end: 5.0,
                text: "This is a normal transcription segment".to_string(),
                speaker: None,
                confidence: 1.0,
            },
            TranscriptionSegment {
                start: 5.0,
                end: 10.0,
                text: "Another segment with enough content".to_string(),
                speaker: None,
                confidence: 1.0,
            },
        ];
        let filtered = TranscriptionManager::filter_hallucinations(&segments);
        assert_eq!(filtered.len(), 2);
    }

    #[test]
    fn test_filter_hallucinations_removes_empty() {
        let segments = vec![
            TranscriptionSegment {
                start: 0.0,
                end: 1.0,
                text: "  ".to_string(),
                speaker: None,
                confidence: 1.0,
            },
            TranscriptionSegment {
                start: 1.0,
                end: 2.0,
                text: ".".to_string(),
                speaker: None,
                confidence: 1.0,
            },
            TranscriptionSegment {
                start: 2.0,
                end: 5.0,
                text: "Real words here".to_string(),
                speaker: None,
                confidence: 1.0,
            },
        ];
        let filtered = TranscriptionManager::filter_hallucinations(&segments);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].text, "Real words here");
    }

    #[test]
    fn test_normalized_speech_intervals_merges_small_gaps() {
        let segments = vec![
            TranscriptionSegment {
                start: 0.5,
                end: 1.0,
                text: String::new(),
                speaker: Some("SPEAKER_00".to_string()),
                confidence: 1.0,
            },
            TranscriptionSegment {
                start: 1.03,
                end: 1.4,
                text: String::new(),
                speaker: Some("SPEAKER_00".to_string()),
                confidence: 1.0,
            },
            TranscriptionSegment {
                start: 2.0,
                end: 2.3,
                text: String::new(),
                speaker: Some("SPEAKER_01".to_string()),
                confidence: 1.0,
            },
        ];

        let merged = TranscriptionManager::normalized_speech_intervals(&segments, 3.0);
        assert_eq!(merged.len(), 2);
        assert!((merged[0].0 - 0.5).abs() < 0.001);
        assert!((merged[0].1 - 1.4).abs() < 0.001);
        assert!((merged[1].0 - 2.0).abs() < 0.001);
        assert!((merged[1].1 - 2.3).abs() < 0.001);
    }

    #[test]
    fn test_try_apply_soft_dga_rejects_too_low_coverage() {
        let audio = vec![1.0f32; 480_000]; // 30s @ 16kHz
        let segments = vec![TranscriptionSegment {
            start: 5.0,
            end: 5.1,
            text: String::new(),
            speaker: Some("SPEAKER_00".to_string()),
            confidence: 1.0,
        }];

        let masked = TranscriptionManager::try_apply_soft_dga(&audio, &segments, 16_000);
        assert!(masked.is_none());
    }

    #[test]
    fn test_try_apply_soft_dga_attenuates_non_speech() {
        let audio = vec![1.0f32; 32_000]; // 2s @ 16kHz
        let segments = vec![TranscriptionSegment {
            start: 0.8,
            end: 1.2,
            text: String::new(),
            speaker: Some("SPEAKER_00".to_string()),
            confidence: 1.0,
        }];

        let masked = TranscriptionManager::try_apply_soft_dga(&audio, &segments, 16_000)
            .expect("soft dga should be applied");

        let outside_sample = masked[0];
        let inside_sample = masked[16_000]; // center of speech area
        assert!(outside_sample < 0.1);
        assert!((inside_sample - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_try_apply_soft_dga_skips_when_mask_ends_too_early() {
        let audio = vec![1.0f32; 4_048_000]; // 253s @ 16kHz
        let segments = vec![TranscriptionSegment {
            start: 0.5,
            end: 179.0,
            text: String::new(),
            speaker: Some("SPEAKER_00".to_string()),
            confidence: 1.0,
        }];

        let masked = TranscriptionManager::try_apply_soft_dga(&audio, &segments, 16_000);
        assert!(masked.is_none());
    }

    #[test]
    fn test_should_retry_without_dga_on_large_missing_tail() {
        let result = TranscriptionResult {
            segments: vec![TranscriptionSegment {
                start: 0.0,
                end: 179.0,
                text: "sample".to_string(),
                speaker: None,
                confidence: 1.0,
            }],
            language: "en".to_string(),
            duration: 179.0,
            speaker_turns: None,
            speaker_segments: None,
            metrics: None,
        };

        assert!(TranscriptionManager::should_retry_without_dga(
            &result, 253.0
        ));
    }
}

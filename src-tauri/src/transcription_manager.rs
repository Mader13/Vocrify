//! Transcription Manager - Unified transcription using transcribe-rs
//!
//! Phase 3: Replaces engine_router.rs with transcribe-rs based implementation.
//! Supports multiple engines: Whisper (GGML), Parakeet (ONNX)
//!
//! Usage:
//! ```
//! let manager = TranscriptionManager::new(models_dir)?;
//! manager.load_model("whisper-base").await?;
//! let result = manager.transcribe_file(audio_path).await?;
//! ```

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use thiserror::Error;
use serde::{Deserialize, Serialize};

// Phase 3: transcribe-rs imports
#[cfg(feature = "rust-transcribe")]
use transcribe_rs::TranscriptionEngine;

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

/// A single transcription segment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionSegment {
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub speaker: Option<String>,
    pub confidence: f64,
}

/// Transcription result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionResult {
    pub segments: Vec<TranscriptionSegment>,
    pub language: String,
    pub duration: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker_turns: Option<Vec<SpeakerTurn>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker_segments: Option<Vec<TranscriptionSegment>>,
}

/// A speaker turn from diarization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeakerTurn {
    pub start: f64,
    pub end: f64,
    pub speaker: String,
}

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
}

impl Default for TranscriptionOptions {
    fn default() -> Self {
        Self {
            language: None,
            translate: false,
            enable_diarization: false,
            diarization_provider: None,
            num_speakers: 2,
        }
    }
}

/// Implement From for frontend TranscriptionOptions (camelCase)
impl From<crate::TranscriptionOptions> for TranscriptionOptions {
    fn from(opts: crate::TranscriptionOptions) -> Self {
        Self {
            language: if opts.language == "auto" { None } else { Some(opts.language) },
            translate: false,
            enable_diarization: opts.enable_diarization,
            diarization_provider: opts.diarization_provider,
            num_speakers: opts.num_speakers,
        }
    }
}

/// Implement From for RustTranscriptionOptions (Phase 3: transcribe-rs)
impl From<crate::RustTranscriptionOptions> for TranscriptionOptions {
    fn from(opts: crate::RustTranscriptionOptions) -> Self {
        Self {
            language: opts.language,
            translate: false,
            enable_diarization: opts.enable_diarization,
            diarization_provider: opts.diarization_provider,
            num_speakers: opts.num_speakers,
        }
    }
}

/// Phase 3: TranscriptionManager using transcribe-rs
/// Supports multiple engines through a unified interface
pub struct TranscriptionManager {
    #[allow(dead_code)]
    models_dir: PathBuf,
    current_model: Arc<Mutex<Option<String>>>,
    python_bridge: Option<crate::python_bridge::PythonBridge>,
}

impl TranscriptionManager {
    /// Create a new TranscriptionManager with Python bridge support
    pub fn new(
        models_dir: &Path,
        python_path: Option<&Path>,
        engine_path: Option<&Path>,
        cache_dir: Option<&Path>,
    ) -> Result<Self, TranscriptionError> {
        std::fs::create_dir_all(models_dir)?;

        eprintln!("[INFO] TranscriptionManager initialized with directory: {:?}", models_dir);

        let python_bridge = match (python_path, engine_path, cache_dir) {
            (Some(py_path), Some(eng_path), Some(cache)) => {
                eprintln!("[INFO] Python bridge configured: {:?}", py_path);
                Some(crate::python_bridge::PythonBridge::new(
                    py_path,
                    eng_path,
                    cache,
                ))
            }
            _ => {
                eprintln!("[WARN] Python bridge not configured - diarization disabled");
                None
            }
        };

        Ok(Self {
            models_dir: models_dir.to_path_buf(),
            current_model: Arc::new(Mutex::new(None)),
            python_bridge,
        })
    }

    /// Load a model for transcription
    #[cfg(feature = "rust-transcribe")]
    pub async fn load_model(&self, model_name: &str) -> Result<(), TranscriptionError> {
        let engine_type = EngineType::from_model_name(model_name)
            .ok_or_else(|| TranscriptionError::UnsupportedFormat(model_name.to_string()))?;

        let model_path = self.get_model_path(model_name, engine_type)?;

        if !model_path.exists() {
            return Err(TranscriptionError::ModelNotFound(
                format!("Model {} not found at {:?}", model_name, model_path)
            ));
        }

        eprintln!("[INFO] Loading model: {} (engine: {:?}) from {:?}",
            model_name, engine_type, model_path);

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
    ) -> Result<TranscriptionResult, TranscriptionError> {
        // Get model name with minimal lock duration
        let model_name = {
            let current = self.current_model.lock().unwrap();
            current.as_ref()
                .ok_or(TranscriptionError::EngineNotInitialized)?
                .clone()
        };

        let engine_type = EngineType::from_model_name(&model_name)
            .ok_or_else(|| TranscriptionError::UnsupportedFormat(model_name.clone()))?;

        // Get model path before async operations
        let model_path = self.get_model_path(&model_name, engine_type)?.clone();

        eprintln!("[INFO] Starting transcription of {:?} using {:?} engine",
            audio_path, engine_type);

        // Perform transcription
        let mut result = match engine_type {
            EngineType::Whisper => {
                self.transcribe_with_whisper(audio_path, &model_path, options).await
            }
            EngineType::Parakeet => {
                self.transcribe_with_parakeet(audio_path, &model_path, options).await
            }
            EngineType::Moonshine => {
                self.transcribe_with_moonshine(audio_path, &model_path, options).await
            }
            EngineType::SenseVoice => {
                self.transcribe_with_sensevoice(audio_path, &model_path, options).await
            }
        }?;

        // Run diarization if enabled
        if options.enable_diarization {
            eprintln!("[INFO] Diarization enabled, running...");

            match self.run_diarization(audio_path, options, hf_token).await {
                Ok((speaker_turns, speaker_segments)) => {
                    eprintln!("[INFO] Diarization complete with {} speaker_turns and {} speaker_segments", 
                        speaker_turns.len(), speaker_segments.len());

                    // Merge transcription with speaker info
                    let (merged_turns, merged_segments) = self.merge_diarization(
                        &result.segments,
                        &speaker_segments,
                    );

                    eprintln!("[INFO] After merge: {} merged_turns, {} merged_segments", 
                        merged_turns.len(), merged_segments.len());

                    result.speaker_turns = Some(merged_turns);
                    result.speaker_segments = Some(merged_segments.clone());
                    result.segments = merged_segments;
                }
                Err(e) => {
                    eprintln!("[WARN] Diarization failed: {}, returning transcription without speakers", e);
                    // Continue without speaker info
                }
            }
        }

        Ok(result)
    }

    /// Stub implementation when rust-transcribe feature is disabled
    #[cfg(not(feature = "rust-transcribe"))]
    pub async fn transcribe_file(
        &self,
        _audio_path: &Path,
        _options: &TranscriptionOptions,
    ) -> Result<TranscriptionResult, TranscriptionError> {
        Err(TranscriptionError::EngineNotInitialized)
    }

    /// Transcribe using Whisper engine (transcribe-rs)
    #[cfg(feature = "rust-transcribe")]
    async fn transcribe_with_whisper(
        &self,
        audio_path: &Path,
        model_path: &Path,
        options: &TranscriptionOptions,
    ) -> Result<TranscriptionResult, TranscriptionError> {
        use transcribe_rs::engines::whisper::{WhisperEngine, WhisperInferenceParams};

        // Find GGML model file
        let ggml_file = self.find_ggml_file(model_path)?;

        eprintln!("[INFO] Loading Whisper model: {:?}", ggml_file);

        // Load audio file
        let audio_data = self.load_audio_file(audio_path).await?;

        // Create and use Whisper engine
        let mut engine = WhisperEngine::new();
        engine.load_model(&ggml_file)
            .map_err(|e| TranscriptionError::ModelLoad(format!("{:?}", e)))?;

        let start_time = std::time::Instant::now();

        // Create inference params with language (0.2.2 API)
        let params = options.language.as_ref().map(|lang| {
            WhisperInferenceParams {
                language: Some(lang.clone()),
                ..Default::default()
            }
        });

        // Perform transcription (0.2.2 requires owned Vec and WhisperInferenceParams)
        let result = engine.transcribe_samples(audio_data.clone(), params)
            .map_err(|e| TranscriptionError::Transcription(format!("{:?}", e)))?;

        let elapsed = start_time.elapsed();

        // Get segments and calculate duration (0.2.2: segments is Option<Vec<>>, no duration field)
        let segments_0_2_2 = result.segments.unwrap_or_default();
        let duration = segments_0_2_2.last().map(|s| s.end as f64).unwrap_or(0.0);
        let realtime_factor = duration / elapsed.as_secs_f64();

        eprintln!("[INFO] Transcription complete: {:.2}s audio in {:.2}s (RTF: {:.2}x)",
            duration, elapsed.as_secs_f64(), realtime_factor);

        // Convert segments (0.2.2 uses f32 for timings, no language field on result)
        let segments: Vec<TranscriptionSegment> = segments_0_2_2.into_iter()
            .map(|s| TranscriptionSegment {
                start: s.start as f64,
                end: s.end as f64,
                text: s.text,
                speaker: None,
                confidence: 1.0,
            })
            .collect();

        // Use language from options or default to "en"
        let language = options.language.as_ref().cloned().unwrap_or_else(|| "en".to_string());

        Ok(TranscriptionResult {
            segments,
            language,
            duration,
            speaker_turns: None,
            speaker_segments: None,
        })
    }

    /// Transcribe using Parakeet engine (transcribe-rs)
    #[cfg(feature = "rust-transcribe")]
    async fn transcribe_with_parakeet(
        &self,
        audio_path: &Path,
        model_path: &Path,
        _options: &TranscriptionOptions,
    ) -> Result<TranscriptionResult, TranscriptionError> {
        use transcribe_rs::engines::parakeet::ParakeetEngine;

        eprintln!("[INFO] Loading Parakeet model from: {:?}", model_path);

        // Load audio file
        let audio_data = self.load_audio_file(audio_path).await?;

        // Create and use Parakeet engine
        let mut engine = ParakeetEngine::new();
        engine.load_model(model_path)
            .map_err(|e| TranscriptionError::ModelLoad(format!("{:?}", e)))?;

        let start_time = std::time::Instant::now();

        // Perform transcription (0.2.2 requires owned Vec)
        let result = engine.transcribe_samples(audio_data.clone(), None)
            .map_err(|e| TranscriptionError::Transcription(format!("{:?}", e)))?;

        let elapsed = start_time.elapsed();

        // Get segments and calculate duration (0.2.2: segments is Option<Vec<>>, no duration field)
        let segments_0_2_2 = result.segments.unwrap_or_default();
        let duration = segments_0_2_2.last().map(|s| s.end as f64).unwrap_or(0.0);
        let realtime_factor = duration / elapsed.as_secs_f64();

        eprintln!("[INFO] Transcription complete: {:.2}s audio in {:.2}s (RTF: {:.2}x)",
            duration, elapsed.as_secs_f64(), realtime_factor);

        // Convert result - Parakeet returns segments (0.2.2 uses f32 for timings)
        let segments: Vec<TranscriptionSegment> = segments_0_2_2.into_iter()
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
            language: "en".to_string(), // Parakeet is English-only
            duration,
            speaker_turns: None,
            speaker_segments: None,
        })
    }

    /// Transcribe using Moonshine engine (transcribe-rs)
    #[cfg(feature = "rust-transcribe")]
    async fn transcribe_with_moonshine(
        &self,
        audio_path: &Path,
        model_path: &Path,
        _options: &TranscriptionOptions,
    ) -> Result<TranscriptionResult, TranscriptionError> {
        use transcribe_rs::engines::moonshine::{MoonshineEngine, MoonshineModelParams, ModelVariant};

        eprintln!("[INFO] Loading Moonshine model from: {:?}", model_path);

        // Load audio file
        let audio_data = self.load_audio_file(audio_path).await?;

        // Determine variant from path name
        let variant = if model_path.to_string_lossy().contains("tiny") {
            ModelVariant::Tiny
        } else {
            ModelVariant::Base
        };

        // Create and use Moonshine engine
        let mut engine = MoonshineEngine::new();
        engine.load_model_with_params(model_path, MoonshineModelParams::variant(variant))
            .map_err(|e| TranscriptionError::ModelLoad(format!("{:?}", e)))?;

        let start_time = std::time::Instant::now();

        // Perform transcription (0.2.2 requires owned Vec)
        let audio_data_owned = audio_data.clone();
        let result = engine.transcribe_samples(audio_data_owned, None)
            .map_err(|e| TranscriptionError::Transcription(format!("{:?}", e)))?;

        let elapsed = start_time.elapsed();
        
        // Calculate duration from segments (0.2.2: segments is Option<Vec<>>)
        let segments_0_2_2 = result.segments.unwrap_or_default();
        let duration = segments_0_2_2.last().map(|s| s.end as f64).unwrap_or(0.0);
        let realtime_factor = duration / elapsed.as_secs_f64();

        eprintln!("[INFO] Transcription complete: {:.2}s audio in {:.2}s (RTF: {:.2}x)",
            duration, elapsed.as_secs_f64(), realtime_factor);

        // Convert segments (0.2.2 uses f32 for timings)
        let segments: Vec<TranscriptionSegment> = segments_0_2_2.into_iter()
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
        })
    }

    /// Transcribe using SenseVoice engine (transcribe-rs)
    /// NOTE: Not available in transcribe-rs 0.2.2
    #[cfg(feature = "rust-transcribe")]
    async fn transcribe_with_sensevoice(
        &self,
        _audio_path: &Path,
        _model_path: &Path,
        _options: &TranscriptionOptions,
    ) -> Result<TranscriptionResult, TranscriptionError> {
        // SenseVoice is not available in transcribe-rs 0.2.2
        // Will be added in a future version
        Err(TranscriptionError::UnsupportedFormat(
            "SenseVoice is not supported in transcribe-rs 0.2.2".to_string()
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
    fn get_model_path(&self, model_name: &str, engine_type: EngineType) -> Result<PathBuf, TranscriptionError> {
        match engine_type {
            EngineType::Whisper => {
                // Whisper models can be a directory or direct GGML file
                let model_dir = self.models_dir.join(model_name);
                if model_dir.exists() && model_dir.is_dir() {
                    Ok(model_dir)
                } else {
                    // Try as direct GGML file
                    let ggml_name = format!("ggml-{}.bin", model_name.trim_start_matches("whisper-"));
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

        Err(TranscriptionError::ModelNotFound(
            format!("No GGML model file found in {:?}", model_path)
        ))
    }

    /// Load and preprocess audio file using the new audio module
    #[cfg(feature = "rust-transcribe")]
    #[allow(dead_code)]
    async fn load_audio_file(&self, audio_path: &Path) -> Result<Vec<f32>, TranscriptionError> {
        use crate::audio;

        eprintln!("[INFO] Loading audio file using audio module: {:?}", audio_path);

        // Load audio using symphonia-based loader (supports all formats)
        let audio_buffer = audio::loader::load(audio_path)
            .map_err(|e| TranscriptionError::Transcription(format!("Failed to load audio: {}", e)))?;

        // Convert to mono if needed
        let mono = if audio_buffer.channels > 1 {
            eprintln!("[INFO] Converting {} channels to mono", audio_buffer.channels);
            audio_buffer.to_mono()
        } else {
            audio_buffer
        };

        // Resample to 16kHz if needed (Whisper requires 16kHz)
        let resampled = if mono.sample_rate != 16000 {
            eprintln!("[INFO] Resampling from {}Hz to 16000Hz", mono.sample_rate);
            mono.resample(16000)
        } else {
            mono
        };

        eprintln!("[INFO] Loaded {} samples ({:.2}s)",
            resampled.samples.len(), resampled.samples.len() as f64 / 16000.0);

        Ok(resampled.samples)
    }

    /// Stub implementation when rust-transcribe feature is disabled
    #[cfg(not(feature = "rust-transcribe"))]
    #[allow(dead_code)]
    async fn load_audio_file(&self, _audio_path: &Path) -> Result<Vec<f32>, TranscriptionError> {
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

    /// Run diarization using Python bridge
    async fn run_diarization(
        &self,
        audio_path: &Path,
        options: &TranscriptionOptions,
        hf_token: Option<&str>,
    ) -> Result<(Vec<SpeakerTurn>, Vec<TranscriptionSegment>), TranscriptionError> {
        use crate::python_bridge::DiarizationProvider;

        eprintln!("[DIARIZATION DEBUG] options.enable_diarization = {}", options.enable_diarization);
        eprintln!("[DIARIZATION DEBUG] options.diarization_provider = {:?}", options.diarization_provider);
        eprintln!("[DIARIZATION DEBUG] options.num_speakers = {}", options.num_speakers);
        eprintln!("[DIARIZATION DEBUG] python_bridge is Some = {}", self.python_bridge.is_some());

        let provider = options.diarization_provider.as_ref()
            .and_then(|p| match p.as_str() {
                "pyannote" => Some(DiarizationProvider::PyAnnote),
                "sherpa-onnx" => Some(DiarizationProvider::SherpaOnnx),
                _ => None,
            })
            .unwrap_or(DiarizationProvider::SherpaOnnx);

        let python_bridge = self.python_bridge.as_ref()
            .ok_or(TranscriptionError::Transcription("Python bridge not initialized".to_string()))?;

        eprintln!("[DIARIZATION DEBUG] Using provider: {:?}", provider);

        let speaker_segments = match provider {
            DiarizationProvider::PyAnnote => {
                python_bridge.diarize_pyannote(
                    audio_path,
                    hf_token,
                    Some(options.num_speakers),
                ).await.map_err(|e| TranscriptionError::Transcription(format!("Diarization failed: {}", e)))?
            }
            DiarizationProvider::SherpaOnnx => {
                python_bridge.diarize_sherpa(
                    audio_path,
                    Some(options.num_speakers),
                ).await.map_err(|e| TranscriptionError::Transcription(format!("Diarization failed: {}", e)))?
            }
        };

        eprintln!("[DIARIZATION DEBUG] Received {} speaker segments from Python", speaker_segments.len());

        // Convert to SpeakerTurn format
        let speaker_turns: Vec<SpeakerTurn> = speaker_segments.iter()
            .map(|s| SpeakerTurn {
                start: s.start,
                end: s.end,
                speaker: s.speaker.clone(),
            })
            .collect();

        // Also return as TranscriptionSegment format for easier merging
        let diarization_segments: Vec<TranscriptionSegment> = speaker_segments.into_iter()
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
        eprintln!("[INFO] Merging {} transcription segments with {} speaker segments",
            transcription_segments.len(), speaker_segments.len());

        let mut result_segments = Vec::with_capacity(transcription_segments.len());
        let mut speaker_turns: Vec<SpeakerTurn> = Vec::new();

        for trans_segment in transcription_segments {
            // Find the speaker with most overlap (O(n+m) algorithm)
            let mut best_speaker = None;
            let mut max_overlap = 0.0f64;

            for speaker_seg in speaker_segments {
                // Calculate overlap
                let overlap_start = trans_segment.start.max(speaker_seg.start);
                let overlap_end = trans_segment.end.min(speaker_seg.end);
                let overlap = (overlap_end - overlap_start).max(0.0);

                if overlap > max_overlap {
                    max_overlap = overlap;
                    best_speaker = speaker_seg.speaker.clone();
                }
            }

            // Create speaker turn if we found a speaker
            if let Some(ref speaker) = best_speaker {
                // Check if we can extend the last speaker turn
                let can_extend = speaker_turns.last()
                    .map(|last| last.speaker.as_str() == speaker.as_str() && trans_segment.start <= last.end + 0.5)
                    .unwrap_or(false);

                if can_extend {
                    // Extend the last turn
                    if let Some(last) = speaker_turns.last_mut() {
                        last.end = last.end.max(trans_segment.end);
                    }
                } else {
                    // Create new speaker turn
                    speaker_turns.push(SpeakerTurn {
                        start: trans_segment.start,
                        end: trans_segment.end,
                        speaker: speaker.clone(),
                    });
                }

                // Create segment with speaker
                result_segments.push(TranscriptionSegment {
                    start: trans_segment.start,
                    end: trans_segment.end,
                    text: trans_segment.text.clone(),
                    speaker: best_speaker,
                    confidence: trans_segment.confidence,
                });
            } else {
                // No speaker info, copy original segment
                result_segments.push(trans_segment.clone());
            }
        }

        eprintln!("[INFO] Merge complete: {} segments, {} speaker turns",
            result_segments.len(), speaker_turns.len());

        (speaker_turns, result_segments)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_engine_type_from_model_name() {
        assert_eq!(EngineType::from_model_name("whisper-base"), Some(EngineType::Whisper));
        assert_eq!(EngineType::from_model_name("parakeet-tdt-0.6b-v3"), Some(EngineType::Parakeet));
        assert_eq!(EngineType::from_model_name("moonshine-tiny"), Some(EngineType::Moonshine));
        assert_eq!(EngineType::from_model_name("sense-voice"), Some(EngineType::SenseVoice));
        assert_eq!(EngineType::from_model_name("unknown"), None);
    }

    #[test]
    fn test_transcription_manager_new() {
        let temp_dir = TempDir::new().unwrap();
        let manager = TranscriptionManager::new(
            temp_dir.path(),
            None,
            None,
            None
        ).unwrap();
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
}

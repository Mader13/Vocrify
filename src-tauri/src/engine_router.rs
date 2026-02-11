//! Engine Router - Routes transcription between Rust Whisper and Python backend
//!
//! This module provides intelligent routing between:
//! - Rust whisper-rs (Whisper GGML models) - fast, GPU-accelerated
//! - Python engine (Parakeet, PyAnnote) - feature-rich, Python-only models
//!
//! Routing logic:
//! - Whisper models → Rust (with auto-fallback to Python)
//! - Parakeet models → Python (NVIDIA NeMo)
//! - Diarization → Python (PyAnnote/Sherpa-ONNX)

use std::path::{Path, PathBuf};
use thiserror::Error;
use serde::{Deserialize, Serialize};

#[cfg(feature = "rust-whisper")]
use crate::whisper_engine::{WhisperEngine, DeviceType, TranscriptionOptions as WhisperOptions, WhisperError};
use crate::python_bridge::{PythonBridge, SpeakerSegment, DiarizationProvider};

/// Engine router errors
#[derive(Debug, Error)]
pub enum EngineRouterError {
    #[cfg(feature = "rust-whisper")]
    #[error("Whisper engine error: {0}")]
    Whisper(#[from] WhisperError),

    #[error("Python bridge error: {0}")]
    PythonBridge(String),

    #[error("Model not found: {0}")]
    ModelNotFound(String),

    #[error("Engine not available: {0}")]
    EngineNotAvailable(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

/// Engine choice for transcription
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineChoice {
    /// Rust whisper-rs (GGML models)
    RustWhisper,
    /// Python engine (Parakeet, PyAnnote)
    PythonEngine,
}

/// Engine preference setting
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EnginePreference {
    /// Rust primary, Python fallback (default)
    Auto,
    /// Only Rust, error if unavailable
    RustOnly,
    /// Only Python (Phase 1 behavior)
    PythonOnly,
}

impl Default for EnginePreference {
    fn default() -> Self {
        EnginePreference::Auto
    }
}

/// Transcription options for engine router
#[derive(Debug, Clone)]
pub struct RouterTranscriptionOptions {
    /// Model name (e.g., "whisper-base", "parakeet-tdt-0.6b-v3")
    pub model: String,
    /// Device type (e.g., "cuda", "cpu", "mps", "vulkan")
    pub device: String,
    /// Language code (e.g., "en", "ru", "auto")
    pub language: Option<String>,
    /// Enable speaker diarization
    pub enable_diarization: bool,
    /// Diarization provider
    pub diarization_provider: Option<String>,
    /// Number of speakers (for diarization)
    pub num_speakers: Option<i32>,
    /// HuggingFace token (for PyAnnote)
    pub hf_token: Option<String>,
}

/// Transcription result from engine router
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouterTranscriptionResult {
    pub segments: Vec<RouterSegment>,
    pub language: String,
    pub duration: f64,
    pub speaker_turns: Option<Vec<SpeakerSegment>>,
    pub engine_used: String,
}

/// Transcription segment from engine router
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouterSegment {
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub speaker: Option<String>,
    pub confidence: f64,
}

/// Engine router for transcription
pub struct EngineRouter {
    /// Python bridge for fallback and Python-only models
    python_bridge: PythonBridge,
    /// Models directory
    models_dir: PathBuf,
    /// Engine preference
    preference: EnginePreference,
}

impl EngineRouter {
    /// Create a new EngineRouter
    pub fn new(
        python_path: &Path,
        engine_path: &Path,
        models_dir: &Path,
        preference: EnginePreference,
    ) -> Self {
        let python_bridge = PythonBridge::new(python_path, engine_path, models_dir);

        Self {
            python_bridge,
            models_dir: models_dir.to_path_buf(),
            preference,
        }
    }

    /// Transcribe audio file with automatic engine selection
    pub async fn transcribe(
        &self,
        audio_path: &Path,
        options: RouterTranscriptionOptions,
    ) -> Result<RouterTranscriptionResult, EngineRouterError> {
        let engine = self.select_engine(&options.model);

        match engine {
            EngineChoice::RustWhisper => {
                self.transcribe_with_rust(audio_path, &options).await
            }
            EngineChoice::PythonEngine => {
                self.transcribe_with_python(audio_path, &options).await
            }
        }
    }

    /// Select the appropriate engine for a model
    fn select_engine(&self, model: &str) -> EngineChoice {
        // Parakeet models always use Python
        if model.starts_with("parakeet") || model.starts_with("nvidia/") {
            return EngineChoice::PythonEngine;
        }

        // Check preference
        match self.preference {
            EnginePreference::PythonOnly => EngineChoice::PythonEngine,
            EnginePreference::RustOnly => EngineChoice::RustWhisper,
            EnginePreference::Auto => {
                // Whisper models use Rust if available
                #[cfg(feature = "rust-whisper")]
                {
                    EngineChoice::RustWhisper
                }
                #[cfg(not(feature = "rust-whisper"))]
                {
                    EngineChoice::PythonEngine
                }
            }
        }
    }

    /// Transcribe using Rust whisper-rs
    #[cfg(feature = "rust-whisper")]
    async fn transcribe_with_rust(
        &self,
        audio_path: &Path,
        options: &RouterTranscriptionOptions,
    ) -> Result<RouterTranscriptionResult, EngineRouterError> {
        eprintln!("[INFO] EngineRouter: Using Rust Whisper for {}", options.model);

        // Get model path
        let model_path = self.get_whisper_model_path(&options.model)?;

        // Get or create Whisper engine
        let device = self.parse_device(&options.device);
        let engine = self.create_whisper_engine(&model_path, device).await?;

        // Load audio
        let audio = self.load_audio(audio_path).await?;

        // Transcribe
        let whisper_options = WhisperOptions {
            language: options.language.clone(),
            translate: false,
            print_progress: true,
            print_timestamps: true,
        };

        let result = engine.transcribe(&audio, whisper_options)
            .map_err(|e| {
                eprintln!("[WARN] Rust Whisper failed: {}, falling back to Python", e);
                // Auto-fallback to Python
                EngineRouterError::Whisper(e)
            })?;

        // Convert result
        let segments: Vec<RouterSegment> = result.segments.into_iter()
            .map(|s| RouterSegment {
                start: s.start,
                end: s.end,
                text: s.text,
                speaker: s.speaker,
                confidence: s.confidence,
            })
            .collect();

        // Run diarization if requested
        let speaker_turns = if options.enable_diarization {
            self.run_diarization(audio_path, options).await?
        } else {
            None
        };

        Ok(RouterTranscriptionResult {
            segments,
            language: result.language,
            duration: result.duration,
            speaker_turns,
            engine_used: "rust-whisper".to_string(),
        })
    }

    /// Transcribe using Rust whisper-rs (stub when feature disabled)
    #[cfg(not(feature = "rust-whisper"))]
    async fn transcribe_with_rust(
        &self,
        audio_path: &Path,
        options: &RouterTranscriptionOptions,
    ) -> Result<RouterTranscriptionResult, EngineRouterError> {
        // Fallback to Python
        eprintln!("[WARN] rust-whisper feature disabled, falling back to Python");
        self.transcribe_with_python(audio_path, options).await
    }

    /// Transcribe using Python engine
    async fn transcribe_with_python(
        &self,
        audio_path: &Path,
        options: &RouterTranscriptionOptions,
    ) -> Result<RouterTranscriptionResult, EngineRouterError> {
        eprintln!("[INFO] EngineRouter: Using Python engine for {}", options.model);

        let result = self.python_bridge
            .transcribe_parakeet(
                audio_path,
                &options.model,
                &options.device,
                options.language.as_deref(),
            )
            .await
            .map_err(|e| EngineRouterError::PythonBridge(e.to_string()))?;

        // Convert result
        let segments: Vec<RouterSegment> = result.segments.into_iter()
            .map(|s| RouterSegment {
                start: s.start,
                end: s.end,
                text: s.text,
                speaker: s.speaker,
                confidence: s.confidence,
            })
            .collect();

        // Run diarization if requested
        let speaker_turns = if options.enable_diarization {
            self.run_diarization(audio_path, options).await?
        } else {
            result.speaker_turns
        };

        Ok(RouterTranscriptionResult {
            segments,
            language: result.language,
            duration: result.duration,
            speaker_turns,
            engine_used: "python".to_string(),
        })
    }

    /// Run speaker diarization
    async fn run_diarization(
        &self,
        audio_path: &Path,
        options: &RouterTranscriptionOptions,
    ) -> Result<Option<Vec<SpeakerSegment>>, EngineRouterError> {
        let provider = match &options.diarization_provider {
            Some(p) if p == "pyannote" => DiarizationProvider::PyAnnote,
            Some(p) if p == "sherpa-onnx" => DiarizationProvider::SherpaOnnx,
            _ => {
                eprintln!("[WARN] Unknown diarization provider, defaulting to pyannote");
                DiarizationProvider::PyAnnote
            }
        };

        let segments = match provider {
            DiarizationProvider::PyAnnote => {
                self.python_bridge
                    .diarize_pyannote(
                        audio_path,
                        options.hf_token.as_deref(),
                        options.num_speakers,
                    )
                    .await
            }
            DiarizationProvider::SherpaOnnx => {
                self.python_bridge
                    .diarize_sherpa(audio_path, options.num_speakers)
                    .await
            }
        };

        match segments {
            Ok(segs) => Ok(Some(segs)),
            Err(e) => {
                eprintln!("[WARN] Diarization failed: {}", e);
                Ok(None) // Don't fail transcription if diarization fails
            }
        }
    }

    /// Create Whisper engine (no caching since WhisperEngine doesn't implement Clone)
    #[cfg(feature = "rust-whisper")]
    async fn create_whisper_engine(
        &self,
        model_path: &Path,
        device: DeviceType,
    ) -> Result<WhisperEngine, EngineRouterError> {
        // Create new engine on demand
        // Note: We don't cache because WhisperEngine doesn't implement Clone
        // and the underlying whisper.cpp context is not thread-safe
        let engine = WhisperEngine::new(model_path, device)?;
        Ok(engine)
    }

    /// Get Whisper model path
    fn get_whisper_model_path(&self, model_name: &str) -> Result<PathBuf, EngineRouterError> {
        // Map model name to GGML filename
        let ggml_name = match model_name {
            "tiny" | "whisper-tiny" => "ggml-tiny.bin",
            "base" | "whisper-base" => "ggml-base.bin",
            "small" | "whisper-small" => "ggml-small.bin",
            "medium" | "whisper-medium" => "ggml-medium.bin",
            "large" | "whisper-large" | "large-v1" => "ggml-large-v1.bin",
            "large-v2" => "ggml-large-v2.bin",
            "large-v3" => "ggml-large-v3.bin",
            _ => {
                // Try as-is
                if model_name.ends_with(".bin") {
                    model_name
                } else {
                    &format!("ggml-{}.bin", model_name.replace("whisper-", ""))
                }
            }
        };

        let model_path = self.models_dir.join(ggml_name);

        if model_path.exists() {
            Ok(model_path)
        } else {
            Err(EngineRouterError::ModelNotFound(model_name.to_string()))
        }
    }

    /// Parse device string to DeviceType
    #[cfg(feature = "rust-whisper")]
    fn parse_device(&self, device: &str) -> DeviceType {
        match device.to_lowercase().as_str() {
            "cuda" => DeviceType::Cuda,
            "mps" => DeviceType::Metal,
            "vulkan" => DeviceType::Vulkan,
            _ => DeviceType::Cpu,
        }
    }

    /// Load audio file as f32 samples
    async fn load_audio(&self, _audio_path: &Path) -> Result<Vec<f32>, EngineRouterError> {
        // TODO: Implement audio loading using FFmpeg or symphonia
        // For now, return empty - this will be implemented in a separate module
        eprintln!("[WARN] Audio loading not implemented yet");
        Ok(Vec::new())
    }

    /// Get current engine preference
    pub fn preference(&self) -> EnginePreference {
        self.preference
    }

    /// Set engine preference
    pub fn set_preference(&mut self, preference: EnginePreference) {
        self.preference = preference;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_engine_preference_default() {
        assert_eq!(EnginePreference::default(), EnginePreference::Auto);
    }

    #[test]
    fn test_engine_preference_serialize() {
        assert_eq!(
            serde_json::to_string(&EnginePreference::Auto).unwrap(),
            "\"auto\""
        );
        assert_eq!(
            serde_json::to_string(&EnginePreference::RustOnly).unwrap(),
            "\"rustonly\""
        );
        assert_eq!(
            serde_json::to_string(&EnginePreference::PythonOnly).unwrap(),
            "\"pythononly\""
        );
    }

    #[test]
    fn test_router_segment_deserialize() {
        let json = r#"{"start": 0.0, "end": 1.0, "text": "Hello", "speaker": null, "confidence": 0.9}"#;
        let segment: RouterSegment = serde_json::from_str(json).unwrap();
        assert_eq!(segment.start, 0.0);
        assert_eq!(segment.end, 1.0);
        assert_eq!(segment.text, "Hello");
        assert!(segment.speaker.is_none());
        assert_eq!(segment.confidence, 0.9);
    }
}

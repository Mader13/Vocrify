//! Engine Router - Phase 4: Rust-only transcription
//!
//! All transcription (Whisper, Parakeet, Moonshine) is handled by
//! transcription_manager.rs via transcribe-rs.
//! Python is called exclusively for Sherpa-ONNX diarization.

use std::path::Path;
use thiserror::Error;
use serde::{Deserialize, Serialize};

use crate::python_bridge::{PythonBridge, SpeakerSegment};

/// Engine router errors
#[derive(Debug, Error)]
pub enum EngineRouterError {
    #[error("Python bridge error: {0}")]
    PythonBridge(String),

    #[error("Model not found: {0}")]
    ModelNotFound(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

/// Engine preference (kept for compatibility, now always Rust)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EnginePreference {
    /// Rust-only (default and only supported mode)
    Auto,
    RustOnly,
    /// Deprecated - kept for compile-time compatibility, behaves like Auto
    PythonOnly,
}

impl Default for EnginePreference {
    fn default() -> Self {
        EnginePreference::Auto
    }
}

/// Transcription segment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouterSegment {
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub speaker: Option<String>,
    pub confidence: f64,
}

/// Engine router (now a thin diarization wrapper around PythonBridge)
pub struct EngineRouter {
    python_bridge: PythonBridge,
}

impl EngineRouter {
    /// Create a new EngineRouter
    pub fn new(
        python_path: &Path,
        engine_path: &Path,
        cache_dir: &Path,
        _preference: EnginePreference,
    ) -> Self {
        Self {
            python_bridge: PythonBridge::new(python_path, engine_path, cache_dir),
        }
    }

    /// Run Sherpa-ONNX speaker diarization for a given audio file.
    /// Called by transcription_manager.rs after Rust transcription is complete.
    pub async fn run_diarization(
        &self,
        audio_path: &Path,
        num_speakers: Option<i32>,
    ) -> Option<Vec<SpeakerSegment>> {
        eprintln!("[INFO] EngineRouter: Running Sherpa-ONNX diarization");
        match self.python_bridge.diarize_sherpa(audio_path, num_speakers).await {
            Ok(segs) => {
                eprintln!("[INFO] EngineRouter: Diarization returned {} segments", segs.len());
                Some(segs)
            }
            Err(e) => {
                // Non-fatal: diarization failure should not break transcription.
                eprintln!("[WARN] EngineRouter: Diarization failed: {}", e);
                None
            }
        }
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
    }
}

//! Engine Router - Phase 4: Rust-only transcription
//!
//! All transcription and diarization are handled natively in Rust.
//! This router is kept only for API compatibility.

use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;

use crate::types::SpeakerSegment;

/// Engine router errors
#[derive(Debug, Error)]
pub enum EngineRouterError {
    #[error("Engine routing error: {0}")]
    Routing(String),

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
    CompatOnly,
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

/// Engine router compatibility shim.
pub struct EngineRouter;

impl EngineRouter {
    /// Create a new EngineRouter
    pub fn new(
        _runtime_path: &Path,
        _engine_path: &Path,
        _models_dir: &Path,
        _audio_cache_dir: &Path,
        _preference: EnginePreference,
    ) -> Self {
        Self
    }

    /// Run Sherpa-ONNX speaker diarization for a given audio file.
    /// Called by transcription_manager.rs after Rust transcription is complete.
    pub async fn run_diarization(
        &self,
        _audio_path: &Path,
        _num_speakers: Option<i32>,
    ) -> Option<Vec<SpeakerSegment>> {
        // Native diarization path is used directly from transcription_manager.
        None
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

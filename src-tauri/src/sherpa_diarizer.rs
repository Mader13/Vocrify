//! Sherpa-ONNX Diarizer - Rust-based speaker diarization
//!
//! This module provides speaker diarization using sherpa-onnx.
//! NOTE: sherpa-rs API stability needs verification before production use.
//! Currently uses Python fallback for diarization.

use std::path::{Path, PathBuf};
use thiserror::Error;
use serde::{Deserialize, Serialize};

/// Diarization errors
#[derive(Debug, Error)]
pub enum DiarizationError {
    #[error("Failed to initialize diarizer: {0}")]
    Init(String),

    #[error("Diarization failed: {0}")]
    Diarization(String),

    #[error("Model not found: {0}")]
    ModelNotFound(String),

    #[error("Unsupported provider: {0}")]
    UnsupportedProvider(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

/// Supported diarization providers
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiarizationProvider {
    Pyannote,
    SherpaOnnx,
}

impl DiarizationProvider {
    pub fn display_name(&self) -> &'static str {
        match self {
            DiarizationProvider::Pyannote => "PyAnnote",
            DiarizationProvider::SherpaOnnx => "Sherpa-ONNX",
        }
    }
}

/// A speaker segment from diarization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeakerSegment {
    pub start: f64,
    pub end: f64,
    pub speaker: String,
}

/// Diarization result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiarizationResult {
    pub segments: Vec<SpeakerSegment>,
    pub num_speakers: usize,
}

/// Diarization options
#[derive(Debug, Clone)]
pub struct DiarizationOptions {
    pub num_speakers: Option<usize>,
    pub provider: DiarizationProvider,
}

impl Default for DiarizationOptions {
    fn default() -> Self {
        Self {
            num_speakers: None, // Auto-detect
            provider: DiarizationProvider::SherpaOnnx,
        }
    }
}

/// Sherpa-ONNX diarizer for speaker diarization
///
/// NOTE: This is a stub implementation. The actual sherpa-rs integration
/// requires API stability verification before production use.
/// Currently falls back to Python-based diarization.
pub struct SherpaDiarizer {
    models_dir: PathBuf,
    provider: DiarizationProvider,
    #[allow(dead_code)]
    initialized: bool,
}

impl SherpaDiarizer {
    /// Create a new SherpaDiarizer
    pub fn new(models_dir: &Path, provider: DiarizationProvider) -> Result<Self, DiarizationError> {
        eprintln!("[INFO] Initializing SherpaDiarizer with provider: {:?}", provider);
        eprintln!("[INFO] Models directory: {:?}", models_dir);

        // Verify models exist based on provider
        match provider {
            DiarizationProvider::SherpaOnnx => {
                let seg_path = models_dir.join("sherpa-onnx-segmentation");
                let emb_path = models_dir.join("sherpa-onnx-embedding");

                if !seg_path.exists() || !emb_path.exists() {
                    eprintln!("[WARN] Sherpa-ONNX diarization models not found");
                    eprintln!("[WARN] Segmentation path exists: {}", seg_path.exists());
                    eprintln!("[WARN] Embedding path exists: {}", emb_path.exists());
                }
            }
            DiarizationProvider::Pyannote => {
                let seg_path = models_dir.join("pyannote-segmentation-3.0");
                let emb_path = models_dir.join("pyannote-embedding-3.0");

                if !seg_path.exists() || !emb_path.exists() {
                    eprintln!("[WARN] PyAnnote diarization models not found");
                    eprintln!("[WARN] Segmentation path exists: {}", seg_path.exists());
                    eprintln!("[WARN] Embedding path exists: {}", emb_path.exists());
                }
            }
        }

        Ok(Self {
            models_dir: models_dir.to_path_buf(),
            provider,
            initialized: false,
        })
    }

    /// Perform speaker diarization on audio samples
    ///
    /// NOTE: This is a stub implementation. Currently returns an error
    /// indicating Python fallback should be used.
    pub fn diarize(
        &mut self,
        _audio: &[f32],
        _options: DiarizationOptions,
    ) -> Result<DiarizationResult, DiarizationError> {
        // TODO: Implement actual sherpa-rs diarization when API is stable
        // For now, return error to indicate Python fallback should be used
        Err(DiarizationError::Diarization(
            "Sherpa-ONNX Rust diarization not yet implemented. Use Python fallback.".to_string()
        ))
    }

    /// Check if diarization models are available
    pub fn is_available(&self) -> bool {
        match self.provider {
            DiarizationProvider::SherpaOnnx => {
                let seg_path = self.models_dir.join("sherpa-onnx-segmentation");
                let emb_path = self.models_dir.join("sherpa-onnx-embedding");
                seg_path.exists() && emb_path.exists()
            }
            DiarizationProvider::Pyannote => {
                let seg_path = self.models_dir.join("pyannote-segmentation-3.0");
                let emb_path = self.models_dir.join("pyannote-embedding-3.0");
                seg_path.exists() && emb_path.exists()
            }
        }
    }

    /// Get the current provider
    pub fn provider(&self) -> DiarizationProvider {
        self.provider
    }

    /// Get the models directory
    pub fn models_dir(&self) -> &Path {
        &self.models_dir
    }

    /// Download diarization models
    ///
    /// NOTE: This is a stub. Model downloading is handled by Python backend.
    pub async fn download_models(
        &self,
        _provider: DiarizationProvider,
    ) -> Result<(), DiarizationError> {
        Err(DiarizationError::Init(
            "Model downloading is handled by Python backend. Use download_model command.".to_string()
        ))
    }
}

/// Merge transcription segments with speaker information from diarization
pub fn merge_transcription_with_speakers(
    transcription_segments: &[(f64, f64, &str)], // (start, end, text)
    speaker_segments: &[SpeakerSegment],
) -> Vec<(f64, f64, String, String)> { // (start, end, text, speaker)
    let mut result = Vec::new();

    for (t_start, t_end, text) in transcription_segments {
        // Find the speaker with the most overlap
        let mut best_speaker = "Speaker 1".to_string();
        let mut max_overlap = 0.0f64;

        for seg in speaker_segments {
            // Calculate overlap
            let overlap_start = t_start.max(seg.start);
            let overlap_end = t_end.min(seg.end);
            let overlap = (overlap_end - overlap_start).max(0.0);

            if overlap > max_overlap {
                max_overlap = overlap;
                best_speaker = seg.speaker.clone();
            }
        }

        result.push((*t_start, *t_end, text.to_string(), best_speaker));
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_diarization_provider_display() {
        assert_eq!(DiarizationProvider::Pyannote.display_name(), "PyAnnote");
        assert_eq!(DiarizationProvider::SherpaOnnx.display_name(), "Sherpa-ONNX");
    }

    #[test]
    fn test_diarization_options_default() {
        let options = DiarizationOptions::default();
        assert!(options.num_speakers.is_none());
        assert_eq!(options.provider, DiarizationProvider::SherpaOnnx);
    }

    #[test]
    fn test_merge_transcription_with_speakers() {
        let transcription = vec![
            (0.0, 5.0, "Hello world"),
            (5.0, 10.0, "How are you"),
        ];

        let speakers = vec![
            SpeakerSegment { start: 0.0, end: 6.0, speaker: "Speaker 1".to_string() },
            SpeakerSegment { start: 6.0, end: 12.0, speaker: "Speaker 2".to_string() },
        ];

        let merged = merge_transcription_with_speakers(
            &transcription,
            &speakers
        );

        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].3, "Speaker 1");
        assert_eq!(merged[1].3, "Speaker 2");
    }

    #[test]
    fn test_sherpa_diarizer_availability() {
        let temp_dir = tempfile::tempdir().unwrap();

        // Without models, should not be available
        let diarizer = SherpaDiarizer::new(
            temp_dir.path(),
            DiarizationProvider::SherpaOnnx
        ).unwrap();
        assert!(!diarizer.is_available());

        // Create model directories
        std::fs::create_dir_all(temp_dir.path().join("sherpa-onnx-segmentation")).unwrap();
        std::fs::create_dir_all(temp_dir.path().join("sherpa-onnx-embedding")).unwrap();

        // Now should be available
        assert!(diarizer.is_available());
    }
}

//! Python Bridge - Interface to Python AI engine for diarization and Parakeet
//!
//! This module provides a bridge to the Python backend for:
//! - PyAnnote speaker diarization
//! - Sherpa-ONNX speaker diarization
//! - Parakeet transcription (NVIDIA NeMo)
//!
//! These features remain in Python because:
//! - sherpa-rs is unstable on Windows
//! - PyAnnote requires HuggingFace token authentication
//! - Parakeet models use NVIDIA NeMo which is Python-only

use std::path::{Path, PathBuf};
use std::process::Stdio;
use thiserror::Error;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// Python bridge errors
#[derive(Debug, Error)]
pub enum PythonBridgeError {
    #[error("Failed to spawn Python process: {0}")]
    SpawnError(String),

    #[error("Python process failed: {0}")]
    ProcessError(String),

    #[error("Failed to parse Python output: {0}")]
    ParseError(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Timeout waiting for Python response")]
    Timeout,
}

/// Speaker segment from diarization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeakerSegment {
    pub start: f64,
    pub end: f64,
    pub speaker: String,
}

/// Transcription segment from Python engine
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PythonTranscriptionSegment {
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub speaker: Option<String>,
    pub confidence: f64,
}

/// Transcription result from Python engine
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PythonTranscriptionResult {
    pub segments: Vec<PythonTranscriptionSegment>,
    pub language: String,
    pub duration: f64,
    #[serde(default)]
    pub speaker_turns: Option<Vec<SpeakerSegment>>,
}

/// Diarization provider type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiarizationProvider {
    PyAnnote,
    SherpaOnnx,
}

impl DiarizationProvider {
    pub fn as_str(&self) -> &'static str {
        match self {
            DiarizationProvider::PyAnnote => "pyannote",
            DiarizationProvider::SherpaOnnx => "sherpa-onnx",
        }
    }
}

/// Python bridge for AI engine communication
pub struct PythonBridge {
    python_path: PathBuf,
    engine_path: PathBuf,
    cache_dir: PathBuf,
}

impl PythonBridge {
    /// Create a new PythonBridge
    pub fn new(python_path: &Path, engine_path: &Path, cache_dir: &Path) -> Self {
        Self {
            python_path: python_path.to_path_buf(),
            engine_path: engine_path.to_path_buf(),
            cache_dir: cache_dir.to_path_buf(),
        }
    }

    /// Run PyAnnote diarization via Python subprocess
    pub async fn diarize_pyannote(
        &self,
        audio_path: &Path,
        hf_token: Option<&str>,
        num_speakers: Option<i32>,
    ) -> Result<Vec<SpeakerSegment>, PythonBridgeError> {
        self.diarize(
            audio_path,
            DiarizationProvider::PyAnnote,
            hf_token,
            num_speakers,
        ).await
    }

    /// Run Sherpa-ONNX diarization via Python subprocess
    pub async fn diarize_sherpa(
        &self,
        audio_path: &Path,
        num_speakers: Option<i32>,
    ) -> Result<Vec<SpeakerSegment>, PythonBridgeError> {
        self.diarize(
            audio_path,
            DiarizationProvider::SherpaOnnx,
            None, // No HF token needed for Sherpa
            num_speakers,
        ).await
    }

    /// Generic diarization method
    async fn diarize(
        &self,
        audio_path: &Path,
        provider: DiarizationProvider,
        hf_token: Option<&str>,
        num_speakers: Option<i32>,
    ) -> Result<Vec<SpeakerSegment>, PythonBridgeError> {
        eprintln!("[INFO] PythonBridge: Starting diarization with {:?}", provider);
        eprintln!("[INFO] Audio: {:?}", audio_path);

        let mut cmd = Command::new(&self.python_path);
        cmd.arg(&self.engine_path)
            .arg("--diarize-only")
            .arg("--provider").arg(provider.as_str())
            .arg("--audio").arg(audio_path)
            .arg("--cache-dir").arg(&self.cache_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Add HuggingFace token for PyAnnote
        if provider == DiarizationProvider::PyAnnote {
            if let Some(token) = hf_token {
                cmd.env("HUGGINGFACE_ACCESS_TOKEN", token);
                cmd.env("HF_TOKEN", token);
            }
        }

        // Add number of speakers if specified
        if let Some(n) = num_speakers {
            cmd.arg("--num-speakers").arg(n.to_string());
        }

        let mut child = cmd.spawn()
            .map_err(|e| PythonBridgeError::SpawnError(format!("Failed to spawn Python: {}", e)))?;

        let stdout = child.stdout.take().expect("Failed to capture stdout");
        let stderr = child.stderr.take().expect("Failed to capture stderr");

        let mut reader = BufReader::new(stdout).lines();
        let mut stderr_reader = BufReader::new(stderr).lines();

        let mut segments = Vec::new();

        // Read stdout for results
        while let Ok(Some(line)) = reader.next_line().await {
            if line.is_empty() || !line.starts_with('{') {
                continue;
            }

            // Try to parse as diarization result
            if let Ok(msg) = serde_json::from_str::<DiarizationMessage>(&line) {
                match msg {
                    DiarizationMessage::Segments { segments: segs } => {
                        segments = segs;
                    }
                    DiarizationMessage::Error { error } => {
                        return Err(PythonBridgeError::ProcessError(error));
                    }
                    _ => {}
                }
            }
        }

        // Log stderr for debugging
        while let Ok(Some(line)) = stderr_reader.next_line().await {
            eprintln!("[PYTHON STDERR] {}", line);
        }

        // Wait for process to complete
        let status = child.wait().await?;
        if !status.success() {
            return Err(PythonBridgeError::ProcessError(
                format!("Python process exited with code: {:?}", status.code())
            ));
        }

        eprintln!("[INFO] PythonBridge: Diarization complete, {} segments", segments.len());
        Ok(segments)
    }

    /// Run Parakeet transcription via Python subprocess
    pub async fn transcribe_parakeet(
        &self,
        audio_path: &Path,
        model: &str,
        device: &str,
        language: Option<&str>,
    ) -> Result<PythonTranscriptionResult, PythonBridgeError> {
        eprintln!("[INFO] PythonBridge: Starting Parakeet transcription");
        eprintln!("[INFO] Model: {}, Device: {}", model, device);

        let mut cmd = Command::new(&self.python_path);
        cmd.arg(&self.engine_path)
            .arg("--transcribe-only")
            .arg("--model").arg(model)
            .arg("--device").arg(device)
            .arg("--audio").arg(audio_path)
            .arg("--cache-dir").arg(&self.cache_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(lang) = language {
            cmd.arg("--language").arg(lang);
        }

        let mut child = cmd.spawn()
            .map_err(|e| PythonBridgeError::SpawnError(format!("Failed to spawn Python: {}", e)))?;

        let stdout = child.stdout.take().expect("Failed to capture stdout");
        let stderr = child.stderr.take().expect("Failed to capture stderr");

        let mut reader = BufReader::new(stdout).lines();
        let mut stderr_reader = BufReader::new(stderr).lines();

        let mut result = PythonTranscriptionResult {
            segments: Vec::new(),
            language: "en".to_string(),
            duration: 0.0,
            speaker_turns: None,
        };

        // Read stdout for results
        while let Ok(Some(line)) = reader.next_line().await {
            if line.is_empty() || !line.starts_with('{') {
                continue;
            }

            if let Ok(msg) = serde_json::from_str::<TranscriptionMessage>(&line) {
                match msg {
                    TranscriptionMessage::Result { segments, language, duration, speaker_turns } => {
                        result.segments = segments;
                        result.language = language;
                        result.duration = duration;
                        result.speaker_turns = speaker_turns;
                    }
                    TranscriptionMessage::Error { error } => {
                        return Err(PythonBridgeError::ProcessError(error));
                    }
                    _ => {}
                }
            }
        }

        // Log stderr for debugging
        while let Ok(Some(line)) = stderr_reader.next_line().await {
            eprintln!("[PYTHON STDERR] {}", line);
        }

        // Wait for process to complete
        let status = child.wait().await?;
        if !status.success() {
            return Err(PythonBridgeError::ProcessError(
                format!("Python process exited with code: {:?}", status.code())
            ));
        }

        eprintln!("[INFO] PythonBridge: Transcription complete, {} segments", result.segments.len());
        Ok(result)
    }

    /// Check if Python engine is available
    pub async fn check_available(&self) -> Result<bool, PythonBridgeError> {
        let output = Command::new(&self.python_path)
            .arg(&self.engine_path)
            .arg("--test")
            .output()
            .await?;

        Ok(output.status.success())
    }

    /// Get Python version
    pub async fn get_python_version(&self) -> Result<String, PythonBridgeError> {
        let output = Command::new(&self.python_path)
            .arg("--version")
            .output()
            .await?;

        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(version)
    }
}

/// Messages from Python diarization
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum DiarizationMessage {
    Segments { segments: Vec<SpeakerSegment> },
    Error { error: String },
    #[allow(dead_code)]
    Progress { message: String },
}

/// Messages from Python transcription
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum TranscriptionMessage {
    Result {
        segments: Vec<PythonTranscriptionSegment>,
        language: String,
        duration: f64,
        #[serde(default)]
        speaker_turns: Option<Vec<SpeakerSegment>>,
    },
    Error { error: String },
    #[allow(dead_code)]
    Progress { stage: String, progress: u8, message: String },
    #[allow(dead_code)]
    Segment { segment: PythonTranscriptionSegment, index: u32 },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_diarization_provider_as_str() {
        assert_eq!(DiarizationProvider::PyAnnote.as_str(), "pyannote");
        assert_eq!(DiarizationProvider::SherpaOnnx.as_str(), "sherpa-onnx");
    }

    #[test]
    fn test_speaker_segment_deserialize() {
        let json = r#"{"start": 0.0, "end": 5.5, "speaker": "SPEAKER_01"}"#;
        let segment: SpeakerSegment = serde_json::from_str(json).unwrap();
        assert_eq!(segment.start, 0.0);
        assert_eq!(segment.end, 5.5);
        assert_eq!(segment.speaker, "SPEAKER_01");
    }

    #[test]
    fn test_transcription_result_deserialize() {
        let json = r#"{
            "segments": [{"start": 0.0, "end": 1.0, "text": "Hello", "speaker": null, "confidence": 0.9}],
            "language": "en",
            "duration": 10.0
        }"#;
        let result: PythonTranscriptionResult = serde_json::from_str(json).unwrap();
        assert_eq!(result.segments.len(), 1);
        assert_eq!(result.language, "en");
        assert_eq!(result.duration, 10.0);
    }
}

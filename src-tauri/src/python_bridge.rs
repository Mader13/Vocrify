//! Python Bridge - Sherpa-ONNX diarization interface
//!
//! Phase 4: Python is now a diarization-only microservice.
//! All transcription is handled by Rust transcribe-rs.
//!
//! This module calls the Python ai-engine solely for:
//! - Sherpa-ONNX speaker diarization

use std::path::{Path, PathBuf};
use std::process::Stdio;
use thiserror::Error;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::python_installer::create_hidden_command;

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

/// Python bridge for Sherpa-ONNX diarization
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

    /// Run Sherpa-ONNX diarization via Python subprocess
    pub async fn diarize_sherpa(
        &self,
        audio_path: &Path,
        num_speakers: Option<i32>,
    ) -> Result<Vec<SpeakerSegment>, PythonBridgeError> {
        eprintln!("[INFO] PythonBridge: Starting Sherpa-ONNX diarization");
        eprintln!("[INFO] Audio: {:?}", audio_path);

        let mut cmd = create_hidden_command(&self.python_path);
        cmd.arg(&self.engine_path)
            .arg("--diarize-only")
            .arg("--provider").arg("sherpa-onnx")
            .arg("--audio").arg(audio_path)
            .arg("--cache-dir").arg(&self.cache_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

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

        while let Ok(Some(line)) = reader.next_line().await {
            if line.is_empty() || !line.starts_with('{') {
                continue;
            }

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

        while let Ok(Some(line)) = stderr_reader.next_line().await {
            eprintln!("[PYTHON STDERR] {}", line);
        }

        let status = child.wait().await?;
        if !status.success() {
            return Err(PythonBridgeError::ProcessError(
                format!("Python process exited with code: {:?}", status.code())
            ));
        }

        eprintln!("[INFO] PythonBridge: Diarization complete, {} segments", segments.len());
        Ok(segments)
    }

    /// Check if Python engine is available
    pub async fn check_available(&self) -> Result<bool, PythonBridgeError> {
        let output = create_hidden_command(&self.python_path)
            .arg(&self.engine_path)
            .arg("--command").arg("check_python")
            .output()
            .await?;

        Ok(output.status.success())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_speaker_segment_deserialize() {
        let json = r#"{"start": 0.0, "end": 5.5, "speaker": "SPEAKER_01"}"#;
        let segment: SpeakerSegment = serde_json::from_str(json).unwrap();
        assert_eq!(segment.start, 0.0);
        assert_eq!(segment.end, 5.5);
        assert_eq!(segment.speaker, "SPEAKER_01");
    }
}

//! Python Bridge - Sherpa-ONNX diarization interface
//!
//! Phase 4: Python is now a diarization-only microservice.
//! All transcription is handled by Rust transcribe-rs.
//!
//! This module calls the Python ai-engine solely for:
//! - Sherpa-ONNX speaker diarization

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use thiserror::Error;
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
    pub python_path: PathBuf,
    pub engine_path: PathBuf,
    /// Directory containing AI models (passed as `--cache-dir` to Python)
    pub models_dir: PathBuf,
    /// Directory for temporary audio WAV files used during diarization
    pub cache_dir: PathBuf,
}

impl PythonBridge {
    /// Create a new PythonBridge.
    ///
    /// - `models_dir`: where AI models are stored - passed as `--cache-dir` to Python
    /// - `audio_cache_dir`: where temporary WAV files are written during diarization
    pub fn new(
        python_path: &Path,
        engine_path: &Path,
        models_dir: &Path,
        audio_cache_dir: &Path,
    ) -> Self {
        Self {
            python_path: python_path.to_path_buf(),
            engine_path: engine_path.to_path_buf(),
            models_dir: models_dir.to_path_buf(),
            cache_dir: audio_cache_dir.to_path_buf(),
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
            .arg("--provider")
            .arg("sherpa-onnx")
            .arg("--audio")
            .arg(audio_path)
            .arg("--cache-dir")
            .arg(&self.models_dir)
            .env("PYTHONUNBUFFERED", "1")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(n) = num_speakers {
            cmd.arg("--num-speakers").arg(n.to_string());
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| PythonBridgeError::SpawnError(format!("Failed to spawn Python: {}", e)))?;

        let stdout = child.stdout.take().ok_or_else(|| {
            PythonBridgeError::SpawnError(
                "Failed to capture stdout from Python process (pipe not created)".to_string(),
            )
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            PythonBridgeError::SpawnError(
                "Failed to capture stderr from Python process (pipe not created)".to_string(),
            )
        })?;

        let stdout_task = tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            let mut segments = Vec::new();

            while let Ok(Some(line)) = reader.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }

                if !line.starts_with('{') {
                    eprintln!("[PYTHON STDOUT] {}", line);
                    continue;
                }

                match serde_json::from_str::<DiarizationMessage>(&line) {
                    Ok(DiarizationMessage::Segments { segments: segs }) => {
                        segments = segs;
                    }
                    Ok(DiarizationMessage::Error { error }) => {
                        return Err(PythonBridgeError::ProcessError(error));
                    }
                    Ok(DiarizationMessage::Progress { message }) => {
                        eprintln!("[DIARIZATION] {}", message);
                    }
                    Err(_) => {
                        eprintln!("[PYTHON STDOUT] {}", line);
                    }
                }
            }

            Ok::<Vec<SpeakerSegment>, PythonBridgeError>(segments)
        });

        let stderr_task = tokio::spawn(async move {
            let mut stderr_reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = stderr_reader.next_line().await {
                eprintln!("[PYTHON STDERR] {}", line);
            }
        });

        let status = child.wait().await?;

        let segments = stdout_task
            .await
            .map_err(|e| PythonBridgeError::SpawnError(format!("stdout task failed: {}", e)))??;
        stderr_task
            .await
            .map_err(|e| PythonBridgeError::SpawnError(format!("stderr task failed: {}", e)))?;

        if !status.success() {
            return Err(PythonBridgeError::ProcessError(format!(
                "Python process exited with code: {:?}",
                status.code()
            )));
        }

        eprintln!(
            "[INFO] PythonBridge: Diarization complete, {} segments",
            segments.len()
        );
        Ok(segments)
    }

    /// Check if Python engine is available
    pub async fn check_available(&self) -> Result<bool, PythonBridgeError> {
        let output = create_hidden_command(&self.python_path)
            .arg(&self.engine_path)
            .arg("--command")
            .arg("check_python")
            .output()
            .await?;

        Ok(output.status.success())
    }
}

/// Messages from Python diarization
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum DiarizationMessage {
    Segments {
        segments: Vec<SpeakerSegment>,
    },
    Error {
        error: String,
    },
    #[allow(dead_code)]
    Progress {
        message: String,
    },
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

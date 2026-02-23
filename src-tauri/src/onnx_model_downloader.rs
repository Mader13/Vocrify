//! ONNX Model Downloader for transcribe-rs
//!
//! This module provides functions to download ONNX models for:
//! - Parakeet (from blob.handy.computer)
//! - SenseVoice (from blob.handy.computer)
//! - Moonshine (from HuggingFace)
//!
//! These models are required for transcribe-rs Rust transcription engine.

use crate::whisper_engine::WhisperError;
use flate2::read::GzDecoder;
use futures_util::StreamExt;
use reqwest::Client;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use tar::Archive;

/// Progress callback type for model downloads
pub type ModelProgressCallback = Box<dyn Fn(u64, u64, f64) + Send + Sync>;

/// ONNX Model types supported by transcribe-rs
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OnnxModelType {
    /// NVIDIA Parakeet (multilingual)
    Parakeet,
    /// FunASR SenseVoice
    SenseVoice,
    /// UsefulSensors Moonshine
    Moonshine,
}

impl OnnxModelType {
    /// Get download URL for the model
    pub fn download_url(&self) -> Result<&'static str, WhisperError> {
        match self {
            OnnxModelType::Parakeet => Ok("https://blob.handy.computer/parakeet-v3-int8.tar.gz"),
            OnnxModelType::SenseVoice => Ok("https://blob.handy.computer/sense-voice-int8.tar.gz"),
            OnnxModelType::Moonshine => Err(WhisperError::ModelLoad(
                "Moonshine model requires a per-variant HuggingFace URL; \
                 use download_from_huggingface instead of download_onnx_model"
                    .to_string(),
            )),
        }
    }

    /// Get expected model directory name after extraction
    pub fn expected_dir_name(&self) -> &'static str {
        match self {
            OnnxModelType::Parakeet => "parakeet-v0.3",
            OnnxModelType::SenseVoice => "sense-voice",
            OnnxModelType::Moonshine => "moonshine",
        }
    }

    /// Get model type from model name
    pub fn from_model_name(model_name: &str) -> Option<Self> {
        if model_name.starts_with("parakeet-") {
            Some(OnnxModelType::Parakeet)
        } else if model_name.starts_with("sense-") || model_name.starts_with("sensevoice-") {
            Some(OnnxModelType::SenseVoice)
        } else if model_name.starts_with("moonshine-") {
            Some(OnnxModelType::Moonshine)
        } else {
            None
        }
    }
}

/// Download an ONNX model archive and extract it
pub async fn download_onnx_model(
    model_type: OnnxModelType,
    output_dir: &Path,
    progress_callback: Option<ModelProgressCallback>,
) -> Result<PathBuf, WhisperError> {
    let url = model_type.download_url()?;
    let expected_dir = model_type.expected_dir_name();

    eprintln!("[INFO] Downloading ONNX model from: {}", url);

    let client = Client::new();
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| WhisperError::ModelLoad(format!("Failed to download model: {}", e)))?;

    if !response.status().is_success() {
        return Err(WhisperError::ModelLoad(format!(
            "Failed to download model: HTTP {}",
            response.status()
        )));
    }

    let total_size = response
        .content_length()
        .unwrap_or(0);

    // Create output directory if needed
    std::fs::create_dir_all(output_dir)?;

    // Download to temp file first
    let temp_tar = output_dir.join("model_download.tar.gz");
    let mut temp_file = File::create(&temp_tar)?;

    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    while let Some(chunk_result) = stream.next().await {
        let chunk: Vec<u8> = chunk_result.map_err(|e| WhisperError::ModelLoad(format!("Download error: {}", e)))?.to_vec();
        downloaded += chunk.len() as u64;
        temp_file.write_all(&chunk)?;

        // Report progress
        if let Some(ref callback) = progress_callback {
            let percent = if total_size > 0 {
                (downloaded as f64 / total_size as f64) * 100.0
            } else {
                0.0
            };
            callback(downloaded, total_size, percent);
        }
    }

    eprintln!(
        "[INFO] Download complete, extracting archive ({:.1} MB)",
        downloaded / (1024 * 1024)
    );

    // Extract the archive
    let tar_gz = File::open(&temp_tar)?;
    let decoder = GzDecoder::new(tar_gz);
    let mut archive = Archive::new(decoder);

    // Extract to output directory
    archive
        .unpack(output_dir)
        .map_err(|e| WhisperError::ModelLoad(format!("Failed to extract archive: {}", e)))?;

    // Clean up temp file
    let _ = std::fs::remove_file(&temp_tar);

    // Return path to extracted model
    let model_path = output_dir.join(expected_dir);
    if model_path.exists() {
        eprintln!("[INFO] ONNX model extracted to: {:?}", model_path);
        Ok(model_path)
    } else {
        // Try to find the extracted directory
        let entries: std::fs::ReadDir = std::fs::read_dir(output_dir)
            .map_err(|e| WhisperError::ModelLoad(format!("Failed to read output dir: {}", e)))?;

        for entry in entries.flatten() {
            let path: std::path::PathBuf = entry.path();
            if path.is_dir() {
                eprintln!("[INFO] Found extracted model at: {:?}", path);
                return Ok(path);
            }
        }

        Err(WhisperError::ModelLoad(
            "Could not find extracted model directory".to_string(),
        ))
    }
}

/// Download Parakeet ONNX model for transcribe-rs
pub async fn download_parakeet_model(
    output_dir: &Path,
    progress_callback: Option<ModelProgressCallback>,
) -> Result<PathBuf, WhisperError> {
    download_onnx_model(OnnxModelType::Parakeet, output_dir, progress_callback).await
}

/// Download SenseVoice ONNX model for transcribe-rs
pub async fn download_sensevoice_model(
    output_dir: &Path,
    progress_callback: Option<ModelProgressCallback>,
) -> Result<PathBuf, WhisperError> {
    download_onnx_model(OnnxModelType::SenseVoice, output_dir, progress_callback).await
}

/// Check if an ONNX model is already downloaded
pub fn is_onnx_model_downloaded(model_type: OnnxModelType, models_dir: &Path) -> bool {
    let expected_dir = models_dir.join(model_type.expected_dir_name());
    expected_dir.exists() && expected_dir.is_dir()
}

/// Check if Parakeet model is valid (has required files)
pub fn is_parakeet_model_valid(models_dir: &Path) -> bool {
    // Check multiple possible Parakeet model directories
    let parakeet_dirs = ["parakeet-v0.3", "parakeet-tdt-0.6b-v3", "parakeet-tdt-0.6b-v3-int8"];

    for dir_name in &parakeet_dirs {
        let parakeet_dir = models_dir.join(dir_name);
        if !parakeet_dir.is_dir() {
            continue;
        }

        // Check for essential model files - multiple naming conventions
        let has_encoder = parakeet_dir.join("encoder.onnx").exists()
            || parakeet_dir.join("encoder-model.onnx").exists()
            || parakeet_dir.join("encoder-model.int8.onnx").exists()
            || parakeet_dir.join("encoder-int8.onnx").exists();
        let has_decoder = parakeet_dir.join("decoder.onnx").exists()
            || parakeet_dir.join("decoder_joint.onnx").exists()
            || parakeet_dir.join("decoder_joint-model.onnx").exists()
            || parakeet_dir.join("decoder_joint-model.int8.onnx").exists();

        if has_encoder && has_decoder {
            return true;
        }
    }

    // No valid Parakeet model found - check if we should clean up incomplete dir
    for dir_name in &parakeet_dirs {
        let parakeet_dir = models_dir.join(dir_name);
        if parakeet_dir.is_dir() {
            eprintln!("[WARN] Incomplete Parakeet model in {:?}, removing...", parakeet_dir);
            let _ = std::fs::remove_dir_all(&parakeet_dir);
        }
    }
    false
}

/// Check if SenseVoice model is valid (has required files)
pub fn is_sensevoice_model_valid(models_dir: &Path) -> bool {
    let sensevoice_dir = models_dir.join("sense-voice");
    if !sensevoice_dir.is_dir() {
        return false;
    }
    // Check for essential model file - sense-voice.onnx
    let path = sensevoice_dir.join("sense-voice.onnx");
    if !path.exists() {
        eprintln!("[WARN] Incomplete SenseVoice model (missing sense-voice.onnx), removing...");
        let _ = std::fs::remove_dir_all(&sensevoice_dir);
        return false;
    }
    true
}

/// Get Parakeet model path for transcribe-rs
pub fn get_parakeet_model_path(models_dir: &Path) -> Option<PathBuf> {
    let parakeet_dir = models_dir.join("parakeet-v0.3");
    if parakeet_dir.exists() {
        return Some(parakeet_dir);
    }

    // Also check in model directory structure
    for entry in std::fs::read_dir(models_dir).ok()?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.contains("parakeet") {
                    return Some(path);
                }
            }
        }
    }

    None
}

/// Get SenseVoice model path for transcribe-rs
pub fn get_sensevoice_model_path(models_dir: &Path) -> Option<PathBuf> {
    let sensevoice_dir = models_dir.join("sense-voice");
    if sensevoice_dir.exists() {
        return Some(sensevoice_dir);
    }

    None
}

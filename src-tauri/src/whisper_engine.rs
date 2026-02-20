//! Whisper Engine - Rust-based transcription using whisper.cpp
//!
//! This module provides GPU-accelerated transcription using whisper-rs bindings.
//! Supports multiple GPU backends: CUDA (NVIDIA), Metal (Apple Silicon), Vulkan (AMD/Intel).

use std::path::{Path, PathBuf};
use thiserror::Error;
use serde::{Deserialize, Serialize};

/// Supported device types for transcription
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DeviceType {
    Cpu,
    Cuda,
    Metal,
    Vulkan,
}

impl DeviceType {
    /// Get human-readable name for the device
    pub fn display_name(&self) -> &'static str {
        match self {
            DeviceType::Cpu => "CPU",
            DeviceType::Cuda => "NVIDIA GPU (CUDA)",
            DeviceType::Metal => "Apple Silicon (Metal)",
            DeviceType::Vulkan => "GPU (Vulkan)",
        }
    }

    /// Check if this device type uses GPU acceleration
    pub fn is_gpu(&self) -> bool {
        matches!(self, DeviceType::Cuda | DeviceType::Metal | DeviceType::Vulkan)
    }
}

/// Whisper transcription errors
#[derive(Debug, Error)]
pub enum WhisperError {
    #[error("Failed to initialize whisper context: {0}")]
    ContextInit(String),

    #[error("Failed to load model: {0}")]
    ModelLoad(String),

    #[error("Transcription failed: {0}")]
    Transcription(String),

    #[error("Audio preprocessing failed: {0}")]
    AudioPreprocessing(String),

    #[error("Model file not found: {0}")]
    ModelNotFound(String),

    #[error("Unsupported device type: {0:?}")]
    UnsupportedDevice(DeviceType),

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
pub struct TranscriptionResult {
    pub segments: Vec<TranscriptionSegment>,
    pub language: String,
    pub duration: f64,
}

/// Transcription options
#[derive(Debug, Clone)]
pub struct TranscriptionOptions {
    pub language: Option<String>,
    pub translate: bool,
    pub print_progress: bool,
    pub print_timestamps: bool,
}

impl Default for TranscriptionOptions {
    fn default() -> Self {
        Self {
            language: None, // Auto-detect
            translate: false,
            print_progress: true,
            print_timestamps: true,
        }
    }
}

/// Legacy Whisper engine surface kept for compatibility.
pub struct WhisperEngine {
    device: DeviceType,
    model_path: std::path::PathBuf,
}

impl WhisperEngine {
    pub fn new(model_path: &Path, device: DeviceType) -> Result<Self, WhisperError> {
        if !model_path.exists() {
            return Err(WhisperError::ModelNotFound(model_path.display().to_string()));
        }

        eprintln!("[WARN] rust-whisper feature is disabled, using Python fallback");
        eprintln!("[INFO] Model path: {:?}", model_path);

        Ok(Self {
            device,
            model_path: model_path.to_path_buf(),
        })
    }

    pub fn transcribe(
        &self,
        _audio: &[f32],
        _options: TranscriptionOptions,
    ) -> Result<TranscriptionResult, WhisperError> {
        Err(WhisperError::Transcription(
            "rust-whisper feature is disabled. Use Python backend instead.".to_string()
        ))
    }

    /// Get supported languages for transcription
    pub fn get_supported_languages() -> Vec<String> {
        vec![
            "en".to_string(), "zh".to_string(), "de".to_string(), "es".to_string(),
            "ru".to_string(), "ko".to_string(), "fr".to_string(), "ja".to_string(),
            "pt".to_string(), "tr".to_string(), "pl".to_string(), "ca".to_string(),
            "nl".to_string(), "ar".to_string(), "sv".to_string(), "it".to_string(),
            "id".to_string(), "hi".to_string(), "fi".to_string(), "vi".to_string(),
            "he".to_string(), "uk".to_string(), "el".to_string(), "ms".to_string(),
            "cs".to_string(), "ro".to_string(), "da".to_string(), "hu".to_string(),
            "ta".to_string(), "no".to_string(), "th".to_string(), "ur".to_string(),
            "hr".to_string(), "bg".to_string(), "lt".to_string(), "la".to_string(),
            "mi".to_string(), "ml".to_string(), "cy".to_string(), "sk".to_string(),
            "te".to_string(), "fa".to_string(), "lv".to_string(), "bn".to_string(),
            "sr".to_string(), "az".to_string(), "sl".to_string(), "kn".to_string(),
            "et".to_string(), "mk".to_string(), "br".to_string(), "eu".to_string(),
            "is".to_string(), "hy".to_string(), "ne".to_string(), "mn".to_string(),
            "bs".to_string(), "kk".to_string(), "sq".to_string(), "sw".to_string(),
            "gl".to_string(), "mr".to_string(), "pa".to_string(), "si".to_string(),
            "km".to_string(), "sn".to_string(), "yo".to_string(), "so".to_string(),
            "af".to_string(), "oc".to_string(), "ka".to_string(), "be".to_string(),
            "tg".to_string(), "sd".to_string(), "gu".to_string(), "am".to_string(),
            "yi".to_string(), "lo".to_string(), "uz".to_string(), "fo".to_string(),
            "ht".to_string(), "ps".to_string(), "tk".to_string(), "nn".to_string(),
            "mt".to_string(), "sa".to_string(), "lb".to_string(), "my".to_string(),
            "bo".to_string(), "tl".to_string(), "mg".to_string(), "as".to_string(),
            "tt".to_string(), "haw".to_string(), "ln".to_string(), "ha".to_string(),
            "ba".to_string(), "jw".to_string(), "su".to_string(),
        ]
    }

    /// Detect the best available device for transcription
    pub fn detect_best_device() -> DeviceType {
        // Priority: CUDA > Metal > Vulkan > CPU
        #[cfg(target_os = "macos")]
        {
            // On macOS, prefer Metal
            // TODO: Actually check if Metal is available
            DeviceType::Metal
        }

        #[cfg(not(target_os = "macos"))]
        {
            // On other platforms, check for CUDA first, then Vulkan
            // TODO: Actually check device availability
            // For now, default to CPU as safest option
            DeviceType::Cpu
        }
    }

    /// Get the current device type
    pub fn device(&self) -> DeviceType {
        self.device
    }

    /// Get the model path
    pub fn model_path(&self) -> &Path {
        &self.model_path
    }
}

/// Download a GGML model from HuggingFace
pub async fn download_ggml_model(
    model_name: &str,
    output_dir: &Path,
) -> Result<PathBuf, WhisperError> {
    use reqwest::Client;
    use std::fs::File;
    use std::io::Write;

    // Map model names to HuggingFace URLs
    let model_filename = match model_name {
        "tiny" | "whisper-tiny" => "ggml-tiny.bin",
        "base" | "whisper-base" => "ggml-base.bin",
        "small" | "whisper-small" => "ggml-small.bin",
        "medium" | "whisper-medium" => "ggml-medium.bin",
        "large" | "whisper-large" | "large-v1" => "ggml-large-v1.bin",
        "large-v2" => "ggml-large-v2.bin",
        "large-v3" => "ggml-large-v3.bin",
        _ => return Err(WhisperError::ModelLoad(format!("Unknown model: {}", model_name))),
    };

    let url = format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}",
        model_filename
    );

    eprintln!("[INFO] Downloading model from: {}", url);

    let client = Client::new();
    let response = client.get(&url)
        .send()
        .await
        .map_err(|e| WhisperError::ModelLoad(format!("Failed to download model: {}", e)))?;

    if !response.status().is_success() {
        return Err(WhisperError::ModelLoad(format!(
            "Failed to download model: HTTP {}",
            response.status()
        )));
    }

    // Create output directory if needed
    std::fs::create_dir_all(output_dir)?;

    let output_path = output_dir.join(model_filename);
    let mut file = File::create(&output_path)?;

    // Download with progress
    let _total_size = response.content_length().unwrap_or(0);
    let _downloaded = 0u64;
    let _last_progress = 0u64;

    let bytes = response.bytes()
        .await
        .map_err(|e| WhisperError::ModelLoad(format!("Failed to download model: {}", e)))?;

    file.write_all(&bytes)?;

    eprintln!("[INFO] Model downloaded to: {:?}", output_path);

    Ok(output_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_device_type_display() {
        assert_eq!(DeviceType::Cpu.display_name(), "CPU");
        assert_eq!(DeviceType::Cuda.display_name(), "NVIDIA GPU (CUDA)");
        assert_eq!(DeviceType::Metal.display_name(), "Apple Silicon (Metal)");
        assert_eq!(DeviceType::Vulkan.display_name(), "GPU (Vulkan)");
    }

    #[test]
    fn test_device_type_is_gpu() {
        assert!(!DeviceType::Cpu.is_gpu());
        assert!(DeviceType::Cuda.is_gpu());
        assert!(DeviceType::Metal.is_gpu());
        assert!(DeviceType::Vulkan.is_gpu());
    }

    #[test]
    fn test_supported_languages() {
        let languages = WhisperEngine::get_supported_languages();
        assert!(languages.contains(&"en".to_string()));
        assert!(languages.contains(&"ru".to_string()));
        assert!(languages.contains(&"zh".to_string()));
        assert!(languages.len() >= 90); // Whisper supports 99+ languages
    }

    #[test]
    fn test_transcription_options_default() {
        let options = TranscriptionOptions::default();
        assert!(options.language.is_none());
        assert!(!options.translate);
        assert!(options.print_progress);
    }
}

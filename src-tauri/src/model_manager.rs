//! Model Manager - Unified model management for transcription and diarization
//!
//! This module provides a unified interface for managing AI models:
//! - Download models from HuggingFace
//! - List installed models
//! - Delete models
//! - Get model paths
//!
//! Phase 3: Updated for transcribe-rs supporting:
//! - Whisper (GGML format)
//! - Parakeet (ONNX format)
//! - Moonshine (ONNX format) - Future
//! - SenseVoice (ONNX format) - Future

use std::path::{Path, PathBuf};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use thiserror::Error;
use serde::{Deserialize, Serialize};

use crate::whisper_engine::{download_ggml_model, WhisperError};

/// Model management errors
#[derive(Debug, Error)]
pub enum ModelManagerError {
    #[error("Model not found: {0}")]
    NotFound(String),

    #[error("Model already exists: {0}")]
    AlreadyExists(String),

    #[error("Download failed: {0}")]
    DownloadFailed(String),

    #[error("Delete failed: {0}")]
    DeleteFailed(String),

    #[error("Invalid model name: {0}")]
    InvalidName(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Whisper error: {0}")]
    Whisper(#[from] WhisperError),
}

/// Model type enumeration
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelType {
    Whisper,
    Parakeet,
    Moonshine,  // Phase 3: Added for transcribe-rs
    SenseVoice, // Phase 3: Added for transcribe-rs
    Diarization,
}

impl ModelType {
    pub fn display_name(&self) -> &'static str {
        match self {
            ModelType::Whisper => "Whisper",
            ModelType::Parakeet => "Parakeet",
            ModelType::Moonshine => "Moonshine",
            ModelType::SenseVoice => "SenseVoice",
            ModelType::Diarization => "Diarization",
        }
    }

    /// Check if this model type is supported by transcribe-rs
    pub fn is_transcribe_rs_supported(&self) -> bool {
        matches!(self, ModelType::Whisper | ModelType::Parakeet | ModelType::Moonshine | ModelType::SenseVoice)
    }
}

/// Model information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub name: String,
    pub model_type: ModelType,
    pub size_mb: u64,
    pub installed: bool,
    pub path: Option<PathBuf>,
}

/// Download progress callback
pub type ProgressCallback = Box<dyn Fn(u64, u64, f64) + Send + Sync>;

/// Model manager for handling model lifecycle
pub struct ModelManager {
    models_dir: PathBuf,
    downloads: Arc<Mutex<HashMap<String, tokio::task::JoinHandle<()>>>>,
}

impl ModelManager {
    /// Create a new ModelManager
    pub fn new(models_dir: &Path) -> Result<Self, ModelManagerError> {
        // Ensure models directory exists
        std::fs::create_dir_all(models_dir)?;

        eprintln!("[INFO] ModelManager initialized with directory: {:?}", models_dir);

        Ok(Self {
            models_dir: models_dir.to_path_buf(),
            downloads: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    /// List all installed models
    pub fn list_models(&self) -> Result<Vec<ModelInfo>, ModelManagerError> {
        let mut models = Vec::new();

        if !self.models_dir.exists() {
            return Ok(models);
        }

        // Individual diarization components to skip
        let skip_individual: std::collections::HashSet<&str> = std::collections::HashSet::from([
            "pyannote-segmentation-3.0",
            "pyannote-embedding-3.0",
            "sherpa-onnx-segmentation",
            "sherpa-onnx-embedding",
        ]);

        for entry in std::fs::read_dir(&self.models_dir)? {
            let entry = entry?;
            let path = entry.path();

            if !path.is_dir() {
                continue;
            }

            let model_name = entry.file_name().to_string_lossy().to_string();

            // Skip individual diarization components
            if skip_individual.contains(model_name.as_str()) {
                continue;
            }

            // Calculate size
            let size_mb = self.calculate_dir_size(&path)?;

            // Detect model type
            let model_type = self.detect_model_type(&model_name);

            if let Some(model_type) = model_type {
                // Normalize name
                let display_name = self.normalize_model_name(&model_name, model_type);

                models.push(ModelInfo {
                    name: display_name,
                    model_type,
                    size_mb,
                    installed: true,
                    path: Some(path),
                });
            }
        }

        // Check for diarization models
        self.add_diarization_models(&mut models)?;

        Ok(models)
    }

    /// Get path to a specific model
    pub fn get_model_path(&self, model_name: &str) -> Result<PathBuf, ModelManagerError> {
        // Try direct path first
        let direct_path = self.models_dir.join(model_name);
        if direct_path.exists() {
            return Ok(direct_path);
        }

        // Try with whisper- prefix for short names
        if !model_name.starts_with("whisper-") && !model_name.starts_with("distil-") {
            let whisper_path = self.models_dir.join(format!("whisper-{}", model_name));
            if whisper_path.exists() {
                return Ok(whisper_path);
            }
        }

        // Try GGML file directly
        let ggml_name = self.model_name_to_ggml(model_name);
        let ggml_path = self.models_dir.join(&ggml_name);
        if ggml_path.exists() {
            return Ok(ggml_path);
        }

        Err(ModelManagerError::NotFound(model_name.to_string()))
    }

    /// Download a model
    pub async fn download_model(
        &self,
        model_name: &str,
        model_type: ModelType,
        progress: Option<ProgressCallback>,
    ) -> Result<PathBuf, ModelManagerError> {
        eprintln!("[INFO] Downloading model: {} (type: {:?})", model_name, model_type);

        // Check if already downloading
        {
            let downloads = self.downloads.lock().await;
            if downloads.contains_key(model_name) {
                return Err(ModelManagerError::AlreadyExists(
                    format!("Model {} is already being downloaded", model_name)
                ));
            }
        }

        match model_type {
            ModelType::Whisper => {
                // Download GGML model
                let path = download_ggml_model(model_name, &self.models_dir).await?;

                if let Some(callback) = progress {
                    callback(100, 100, 100.0);
                }

                Ok(path)
            }
            ModelType::Parakeet => {
                // Phase 3: Download Parakeet ONNX model from blob.handy.computer
                let path = download_parakeet_model(model_name, &self.models_dir, progress).await?;
                Ok(path)
            }
            ModelType::Moonshine => {
                // Phase 3: Moonshine models downloaded from HuggingFace
                Err(ModelManagerError::DownloadFailed(
                    "Moonshine models must be downloaded manually from HuggingFace".to_string()
                ))
            }
            ModelType::SenseVoice => {
                // Phase 3: SenseVoice models downloaded from blob.handy.computer
                let path = download_sensevoice_model(model_name, &self.models_dir, progress).await?;
                Ok(path)
            }
            ModelType::Diarization => {
                // Diarization models are handled by Python backend
                Err(ModelManagerError::DownloadFailed(
                    "Diarization models must be downloaded via Python backend".to_string()
                ))
            }
        }
    }

    /// Delete a model
    pub fn delete_model(&self, model_name: &str) -> Result<(), ModelManagerError> {
        eprintln!("[INFO] Deleting model: {}", model_name);

        // Handle diarization models specially
        if model_name == "pyannote-diarization" {
            let seg_path = self.models_dir.join("pyannote-segmentation-3.0");
            let emb_path = self.models_dir.join("pyannote-embedding-3.0");

            if seg_path.exists() {
                std::fs::remove_dir_all(&seg_path)?;
            }
            if emb_path.exists() {
                std::fs::remove_dir_all(&emb_path)?;
            }

            eprintln!("[INFO] Deleted pyannote-diarization components");
            return Ok(());
        }

        if model_name == "sherpa-onnx-diarization" {
            // Check parent directory first (current structure)
            let sherpa_parent = self.models_dir.join("sherpa-onnx-diarization");

            if sherpa_parent.exists() {
                std::fs::remove_dir_all(&sherpa_parent)?;
                eprintln!("[INFO] Deleted sherpa-onnx-diarization directory");
                return Ok(());
            }

            // Fallback: Check individual directories (old structure)
            let seg_path = self.models_dir.join("sherpa-onnx-segmentation");
            let emb_path = self.models_dir.join("sherpa-onnx-embedding");

            if seg_path.exists() {
                std::fs::remove_dir_all(&seg_path)?;
            }
            if emb_path.exists() {
                std::fs::remove_dir_all(&emb_path)?;
            }

            eprintln!("[INFO] Deleted sherpa-onnx-diarization components");
            return Ok(());
        }

        // Regular model deletion
        let model_path = self.get_model_path(model_name)?;

        if model_path.is_dir() {
            std::fs::remove_dir_all(&model_path)?;
        } else {
            std::fs::remove_file(&model_path)?;
        }

        eprintln!("[INFO] Deleted model: {}", model_name);
        Ok(())
    }

    /// Cancel a model download
    pub async fn cancel_download(&self, model_name: &str) -> Result<(), ModelManagerError> {
        let mut downloads = self.downloads.lock().await;

        if let Some(handle) = downloads.remove(model_name) {
            handle.abort();
            eprintln!("[INFO] Cancelled download: {}", model_name);
        }

        Ok(())
    }

    /// Get total disk usage of all models
    pub fn get_disk_usage(&self) -> Result<u64, ModelManagerError> {
        let mut total_size = 0u64;

        if !self.models_dir.exists() {
            return Ok(0);
        }

        for entry in std::fs::read_dir(&self.models_dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_dir() {
                total_size += self.calculate_dir_size(&path)?;
            } else {
                total_size += entry.metadata()?.len();
            }
        }

        Ok(total_size / (1024 * 1024)) // Convert to MB
    }

    // Helper methods

    fn calculate_dir_size(&self, dir: &Path) -> Result<u64, ModelManagerError> {
        let mut total_size = 0u64;

        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                if let Ok(metadata) = entry.metadata() {
                    total_size += metadata.len();
                }
            }
        }

        Ok(total_size / (1024 * 1024)) // Convert to MB
    }

    fn detect_model_type(&self, model_name: &str) -> Option<ModelType> {
        // Whisper models
        if model_name.starts_with("whisper-") {
            return Some(ModelType::Whisper);
        }

        if ["tiny", "base", "small", "medium", "large", "large-v2", "large-v3"].contains(&model_name) {
            return Some(ModelType::Whisper);
        }

        if model_name.starts_with("distil-") {
            return Some(ModelType::Whisper);
        }

        // Phase 3: Parakeet models for transcribe-rs
        if model_name.starts_with("parakeet-") {
            return Some(ModelType::Parakeet);
        }

        // Phase 3: Moonshine models for transcribe-rs
        if model_name.starts_with("moonshine-") {
            return Some(ModelType::Moonshine);
        }

        // Phase 3: SenseVoice models for transcribe-rs
        if model_name.starts_with("sense-") || model_name.starts_with("sensevoice-") {
            return Some(ModelType::SenseVoice);
        }

        None
    }

    fn normalize_model_name(&self, model_name: &str, model_type: ModelType) -> String {
        match model_type {
            ModelType::Whisper if !model_name.starts_with("whisper-") && !model_name.starts_with("distil-") => {
                format!("whisper-{}", model_name)
            }
            _ => model_name.to_string(),
        }
    }

    fn model_name_to_ggml(&self, model_name: &str) -> String {
        match model_name {
            "tiny" | "whisper-tiny" => "ggml-tiny.bin".to_string(),
            "base" | "whisper-base" => "ggml-base.bin".to_string(),
            "small" | "whisper-small" => "ggml-small.bin".to_string(),
            "medium" | "whisper-medium" => "ggml-medium.bin".to_string(),
            "large" | "whisper-large" | "large-v1" => "ggml-large-v1.bin".to_string(),
            "large-v2" => "ggml-large-v2.bin".to_string(),
            "large-v3" => "ggml-large-v3.bin".to_string(),
            _ => format!("ggml-{}.bin", model_name.replace("whisper-", "")),
        }
    }

    fn add_diarization_models(&self, models: &mut Vec<ModelInfo>) -> Result<(), ModelManagerError> {
        // PyAnnote diarization
        let seg_path = self.models_dir.join("pyannote-segmentation-3.0");
        let emb_path = self.models_dir.join("pyannote-embedding-3.0");

        if seg_path.exists() && emb_path.exists() {
            let mut total_size = 0u64;
            for p in [&seg_path, &emb_path] {
                total_size += self.calculate_dir_size(p)?;
            }

            models.push(ModelInfo {
                name: "pyannote-diarization".to_string(),
                model_type: ModelType::Diarization,
                size_mb: total_size,
                installed: true,
                path: None,
            });
        }

        // Sherpa-ONNX diarization
        let seg_path = self.models_dir.join("sherpa-onnx-segmentation");
        let emb_path = self.models_dir.join("sherpa-onnx-embedding");

        if seg_path.exists() && emb_path.exists() {
            let mut total_size = 0u64;
            for p in [&seg_path, &emb_path] {
                total_size += self.calculate_dir_size(p)?;
            }

            models.push(ModelInfo {
                name: "sherpa-onnx-diarization".to_string(),
                model_type: ModelType::Diarization,
                size_mb: total_size,
                installed: true,
                path: None,
            });
        }

        Ok(())
    }
}

/// Download Parakeet ONNX model from blob.handy.computer with streaming progress
/// Phase 3: Added for transcribe-rs Parakeet engine support
pub async fn download_parakeet_model(
    model_name: &str,
    output_dir: &Path,
    progress: Option<ProgressCallback>,
) -> Result<PathBuf, ModelManagerError> {
    use reqwest::Client;
    use flate2::read::GzDecoder;
    use tar::Archive;
    use futures_util::StreamExt;

    // Map model names to download URLs
    let (url, target_dir_name) = match model_name {
        "parakeet-tdt-0.6b-v3" | "parakeet-v3" => {
            ("https://blob.handy.computer/parakeet-v3-int8.tar.gz", "parakeet-tdt-0.6b-v3-int8")
        }
        "parakeet-tdt-0.6b-v3-int8" => {
            ("https://blob.handy.computer/parakeet-v3-int8.tar.gz", "parakeet-tdt-0.6b-v3-int8")
        }
        _ => {
            return Err(ModelManagerError::InvalidName(
                format!("Unknown Parakeet model: {}. Supported: parakeet-tdt-0.6b-v3", model_name)
            ));
        }
    };

    eprintln!("[INFO] Downloading Parakeet model from: {}", url);

    let client = Client::new();
    let response = client.get(url)
        .send()
        .await
        .map_err(|e| ModelManagerError::DownloadFailed(format!("Failed to download model: {}", e)))?;

    if !response.status().is_success() {
        return Err(ModelManagerError::DownloadFailed(format!(
            "Failed to download model: HTTP {}",
            response.status()
        )));
    }

    let total_size = response.content_length().unwrap_or(0);
    let total_mb = total_size / (1024 * 1024);
    eprintln!("[INFO] Model size: {} MB", total_mb);

    // Download with streaming progress
    let mut downloaded: u64 = 0;
    let mut last_progress_time = std::time::Instant::now();
    let mut last_downloaded: u64 = 0;
    let mut buffer = Vec::with_capacity(total_size as usize);
    
    let mut stream = response.bytes_stream();
    
    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result
            .map_err(|e| ModelManagerError::DownloadFailed(format!("Download stream error: {}", e)))?;
        
        buffer.extend_from_slice(&chunk);
        downloaded += chunk.len() as u64;
        
        // Update progress every 500ms to avoid overwhelming the UI
        let now = std::time::Instant::now();
        if now.duration_since(last_progress_time).as_millis() >= 500 || downloaded == total_size {
            let elapsed_secs = now.duration_since(last_progress_time).as_secs_f64();
            let bytes_since_last = downloaded - last_downloaded;
            let speed_mb_s = if elapsed_secs > 0.0 {
                (bytes_since_last as f64) / (1024.0 * 1024.0) / elapsed_secs
            } else {
                0.0
            };
            
            let percent = if total_size > 0 {
                (downloaded as f64 / total_size as f64) * 100.0
            } else {
                0.0
            };
            
            eprintln!("[INFO] Download progress: {:.1}% ({} MB / {} MB) @ {:.2} MB/s", 
                     percent, downloaded / (1024 * 1024), total_mb, speed_mb_s);
            
            if let Some(ref callback) = progress {
                callback(downloaded, total_size, percent);
            }
            
            last_progress_time = now;
            last_downloaded = downloaded;
        }
    }

    // Create output directory
    let target_dir = output_dir.join(target_dir_name);
    std::fs::create_dir_all(&target_dir)?;

    // Extract tarball
    eprintln!("[INFO] Extracting model to: {:?}", target_dir);
    let tar = GzDecoder::new(&buffer[..]);
    let mut archive = Archive::new(tar);
    archive.unpack(&target_dir)
        .map_err(|e| ModelManagerError::DownloadFailed(format!("Failed to extract model: {}", e)))?;

    // Final progress update
    if let Some(callback) = progress {
        callback(total_size, total_size, 100.0);
    }

    eprintln!("[INFO] Parakeet model downloaded and extracted to: {:?}", target_dir);
    Ok(target_dir)
}

/// Download SenseVoice ONNX model from blob.handy.computer with streaming progress
/// Phase 3: Added for transcribe-rs SenseVoice engine support
pub async fn download_sensevoice_model(
    model_name: &str,
    output_dir: &Path,
    progress: Option<ProgressCallback>,
) -> Result<PathBuf, ModelManagerError> {
    use reqwest::Client;
    use flate2::read::GzDecoder;
    use tar::Archive;
    use futures_util::StreamExt;

    // Map model names to download URLs
    let (url, target_dir_name) = match model_name {
        "sense-voice" | "sense-voice-int8" => {
            ("https://blob.handy.computer/sense-voice-int8.tar.gz", "sense-voice")
        }
        _ => {
            return Err(ModelManagerError::InvalidName(
                format!("Unknown SenseVoice model: {}. Supported: sense-voice-int8", model_name)
            ));
        }
    };

    eprintln!("[INFO] Downloading SenseVoice model from: {}", url);

    let client = Client::new();
    let response = client.get(url)
        .send()
        .await
        .map_err(|e| ModelManagerError::DownloadFailed(format!("Failed to download model: {}", e)))?;

    if !response.status().is_success() {
        return Err(ModelManagerError::DownloadFailed(format!(
            "Failed to download model: HTTP {}",
            response.status()
        )));
    }

    let total_size = response.content_length().unwrap_or(0);
    let total_mb = total_size / (1024 * 1024);
    eprintln!("[INFO] Model size: {} MB", total_mb);

    // Download with streaming progress
    let mut downloaded: u64 = 0;
    let mut last_progress_time = std::time::Instant::now();
    let mut last_downloaded: u64 = 0;
    let mut buffer = Vec::with_capacity(total_size as usize);
    
    let mut stream = response.bytes_stream();
    
    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result
            .map_err(|e| ModelManagerError::DownloadFailed(format!("Download stream error: {}", e)))?;
        
        buffer.extend_from_slice(&chunk);
        downloaded += chunk.len() as u64;
        
        // Update progress every 500ms to avoid overwhelming the UI
        let now = std::time::Instant::now();
        if now.duration_since(last_progress_time).as_millis() >= 500 || downloaded == total_size {
            let elapsed_secs = now.duration_since(last_progress_time).as_secs_f64();
            let bytes_since_last = downloaded - last_downloaded;
            let speed_mb_s = if elapsed_secs > 0.0 {
                (bytes_since_last as f64) / (1024.0 * 1024.0) / elapsed_secs
            } else {
                0.0
            };
            
            let percent = if total_size > 0 {
                (downloaded as f64 / total_size as f64) * 100.0
            } else {
                0.0
            };
            
            eprintln!("[INFO] Download progress: {:.1}% ({} MB / {} MB) @ {:.2} MB/s", 
                     percent, downloaded / (1024 * 1024), total_mb, speed_mb_s);
            
            if let Some(ref callback) = progress {
                callback(downloaded, total_size, percent);
            }
            
            last_progress_time = now;
            last_downloaded = downloaded;
        }
    }

    // Create output directory
    let target_dir = output_dir.join(target_dir_name);
    std::fs::create_dir_all(&target_dir)?;

    // Extract tarball
    eprintln!("[INFO] Extracting model to: {:?}", target_dir);
    let tar = GzDecoder::new(&buffer[..]);
    let mut archive = Archive::new(tar);
    archive.unpack(&target_dir)
        .map_err(|e| ModelManagerError::DownloadFailed(format!("Failed to extract model: {}", e)))?;

    // Final progress update
    if let Some(callback) = progress {
        callback(total_size, total_size, 100.0);
    }

    eprintln!("[INFO] SenseVoice model downloaded and extracted to: {:?}", target_dir);
    Ok(target_dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_test_manager() -> (ModelManager, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let manager = ModelManager::new(temp_dir.path()).unwrap();
        (manager, temp_dir)
    }

    #[test]
    fn test_model_type_display() {
        assert_eq!(ModelType::Whisper.display_name(), "Whisper");
        assert_eq!(ModelType::Parakeet.display_name(), "Parakeet");
        assert_eq!(ModelType::Diarization.display_name(), "Diarization");
    }

    #[test]
    fn test_list_models_empty() {
        let (manager, _temp) = create_test_manager();
        let models = manager.list_models().unwrap();
        assert!(models.is_empty());
    }

    #[test]
    fn test_list_models_with_whisper() {
        let (manager, temp_dir) = create_test_manager();

        // Create a fake whisper model
        let whisper_path = temp_dir.path().join("whisper-base");
        std::fs::create_dir_all(&whisper_path).unwrap();
        std::fs::write(whisper_path.join("model.bin"), vec![0u8; 1024 * 1024]).unwrap();

        let models = manager.list_models().unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].name, "whisper-base");
        assert_eq!(models[0].model_type, ModelType::Whisper);
    }

    #[test]
    fn test_get_model_path() {
        let (manager, temp_dir) = create_test_manager();

        // Create a model
        let model_path = temp_dir.path().join("whisper-base");
        std::fs::create_dir_all(&model_path).unwrap();

        // Should find by full name
        let found = manager.get_model_path("whisper-base").unwrap();
        assert_eq!(found, model_path);

        // Should find by short name
        let found = manager.get_model_path("base").unwrap();
        assert_eq!(found, model_path);
    }

    #[test]
    fn test_delete_model() {
        let (manager, temp_dir) = create_test_manager();

        // Create a model
        let model_path = temp_dir.path().join("whisper-base");
        std::fs::create_dir_all(&model_path).unwrap();

        // Delete it
        manager.delete_model("whisper-base").unwrap();

        // Should be gone
        assert!(!model_path.exists());
    }

    #[test]
    fn test_diarization_models() {
        let (manager, temp_dir) = create_test_manager();

        // Create pyannote diarization components
        let seg_path = temp_dir.path().join("pyannote-segmentation-3.0");
        let emb_path = temp_dir.path().join("pyannote-embedding-3.0");
        std::fs::create_dir_all(&seg_path).unwrap();
        std::fs::create_dir_all(&emb_path).unwrap();
        std::fs::write(seg_path.join("model.bin"), vec![0u8; 1024 * 1024]).unwrap();
        std::fs::write(emb_path.join("model.bin"), vec![0u8; 1024 * 1024]).unwrap();

        let models = manager.list_models().unwrap();
        assert_eq!(models.len(), 1);

        let diarization = &models[0];
        assert_eq!(diarization.name, "pyannote-diarization");
        assert_eq!(diarization.model_type, ModelType::Diarization);
        assert!(diarization.path.is_none());
    }

    #[test]
    fn test_disk_usage() {
        let (manager, temp_dir) = create_test_manager();

        // Create a model with 2MB
        let model_path = temp_dir.path().join("whisper-base");
        std::fs::create_dir_all(&model_path).unwrap();
        std::fs::write(model_path.join("model.bin"), vec![0u8; 2 * 1024 * 1024]).unwrap();

        let usage = manager.get_disk_usage().unwrap();
        assert_eq!(usage, 2);
    }
}

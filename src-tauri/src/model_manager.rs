//! Model Manager - Unified model management for transcription and diarization
//!
//! This module provides a unified interface for managing AI models:
//! - Download models from HuggingFace
//! - List installed models
//! - Delete models
//! - Get model paths

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
    Diarization,
}

impl ModelType {
    pub fn display_name(&self) -> &'static str {
        match self {
            ModelType::Whisper => "Whisper",
            ModelType::Parakeet => "Parakeet",
            ModelType::Diarization => "Diarization",
        }
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
            ModelType::Parakeet | ModelType::Diarization => {
                // These are handled by Python backend for now
                Err(ModelManagerError::DownloadFailed(
                    format!("{:?} models must be downloaded via Python backend", model_type)
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
        if model_name.starts_with("whisper-") {
            return Some(ModelType::Whisper);
        }

        if ["tiny", "base", "small", "medium", "large", "large-v2", "large-v3"].contains(&model_name) {
            return Some(ModelType::Whisper);
        }

        if model_name.starts_with("distil-") {
            return Some(ModelType::Whisper);
        }

        if model_name.starts_with("parakeet-") {
            return Some(ModelType::Parakeet);
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

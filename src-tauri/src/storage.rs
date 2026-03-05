//! Storage Module - Save/load transcription data to files
//!
//! This module provides persistent storage for transcription tasks using JSON files.
//! Each task is stored as a separate JSON file with an index file for metadata.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::AppError;
use crate::types::{TranscriptionSegment, SpeakerTurn};

const STORAGE_LOCATION_KEY: &str = "transcriptionDirectory";

/// Alias for backward compatibility with existing serialized data
pub type TaskSegment = TranscriptionSegment;

/// Metadata for a transcription task (stored in index)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskMetadata {
    pub id: String,
    pub file_name: String,
    pub file_path: String,
    pub status: String,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub duration: Option<f64>,
    pub segment_count: Option<usize>,
    pub has_result: bool,
    pub file_size_bytes: u64,
}

/// Index file containing metadata for all transcription tasks
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexFile {
    pub version: u32,
    pub last_updated: String,
    pub tasks: Vec<TaskMetadata>,
}

impl IndexFile {
    const CURRENT_VERSION: u32 = 1;

    fn new() -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Self {
            version: Self::CURRENT_VERSION,
            last_updated: now,
            tasks: Vec::new(),
        }
    }
}

/// Storage information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageInfo {
    pub directory: String,
    pub task_count: usize,
    pub total_size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageLocation {
    pub directory: String,
    pub is_default: bool,
}

/// Complete transcription task data
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionTask {
    pub id: String,
    #[serde(default)]
    pub file_path: Option<String>,
    pub file_name: String,
    #[serde(default)]
    pub file_size: u64,
    pub status: String,
    #[serde(default)]
    pub progress: f64,
    #[serde(default)]
    pub stage: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub options: TaskOptions,
    pub result: Option<TaskResult>,
    pub error: Option<String>,
    #[serde(default)]
    pub metrics: Option<serde_json::Value>,
    #[serde(default)]
    pub streaming_segments: Option<Vec<TaskSegment>>,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub archived_at: Option<String>,
    #[serde(default)]
    pub archive_mode: Option<String>,
    #[serde(default)]
    pub audio_path: Option<String>,
    #[serde(default)]
    pub archive_size: Option<u64>,
    #[serde(default)]
    pub managed_copy_path: Option<String>,
    #[serde(default)]
    pub managed_copy_size: Option<u64>,
    #[serde(default)]
    pub managed_copy_status: Option<String>,
    #[serde(default)]
    pub managed_copy_error: Option<String>,
    #[serde(default)]
    pub managed_copy_created_at: Option<String>,
    #[serde(default)]
    pub video_deleted: Option<bool>,
    #[serde(default)]
    pub last_progress_update: Option<u64>,
    #[serde(default)]
    pub speaker_name_map: Option<HashMap<String, String>>,
}

/// Transcription options
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskOptions {
    pub model: String,
    pub device: String,
    pub language: String,
    pub enable_diarization: bool,
    pub diarization_provider: Option<String>,
    pub num_speakers: i32,
    #[serde(default)]
    pub audio_profile: Option<String>,
}

/// Transcription result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskResult {
    pub segments: Vec<TaskSegment>,
    pub language: String,
    pub duration: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker_turns: Option<Vec<SpeakerTurn>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker_segments: Option<Vec<TaskSegment>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metrics: Option<serde_json::Value>,
}

/// A single transcription segment - using TranscriptionSegment from crate::types
// (TaskSegment is a type alias defined above)

/// A speaker turn - using SpeakerTurn from crate::types

/// Get the transcription storage directory
pub async fn get_transcription_dir(app: AppHandle) -> Result<String, AppError> {
    resolve_transcription_dir(&app)
}

fn get_default_transcription_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| {
        AppError::IoError(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Failed to get app data directory: {}", e),
        ))
    })?;

    Ok(app_data_dir.join("Vocrify").join("transcriptions"))
}

fn load_storage_location_from_store(app: &AppHandle) -> Result<Option<PathBuf>, AppError> {
    let store_path = crate::store_io::get_store_path(app);
    let store_data = crate::store_io::load_store_data(&store_path)?;

    let path = store_data
        .get(STORAGE_LOCATION_KEY)
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);

    Ok(path)
}

fn persist_storage_location_to_store(app: &AppHandle, directory: &Path) -> Result<(), AppError> {
    let store_path = crate::store_io::get_store_path(app);
    let mut store_data = crate::store_io::load_store_data(&store_path)?;

    if !store_data.is_object() {
        store_data = serde_json::json!({});
    }

    if let Some(store_object) = store_data.as_object_mut() {
        store_object.insert(
            STORAGE_LOCATION_KEY.to_string(),
            serde_json::Value::String(directory.to_string_lossy().to_string()),
        );
    }

    crate::store_io::save_store_data(&store_path, &store_data)
}

fn ensure_directory_exists(path: &Path) -> Result<(), AppError> {
    fs::create_dir_all(path).map_err(|e| {
        AppError::IoError(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("Failed to create transcriptions directory: {}", e),
        ))
    })
}

fn resolve_transcription_dir(app: &AppHandle) -> Result<String, AppError> {
    let default_dir = get_default_transcription_dir(app)?;
    let configured = load_storage_location_from_store(app)?;

    let target_dir = if let Some(directory) = configured {
        let dir_str = directory.to_string_lossy().to_string();
        crate::path_validation::validate_scoped_storage_directory_path(app, &dir_str)?
    } else {
        default_dir
    };

    ensure_directory_exists(&target_dir)?;

    Ok(target_dir.to_string_lossy().to_string())
}

pub async fn get_storage_location(app: AppHandle) -> Result<StorageLocation, AppError> {
    let default_dir = get_default_transcription_dir(&app)?;
    let configured = load_storage_location_from_store(&app)?;

    let resolved_dir = if let Some(directory) = configured {
        let dir_str = directory.to_string_lossy().to_string();
        crate::path_validation::validate_scoped_storage_directory_path(&app, &dir_str)?
    } else {
        default_dir
    };

    ensure_directory_exists(&resolved_dir)?;

    let is_default = resolved_dir == get_default_transcription_dir(&app)?;

    Ok(StorageLocation {
        directory: resolved_dir.to_string_lossy().to_string(),
        is_default,
    })
}

pub async fn set_storage_location(
    app: AppHandle,
    directory: String,
) -> Result<StorageLocation, AppError> {
    let normalized = crate::path_validation::validate_scoped_storage_directory_path(&app, &directory)?;
    ensure_directory_exists(&normalized)?;
    persist_storage_location_to_store(&app, &normalized)?;

    let is_default = normalized == get_default_transcription_dir(&app)?;

    Ok(StorageLocation {
        directory: normalized.to_string_lossy().to_string(),
        is_default,
    })
}

pub async fn validate_storage_location(app: AppHandle, directory: String) -> Result<String, AppError> {
    let normalized = crate::path_validation::validate_scoped_storage_directory_path(&app, &directory)?;
    ensure_directory_exists(&normalized)?;
    Ok(normalized.to_string_lossy().to_string())
}

pub async fn open_storage_location(app: AppHandle) -> Result<(), AppError> {
    let directory = resolve_transcription_dir(&app)?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&directory)
            .spawn()
            .map_err(AppError::IoError)?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&directory)
            .spawn()
            .map_err(AppError::IoError)?;
    }

    #[cfg(target_os = "linux")]
    {
        let open_result = std::process::Command::new("xdg-open").arg(&directory).spawn();

        if open_result.is_err() {
            std::process::Command::new("nautilus")
                .arg(&directory)
                .spawn()
                .map_err(AppError::IoError)?;
        }
    }

    Ok(())
}

/// Save a transcription task to file
pub async fn save_transcription(app: AppHandle, task: TranscriptionTask) -> Result<(), AppError> {
    let transcriptions_dir = PathBuf::from(get_transcription_dir(app).await?);
    let task_file = transcriptions_dir.join(format!("{}.json", task.id));
    let index_file = transcriptions_dir.join("index.json");

    // Create metadata
    let duration = task.result.as_ref().map(|r| r.duration);
    let segment_count = task.result.as_ref().map(|r| r.segments.len());

    let metadata = TaskMetadata {
        id: task.id.clone(),
        file_name: task.file_name.clone(),
        file_path: task.file_path.clone().unwrap_or_default(),
        status: task.status.clone(),
        created_at: task.created_at.clone(),
        completed_at: task.completed_at.clone(),
        duration,
        segment_count,
        has_result: task.result.is_some(),
        file_size_bytes: task.file_size,
    };

    // Atomic write for task file
    let temp_file = transcriptions_dir.join(format!("{}.tmp", task.id));
    let task_json = serde_json::to_string_pretty(&task)
        .map_err(|e| AppError::JsonError(e))?;
    fs::write(&temp_file, task_json)
        .map_err(|e| AppError::IoError(e))?;
    fs::rename(&temp_file, &task_file)
        .map_err(|e| AppError::IoError(e))?;

    // Update index
    let mut index = if index_file.exists() {
        let index_json = fs::read_to_string(&index_file)
            .map_err(|e| AppError::IoError(e))?;
        serde_json::from_str::<IndexFile>(&index_json)
            .map_err(|e| AppError::JsonError(e))?
    } else {
        IndexFile::new()
    };

    // Update or add metadata
    if let Some(pos) = index.tasks.iter().position(|t| t.id == task.id) {
        index.tasks[pos] = metadata;
    } else {
        index.tasks.push(metadata);
    }

    // Update timestamp
    index.last_updated = chrono::Utc::now().to_rfc3339();

    // Atomic write for index
    let temp_index = transcriptions_dir.join("index.tmp");
    let index_json = serde_json::to_string_pretty(&index)
        .map_err(|e| AppError::JsonError(e))?;
    fs::write(&temp_index, index_json)
        .map_err(|e| AppError::IoError(e))?;
    fs::rename(&temp_index, &index_file)
        .map_err(|e| AppError::IoError(e))?;

    Ok(())
}

/// Load a transcription task from file
pub async fn load_transcription(app: AppHandle, task_id: String) -> Result<TranscriptionTask, AppError> {
    let transcriptions_dir = PathBuf::from(get_transcription_dir(app).await?);
    let task_file = transcriptions_dir.join(format!("{}.json", task_id));

    if !task_file.exists() {
        return Err(AppError::NotFound(format!(
            "Transcription task not found: {}",
            task_id
        )));
    }

    let task_json = fs::read_to_string(&task_file)
        .map_err(|e| AppError::IoError(e))?;
    let task = serde_json::from_str::<TranscriptionTask>(&task_json)
        .map_err(|e| AppError::JsonError(e))?;

    Ok(task)
}

/// Delete a transcription task file
pub async fn delete_transcription(app: AppHandle, task_id: String) -> Result<(), AppError> {
    let transcriptions_dir = PathBuf::from(get_transcription_dir(app).await?);
    let task_file = transcriptions_dir.join(format!("{}.json", task_id));
    let index_file = transcriptions_dir.join("index.json");

    // Delete task file
    if task_file.exists() {
        fs::remove_file(&task_file)
            .map_err(|e| AppError::IoError(e))?;
    }

    // Update index
    if index_file.exists() {
        let mut index = {
            let index_json = fs::read_to_string(&index_file)
                .map_err(|e| AppError::IoError(e))?;
            serde_json::from_str::<IndexFile>(&index_json)
                .map_err(|e| AppError::JsonError(e))?
        };

        // Remove task from index
        index.tasks.retain(|t| t.id != task_id);

        // Update timestamp
        index.last_updated = chrono::Utc::now().to_rfc3339();

        // Atomic write for index
        let temp_index = transcriptions_dir.join("index.tmp");
        let index_json = serde_json::to_string_pretty(&index)
            .map_err(|e| AppError::JsonError(e))?;
        fs::write(&temp_index, index_json)
            .map_err(|e| AppError::IoError(e))?;
        fs::rename(&temp_index, &index_file)
            .map_err(|e| AppError::IoError(e))?;
    }

    Ok(())
}

/// List all transcription metadata
pub async fn list_transcriptions(app: AppHandle) -> Result<Vec<TaskMetadata>, AppError> {
    let transcriptions_dir = PathBuf::from(get_transcription_dir(app).await?);
    let index_file = transcriptions_dir.join("index.json");

    if !index_file.exists() {
        return Ok(Vec::new());
    }

    let index_json = fs::read_to_string(&index_file)
        .map_err(|e| AppError::IoError(e))?;
    let index = serde_json::from_str::<IndexFile>(&index_json)
        .map_err(|e| AppError::JsonError(e))?;

    Ok(index.tasks)
}

/// Get storage information
pub async fn get_storage_info(app: AppHandle) -> Result<StorageInfo, AppError> {
    let transcriptions_dir = PathBuf::from(get_transcription_dir(app).await?);
    let index_file = transcriptions_dir.join("index.json");

    // Get task count from index
    let task_count = if index_file.exists() {
        let index_json = fs::read_to_string(&index_file)
            .map_err(|e| AppError::IoError(e))?;
        let index = serde_json::from_str::<IndexFile>(&index_json)
            .map_err(|e| AppError::JsonError(e))?;
        index.tasks.len()
    } else {
        0
    };

    // Calculate total size
    let mut total_size = 0u64;
    if let Ok(entries) = fs::read_dir(&transcriptions_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().map_or(false, |ext| ext == "json") {
                if let Ok(metadata) = fs::metadata(&path) {
                    total_size += metadata.len();
                }
            }
        }
    }

    let storage_info = StorageInfo {
        directory: transcriptions_dir
            .to_string_lossy()
            .to_string(),
        task_count,
        total_size_bytes: total_size,
    };

    Ok(storage_info)
}

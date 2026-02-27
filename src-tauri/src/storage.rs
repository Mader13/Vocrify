//! Storage Module - Save/load transcription data to files
//!
//! This module provides persistent storage for transcription tasks using JSON files.
//! Each task is stored as a separate JSON file with an index file for metadata.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::AppError;
use crate::types::{TranscriptionSegment, SpeakerTurn};

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

/// Complete transcription task data
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionTask {
    pub id: String,
    pub file_path: String,
    pub file_name: String,
    pub status: String,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub options: TaskOptions,
    pub result: Option<TaskResult>,
    pub error: Option<String>,
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
}

/// A single transcription segment - using TranscriptionSegment from crate::types
// (TaskSegment is a type alias defined above)

/// A speaker turn - using SpeakerTurn from crate::types

/// Get the transcription storage directory
#[tauri::command]
pub async fn get_transcription_dir(app: AppHandle) -> Result<String, AppError> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| {
        AppError::IoError(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Failed to get app data directory: {}", e),
        ))
    })?;

    let transcriptions_dir = app_data_dir.join("Vocrify").join("transcriptions");

    // Create directory if it doesn't exist
    fs::create_dir_all(&transcriptions_dir).map_err(|e| {
        AppError::IoError(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("Failed to create transcriptions directory: {}", e),
        ))
    })?;

    Ok(transcriptions_dir
        .to_string_lossy()
        .to_string())
}

/// Save a transcription task to file
#[tauri::command]
pub async fn save_transcription(app: AppHandle, task: TranscriptionTask) -> Result<(), AppError> {
    let transcriptions_dir = PathBuf::from(get_transcription_dir(app).await?);
    let task_file = transcriptions_dir.join(format!("{}.json", task.id));
    let index_file = transcriptions_dir.join("index.json");

    // Create metadata
    let file_size_bytes = fs::metadata(&task_file)
        .map(|m| m.len())
        .unwrap_or(0);
    let duration = task.result.as_ref().map(|r| r.duration);
    let segment_count = task.result.as_ref().map(|r| r.segments.len());

    let metadata = TaskMetadata {
        id: task.id.clone(),
        file_name: task.file_name.clone(),
        file_path: task.file_path.clone(),
        status: task.status.clone(),
        created_at: task.created_at.clone(),
        completed_at: task.completed_at.clone(),
        duration,
        segment_count,
        has_result: task.result.is_some(),
        file_size_bytes,
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
#[tauri::command]
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
#[tauri::command]
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
#[tauri::command]
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
#[tauri::command]
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

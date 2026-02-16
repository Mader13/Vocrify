//! Download Manager Module
//!
//! This module provides robust model download management with:
//! - Download queue with automatic retry capability
//! - Progress event parsing and emission
//! - Download state persistence for resume after app restart
//! - Concurrent download limit enforcement
//! - Proper cleanup on cancellation
//! - Better error handling and recovery

use crate::AppError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;
use scopeguard;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::python_installer::create_hidden_command;

/// Maximum concurrent downloads allowed
const MAX_CONCURRENT_DOWNLOADS: usize = 3;

/// Maximum retry attempts for failed downloads
const MAX_RETRY_ATTEMPTS: u32 = 3;

/// Download state file name
const STATE_FILE: &str = "download_state.json";

/// Download status for tracking and persistence
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DownloadStatus {
    Queued,
    Downloading,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

/// Download state that can be persisted
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadState {
    pub model_name: String,
    pub model_type: String,
    pub status: DownloadStatus,
    pub retry_count: u32,
    pub current_bytes: u64,
    pub total_bytes: u64,
    pub last_error: Option<String>,
    pub started_at: Option<u64>,
    pub completed_at: Option<u64>,
}

/// Progress event for frontend
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressEvent {
    pub model_name: String,
    pub current_bytes: u64,
    pub total_bytes: u64,
    pub percent: f64,
    pub speed_mb_s: f64,
    pub status: DownloadStatus,
    pub retry_count: u32,
}

/// Internal download task state
#[derive(Debug)]
struct DownloadTask {
    model_name: String,
    model_type: String,
    state: DownloadState,
    handle: Option<tokio::task::JoinHandle<()>>,
    child_process: Arc<Mutex<Option<tokio::process::Child>>>,
}

/// Download Manager for handling model downloads with queue and persistence
pub struct DownloadManager {
    app: AppHandle,
    downloads: HashMap<String, DownloadTask>,
    queue: Vec<String>, // Model names in queue
    active_downloads: usize,
    state_file_path: PathBuf,
}

impl DownloadManager {
    /// Create a new download manager
    pub fn new(app: AppHandle) -> Result<Self, AppError> {
        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|_| AppError::IoError(std::io::Error::new(
                std::io::ErrorKind::Other,
                "Failed to get app data dir",
            )))?;

        let vocrify_dir = app_data.join("Vocrify");
        std::fs::create_dir_all(&vocrify_dir)
            .map_err(|e| AppError::IoError(e))?;

        let state_file_path = vocrify_dir.join(STATE_FILE);

        Ok(Self {
            app,
            downloads: HashMap::new(),
            queue: Vec::new(),
            active_downloads: 0,
            state_file_path,
        })
    }

    /// Initialize download manager and load persisted state
    pub async fn initialize(&mut self) -> Result<(), AppError> {
        self.load_state().await?;
        self.process_queue().await;
        Ok(())
    }

    /// Load download state from disk
    async fn load_state(&mut self) -> Result<(), AppError> {
        if !self.state_file_path.exists() {
            return Ok(());
        }

        let content = std::fs::read_to_string(&self.state_file_path)
            .map_err(|e| AppError::IoError(e))?;

        let saved_states: HashMap<String, DownloadState> =
            serde_json::from_str(&content).map_err(|e| AppError::JsonError(e))?;

        // Restore state for completed or failed downloads (don't auto-resume)
        for (model_name, state) in saved_states {
            match state.status {
                DownloadStatus::Completed | DownloadStatus::Failed | DownloadStatus::Cancelled => {
                    // Keep in downloads map but don't resume
                    self.downloads.insert(
                        model_name.clone(),
                        DownloadTask {
                            model_name: model_name.clone(),
                            model_type: state.model_type.clone(),
                            state,
                            handle: None,
                            child_process: Arc::new(Mutex::new(None)),
                        },
                    );
                }
                DownloadStatus::Queued | DownloadStatus::Paused => {
                    // Re-queue for download
                    self.queue.push(model_name.clone());
                    self.downloads.insert(
                        model_name.clone(),
                        DownloadTask {
                            model_name: model_name.clone(),
                            model_type: state.model_type.clone(),
                            state,
                            handle: None,
                            child_process: Arc::new(Mutex::new(None)),
                        },
                    );
                }
                DownloadStatus::Downloading => {
                    // Reset to queued (process was interrupted)
                    self.queue.push(model_name.clone());
                    let mut state = state;
                    state.status = DownloadStatus::Queued;
                    self.downloads.insert(
                        model_name.clone(),
                        DownloadTask {
                            model_name: model_name.clone(),
                            model_type: state.model_type.clone(),
                            state,
                            handle: None,
                            child_process: Arc::new(Mutex::new(None)),
                        },
                    );
                }
            }
        }

        Ok(())
    }

    /// Save download state to disk
    fn save_state(&self) -> Result<(), AppError> {
        let states: HashMap<String, DownloadState> = self
            .downloads
            .iter()
            .map(|(name, task)| (name.clone(), task.state.clone()))
            .collect();

        let json = serde_json::to_string_pretty(&states).map_err(|e| AppError::JsonError(e))?;

        std::fs::write(&self.state_file_path, json).map_err(|e| AppError::IoError(e))?;

        Ok(())
    }

    /// Queue a model for download
    pub async fn queue_download(
        &mut self,
        model_name: String,
        model_type: String,
        hugging_face_token: Option<String>,
    ) -> Result<(), AppError> {
        // Check if already downloading or queued
        if self.downloads.contains_key(&model_name) {
            let existing_status = &self.downloads[&model_name].state.status;
            if matches!(
                existing_status,
                DownloadStatus::Downloading | DownloadStatus::Queued
            ) {
                return Err(AppError::ModelError(format!(
                    "Model {} is already being downloaded",
                    model_name
                )));
            }
        }

        let state = DownloadState {
            model_name: model_name.clone(),
            model_type: model_type.clone(),
            status: DownloadStatus::Queued,
            retry_count: 0,
            current_bytes: 0,
            total_bytes: 0,
            last_error: None,
            started_at: Some(self.current_timestamp()),
            completed_at: None,
        };

        self.downloads.insert(
            model_name.clone(),
            DownloadTask {
                model_name: model_name.clone(),
                model_type,
                state,
                handle: None,
                child_process: Arc::new(Mutex::new(None)),
            },
        );

        self.queue.push(model_name.clone());

        // Save state
        self.save_state()?;

        // Emit queued event
        let _ = self.app.emit("model-download-queued", serde_json::json!({
            "modelName": model_name,
        }));

        // Process queue
        self.process_queue().await;

        Ok(())
    }

    /// Process the download queue
    async fn process_queue(&mut self) {
        // Start downloads up to the concurrent limit
        while self.active_downloads < MAX_CONCURRENT_DOWNLOADS && !self.queue.is_empty() {
            if let Some(model_name) = self.queue.pop() {
                if let Some(task) = self.downloads.get_mut(&model_name) {
                    // Skip if not in queued status
                    if !matches!(task.state.status, DownloadStatus::Queued) {
                        continue;
                    }

                    // Mark as downloading
                    task.state.status = DownloadStatus::Downloading;
                    self.active_downloads += 1;

                    // Clone necessary data for the spawn
                    let app = self.app.clone();
                    let model_name_clone = model_name.clone();
                    let model_type_clone = task.model_type.clone();
                    let child_process = task.child_process.clone();
                    let token_file = None; // TODO: Handle token if needed

                    // Spawn download task
                    let handle = tokio::spawn(async move {
                        if let Err(e) = Self::spawn_download(
                            app,
                            model_name_clone.clone(),
                            model_type_clone,
                            child_process,
                            token_file,
                        )
                        .await
                        {
                            eprintln!("Download failed for {}: {}", model_name_clone, e);
                        }
                    });

                    task.handle = Some(handle);

                    // Save state
                    let _ = self.save_state();
                }
            }
        }
    }

    /// Spawn the actual download process
    async fn spawn_download(
        app: AppHandle,
        model_name: String,
        model_type: String,
        child_process: Arc<Mutex<Option<tokio::process::Child>>>,
        token_file: Option<PathBuf>,
    ) -> Result<(), AppError> {
        let python_exe = Self::get_python_executable(&app);
        let engine_path = Self::get_python_engine_path(&app);
        let cache_dir = Self::get_models_dir(&app)?;

        let mut cmd = create_hidden_command(&python_exe);
        cmd.arg(&engine_path)
            .arg("--download-model")
            .arg(&model_name)
            .arg("--cache-dir")
            .arg(cache_dir.to_string_lossy().to_string())
            .arg("--model-type")
            .arg(&model_type)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(token_path) = token_file {
            cmd.arg("--token-file")
                .arg(token_path.to_string_lossy().to_string());
        }

        let mut child = cmd.spawn().map_err(|e| {
            AppError::PythonError(format!("Failed to spawn Python process: {}", e))
        })?;

        // Store child process for cancellation
        {
            let mut guard = child_process.lock().await;
            *guard = Some(child);
        }

        // Take stdout/stderr
        let mut guard = child_process.lock().await;
        let mut child = guard.take().expect("Child process was just stored");
        drop(guard);

        let stdout = child.stdout.take().expect("Failed to capture stdout");
        let stderr = child.stderr.take().expect("Failed to capture stderr");

        // Use scopeguard for cleanup
        let child_guard = scopeguard::guard(child, |mut child: tokio::process::Child| {
            let _ = child.start_kill();
        });

        let mut reader = BufReader::new(stdout).lines();
        let mut stderr_reader = BufReader::new(stderr).lines();

        // Handle stderr in background
        let app_clone = app.clone();
        let model_name_clone = model_name.clone();
        tokio::spawn(async move {
            while let Ok(Some(line)) = stderr_reader.next_line().await {
                eprintln!("[PYTHON STDERR] Download {}: {}", model_name_clone, line);

                // Emit critical errors
                if line.to_lowercase().contains("error")
                    || line.to_lowercase().contains("traceback")
                {
                    let _ = app_clone.emit(
                        "model-download-error",
                        serde_json::json!({
                            "modelName": model_name_clone,
                            "error": line,
                        }),
                    );
                }
            }
        });

        // Process stdout
        while let Some(line) = reader.next_line().await? {
            if line.is_empty() {
                continue;
            }

            // Skip non-JSON lines (e.g. NeMo/PyTorch log lines that leak to stdout)
            if !line.starts_with('{') {
                eprintln!("[DEBUG] Skipping non-JSON line from Python: {}", line);
                continue;
            }

            match serde_json::from_str::<serde_json::Value>(&line) {
                Ok(msg) => {
                    // Handle different message types from Python
                    if let Some(msg_type) = msg.get("type").and_then(|v| v.as_str()) {
                        match msg_type {
                            "debug" => {
                                println!("[DEBUG] {:?}", msg.get("message"));
                            }
                            "ProgressDownload" => {
                                if let Some(data) = msg.get("data") {
                                    let progress = DownloadProgressEvent {
                                        model_name: model_name.clone(),
                                        current_bytes: data
                                            .get("current")
                                            .and_then(|v| v.as_u64())
                                            .unwrap_or(0),
                                        total_bytes: data
                                            .get("total")
                                            .and_then(|v| v.as_u64())
                                            .unwrap_or(0),
                                        percent: data
                                            .get("percent")
                                            .and_then(|v| v.as_f64())
                                            .unwrap_or(0.0),
                                        speed_mb_s: data
                                            .get("speed_mb_s")
                                            .and_then(|v| v.as_f64())
                                            .unwrap_or(0.0),
                                        status: DownloadStatus::Downloading,
                                        retry_count: 0,
                                    };

                                    let _ = app.emit("model-download-progress", progress);
                                }
                            }
                            "download_stage" => {
                                if let Some(data) = msg.get("data") {
                                    let stage = data.get("stage")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("unknown")
                                        .to_string();

                                    let submodel_name = data.get("submodel_name")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string();

                                    let current_mb = data.get("current")
                                        .and_then(|v| v.as_f64())
                                        .unwrap_or(0.0);

                                    let total_mb = data.get("total")
                                        .and_then(|v| v.as_f64())
                                        .unwrap_or(0.0);

                                    let percent = data.get("percent")
                                        .and_then(|v| v.as_f64())
                                        .unwrap_or(0.0);

                                    let speed_mb_s = data.get("speed_mb_s")
                                        .and_then(|v| v.as_f64())
                                        .unwrap_or(0.0);

                                    // Emit stage progress to frontend
                                    let progress = serde_json::json!({
                                        "modelName": model_name,
                                        "stage": stage,
                                        "submodelName": submodel_name,
                                        "currentMb": current_mb,
                                        "totalMb": total_mb,
                                        "percent": percent,
                                        "speedMbS": speed_mb_s,
                                    });

                                    let _ = app.emit("model-download-stage", progress);
                                }
                            }
                            "download_stage_complete" => {
                                if let Some(data) = msg.get("data") {
                                    let stage = data.get("stage")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("unknown")
                                        .to_string();

                                    // Emit stage completion to frontend
                                    let complete = serde_json::json!({
                                        "modelName": model_name,
                                        "stage": stage,
                                    });

                                    let _ = app.emit("model-download-stage-complete", complete);
                                }
                            }
                            "DownloadComplete" => {
                                let _ = app.emit(
                                    "model-download-complete",
                                    serde_json::json!({
                                        "modelName": model_name,
                                    }),
                                );
                            }
                            "error" => {
                                let error_msg = msg
                                    .get("error")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("Unknown error");

                                return Err(AppError::ModelError(error_msg.to_string()));
                            }
                            _ => {
                                println!("[DEBUG] Unhandled message type: {}", msg_type);
                            }
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Failed to parse Python output: {} - line: {}", e, line);
                }
            }
        }

        // Release guard and wait for process
        let mut child = scopeguard::ScopeGuard::into_inner(child_guard);
        let status = child.wait().await?;

        if !status.success() {
            return Err(AppError::PythonError(format!(
                "Download failed with exit code: {:?}",
                status.code()
            )));
        }

        Ok(())
    }

    /// Cancel a download
    pub async fn cancel_download(&mut self, model_name: &str) -> Result<(), AppError> {
        if let Some(task) = self.downloads.get_mut(model_name) {
            // Kill child process
            let mut child = task.child_process.lock().await;
            if let Some(mut proc) = child.take() {
                let _ = proc.start_kill();
                let _ = proc.wait().await;
            }
            drop(child);

            // Abort task handle
            if let Some(handle) = task.handle.take() {
                handle.abort();
            }

            // Update state
            task.state.status = DownloadStatus::Cancelled;
            task.state.completed_at = Some(self.current_timestamp());

            // If active, decrement counter
            if matches!(
                task.state.status,
                DownloadStatus::Downloading | DownloadStatus::Queued
            ) {
                self.active_downloads = self.active_downloads.saturating_sub(1);
            }

            // Remove from queue if present
            self.queue.retain(|name| name != model_name);

            // Save state
            self.save_state()?;

            // Emit cancellation event
            let _ = self.app.emit("model-download-cancelled", serde_json::json!({
                "modelName": model_name,
            }));

            return Ok(());
        }

        Err(AppError::ModelError(format!(
            "Download not found: {}",
            model_name
        )))
    }

    /// Retry a failed download
    pub async fn retry_download(&mut self, model_name: &str) -> Result<(), AppError> {
        if let Some(task) = self.downloads.get_mut(model_name) {
            // Check if can retry
            if task.state.retry_count >= MAX_RETRY_ATTEMPTS {
                return Err(AppError::ModelError(format!(
                    "Maximum retry attempts ({}) reached for {}",
                    MAX_RETRY_ATTEMPTS, model_name
                )));
            }

            // Update state for retry
            task.state.status = DownloadStatus::Queued;
            task.state.retry_count += 1;
            task.state.last_error = None;

            // Add to queue
            self.queue.push(model_name.to_string());

            // Save state
            self.save_state()?;

            // Process queue
            self.process_queue().await;

            Ok(())
        } else {
            Err(AppError::ModelError(format!(
                "Download not found: {}",
                model_name
            )))
        }
    }

    /// Get all download states
    pub fn get_downloads(&self) -> Vec<DownloadState> {
        self.downloads.values().map(|task| task.state.clone()).collect()
    }

    /// Get a specific download state
    pub fn get_download(&self, model_name: &str) -> Option<DownloadState> {
        self.downloads.get(model_name).map(|task| task.state.clone())
    }

    /// Clear completed downloads from state
    pub fn clear_completed(&mut self) -> Result<(), AppError> {
        self.downloads
            .retain(|_, task| !matches!(task.state.status, DownloadStatus::Completed));

        self.save_state()?;
        Ok(())
    }

    /// Helper: Get current timestamp
    fn current_timestamp(&self) -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }

    /// Helper: Get Python executable path
    fn get_python_executable(app: &AppHandle) -> PathBuf {
        let engine_path = Self::get_python_engine_path(app);
        let fallback = PathBuf::from(".");
        let engine_dir = engine_path.parent().unwrap_or(&fallback);

        // Check for venv Python
        #[cfg(target_os = "windows")]
        let venv_python = engine_dir.join("venv").join("Scripts").join("python.exe");

        #[cfg(not(target_os = "windows"))]
        let venv_python = engine_dir.join("venv").join("bin").join("python");

        if venv_python.exists() {
            return dunce::simplified(&venv_python).to_path_buf();
        }

        PathBuf::from("python")
    }

    /// Helper: Get Python engine path
    fn get_python_engine_path(app: &AppHandle) -> PathBuf {
        let resource_path = app
            .path()
            .resource_dir()
            .unwrap_or_else(|_| PathBuf::from("."));

        let engine_path = resource_path.join("ai-engine").join("main.py");
        if engine_path.exists() {
            return dunce::simplified(&engine_path).to_path_buf();
        }

        let dev_path = PathBuf::from("../ai-engine/main.py");
        if dev_path.exists() {
            if let Ok(absolute) = std::env::current_dir() {
                let abs_path = absolute.join(&dev_path);
                if let Ok(normalized) = std::fs::canonicalize(&abs_path) {
                    return normalized;
                }
            }
            return dunce::simplified(&dev_path).to_path_buf();
        }

        PathBuf::from("ai-engine/main.py")
    }

    /// Helper: Get models directory
    fn get_models_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|_| AppError::IoError(std::io::Error::new(
                std::io::ErrorKind::Other,
                "Failed to get app data dir",
            )))?;

        let models_dir = app_data.join("Vocrify").join("models");
        std::fs::create_dir_all(&models_dir).map_err(|e| AppError::IoError(e))?;

        let normalized = std::fs::canonicalize(&models_dir).map_err(|e| AppError::IoError(e))?;

        Ok(normalized)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_download_state_serialization() {
        let state = DownloadState {
            model_name: "whisper-base".to_string(),
            model_type: "whisper".to_string(),
            status: DownloadStatus::Queued,
            retry_count: 0,
            current_bytes: 0,
            total_bytes: 0,
            last_error: None,
            started_at: Some(1234567890),
            completed_at: None,
        };

        let json = serde_json::to_string(&state).unwrap();
        let deserialized: DownloadState = serde_json::from_str(&json).unwrap();

        assert_eq!(state.model_name, deserialized.model_name);
        assert_eq!(state.status, deserialized.status);
    }
}

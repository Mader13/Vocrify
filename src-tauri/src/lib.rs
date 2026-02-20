//! Transcribe Video - Tauri Backend
//!
//! This module provides Rust backend for Transcribe Video application.
//! It handles:
//! - Task queue management
//! - Python process spawning and monitoring
//! - Event emission to the frontend
//! - Model management (download, list, delete)

use serde::{de::Error as DeError, Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
    OnceLock,
};
use std::sync::RwLock;
use tauri::{AppHandle, Emitter, Manager, State};
use std::env;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Mutex;
use tauri_plugin_dialog::DialogExt;
use scopeguard;

use python_installer::{create_hidden_command, create_hidden_std_command};
use python_ipc::{PythonMessage, is_critical_error};
use task_queue::{
    QueuedTask, RunningTask, TaskManager, dequeue_next_task, enqueue_task,
    should_process_next_after_cleanup,
};
use transcription_orchestrator::cleanup_temp_wav_file;

pub mod ffmpeg_manager;
pub mod whisper_engine;
pub mod sherpa_diarizer;
pub mod python_bridge;
pub mod engine_router;
pub mod transcription_manager;
pub mod python_installer;
pub mod performance_config;
pub mod model_downloader;
pub mod audio;
pub(crate) mod task_queue;
pub(crate) mod python_ipc;
pub(crate) mod transcription_orchestrator;

#[cfg(test)]
mod lib_queue_tests;

#[cfg(test)]
mod transcription_manager_memory_tests;

#[cfg(test)]
mod temp_wav_cleanup_tests;

#[cfg(test)]
mod lib_refactor_contract_tests;

// Re-export FFmpeg types for frontend
pub use ffmpeg_manager::{FFmpegStatus, FFmpegDownloadProgressEvent, get_ffmpeg_status, get_ffmpeg_path, download_ffmpeg};

// Re-export Python installer types for frontend
pub use python_installer::{InstallProgress, check_python_installed, install_python_full, get_python_install_progress, cancel_python_install};

// Re-export TranscriptionManager types for frontend (Phase 3: transcribe-rs)
#[allow(unused_imports)]
pub use transcription_manager::{
    TranscriptionManager,
    TranscriptionError,
    TranscriptionResult as TResult,
    TranscriptionSegment as TSegment,
    TranscriptionOptions as TOptions,
    SpeakerTurn as TSpeakerTurn,
    EngineType,
};

// Re-export Diarization types for frontend
pub use sherpa_diarizer::{SherpaDiarizer, DiarizationProvider, SpeakerSegment};

// Re-export PythonBridge types for frontend
pub use python_bridge::{PythonBridge, PythonTranscriptionResult, SpeakerSegment as PythonSpeakerSegment};

// Re-export EngineRouter types for frontend
pub use engine_router::{EngineRouter, EnginePreference, EngineChoice, RouterTranscriptionOptions, RouterTranscriptionResult};

// Re-export PerformanceConfig types for frontend
pub use performance_config::PerformanceConfig;

/// Maximum concurrent model downloads
const MAX_CONCURRENT_DOWNLOADS: usize = 3;

/// Extract model size from model name (e.g., "whisper-base" -> "base", "parakeet-tdt-0.6b-v3" -> "0.6b")
fn get_model_size(model_name: &str) -> &str {
    // Handle Whisper models
    if model_name.contains("whisper-") || model_name.starts_with("whisper") {
        if model_name.contains("-tiny") {
            return "tiny";
        } else if model_name.contains("-base") {
            return "base";
        } else if model_name.contains("-small") {
            return "small";
        } else if model_name.contains("-medium") {
            return "medium";
        } else if model_name.contains("-large") {
            return "large";
        } else {
            return "base"; // Default
        }
    }

    // Handle Parakeet models
    if model_name.contains("parakeet") {
        if model_name.contains("0.6b") || model_name.contains("06b") {
            return "0.6b";
        } else if model_name.contains("1.1b") || model_name.contains("11b") {
            return "1.1b";
        } else {
            return "0.6b"; // Default Parakeet
        }
    }

    "base" // Default fallback
}

/// Get optimal concurrent task count based on device and model
fn get_max_concurrent_tasks(device: &str, model_size: &str) -> usize {
    match (device, model_size) {
        // CPU: More tasks for smaller models
        ("cpu", "tiny") => 4,
        ("cpu", "base") => 4,
        ("cpu", "small") => 3,
        ("cpu", "0.6b") => 4,  // Parakeet 0.6B
        ("cpu", "1.1b") => 3,  // Parakeet 1.1B
        ("cpu", _) => 2,       // medium, large, or unknown

        // GPU: Can handle many more concurrent tasks
        ("cuda", "tiny") => 8,
        ("cuda", "base") => 8,
        ("cuda", "small") => 6,
        ("cuda", "0.6b") => 8,  // Parakeet 0.6B
        ("cuda", "1.1b") => 6,  // Parakeet 1.1B
        ("cuda", "medium") => 4,
        ("cuda", "large") => 2,

        // Default
        _ => 2,
    }
}

/// HIGH-7: Securely pass HuggingFace token via temp file instead of env var
fn pass_token_securely(token: &str) -> Result<PathBuf, AppError> {
    use std::io::Write;
    use tempfile::NamedTempFile;
    
    let mut temp_file = NamedTempFile::new()
        .map_err(|e| AppError::IoError(e))?;
    
    writeln!(temp_file, "{}", token)
        .map_err(|e| AppError::IoError(e))?;
    
    // On Unix, set read-only permissions
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(temp_file.path())
            .map_err(|e| AppError::IoError(e))?
            .permissions();
        perms.set_mode(0o400); // Read-only for owner
        std::fs::set_permissions(temp_file.path(), perms)
            .map_err(|e| AppError::IoError(e))?;
    }
    
    // Keep the file alive by returning the path
    let path = temp_file.path().to_path_buf();
    temp_file.persist(&path)
        .map_err(|e| AppError::IoError(e.into()))?;
    
    Ok(path)
}

/// Allowed base directories for file access (empty = allow all directories)
/// Set this to restrict file access to specific directories for security
const ALLOWED_DIRS: &[&str] = &[];

/// Transcription options passed from the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionOptions {
    pub model: String,
    pub device: String,
    pub language: String,
    pub enable_diarization: bool,
    pub diarization_provider: Option<String>,
    pub num_speakers: i32,
}

/// Transcription options for Rust transcribe-rs (Phase 3)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustTranscriptionOptions {
    pub model: String,
    pub device: String,
    pub language: Option<String>,
    pub enable_diarization: bool,
    pub diarization_provider: Option<String>,
    pub num_speakers: i32,
}

/// Implement From for RustTranscriptionOptions -> TranscriptionOptions
impl From<RustTranscriptionOptions> for TranscriptionOptions {
    fn from(opts: RustTranscriptionOptions) -> Self {
        Self {
            model: opts.model,
            device: opts.device,
            language: opts.language.unwrap_or_else(|| "auto".to_string()),
            enable_diarization: opts.enable_diarization,
            diarization_provider: opts.diarization_provider,
            num_speakers: opts.num_speakers,
        }
    }
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

/// A speaker turn from diarization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeakerTurn {
    pub start: f64,
    pub end: f64,
    pub speaker: String,
}

/// Transcription result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionResult {
    pub segments: Vec<TranscriptionSegment>,
    pub language: String,
    pub duration: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker_turns: Option<Vec<SpeakerTurn>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker_segments: Option<Vec<TranscriptionSegment>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metrics: Option<ProgressMetrics>,
}

/// Progress event sent to the frontend
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub task_id: String,
    pub progress: u8,
    pub stage: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metrics: Option<ProgressMetrics>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProgressMetrics {
    pub realtime_factor: Option<f64>,
    pub processed_duration: Option<f64>,
    pub total_duration: Option<f64>,
    pub estimated_time_remaining: Option<f64>,
    pub gpu_usage: Option<f64>,
    pub cpu_usage: Option<f64>,
    pub memory_usage: Option<f64>,
    pub model_load_ms: Option<u64>,
    pub decode_ms: Option<u64>,
    pub inference_ms: Option<u64>,
    pub diarization_ms: Option<u64>,
    pub total_ms: Option<u64>,
}

fn spawn_queue_processor(app: AppHandle, task_manager: TaskManagerState) {
    tokio::spawn(async move {
        loop {
            process_next_queued_task(app.clone(), &task_manager).await;

            let has_queued_tasks = {
                let manager = task_manager.lock().await;
                !manager.queued_tasks.is_empty()
            };

            if !has_queued_tasks {
                break;
            }

            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
        }
    });
}

/// Model management types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModel {
    pub name: String,
    pub size_mb: u64,
    pub model_type: String,
    pub installed: bool,
    pub path: Option<String>,
}

// ============================================================================
// Setup Wizard Types
// ============================================================================

/// Result of Python environment check for Setup Wizard
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PythonCheckResult {
    pub status: String,
    pub version: Option<String>,
    pub executable: Option<String>,
    pub in_venv: bool,
    pub pytorch_installed: bool,
    pub pytorch_version: Option<String>,
    pub cuda_available: bool,
    pub mps_available: bool,
    pub message: String,
}

/// Result of FFmpeg installation check for Setup Wizard
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FFmpegCheckResult {
    pub status: String,
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub message: String,
}

/// Result of AI models check for Setup Wizard
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCheckResult {
    pub status: String,
    pub installed_models: Vec<LocalModelInfo>,
    pub has_required_model: bool,
    pub message: String,
}

/// Local model info for Setup Wizard (simplified version)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelInfo {
    pub name: String,
    pub model_type: String,
    pub size_mb: u64,
}

/// Device check result for Setup Wizard
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCheckResult {
    pub status: String,
    pub devices: Vec<DeviceInfo>,
    pub recommended: Option<DeviceInfo>,
    pub message: String,
}

/// Complete environment status for Setup Wizard
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentStatus {
    pub python: PythonCheckResult,
    pub ffmpeg: FFmpegCheckResult,
    pub models: ModelCheckResult,
    pub devices: DeviceCheckResult,
    pub overall_status: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeReadinessStatus {
    pub ready: bool,
    pub python_ready: bool,
    pub ffmpeg_ready: bool,
    pub python_message: String,
    pub ffmpeg_message: String,
    pub message: String,
    pub checked_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetupState {
    schema_version: u32,
    runtime_ready: bool,
    last_verified_at: String,
    completed_at: Option<String>,
    python_executable: Option<String>,
    ffmpeg_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskUsage {
    pub total_size_mb: u64,
    pub free_space_mb: u64,
}

/// Device information for ML acceleration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub device_type: String,
    pub name: String,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_mb: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compute_capability: Option<String>,
    pub is_recommended: bool,
}

/// Response containing all available devices
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicesResponse {
    pub devices: Vec<DeviceInfo>,
    pub recommended: String,
}

/// Global cache for device detection
/// Persists for the app session to avoid repeated PyTorch imports
static DEVICE_CACHE: OnceLock<Arc<Mutex<Option<DevicesResponse>>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDownloadProgress {
    pub model_name: String,
    pub current_mb: u64,
    pub total_mb: u64,
    pub percent: f64,
    pub speed_mb_s: f64,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eta_s: Option<f64>,
    pub total_estimated: bool,
}

type TaskManagerState = Arc<Mutex<TaskManager>>;

/// TranscriptionManager state for Rust-based transcription
type TranscriptionManagerState = Arc<Mutex<Option<TranscriptionManager>>>;

/// Abort handles for active Rust transcribe-rs tasks (enables cancel_transcription)
type RustTaskHandles = Arc<Mutex<HashMap<String, tokio::task::AbortHandle>>>;

/// Performance configuration state for feature flags
/// Uses RwLock to allow updating config after initial setup
type PerformanceConfigState = Arc<RwLock<PerformanceConfig>>;

/// Application error type
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Python engine error: {0}")]
    PythonError(String),

    #[error("Task not found: {0}")]
    TaskNotFound(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),

    #[error("Model error: {0}")]
    ModelError(String),

    #[error("File not found: {0}")]
    NotFound(String),

    #[error("Access denied: {0}")]
    AccessDenied(String),

    #[error("{0}")]
    Other(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}


/// Get the path to the Python engine
fn get_python_engine_path(app: &AppHandle) -> PathBuf {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // Prefer app data location first (used by runtime installer flow)
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        candidates.push(app_data_dir.join("ai-engine").join("main.py"));
        candidates.push(app_data_dir.join("Vocrify").join("ai-engine").join("main.py"));
    }

    // Resource directory candidates (for production builds).
    // Depending on bundler/runtime layout, resource_dir can point either to
    // ".../resources" or app root near the executable.
    if let Ok(resource_path) = app.path().resource_dir() {
        candidates.push(resource_path.join("ai-engine").join("main.py"));
        candidates.push(resource_path.join("resources").join("ai-engine").join("main.py"));
    }

    // Executable-relative candidates (Windows installer layouts).
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            candidates.push(exe_dir.join("ai-engine").join("main.py"));
            candidates.push(exe_dir.join("resources").join("ai-engine").join("main.py"));
        }
    }

    // Development candidates.
    candidates.push(PathBuf::from("../ai-engine/main.py"));
    candidates.push(PathBuf::from("ai-engine/main.py"));

    for candidate in &candidates {
        if candidate.exists() {
            if let Ok(normalized) = std::fs::canonicalize(candidate) {
                return normalized;
            }
            return dunce::simplified(candidate).to_path_buf();
        }
    }

    eprintln!("[WARN] Python engine main.py not found. Checked paths: {:?}", candidates);

    // Last resort fallback for diagnostics.
    PathBuf::from("ai-engine/main.py")
}

/// Validate file path to prevent command injection and path traversal attacks
///
/// This function performs security checks on user-provided file paths:
/// - Resolves symlinks and relative paths using `canonicalize()`
/// - Ensures the path exists and is a file (not a directory)
/// - Optionally restricts access to allowed directories
/// - Prevents directory traversal attacks
///
/// # Arguments
/// * `file_path` - The user-provided file path to validate
///
/// # Returns
/// * `Ok(PathBuf)` - The validated, canonicalized absolute path
/// * `Err(AppError::NotFound)` - If the file doesn't exist or is a directory
/// * `Err(AppError::AccessDenied)` - If the path is outside allowed directories
fn validate_file_path(file_path: &str) -> Result<PathBuf, AppError> {
    // Convert string to Path
    let path = Path::new(file_path);

    // Check if path exists and is a file (not a directory)
    if !path.exists() {
        return Err(AppError::NotFound(format!(
            "File does not exist: {}",
            file_path
        )));
    }

    if path.is_dir() {
        return Err(AppError::NotFound(format!(
            "Path is a directory, not a file: {}",
            file_path
        )));
    }

    // Canonicalize the path to resolve symlinks, ., .., and get absolute path
    let canonical = path
        .canonicalize()
        .map_err(|e| AppError::NotFound(format!("Failed to resolve path: {}", e)))?;

    // If ALLOWED_DIRS is configured, verify the path is within allowed directories
    if !ALLOWED_DIRS.is_empty() {
        let is_allowed = ALLOWED_DIRS.iter().any(|allowed_dir| {
            let allowed_path = Path::new(allowed_dir);
            // Try to canonicalize the allowed directory
            match allowed_path.canonicalize() {
                Ok(allowed_canonical) => canonical
                    .as_path()
                    .starts_with(allowed_canonical.as_path()),
                Err(_) => false,
            }
        });

        if !is_allowed {
            return Err(AppError::AccessDenied(format!(
                "File path is outside allowed directories: {}",
                canonical.display()
            )));
        }
    }

    Ok(canonical)
}

/// Check whether a Python executable has torch installed.
fn python_has_torch(python_exe: &Path) -> bool {
    let output = create_hidden_std_command(python_exe)
        .arg("-c")
        .arg("import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('torch') else 1)")
        .output();

    match output {
        Ok(o) => o.status.success(),
        Err(_) => false,
    }
}

/// Check whether a Python executable/command can be started.
fn python_is_runnable(python_exe: &Path) -> bool {
    let output = create_hidden_std_command(python_exe)
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output();

    match output {
        Ok(o) => o.status.success(),
        Err(_) => false,
    }
}

/// Pick the best Python executable from candidates.
/// Prefer interpreters with torch installed for ML workloads.
fn pick_best_python_executable(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    let existing: Vec<PathBuf> = candidates
        .into_iter()
        .filter(|p| p.exists())
        .collect();

    eprintln!("[DEBUG] pick_best_python_executable: candidates = {:?}", existing);

    // Prefer environments with torch available
    for exe in &existing {
        let has_torch = python_has_torch(exe);
        eprintln!("[DEBUG] Checking python: {:?}, has_torch = {}", exe, has_torch);
        if has_torch {
            eprintln!("[INFO] Selected Python with torch: {:?}", exe);
            return Some(dunce::simplified(exe).to_path_buf());
        }
    }

    // Fallback to first existing interpreter
    if let Some(first) = existing.first() {
        eprintln!(
            "[WARN] Found Python interpreter without torch: {:?}. Falling back; ML features may fail.",
            first
        );
        return Some(dunce::simplified(first).to_path_buf());
    }

    None
}

/// Return system-level Python command candidates in priority order.
fn get_system_python_candidates() -> Vec<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        vec![
            PathBuf::from("python"),
            PathBuf::from("python3"),
            PathBuf::from("python12"),
            PathBuf::from("py"),
        ]
    }

    #[cfg(not(target_os = "windows"))]
    {
        vec![
            PathBuf::from("python3"),
            PathBuf::from("python"),
            PathBuf::from("python12"),
        ]
    }
}

/// Pick the best runnable system Python command.
/// Prefer commands with torch installed.
fn pick_best_system_python(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    let runnable: Vec<PathBuf> = candidates
        .into_iter()
        .filter(|p| python_is_runnable(p))
        .collect();

    eprintln!("[DEBUG] pick_best_system_python: runnable candidates = {:?}", runnable);

    for exe in &runnable {
        let has_torch = python_has_torch(exe);
        eprintln!(
            "[DEBUG] Checking system python command: {:?}, has_torch = {}",
            exe, has_torch
        );
        if has_torch {
            eprintln!("[INFO] Selected system Python with torch installed: {:?}", exe);
            return Some(exe.clone());
        }
    }

    if let Some(first) = runnable.first() {
        eprintln!(
            "[WARN] Selected runnable system Python without torch: {:?}",
            first
        );
        return Some(first.clone());
    }

    None
}

/// Discover additional virtualenv python executables in project root.
/// Looks for directories that contain `pyvenv.cfg` and a Python executable.
fn discover_project_venv_pythons(project_root: &Path) -> Vec<PathBuf> {
    let mut result = Vec::new();

    let entries = match std::fs::read_dir(project_root) {
        Ok(entries) => entries,
        Err(_) => return result,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        if !path.join("pyvenv.cfg").exists() {
            continue;
        }

        #[cfg(target_os = "windows")]
        let python_exe = path.join("Scripts").join("python.exe");

        #[cfg(not(target_os = "windows"))]
        let python_exe = path.join("bin").join("python");

        if python_exe.exists() {
            result.push(python_exe);
        }
    }

    result
}

/// Get the Python executable path (venv or system)
fn get_python_executable(app: &AppHandle) -> PathBuf {
    let engine_path = get_python_engine_path(app);
    eprintln!("[DEBUG] get_python_executable: engine_path = {:?}", engine_path);
    let fallback = PathBuf::from(".");
    let engine_dir = engine_path.parent().unwrap_or(&fallback);
    eprintln!("[DEBUG] get_python_executable: engine_dir = {:?}", engine_dir);

    // Try multiple venv locations in order of preference.
    // Includes legacy project-level env names used in this repository.
    // Also include embeddable Python (installed by python_installer.rs)
    let mut venv_paths = {
        #[cfg(target_os = "windows")]
        {
            vec![
                engine_dir.join("venv").join("Scripts").join("python.exe"),
                engine_dir.join(".venv").join("Scripts").join("python.exe"),
                engine_dir.join("env").join("Scripts").join("python.exe"),
                // Embeddable Python installed by python_installer.rs
                engine_dir.join("python").join("python.exe"),
            ]
        }

        #[cfg(not(target_os = "windows"))]
        {
            vec![
                engine_dir.join("venv").join("bin").join("python"),
                engine_dir.join(".venv").join("bin").join("python"),
                engine_dir.join("env").join("bin").join("python"),
                // Embeddable Python installed by python_installer.rs
                engine_dir.join("python").join("bin").join("python"),
            ]
        }
    };

    // Add installer-managed Python location under AppData.
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        #[cfg(target_os = "windows")]
        {
            venv_paths.push(app_data_dir.join("ai-engine").join("python").join("python.exe"));
            venv_paths.push(
                app_data_dir
                    .join("Vocrify")
                    .join("ai-engine")
                    .join("python")
                    .join("python.exe"),
            );
        }

        #[cfg(not(target_os = "windows"))]
        {
            venv_paths.push(app_data_dir.join("ai-engine").join("python").join("bin").join("python"));
            venv_paths.push(
                app_data_dir
                    .join("Vocrify")
                    .join("ai-engine")
                    .join("python")
                    .join("bin")
                    .join("python"),
            );
        }
    }

    // Try common virtual environment locations in parent directories
    if let Some(parent_dir) = engine_dir.parent() {
        let mut parent_venv_paths = {
            #[cfg(target_os = "windows")]
            {
                vec![
                    parent_dir.join("venv").join("Scripts").join("python.exe"),
                    parent_dir.join(".venv").join("Scripts").join("python.exe"),
                ]
            }

            #[cfg(not(target_os = "windows"))]
            {
                vec![
                    parent_dir.join("venv").join("bin").join("python"),
                    parent_dir.join(".venv").join("bin").join("python"),
                ]
            }
        };

        // Add any discovered project-level venvs (e.g. custom names).
        parent_venv_paths.extend(discover_project_venv_pythons(parent_dir));

        venv_paths.append(&mut parent_venv_paths);

        if let Some(best) = pick_best_python_executable(venv_paths) {
            eprintln!("[INFO] Found Python venv in project hierarchy: {:?}", best);
            return best;
        }
    }

    // Fall back to system Python command candidates
    if let Some(best_system_python) = pick_best_system_python(get_system_python_candidates()) {
        return best_system_python;
    }

    eprintln!(
        "[WARN] No runnable Python command found in known environments; falling back to `python`."
    );
    PathBuf::from("python")
}

/// Ensure minimal Python packages required for model downloads are available.
/// This is especially important for embeddable Python installs where
/// requirements.txt may not have been installed yet.
async fn ensure_python_download_dependencies(python_exe: &Path) -> Result<(), AppError> {
    let check_output = create_hidden_command(python_exe)
        .arg("-c")
        .arg(
            "import importlib.util;mods=['requests','tenacity','huggingface_hub'];missing=[m for m in mods if importlib.util.find_spec(m) is None];print(','.join(missing))",
        )
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| AppError::PythonError(format!("Failed to check Python dependencies: {}", e)))?;

    if !check_output.status.success() {
        let stderr = String::from_utf8_lossy(&check_output.stderr);
        return Err(AppError::PythonError(format!(
            "Failed to check Python dependencies: {}",
            stderr.trim()
        )));
    }

    let stdout = String::from_utf8_lossy(&check_output.stdout);
    let missing: Vec<String> = stdout
        .trim()
        .split(',')
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_string())
        .collect();

    if missing.is_empty() {
        return Ok(());
    }

    eprintln!(
        "[INFO] Installing missing Python download dependencies: {:?}",
        missing
    );

    let mut install_cmd = create_hidden_command(python_exe);
    install_cmd
        .arg("-m")
        .arg("pip")
        .arg("install")
        .arg("--upgrade")
        .arg("--no-warn-script-location");
    for dep in &missing {
        install_cmd.arg(dep);
    }

    let install_output = install_cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| AppError::PythonError(format!("Failed to install Python dependencies: {}", e)))?;

    if !install_output.status.success() {
        let stderr = String::from_utf8_lossy(&install_output.stderr);
        return Err(AppError::PythonError(format!(
            "Failed to install Python dependencies ({}): {}",
            missing.join(", "),
            stderr.trim()
        )));
    }

    Ok(())
}

/// Build TranscriptionManager with Python bridge configured for diarization.
fn build_transcription_manager(app: &AppHandle) -> Result<TranscriptionManager, String> {
    let models_dir = get_models_dir(app).map_err(|e| e.to_string())?;
    let python_exe = get_python_executable(app);
    let engine_path = get_python_engine_path(app);

    eprintln!("[INFO] Initializing TranscriptionManager");
    eprintln!("[DEBUG]   models_dir: {:?}", models_dir);
    eprintln!("[DEBUG]   python_exe: {:?}", python_exe);
    eprintln!("[DEBUG]   engine_path: {:?}", engine_path);

    TranscriptionManager::new(
        &models_dir,
        Some(&python_exe),
        Some(&engine_path),
        Some(&models_dir),
    )
    .map_err(|e| format!("Failed to create TranscriptionManager: {}", e))
}

/// Spawn a Python transcription process
async fn spawn_transcription(
    app: AppHandle,
    task_id: String,
    file_path: String,
    options: TranscriptionOptions,
    child_process: Arc<Mutex<Option<tokio::process::Child>>>,
) -> Result<(), AppError> {
    eprintln!("[INFO] spawn_transcription START: task_id={}", task_id);

    // CRITICAL SECURITY FIX: Validate file path before using it
    let validated_path = match validate_file_path(&file_path) {
        Ok(p) => {
            eprintln!("[DEBUG] File path validated: {:?}", p);
            p
        }
        Err(e) => {
            eprintln!("[ERROR] File path validation failed: {}", e);
            return Err(e);
        }
    };

    let engine_path = get_python_engine_path(&app);
    let python_exe = get_python_executable(&app);

    eprintln!("[DEBUG] Engine path: {:?}", engine_path);
    eprintln!("[DEBUG] Python exe: {:?}", python_exe);

    let models_dir = match get_models_dir(&app) {
        Ok(d) => {
            eprintln!("[DEBUG] Models dir: {:?}", d);
            d
        }
        Err(e) => {
            eprintln!("[ERROR] Failed to get models dir: {}", e);
            return Err(e);
        }
    };

    // Check if we need to use downloaded FFmpeg
    let ffmpeg_path: Option<PathBuf> = ffmpeg_manager::get_ffmpeg_path(&app).await.ok();
    let ffmpeg_env_var = if let Some(ref path) = ffmpeg_path {
        let path_str = path.parent()
            .and_then(|p: &Path| p.to_str())
            .unwrap_or_else(|| "");
        format!("{};{}", path_str, env::var("PATH").unwrap_or_default())
    } else {
        "".to_string()
    };

    eprintln!("[DEBUG] Starting Python process:");
    eprintln!("[DEBUG]   python_exe: {:?}", python_exe);
    eprintln!("[DEBUG]   engine_path: {:?}", engine_path);
    eprintln!("[DEBUG]   file_path: {:?}", validated_path);
    eprintln!("[DEBUG]   model: {}", options.model);
    eprintln!("[DEBUG]   models_dir: {:?}", models_dir);
    if !ffmpeg_env_var.is_empty() {
        eprintln!("[DEBUG]   ffmpeg_path: {:?}", ffmpeg_path);
        eprintln!("[DEBUG]   Added to PATH");
    }

    let mut cmd = create_hidden_command(&python_exe);
    cmd.arg(&engine_path)
        .arg("--file")
        .arg(&validated_path) // Use validated path instead of user input
        .arg("--model")
        .arg(&options.model)
        .arg("--device")
        .arg(&options.device)
        .arg("--language")
        .arg(&options.language)
        .arg("--cache-dir")
        .arg(models_dir.to_string_lossy().to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Add FFmpeg to PATH if downloaded version is used
    if !ffmpeg_env_var.is_empty() {
        cmd.env("PATH", ffmpeg_env_var);
    }

    eprintln!("[DEBUG] Command built: {:?}", cmd);

    if options.enable_diarization {
        eprintln!("[INFO] Diarization enabled");
        cmd.arg("--diarization");
        if let Some(provider) = &options.diarization_provider {
            eprintln!("[INFO] Diarization provider: {}", provider);
            cmd.arg("--diarization-provider").arg(provider);

            // Pass HuggingFace token for pyannote diarization
            if provider == "pyannote" {
                eprintln!("[INFO] PyAnnote provider - fetching HuggingFace token...");
                match get_huggingface_token(&app).await {
                    Ok(Some(token)) => {
                        eprintln!("[DEBUG] Found HuggingFace token (length: {}), setting as environment variable", token.len());
                        cmd.env("HUGGINGFACE_ACCESS_TOKEN", &token);
                        cmd.env("HF_TOKEN", &token);
                    }
                    Ok(None) => {
                        eprintln!("[WARN] No HuggingFace token found in store for pyannote diarization");
                    }
                    Err(e) => {
                        eprintln!("[ERROR] Failed to read HuggingFace token: {}", e);
                    }
                }
            }
        } else {
            eprintln!("[WARN] Diarization enabled but no provider specified!");
        }
        cmd.arg("--num-speakers").arg(options.num_speakers.to_string());
        eprintln!("[DEBUG] Num speakers: {}", options.num_speakers);
    } else {
        eprintln!("[INFO] Diarization disabled");
    }

    eprintln!("[DEBUG] Spawning child process...");
    let mut child = match cmd.spawn() {
        Ok(c) => {
            eprintln!("[INFO] Child process spawned successfully with PID: {:?}", c.id());
            c
        }
        Err(e) => {
            eprintln!("[ERROR] Failed to spawn Python process: {}", e);
            eprintln!("[ERROR] Error details: {:?}", e);
            return Err(AppError::IoError(e));
        }
    };

    // Take stdout/stderr BEFORE storing in Arc (while we still own the child)
    let stdout = child.stdout.take().expect("Failed to capture stdout");
    let stderr = child.stderr.take().expect("Failed to capture stderr");
    
    // HIGH-1: Store child process for cancellation - KEEP IT THERE!
    // This allows cancel_transcription to kill the process via child_process Arc.
    {
        let mut guard = child_process.lock().await;
        *guard = Some(child);
    }
    
    // Note: We no longer use scopeguard here because the process stays in child_process.
    // Cleanup happens via:
    // 1. cancel_transcription kills the process
    // 2. Normal completion: we take the process back for wait() at the end
    // 3. Panic: the process will be orphaned but will be cleaned up by OS when parent exits
    
    let mut reader = BufReader::new(stdout).lines();
    let mut stderr_reader = BufReader::new(stderr).lines();
    
    // Read stderr in background, count critical errors, and emit them to frontend
    let app_clone = app.clone();
    let task_id_clone = task_id.clone();
    let stderr_handle = tokio::spawn(async move {
        let mut error_count = 0;
        while let Ok(Some(line)) = stderr_reader.next_line().await {
            eprintln!("[PYTHON STDERR] Task {}: {}", task_id_clone, line);

            if is_critical_error(&line) {
                error_count += 1;
                let _ = app_clone.emit("transcription-error", serde_json::json!({
                    "taskId": task_id_clone,
                    "error": line,
                }));
            }
        }
        error_count
    });

    let mut segments: Vec<TranscriptionSegment> = Vec::new();
    let mut speaker_turns: Option<Vec<SpeakerTurn>> = None;
    let mut speaker_segments: Option<Vec<TranscriptionSegment>> = None;
    let mut result_language: String = "en".to_string();
    let mut received_result = false;

    eprintln!("[DEBUG] Starting to read Python stdout...");

    while let Some(line) = reader.next_line().await? {
        eprintln!("[DEBUG] Received line from Python: {}", line);
        if line.is_empty() {
            continue;
        }
        
        // Skip non-JSON lines (e.g. NeMo/PyTorch log lines that leak to stdout)
        if !line.starts_with('{') {
            eprintln!("[DEBUG] Skipping non-JSON line from Python: {}", line);
            continue;
        }

        match serde_json::from_str::<PythonMessage>(&line) {
            Ok(msg) => match msg {
                PythonMessage::Hello { message, .. } => {
                    println!("Python engine: {}", message);
                }
                PythonMessage::Debug { message } => {
                    eprintln!("[PYTHON DEBUG] {}", message);
                }
                PythonMessage::Progress { stage, progress, message, metrics } => {
                    eprintln!("[DEBUG] Emitting progress: {}% - stage: {}, msg: {}", progress, stage, message);
                    let progress_event = ProgressEvent {
                        task_id: task_id.clone(),
                        progress,
                        stage,
                        message,
                        metrics,
                    };
                    eprintln!("[DEBUG] ProgressEvent JSON: {:?}", serde_json::to_string(&progress_event));
                    let _ = app.emit("progress-update", progress_event);
                }
                PythonMessage::Segment { segment, index, total } => {
                    eprintln!("[DEBUG] Emitting segment: index={}, total={:?}", index, total);
                    let _ = app.emit("segment-update", serde_json::json!({
                        "taskId": task_id,
                        "segment": segment,
                        "index": index,
                        "total": total,
                    }));
                }
                PythonMessage::Result { segments: segs, language, duration: _, speaker_turns: st_turns, speaker_segments: st_segs } => {
                    segments = segs;
                    result_language = language;
                    speaker_turns = st_turns;
                    speaker_segments = st_segs;
                    received_result = true;
                    // Use duration from Python result if available, otherwise calculate from segments
                }
                PythonMessage::Error { error } => {
                    let _ = app.emit("transcription-error", serde_json::json!({
                        "taskId": task_id,
                        "error": error,
                    }));
                    return Err(AppError::PythonError(error));
                }
                PythonMessage::ProgressDownload { .. } => {}
                PythonMessage::DownloadComplete { .. } => {}
                PythonMessage::ModelsList { .. } => {}
                PythonMessage::DeleteComplete { .. } => {}
            },
            Err(e) => {
                eprintln!("Failed to parse Python output: {} - line: {}", e, line);
            }
        }
    }

    // Check for critical errors from stderr
    let stderr_errors = stderr_handle.await.unwrap_or(0);
    if stderr_errors > 0 && !received_result {
        return Err(AppError::PythonError(format!(
            "{} critical error(s) detected in stderr. Check the application logs for details.",
            stderr_errors
        )));
    } else if stderr_errors > 0 {
        eprintln!(
            "[WARN] Python emitted {} critical stderr line(s), but a final result was received. Continuing as successful completion.",
            stderr_errors
        );
    }

    // Take the child process back from child_process Arc for wait()
    // If it's None, the process was killed by cancel_transcription
    let child_opt = {
        let mut guard = child_process.lock().await;
        guard.take()
    };
    
    match child_opt {
        Some(mut child) => {
            let status = child.wait().await?;

            if !status.success() {
                let exit_code = status.code().unwrap_or(-1);

                // Windows native extensions (e.g. torch/onnx runtime) may crash during Python shutdown
                // AFTER final result is already emitted. In that case, prefer completed result over late exit code.
                if received_result && !segments.is_empty() {
                    eprintln!(
                        "[WARN] Python exited with code {} after final result was received. Treating task as successful.",
                        exit_code
                    );
                } else {
                let error_msg = format!(
                    "Python process exited with code: {}. \
                    Ensure Python 3.8-3.12 is installed with all required dependencies. \
                    Check the application logs for detailed error information.",
                    exit_code
                );

                let _ = app.emit("transcription-error", serde_json::json!({
                    "taskId": task_id,
                    "error": error_msg,
                }));

                return Err(AppError::PythonError(error_msg));
                }
            }
        }
        None => {
            // Process was killed by cancel_transcription
            eprintln!("[INFO] Transcription was cancelled (process killed)");
            return Err(AppError::PythonError("Transcription was cancelled".to_string()));
        }
    }

    if segments.is_empty() {
        let warning_msg = "Transcription completed but produced no results. \
                          This may indicate an issue with the audio file or model.";
        eprintln!("[WARN] {}", warning_msg);
    }

    // Calculate duration from the last segment's end time
    let duration = segments.iter()
        .map(|s| s.end)
        .fold(0.0, f64::max);

    let segments_count = segments.len();
    let speaker_turns_count = speaker_turns.as_ref().map_or(0, |v| v.len());
    let speaker_segments_count = speaker_segments.as_ref().map_or(0, |v| v.len());

    let result = TranscriptionResult {
        segments,
        language: result_language,
        duration,
        speaker_turns,
        speaker_segments,
        metrics: None,
    };

    eprintln!("[DEBUG] Emitting transcription-complete with {} segments, {} speaker_turns, {} speaker_segments",
        segments_count,
        speaker_turns_count,
        speaker_segments_count
    );

    let _ = app.emit("transcription-complete", serde_json::json!({
        "taskId": task_id,
        "result": result,
    }));

    Ok(())
}

/// Process the next queued task if any
async fn process_next_queued_task(
    app: AppHandle,
    task_manager: &TaskManagerState,
) {
    // CRITICAL-5 FIX: Use Mutex guard to ensure only one queue processor runs at a time
    // First lock the task manager to get access to the queue_processor_guard
    let manager_guard = task_manager.lock().await;
    let queue_guard = manager_guard.queue_processor_guard.clone();
    drop(manager_guard);

    // Now lock the queue processor guard
    let _guard = queue_guard.lock().await;

    // Lock the task manager again for the actual processing
    let mut manager = task_manager.lock().await;

    // Check if we can start more tasks
    // Calculate max concurrent tasks based on all queued tasks
    let max_concurrent = manager.queued_tasks.iter()
        .map(|task| {
            let model_size = get_model_size(&task.options.model);
            get_max_concurrent_tasks(&task.options.device, model_size)
        })
        .max()
        .unwrap_or(2); // Default fallback

    if manager.running_tasks.len() >= max_concurrent {
        return;
    }

    // Get the next queued task
    if let Some(next_task) = dequeue_next_task(&mut manager.queued_tasks) {
        let task_id = next_task.id.clone();

        // Spawn the task
        let app_clone = app.clone();
        let task_id_clone = next_task.id.clone();
        let file_path_clone = next_task.file_path.clone();
        let options_clone = next_task.options.clone();

        let task_id_for_error = next_task.id.clone();
        let task_id_for_cleanup = next_task.id.clone();
        let app_clone_for_error = app_clone.clone();
        let app_clone_for_next = app.clone();
        let task_manager_for_next = task_manager.clone();

        let child_process = Arc::new(Mutex::new(None));
        let child_process_clone = child_process.clone();
        let child_process_for_task = child_process.clone();

        let handle = tokio::spawn(async move {
            let result = spawn_transcription(
                app_clone,
                task_id_clone,
                file_path_clone,
                options_clone,
                child_process_clone,
            ).await;

            if let Err(e) = result {
                eprintln!("Transcription error: {}", e);

                let _ = app_clone_for_error.emit("transcription-error", serde_json::json!({
                    "taskId": task_id_for_error,
                    "error": e.to_string(),
                }));
            }

            let should_process_next = {
                let mut manager = task_manager_for_next.lock().await;
                should_process_next_after_cleanup(&mut manager, &task_id_for_cleanup)
            };

            if should_process_next {
                spawn_queue_processor(app_clone_for_next, task_manager_for_next.clone());
            }
        });

        manager.running_tasks.insert(task_id, RunningTask {
            handle,
            child_process: child_process_for_task,
        });
    }

    // Guard is automatically released when it goes out of scope
}

/// Start a transcription task
#[tauri::command]
async fn start_transcription(
    app: AppHandle,
    task_manager: State<'_, TaskManagerState>,
    task_id: String,
    file_path: String,
    options: TranscriptionOptions,
) -> Result<(), AppError> {
    eprintln!("[INFO] start_transcription called with task_id: {}, file: {}, enable_diarization: {}, provider: {:?}",
        task_id, file_path, options.enable_diarization, options.diarization_provider);

    // CRITICAL: Validate diarization settings
    if options.enable_diarization {
        match &options.diarization_provider {
            None => {
                eprintln!("[ERROR] Diarization enabled but provider is None!");
                let error_msg = "Diarization is enabled but no provider is selected. Please select 'pyannote' or 'sherpa-onnx' provider.";
                let _ = app.emit("transcription-error", serde_json::json!({
                    "taskId": task_id,
                    "error": error_msg,
                }));
                return Err(AppError::PythonError(error_msg.to_string()));
            }
            Some(provider) if provider == "none" => {
                eprintln!("[ERROR] Diarization enabled but provider is 'none'!");
                let error_msg = "Diarization is enabled but provider is set to 'none'. Please select 'pyannote' or 'sherpa-onnx' provider.";
                let _ = app.emit("transcription-error", serde_json::json!({
                    "taskId": task_id,
                    "error": error_msg,
                }));
                return Err(AppError::PythonError(error_msg.to_string()));
            }
            Some(provider) => {
                eprintln!("[INFO] Diarization validated with provider: {}", provider);
            }
        }
    }

    let mut manager = task_manager.lock().await;

    // Calculate max concurrent tasks based on current task's model
    let model_size = get_model_size(&options.model);
    let max_concurrent = get_max_concurrent_tasks(&options.device, model_size);

    if manager.running_tasks.len() >= max_concurrent {
        // Queue the task
        enqueue_task(&mut manager.queued_tasks, QueuedTask {
            id: task_id,
            file_path,
            options,
        });
        return Ok(());
    }

    // Clone Arc for spawned task
    let task_manager_arc = (*task_manager).clone();
    let task_id_clone = task_id.clone();

    // Spawn the task
    let app_clone = app.clone();
    let task_id_for_spawn = task_id.clone();
    let file_path_clone = file_path.clone();
    let options_clone = options.clone();

    let task_id_for_error = task_id.clone();
    let app_clone_for_error = app_clone.clone();
    let app_clone_for_next = app.clone();

    let child_process = Arc::new(Mutex::new(None));
    let child_process_clone = child_process.clone();
    let child_process_for_task = child_process.clone();
    
    let handle = tokio::spawn(async move {
        let result = spawn_transcription(
            app_clone,
            task_id_for_spawn,
            file_path_clone,
            options_clone,
            child_process_clone,
        ).await;

        if let Err(e) = result {
            eprintln!("Transcription error: {}", e);

            let _ = app_clone_for_error.emit("transcription-error", serde_json::json!({
                "taskId": task_id_for_error,
                "error": e.to_string(),
            }));
        }

        let should_process_next = {
            let mut manager = task_manager_arc.lock().await;
            should_process_next_after_cleanup(&mut manager, &task_id_clone)
        };

        if should_process_next {
            spawn_queue_processor(app_clone_for_next, task_manager_arc.clone());
        }
    });

    manager.running_tasks.insert(task_id, RunningTask {
        handle,
        child_process: child_process_for_task,
    });

    Ok(())
}

/// Cancel a running transcription task
#[tauri::command]
async fn cancel_transcription(
    task_manager: State<'_, TaskManagerState>,
    rust_handles: State<'_, RustTaskHandles>,
    task_id: String,
) -> Result<(), AppError> {
    let mut manager = task_manager.lock().await;
    
    if let Some(running_task) = manager.running_tasks.remove(&task_id) {
        // HIGH-1: Kill the child process first
        let mut child = running_task.child_process.lock().await;
        if let Some(mut proc) = child.take() {
            let _ = proc.start_kill();
            let _ = proc.wait().await;
        }
        drop(child);
        
        running_task.handle.abort();
        return Ok(());
    }
    
    // Check if it's queued
    manager.queued_tasks.retain(|t| t.id != task_id);
    drop(manager);

    // Abort active Rust transcribe-rs task if present
    if let Some(handle) = rust_handles.lock().await.remove(&task_id) {
        eprintln!("[INFO] Aborting Rust transcription task: {}", task_id);
        handle.abort();
    }

    Ok(())
}

/// Get the current queue status
#[tauri::command]
async fn get_queue_status(
    task_manager: State<'_, TaskManagerState>,
) -> Result<serde_json::Value, AppError> {
    let manager = task_manager.lock().await;
    
    Ok(serde_json::json!({
        "running": manager.running_tasks.len(),
        "queued": manager.queued_tasks.len(),
    }))
}

/// Test the Python engine connection
#[tauri::command]
async fn run_python_engine(app: AppHandle) -> Result<String, AppError> {
    let engine_path = get_python_engine_path(&app);
    let python_exe = get_python_executable(&app);
    
    let output = create_hidden_command(&python_exe)
        .arg(&engine_path)
        .arg("--test")
        .output()
        .await?;
    
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    
    if !output.status.success() {
        return Err(AppError::PythonError(format!(
            "Python engine failed: {}",
            stderr
        )));
    }
    
    Ok(stdout)
}

/// Check if CUDA is available
#[tauri::command]
async fn check_cuda_available(app: AppHandle) -> Result<bool, AppError> {
    let python_exe = get_python_executable(&app);
    
    let output = create_hidden_command(&python_exe)
        .arg("-c")
        .arg("import torch; print(torch.cuda.is_available())")
        .output()
        .await?;
    
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(stdout.trim() == "True")
}

/// Get available compute devices (CUDA, MPS, CPU)
///
/// # Arguments
/// * `app` - Tauri app handle
/// * `refresh` - If true, bypass cache and re-detect devices. If false, return cached result if available.
///
/// # Behavior
/// - First call or `refresh=true`: Runs Python PyTorch device detection and caches result
/// - Subsequent calls with `refresh=false`: Returns cached result instantly
/// - Cache persists for the app session (until app restart)
#[tauri::command]
async fn get_available_devices(app: AppHandle, refresh: bool) -> Result<DevicesResponse, AppError> {
    // Get or initialize the global cache
    let cache = DEVICE_CACHE.get_or_init(|| Arc::new(Mutex::new(None)));

    // If not forcing refresh, try to return cached result
    if !refresh {
        let cached = cache.lock().await;
        if let Some(ref devices) = *cached {
            eprintln!("[DEBUG] get_available_devices: returning cached result");
            return Ok(devices.clone());
        }
        // cached is None, fall through to detection
        drop(cached);
    }

    eprintln!("[DEBUG] get_available_devices: running device detection (refresh={})", refresh);

    let python_exe = get_python_executable(&app);
    eprintln!("[DEBUG] get_available_devices: python_exe = {:?}", python_exe);

    // Run Python script to detect devices
    let script = r#"
import json
import sys

try:
    import torch
    
    devices = []
    
    # Check CUDA
    cuda_available = torch.cuda.is_available()
    cuda_device = {
        "deviceType": "cuda",
        "name": "CPU Fallback",
        "available": False,
        "memoryMb": None,
        "computeCapability": None,
        "isRecommended": False
    }
    if cuda_available:
        gpu_name = torch.cuda.get_device_name(0)
        gpu_memory = torch.cuda.get_device_properties(0).total_memory // (1024 * 1024)
        capability = f"{torch.cuda.get_device_properties(0).major}.{torch.cuda.get_device_properties(0).minor}"
        cuda_device = {
            "deviceType": "cuda",
            "name": gpu_name,
            "available": True,
            "memoryMb": gpu_memory,
            "computeCapability": capability,
            "isRecommended": True
        }
    devices.append(cuda_device)
    
    # Check MPS (Apple Silicon)
    mps_available = hasattr(torch.backends, 'mps') and torch.backends.mps.is_available()
    mps_device = {
        "deviceType": "mps",
        "name": "Apple Silicon",
        "available": mps_available,
        "memoryMb": None,
        "computeCapability": None,
        "isRecommended": False
    }
    if mps_available and not cuda_available:
        mps_device["isRecommended"] = True
    devices.append(mps_device)
    
    # CPU is always available
    cpu_device = {
        "deviceType": "cpu",
        "name": "CPU",
        "available": True,
        "memoryMb": None,
        "computeCapability": None,
        "isRecommended": not (cuda_available or mps_available)
    }
    devices.append(cpu_device)
    
    # Determine recommended device
    recommended = "cpu"
    if cuda_available:
        recommended = "cuda"
    elif mps_available:
        recommended = "mps"
    
    result = {
        "devices": devices,
        "recommended": recommended
    }
    print(json.dumps(result))
    
except Exception as e:
    error_result = {
        "devices": [{
            "deviceType": "cpu",
            "name": "CPU (Error Fallback)",
            "available": True,
            "memoryMb": None,
            "computeCapability": None,
            "isRecommended": True
        }],
        "recommended": "cpu"
    }
    print(json.dumps(error_result))
"#;
    
    let output = create_hidden_command(&python_exe)
        .arg("-c")
        .arg(script)
        .output()
        .await?;
    
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    
    // Parse JSON response
    let response: DevicesResponse = serde_json::from_str(&stdout)
        .map_err(|e| AppError::JsonError(DeError::custom(format!(
            "Failed to parse device info: {}. Output: {}",
            e, stdout
        ))))?;

    // Update cache with fresh result
    *cache.lock().await = Some(response.clone());
    eprintln!("[DEBUG] get_available_devices: cached result");

    Ok(response)
}

/// Select media files using native dialog
#[tauri::command]
async fn select_media_files(app: AppHandle) -> Result<Vec<String>, AppError> {
    let files = app
        .dialog()
        .file()
        .set_title("Select Media Files")
        .add_filter("Media Files", &["mp3", "mp4", "wav", "m4a", "flac", "ogg", "webm", "mov", "avi", "mkv"])
        .add_filter("Audio Files", &["mp3", "wav", "m4a", "flac", "ogg"])
        .add_filter("Video Files", &["mp4", "webm", "mov", "avi", "mkv"])
        .add_filter("All Files", &["*"])
        .blocking_pick_files();
    
    match files {
        Some(paths) => {
            let file_paths: Vec<String> = paths
                .into_iter()
                .map(|path| path.to_string())
                .collect();
            Ok(file_paths)
        }
        None => Ok(vec![]),
    }
}

/// Check if we should show speaker information
/// Returns false if all speakers are None or if there's only one unique speaker
fn should_show_speaker(segments: &[TranscriptionSegment]) -> bool {
    use std::collections::HashSet;
    
    let speakers: HashSet<_> = segments
        .iter()
        .filter_map(|s| s.speaker.as_ref())
        .collect();
    
    // Show speaker if there are multiple different speakers
    speakers.len() > 1
}

/// Export transcription to a file
#[tauri::command]
async fn export_transcription(
    result: TranscriptionResult,
    format: String,
    output_path: String,
    export_mode: Option<String>,
) -> Result<(), AppError> {
    let export_mode = export_mode.as_deref().unwrap_or("with_timestamps");
    let show_speaker = should_show_speaker(&result.segments);
    
    let content = match format.as_str() {
        "json" => serde_json::to_string_pretty(&result)?,
        "txt" => {
            match export_mode {
                "plain_text" => {
                    // Plain text: join all segments with space, no timestamps, no speakers
                    result.segments
                        .iter()
                        .map(|s| s.text.clone())
                        .collect::<Vec<_>>()
                        .join(" ")
                }
                _ => {
                    // With timestamps: show time and speaker (if multiple speakers)
                    result.segments
                        .iter()
                        .map(|s| {
                            let time = format_time(s.start);
                            if show_speaker {
                                let speaker = s.speaker.as_deref().unwrap_or("Speaker");
                                format!("[{}] {}: {}", time, speaker, s.text)
                            } else {
                                format!("[{}] {}", time, s.text)
                            }
                        })
                        .collect::<Vec<_>>()
                        .join("\n")
                }
            }
        }
        "srt" => {
            result.segments
                .iter()
                .enumerate()
                .map(|(i, s)| {
                    format!(
                        "{}\n{} --> {}\n{}\n",
                        i + 1,
                        format_srt_time(s.start),
                        format_srt_time(s.end),
                        s.text
                    )
                })
                .collect::<Vec<_>>()
                .join("\n")
        }
        "vtt" => {
            let mut lines = vec!["WEBVTT".to_string(), "".to_string()];
            lines.extend(result.segments.iter().enumerate().map(|(i, s)| {
                format!(
                    "{}\n{} --> {}\n{}\n",
                    i + 1,
                    format_vtt_time(s.start),
                    format_vtt_time(s.end),
                    s.text
                )
            }));
            lines.join("\n")
        }
        "md" => {
            match export_mode {
                "plain_text" => {
                    // Plain text: join all segments with space, no timestamps, no speakers
                    result.segments
                        .iter()
                        .map(|s| s.text.clone())
                        .collect::<Vec<_>>()
                        .join(" ")
                }
                _ => {
                    // With timestamps: show time and speaker (if multiple speakers)
                    result.segments
                        .iter()
                        .map(|s| {
                            let time = format_time(s.start);
                            if show_speaker {
                                let speaker = s.speaker.as_deref().unwrap_or("Speaker");
                                format!("**[{}]** **{}:** {}", time, speaker, s.text)
                            } else {
                                format!("**[{}]** {}", time, s.text)
                            }
                        })
                        .collect::<Vec<_>>()
                        .join("\n")
                }
            }
        }
        _ => return Err(AppError::PythonError(format!("Unknown format: {}", format))),
    };

    std::fs::write(&output_path, content)?;

    Ok(())
}

/// Format time for TXT and MD formats (HH:MM:SS or MM:SS)
fn format_time(seconds: f64) -> String {
    let hours = (seconds / 3600.0) as u32;
    let minutes = ((seconds % 3600.0) / 60.0) as u32;
    let secs = (seconds % 60.0) as u32;

    if hours > 0 {
        format!("{:02}:{:02}:{:02}", hours, minutes, secs)
    } else {
        format!("{:02}:{:02}", minutes, secs)
    }
}

/// Format time for VTT format (HH:MM:SS.mmm)
fn format_vtt_time(seconds: f64) -> String {
    let hours = (seconds / 3600.0) as u32;
    let minutes = ((seconds % 3600.0) / 60.0) as u32;
    let secs = (seconds % 60.0) as u32;
    let millis = ((seconds % 1.0) * 1000.0) as u32;

    format!("{:02}:{:02}:{:02}.{:03}", hours, minutes, secs, millis)
}

/// Format time for SRT format
fn format_srt_time(seconds: f64) -> String {
    let hours = (seconds / 3600.0) as u32;
    let minutes = ((seconds % 3600.0) / 60.0) as u32;
    let secs = (seconds % 60.0) as u32;
    let millis = ((seconds % 1.0) * 1000.0) as u32;
    
    format!("{:02}:{:02}:{:02},{:03}", hours, minutes, secs, millis)
}

/// Get the models directory path
fn get_models_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::IoError(std::io::Error::new(std::io::ErrorKind::Other, "Failed to get app data dir")))?;

    let models_dir = app_data.join("Vocrify").join("models");

    std::fs::create_dir_all(&models_dir)
        .map_err(|e| AppError::IoError(e))?;

    // Get absolute path and remove Windows extended-length path prefix (\\?\)
    // faster-whisper cannot handle paths with this prefix
    let normalized = dunce::simplified(&models_dir).to_path_buf();

    eprintln!("[DEBUG] Models dir - original: {:?}, normalized: {:?}", models_dir, normalized);

    Ok(normalized)
}

/// Get the models store path
fn get_store_path(app: &AppHandle) -> PathBuf {
    let app_data = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));

    app_data.join("Vocrify").join("store.json")
}

/// Get the HuggingFace token from the store
async fn get_huggingface_token(app: &AppHandle) -> Result<Option<String>, AppError> {
    let store_path = get_store_path(app);

    if !store_path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&store_path)
        .map_err(|e| AppError::IoError(e))?;

    let store_data: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| AppError::JsonError(e))?;

    Ok(store_data.get("huggingFaceToken")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string()))
}

/// Save HuggingFace token to the store
#[tauri::command]
async fn save_huggingface_token(app: AppHandle, token: String) -> Result<(), AppError> {
    let store_path = get_store_path(&app);
    let fallback = PathBuf::from(".");
    let store_dir = store_path.parent().unwrap_or(&fallback);

    std::fs::create_dir_all(store_dir)
        .map_err(|e| AppError::IoError(e))?;

    // Read existing store data if it exists
    let mut store_data: serde_json::Value = if store_path.exists() {
        let content = std::fs::read_to_string(&store_path)
            .map_err(|e| AppError::IoError(e))?;
        serde_json::from_str(&content)
            .map_err(|e| AppError::JsonError(e))?
    } else {
        serde_json::json!({})
    };

    // Update the token
    store_data["huggingFaceToken"] = serde_json::Value::String(token);

    std::fs::write(&store_path, store_data.to_string())
        .map_err(|e| AppError::IoError(e))?;

    Ok(())
}

/// Get HuggingFace token from the store
#[tauri::command]
async fn get_huggingface_token_command(app: AppHandle) -> Result<Option<String>, AppError> {
    get_huggingface_token(&app).await
}

// ============================================================================
// Audio Processing Commands (Rust-native audio module)
// ============================================================================

/// Audio information response
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioInfo {
    pub sample_rate: u32,
    pub channels: u16,
    pub duration: f64,
    pub format: String,
}

/// Convert audio file to WAV format (16kHz mono)
#[tauri::command]
async fn convert_audio_to_wav(
    input_path: String,
    output_path: String,
) -> Result<AudioInfo, String> {
    let input = PathBuf::from(&input_path);
    let output = PathBuf::from(&output_path);

    eprintln!("[AUDIO CMD] Converting {:?} to WAV at {:?}", input, output);

    // Validate input path
    if !input.exists() {
        return Err(format!("Input file does not exist: {}", input_path));
    }

    // Convert audio to WAV format
    let audio = crate::audio::converter::convert_to_wav(&input, &output)
        .map_err(|e| format!("Failed to convert audio: {}", e))?;

    Ok(AudioInfo {
        sample_rate: audio.sample_rate,
        channels: audio.channels,
        duration: audio.duration(),
        format: "wav".to_string(),
    })
}

/// Get audio file duration
#[tauri::command]
async fn get_audio_duration(file_path: String) -> Result<f64, String> {
    let path = PathBuf::from(&file_path);

    if !path.exists() {
        return Err(format!("File does not exist: {}", file_path));
    }

    crate::audio::utils::get_duration(&path)
        .map_err(|e| format!("Failed to get duration: {}", e))
}

/// Extract audio segment and save as WAV
#[tauri::command]
async fn extract_audio_segment(
    file_path: String,
    start_ms: u64,
    end_ms: u64,
    output_path: String,
) -> Result<AudioInfo, String> {
    let input = PathBuf::from(&file_path);
    let output = PathBuf::from(&output_path);

    if !input.exists() {
        return Err(format!("Input file does not exist: {}", file_path));
    }

    eprintln!("[AUDIO CMD] Extracting segment from {}ms to {}ms", start_ms, end_ms);

    // Extract segment
    let segment = crate::audio::utils::slice_audio(&input, start_ms, end_ms)
        .map_err(|e| format!("Failed to extract segment: {}", e))?;

    // Save as WAV
    crate::audio::converter::save_wav(&segment, &output)
        .map_err(|e| format!("Failed to save segment: {}", e))?;

    Ok(AudioInfo {
        sample_rate: segment.sample_rate,
        channels: segment.channels,
        duration: segment.duration(),
        format: "wav".to_string(),
    })
}

/// Get audio file metadata
#[tauri::command]
async fn get_audio_metadata(file_path: String) -> Result<AudioInfo, String> {
    let path = PathBuf::from(&file_path);

    if !path.exists() {
        return Err(format!("File does not exist: {}", file_path));
    }

    let audio = crate::audio::loader::load(&path)
        .map_err(|e| format!("Failed to load audio: {}", e))?;

    Ok(AudioInfo {
        sample_rate: audio.sample_rate,
        channels: audio.channels,
        duration: audio.duration(),
        format: path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("unknown")
            .to_string(),
    })
}

/// Get models directory
#[tauri::command]
async fn get_models_dir_command(app: AppHandle) -> Result<String, AppError> {
    let models_dir = get_models_dir(&app)?;
    Ok(models_dir.to_string_lossy().to_string())
}

/// Open models directory in system file manager
#[tauri::command]
async fn open_models_folder_command(app: AppHandle) -> Result<(), AppError> {
    let models_dir = get_models_dir(&app)?;
    let models_dir_str = models_dir.to_string_lossy().to_string();

    eprintln!("[DEBUG] Opening models folder: {:?}", models_dir_str);

    // Platform-specific folder opening
    #[cfg(target_os = "windows")]
    {
        // Use explorer.exe on Windows for maximum compatibility
        std::process::Command::new("explorer")
            .arg(&models_dir_str)
            .spawn()
            .map_err(|e| AppError::IoError(e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&models_dir_str)
            .spawn()
            .map_err(|e| AppError::IoError(e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Try xdg-open first, fall back to others
        let open_result = std::process::Command::new("xdg-open")
            .arg(&models_dir_str)
            .spawn();

        if open_result.is_err() {
            // Fallback to nautilus for GNOME
            std::process::Command::new("nautilus")
                .arg(&models_dir_str)
                .spawn()
                .map_err(|e| AppError::IoError(e))?;
        }
    }

    eprintln!("[DEBUG] Successfully opened folder: {:?}", models_dir_str);
    Ok(())
}

/// Open archive directory in system file manager
#[tauri::command]
async fn open_archive_folder_command(app: AppHandle) -> Result<(), AppError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::IoError(std::io::Error::new(std::io::ErrorKind::Other, "Failed to get app data dir")))?;
    
    let archive_dir = app_data.join("archive");
    let archive_dir_str = archive_dir.to_string_lossy().to_string();

    eprintln!("[DEBUG] Opening archive folder: {:?}", archive_dir_str);

    // Create directory if it doesn't exist
    if !archive_dir.exists() {
        std::fs::create_dir_all(&archive_dir)
            .map_err(|e| AppError::IoError(e))?;
    }

    // Platform-specific folder opening
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&archive_dir_str)
            .spawn()
            .map_err(|e| AppError::IoError(e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&archive_dir_str)
            .spawn()
            .map_err(|e| AppError::IoError(e))?;
    }

    #[cfg(target_os = "linux")]
    {
        let open_result = std::process::Command::new("xdg-open")
            .arg(&archive_dir_str)
            .spawn();

        if open_result.is_err() {
            std::process::Command::new("nautilus")
                .arg(&archive_dir_str)
                .spawn()
                .map_err(|e| AppError::IoError(e))?;
        }
    }

    eprintln!("[DEBUG] Successfully opened archive folder: {:?}", archive_dir_str);
    Ok(())
}

/// Spawn a model download — Rust-native for Whisper/Parakeet/SherpaONNX, Python for PyAnnote.
///
/// # Routing
///
/// | condition                               | engine   |
/// |-----------------------------------------|----------|
/// | `diarization` + `pyannote-diarization`  | Python   |
/// | everything else                         | Rust     |
///
/// PyAnnote needs `huggingface_hub` + gated-repo access and a specific
/// local cache layout the `pyannote` library reads at runtime.
/// All other models are downloaded via `reqwest` in `model_downloader.rs`.
async fn spawn_model_download(
    app: AppHandle,
    model_name: String,
    model_type: String,
    cache_dir: PathBuf,
    token_file: Option<PathBuf>,
    child_arc: Arc<Mutex<Option<tokio::process::Child>>>,
    cancel: Arc<AtomicBool>,
) -> Result<(), AppError> {
    // ── Rust-native path ───────────────────────────────────────────────────
    let is_pyannote = model_type == "diarization" && model_name == "pyannote-diarization";
    if !is_pyannote {
        let downloader = model_downloader::ModelDownloader::new(app, cache_dir);
        return downloader
            .download(&model_name, &model_type, cancel)
            .await
            .map_err(Into::into);
    }

    // ── PyAnnote: Python subprocess ────────────────────────────────────────
    let download_completed = Arc::new(AtomicBool::new(false));

    let engine_path = get_python_engine_path(&app);
    let python_exe = get_python_executable(&app);
    let engine_dir = engine_path
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| AppError::PythonError(format!("Invalid Python engine path: {:?}", engine_path)))?;

    ensure_python_download_dependencies(&python_exe).await?;
    
    eprintln!("[DEBUG] PyAnnote download - Python: {:?}, Engine: {:?}", python_exe, engine_path);

    // Bootstrap script injects engine dir into sys.path for embeddable Python.
    let bootstrap = r#"
import runpy
import sys
from pathlib import Path
engine = Path(sys.argv[1])
sys.path.insert(0, str(engine.parent))
sys.argv = [str(engine)] + sys.argv[2:]
runpy.run_path(str(engine), run_name="__main__")
"#;
    
    let mut cmd = create_hidden_command(&python_exe);
    cmd.current_dir(&engine_dir)
        .arg("-c")
        .arg(bootstrap)
        .arg(engine_path.to_string_lossy().to_string())
        .arg("--download-model")
        .arg(&model_name)
        .arg("--cache-dir")
        .arg(cache_dir.to_string_lossy().to_string())
        .arg("--model-type")
        .arg(&model_type)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    
    // Debug: log the command being executed
    eprintln!("[DEBUG] Spawning download command: {:?}", cmd);
    eprintln!("[DEBUG] Python exe: {:?}", python_exe);
    eprintln!("[DEBUG] Engine path: {:?}", engine_path);
    eprintln!("[DEBUG] Model: {}, Type: {}, Cache: {:?}", model_name, model_type, cache_dir);
    
    // HIGH-7: Use token file instead of env var for security
    if let Some(token_path) = token_file {
        cmd.arg("--token-file").arg(token_path.to_string_lossy().to_string());
    }
    
    let mut child = cmd.spawn()
        .map_err(|e| {
            AppError::PythonError(format!("Failed to spawn Python process: {}", e))
        })?;
    
    // Check if process started successfully
    println!("[DEBUG] Checking if process started successfully...");
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    
    match child.try_wait() {
        Ok(Some(exit_status)) => {
            println!("[DEBUG] Process exited immediately with status: {:?}", exit_status);
            let output = child
                .wait_with_output()
                .await
                .map_err(AppError::IoError)?;
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            let details = if !stderr.trim().is_empty() {
                stderr.trim().to_string()
            } else if !stdout.trim().is_empty() {
                stdout.trim().to_string()
            } else {
                "no additional output".to_string()
            };
            return Err(AppError::PythonError(format!(
                "Python process exited immediately ({:?}): {}",
                exit_status, details
            )));
        }
        Ok(None) => {
            println!("[DEBUG] Process appears to be running");
        }
        Err(e) => {
            println!("[DEBUG] Error checking process status: {}", e);
            return Err(AppError::PythonError(format!("Error checking Python process: {}", e)));
        }
    }
    
    // Take stdout/stderr before moving child into scopeguard
    let stdout = child.stdout.take().expect("Failed to capture stdout");
    let stderr = child.stderr.take().expect("Failed to capture stderr");
    
    // Store child in shared Arc so cancel_model_download can kill it.
    {
        let mut guard = child_arc.lock().await;
        *guard = Some(child);
    }

    // CRITICAL FIX: Use scopeguard to ensure process cleanup on panic/unwind.
    // Pull the child back out of the Arc — we own it for the rest of this function.
    let raw_child = {
        let mut guard = child_arc.lock().await;
        guard.take()
    };
    let child_guard = scopeguard::guard(raw_child, |opt_child| {
        if let Some(mut c) = opt_child {
            let _ = c.start_kill();
        }
    });
    let mut reader = BufReader::new(stdout).lines();
    let mut stderr_reader = BufReader::new(stderr).lines();
    
    // Read stderr in background and emit errors to frontend
    let app_clone = app.clone();
    let model_name_clone = model_name.clone();
    let download_completed_for_stderr = download_completed.clone();
    let _stderr_handle = tokio::spawn(async move {
        let mut line_count = 0;
        let mut error_buffer = String::new();
        while let Ok(Some(line)) = stderr_reader.next_line().await {
            line_count += 1;
            println!("[PYTHON STDERR] Line {}: {}", line_count, line);
            error_buffer.push_str(&line);
            error_buffer.push('\n');
            
            // Emit error only for actual errors, not for warnings or info
            // Look for specific patterns that indicate real failures
            let line_lower = line.to_lowercase();
            let is_actual_error = line_lower.contains("error:")
                || line_lower.contains("error: ")
                || line_lower.starts_with("error")
                || line_lower.contains("failed:")
                || line_lower.starts_with("failed")
                || line_lower.contains("traceback")
                || line_lower.contains("exception:");

            // Detect retryable network errors (temporary issues that tenacity will retry)
            let is_retryable_error = line_lower.contains("connectionerror")
                || line_lower.contains("connection error")
                || line_lower.contains("timeout")
                || line_lower.contains("connectionreset")
                || line_lower.contains("connection aborted")
                || line_lower.contains("retry");

            if is_actual_error {
                if is_retryable_error {
                    // Retryable error: emit retrying event instead of fatal error
                    // UI should keep showing "downloading" status
                    let _ = app_clone.emit("model-download-retrying", serde_json::json!({
                        "modelName": &model_name_clone,
                        "message": format!("Retrying due to network error..."),
                    }));
                    eprintln!("[INFO] Retryable error detected for {}, emitting retrying event", model_name_clone);
                } else if !download_completed_for_stderr.load(Ordering::Relaxed) {
                    // Avoid hard-failing from stderr heuristics; authoritative errors are
                    // structured JSON "error" messages from Python stdout or non-zero exit.
                    eprintln!(
                        "[WARN] Potential stderr error for {}: {}",
                        model_name_clone,
                        line
                    );
                }
            }
        }
        
        println!("[DEBUG] stderr reader finished. Total lines: {}", line_count);
        // Only emit errors for critical issues, not for warnings or debug logs
        // Real errors are already emitted above when detected
    });
    
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
                println!("[DEBUG] Received Python message: {}", msg);
                
                // Handle debug messages (don't process as errors)
                if msg.get("type") == Some(&serde_json::json!("debug")) {
                    println!("[DEBUG] Debug message: {:?}", msg.get("message"));
                    continue;
                }

                let msg_type = msg
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();

                if msg_type == "progress" {
                    if let Some(progress_data) = msg.get("data") {
                        let current_mb_f = progress_data
                            .get("current")
                            .and_then(|v| v.as_f64())
                            .unwrap_or(0.0);
                        let total_mb_f = progress_data
                            .get("total")
                            .and_then(|v| v.as_f64())
                            .unwrap_or(0.0);
                        let mut percent = progress_data
                            .get("percent")
                            .and_then(|v| v.as_f64())
                            .unwrap_or(0.0);

                        // Fallback: compute percent from current/total when available
                        if percent <= 0.0 && total_mb_f > 0.0 && current_mb_f > 0.0 {
                            percent = (current_mb_f / total_mb_f * 100.0).clamp(0.0, 100.0);
                        }

                        let progress = ModelDownloadProgress {
                            model_name: model_name.clone(),
                            current_mb: current_mb_f.max(0.0).round() as u64,
                            total_mb: total_mb_f.max(0.0).round() as u64,
                            percent,
                            speed_mb_s: progress_data.get("speed_mb_s").and_then(|v| v.as_f64()).unwrap_or(0.0),
                            status: "downloading".to_string(),
                            eta_s: progress_data.get("eta_s").and_then(|v| v.as_f64()),
                            total_estimated: progress_data.get("total_estimated").and_then(|v| v.as_bool()).unwrap_or(false),
                        };

                        println!("[DEBUG] Emitting progress: {}% for {}", progress.percent, model_name);
                        let _ = app.emit("model-download-progress", progress);
                    }
                }

                if msg_type == "download_stage" {
                    if let Some(stage_data) = msg.get("data") {
                        let _ = app.emit("model-download-stage", serde_json::json!({
                            "modelName": model_name,
                            "stage": stage_data.get("stage").and_then(|v| v.as_str()).unwrap_or(""),
                            "submodelName": stage_data.get("submodel_name").and_then(|v| v.as_str()).unwrap_or(""),
                            "currentMb": stage_data.get("current").and_then(|v| v.as_f64()).unwrap_or(0.0),
                            "totalMb": stage_data.get("total").and_then(|v| v.as_f64()).unwrap_or(0.0),
                            "percent": stage_data.get("percent").and_then(|v| v.as_f64()).unwrap_or(0.0),
                            "speedMbS": stage_data.get("speed_mb_s").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        }));
                    }
                }

                if msg_type == "DownloadComplete" {
                    println!("[DEBUG] Download complete emitted for {}", model_name);
                    download_completed.store(true, Ordering::Relaxed);
                    // Extract data from DownloadComplete message
                    let size_mb = msg.get("data")
                        .and_then(|d| d.get("size_mb"))
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    let path = msg.get("data")
                        .and_then(|d| d.get("path"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    
                    println!("[DEBUG] Download complete details - size: {}MB, path: {}", size_mb, path);
                    
                    let _ = app.emit("model-download-complete", serde_json::json!({
                        "modelName": model_name,
                        "size": size_mb,
                        "path": path,
                    }));
                }

                if msg_type == "error" {
                    let error_msg = msg.get("error").and_then(|v| v.as_str()).unwrap_or("Unknown error");
                    println!("[DEBUG] Error emitted from Python: {}", error_msg);
                    let _ = app.emit("model-download-error", serde_json::json!({
                        "modelName": model_name,
                        "error": error_msg,
                    }));
                    return Err(AppError::ModelError(error_msg.to_string()));
                }
            }
            Err(e) => {
                eprintln!("Failed to parse Python output: {} - line: {}", e, line);
            }
        }
    }
    
    // Release the guard. child_guard wraps Option<Child> since cancel may have taken it.
    match scopeguard::ScopeGuard::into_inner(child_guard) {
        None => {
            // Process was taken by cancel_model_download — nothing to wait on.
            eprintln!("[INFO] PyAnnote download for '{}' was cancelled (no child to wait)", model_name);
            return Ok(());
        }
        Some(mut child) => {
            let status = child.wait().await.map_err(AppError::IoError)?;
            if !status.success() {
                let exit_code = status.code().unwrap_or(-1);
                if download_completed.load(Ordering::Relaxed) {
                    eprintln!(
                        "[WARN] Python exited with code {} after DownloadComplete for {}. Treating as success.",
                        exit_code,
                        model_name
                    );
                    return Ok(());
                }
                let error_msg = format!(
                    "Model download failed with exit code: {}. \
                    Check your internet connection and HuggingFace token. \
                    See application logs for detailed error output.",
                    exit_code
                );
                println!("[DEBUG] {}", error_msg);
                return Err(AppError::PythonError(error_msg));
            }
        }
    }

    Ok(())
}

/// Download a model
#[tauri::command]
async fn download_model(
    app: AppHandle,
    task_manager: State<'_, TaskManagerState>,
    model_name: String,
    model_type: String,
    hugging_face_token: Option<String>,
) -> Result<String, AppError> {
    // ── Pre-flight check ──────────────────────────────────────────────────────
    {
        let manager = task_manager.lock().await;
        if manager.downloading_models.len() >= MAX_CONCURRENT_DOWNLOADS {
            return Err(AppError::ModelError("Maximum concurrent downloads reached".to_string()));
        }
        if manager.downloading_models.contains_key(&model_name) {
            return Err(AppError::ModelError(format!("Download already in progress for: {}", model_name)));
        }
    }

    let models_dir = get_models_dir(&app)?;

    // Create secure temp file for HuggingFace token (PyAnnote path only)
    let token_file = if let Some(token) = hugging_face_token {
        Some(pass_token_securely(&token)?)
    } else {
        None
    };

    // Shared state for cancel support
    let child_arc: Arc<Mutex<Option<tokio::process::Child>>> = Arc::new(Mutex::new(None));
    let cancel_token: Arc<AtomicBool> = Arc::new(AtomicBool::new(false));

    // Clones for spawned task
    let task_manager_clone = (*task_manager).clone();
    let app_clone = app.clone();
    let model_name_clone = model_name.clone();
    let model_type_clone = model_type.clone();
    let cache_dir = models_dir.clone();
    let token_file_clone = token_file.clone();
    let token_file_for_cleanup = token_file;
    let child_arc_for_task = child_arc.clone();
    let cancel_token_for_task = cancel_token.clone();

    let handle = tokio::spawn(async move {
        let app_for_events = app_clone.clone();

        let download_result = spawn_model_download(
            app_clone,
            model_name_clone.clone(),
            model_type_clone,
            cache_dir,
            token_file_clone,
            child_arc_for_task,
            cancel_token_for_task,
        ).await;

        // Cleanup token file regardless of outcome
        if let Some(path) = token_file_for_cleanup {
            let _ = std::fs::remove_file(path);
        }

        // Remove from all tracking maps
        {
            let mut manager = task_manager_clone.lock().await;
            manager.downloading_models.remove(&model_name_clone);
            manager.downloading_processes.remove(&model_name_clone);
            manager.cancel_tokens.remove(&model_name_clone);
        }

        match download_result {
            Ok(_) => {
                eprintln!("[INFO] Model download complete: {}", model_name_clone);
            }
            Err(e) => {
                let error_text = e.to_string();
                eprintln!("[ERROR] Model download failed for {}: {}", model_name_clone, error_text);
                let _ = app_for_events.emit("model-download-error", serde_json::json!({
                    "modelName": model_name_clone,
                    "error": error_text,
                }));
            }
        }
    });

    // Register in all tracking maps
    {
        let mut manager = task_manager.lock().await;
        manager.downloading_models.insert(model_name.clone(), handle);
        manager.downloading_processes.insert(model_name.clone(), child_arc);
        manager.cancel_tokens.insert(model_name.clone(), cancel_token);
    }

    Ok(model_name)
}

/// Get list of installed models
#[tauri::command]
async fn get_local_models(app: AppHandle) -> Result<Vec<LocalModel>, AppError> {
    let models_dir = get_models_dir(&app)?;
    get_local_models_internal(&models_dir).map_err(|e| AppError::ModelError(e.to_string()))
}

/// Delete a model
#[tauri::command]
async fn delete_model(
    app: AppHandle,
    model_name: String,
) -> Result<(), AppError> {
    let models_dir = get_models_dir(&app)?;

    eprintln!("Deleting model: {}", model_name);

    // Use Python to delete the model so it can clear the model pool first.
    // This prevents "os error 32" (file in use) errors on Windows.
    let engine_path = get_python_engine_path(&app);
    let python_exe = get_python_executable(&app);

    eprintln!("[DEBUG] Using Python to delete model (will clear model pool first)");

    let output = create_hidden_command(&python_exe)
        .arg(&engine_path)
        .arg("--delete-model")
        .arg(&model_name)
        .arg("--cache-dir")
        .arg(models_dir.to_string_lossy().to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| AppError::PythonError(format!("Failed to delete model via Python: {}", e)))?;

    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    if !output.status.success() {
        eprintln!("[ERROR] Python delete_model failed:\nstdout: {}\nstderr: {}", stdout, stderr);

        // Try to extract structured error from stdout JSON lines
        let error_detail = stdout
            .lines()
            .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
            .filter(|v| v.get("type").and_then(|t| t.as_str()) == Some("error"))
            .filter_map(|v| v.get("error").and_then(|e| e.as_str()).map(String::from))
            .last();

        let error_msg = error_detail.unwrap_or_else(|| stderr.clone());
        return Err(AppError::PythonError(format!("Failed to delete model: {}", error_msg)));
    }

    eprintln!("Model deleted successfully via Python: {}", model_name);

    // Give filesystem time to sync before returning success
    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

    // Clear selected model from store if the deleted model matches
    // Store format can be: "transcription:model_name" or "diarization:model_name" or legacy "model_name"
    let store_path = get_store_path(&app);
    if store_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&store_path) {
            if let Ok(store_data) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(selected) = store_data.get("selected_model").and_then(|v| v.as_str()) {
                    // Check if the deleted model matches the stored selection
                    let needs_clear = selected == &model_name ||
                        selected == &format!("transcription:{}", model_name) ||
                        selected == &format!("diarization:{}", model_name);

                    if needs_clear {
                        let fallback = PathBuf::from(".");
                        let store_dir = store_path.parent().unwrap_or(&fallback);

                        // Clear the selected_model by setting it to null
                        let cleared_data = serde_json::json!({
                            "selected_model": serde_json::Value::Null
                        });

                        if std::fs::create_dir_all(store_dir).is_ok() {
                            let _ = std::fs::write(&store_path, cleared_data.to_string());
                            eprintln!("Cleared selected model from store (deleted: {})", model_name);
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

/// Cancel a model download
#[tauri::command]
async fn cancel_model_download(
    task_manager: State<'_, TaskManagerState>,
    model_name: String,
) -> Result<(), AppError> {
    let (handle, child_arc, cancel_token) = {
        let mut manager = task_manager.lock().await;
        let handle = manager.downloading_models.remove(&model_name);
        let child_arc = manager.downloading_processes.remove(&model_name);
        let cancel_token = manager.cancel_tokens.remove(&model_name);
        (handle, child_arc, cancel_token)
    };

    if handle.is_none() && child_arc.is_none() && cancel_token.is_none() {
        return Err(AppError::ModelError(format!("Model download not found: {}", model_name)));
    }

    // 1. Signal cancel token so Rust downloader stops gracefully
    if let Some(token) = cancel_token {
        token.store(true, Ordering::Relaxed);
    }

    // 2. Kill Python child process if running (PyAnnote path)
    if let Some(arc) = child_arc {
        let mut guard = arc.lock().await;
        if let Some(child) = guard.as_mut() {
            let _ = child.start_kill();
        }
    }

    // 3. Abort the Tokio task handle last
    if let Some(h) = handle {
        h.abort();
    }

    Ok(())
}

/// Get disk usage
#[tauri::command]
async fn get_disk_usage(app: AppHandle) -> Result<DiskUsage, AppError> {
    let models_dir = get_models_dir(&app)?;
    
    let total_size_mb = if models_dir.exists() {
        let mut total_size = 0u64;
        for dir_entry in std::fs::read_dir(&models_dir)? {
            let dir_entry = dir_entry?;
            if let Ok(metadata) = dir_entry.metadata() {
                if metadata.is_dir() {
                    for sub_entry in std::fs::read_dir(dir_entry.path())? {
                        if let Ok(sub_meta) = sub_entry?.metadata() {
                            total_size += sub_meta.len();
                        }
                    }
                } else {
                    total_size += metadata.len();
                }
            }
        }
        total_size / (1024 * 1024)
    } else {
        0
    };
    
    let free_space_mb = {
        if let Some(_dir) = models_dir.parent() {
            // Calculate approximate free space (this is a simplified version)
            // For accurate disk space, you may need to use a crate like `sysinfo`
            0u64
        } else {
            0u64
        }
    };
    
    Ok(DiskUsage {
        total_size_mb,
        free_space_mb,
    })
}

/// Clear model cache directories
#[tauri::command]
async fn clear_cache(app: AppHandle) -> Result<(), AppError> {
    let models_dir = get_models_dir(&app)?;

    // Directories to clear
    let cache_dirs = vec![
        models_dir.join(".hf_cache"),
        models_dir.join("hf_cache"),
    ];

    let mut cleared_count = 0;
    let mut error_count = 0;

    for cache_dir in cache_dirs {
        if cache_dir.exists() {
            match std::fs::remove_dir_all(&cache_dir) {
                Ok(_) => {
                    eprintln!("[INFO] Cleared cache directory: {:?}", cache_dir);
                    cleared_count += 1;
                }
                Err(e) => {
                    eprintln!("[WARN] Failed to clear cache directory {:?}: {}", cache_dir, e);
                    error_count += 1;
                }
            }
        }
    }

    if cleared_count == 0 && error_count == 0 {
        eprintln!("[INFO] No cache directories found to clear");
    } else {
        eprintln!("[INFO] Cache clear completed: {} cleared, {} errors", cleared_count, error_count);
    }

    Ok(())
}

/// Save selected model to store
#[tauri::command]
async fn save_selected_model(app: AppHandle, model: String) -> Result<(), AppError> {
    let store_path = get_store_path(&app);
    let fallback = PathBuf::from(".");
    let store_dir = store_path.parent().unwrap_or(&fallback);
    
    std::fs::create_dir_all(store_dir)
        .map_err(|e| AppError::IoError(e))?;
    
    let store_data = serde_json::json!({
        "selected_model": model,
    });
    
    std::fs::write(&store_path, store_data.to_string())
        .map_err(|e| AppError::IoError(e))?;
    
    Ok(())
}

/// Load selected model from store
#[tauri::command]
async fn load_selected_model(app: AppHandle) -> Result<Option<String>, AppError> {
    let store_path = get_store_path(&app);

    if !store_path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&store_path)
        .map_err(|e| AppError::IoError(e))?;

    let store_data: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| AppError::JsonError(e))?;

    Ok(store_data.get("selected_model").and_then(|v| v.as_str().map(|s| s.to_string())))
}

/// File metadata structure
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub exists: bool,
}

/// Get file metadata including size
#[tauri::command]
async fn get_files_metadata(file_paths: Vec<String>) -> Result<Vec<FileMetadata>, AppError> {
    let mut metadata_list = Vec::new();

    for file_path in file_paths {
        let path = Path::new(&file_path);

        if !path.exists() {
            metadata_list.push(FileMetadata {
                path: file_path.clone(),
                name: path.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| file_path.clone()),
                size: 0,
                exists: false,
            });
            continue;
        }

        let metadata = std::fs::metadata(&path)
            .map_err(|e| AppError::IoError(e))?;

        let file_name = path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| file_path.clone());

        metadata_list.push(FileMetadata {
            path: file_path,
            name: file_name,
            size: metadata.len(),
            exists: true,
        });
    }

    Ok(metadata_list)
}

// ============================================================================
// Setup Wizard Persistence Functions
// ============================================================================

const SETUP_STATE_SCHEMA_VERSION: u32 = 1;

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Get the path to the structured setup state file.
fn get_setup_state_path(app: &AppHandle) -> PathBuf {
    let app_data = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    app_data.join("setup_state.json")
}

/// Legacy marker used by older builds.
fn get_legacy_setup_flag_path(app: &AppHandle) -> PathBuf {
    let app_data = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    app_data.join("Vocrify").join(".setup_complete")
}

fn load_setup_state(app: &AppHandle) -> Option<SetupState> {
    let path = get_setup_state_path(app);
    if !path.exists() {
        return None;
    }

    let content = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str::<SetupState>(&content).ok()
}

fn persist_setup_state(app: &AppHandle, state: &SetupState) -> Result<(), String> {
    let path = get_setup_state_path(app);
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return Err(format!("Failed to create setup directory: {}", e));
        }
    }

    let json = serde_json::to_string_pretty(state)
        .map_err(|e| format!("Failed to serialize setup state: {}", e))?;
    std::fs::write(&path, json)
        .map_err(|e| format!("Failed to write setup state: {}", e))?;

    eprintln!("[INFO] Setup state saved at: {:?}", path);
    Ok(())
}

fn mark_setup_complete_impl(
    app: &AppHandle,
    readiness: &RuntimeReadinessStatus,
    completed_at: Option<String>,
    python_executable: Option<String>,
    ffmpeg_path: Option<String>,
) -> Result<(), String> {
    let state = SetupState {
        schema_version: SETUP_STATE_SCHEMA_VERSION,
        runtime_ready: readiness.ready,
        last_verified_at: readiness.checked_at.clone(),
        completed_at,
        python_executable,
        ffmpeg_path,
    };

    persist_setup_state(app, &state)
}

fn update_runtime_state_impl(
    app: &AppHandle,
    readiness: &RuntimeReadinessStatus,
    python_executable: Option<String>,
    ffmpeg_path: Option<String>,
) -> Result<(), String> {
    let existing = load_setup_state(app);
    // Preserve existing completed_at regardless of current runtime readiness
    // Once setup is completed, it stays completed even if runtime has issues
    let completed_at = existing
        .and_then(|state| state.completed_at)
        .or_else(|| {
            if readiness.ready {
                Some(now_rfc3339())
            } else {
                None
            }
        });

    mark_setup_complete_impl(
        app,
        readiness,
        completed_at,
        python_executable,
        ffmpeg_path,
    )
}

/// Reset setup by removing the state file and legacy marker.
fn reset_setup_impl(app: &AppHandle) -> Result<(), String> {
    let state_path = get_setup_state_path(app);
    if state_path.exists() {
        std::fs::remove_file(&state_path)
            .map_err(|e| format!("Failed to remove setup state file: {}", e))?;
        eprintln!("[INFO] Setup reset - state file removed");
    }

    let legacy_path = get_legacy_setup_flag_path(app);
    if legacy_path.exists() {
        std::fs::remove_file(&legacy_path)
            .map_err(|e| format!("Failed to remove legacy setup flag: {}", e))?;
        eprintln!("[INFO] Setup reset - legacy flag file removed");
    }

    Ok(())
}

// ============================================================================
// Setup Wizard Tauri Commands
// ============================================================================

fn is_python_runtime_ready(check: &PythonCheckResult) -> bool {
    check.status == "ok" && check.pytorch_installed && check.version.is_some()
}

fn is_ffmpeg_runtime_ready(check: &FFmpegCheckResult) -> bool {
    check.installed && check.status != "error"
}

async fn run_python_environment_check_impl(app: &AppHandle) -> Result<PythonCheckResult, String> {
    let engine_path = get_python_engine_path(app);
    let python_exe = get_python_executable(app);
    let engine_dir = engine_path
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| format!("Invalid engine path: {:?}", engine_path))?;
    
    eprintln!("[INFO] Checking Python environment...");
    eprintln!("[DEBUG] Python exe: {:?}", python_exe);
    eprintln!("[DEBUG] Engine path: {:?}", engine_path);
    
    let check_code = r#"
import json, sys
from pathlib import Path
engine_dir = Path(sys.argv[1])
sys.path.insert(0, str(engine_dir))
from environment_checks import check_python_environment
print(json.dumps(check_python_environment()), flush=True)
"#;

    let output = python_installer::create_hidden_command(&python_exe)
        .current_dir(&engine_dir)
        .arg("-c")
        .arg(check_code)
        .arg(engine_dir.to_string_lossy().to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to execute Python: {}", e))?;
    
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    
    if !output.status.success() {
        eprintln!("[ERROR] Python check failed: {}", stderr);
        return Err(format!("Python check failed: {}", stderr));
    }
    
    // Parse JSON response
    let result: PythonCheckResult = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse Python check result: {}. Output: {}", e, stdout))?;
    
    eprintln!("[INFO] Python check complete: status={}", result.status);
    Ok(result)
}

async fn run_ffmpeg_status_check_impl(app: &AppHandle) -> Result<FFmpegCheckResult, String> {
    let engine_path = get_python_engine_path(app);
    let python_exe = get_python_executable(app);
    let engine_dir = engine_path
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| format!("Invalid engine path: {:?}", engine_path))?;
    
    eprintln!("[INFO] Checking FFmpeg status...");

    let check_code = r#"
import json, sys
from pathlib import Path
engine_dir = Path(sys.argv[1])
sys.path.insert(0, str(engine_dir))
from environment_checks import check_ffmpeg
print(json.dumps(check_ffmpeg()), flush=True)
"#;
    
    let output = python_installer::create_hidden_command(&python_exe)
        .current_dir(&engine_dir)
        .arg("-c")
        .arg(check_code)
        .arg(engine_dir.to_string_lossy().to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to execute Python: {}", e))?;
    
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    
    if !output.status.success() {
        eprintln!("[ERROR] FFmpeg check failed: {}", stderr);
        return Err(format!("FFmpeg check failed: {}", stderr));
    }
    
    let result: FFmpegCheckResult = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse FFmpeg check result: {}. Output: {}", e, stdout))?;
    
    eprintln!("[INFO] FFmpeg check complete: installed={}", result.installed);
    Ok(result)
}

struct RuntimeReadinessEvaluation {
    readiness: RuntimeReadinessStatus,
    python_executable: Option<String>,
    ffmpeg_path: Option<String>,
}

async fn evaluate_runtime_readiness(app: &AppHandle) -> RuntimeReadinessEvaluation {
    let checked_at = now_rfc3339();

    let python_result = run_python_environment_check_impl(app).await;
    let ffmpeg_result = run_ffmpeg_status_check_impl(app).await;

    let (python_ready, python_message, python_executable) = match python_result {
        Ok(result) => (
            is_python_runtime_ready(&result),
            result.message,
            result.executable,
        ),
        Err(err) => (false, format!("Python check failed: {}", err), None),
    };

    let (ffmpeg_ready, ffmpeg_message, ffmpeg_path) = match ffmpeg_result {
        Ok(result) => (
            is_ffmpeg_runtime_ready(&result),
            result.message,
            result.path,
        ),
        Err(err) => (false, format!("FFmpeg check failed: {}", err), None),
    };

    let ready = python_ready && ffmpeg_ready;
    let message = if ready {
        "Runtime is ready".to_string()
    } else if !python_ready && !ffmpeg_ready {
        "Runtime is not ready: Python and FFmpeg are required".to_string()
    } else if !python_ready {
        "Runtime is not ready: Python environment is not configured".to_string()
    } else {
        "Runtime is not ready: FFmpeg is not configured".to_string()
    };

    RuntimeReadinessEvaluation {
        readiness: RuntimeReadinessStatus {
            ready,
            python_ready,
            ffmpeg_ready,
            python_message,
            ffmpeg_message,
            message,
            checked_at,
        },
        python_executable,
        ffmpeg_path,
    }
}

/// Check Python environment through Python backend
#[tauri::command]
async fn check_python_environment(app: AppHandle) -> Result<PythonCheckResult, String> {
    run_python_environment_check_impl(&app).await
}

/// Check FFmpeg installation through Python backend
#[tauri::command]
async fn check_ffmpeg_status(app: AppHandle) -> Result<FFmpegCheckResult, String> {
    run_ffmpeg_status_check_impl(&app).await
}

#[tauri::command]
async fn check_runtime_readiness(app: AppHandle) -> Result<RuntimeReadinessStatus, String> {
    Ok(evaluate_runtime_readiness(&app).await.readiness)
}

/// Check AI models through Python backend
#[tauri::command]
async fn check_models_status(app: AppHandle) -> Result<ModelCheckResult, String> {
    let engine_path = get_python_engine_path(&app);
    let python_exe = get_python_executable(&app);
    let engine_dir = engine_path
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| format!("Invalid engine path: {:?}", engine_path))?;
    let models_dir = get_models_dir(&app).map_err(|e| e.to_string())?;
    
    eprintln!("[INFO] Checking models status...");
    eprintln!("[DEBUG] Models dir: {:?}", models_dir);

    let check_code = r#"
import json, sys
from pathlib import Path
engine_dir = Path(sys.argv[1])
cache_dir = sys.argv[2] if len(sys.argv) > 2 else None
sys.path.insert(0, str(engine_dir))
from environment_checks import check_models
print(json.dumps(check_models(cache_dir)), flush=True)
"#;
    
    let output = create_hidden_command(&python_exe)
        .current_dir(&engine_dir)
        .arg("-c")
        .arg(check_code)
        .arg(engine_dir.to_string_lossy().to_string())
        .arg(models_dir.to_string_lossy().to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to execute Python: {}", e))?;
    
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    
    if !output.status.success() {
        eprintln!("[ERROR] Models check failed: {}", stderr);
        return Err(format!("Models check failed: {}", stderr));
    }
    
    let result: ModelCheckResult = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse models check result: {}. Output: {}", e, stdout))?;
    
    eprintln!("[INFO] Models check complete: has_required={}", result.has_required_model);
    Ok(result)
}

/// Get complete environment status through Python backend
#[tauri::command]
async fn get_environment_status(app: AppHandle) -> Result<EnvironmentStatus, String> {
    let engine_path = get_python_engine_path(&app);
    let python_exe = get_python_executable(&app);
    let engine_dir = engine_path
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| format!("Invalid engine path: {:?}", engine_path))?;
    let models_dir = get_models_dir(&app).map_err(|e| e.to_string())?;
    
    eprintln!("[INFO] Getting full environment status...");

    let check_code = r#"
import json, sys
from pathlib import Path
engine_dir = Path(sys.argv[1])
cache_dir = sys.argv[2] if len(sys.argv) > 2 else None
sys.path.insert(0, str(engine_dir))
from environment_checks import get_full_environment_status
print(json.dumps(get_full_environment_status(cache_dir)), flush=True)
"#;
    
    let output = create_hidden_command(&python_exe)
        .current_dir(&engine_dir)
        .arg("-c")
        .arg(check_code)
        .arg(engine_dir.to_string_lossy().to_string())
        .arg(models_dir.to_string_lossy().to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to execute Python: {}", e))?;
    
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    
    if !output.status.success() {
        eprintln!("[ERROR] Environment check failed: {}", stderr);
        return Err(format!("Environment check failed: {}", stderr));
    }
    
    let result: EnvironmentStatus = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse environment status: {}. Output: {}", e, stdout))?;
    
    eprintln!("[INFO] Environment check complete: overall={}", result.overall_status);
    Ok(result)
}

/// Fast-path setup check using cached state with TTL
/// Returns true if setup_state.json exists and runtime_ready=true with age < configured TTL
/// Falls back to full is_setup_complete() check if cache is invalid/missing
#[tauri::command]
async fn is_setup_complete_fast(app: AppHandle, perf_config: State<'_, PerformanceConfigState>) -> Result<bool, String> {
    // Check if fast setup check is enabled via performance config
    let fast_check_enabled = perf_config.read()
        .map(|cfg| cfg.fast_setup_check_enabled)
        .unwrap_or(true); // Default to true if lock fails
    
    if !fast_check_enabled {
        eprintln!("[INFO] Fast setup check is disabled, falling back to full check");
        return is_setup_complete(app).await;
    }

    if let Some(state) = load_setup_state(&app) {
        // Check if setup was ever completed successfully (completed_at is set)
        // This is the key fix: we care about whether wizard was completed, not whether runtime is currently ready
        if state.completed_at.is_some() {
            // Parse completed_at to check age (optional validation)
            if let Some(completed_at_str) = &state.completed_at {
                if let Ok(completed_at) = chrono::DateTime::parse_from_rfc3339(completed_at_str) {
                    let now = chrono::Utc::now();
                    let days_old = now.signed_duration_since(completed_at.with_timezone(&chrono::Utc)).num_days();
                    eprintln!("[INFO] Fast setup check: setup completed {} days ago, wizard was finished", days_old);
                }
            }
            eprintln!("[INFO] Fast setup check: completed_at exists, setup was completed");
            return Ok(true);
        } else {
            eprintln!("[INFO] Fast setup check: no completed_at, setup not finished");
        }
    } else {
        eprintln!("[INFO] Fast setup check: no cached state, falling back to full check");
    }

    // Fallback to full check
    is_setup_complete(app).await
}

/// Check if setup has been completed
/// Returns true if setup was ever completed successfully (completed_at is set)
/// Note: This does NOT check runtime readiness - that's a separate concern
#[tauri::command]
async fn is_setup_complete(app: AppHandle) -> Result<bool, String> {
    // First check if we have a completed setup state (wizard was finished)
    if let Some(state) = load_setup_state(&app) {
        if state.completed_at.is_some() {
            eprintln!("[INFO] Setup complete status: completed_at exists, setup was finished");
            return Ok(true);
        }
    }

    // If no completed state, fall back to full runtime check
    let readiness = evaluate_runtime_readiness(&app).await;
    update_runtime_state_impl(
        &app,
        &readiness.readiness,
        readiness.python_executable.clone(),
        readiness.ffmpeg_path.clone(),
    )?;
    eprintln!("[INFO] Setup complete status (runtime-ready): {}", readiness.readiness.ready);
    Ok(readiness.readiness.ready)
}

/// Mark setup as complete
/// Note: We skip runtime checks here because frontend already validated
/// pythonCheck and ffmpegCheck status before enabling the finish button.
/// This avoids spawning Python processes on every setup completion.
#[tauri::command]
async fn mark_setup_complete(app: AppHandle) -> Result<(), String> {
    let python_exe = get_python_executable(&app);
    let ffmpeg_path = get_ffmpeg_path(&app).await.ok().map(|p| p.to_string_lossy().to_string());

    let readiness = RuntimeReadinessStatus {
        ready: true,
        python_ready: true,
        ffmpeg_ready: true,
        python_message: "Python verified by frontend".to_string(),
        ffmpeg_message: "FFmpeg verified by frontend".to_string(),
        message: "Runtime is ready".to_string(),
        checked_at: now_rfc3339(),
    };

    mark_setup_complete_impl(
        &app,
        &readiness,
        Some(now_rfc3339()),
        Some(python_exe.to_string_lossy().to_string()),
        ffmpeg_path,
    )
}

/// Reset setup status (for re-run from settings)
#[tauri::command]
async fn reset_setup(app: AppHandle) -> Result<(), String> {
    reset_setup_impl(&app)
}

/// ============================================================================
// Phase 3: Rust Transcription Commands
// ============================================================================

/// Wait for TranscriptionManager to be initialized (with timeout)
/// This is used by Rust transcription commands to ensure the manager is ready
async fn ensure_manager_initialized(
    state: &State<'_, TranscriptionManagerState>,
    app_handle: &AppHandle,
) -> Result<(), String> {
    const MAX_WAIT_MS: u64 = 30000; // 30 seconds timeout
    const CHECK_INTERVAL_MS: u64 = 100;

    let start = std::time::Instant::now();

    loop {
        // Check if manager is initialized
        {
            let guard = state.lock().await;
            if guard.is_some() {
                return Ok(());
            }
        }

        // Check timeout - if we timeout, try to initialize manually
        if start.elapsed().as_millis() as u64 > MAX_WAIT_MS {
            eprintln!("[WARN] TranscriptionManager initialization timeout, attempting manual init");
            let mut guard = state.lock().await;
            if guard.is_some() {
                return Ok(());
            }
            let manager = build_transcription_manager(app_handle)?;
            *guard = Some(manager);
            eprintln!("[INFO] TranscriptionManager initialized manually (fallback)");
            return Ok(());
        }

        // Wait before checking again
        tokio::time::sleep(tokio::time::Duration::from_millis(CHECK_INTERVAL_MS)).await;
    }
}

/// Initialize the transcription manager (call at app startup)
#[tauri::command]
async fn init_transcription_manager(
    app: AppHandle,
    state: State<'_, TranscriptionManagerState>,
) -> Result<(), String> {
    let mut manager_guard = state.lock().await;

    if manager_guard.is_some() {
        eprintln!("[INFO] TranscriptionManager already initialized");
        return Ok(());
    }

    eprintln!("[INFO] TranscriptionManager missing in state, rebuilding...");
    let manager = build_transcription_manager(&app)?;
    *manager_guard = Some(manager);
    eprintln!("[INFO] TranscriptionManager initialized successfully");

    Ok(())
}

/// Load a model for Rust transcription
#[tauri::command]
async fn load_model_rust(
    model_name: String,
    app: AppHandle,
    state: State<'_, TranscriptionManagerState>,
) -> Result<(), String> {
    // Ensure manager is initialized before proceeding
    ensure_manager_initialized(&state, &app).await?;

    let manager_guard = state.lock().await;
    let manager = manager_guard.as_ref()
        .ok_or_else(|| "TranscriptionManager not initialized".to_string())?;

    #[cfg(feature = "rust-transcribe")]
    {
        manager.load_model(&model_name).await
            .map_err(|e| format!("Failed to load model: {}", e))
    }

    #[cfg(not(feature = "rust-transcribe"))]
    {
        Err("rust-transcribe feature is not enabled".to_string())
    }
}

/// Estimate realtime factor (RTF) for a given model
/// This is used to estimate processing time for progress calculation
fn model_rtf_estimate(model: &str) -> f64 {
    match model {
        "whisper-tiny" => 3.0,
        "whisper-base" => 2.5,
        "whisper-small" => 1.8,
        "whisper-medium" => 1.2,
        "whisper-large" | "whisper-large-v2" | "whisper-large-v3" => 0.9,
        "parakeet" => 4.0,
        "parakeet-tdt-0.6b-v3" => 4.2,
        "parakeet-tdt-1.1b" => 2.2,
        "moonshine-tiny" => 3.5,
        "moonshine-base" => 2.0,
        _ => 1.5,
    }
}

/// Transcribe using Rust transcribe-rs engine
#[tauri::command]
async fn transcribe_rust(
    task_id: String,
    file_path: String,
    options: crate::RustTranscriptionOptions,
    app: AppHandle,
    state: State<'_, TranscriptionManagerState>,
    rust_handles: State<'_, RustTaskHandles>,
) -> Result<TranscriptionResult, String> {
    eprintln!("[INFO] transcribe_rust called: task_id={}, file={}, model={}",
        task_id, file_path, options.language.as_ref().map(|s| s.as_str()).unwrap_or("auto"));

    let total_start = std::time::Instant::now();
    let model_load_start = std::time::Instant::now();

    // Ensure manager is initialized before proceeding
    ensure_manager_initialized(&state, &app).await?;
    let model_load_ms = model_load_start.elapsed().as_millis() as u64;

    // Validate file path
    let validated_path = validate_file_path(&file_path)
        .map_err(|e| e.to_string())?;

    let decode_start = std::time::Instant::now();

    // Check if file needs conversion to WAV for Rust transcription
    // Symphonia supports: wav, flac, mp3, m4a/aac, ogg, alac
    // FFmpeg conversion needed for: mp4, mov, mkv, avi, webm (video containers)
    let needs_conversion = {
        let ext = std::path::Path::new(&validated_path)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();
        // Video containers need conversion to extract audio
        matches!(ext.as_str(), "mp4" | "mov" | "mkv" | "avi" | "webm")
    };

    let audio_path = if needs_conversion {
        // Convert to WAV using Rust audio module (with FFmpeg fallback)
        eprintln!("[INFO] Converting {} to WAV for Rust transcription", validated_path.display());

        // Create temp WAV file
        let temp_dir = std::env::temp_dir();
        let wav_path = temp_dir.join(format!("transcribe_video_{}.wav", task_id));

        // Try Rust audio conversion first
        match crate::audio::converter::convert_to_wav(&validated_path, &wav_path) {
            Ok(_) => {
                eprintln!("[INFO] Rust audio conversion complete: {}", wav_path.display());
                wav_path
            }
            Err(e) => {
                eprintln!("[WARN] Rust audio conversion failed: {}, trying FFmpeg", e);
                
                // Fallback to FFmpeg
                let ffmpeg_path = match ffmpeg_manager::get_ffmpeg_path(&app).await {
                    Ok(p) => p,
                    Err(e) => {
                        return Err(format!(
                            "FFmpeg not available for conversion: {}. Please install FFmpeg or convert the file to WAV manually.",
                            e
                        ));
                    }
                };

                let output = std::process::Command::new(&ffmpeg_path)
                    .args([
                        "-y",  // Overwrite output
                        "-i", validated_path.to_str().unwrap(),
                        "-vn", // No video
                        "-acodec", "pcm_s16le", // PCM codec
                        "-ar", "16000", // 16kHz sample rate
                        "-ac", "1", // Mono
                        wav_path.to_str().unwrap(),
                    ])
                    .output()
                    .map_err(|e| format!("Failed to run FFmpeg: {}", e))?;

                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    return Err(format!("FFmpeg conversion failed: {}", stderr));
                }

                eprintln!("[INFO] FFmpeg conversion complete: {}", wav_path.display());
                wav_path
            }
        }
    } else {
        validated_path.clone()
    };

    let temp_wav_path = audio_path.clone();
    let _temp_wav_guard = scopeguard::guard((), move |_| {
        cleanup_temp_wav_file(&temp_wav_path, needs_conversion);
    });
    let decode_ms = decode_start.elapsed().as_millis() as u64;

    // Validate manager is initialized (quick check before spawning)
    {
        let guard = state.lock().await;
        guard.as_ref().ok_or_else(|| "TranscriptionManager not initialized".to_string())?;
    }

    #[cfg(feature = "rust-transcribe")]
    {
        // Emit loading stage progress (0-10%)
        let _ = app.emit("progress-update", serde_json::json!({
            "taskId": task_id,
            "progress": 0,
            "stage": "loading",
            "message": "Loading audio and model...",
            "metrics": {
                "modelLoadMs": model_load_ms,
                "decodeMs": decode_ms,
            },
        }));

        // Get RTF estimate for this model
        let model_name = options.model.as_str();
        let rtf = model_rtf_estimate(model_name);
        
        // Try to get audio duration for better progress estimation
        // We'll use a default estimate if we can't determine it easily
        let estimated_duration_secs = 60.0; // Default: assume 1 minute audio
        let expected_processing_secs = (estimated_duration_secs / rtf).max(5.0);
        
        eprintln!("[PROGRESS] Estimated RTF={}, expected processing time={:.1}s", rtf, expected_processing_secs);

        // Convert RustTranscriptionOptions to transcription_manager::TranscriptionOptions
        let tm_options = transcription_manager::TranscriptionOptions::from(options.clone());

        // Get HuggingFace token for diarization
        let hf_token = match get_huggingface_token(&app).await {
            Ok(token) => token,
            Err(e) => {
                eprintln!("[WARN] Failed to get HuggingFace token: {}", e);
                None
            }
        };

        // Emit loading complete, starting transcription
        let _ = app.emit("progress-update", serde_json::json!({
            "taskId": task_id,
            "progress": 10,
            "stage": "transcribing",
            "message": "Transcribing audio...",
            "metrics": {
                "modelLoadMs": model_load_ms,
                "decodeMs": decode_ms,
            },
        }));

        eprintln!("[PROGRESS] Starting transcription...");

        // Spawn transcription as an abortable task so cancel_transcription can stop it.
        // Note: the underlying C/FFI inference thread may run its current step to completion,
        // but the Tauri command returns immediately on abort and the result is discarded.
        let enable_diarization = options.enable_diarization;
        let state_arc = Arc::clone(&*state);
        let audio_path_for_spawn = audio_path.clone();
        let mut join_handle = tokio::spawn(async move {
            let guard = state_arc.lock().await;
            let manager = guard.as_ref()
                .ok_or_else(|| "TranscriptionManager not initialized".to_string())?;
            manager.transcribe_file(&audio_path_for_spawn, &tm_options, hf_token.as_deref())
                .await
                .map_err(|e| e.to_string())
        });

        // Register abort handle immediately so cancel_transcription can stop this task
        {
            let mut handles = rust_handles.lock().await;
            handles.insert(task_id.clone(), join_handle.abort_handle());
        }

        let inference_start = std::time::Instant::now();
        let mut heartbeat_progress: u8 = 12;
        let mut heartbeat_timer = tokio::time::interval(tokio::time::Duration::from_secs(15));
        heartbeat_timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        let join_result = loop {
            tokio::select! {
                result = &mut join_handle => {
                    break result;
                }
                _ = heartbeat_timer.tick() => {
                    heartbeat_progress = (heartbeat_progress.saturating_add(1)).min(89);
                    let _ = app.emit("progress-update", serde_json::json!({
                        "taskId": task_id,
                        "progress": heartbeat_progress,
                        "stage": "transcribing",
                        "message": "Transcribing audio...",
                        "metrics": {
                            "modelLoadMs": model_load_ms,
                            "decodeMs": decode_ms,
                        }
                    }));
                }
            }
        };

        let result = match join_result {
            Ok(Ok(data)) => data,
            Ok(Err(e)) => {
                eprintln!("[ERROR] Rust transcription failed: {}", e);
                let _ = app.emit("transcription-error", serde_json::json!({
                    "taskId": task_id,
                    "error": e,
                }));
                rust_handles.lock().await.remove(&task_id);
                return Err(e);
            }
            Err(ref e) if e.is_cancelled() => {
                eprintln!("[INFO] Rust transcription cancelled: {}", task_id);
                rust_handles.lock().await.remove(&task_id);
                return Err("CANCELLED".to_string());
            }
            Err(e) => {
                rust_handles.lock().await.remove(&task_id);
                return Err(format!("Transcription task panicked: {}", e));
            }
        };
        let inference_ms = inference_start.elapsed().as_millis() as u64;
        rust_handles.lock().await.remove(&task_id);

        let mut merged_metrics = result.metrics.clone().unwrap_or_default();
        merged_metrics.model_load_ms = Some(model_load_ms);
        merged_metrics.decode_ms = Some(decode_ms);
        merged_metrics.inference_ms = Some(merged_metrics.inference_ms.unwrap_or(inference_ms));
        merged_metrics.total_ms = Some(total_start.elapsed().as_millis() as u64);

        // Transcription done - emit completion progress
        let audio_duration = result.duration;
        eprintln!("[PROGRESS] Transcription done: audio_duration={:.1}s", audio_duration);
        
        // Emit progress - since we can't track real progress during transcription,
        // we'll show a reasonable completion percentage based on audio length
        let progress = if audio_duration > 300.0 {
            50 // Long audio takes more time
        } else if audio_duration > 60.0 {
            40
        } else {
            30
        };
        
        let _ = app.emit("progress-update", serde_json::json!({
            "taskId": task_id,
            "progress": progress,
            "stage": "transcribing",
            "message": format!("Processed {:.0}s of audio...", audio_duration),
            "metrics": merged_metrics,
        }));
        
        let final_duration = result.duration;
        eprintln!("[PROGRESS] Transcription complete: duration={:.1}s", final_duration);
        
        let _ = app.emit("progress-update", serde_json::json!({
            "taskId": task_id,
            "progress": 90,
            "stage": if enable_diarization { "diarizing" } else { "finalizing" },
            "message": if enable_diarization { "Running speaker diarization..." } else { "Finalizing..." },
            "metrics": merged_metrics,
        }));

        // Handle diarization if enabled
        if enable_diarization {
            eprintln!("[PROGRESS] Diarizing...");
            
            let _ = app.emit("progress-update", serde_json::json!({
                "taskId": task_id,
                "progress": 98,
                "stage": "finalizing",
                "message": "Preparing output...",
                "metrics": merged_metrics,
            }));
        }

        eprintln!("[INFO] Rust transcription complete: {} segments", result.segments.len());

        // Convert transcription_manager::TranscriptionResult to crate::TranscriptionResult
        let lib_result: TranscriptionResult = TranscriptionResult {
            segments: result.segments.into_iter().map(|s| TranscriptionSegment {
                start: s.start,
                end: s.end,
                text: s.text,
                speaker: s.speaker,
                confidence: s.confidence,
            }).collect(),
            language: result.language,
            duration: result.duration,
            speaker_turns: result.speaker_turns.map(|turns| turns.into_iter().map(|t| SpeakerTurn {
                start: t.start,
                end: t.end,
                speaker: t.speaker,
            }).collect()),
            speaker_segments: result.speaker_segments.map(|segs| segs.into_iter().map(|s| TranscriptionSegment {
                start: s.start,
                end: s.end,
                text: s.text,
                speaker: s.speaker,
                confidence: s.confidence,
            }).collect()),
            metrics: Some(merged_metrics),
        };

        // Emit completion
        let _ = app.emit("transcription-complete", serde_json::json!({
            "taskId": task_id,
            "result": lib_result,
        }));

        Ok(lib_result)
    }

    #[cfg(not(feature = "rust-transcribe"))]
    {
        Err("rust-transcribe feature is not enabled".to_string())
    }
}

/// Unload current model
#[tauri::command]
async fn unload_model_rust(
    app: AppHandle,
    state: State<'_, TranscriptionManagerState>,
) -> Result<(), String> {
    // Ensure manager is initialized before proceeding
    ensure_manager_initialized(&state, &app).await?;

    let manager_guard = state.lock().await;
    let manager = manager_guard.as_ref()
        .ok_or_else(|| "TranscriptionManager not initialized".to_string())?;

    #[cfg(feature = "rust-transcribe")]
    {
        manager.unload_model();
        Ok(())
    }

    #[cfg(not(feature = "rust-transcribe"))]
    {
        Err("rust-transcribe feature is not enabled".to_string())
    }
}

/// Check if a model is currently loaded
#[tauri::command]
async fn is_model_loaded_rust(
    state: State<'_, TranscriptionManagerState>,
) -> Result<bool, String> {
    let manager_guard = state.lock().await;

    // Return false if manager not initialized yet (lazy loading in progress)
    let manager = match manager_guard.as_ref() {
        Some(m) => m,
        None => return Ok(false),
    };

    #[cfg(feature = "rust-transcribe")]
    {
        Ok(manager.is_model_loaded())
    }

    #[cfg(not(feature = "rust-transcribe"))]
    {
        Ok(false)
    }
}

/// Get the currently loaded model name
#[tauri::command]
async fn get_current_model_rust(
    state: State<'_, TranscriptionManagerState>,
) -> Result<Option<String>, String> {
    let manager_guard = state.lock().await;

    // Return None if manager not initialized yet (lazy loading in progress)
    let manager = match manager_guard.as_ref() {
        Some(m) => m,
        None => return Ok(None),
    };

    #[cfg(feature = "rust-transcribe")]
    {
        Ok(manager.get_current_model())
    }

    #[cfg(not(feature = "rust-transcribe"))]
    {
        Ok(None)
    }
}

/// ============================================================================
// Python Diarization Commands (for integration with Rust transcription)
// ============================================================================

/// Run PyAnnote diarization via Python subprocess
#[tauri::command]
async fn diarize_pyannote(
    app: AppHandle,
    task_id: String,
    audio_path: String,
    hf_token: Option<String>,
    num_speakers: Option<i32>,
) -> Result<Vec<crate::python_bridge::SpeakerSegment>, String> {
    eprintln!("[INFO] diarize_pyannote called: task_id={}, audio={}", task_id, audio_path);

    // Validate file path
    let validated_path = validate_file_path(&audio_path)
        .map_err(|e| e.to_string())?;

    // Get Python executable and engine path
    let python_exe = get_python_executable(&app);
    let engine_path = get_python_engine_path(&app);

    // Emit progress
    let _ = app.emit("progress-update", serde_json::json!({
        "taskId": task_id,
        "progress": 50,
        "stage": "diarization",
        "message": "Running PyAnnote diarization...",
    }));

    // Create Python bridge and run diarization
    let models_dir = get_models_dir(&app).map_err(|e| e.to_string())?;
    let bridge = crate::python_bridge::PythonBridge::new(&python_exe, &engine_path, &models_dir);

    let result = bridge.diarize_pyannote(&validated_path, hf_token.as_deref(), num_speakers).await
        .map_err(|e| {
            eprintln!("[ERROR] PyAnnote diarization failed: {}", e);

            let _ = app.emit("transcription-error", serde_json::json!({
                "taskId": task_id,
                "error": format!("PyAnnote diarization failed: {}", e),
            }));
            e.to_string()
        })?;

    eprintln!("[INFO] PyAnnote diarization complete: {} segments", result.len());
    Ok(result as Vec<crate::python_bridge::SpeakerSegment>)
}

/// Run Sherpa-ONNX diarization via Python subprocess
#[tauri::command]
async fn diarize_sherpa(
    app: AppHandle,
    task_id: String,
    audio_path: String,
    num_speakers: Option<i32>,
) -> Result<Vec<crate::python_bridge::SpeakerSegment>, String> {
    eprintln!("[INFO] diarize_sherpa called: task_id={}, audio={}", task_id, audio_path);

    // Validate file path
    let validated_path = validate_file_path(&audio_path)
        .map_err(|e| e.to_string())?;

    // Get Python executable and engine path
    let python_exe = get_python_executable(&app);
    let engine_path = get_python_engine_path(&app);

    // Emit progress
    let _ = app.emit("progress-update", serde_json::json!({
        "taskId": task_id,
        "progress": 50,
        "stage": "diarization",
        "message": "Running Sherpa-ONNX diarization...",
    }));

    // Create Python bridge and run diarization
    let models_dir = get_models_dir(&app).map_err(|e| e.to_string())?;
    let bridge = crate::python_bridge::PythonBridge::new(&python_exe, &engine_path, &models_dir);

    let result = bridge.diarize_sherpa(&validated_path, num_speakers).await
        .map_err(|e| {
            eprintln!("[ERROR] Sherpa diarization failed: {}", e);

            let _ = app.emit("transcription-error", serde_json::json!({
                "taskId": task_id,
                "error": format!("Sherpa diarization failed: {}", e),
            }));
            e.to_string()
        })?;

    eprintln!("[INFO] Sherpa diarization complete: {} segments", result.len());
    Ok(result as Vec<crate::python_bridge::SpeakerSegment>)
}

/// Read a file as Base64 encoded string
/// This is used for loading media files into WaveSurfer.js which cannot fetch from Tauri asset URLs
#[tauri::command]
async fn read_file_as_base64(file_path: String) -> Result<String, AppError> {
    // Validate the file path for security
    let validated_path = validate_file_path(&file_path)?;
    
    // Read the file
    let bytes = std::fs::read(&validated_path)
        .map_err(|e| AppError::IoError(e))?;
    
    // Encode as Base64
    use base64::{Engine as _, engine::general_purpose};
    let base64_string = general_purpose::STANDARD.encode(&bytes);
    
    Ok(base64_string)
}

/// Get file size in bytes
#[tauri::command]
async fn get_file_size(path: String) -> Result<u64, AppError> {
    let validated_path = validate_file_path(&path)?;
    let metadata = std::fs::metadata(&validated_path)
        .map_err(|e| AppError::IoError(e))?;
    Ok(metadata.len())
}

/// Delete a file
#[tauri::command]
async fn delete_file(path: String) -> Result<(), AppError> {
    let validated_path = validate_file_path(&path)?;
    std::fs::remove_file(&validated_path)
        .map_err(|e| AppError::IoError(e))?;
    Ok(())
}

/// Convert audio/video to MP3 using FFmpeg
#[tauri::command]
async fn convert_to_mp3(
    app: AppHandle,
    input_path: String,
    output_path: String,
) -> Result<String, AppError> {
    eprintln!("[DEBUG] convert_to_mp3 called: input={}, output={}", input_path, output_path);
    
    // Validate input file (must exist)
    let validated_input = validate_file_path(&input_path)?;
    eprintln!("[DEBUG] validated input path: {}", validated_input.display());
    
    // For output path, just ensure the parent directory exists and is writable
    let output_pathbuf = PathBuf::from(&output_path);
    if let Some(parent_dir) = output_pathbuf.parent() {
        if !parent_dir.exists() {
            std::fs::create_dir_all(parent_dir)
                .map_err(|e| AppError::IoError(e))?;
        }
    }
    let validated_output = output_pathbuf;
    eprintln!("[DEBUG] output path: {}", validated_output.display());
    
    // Get FFmpeg path
    let ffmpeg_path = match crate::ffmpeg_manager::get_ffmpeg_path(&app).await {
        Ok(path) => {
            eprintln!("[DEBUG] FFmpeg path found: {}", path.display());
            path
        }
        Err(e) => {
            eprintln!("[ERROR] FFmpeg not found: {}", e);
            return Err(AppError::Other(format!("FFmpeg not found: {}", e)));
        }
    };
    
    // Run FFmpeg conversion
    eprintln!("[DEBUG] Running FFmpeg conversion...");
    
    let status = std::process::Command::new(&ffmpeg_path)
        .args([
            "-i", validated_input.to_str().unwrap_or(&input_path),
            "-vn",
            "-acodec", "libmp3lame",
            "-q:a", "2",
            "-y",
            validated_output.to_str().unwrap_or(&output_path),
        ])
        .output()
        .map_err(|e| AppError::IoError(e))?;
    
    if !status.status.success() {
        let stderr = String::from_utf8_lossy(&status.stderr);
        let stdout = String::from_utf8_lossy(&status.stdout);
        eprintln!("[ERROR] FFmpeg conversion failed: status={}, stderr={}", status.status, stderr);
        eprintln!("[DEBUG] FFmpeg stdout: {}", stdout);
        return Err(AppError::Other(format!("FFmpeg conversion failed: {}", stderr)));
    }
    
    // Verify output file exists
    if !validated_output.exists() {
        eprintln!("[ERROR] Output file was not created: {}", validated_output.display());
        return Err(AppError::Other("Output file was not created".to_string()));
    }
    
    eprintln!("[DEBUG] Conversion successful: {}", validated_output.display());
    Ok(output_path)
}

/// Get or create the archive directory
#[tauri::command]
async fn get_archive_dir(app: AppHandle) -> Result<String, AppError> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Other(e.to_string()))?;
    
    let archive_dir = app_data_dir.join("archive");
    
    if !archive_dir.exists() {
        std::fs::create_dir_all(&archive_dir)
            .map_err(|e| AppError::IoError(e))?;
    }
    
    Ok(archive_dir.to_string_lossy().to_string())
}

// ============================================================================
// Performance Configuration Commands
// ============================================================================

/// Get the current performance configuration
#[tauri::command]
#[allow(dead_code)]
fn get_performance_config(perf_config: State<'_, PerformanceConfigState>) -> Result<PerformanceConfig, String> {
    perf_config.read()
        .map(|cfg| cfg.clone())
        .map_err(|e| format!("Failed to read performance config: {}", e))
}

/// Update performance configuration
/// Note: Updates are only persisted to file if persist=true, otherwise they only apply
/// to the current session (useful for testing/debugging)
#[tauri::command]
#[allow(dead_code)]
async fn update_performance_config(
    app: AppHandle,
    perf_config: State<'_, PerformanceConfigState>,
    config: PerformanceConfig,
    persist: bool,
) -> Result<PerformanceConfig, String> {
    eprintln!("[INFO] Updating performance configuration: persist={}", persist);

    // Update the in-memory configuration
    {
        let mut config_guard = perf_config.write()
            .map_err(|e| format!("Failed to acquire write lock: {}", e))?;
        *config_guard = config.clone();
    }

    if persist {
        let app_data_dir = app.path().app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {}", e))?;

        config.save_to_file(&app_data_dir)
            .map_err(|e| format!("Failed to save performance config: {}", e))?;

        eprintln!("[INFO] Performance configuration saved to file");
    }

    Ok(config)
}

/// Main entry point
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let task_manager: TaskManagerState = Arc::new(Mutex::new(TaskManager::default()));
    let transcription_manager_state: TranscriptionManagerState = Arc::new(Mutex::new(None));
    let rust_task_handles: RustTaskHandles = Arc::new(Mutex::new(HashMap::new()));
    // Initialize performance config state early with defaults
    // This prevents "state not managed" errors when commands are called during startup
    let performance_config_state: PerformanceConfigState = Arc::new(RwLock::new(PerformanceConfig::default()));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(task_manager)
        .manage(transcription_manager_state)
        .manage(rust_task_handles)
        .manage(performance_config_state)
        .setup(|app| {
            let app_handle = app.app_handle();

            // Load performance configuration
            let app_data_dir = match app_handle.path().app_data_dir() {
                Ok(dir) => dir,
                Err(e) => {
                    eprintln!("[WARN] Failed to get app data dir for performance config: {}", e);
                    // Use a temporary path for config loading - will use defaults
                    PathBuf::from(".")
                }
            };
            let loaded_config = PerformanceConfig::load(&app_data_dir);

            // Log performance configuration status on startup
            loaded_config.log_status();

            // Update the managed performance config state with loaded values
            if let Ok(mut config_guard) = app.state::<PerformanceConfigState>().write() {
                *config_guard = loaded_config;
                eprintln!("[INFO] Performance config state updated with loaded values");
            } else {
                eprintln!("[WARN] Failed to update performance config state, using defaults");
            }

            // Spawn async task to initialize TranscriptionManager in background
            // This prevents blocking the window creation during startup
            let manager_state = app.state::<TranscriptionManagerState>();
            let manager_state_inner = (*manager_state).clone(); // Clone the Arc to get 'static ownership
            let app_handle_for_spawn = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                eprintln!("[INFO] Starting lazy TranscriptionManager initialization...");
                let mut manager_guard = manager_state_inner.lock().await;

                // Double-check it wasn't already initialized
                if manager_guard.is_some() {
                    eprintln!("[INFO] TranscriptionManager already initialized, skipping");
                    return;
                }

                *manager_guard = match build_transcription_manager(&app_handle_for_spawn) {
                    Ok(manager) => {
                        eprintln!("[INFO] TranscriptionManager lazy initialization completed successfully");
                        Some(manager)
                    }
                    Err(e) => {
                        eprintln!("[WARN] Failed to initialize TranscriptionManager: {}", e);
                        None
                    }
                };
            });


            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_transcription,
            cancel_transcription,
            get_queue_status,
            run_python_engine,
            check_cuda_available,
            get_available_devices,
            select_media_files,
            export_transcription,
            get_models_dir_command,
            open_models_folder_command,
            open_archive_folder_command,
            download_model,
            cancel_model_download,
            get_local_models,
            delete_model,
            clear_cache,
            get_disk_usage,
            save_selected_model,
            load_selected_model,
            get_files_metadata,
            get_ffmpeg_status,
            download_ffmpeg,
            save_huggingface_token,
            get_huggingface_token_command,
            read_file_as_base64,
            // Audio processing commands (Rust-native)
            convert_audio_to_wav,
            get_audio_duration,
            extract_audio_segment,
            get_audio_metadata,
            // Archive commands
            get_file_size,
            delete_file,
            convert_to_mp3,
            get_archive_dir,
            // Phase 3: Rust Transcription commands
            init_transcription_manager,
            load_model_rust,
            transcribe_rust,
            unload_model_rust,
            is_model_loaded_rust,
            get_current_model_rust,
            // Python Diarization commands
            diarize_pyannote,
            diarize_sherpa,
            // Setup Wizard commands
            check_python_environment,
            check_ffmpeg_status,
            check_runtime_readiness,
            // Python Installer commands
            check_python_installed,
            install_python_full,
            get_python_install_progress,
            cancel_python_install,
            check_models_status,
            get_environment_status,
            is_setup_complete_fast,
            is_setup_complete,
            mark_setup_complete,
            reset_setup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Internal function to get local models from a directory (testable without Tauri)
fn get_local_models_internal(models_dir: &std::path::Path) -> Result<Vec<LocalModel>, std::io::Error> {
    let mut models: Vec<LocalModel> = Vec::new();
    
    if !models_dir.exists() {
        return Ok(models);
    }
    
    // Individual diarization components to skip - they're handled separately
    let skip_individual: std::collections::HashSet<&str> = std::collections::HashSet::from([
        "pyannote-segmentation-3.0",
        "pyannote-embedding-3.0",
        "sherpa-onnx-segmentation",
        "sherpa-onnx-embedding",
    ]);
    
    // First, check for GGML .bin files in models/ root (Whisper models for Rust whisper.cpp)
    // These are single files, not directories
    for entry in std::fs::read_dir(models_dir)? {
        let entry = entry?;
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();

        // Check if this is a GGML .bin file
        if file_name.starts_with("ggml-") && file_name.ends_with(".bin") {
            // Extract model size from filename (e.g., "ggml-small.bin" -> "small")
            let model_size = file_name
                .strip_prefix("ggml-")
                .and_then(|s| s.strip_suffix(".bin"))
                .unwrap_or("base");

            // Get file size
            let size_mb = if let Ok(metadata) = std::fs::metadata(&path) {
                metadata.len() / (1024 * 1024)
            } else {
                0
            };

            models.push(LocalModel {
                name: format!("whisper-{}", model_size),
                size_mb,
                model_type: "whisper".to_string(),
                installed: true,
                path: Some(path.to_string_lossy().to_string()),
            });
        }
    }

    // Then, process directories (for other model types)
    for entry in std::fs::read_dir(models_dir)? {
        let entry = entry?;
        let path = entry.path();

        if !path.is_dir() {
            continue;
        }

        let model_name = entry.file_name().to_string_lossy().to_string();
        
        // Skip individual diarization components - they're handled separately
        if skip_individual.contains(model_name.as_str()) {
            continue;
        }
        
        let size_mb = if path.exists() {
            let mut total_size = 0u64;
            if let Ok(entries) = std::fs::read_dir(&path) {
                for dir_entry in entries.flatten() {
                    if let Ok(metadata) = dir_entry.metadata() {
                        total_size += metadata.len();
                    }
                }
            }
            total_size / (1024 * 1024)
        } else {
            0
        };
        
        // Detect model type - handle both full names (whisper-tiny) and short names (tiny)
        let model_type = if model_name.starts_with("whisper-") {
            "whisper".to_string()
        } else if model_name == "tiny" || model_name == "base" || model_name == "small"
               || model_name == "medium" || model_name == "large" || model_name == "large-v2"
               || model_name == "large-v3" {
            "whisper".to_string()
        } else if model_name.starts_with("distil-") {
            "whisper".to_string()
        } else if model_name.starts_with("parakeet-") {
            "parakeet".to_string()
        } else {
            continue;
        };
        
        // Check if required files exist for the model type
        let is_valid_model = if model_type == "whisper" {
            // Whisper models require model.bin file
            path.join("model.bin").exists()
        } else {
            // Parakeet and other models - directory existence is enough
            true
        };
        
        if !is_valid_model {
            continue;
        }
        
        // Normalize model name for frontend - convert short names to full names
        // Note: distil-* models keep their original name (not whisper-distil-*)
        let display_name = match model_type.as_str() {
            "whisper" if !model_name.starts_with("whisper-") && !model_name.starts_with("distil-") => format!("whisper-{}", model_name),
            _ => model_name,
        };
        
        models.push(LocalModel {
            name: display_name,
            size_mb,
            model_type,
            installed: true,
            path: Some(path.to_string_lossy().to_string()),
        });
    }
    
    // Check for Parakeet models in nemo/ directory
    // Parakeet models are stored as .nemo files in nemo/{org_name}/
    let nemo_dir = models_dir.join("nemo");
    if nemo_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&nemo_dir) {
            for entry_result in entries {
                let entry = match entry_result {
                    Ok(e) => e,
                    Err(_) => continue,
                };

                let path = entry.path();

                // Skip non-directory entries
                if !path.is_dir() {
                    continue;
                }

                let org_name = entry.file_name().to_string_lossy().to_string();

                // Check if this is a Parakeet model directory (nvidia_parakeet-tdt-*)
                if org_name.contains("parakeet") || org_name.contains("nvidia") {
                    // Recursively find .nemo files (some repos place them in nested folders).
                    let mut stack = vec![path.clone()];
                    while let Some(current_dir) = stack.pop() {
                        let entries = match std::fs::read_dir(&current_dir) {
                            Ok(v) => v,
                            Err(_) => continue,
                        };

                        for child in entries.flatten() {
                            let child_path = child.path();
                            if child_path.is_dir() {
                                stack.push(child_path);
                                continue;
                            }

                            let nemo_filename = child.file_name().to_string_lossy().to_string();
                            if !nemo_filename.ends_with(".nemo") {
                                continue;
                            }

                            // Extract canonical frontend model name.
                            let lower_filename = nemo_filename.to_lowercase();
                            let lower_org = org_name.to_lowercase();
                            let model_name = if lower_filename.contains("parakeet-tdt-0.6b")
                                || lower_org.contains("parakeet-tdt-0.6b")
                            {
                                "parakeet-tdt-0.6b-v3".to_string()
                            } else if lower_filename.contains("parakeet-tdt-1.1b")
                                || lower_org.contains("parakeet-tdt-1.1b")
                            {
                                "parakeet-tdt-1.1b".to_string()
                            } else if lower_filename.contains("parakeet") {
                                nemo_filename.replace(".nemo", "")
                            } else {
                                continue;
                            };

                            let size_mb = if let Ok(metadata) = child.metadata() {
                                metadata.len() / (1024 * 1024)
                            } else {
                                0
                            };

                            // Avoid duplicate entries for the same model name.
                            if models.iter().any(|m| m.name == model_name) {
                                continue;
                            }

                            eprintln!("[DEBUG] Found Parakeet model: {} in nemo cache", model_name);

                            models.push(LocalModel {
                                name: model_name,
                                size_mb,
                                model_type: "parakeet".to_string(),
                                installed: true,
                                path: Some(path.to_string_lossy().to_string()),
                            });
                        }
                    }
                }
            }
        }
    }

    // Check for diarization models (flat structure: segmentation + embedding in cache root)
    // PyAnnote diarization
    let seg_path = models_dir.join("pyannote-segmentation-3.0");
    let emb_path = models_dir.join("pyannote-embedding-3.0");
    if seg_path.exists() && emb_path.exists() {
        let mut total_size = 0u64;
        for p in [&seg_path, &emb_path] {
            // Graceful error handling - don't break loop on error
            if let Ok(entries) = std::fs::read_dir(p) {
                for entry in entries.flatten() {
                    if let Ok(meta) = entry.metadata() {
                        total_size += meta.len();
                    }
                }
            }
        }
        models.push(LocalModel {
            name: "pyannote-diarization".to_string(),
            size_mb: total_size / (1024 * 1024),
            model_type: "diarization".to_string(),
            installed: true,
            path: None, // No single path
        });
    }
    
    // Sherpa-ONNX diarization - check both flat and nested structures
    // Nested: models/sherpa-onnx-diarization/sherpa-onnx-segmentation/
    // Flat: models/sherpa-onnx-segmentation/
    let nested_seg_path = models_dir.join("sherpa-onnx-diarization").join("sherpa-onnx-segmentation");
    let nested_emb_path = models_dir.join("sherpa-onnx-diarization").join("sherpa-onnx-embedding");
    let flat_seg_path = models_dir.join("sherpa-onnx-segmentation");
    let flat_emb_path = models_dir.join("sherpa-onnx-embedding");
    
    let (seg_path, emb_path) = if nested_seg_path.exists() && nested_emb_path.exists() {
        (nested_seg_path, nested_emb_path)
    } else if flat_seg_path.exists() && flat_emb_path.exists() {
        (flat_seg_path, flat_emb_path)
    } else {
        // No sherpa-onnx-diarization found
        return Ok(models);
    };
    
    if seg_path.exists() && emb_path.exists() {
        let mut total_size = 0u64;
        for p in [&seg_path, &emb_path] {
            // Graceful error handling - don't break loop on error
            if let Ok(entries) = std::fs::read_dir(p) {
                for entry in entries.flatten() {
                    if let Ok(meta) = entry.metadata() {
                        total_size += meta.len();
                    }
                }
            }
        }
        models.push(LocalModel {
            name: "sherpa-onnx-diarization".to_string(),
            size_mb: total_size / (1024 * 1024),
            model_type: "diarization".to_string(),
            installed: true,
            path: None, // No single path
        });
    }
    
    Ok(models)
}

#[cfg(test)]
mod tests {
    use super::*;
    
    /// Helper to create a temporary directory with model structure
    fn create_test_models_dir(temp_dir: &std::path::Path) {
        // Create whisper-base model
        let whisper_path = temp_dir.join("whisper-base");
        std::fs::create_dir_all(&whisper_path).unwrap();
        std::fs::write(whisper_path.join("model.bin"), vec![0u8; 1024 * 1024]).unwrap(); // 1MB
        
        // Create pyannote diarization components
        let seg_path = temp_dir.join("pyannote-segmentation-3.0");
        std::fs::create_dir_all(&seg_path).unwrap();
        std::fs::write(seg_path.join("model.bin"), vec![0u8; 1024 * 1024]).unwrap(); // 1MB
        
        let emb_path = temp_dir.join("pyannote-embedding-3.0");
        std::fs::create_dir_all(&emb_path).unwrap();
        std::fs::write(emb_path.join("model.bin"), vec![0u8; 1024 * 1024]).unwrap(); // 1MB
    }
    
    #[test]
    fn test_get_local_models_diarization() {
        let temp_dir = tempfile::tempdir().unwrap();
        create_test_models_dir(temp_dir.path());
        
        // Test detection
        let models = get_local_models_internal(temp_dir.path()).unwrap();
        
        // Should have whisper-base and pyannote-diarization
        assert_eq!(models.len(), 2, "Should detect 2 models");
        
        // Check whisper model
        let whisper = models.iter().find(|m| m.name == "whisper-base");
        assert!(whisper.is_some(), "Should find whisper-base");
        let whisper = whisper.unwrap();
        assert_eq!(whisper.model_type, "whisper");
        assert!(whisper.path.is_some());
        
        // Check diarization model
        let diarization = models.iter().find(|m| m.name == "pyannote-diarization");
        assert!(diarization.is_some(), "Should find pyannote-diarization");
        let diarization = diarization.unwrap();
        assert_eq!(diarization.model_type, "diarization");
        assert!(diarization.path.is_none(), "Diarization should have no single path");
        assert_eq!(diarization.size_mb, 2, "Diarization size should be 2MB (1+1)");
    }
    
    #[test]
    fn test_get_local_models_skips_individual_components() {
        let temp_dir = tempfile::tempdir().unwrap();
        
        // Create only individual components (no complete diarization)
        let seg_path = temp_dir.path().join("pyannote-segmentation-3.0");
        std::fs::create_dir_all(&seg_path).unwrap();
        std::fs::File::create(seg_path.join("model.bin")).unwrap();
        
        // Should not detect any models (individual components are skipped)
        let models = get_local_models_internal(temp_dir.path()).unwrap();
        assert_eq!(models.len(), 0, "Should not detect individual components");
    }
    
    #[test]
    fn test_get_local_models_sherpa_diarization() {
        let temp_dir = tempfile::tempdir().unwrap();
        
        // Create sherpa diarization components
        let seg_path = temp_dir.path().join("sherpa-onnx-segmentation");
        std::fs::create_dir_all(&seg_path).unwrap();
        std::fs::write(seg_path.join("model.bin"), vec![0u8; 1024 * 1024]).unwrap(); // 1MB
        
        let emb_path = temp_dir.path().join("sherpa-onnx-embedding");
        std::fs::create_dir_all(&emb_path).unwrap();
        std::fs::write(emb_path.join("model.bin"), vec![0u8; 1024 * 1024]).unwrap(); // 1MB
        
        let models = get_local_models_internal(temp_dir.path()).unwrap();
        
        // Should detect sherpa-onnx-diarization
        assert_eq!(models.len(), 1);
        let diarization = &models[0];
        assert_eq!(diarization.name, "sherpa-onnx-diarization");
        assert_eq!(diarization.model_type, "diarization");
        assert_eq!(diarization.size_mb, 2, "Size should be 2MB (1+1)");
    }
    
    #[test]
    fn test_get_local_models_empty_dir() {
        let temp_dir = tempfile::tempdir().unwrap();
        let models = get_local_models_internal(temp_dir.path()).unwrap();
        assert_eq!(models.len(), 0, "Empty dir should return empty list");
    }
    
    #[test]
    fn test_get_local_models_nonexistent_dir() {
        let models = get_local_models_internal(std::path::Path::new("/nonexistent/path")).unwrap();
        assert_eq!(models.len(), 0, "Nonexistent dir should return empty list");
    }

    #[test]
    fn test_get_local_models_skips_incomplete_whisper_model() {
        let temp_dir = tempfile::tempdir().unwrap();
        let models_path = temp_dir.path();

        // Create whisper-base directory WITHOUT model.bin file
        let whisper_path = models_path.join("whisper-base");
        std::fs::create_dir_all(&whisper_path).unwrap();
        // Don't create model.bin - this should be detected as invalid

        // Should not detect whisper model (incomplete - missing model.bin)
        let models = get_local_models_internal(models_path).unwrap();
        assert_eq!(models.len(), 0, "Should not detect incomplete whisper model (missing model.bin)");

        // Now create model.bin - should be detected
        std::fs::write(whisper_path.join("model.bin"), vec![0u8; 1024 * 1024]).unwrap();
        let models = get_local_models_internal(models_path).unwrap();
        assert_eq!(models.len(), 1, "Should detect complete whisper model (has model.bin)");
        let whisper = models.first().unwrap();
        assert_eq!(whisper.name, "whisper-base");
        assert_eq!(whisper.model_type, "whisper");
        assert!(whisper.path.is_some());
    }

    #[test]
    fn test_get_local_models_detects_complete_whisper_model() {
        let temp_dir = tempfile::tempdir().unwrap();
        let models_path = temp_dir.path();

        // Create whisper-base directory WITH model.bin file
        let whisper_path = models_path.join("whisper-base");
        std::fs::create_dir_all(&whisper_path).unwrap();
        std::fs::write(whisper_path.join("model.bin"), vec![0u8; 1024 * 1024]).unwrap(); // 1MB

        // Should detect whisper model
        let models = get_local_models_internal(models_path).unwrap();
        assert_eq!(models.len(), 1, "Should detect complete whisper model");
        let whisper = models.first().unwrap();
        assert_eq!(whisper.name, "whisper-base");
        assert_eq!(whisper.model_type, "whisper");
        assert!(whisper.path.is_some());
    }

    #[test]
    fn test_get_local_models_detects_ggml_bin_files() {
        let temp_dir = tempfile::tempdir().unwrap();
        let models_path = temp_dir.path();

        // Create GGML .bin file directly in models/ root (as downloaded by new downloader logic)
        std::fs::write(models_path.join("ggml-small.bin"), vec![0u8; 100 * 1024 * 1024]).unwrap(); // 100MB

        // Should detect whisper model from .bin file
        let models = get_local_models_internal(models_path).unwrap();
        assert_eq!(models.len(), 1, "Should detect GGML .bin file");
        let whisper = models.first().unwrap();
        assert_eq!(whisper.name, "whisper-small");
        assert_eq!(whisper.model_type, "whisper");
        assert_eq!(whisper.size_mb, 100, "Size should be 100MB");
        assert!(whisper.path.is_some());
        assert!(whisper.path.as_ref().unwrap().ends_with("ggml-small.bin"));
    }

    #[test]
    fn test_get_local_models_detects_both_ggml_and_directory() {
        let temp_dir = tempfile::tempdir().unwrap();
        let models_path = temp_dir.path();

        // Create GGML .bin file
        std::fs::write(models_path.join("ggml-tiny.bin"), vec![0u8; 50 * 1024 * 1024]).unwrap(); // 50MB

        // Create whisper-base directory
        let whisper_path = models_path.join("whisper-base");
        std::fs::create_dir_all(&whisper_path).unwrap();
        std::fs::write(whisper_path.join("model.bin"), vec![0u8; 1024 * 1024]).unwrap(); // 1MB

        // Should detect both models
        let models = get_local_models_internal(models_path).unwrap();
        assert_eq!(models.len(), 2, "Should detect both GGML and directory models");

        // Check GGML model
        let ggml_model = models.iter().find(|m| m.name == "whisper-tiny").unwrap();
        assert_eq!(ggml_model.model_type, "whisper");
        assert_eq!(ggml_model.size_mb, 50);

        // Check directory model
        let dir_model = models.iter().find(|m| m.name == "whisper-base").unwrap();
        assert_eq!(dir_model.model_type, "whisper");
    }

    #[test]
    fn test_get_local_models_detects_all_ggml_variants() {
        let temp_dir = tempfile::tempdir().unwrap();
        let models_path = temp_dir.path();

        // Create GGML files for all model size variants
        let ggml_files = [
            ("ggml-tiny.bin", 50 * 1024 * 1024),      // 50 MB
            ("ggml-base.bin", 100 * 1024 * 1024),     // 100 MB
            ("ggml-small.bin", 200 * 1024 * 1024),    // 200 MB
            ("ggml-medium.bin", 500 * 1024 * 1024),   // 500 MB
            ("ggml-large-v2.bin", 1000 * 1024 * 1024), // 1 GB
            ("ggml-large-v3.bin", 1000 * 1024 * 1024), // 1 GB
        ];

        for (filename, size) in ggml_files {
            std::fs::write(models_path.join(filename), vec![0u8; size]).unwrap();
        }

        // Should detect all 6 GGML models
        let models = get_local_models_internal(models_path).unwrap();
        assert_eq!(models.len(), 6, "Should detect all 6 GGML model variants");

        // Verify each model
        let expected_models = [
            ("whisper-tiny", 50),
            ("whisper-base", 100),
            ("whisper-small", 200),
            ("whisper-medium", 500),
            ("whisper-large-v2", 1000),
            ("whisper-large-v3", 1000),
        ];

        for (name, expected_size_mb) in expected_models {
            let model = models.iter().find(|m| m.name == name).unwrap_or_else(|| {
                panic!("Model {} not found. Available models: {:?}", name, models.iter().map(|m| &m.name).collect::<Vec<_>>());
            });
            assert_eq!(model.model_type, "whisper");
            assert_eq!(model.size_mb, expected_size_mb);
            assert!(model.path.is_some());
            assert!(model.path.as_ref().unwrap().contains("ggml-"));
        }
    }
}

#[cfg(test)]
mod test_python {
    #[test]
    fn test_python_executable_path() {
        // This test just prints the path - not a real test
        eprintln!("Test requires Tauri AppHandle - skipping");
    }
}

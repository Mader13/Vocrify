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
};
use tauri::{AppHandle, Emitter, Manager, State};
use std::env;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;
use tauri_plugin_dialog::DialogExt;
use scopeguard;

pub mod ffmpeg_manager;
pub mod whisper_engine;
pub mod sherpa_diarizer;
pub mod python_bridge;
pub mod engine_router;
pub mod transcription_manager;

// Re-export FFmpeg types for frontend
pub use ffmpeg_manager::{FFmpegStatus, FFmpegDownloadProgress, get_ffmpeg_status, download_ffmpeg};

// Re-export Whisper types for frontend
pub use whisper_engine::{WhisperEngine, DeviceType as WhisperDeviceType, TranscriptionSegment as WhisperSegment};

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressMetrics {
    pub realtime_factor: Option<f64>,
    pub processed_duration: Option<f64>,
    pub total_duration: Option<f64>,
    pub estimated_time_remaining: Option<f64>,
    pub gpu_usage: Option<f64>,
    pub cpu_usage: Option<f64>,
    pub memory_usage: Option<f64>,
}

/// Messages from the Python engine
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
#[serde(tag = "type", rename_all = "lowercase")]
enum PythonMessage {
    Hello {
        message: String,
        version: String,
        python_version: String,
    },
    Debug {
        message: String,
    },
    Progress {
        stage: String,
        progress: u8,
        message: String,
        #[serde(default)]
        metrics: Option<ProgressMetrics>,
    },
    Segment {
        segment: TranscriptionSegment,
        index: u32,
        total: Option<u32>,
    },
    Result {
        segments: Vec<TranscriptionSegment>,
        language: String,
        duration: f64,
        #[serde(default)]
        speaker_turns: Option<Vec<SpeakerTurn>>,
        #[serde(default)]
        speaker_segments: Option<Vec<TranscriptionSegment>>,
    },
    Error {
        error: String,
    },
    ProgressDownload {
        current: u64,
        total: u64,
        percent: f64,
        speed_mb_s: f64,
    },
    DownloadComplete {
        model_name: String,
        size_mb: u64,
        path: String,
    },
    ModelsList {
        data: Vec<LocalModel>,
    },
    DeleteComplete {
        model_name: String,
    },
}

/// Task state for queued tasks
#[derive(Debug, Clone)]
struct QueuedTask {
    id: String,
    file_path: String,
    options: TranscriptionOptions,
}

/// Running task state with child process handle
#[derive(Debug)]
struct RunningTask {
    handle: tokio::task::JoinHandle<()>,
    child_process: Arc<Mutex<Option<tokio::process::Child>>>,
}

/// Global task manager state
#[derive(Default)]
pub struct TaskManager {
    running_tasks: HashMap<String, RunningTask>,
    queued_tasks: Vec<QueuedTask>,
    downloading_models: HashMap<String, tokio::task::JoinHandle<()>>,
    // CRITICAL-5 FIX: Use Mutex for proper synchronization instead of boolean flag
    queue_processor_guard: Arc<tokio::sync::Mutex<()>>,
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

/// Check if a stderr line represents a critical error
fn is_critical_error(line: &str) -> bool {
    let lower = line.to_lowercase();
    lower.contains("traceback")
        || (lower.contains("error") && !lower.contains("warning"))
        || lower.contains("exception")
        || lower.contains("failed")
}

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
    // In development, use the ai-engine directory
    let resource_path = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    
    // Try resource directory first (for production builds)
    let engine_path = resource_path.join("ai-engine").join("main.py");
    if engine_path.exists() {
        return dunce::simplified(&engine_path).to_path_buf();
    }
    
    // Fall back to development path (relative to src-tauri)
    let dev_path = PathBuf::from("../ai-engine/main.py");
    if dev_path.exists() {
        if let Ok(absolute) = std::env::current_dir() {
            let abs_path = absolute.join(&dev_path);
            // Use canonicalize to resolve symlinks, .., . and get absolute path
            if let Ok(normalized) = std::fs::canonicalize(&abs_path) {
                return normalized;
            }
        }
        return dunce::simplified(&dev_path).to_path_buf();
    }
    
    // Try current working directory
    let cwd_path = PathBuf::from("ai-engine/main.py");
    if cwd_path.exists() {
        if let Ok(absolute) = std::env::current_dir() {
            let abs_path = absolute.join(&cwd_path);
            // Use canonicalize to resolve symlinks, .., . and get absolute path
            if let Ok(normalized) = std::fs::canonicalize(&abs_path) {
                return normalized;
            }
        }
        return dunce::simplified(&cwd_path).to_path_buf();
    }
    
    // Last resort - assume it's in the current directory
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
    let output = std::process::Command::new(python_exe)
        .arg("-c")
        .arg("import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('torch') else 1)")
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

    // Prefer environments with torch available
    for exe in &existing {
        if python_has_torch(exe) {
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
    let fallback = PathBuf::from(".");
    let engine_dir = engine_path.parent().unwrap_or(&fallback);

    // Try multiple venv locations in order of preference.
    // Includes legacy project-level env names used in this repository.
    let mut venv_paths = {
        #[cfg(target_os = "windows")]
        {
            vec![
                engine_dir.join("venv").join("Scripts").join("python.exe"),
                engine_dir.join(".venv").join("Scripts").join("python.exe"),
                engine_dir.join("env").join("Scripts").join("python.exe"),
            ]
        }

        #[cfg(not(target_os = "windows"))]
        {
            vec![
                engine_dir.join("venv").join("bin").join("python"),
                engine_dir.join(".venv").join("bin").join("python"),
                engine_dir.join("env").join("bin").join("python"),
            ]
        }
    };

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

        // Try system python and keep it if torch is present
        let system_python = PathBuf::from("python");
        if python_has_torch(&system_python) {
            eprintln!("[INFO] Selected system Python with torch installed");
            return system_python;
        }

        eprintln!("[WARN] No Python with torch detected in known environments; using system Python as last resort.");
        return system_python;
    }

    // Fall back to system Python
    eprintln!("[WARN] No Python venv found, using system Python. This may cause issues if dependencies are not installed.");
    PathBuf::from("python")
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

    let mut cmd = Command::new(&python_exe);
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
    let child = match cmd.spawn() {
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

    // HIGH-1: Store child process for cancellation
    {
        let mut guard = child_process.lock().await;
        *guard = Some(child);
    }
    
    // Take stdout/stderr before moving child into scopeguard
    let mut guard = child_process.lock().await;
    let mut child = guard.take().expect("Child process was just stored");
    drop(guard);
    
    let stdout = child.stdout.take().expect("Failed to capture stdout");
    let stderr = child.stderr.take().expect("Failed to capture stderr");
    
    // CRITICAL FIX: Use scopeguard to ensure process cleanup on panic/unwind
    let child_guard = scopeguard::guard(child, |mut child: tokio::process::Child| {
        let _ = child.start_kill();
    });
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

    // CRITICAL FIX: Release the guard after successful read and wait for process
    // This prevents the cleanup function from running since we reached wait() successfully
    let mut child = scopeguard::ScopeGuard::into_inner(child_guard);
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
    if let Some(next_task) = manager.queued_tasks.pop() {
        let task_id = next_task.id.clone();

        // Spawn the task
        let app_clone = app.clone();
        let task_id_clone = next_task.id.clone();
        let file_path_clone = next_task.file_path.clone();
        let options_clone = next_task.options.clone();

        let task_id_for_error = next_task.id.clone();
        let app_clone_for_error = app_clone.clone();

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
        manager.queued_tasks.push(QueuedTask {
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

        // CRITICAL: Remove task from running_tasks and process next
        let mut manager = task_manager_arc.lock().await;
        manager.running_tasks.remove(&task_id_clone);
        drop(manager); // Release lock before processing next task
    });

    manager.running_tasks.insert(task_id, RunningTask {
        handle,
        child_process: child_process_for_task,
    });

    // Start processing queued tasks in background
    let task_manager_for_queue = (*task_manager).clone();
    let app_for_queue = app.clone();
    tokio::spawn(async move {
        // Wait a bit for current task to complete
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        process_next_queued_task(app_for_queue, &task_manager_for_queue).await;
    });

    Ok(())
}

/// Cancel a running transcription task
#[tauri::command]
async fn cancel_transcription(
    task_manager: State<'_, TaskManagerState>,
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
    
    let output = Command::new(&python_exe)
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
    
    let output = Command::new(&python_exe)
        .arg("-c")
        .arg("import torch; print(torch.cuda.is_available())")
        .output()
        .await?;
    
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(stdout.trim() == "True")
}

/// Get available compute devices (CUDA, MPS, CPU)
#[tauri::command]
async fn get_available_devices(app: AppHandle) -> Result<DevicesResponse, AppError> {
    let python_exe = get_python_executable(&app);
    
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
    
    let output = Command::new(&python_exe)
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

/// Spawn a model download process
async fn spawn_model_download(
    app: AppHandle,
    model_name: String,
    model_type: String,
    cache_dir: PathBuf,
    token_file: Option<PathBuf>,
) -> Result<(), AppError> {
    let download_completed = Arc::new(AtomicBool::new(false));

    // All model downloads are handled by Python engine
    let engine_path = get_python_engine_path(&app);
    let python_exe = get_python_executable(&app);
    
    eprintln!("[DEBUG] Final paths - Python: {:?}, Engine: {:?}", python_exe, engine_path);
    
    let mut cmd = Command::new(&python_exe);
    cmd.arg(&engine_path)
        .arg("--download-model")
        .arg(&model_name)
        .arg("--cache-dir")
        .arg(cache_dir.to_string_lossy().to_string())
        .arg("--model-type")
        .arg(&model_type)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());  // Capture stderr to debug Python errors
    
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
            return Err(AppError::PythonError(format!("Python process failed to start. Exit code: {:?}", exit_status)));
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
    
    // CRITICAL FIX: Use scopeguard to ensure process cleanup on panic/unwind
    let child_guard = scopeguard::guard(child, |mut child: tokio::process::Child| {
        let _ = child.start_kill();
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
    
    // CRITICAL FIX: Release the guard after successful read and wait for process
    // This prevents the cleanup function from running since we reached wait() successfully
    let mut child = scopeguard::ScopeGuard::into_inner(child_guard);
    let status = child.wait().await?;
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
    let manager = task_manager.lock().await;

    if manager.downloading_models.len() >= MAX_CONCURRENT_DOWNLOADS {
        return Err(AppError::ModelError("Maximum concurrent downloads reached".to_string()));
    }

    let models_dir = get_models_dir(&app)?;

    // HIGH-7: Create secure temp file for token instead of using env var
    let token_file = if let Some(token) = hugging_face_token {
        Some(pass_token_securely(&token)?)
    } else {
        None
    };

    // Clone task_manager Arc for use in spawned task (must release mutex first)
    let task_manager_clone = (*task_manager).clone();
    let app_clone = app.clone();
    let model_name_clone = model_name.clone();
    let model_type_clone = model_type.clone();
    let cache_dir = models_dir.clone();
    let token_file_clone = token_file.clone();
    let token_file_for_cleanup = token_file.clone();

    // Release the mutex before spawning to allow the spawned task to acquire it later
    drop(manager);

    let handle = tokio::spawn(async move {
        let download_result = spawn_model_download(
            app_clone,
            model_name_clone.clone(),
            model_type_clone,
            cache_dir,
            token_file_clone,
        ).await;

        // Clean up token file after download (regardless of result)
        if let Some(path) = token_file_for_cleanup {
            let _ = std::fs::remove_file(path);
        }

        // CRITICAL: Only remove from downloading_models if download succeeded
        // This prevents premature removal before .completed file is created
        match download_result {
            Ok(_) => {
                let mut manager = task_manager_clone.lock().await;
                manager.downloading_models.remove(&model_name_clone);
                eprintln!("[INFO] Removed {} from downloading_models (successful)", model_name_clone);
            }
            Err(e) => {
                eprintln!("[ERROR] Model download failed for {}: {}", model_name_clone, e);
                // Do NOT remove from downloading_models on error - this allows UI to show it as stuck/failed
                // The user will need to manually cancel/delete the failed download
            }
        }
    });

    // Re-acquire mutex to insert the handle
    let mut manager = task_manager.lock().await;
    manager.downloading_models.insert(model_name.clone(), handle);

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
    let model_path = models_dir.join(&model_name);

    if !model_path.exists() {
        return Err(AppError::ModelError(format!("Model not found: {}", model_name)));
    }

    eprintln!("Deleting model: {}", model_name);

    // CRITICAL: Use Python to delete the model so it can clear the model pool first
    // This prevents "os error 32" (file in use) errors on Windows
    let engine_path = get_python_engine_path(&app);
    let python_exe = get_python_executable(&app);

    eprintln!("[DEBUG] Using Python to delete model (will clear model pool first)");

    let output = tokio::process::Command::new(&python_exe)
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

    if !output.status.success() {
        eprintln!("[ERROR] Python delete_model failed: {}", stderr);
        return Err(AppError::PythonError(format!(
            "Failed to delete model: {}",
            stderr
        )));
    }

    eprintln!("Model deleted successfully via Python: {}", model_name);

    // Give filesystem time to sync before returning success
    std::thread::sleep(std::time::Duration::from_millis(200));

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
    let mut manager = task_manager.lock().await;
    
    if let Some(handle) = manager.downloading_models.remove(&model_name) {
        handle.abort();
        return Ok(());
    }
    
    Err(AppError::ModelError(format!("Model download not found: {}", model_name)))
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

/// Get the path to the setup completion flag file
fn get_setup_flag_path(app: &AppHandle) -> PathBuf {
    let app_data = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    app_data.join("Vocrify").join(".setup_complete")
}

/// Check if setup has been completed
fn is_setup_complete_impl(app: &AppHandle) -> bool {
    get_setup_flag_path(app).exists()
}

/// Mark setup as complete by creating the flag file
fn mark_setup_complete_impl(app: &AppHandle) -> Result<(), String> {
    let path = get_setup_flag_path(app);
    
    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return Err(format!("Failed to create setup directory: {}", e));
        }
    }
    
    // Write timestamp to the flag file
    let timestamp = chrono::Utc::now().to_rfc3339();
    std::fs::write(&path, timestamp)
        .map_err(|e| format!("Failed to write setup flag: {}", e))?;
    
    eprintln!("[INFO] Setup marked as complete at: {:?}", path);
    Ok(())
}

/// Reset setup by removing the flag file
fn reset_setup_impl(app: &AppHandle) -> Result<(), String> {
    let path = get_setup_flag_path(app);
    
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to remove setup flag: {}", e))?;
        eprintln!("[INFO] Setup reset - flag file removed");
    } else {
        eprintln!("[INFO] Setup reset - no flag file to remove");
    }
    
    Ok(())
}

// ============================================================================
// Setup Wizard Tauri Commands
// ============================================================================

/// Check Python environment through Python backend
#[tauri::command]
async fn check_python_environment(app: AppHandle) -> Result<PythonCheckResult, String> {
    let engine_path = get_python_engine_path(&app);
    let python_exe = get_python_executable(&app);
    
    eprintln!("[INFO] Checking Python environment...");
    eprintln!("[DEBUG] Python exe: {:?}", python_exe);
    eprintln!("[DEBUG] Engine path: {:?}", engine_path);
    
    let output = Command::new(&python_exe)
        .arg(&engine_path)
        .arg("--command")
        .arg("check_python")
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

/// Check FFmpeg installation through Python backend
#[tauri::command]
async fn check_ffmpeg_status(app: AppHandle) -> Result<FFmpegCheckResult, String> {
    let engine_path = get_python_engine_path(&app);
    let python_exe = get_python_executable(&app);
    
    eprintln!("[INFO] Checking FFmpeg status...");
    
    let output = Command::new(&python_exe)
        .arg(&engine_path)
        .arg("--command")
        .arg("check_ffmpeg")
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

/// Check AI models through Python backend
#[tauri::command]
async fn check_models_status(app: AppHandle) -> Result<ModelCheckResult, String> {
    let engine_path = get_python_engine_path(&app);
    let python_exe = get_python_executable(&app);
    let models_dir = get_models_dir(&app).map_err(|e| e.to_string())?;
    
    eprintln!("[INFO] Checking models status...");
    eprintln!("[DEBUG] Models dir: {:?}", models_dir);
    
    let output = Command::new(&python_exe)
        .arg(&engine_path)
        .arg("--command")
        .arg("check_models")
        .arg("--cache-dir")
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
    let models_dir = get_models_dir(&app).map_err(|e| e.to_string())?;
    
    eprintln!("[INFO] Getting full environment status...");
    
    let output = Command::new(&python_exe)
        .arg(&engine_path)
        .arg("--command")
        .arg("check_environment")
        .arg("--cache-dir")
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

/// Check if setup has been completed
#[tauri::command]
async fn is_setup_complete(app: AppHandle) -> Result<bool, String> {
    let complete = is_setup_complete_impl(&app);
    eprintln!("[INFO] Setup complete status: {}", complete);
    Ok(complete)
}

/// Mark setup as complete
#[tauri::command]
async fn mark_setup_complete(app: AppHandle) -> Result<(), String> {
    mark_setup_complete_impl(&app)
}

/// Reset setup status (for re-run from settings)
#[tauri::command]
async fn reset_setup(app: AppHandle) -> Result<(), String> {
    reset_setup_impl(&app)
}

/// ============================================================================
// Phase 3: Rust Transcription Commands
// ============================================================================

/// Initialize the transcription manager (call at app startup)
#[tauri::command]
async fn init_transcription_manager(
    _app: AppHandle,
    state: State<'_, TranscriptionManagerState>,
) -> Result<(), String> {
    let manager_guard = state.lock().await;
    match manager_guard.as_ref() {
        Some(_) => {
            eprintln!("[INFO] TranscriptionManager already initialized");
            Ok(())
        }
        None => {
            eprintln!("[INFO] TranscriptionManager not initialized, this is unexpected");
            Err("TranscriptionManager not found in state".to_string())
        }
    }
}

/// Load a model for Rust transcription
#[tauri::command]
async fn load_model_rust(
    model_name: String,
    state: State<'_, TranscriptionManagerState>,
) -> Result<(), String> {
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

/// Transcribe using Rust transcribe-rs engine
#[tauri::command]
async fn transcribe_rust(
    task_id: String,
    file_path: String,
    options: crate::RustTranscriptionOptions,
    app: AppHandle,
    state: State<'_, TranscriptionManagerState>,
) -> Result<TranscriptionResult, String> {
    eprintln!("[INFO] transcribe_rust called: task_id={}, file={}, model={}",
        task_id, file_path, options.language.as_ref().map(|s| s.as_str()).unwrap_or("auto"));

    // Validate file path
    let validated_path = validate_file_path(&file_path)
        .map_err(|e| e.to_string())?;

    let manager_guard = state.lock().await;
    let manager = manager_guard.as_ref()
        .ok_or_else(|| "TranscriptionManager not initialized".to_string())?;

    #[cfg(feature = "rust-transcribe")]
    {
        // Emit progress start
        let _ = app.emit("progress-update", serde_json::json!({
            "taskId": task_id,
            "progress": 5,
            "stage": "loading",
            "message": "Starting Rust transcription...",
        }));

        // Convert RustTranscriptionOptions to transcription_manager::TranscriptionOptions
        let tm_options = transcription_manager::TranscriptionOptions::from(options.clone());

        let result = manager.transcribe_file(&validated_path, &tm_options).await
            .map_err(|e| {
                eprintln!("[ERROR] Rust transcription failed: {}", e);

                // Emit error to frontend
                let _ = app.emit("transcription-error", serde_json::json!({
                    "taskId": task_id,
                    "error": e.to_string(),
                }));
                e.to_string()
            })?;

        // Emit completion
        let _ = app.emit("transcription-complete", serde_json::json!({
            "taskId": task_id,
            "result": result,
        }));

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
        };

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
    state: State<'_, TranscriptionManagerState>,
) -> Result<(), String> {
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
    let manager = manager_guard.as_ref()
        .ok_or_else(|| "TranscriptionManager not initialized".to_string())?;

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
    let manager = manager_guard.as_ref()
        .ok_or_else(|| "TranscriptionManager not initialized".to_string())?;

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

/// Main entry point
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let task_manager: TaskManagerState = Arc::new(Mutex::new(TaskManager::default()));

    // Get models directory for TranscriptionManager
    let models_dir = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("..")
        .join("models_cache");

    let _ = std::fs::create_dir_all(&models_dir);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(task_manager)
        .manage(TranscriptionManagerState::new(Mutex::new(
            Some(TranscriptionManager::new(&models_dir)
                .unwrap_or_else(|e| {
                    eprintln!("[WARN] Failed to create TranscriptionManager: {}", e);
                    // Continue with fallback models_dir
                    TranscriptionManager::new(&models_dir).unwrap()
                }))
        )))
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
            check_models_status,
            get_environment_status,
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
}

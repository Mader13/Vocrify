use std::path::PathBuf;
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{
    DeviceCheckResult, EnvironmentStatus, FFmpegCheckResult, LocalModelInfo, ModelCheckResult,
    RuntimeCheckResult, RuntimeReadinessStatus,
};
use crate::ffmpeg_manager::get_ffmpeg_path;
use crate::models_dir::{get_local_models_internal, get_models_dir};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetupState {
    pub(crate) schema_version: u32,
    pub(crate) runtime_ready: bool,
    pub(crate) last_verified_at: String,
    pub(crate) completed_at: Option<String>,
    pub(crate) runtime_executable: Option<String>,
    pub(crate) ffmpeg_path: Option<String>,
}

const SETUP_STATE_SCHEMA_VERSION: u32 = 1;

pub(crate) fn now_rfc3339() -> String {
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

pub(crate) fn load_setup_state(app: &AppHandle) -> Option<SetupState> {
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
    std::fs::write(&path, json).map_err(|e| format!("Failed to write setup state: {}", e))?;

    eprintln!("[INFO] Setup state saved at: {:?}", path);
    Ok(())
}

pub(crate) fn mark_setup_complete_impl(
    app: &AppHandle,
    readiness: &RuntimeReadinessStatus,
    completed_at: Option<String>,
    runtime_executable: Option<String>,
    ffmpeg_path: Option<String>,
) -> Result<(), String> {
    let state = SetupState {
        schema_version: SETUP_STATE_SCHEMA_VERSION,
        runtime_ready: readiness.ready,
        last_verified_at: readiness.checked_at.clone(),
        completed_at,
        runtime_executable,
        ffmpeg_path,
    };

    persist_setup_state(app, &state)
}

pub(crate) fn update_runtime_state_impl(
    app: &AppHandle,
    readiness: &RuntimeReadinessStatus,
    runtime_executable: Option<String>,
    ffmpeg_path: Option<String>,
) -> Result<(), String> {
    let existing = load_setup_state(app);
    // Preserve existing completed_at regardless of current runtime readiness
    // Once setup is completed, it stays completed even if runtime has issues
    let completed_at = existing.and_then(|state| state.completed_at).or_else(|| {
        if readiness.ready {
            Some(now_rfc3339())
        } else {
            None
        }
    });

    mark_setup_complete_impl(app, readiness, completed_at, runtime_executable, ffmpeg_path)
}

/// Reset setup by removing the state file and legacy marker.
pub(crate) fn reset_setup_impl(app: &AppHandle) -> Result<(), String> {
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

fn is_ffmpeg_runtime_ready(check: &FFmpegCheckResult) -> bool {
    check.installed && check.status != "error"
}

pub(crate) async fn run_runtime_environment_check_impl(_app: &AppHandle) -> Result<RuntimeCheckResult, String> {
    Ok(RuntimeCheckResult {
        status: "ok".to_string(),
        version: None,
        executable: None,
        in_virtual_env: false,
        message: "No additional runtime dependencies are required".to_string(),
    })
}

fn create_hidden_command(program: &(impl AsRef<std::path::Path> + ?Sized)) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(program.as_ref());
    // CREATE_NO_WINDOW: скрывает окно консоли на Windows
    cmd.creation_flags(0x08000000);
    cmd
}

fn parse_ffmpeg_version(raw: &str) -> Option<String> {
    raw.lines().find_map(|line| {
        if line.to_ascii_lowercase().starts_with("ffmpeg version") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 3 {
                return Some(parts[2].to_string());
            }
        }
        None
    })
}

pub(crate) async fn run_ffmpeg_status_check_impl(app: &AppHandle) -> Result<FFmpegCheckResult, String> {
    eprintln!("[INFO] Checking FFmpeg status (native Rust)...");

    let ffmpeg_path = match get_ffmpeg_path(app).await {
        Ok(path) => path,
        Err(e) => {
            let msg = format!("FFmpeg not found: {}", e);
            return Ok(FFmpegCheckResult {
                status: "error".to_string(),
                installed: false,
                path: None,
                version: None,
                message: msg,
            });
        }
    };

    let output = create_hidden_command(&ffmpeg_path)
        .arg("-version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to execute FFmpeg: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let msg = if stderr.trim().is_empty() {
            "FFmpeg executable is present but failed to run".to_string()
        } else {
            format!("FFmpeg executable is present but failed to run: {}", stderr.trim())
        };
        return Ok(FFmpegCheckResult {
            status: "error".to_string(),
            installed: false,
            path: Some(ffmpeg_path.to_string_lossy().to_string()),
            version: None,
            message: msg,
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let version = parse_ffmpeg_version(&stdout);

    Ok(FFmpegCheckResult {
        status: "ok".to_string(),
        installed: true,
        path: Some(ffmpeg_path.to_string_lossy().to_string()),
        version,
        message: "FFmpeg is installed and ready".to_string(),
    })
}

pub(crate) async fn run_models_status_check_impl(app: &AppHandle) -> Result<ModelCheckResult, String> {
    let models_dir = get_models_dir(app).map_err(|e| e.to_string())?;
    let local_models = get_local_models_internal(&models_dir).map_err(|e| e.to_string())?;

    let installed_models: Vec<LocalModelInfo> = local_models
        .iter()
        .map(|model| LocalModelInfo {
            name: model.name.clone(),
            model_type: model.model_type.clone(),
            size_mb: model.size_mb,
        })
        .collect();

    let has_required_model = local_models.iter().any(|model| model.model_type != "diarization");

    let (status, message) = if has_required_model {
        (
            "ok".to_string(),
            format!("{} model(s) installed", installed_models.len()),
        )
    } else {
        (
            "warning".to_string(),
            "No transcription models installed yet".to_string(),
        )
    };

    Ok(ModelCheckResult {
        status,
        installed_models,
        has_required_model,
        message,
    })
}

pub(crate) async fn run_environment_status_check_impl(app: &AppHandle) -> Result<EnvironmentStatus, String> {
    let runtime = run_runtime_environment_check_impl(app).await?;
    let ffmpeg = run_ffmpeg_status_check_impl(app).await?;
    let models = run_models_status_check_impl(app).await?;

    let devices_response = crate::application::device::get_available_devices(false)
        .await
        .map_err(|e| e.to_string())?;

    let recommended_device = devices_response
        .devices
        .iter()
        .find(|d| d.device_type == devices_response.recommended)
        .cloned();

    let devices = DeviceCheckResult {
        status: "ok".to_string(),
        devices: devices_response.devices,
        recommended: recommended_device,
        message: "Device detection completed".to_string(),
    };

    let runtime_ready = is_ffmpeg_runtime_ready(&ffmpeg);
    let overall_status = if runtime_ready { "ok" } else { "error" }.to_string();
    let message = if runtime_ready {
        "Environment is ready".to_string()
    } else {
        "Environment is not ready: FFmpeg is required".to_string()
    };

    Ok(EnvironmentStatus {
        runtime,
        ffmpeg,
        models,
        devices,
        overall_status,
        message,
    })
}

pub(crate) struct RuntimeReadinessEvaluation {
    pub(crate) readiness: RuntimeReadinessStatus,
    pub(crate) runtime_executable: Option<String>,
    pub(crate) ffmpeg_path: Option<String>,
}

pub(crate) async fn evaluate_runtime_readiness(app: &AppHandle) -> RuntimeReadinessEvaluation {
    let checked_at = now_rfc3339();
    let ffmpeg_result = run_ffmpeg_status_check_impl(app).await;

    let runtime_ready = true;
    let runtime_message = "Runtime dependencies are satisfied".to_string();

    let (ffmpeg_ready, ffmpeg_message, ffmpeg_path) = match ffmpeg_result {
        Ok(result) => (is_ffmpeg_runtime_ready(&result), result.message, result.path),
        Err(err) => (false, format!("FFmpeg check failed: {}", err), None),
    };

    let ready = ffmpeg_ready;
    let message = if ready {
        "Runtime is ready".to_string()
    } else {
        "Runtime is not ready: FFmpeg is not configured".to_string()
    };

    RuntimeReadinessEvaluation {
        readiness: RuntimeReadinessStatus {
            ready,
            runtime_ready,
            ffmpeg_ready,
            runtime_message,
            ffmpeg_message,
            message,
            checked_at,
        },
        runtime_executable: None,
        ffmpeg_path,
    }
}

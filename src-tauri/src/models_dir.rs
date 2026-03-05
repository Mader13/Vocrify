use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::{AppError, LocalModel, TranscriptionManager};

/// Build TranscriptionManager for native Rust transcription + diarization.
pub(crate) fn build_transcription_manager(app: &AppHandle) -> Result<TranscriptionManager, String> {
    let models_dir = get_models_dir(app).map_err(|e| e.to_string())?;
    let audio_cache_dir = get_audio_cache_dir(app).map_err(|e| e.to_string())?;

    eprintln!("[INFO] Initializing TranscriptionManager");
    eprintln!("[DEBUG]   models_dir: {:?}", models_dir);
    eprintln!("[DEBUG]   audio_cache_dir: {:?}", audio_cache_dir);

    TranscriptionManager::new(&models_dir, Some(&audio_cache_dir))
        .map_err(|e| format!("Failed to create TranscriptionManager: {}", e))
}

fn get_models_settings_path(app: &AppHandle) -> PathBuf {
    let app_data = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));

    app_data.join("Vocrify").join("models_settings.json")
}

fn get_default_models_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let app_data = app.path().app_data_dir().map_err(|_| {
        AppError::IoError(std::io::Error::new(
            std::io::ErrorKind::Other,
            "Failed to get app data dir",
        ))
    })?;

    Ok(app_data.join("Vocrify").join("models"))
}

fn load_custom_models_dir(app: &AppHandle) -> Option<PathBuf> {
    let settings_path = get_models_settings_path(app);
    if !settings_path.exists() {
        return None;
    }

    let content = std::fs::read_to_string(&settings_path).ok()?;
    let settings_data = serde_json::from_str::<serde_json::Value>(&content).ok()?;

    let models_dir = settings_data
        .get("modelsDir")
        .or_else(|| settings_data.get("models_dir"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())?;

    Some(PathBuf::from(models_dir))
}

pub(crate) fn save_custom_models_dir(app: &AppHandle, models_dir: &Path) -> Result<(), AppError> {
    let settings_path = get_models_settings_path(app);
    let fallback = PathBuf::from(".");
    let settings_dir = settings_path.parent().unwrap_or(&fallback);

    std::fs::create_dir_all(settings_dir).map_err(AppError::IoError)?;

    let data = serde_json::json!({
        "modelsDir": models_dir.to_string_lossy().to_string(),
    });

    std::fs::write(settings_path, data.to_string()).map_err(AppError::IoError)?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelsDirMoveProgressEvent {
    percent: u8,
    moved_items: u64,
    total_items: u64,
    status: String,
    message: String,
}

fn emit_models_dir_move_progress(
    app: &AppHandle,
    moved_items: u64,
    total_items: u64,
    status: &str,
    message: &str,
) {
    let percent = if total_items == 0 {
        100
    } else {
        ((moved_items.saturating_mul(100)) / total_items).min(100) as u8
    };

    let _ = app.emit(
        "models-dir-move-progress",
        ModelsDirMoveProgressEvent {
            percent,
            moved_items,
            total_items,
            status: status.to_string(),
            message: message.to_string(),
        },
    );
}

fn is_cross_device_error(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::CrossesDevices
        || matches!(error.raw_os_error(), Some(17) | Some(18))
}

fn count_entries(path: &Path) -> Result<u64, AppError> {
    if !path.exists() {
        return Ok(0);
    }

    let mut total = 0_u64;
    for entry in std::fs::read_dir(path).map_err(AppError::IoError)? {
        let entry = entry.map_err(AppError::IoError)?;
        total += 1;
        let entry_path = entry.path();
        let metadata = std::fs::symlink_metadata(&entry_path).map_err(AppError::IoError)?;
        if metadata.is_dir() {
            total += count_entries(&entry_path)?;
        }
    }

    Ok(total)
}

fn move_entry<F>(
    src_path: &Path,
    dst_path: &Path,
    moved_items: &mut u64,
    on_progress: &mut F,
) -> Result<(), AppError>
where
    F: FnMut(u64),
{
    if dst_path.exists() {
        return Err(AppError::Other(format!(
            "Cannot move models: destination already contains '{}'",
            dst_path.display()
        )));
    }

    let metadata = std::fs::symlink_metadata(src_path).map_err(AppError::IoError)?;

    if metadata.is_dir() {
        match std::fs::rename(src_path, dst_path) {
            Ok(_) => {
                *moved_items += 1;
                on_progress(*moved_items);
                return Ok(());
            }
            Err(error) if !is_cross_device_error(&error) => return Err(AppError::IoError(error)),
            Err(_) => {}
        }

        std::fs::create_dir_all(dst_path).map_err(AppError::IoError)?;

        for entry in std::fs::read_dir(src_path).map_err(AppError::IoError)? {
            let entry = entry.map_err(AppError::IoError)?;
            let nested_src = entry.path();
            let nested_dst = dst_path.join(entry.file_name());
            move_entry(&nested_src, &nested_dst, moved_items, on_progress)?;
        }

        std::fs::remove_dir(src_path).map_err(AppError::IoError)?;
        *moved_items += 1;
        on_progress(*moved_items);
        return Ok(());
    }

    match std::fs::rename(src_path, dst_path) {
        Ok(_) => {
            *moved_items += 1;
            on_progress(*moved_items);
            Ok(())
        }
        Err(error) if is_cross_device_error(&error) => {
            std::fs::copy(src_path, dst_path).map_err(AppError::IoError)?;
            std::fs::remove_file(src_path).map_err(AppError::IoError)?;
            *moved_items += 1;
            on_progress(*moved_items);
            Ok(())
        }
        Err(error) => Err(AppError::IoError(error)),
    }
}

pub(crate) fn move_models_contents(
    source_dir: &Path,
    target_dir: &Path,
    app: &AppHandle,
) -> Result<u64, AppError> {
    if !source_dir.exists() {
        return Ok(0);
    }

    std::fs::create_dir_all(target_dir).map_err(AppError::IoError)?;
    let total_items = count_entries(source_dir)?;

    emit_models_dir_move_progress(
        app,
        0,
        total_items,
        "preparing",
        "Preparing to move models...",
    );

    let mut moved_items = 0_u64;
    let mut last_percent = 0_u8;
    let mut on_progress = |moved_now: u64| {
        let percent = if total_items == 0 {
            100
        } else {
            ((moved_now.saturating_mul(100)) / total_items).min(100) as u8
        };

        if percent != last_percent {
            last_percent = percent;
            emit_models_dir_move_progress(
                app,
                moved_now,
                total_items,
                "moving",
                "Moving model files...",
            );
        }
    };

    for entry in std::fs::read_dir(source_dir).map_err(AppError::IoError)? {
        let entry = entry.map_err(AppError::IoError)?;
        let src_path = entry.path();
        let dst_path = target_dir.join(entry.file_name());
        move_entry(&src_path, &dst_path, &mut moved_items, &mut on_progress)?;
    }

    emit_models_dir_move_progress(
        app,
        moved_items,
        total_items,
        "completed",
        "Models move completed",
    );

    Ok(moved_items)
}

/// Get the models directory path
pub(crate) fn get_models_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let default_models_dir = get_default_models_dir(app)?;
    let models_dir = load_custom_models_dir(app).unwrap_or(default_models_dir);

    if models_dir.exists() && !models_dir.is_dir() {
        return Err(AppError::Other(format!(
            "Configured models path is not a directory: {}",
            models_dir.display()
        )));
    }

    std::fs::create_dir_all(&models_dir).map_err(AppError::IoError)?;

    // Get absolute path and remove Windows extended-length path prefix (\\?\)
    // faster-whisper cannot handle paths with this prefix
    let normalized = dunce::simplified(&models_dir).to_path_buf();

    eprintln!(
        "[DEBUG] Models dir - original: {:?}, normalized: {:?}",
        models_dir, normalized
    );

    Ok(normalized)
}

/// Get directory for temporary audio caches used by diarization.
fn get_audio_cache_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let app_data = app.path().app_data_dir().map_err(|_| {
        AppError::IoError(std::io::Error::new(
            std::io::ErrorKind::Other,
            "Failed to get app data dir",
        ))
    })?;

    let audio_cache_dir = app_data.join("Vocrify").join("cache").join("audio");
    std::fs::create_dir_all(&audio_cache_dir).map_err(AppError::IoError)?;
    Ok(dunce::simplified(&audio_cache_dir).to_path_buf())
}

/// Internal function to get local models from a directory (testable without Tauri)
pub(crate) fn get_local_models_internal(
    models_dir: &std::path::Path,
) -> Result<Vec<LocalModel>, std::io::Error> {
    let mut models: Vec<LocalModel> = Vec::new();

    if !models_dir.exists() {
        return Ok(models);
    }

    // Individual diarization components to skip - they're handled separately
    let skip_individual: std::collections::HashSet<&str> = std::collections::HashSet::from([
        "sherpa-onnx-segmentation",
        "sherpa-onnx-reverb-diarization-v1",
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
            continue;
        }

        // GigaAM root file (manual installs): v3_e2e_ctc.int8.onnx / v3_e2e_ctc.onnx
        if (file_name == "v3_e2e_ctc.int8.onnx" || file_name == "v3_e2e_ctc.onnx")
            && !models_dir.join("gigaam-v3").is_dir()
        {
            let size_mb = if let Ok(metadata) = std::fs::metadata(&path) {
                metadata.len() / (1024 * 1024)
            } else {
                0
            };

            models.push(LocalModel {
                name: "gigaam-v3".to_string(),
                size_mb,
                model_type: "gigaam".to_string(),
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
        } else if model_name == "tiny"
            || model_name == "base"
            || model_name == "small"
            || model_name == "medium"
            || model_name == "large"
            || model_name == "large-v2"
            || model_name == "large-v3"
        {
            "whisper".to_string()
        } else if model_name.starts_with("distil-") {
            "whisper".to_string()
        } else if model_name.starts_with("parakeet-") {
            "parakeet".to_string()
        } else if model_name.starts_with("gigaam-") {
            "gigaam".to_string()
        } else {
            continue;
        };

        // Check if required files exist for the model type
        let is_valid_model = if model_type == "whisper" {
            // Whisper models require model.bin file
            path.join("model.bin").exists()
        } else if model_type == "parakeet" {
            // Parakeet ONNX models - multiple naming conventions
            let has_encoder = path.join("encoder.onnx").exists()
                || path.join("encoder-model.onnx").exists()
                || path.join("encoder-model.int8.onnx").exists()
                || path.join("encoder-int8.onnx").exists();
            let has_decoder = path.join("decoder.onnx").exists()
                || path.join("decoder_joint.onnx").exists()
                || path.join("decoder_joint-model.onnx").exists()
                || path.join("decoder_joint-model.int8.onnx").exists();
            has_encoder && has_decoder
        } else if model_type == "gigaam" {
            path.join("v3_e2e_ctc.int8.onnx").exists()
                || path.join("v3_e2e_ctc.onnx").exists()
                || path.join("model.int8.onnx").exists()
                || path.join("model.onnx").exists()
        } else {
            // Other models - directory existence is enough
            true
        };

        if !is_valid_model {
            continue;
        }

        // Normalize model name for frontend - convert short names to full names
        // Note: distil-* models keep their original name (not whisper-distil-*)
        let display_name = match model_type.as_str() {
            "whisper"
                if !model_name.starts_with("whisper-") && !model_name.starts_with("distil-") =>
            {
                format!("whisper-{}", model_name)
            }
            _ => model_name,
        };

        if models.iter().any(|model| model.name == display_name) {
            continue;
        }

        models.push(LocalModel {
            name: display_name,
            size_mb,
            model_type,
            installed: true,
            path: Some(path.to_string_lossy().to_string()),
        });
    }

    // Check for diarization models (flat structure: segmentation + embedding in cache root)
    // Sherpa-ONNX diarization - check both flat and nested structures
    // Nested: models/sherpa-onnx-diarization/sherpa-onnx-segmentation/
    // Flat: models/sherpa-onnx-segmentation/
    let nested_seg_path = models_dir
        .join("sherpa-onnx-diarization")
        .join("sherpa-onnx-reverb-diarization-v1");
    let nested_emb_path = models_dir
        .join("sherpa-onnx-diarization")
        .join("sherpa-onnx-embedding");
    let flat_seg_path = models_dir.join("sherpa-onnx-reverb-diarization-v1");
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

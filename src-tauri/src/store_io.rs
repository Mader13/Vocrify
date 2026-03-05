use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::AppError;

pub(crate) fn load_store_data(store_path: &Path) -> Result<serde_json::Value, AppError> {
    if !store_path.exists() {
        return Ok(serde_json::json!({}));
    }

    let content = std::fs::read_to_string(store_path).map_err(AppError::IoError)?;
    serde_json::from_str(&content).map_err(AppError::JsonError)
}

pub(crate) fn save_store_data(store_path: &Path, store_data: &serde_json::Value) -> Result<(), AppError> {
    let fallback = PathBuf::from(".");
    let store_dir = store_path.parent().unwrap_or(&fallback);
    std::fs::create_dir_all(store_dir).map_err(AppError::IoError)?;
    std::fs::write(store_path, store_data.to_string()).map_err(AppError::IoError)
}

/// Get the models store path
pub(crate) fn get_store_path(app: &AppHandle) -> PathBuf {
    let app_data = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));

    app_data.join("Vocrify").join("store.json")
}

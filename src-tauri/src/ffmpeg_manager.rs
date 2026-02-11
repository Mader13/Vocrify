//! FFmpeg Manager Module
//!
//! This module handles FFmpeg binary download and management.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use std::path::PathBuf;
use std::fs::File;
use std::io::{self, BufReader};
use zip::ZipArchive;

/// Recursively find a file by name in a directory
fn find_file_in_dir(dir: &PathBuf, filename: &str) -> Option<PathBuf> {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(found) = find_file_in_dir(&path, filename) {
                    return Some(found);
                }
            } else if path.file_name().map(|n| n == filename).unwrap_or(false) {
                return Some(path);
            }
        }
    }
    None
}

/// Status of FFmpeg installation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FFmpegStatus {
    NotInstalled,
    Available(String),
    Error(String),
}

/// Download progress for FFmpeg
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FFmpegDownloadProgress {
    pub percent: f64,
    pub speed_mb_s: f64,
    pub downloaded_mb: u64,
    pub total_mb: u64,
}

/// Get the path to downloaded FFmpeg binary
pub async fn get_ffmpeg_path(app: &AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let app_data = app.path().app_data_dir()?;
    let ffmpeg_dir = app_data.join("Vocrify").join("ffmpeg");

    let platform_suffix = if cfg!(windows) {
        "ffmpeg.exe"
    } else if cfg!(target_os = "macos") {
        "ffmpeg"
    } else {
        "ffmpeg"
    };

    let ffmpeg_path = ffmpeg_dir.join(platform_suffix);

    if ffmpeg_path.exists() {
        Ok(ffmpeg_path)
    } else {
        Err(format!("FFmpeg not found at {:?}", ffmpeg_path).into())
    }
}

/// Check if FFmpeg is installed
#[tauri::command]
pub async fn get_ffmpeg_status(app: AppHandle) -> Result<serde_json::Value, String> {
    let path = get_ffmpeg_path(&app).await.map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "status": "available",
        "path": path.to_string_lossy().to_string()
    }))
}

/// Download FFmpeg binary
#[tauri::command]
pub async fn download_ffmpeg(app: AppHandle) -> Result<(), String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let ffmpeg_dir = app_data.join("Vocrify").join("ffmpeg");

    std::fs::create_dir_all(&ffmpeg_dir).map_err(|e| format!("Failed to create FFmpeg directory: {}", e))?;

    // BtbN FFmpeg-Builds naming convention: ffmpeg-master-latest-{platform}64-gpl-shared.zip
    let url = if cfg!(windows) {
        "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl-shared.zip".to_string()
    } else if cfg!(target_os = "macos") {
        "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-macos64-gpl-shared.zip".to_string()
    } else {
        "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl-shared.tar.xz".to_string()
    };

    let archive_path = ffmpeg_dir.join("ffmpeg_archive");

    eprintln!("[DEBUG] Downloading FFmpeg from: {}", url);
    eprintln!("[DEBUG] This may take a few minutes (file size ~150MB)...");

    // Use reqwest for downloading with progress tracking
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600)) // 10 minute timeout
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client.get(&url).send().await
        .map_err(|e| format!("Failed to start download: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("Download failed with status: {}. URL may be invalid.", status));
    }

    let total_size = response.content_length().unwrap_or(0);
    eprintln!("[DEBUG] Download started. Total size: {} MB", total_size / 1024 / 1024);

    let bytes = response.bytes().await
        .map_err(|e| format!("Failed to download file: {}", e))?;

    if bytes.len() < 1000 {
        // Likely an error page, not a real archive
        let content = String::from_utf8_lossy(&bytes);
        return Err(format!("Downloaded file is too small ({} bytes). URL may be invalid. Content: {}", bytes.len(), content.chars().take(200).collect::<String>()));
    }

    std::fs::write(&archive_path, &bytes)
        .map_err(|e| format!("Failed to save downloaded file: {}", e))?;

    eprintln!("[DEBUG] Download complete ({} bytes), extracting...", bytes.len());

    let extract_dir = ffmpeg_dir.join("extract");
    std::fs::create_dir_all(&extract_dir).map_err(|e| format!("Failed to create extract directory: {}", e))?;

    // Extract based on archive type
    if url.ends_with(".zip") {
        // Extract ZIP archive
        let zip_file = File::open(&archive_path).map_err(|e| format!("Failed to open zip file: {}", e))?;
        let reader = BufReader::new(zip_file);
        let mut archive = ZipArchive::new(reader).map_err(|e| format!("Failed to read zip archive: {}", e))?;

        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| format!("Failed to access zip entry: {}", e))?;
            let outpath = extract_dir.join(file.mangled_name());

            if file.name().ends_with('/') {
                std::fs::create_dir_all(&outpath).map_err(|e| format!("Failed to create directory: {}", e))?;
            } else {
                if let Some(parent) = outpath.parent() {
                    if !parent.exists() {
                        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent directory: {}", e))?;
                    }
                }
                let mut outfile = File::create(&outpath).map_err(|e| format!("Failed to create output file: {}", e))?;
                io::copy(&mut file, &mut outfile).map_err(|e| format!("Failed to extract file: {}", e))?;
            }
        }
    } else if url.ends_with(".tar.xz") {
        // Extract tar.xz archive using xz2 and tar
        use std::process::Command as ProcessCommand;
        let output = ProcessCommand::new("tar")
            .arg("-xf")
            .arg(&archive_path)
            .arg("-C")
            .arg(&extract_dir)
            .output()
            .map_err(|e| format!("Failed to extract tar.xz: {}", e))?;
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to extract tar.xz: {}", stderr));
        }
    }

    eprintln!("[DEBUG] Extraction complete");

    let ffmpeg_name = if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };

    // Find ffmpeg binary in the extracted directory (handles nested folders)
    let source_path = find_file_in_dir(&extract_dir, ffmpeg_name)
        .ok_or_else(|| format!("FFmpeg binary not found in extracted archive"))?;
    let target_path = ffmpeg_dir.join(ffmpeg_name);

    std::fs::rename(&source_path, &target_path).map_err(|e| format!("Failed to move FFmpeg: {}", e))?;

    std::fs::remove_file(&archive_path).map_err(|e| format!("Failed to delete archive file: {}", e))?;
    std::fs::remove_dir_all(&extract_dir).map_err(|e| format!("Failed to delete extract directory: {}", e))?;

    eprintln!("[DEBUG] FFmpeg installed successfully at: {:?}", target_path);

    Ok(())
}

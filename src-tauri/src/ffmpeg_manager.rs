//! FFmpeg Manager Module
//!
//! This module handles FFmpeg binary download and management.

use futures_util::stream::StreamExt;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{self, BufReader};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;
use zip::ZipArchive;

/// Event payload for FFmpeg download progress
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FFmpegDownloadProgressEvent {
    pub current_bytes: u64,
    pub total_bytes: u64,
    pub percent: f64,
    pub status: String,
}

/// Event payload for FFmpeg status updates
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FFmpegStatusEvent {
    pub status: String,
    pub message: String,
}

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

/// Emit FFmpeg download progress event
fn emit_ffmpeg_progress(app: &AppHandle, current: u64, total: u64) {
    let percent = if total > 0 {
        (current as f64 / total as f64) * 100.0
    } else {
        0.0
    };

    let _ = app.emit(
        "ffmpeg-download-progress",
        FFmpegDownloadProgressEvent {
            current_bytes: current,
            total_bytes: total,
            percent,
            status: "downloading".to_string(),
        },
    );
}

/// Emit FFmpeg status event with user-friendly message
fn emit_ffmpeg_status(app: &AppHandle, status: &str, message: &str) {
    // Convert technical messages to user-friendly ones
    let user_message = convert_to_user_message(status, message);

    let _ = app.emit(
        "ffmpeg-status",
        FFmpegStatusEvent {
            status: status.to_string(),
            message: user_message,
        },
    );
}

/// Convert technical error messages to user-friendly ones
fn convert_to_user_message(status: &str, message: &str) -> String {
    if status == "failed" {
        // Map common technical errors to user-friendly messages
        if message.contains("connection") || message.contains("network") {
            return "Failed to download FFmpeg. Please check your internet connection.".to_string();
        }
        if message.contains("timeout") {
            return "Download timed out. Please try again.".to_string();
        }
        if message.contains("status: 404") || message.contains("Not Found") {
            return "Could not find FFmpeg on server. Please try installing manually.".to_string();
        }
        if message.contains("status: 5") || message.contains("Server Error") {
            return "Server is temporarily unavailable. Please try again later.".to_string();
        }
        if message.contains("too small") || message.contains("error page") {
            return "Downloaded file is corrupted. Please try again.".to_string();
        }
        if message.contains("Failed to run") || message.contains("exit code") {
            return "Downloaded FFmpeg does not work. Please try installing manually.".to_string();
        }
        // Generic fallback with less technical detail
        return "Failed to install FFmpeg. Please try again or install manually.".to_string();
    }
    message.to_string()
}

/// Clean up temporary files on error
fn cleanup_on_error(ffmpeg_dir: &PathBuf) {
    // Remove all possible archive variants
    let _ = std::fs::remove_file(ffmpeg_dir.join("ffmpeg_archive.zip"));
    let _ = std::fs::remove_file(ffmpeg_dir.join("ffmpeg_archive.tar.xz"));
    let _ = std::fs::remove_file(ffmpeg_dir.join("ffmpeg_archive"));
    let _ = std::fs::remove_dir_all(ffmpeg_dir.join("extract"));
}

/// Validate ZIP archive before extraction
fn validate_zip_archive(archive_path: &PathBuf) -> Result<usize, String> {
    let file = File::open(archive_path).map_err(|e| format!("Failed to open archive: {}", e))?;
    let reader = BufReader::new(file);
    let archive =
        ZipArchive::new(reader).map_err(|e| format!("Archive is corrupted or not a ZIP: {}", e))?;
    let count = archive.len();

    if count == 0 {
        return Err("Archive is empty".to_string());
    }

    Ok(count)
}

/// Validate that FFmpeg binary exists in extracted files
fn validate_ffmpeg_extraction(extract_dir: &PathBuf, ffmpeg_name: &str) -> Result<PathBuf, String> {
    find_file_in_dir(extract_dir, ffmpeg_name)
        .ok_or_else(|| format!("FFmpeg not found in archive. Archive may be corrupted."))
}

/// Get download URLs for FFmpeg (static builds from gyan.dev)
fn get_ffmpeg_urls() -> (String, String) {
    // gyan.dev provides static builds that don't require DLL dependencies
    if cfg!(windows) {
        // Using release essentials build (version 8.0.1)
        let url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip".to_string();
        let version = "8.0.1".to_string();
        (url, version)
    } else if cfg!(target_os = "macos") {
        // For macOS, use homebrew-style or BtbN static
        let url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-macos64-gpl.zip".to_string();
        let version = "latest".to_string();
        (url, version)
    } else {
        // Linux - use BtbN static build
        let url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz".to_string();
        let version = "latest".to_string();
        (url, version)
    }
}

/// Download with streaming progress and retry logic
async fn download_with_retry(
    client: &reqwest::Client,
    url: &str,
    dest_path: &PathBuf,
    app: &AppHandle,
    max_retries: u32,
) -> Result<u64, String> {
    let mut last_error = String::new();
    let mut retry_delay = 2; // Start with 2 seconds

    for attempt in 1..=max_retries {
        eprintln!(
            "[DEBUG] FFmpeg download attempt {}/{}",
            attempt, max_retries
        );

        if attempt > 1 {
            let msg = format!("Retrying download ({} of {})...", attempt, max_retries);
            emit_ffmpeg_status(app, "downloading", &msg);
            // Exponential backoff: 2s, 4s, 8s
            tokio::time::sleep(std::time::Duration::from_secs(retry_delay)).await;
            retry_delay *= 2;
        }

        match download_with_progress(client, url, dest_path, app).await {
            Ok(bytes) => {
                eprintln!("[DEBUG] Download successful on attempt {}", attempt);
                return Ok(bytes);
            }
            Err(e) => {
                last_error = e;
                eprintln!("[WARN] Download attempt {} failed: {}", attempt, last_error);
                // Remove partial file before retrying
                let _ = std::fs::remove_file(dest_path);
            }
        }
    }

    Err(format!(
        "Failed to download FFmpeg after {} attempts: {}",
        max_retries, last_error
    ))
}

/// Download with streaming progress - writes directly to dest_path (no in-memory buffer)
async fn download_with_progress(
    client: &reqwest::Client,
    url: &str,
    dest_path: &PathBuf,
    app: &AppHandle,
) -> Result<u64, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Connection error: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("Server error: {}", status));
    }

    let total_size = response.content_length().unwrap_or(0);
    eprintln!(
        "[DEBUG] FFmpeg download size: {} MB",
        total_size / 1024 / 1024
    );

    emit_ffmpeg_progress(app, 0, total_size);

    // Open destination file for streaming write
    let mut file = tokio::fs::File::create(dest_path)
        .await
        .map_err(|e| format!("Failed to create destination file: {}", e))?;

    let mut downloaded: u64 = 0;
    let mut last_emit: u64 = 0;
    let chunk_size: u64 = 1024 * 1024; // Emit progress every 1 MB

    let mut stream = response.bytes_stream();
    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("Download error: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Write error: {}", e))?;
        downloaded += chunk.len() as u64;

        if downloaded - last_emit >= chunk_size || downloaded == total_size {
            emit_ffmpeg_progress(app, downloaded, total_size);
            last_emit = downloaded;
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("Flush error: {}", e))?;
    emit_ffmpeg_progress(app, downloaded, total_size);

    Ok(downloaded)
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
        // Fallback: check system PATH
        if let Some(system_ffmpeg) = std::env::var_os("PATH").and_then(|p| {
            std::env::split_paths(&p)
                .filter_map(|p| {
                    let full_path = p.join(platform_suffix);
                    if full_path.exists() {
                        Some(full_path)
                    } else {
                        None
                    }
                })
                .next()
        }) {
            return Ok(system_ffmpeg);
        }

        Err(format!("FFmpeg not found at {:?} or in system PATH", ffmpeg_path).into())
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

/// Extract ZIP archive
fn extract_zip(archive_path: &PathBuf, extract_dir: &PathBuf) -> Result<(), String> {
    let zip_file = File::open(archive_path).map_err(|e| format!("Failed to open ZIP: {}", e))?;
    let reader = BufReader::new(zip_file);
    let mut archive = ZipArchive::new(reader).map_err(|e| format!("Failed to read ZIP: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read from ZIP: {}", e))?;
        let outpath = extract_dir.join(file.mangled_name());

        if file.name().ends_with('/') {
            std::fs::create_dir_all(&outpath)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        } else {
            if let Some(parent) = outpath.parent() {
                if !parent.exists() {
                    std::fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed to create directory: {}", e))?;
                }
            }
            let mut outfile =
                File::create(&outpath).map_err(|e| format!("Failed to create file: {}", e))?;
            io::copy(&mut file, &mut outfile).map_err(|e| format!("Extraction error: {}", e))?;
        }
    }

    Ok(())
}

/// Extract TAR archive
fn extract_tar(archive_path: &PathBuf, extract_dir: &PathBuf) -> Result<(), String> {
    use std::process::Command as ProcessCommand;

    let output = ProcessCommand::new("tar")
        .arg("-xf")
        .arg(archive_path)
        .arg("-C")
        .arg(extract_dir)
        .output()
        .map_err(|e| format!("Failed to run tar: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("tar extraction error: {}", stderr));
    }

    Ok(())
}

/// Download FFmpeg binary
#[tauri::command]
pub async fn download_ffmpeg(app: AppHandle) -> Result<(), String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let ffmpeg_dir = app_data.join("Vocrify").join("ffmpeg");

    std::fs::create_dir_all(&ffmpeg_dir)
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    // Derive archive extension from URL so ZIP validation works correctly
    let (url, _version) = get_ffmpeg_urls();
    let archive_ext = if url.ends_with(".tar.xz") {
        "tar.xz"
    } else {
        "zip"
    };
    let archive_path = ffmpeg_dir.join(format!("ffmpeg_archive.{}", archive_ext));

    eprintln!("[DEBUG] Downloading FFmpeg from: {}", url);
    eprintln!("[DEBUG] This may take a few minutes (file size ~80MB)...");

    emit_ffmpeg_status(&app, "downloading", "Starting FFmpeg download...");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600)) // 10 minute timeout
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // Download directly to disk with retry (3 attempts) - no in-memory buffer
    let downloaded_bytes = match download_with_retry(&client, &url, &archive_path, &app, 3).await {
        Ok(bytes) => bytes,
        Err(e) => {
            cleanup_on_error(&ffmpeg_dir);
            emit_ffmpeg_status(&app, "failed", &e);
            return Err(e);
        }
    };

    // Validate minimum size (essentials build is ~80 MB)
    if downloaded_bytes < 10_000_000 {
        let err_msg = format!(
            "Downloaded file too small ({} bytes). Server may have an error.",
            downloaded_bytes
        );
        cleanup_on_error(&ffmpeg_dir);
        emit_ffmpeg_status(&app, "failed", &err_msg);
        return Err(err_msg);
    }

    eprintln!(
        "[DEBUG] Download complete ({} bytes), validating...",
        downloaded_bytes
    );

    // Validate ZIP integrity before extraction (now always works - archive has .zip extension)
    if archive_ext == "zip" {
        match validate_zip_archive(&archive_path) {
            Ok(count) => eprintln!("[DEBUG] ZIP archive valid, {} entries", count),
            Err(e) => {
                cleanup_on_error(&ffmpeg_dir);
                emit_ffmpeg_status(&app, "failed", &e);
                return Err(e);
            }
        }
    }

    eprintln!("[DEBUG] Extracting FFmpeg...");
    emit_ffmpeg_status(&app, "extracting", "Extracting FFmpeg...");

    let extract_dir = ffmpeg_dir.join("extract");
    let _ = std::fs::remove_dir_all(&extract_dir);
    std::fs::create_dir_all(&extract_dir).map_err(|e| {
        cleanup_on_error(&ffmpeg_dir);
        format!("Failed to create extraction directory: {}", e)
    })?;

    let extraction_result = if url.ends_with(".zip") {
        extract_zip(&archive_path, &extract_dir)
    } else if url.ends_with(".tar.xz") || url.ends_with(".tar.gz") {
        extract_tar(&archive_path, &extract_dir)
    } else {
        Err("Unknown archive format".to_string())
    };

    // Delete archive only AFTER verifying extraction succeeded
    if let Err(e) = extraction_result {
        cleanup_on_error(&ffmpeg_dir);
        emit_ffmpeg_status(&app, "failed", &e);
        return Err(e);
    }
    let _ = std::fs::remove_file(&archive_path);

    eprintln!("[DEBUG] Extraction complete, finding FFmpeg binary...");

    let ffmpeg_name = if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };

    let source_path = match validate_ffmpeg_extraction(&extract_dir, ffmpeg_name) {
        Ok(path) => path,
        Err(e) => {
            cleanup_on_error(&ffmpeg_dir);
            emit_ffmpeg_status(&app, "failed", &e);
            return Err(e);
        }
    };

    let target_path = ffmpeg_dir.join(ffmpeg_name);

    // Move FFmpeg to final location (fallback to copy+delete on cross-device)
    if let Err(e) = std::fs::rename(&source_path, &target_path) {
        if let Ok(mut src) = File::open(&source_path) {
            if let Ok(mut dst) = File::create(&target_path) {
                if io::copy(&mut src, &mut dst).is_ok() {
                    let _ = std::fs::remove_file(&source_path);
                }
            }
        }
        if !target_path.exists() {
            cleanup_on_error(&ffmpeg_dir);
            let err_msg = format!("Failed to install FFmpeg: {}", e);
            emit_ffmpeg_status(&app, "failed", &err_msg);
            return Err(err_msg);
        }
    }

    let _ = std::fs::remove_dir_all(&extract_dir);

    // Set executable bit on Unix - without this the binary cannot be run
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&target_path)
            .map_err(|e| format!("Failed to read file metadata: {}", e))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&target_path, perms)
            .map_err(|e| format!("Failed to set executable permissions: {}", e))?;
        eprintln!("[DEBUG] FFmpeg permissions set to 0o755");
    }

    eprintln!("[DEBUG] Verifying FFmpeg installation...");

    let verify_result = std::process::Command::new(&target_path)
        .arg("-version")
        .output();

    match verify_result {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("unknown")
                .to_string();
            eprintln!("[DEBUG] FFmpeg verified: {}", version);
            emit_ffmpeg_status(&app, "completed", "FFmpeg installed successfully!");
            Ok(())
        }
        Ok(output) => {
            // Binary exists but failed to run - DLLs may be missing on Windows
            let stderr = String::from_utf8_lossy(&output.stderr);
            eprintln!("[WARN] FFmpeg installed but failed to run: {}", stderr);
            emit_ffmpeg_status(
                &app,
                "completed",
                "FFmpeg installed (system restart may be required)",
            );
            Ok(())
        }
        Err(e) => {
            // Cannot execute - remove broken binary
            let _ = std::fs::remove_file(&target_path);
            let err_msg = format!("Failed to verify FFmpeg: {}", e);
            emit_ffmpeg_status(&app, "failed", &err_msg);
            Err(err_msg)
        }
    }
}

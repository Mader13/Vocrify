use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::{AppError, ffmpeg_manager};

fn is_audio_extension(ext: &str) -> bool {
    matches!(ext, "mp3" | "wav" | "m4a" | "flac" | "ogg" | "aac")
}

fn audio_quality_args(compression: &str) -> &'static [&'static str] {
    match compression {
        "light" => &["-codec:a", "libmp3lame", "-q:a", "2"],
        "heavy" => &["-codec:a", "libmp3lame", "-q:a", "6"],
        _ => &["-codec:a", "libmp3lame", "-q:a", "4"],
    }
}

fn video_quality_args(compression: &str) -> &'static [&'static str] {
    match compression {
        "light" => &[
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "24",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
        ],
        "heavy" => &[
            "-c:v",
            "libx264",
            "-preset",
            "slow",
            "-crf",
            "34",
            "-c:a",
            "aac",
            "-b:a",
            "96k",
        ],
        _ => &[
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "29",
            "-c:a",
            "aac",
            "-b:a",
            "112k",
        ],
    }
}

pub(crate) fn copy_file(
    app: &AppHandle,
    source_path: String,
    dest_path: String,
) -> Result<String, AppError> {
    let validated_source = crate::path_validation::validate_scoped_existing_file_path(app, &source_path)?;
    let validated_dest = crate::path_validation::validate_scoped_output_path(app, &dest_path)?;

    if let Some(parent) = validated_dest.parent() {
        std::fs::create_dir_all(parent).map_err(AppError::IoError)?;
    }

    std::fs::copy(&validated_source, &validated_dest).map_err(AppError::IoError)?;
    Ok(validated_dest.to_string_lossy().to_string())
}

pub(crate) async fn compress_media(
    app: &AppHandle,
    input_path: String,
    output_path: String,
    compression: String,
) -> Result<String, AppError> {
    let level = compression.trim().to_lowercase();
    if !matches!(level.as_str(), "none" | "light" | "medium" | "heavy") {
        return Err(AppError::Other(format!(
            "Unsupported compression level: {}",
            compression
        )));
    }

    let validated_input = crate::path_validation::validate_scoped_existing_file_path(app, &input_path)?;
    let validated_output = crate::path_validation::validate_scoped_output_path(app, &output_path)?;

    if level == "none" {
        std::fs::copy(&validated_input, &validated_output).map_err(AppError::IoError)?;
        return Ok(validated_output.to_string_lossy().to_string());
    }

    let ffmpeg_path = ffmpeg_manager::get_ffmpeg_path(app)
        .await
        .map_err(|e| AppError::Other(format!("FFmpeg not found: {}", e)))?;

    let ext = validated_input
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    let mut command = std::process::Command::new(&ffmpeg_path);
    command.arg("-y");
    command.arg("-i");
    command.arg(validated_input.to_string_lossy().to_string());

    if is_audio_extension(&ext) {
        command.args(audio_quality_args(&level));
    } else {
        command.args(video_quality_args(&level));
    }

    command.arg(validated_output.to_string_lossy().to_string());
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW: скрывает окно консоли на Windows

    let output = command.output().map_err(AppError::IoError)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Other(format!(
            "Media compression failed: {}",
            stderr
        )));
    }

    if !validated_output.exists() {
        return Err(AppError::Other(
            "Compression finished but output file was not created".to_string(),
        ));
    }

    Ok(validated_output.to_string_lossy().to_string())
}

pub(crate) fn get_archive_dir(app: &AppHandle) -> Result<String, AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let archive_dir = app_data_dir.join("archive");

    if !archive_dir.exists() {
        std::fs::create_dir_all(&archive_dir).map_err(AppError::IoError)?;
    }

    Ok(archive_dir.to_string_lossy().to_string())
}

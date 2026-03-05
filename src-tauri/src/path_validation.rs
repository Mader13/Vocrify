use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::AppError;

/// Allowed base directories for file access (empty = allow all directories)
/// Set this to restrict file access to specific directories for security
const ALLOWED_DIRS: &[&str] = &[];

/// User directories allowed for client-provided destructive/export paths.
const USER_ALLOWED_SUBDIRS: &[&str] = &["Downloads", "Documents", "Desktop", "Music", "Videos"];

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
pub(crate) fn validate_file_path(file_path: &str) -> Result<PathBuf, AppError> {
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
                Ok(allowed_canonical) => canonical.as_path().starts_with(allowed_canonical.as_path()),
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

fn get_scoped_allowed_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut dirs = vec![std::env::temp_dir()];

    if let Ok(app_data_dir) = app.path().app_data_dir() {
        dirs.push(app_data_dir.clone());
        dirs.push(app_data_dir.join("Vocrify"));
        dirs.push(app_data_dir.join("Vocrify").join("transcriptions"));
        dirs.push(app_data_dir.join("archive"));
    }

    if let Ok(home_dir) = app.path().home_dir() {
        dirs.push(home_dir.clone());
    }

    if let Ok(download_dir) = app.path().download_dir() {
        dirs.push(download_dir);
    }

    if let Ok(document_dir) = app.path().document_dir() {
        dirs.push(document_dir);
    }

    if let Ok(desktop_dir) = app.path().desktop_dir() {
        dirs.push(desktop_dir);
    }

    if let Ok(audio_dir) = app.path().audio_dir() {
        dirs.push(audio_dir);
    }

    if let Ok(video_dir) = app.path().video_dir() {
        dirs.push(video_dir);
    }

    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        let user_root = PathBuf::from(user_profile);
        if user_root.exists() {
            dirs.push(user_root.clone());
            for subdir in USER_ALLOWED_SUBDIRS {
                dirs.push(user_root.join(subdir));
            }
        }
    }

    dirs.into_iter()
        .filter_map(|dir| {
            if dir.exists() {
                dir.canonicalize().ok()
            } else {
                None
            }
        })
        .collect()
}

fn ensure_path_in_scoped_allowlist(app: &AppHandle, path: &Path) -> Result<(), AppError> {
    let allowed_dirs = get_scoped_allowed_dirs(app);
    let is_allowed = allowed_dirs.iter().any(|allowed| path.starts_with(allowed));

    if is_allowed {
        Ok(())
    } else {
        Err(AppError::AccessDenied(format!(
            "Path is outside allowed scoped directories: {}",
            path.display()
        )))
    }
}

pub(crate) fn validate_scoped_existing_file_path(app: &AppHandle, file_path: &str) -> Result<PathBuf, AppError> {
    let canonical = validate_file_path(file_path)?;
    ensure_path_in_scoped_allowlist(app, &canonical)?;
    Ok(canonical)
}

pub(crate) fn validate_scoped_output_path(app: &AppHandle, output_path: &str) -> Result<PathBuf, AppError> {
    let output = PathBuf::from(output_path);
    let parent = output.parent().ok_or_else(|| {
        AppError::AccessDenied(format!("Output path has no parent directory: {}", output_path))
    })?;

    if !parent.exists() {
        return Err(AppError::NotFound(format!(
            "Output parent directory does not exist: {}",
            parent.display()
        )));
    }

    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| AppError::NotFound(format!("Failed to resolve output parent path: {}", e)))?;
    ensure_path_in_scoped_allowlist(app, &canonical_parent)?;

    let file_name = output.file_name().ok_or_else(|| {
        AppError::AccessDenied(format!("Output path must include a file name: {}", output_path))
    })?;

    Ok(canonical_parent.join(file_name))
}

pub(crate) fn validate_scoped_storage_directory_path(
    app: &AppHandle,
    directory_path: &str,
) -> Result<PathBuf, AppError> {
    let path = PathBuf::from(directory_path);

    if path.exists() && !path.is_dir() {
        return Err(AppError::AccessDenied(format!(
            "Storage path must be a directory: {}",
            path.display()
        )));
    }

    if !path.exists() {
        std::fs::create_dir_all(&path).map_err(|e| {
            AppError::IoError(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("Failed to create storage directory: {}", e),
            ))
        })?;
    }

    let canonical = path.canonicalize().map_err(|e| {
        AppError::NotFound(format!("Failed to resolve storage directory path: {}", e))
    })?;

    ensure_path_in_scoped_allowlist(app, &canonical)?;
    Ok(canonical)
}

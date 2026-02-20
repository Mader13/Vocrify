use std::path::Path;

pub(crate) fn cleanup_temp_wav_file(path: &Path, should_cleanup: bool) {
    if !should_cleanup {
        return;
    }

    if let Err(error) = std::fs::remove_file(path) {
        eprintln!(
            "[WARN] Failed to remove temporary wav {}: {}",
            path.display(),
            error
        );
    }
}

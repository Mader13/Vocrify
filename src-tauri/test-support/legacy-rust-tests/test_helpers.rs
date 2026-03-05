use std::path::PathBuf;
use std::fs;
use tempfile::TempDir;

pub fn fixture_path(name: &str) -> PathBuf {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("tests/fixtures");
    path.push(name);
    path
}

pub fn create_temp_audio() -> PathBuf {
    // Create temporary audio file for testing
    let temp_dir = TempDir::new().unwrap();
    let temp_path = temp_dir.path().join("test_audio.wav");

    // Create a minimal WAV file (just a placeholder for testing)
    let wav_header = b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x44\xAC\x00\x00\x88\x58\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00";
    fs::write(&temp_path, wav_header).unwrap();

    temp_path
}

pub fn assert_file_exists(path: &PathBuf) {
    assert!(path.exists(), "File does not exist: {}", path.display());
}

pub fn assert_file_not_empty(path: &PathBuf) {
    assert_file_exists(path);
    let metadata = fs::metadata(path).unwrap();
    assert!(metadata.len() > 0, "File is empty: {}", path.display());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_temp_audio() {
        let audio_path = create_temp_audio();
        assert_file_exists(&audio_path);
        assert_file_not_empty(&audio_path);
    }

    #[test]
    fn test_fixture_path() {
        let path = fixture_path("test.wav");
        assert_eq!(path.file_name().unwrap().to_str().unwrap(), "test.wav");
    }
}

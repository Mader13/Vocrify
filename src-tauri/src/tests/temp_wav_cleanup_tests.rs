use std::fs;

#[test]
fn cleanup_temp_wav_removes_file_when_conversion_was_used() {
    let temp_path =
        std::env::temp_dir().join(format!("vocrify-cleanup-test-{}.wav", std::process::id()));

    fs::write(&temp_path, b"wav").expect("temp wav should be created");
    assert!(temp_path.exists());

    super::cleanup_temp_wav_file(&temp_path, true);

    assert!(!temp_path.exists());
}

#[test]
fn cleanup_temp_wav_keeps_original_path_when_no_conversion() {
    let temp_path =
        std::env::temp_dir().join(format!("vocrify-original-test-{}.wav", std::process::id()));

    fs::write(&temp_path, b"wav").expect("temp source should be created");
    assert!(temp_path.exists());

    super::cleanup_temp_wav_file(&temp_path, false);

    assert!(temp_path.exists());
    let _ = fs::remove_file(&temp_path);
}

#[test]
fn cleanup_contract_removes_temp_file_only_when_flag_enabled() {
    let temp_path = std::env::temp_dir().join(format!(
        "vocrify-refactor-contract-{}.wav",
        std::process::id()
    ));

    fs::write(&temp_path, b"wav").expect("temp file created");
    super::cleanup_temp_wav_file(&temp_path, true);
    assert!(!temp_path.exists());
}

use std::fs;
use std::path::Path;

#[test]
fn inference_hot_path_avoids_audio_buffer_clones() {
    let source_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src")
        .join("transcription_manager.rs");

    let source =
        fs::read_to_string(source_path).expect("transcription_manager.rs should be readable");

    assert!(!source.contains("audio_data.clone()"));
    assert!(!source.contains("audio_data_owned = audio_data.clone()"));
}

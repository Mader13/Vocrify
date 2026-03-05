use crate::models_dir::get_local_models_internal;

/// Helper to create a temporary directory with model structure
fn create_test_models_dir(temp_dir: &std::path::Path) {
    // Create whisper-base model
    let whisper_path = temp_dir.join("whisper-base");
    std::fs::create_dir_all(&whisper_path).unwrap();
    std::fs::write(whisper_path.join("model.bin"), vec![0u8; 1024 * 1024]).unwrap(); // 1MB

    // Create sherpa-onnx diarization components (nested structure)
    let diar_base = temp_dir.join("sherpa-onnx-diarization");
    let seg_path = diar_base.join("sherpa-onnx-reverb-diarization-v1");
    std::fs::create_dir_all(&seg_path).unwrap();
    std::fs::write(seg_path.join("model.onnx"), vec![0u8; 1024 * 1024]).unwrap();

    let emb_path = diar_base.join("sherpa-onnx-embedding");
    std::fs::create_dir_all(&emb_path).unwrap();
    std::fs::write(emb_path.join("model.onnx"), vec![0u8; 1024 * 1024]).unwrap();
}

#[test]
fn test_get_local_models_diarization() {
    let temp_dir = tempfile::tempdir().unwrap();
    create_test_models_dir(temp_dir.path());

    // Test detection
    let models = get_local_models_internal(temp_dir.path()).unwrap();

    // Should have whisper-base and sherpa-onnx-diarization
    assert_eq!(models.len(), 2, "Should detect 2 models");

    // Check whisper model
    let whisper = models.iter().find(|m| m.name == "whisper-base");
    assert!(whisper.is_some(), "Should find whisper-base");
    let whisper = whisper.unwrap();
    assert_eq!(whisper.model_type, "whisper");
    assert!(whisper.path.is_some());

    // Check diarization model
    let diarization = models.iter().find(|m| m.name == "sherpa-onnx-diarization");
    assert!(diarization.is_some(), "Should find sherpa-onnx-diarization");
    let diarization = diarization.unwrap();
    assert_eq!(diarization.model_type, "diarization");
    assert!(
        diarization.path.is_none(),
        "Diarization should have no single path"
    );
    assert_eq!(
        diarization.size_mb, 2,
        "Diarization size should be 2MB (1+1)"
    );
}

#[test]
fn test_get_local_models_skips_individual_components() {
    let temp_dir = tempfile::tempdir().unwrap();

    // Create only individual components (no complete diarization)
    let seg_path = temp_dir.path().join("sherpa-onnx-reverb-diarization-v1");
    std::fs::create_dir_all(&seg_path).unwrap();
    std::fs::File::create(seg_path.join("model.onnx")).unwrap();

    // Should not detect any models (individual components are skipped)
    let models = get_local_models_internal(temp_dir.path()).unwrap();
    assert_eq!(models.len(), 0, "Should not detect individual components");
}

#[test]
fn test_get_local_models_sherpa_diarization() {
    let temp_dir = tempfile::tempdir().unwrap();

    // Create sherpa diarization components
    let seg_path = temp_dir.path().join("sherpa-onnx-reverb-diarization-v1");
    std::fs::create_dir_all(&seg_path).unwrap();
    std::fs::write(seg_path.join("model.onnx"), vec![0u8; 1024 * 1024]).unwrap(); // 1MB

    let emb_path = temp_dir.path().join("sherpa-onnx-embedding");
    std::fs::create_dir_all(&emb_path).unwrap();
    std::fs::write(
        emb_path.join("3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"),
        vec![0u8; 1024 * 1024],
    )
    .unwrap(); // 1MB

    let models = get_local_models_internal(temp_dir.path()).unwrap();

    // Should detect sherpa-onnx-diarization
    assert_eq!(models.len(), 1);
    let diarization = &models[0];
    assert_eq!(diarization.name, "sherpa-onnx-diarization");
    assert_eq!(diarization.model_type, "diarization");
    assert_eq!(diarization.size_mb, 2, "Size should be 2MB (1+1)");
}

#[test]
fn test_get_local_models_empty_dir() {
    let temp_dir = tempfile::tempdir().unwrap();
    let models = get_local_models_internal(temp_dir.path()).unwrap();
    assert_eq!(models.len(), 0, "Empty dir should return empty list");
}

#[test]
fn test_get_local_models_nonexistent_dir() {
    let models = get_local_models_internal(std::path::Path::new("/nonexistent/path")).unwrap();
    assert_eq!(models.len(), 0, "Nonexistent dir should return empty list");
}

#[test]
fn test_get_local_models_skips_incomplete_whisper_model() {
    let temp_dir = tempfile::tempdir().unwrap();
    let models_path = temp_dir.path();

    // Create whisper-base directory WITHOUT model.bin file
    let whisper_path = models_path.join("whisper-base");
    std::fs::create_dir_all(&whisper_path).unwrap();
    // Don't create model.bin - this should be detected as invalid

    // Should not detect whisper model (incomplete - missing model.bin)
    let models = get_local_models_internal(models_path).unwrap();
    assert_eq!(
        models.len(),
        0,
        "Should not detect incomplete whisper model (missing model.bin)"
    );

    // Now create model.bin - should be detected
    std::fs::write(whisper_path.join("model.bin"), vec![0u8; 1024 * 1024]).unwrap();
    let models = get_local_models_internal(models_path).unwrap();
    assert_eq!(
        models.len(),
        1,
        "Should detect complete whisper model (has model.bin)"
    );
    let whisper = models.first().unwrap();
    assert_eq!(whisper.name, "whisper-base");
    assert_eq!(whisper.model_type, "whisper");
    assert!(whisper.path.is_some());
}

#[test]
fn test_get_local_models_detects_complete_whisper_model() {
    let temp_dir = tempfile::tempdir().unwrap();
    let models_path = temp_dir.path();

    // Create whisper-base directory WITH model.bin file
    let whisper_path = models_path.join("whisper-base");
    std::fs::create_dir_all(&whisper_path).unwrap();
    std::fs::write(whisper_path.join("model.bin"), vec![0u8; 1024 * 1024]).unwrap(); // 1MB

    // Should detect whisper model
    let models = get_local_models_internal(models_path).unwrap();
    assert_eq!(models.len(), 1, "Should detect complete whisper model");
    let whisper = models.first().unwrap();
    assert_eq!(whisper.name, "whisper-base");
    assert_eq!(whisper.model_type, "whisper");
    assert!(whisper.path.is_some());
}

#[test]
fn test_get_local_models_detects_ggml_bin_files() {
    let temp_dir = tempfile::tempdir().unwrap();
    let models_path = temp_dir.path();

    // Create GGML .bin file directly in models/ root (as downloaded by new downloader logic)
    std::fs::write(
        models_path.join("ggml-small.bin"),
        vec![0u8; 100 * 1024 * 1024],
    )
    .unwrap(); // 100MB

    // Should detect whisper model from .bin file
    let models = get_local_models_internal(models_path).unwrap();
    assert_eq!(models.len(), 1, "Should detect GGML .bin file");
    let whisper = models.first().unwrap();
    assert_eq!(whisper.name, "whisper-small");
    assert_eq!(whisper.model_type, "whisper");
    assert_eq!(whisper.size_mb, 100, "Size should be 100MB");
    assert!(whisper.path.is_some());
    assert!(whisper.path.as_ref().unwrap().ends_with("ggml-small.bin"));
}

#[test]
fn test_get_local_models_detects_both_ggml_and_directory() {
    let temp_dir = tempfile::tempdir().unwrap();
    let models_path = temp_dir.path();

    // Create GGML .bin file
    std::fs::write(
        models_path.join("ggml-tiny.bin"),
        vec![0u8; 50 * 1024 * 1024],
    )
    .unwrap(); // 50MB

    // Create whisper-base directory
    let whisper_path = models_path.join("whisper-base");
    std::fs::create_dir_all(&whisper_path).unwrap();
    std::fs::write(whisper_path.join("model.bin"), vec![0u8; 1024 * 1024]).unwrap(); // 1MB

    // Should detect both models
    let models = get_local_models_internal(models_path).unwrap();
    assert_eq!(
        models.len(),
        2,
        "Should detect both GGML and directory models"
    );

    // Check GGML model
    let ggml_model = models.iter().find(|m| m.name == "whisper-tiny").unwrap();
    assert_eq!(ggml_model.model_type, "whisper");
    assert_eq!(ggml_model.size_mb, 50);

    // Check directory model
    let dir_model = models.iter().find(|m| m.name == "whisper-base").unwrap();
    assert_eq!(dir_model.model_type, "whisper");
}

#[test]
fn test_get_local_models_detects_all_ggml_variants() {
    let temp_dir = tempfile::tempdir().unwrap();
    let models_path = temp_dir.path();

    // Create GGML files for all model size variants
    let ggml_files = [
        ("ggml-tiny.bin", 50 * 1024 * 1024),       // 50 MB
        ("ggml-base.bin", 100 * 1024 * 1024),      // 100 MB
        ("ggml-small.bin", 200 * 1024 * 1024),     // 200 MB
        ("ggml-medium.bin", 500 * 1024 * 1024),    // 500 MB
        ("ggml-large-v2.bin", 1000 * 1024 * 1024), // 1 GB
        ("ggml-large-v3.bin", 1000 * 1024 * 1024), // 1 GB
    ];

    for (filename, size) in ggml_files {
        std::fs::write(models_path.join(filename), vec![0u8; size]).unwrap();
    }

    // Should detect all 6 GGML models
    let models = get_local_models_internal(models_path).unwrap();
    assert_eq!(models.len(), 6, "Should detect all 6 GGML model variants");

    // Verify each model
    let expected_models = [
        ("whisper-tiny", 50),
        ("whisper-base", 100),
        ("whisper-small", 200),
        ("whisper-medium", 500),
        ("whisper-large-v2", 1000),
        ("whisper-large-v3", 1000),
    ];

    for (name, expected_size_mb) in expected_models {
        let model = models.iter().find(|m| m.name == name).unwrap_or_else(|| {
            panic!(
                "Model {} not found. Available models: {:?}",
                name,
                models.iter().map(|m| &m.name).collect::<Vec<_>>()
            );
        });
        assert_eq!(model.model_type, "whisper");
        assert_eq!(model.size_mb, expected_size_mb);
        assert!(model.path.is_some());
        assert!(model.path.as_ref().unwrap().contains("ggml-"));
    }
}

#[test]
fn test_get_local_models_detects_gigaam_directory() {
    let temp_dir = tempfile::tempdir().unwrap();
    let models_path = temp_dir.path();

    let gigaam_path = models_path.join("gigaam-v3");
    std::fs::create_dir_all(&gigaam_path).unwrap();
    std::fs::write(
        gigaam_path.join("v3_e2e_ctc.int8.onnx"),
        vec![0u8; 5 * 1024 * 1024],
    )
    .unwrap();

    let models = get_local_models_internal(models_path).unwrap();
    assert_eq!(models.len(), 1, "Should detect gigaam-v3 model directory");

    let gigaam = models.first().unwrap();
    assert_eq!(gigaam.name, "gigaam-v3");
    assert_eq!(gigaam.model_type, "gigaam");
    assert_eq!(gigaam.size_mb, 5);
    assert!(gigaam.path.is_some());
}

#[test]
fn test_get_local_models_detects_gigaam_root_file() {
    let temp_dir = tempfile::tempdir().unwrap();
    let models_path = temp_dir.path();

    std::fs::write(
        models_path.join("v3_e2e_ctc.int8.onnx"),
        vec![0u8; 5 * 1024 * 1024],
    )
    .unwrap();

    let models = get_local_models_internal(models_path).unwrap();
    assert_eq!(models.len(), 1, "Should detect gigaam root ONNX file");

    let gigaam = models.first().unwrap();
    assert_eq!(gigaam.name, "gigaam-v3");
    assert_eq!(gigaam.model_type, "gigaam");
    assert_eq!(gigaam.size_mb, 5);
    assert!(gigaam.path.is_some());
    assert!(gigaam
        .path
        .as_ref()
        .unwrap()
        .ends_with("v3_e2e_ctc.int8.onnx"));
}

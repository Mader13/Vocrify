use std::path::{Path, PathBuf};

use crate::transcription::{EngineType, TranscriptionError};

pub fn get_model_path(
    models_dir: &Path,
    model_name: &str,
    engine_type: EngineType,
) -> Result<PathBuf, TranscriptionError> {
    match engine_type {
        EngineType::Whisper => {
            // Whisper models can be a directory or direct GGML file
            let model_dir = models_dir.join(model_name);
            if model_dir.exists() && model_dir.is_dir() {
                Ok(model_dir)
            } else {
                // Try as direct GGML file
                let ggml_name = format!("ggml-{}.bin", model_name.trim_start_matches("whisper-"));
                Ok(models_dir.join(ggml_name))
            }
        }
        EngineType::GigaAM => {
            let model_dir = models_dir.join(model_name);
            if model_dir.exists() {
                return Ok(model_dir);
            }

            let int8_file = models_dir.join("v3_e2e_ctc.int8.onnx");
            if int8_file.exists() {
                return Ok(int8_file);
            }

            let fp32_file = models_dir.join("v3_e2e_ctc.onnx");
            if fp32_file.exists() {
                return Ok(fp32_file);
            }

            Ok(model_dir)
        }
        EngineType::Parakeet | EngineType::Moonshine | EngineType::SenseVoice => {
            // ONNX models are in directories
            Ok(models_dir.join(model_name))
        }
    }
}

pub fn find_onnx_file(model_path: &Path) -> Result<PathBuf, TranscriptionError> {
    if model_path.is_file() && model_path.extension().is_some_and(|ext| ext == "onnx") {
        return Ok(model_path.to_path_buf());
    }
    if model_path.is_file() {
        return Err(TranscriptionError::ModelNotFound(format!(
            "Expected ONNX model file, got {:?}",
            model_path
        )));
    }

    let preferred_names = [
        "v3_e2e_ctc.int8.onnx",
        "v3_e2e_ctc.onnx",
        "model.int8.onnx",
        "model.onnx",
    ];
    for file_name in preferred_names {
        let candidate = model_path.join(file_name);
        if candidate.exists() && candidate.is_file() {
            return Ok(candidate);
        }
    }

    for entry in std::fs::read_dir(model_path)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "onnx") {
            return Ok(path);
        }
    }

    Err(TranscriptionError::ModelNotFound(format!(
        "No ONNX model file found in {:?}",
        model_path
    )))
}

pub fn find_ggml_file(model_path: &Path) -> Result<PathBuf, TranscriptionError> {
    if model_path.is_file() {
        return Ok(model_path.to_path_buf());
    }

    // Look for .bin files in the directory
    for entry in std::fs::read_dir(model_path)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().map_or(false, |ext| ext == "bin") {
            return Ok(path);
        }
    }

    Err(TranscriptionError::ModelNotFound(format!(
        "No GGML model file found in {:?}",
        model_path
    )))
}

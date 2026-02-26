use crate::AppError;
use silero_vad_rust::silero_vad::data::SILERO_VAD_ONNX;
use silero_vad_rust::silero_vad::model::OnnxModel;
use silero_vad_rust::silero_vad::utils_vad::VadParameters;
use silero_vad_rust::{get_speech_timestamps, load_silero_vad};
use std::path::PathBuf;

pub struct VadManager {
    model: OnnxModel,
    params: VadParameters,
}

impl VadManager {
    fn candidate_model_paths() -> Vec<PathBuf> {
        let mut candidates = Vec::new();

        if let Ok(explicit_path) = std::env::var("SILERO_VAD_MODEL_PATH") {
            let trimmed = explicit_path.trim();
            if !trimmed.is_empty() {
                candidates.push(PathBuf::from(trimmed));
            }
        }

        if let Ok(current_exe) = std::env::current_exe() {
            if let Some(exe_dir) = current_exe.parent() {
                candidates.push(exe_dir.join("vad").join(SILERO_VAD_ONNX));
                candidates.push(exe_dir.join("resources").join("vad").join(SILERO_VAD_ONNX));
            }
        }

        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("vad")
                .join(SILERO_VAD_ONNX),
        );

        if let Some(home_dir) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))
        {
            let registry_src = PathBuf::from(home_dir)
                .join(".cargo")
                .join("registry")
                .join("src");
            if let Ok(registries) = std::fs::read_dir(registry_src) {
                for registry in registries.flatten() {
                    candidates.push(
                        registry
                            .path()
                            .join("silero-vad-rust-6.2.1")
                            .join("src")
                            .join("silero_vad")
                            .join("data")
                            .join(SILERO_VAD_ONNX),
                    );
                }
            }
        }

        candidates
    }

    fn load_model_from_known_paths() -> Result<OnnxModel, AppError> {
        let mut checked = Vec::new();

        for path in Self::candidate_model_paths() {
            checked.push(path.display().to_string());
            if !path.exists() {
                continue;
            }

            match OnnxModel::from_path(&path, true) {
                Ok(model) => {
                    eprintln!("[INFO] Loaded Silero VAD model from {:?}", path);
                    return Ok(model);
                }
                Err(err) => {
                    eprintln!(
                        "[WARN] Failed to load Silero VAD model from {:?}: {}",
                        path, err
                    );
                }
            }
        }

        Err(AppError::ModelError(format!(
            "Silero VAD model file was not found in runtime locations. Checked: {}",
            checked.join(", ")
        )))
    }

    pub fn new() -> Result<Self, AppError> {
        let model = match Self::load_model_from_known_paths() {
            Ok(model) => model,
            Err(path_error) => {
                eprintln!(
                    "[WARN] {}. Falling back to silero-vad-rust default loader.",
                    path_error
                );
                load_silero_vad().map_err(|e| {
                    AppError::ModelError(format!(
                        "Failed to load Silero VAD model: {}. Fallback loader error: {:?}",
                        path_error, e
                    ))
                })?
            }
        };

        let params = VadParameters {
            return_seconds: false, // We need precise sample indices to avoid float drift
            // More permissive VAD settings improve recall on speech mixed with wind/background noise.
            threshold: 0.42,
            min_speech_duration_ms: 180,
            min_silence_duration_ms: 220,
            speech_pad_ms: 480,
            sampling_rate: 16000, // Hardcoded for Whisper/Parakeet pipeline
            ..Default::default()
        };

        Ok(Self { model, params })
    }

    /// Returns a list of (start_idx, end_idx) corresponding to speech segments in samples.
    pub fn get_speech_segments(
        &mut self,
        audio_data: &[f32],
    ) -> Result<Vec<(usize, usize)>, AppError> {
        let timestamps = get_speech_timestamps(audio_data, &mut self.model, &self.params)
            .map_err(|e| AppError::Other(format!("Failed to generate VAD timestamps: {:?}", e)))?;

        let mut segments = Vec::with_capacity(timestamps.len());
        for ts in timestamps {
            segments.push((ts.start as usize, ts.end as usize));
        }

        Ok(segments)
    }
}

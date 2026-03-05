pub mod audio_pipeline;
pub mod diarization_pipeline;
pub mod engine;
pub mod engine_inference;
mod gigaam_inference;
pub mod engine_tuning;
pub mod errors;
pub mod model_paths;
pub mod model_state;
pub mod options;
pub mod pipeline;
pub mod stages;

pub use options::{
    normalize_diarization_provider, normalize_optional_language, TranscriptionOptions,
};
pub use engine::EngineType;
pub use errors::TranscriptionError;
#[cfg(feature = "rust-transcribe")]
pub use audio_pipeline::load_audio_file;
pub use diarization_pipeline::run_native_diarization;
#[cfg(feature = "rust-transcribe")]
pub use engine_inference::{
    transcribe_with_gigaam, transcribe_with_moonshine, transcribe_with_parakeet, transcribe_with_sensevoice,
    transcribe_with_whisper,
};
#[cfg(feature = "rust-transcribe")]
pub use engine_tuning::{
    adaptive_asr_enabled, asr_vad_chunking_enabled, engine_chunk_size_samples, env_flag,
    should_try_full_audio_first, whisper_dithering_enabled,
};
pub use model_paths::{find_ggml_file, find_onnx_file, get_model_path};
pub use model_state::{
    current_model_name, get_current_model, is_model_loaded, set_current_model_name,
};
pub use pipeline::{normalize_and_filter_segments, send_stage};
#[cfg(feature = "rust-transcribe")]
pub use pipeline::to_internal_segments;
pub use stages::TranscriptionStage;

use tauri::AppHandle;

/// Run native Sherpa-ONNX diarization directly in Rust.
#[tauri::command]
pub(crate) async fn diarize_native(
    app: AppHandle,
    task_id: String,
    audio_path: String,
    num_speakers: Option<i32>,
) -> Result<Vec<crate::types::SpeakerSegment>, String> {
    crate::application::diarization::diarize_native(&app, task_id, audio_path, num_speakers).await
}

/// Backward-compatible alias for older frontend calls.
#[tauri::command]
pub(crate) async fn diarize_sherpa(
    app: AppHandle,
    task_id: String,
    audio_path: String,
    num_speakers: Option<i32>,
) -> Result<Vec<crate::types::SpeakerSegment>, String> {
    crate::application::diarization::diarize_sherpa(&app, task_id, audio_path, num_speakers).await
}

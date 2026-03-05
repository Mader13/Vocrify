use tauri::{AppHandle, State};

use crate::{
    app_state::{RustTaskHandles, TranscriptionManagerState},
    TranscriptionResult,
};

/// Transcribe using Rust transcribe-rs engine.
#[tauri::command]
pub(crate) async fn transcribe_rust(
    task_id: String,
    file_path: String,
    options: crate::RustTranscriptionOptions,
    app: AppHandle,
    state: State<'_, TranscriptionManagerState>,
    rust_handles: State<'_, RustTaskHandles>,
) -> Result<TranscriptionResult, String> {
    crate::application::transcription_runtime::transcribe_rust(
        task_id,
        file_path,
        options,
        app,
        state,
        rust_handles,
    )
    .await
}

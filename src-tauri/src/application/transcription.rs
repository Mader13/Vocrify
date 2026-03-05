//! Transcription use cases and orchestrators.

#![allow(unused_imports)]

use tauri::{AppHandle, State};

use crate::app_state::TranscriptionManagerState;

pub use crate::transcription_manager::{
    EngineType, SpeakerTurn, TranscriptionError, TranscriptionManager, TranscriptionOptions,
    TranscriptionResult, TranscriptionSegment,
};

pub mod pipeline {
    pub use crate::transcription::*;
}

pub(crate) async fn ensure_manager_initialized(
    state: &State<'_, TranscriptionManagerState>,
    app_handle: &AppHandle,
) -> Result<(), String> {
    const MAX_WAIT_MS: u64 = 30000;
    const CHECK_INTERVAL_MS: u64 = 100;

    let start = std::time::Instant::now();

    loop {
        {
            let guard = state.lock().await;
            if guard.is_some() {
                return Ok(());
            }
        }

        if start.elapsed().as_millis() as u64 > MAX_WAIT_MS {
            eprintln!("[WARN] TranscriptionManager initialization timeout, attempting manual init");
            let mut guard = state.lock().await;
            if guard.is_some() {
                return Ok(());
            }
            let manager = crate::models_dir::build_transcription_manager(app_handle)?;
            *guard = Some(manager);
            eprintln!("[INFO] TranscriptionManager initialized manually (fallback)");
            return Ok(());
        }

        tokio::time::sleep(tokio::time::Duration::from_millis(CHECK_INTERVAL_MS)).await;
    }
}

pub(crate) async fn init_transcription_manager(
    app: &AppHandle,
    state: &State<'_, TranscriptionManagerState>,
) -> Result<(), String> {
    let mut manager_guard = state.lock().await;

    if manager_guard.is_some() {
        eprintln!("[INFO] TranscriptionManager already initialized");
        return Ok(());
    }

    eprintln!("[INFO] TranscriptionManager missing in state, rebuilding...");
    let manager = crate::models_dir::build_transcription_manager(app)?;
    *manager_guard = Some(manager);
    eprintln!("[INFO] TranscriptionManager initialized successfully");

    Ok(())
}

pub(crate) async fn load_model_rust(
    model_name: String,
    app: &AppHandle,
    state: &State<'_, TranscriptionManagerState>,
) -> Result<(), String> {
    ensure_manager_initialized(state, app).await?;

    let manager_guard = state.lock().await;
    let manager = manager_guard
        .as_ref()
        .ok_or_else(|| "TranscriptionManager not initialized".to_string())?;

    #[cfg(feature = "rust-transcribe")]
    {
        manager
            .load_model(&model_name)
            .await
            .map_err(|e| format!("Failed to load model: {}", e))
    }

    #[cfg(not(feature = "rust-transcribe"))]
    {
        Err("rust-transcribe feature is not enabled".to_string())
    }
}

pub(crate) async fn unload_model_rust(
    app: &AppHandle,
    state: &State<'_, TranscriptionManagerState>,
) -> Result<(), String> {
    ensure_manager_initialized(state, app).await?;

    let manager_guard = state.lock().await;
    let manager = manager_guard
        .as_ref()
        .ok_or_else(|| "TranscriptionManager not initialized".to_string())?;

    #[cfg(feature = "rust-transcribe")]
    {
        manager.unload_model();
        Ok(())
    }

    #[cfg(not(feature = "rust-transcribe"))]
    {
        Err("rust-transcribe feature is not enabled".to_string())
    }
}

pub(crate) async fn is_model_loaded_rust(
    state: &State<'_, TranscriptionManagerState>,
) -> Result<bool, String> {
    let manager_guard = state.lock().await;

    let manager = match manager_guard.as_ref() {
        Some(m) => m,
        None => return Ok(false),
    };

    #[cfg(feature = "rust-transcribe")]
    {
        Ok(manager.is_model_loaded())
    }

    #[cfg(not(feature = "rust-transcribe"))]
    {
        Ok(false)
    }
}

pub(crate) async fn get_current_model_rust(
    state: &State<'_, TranscriptionManagerState>,
) -> Result<Option<String>, String> {
    let manager_guard = state.lock().await;

    let manager = match manager_guard.as_ref() {
        Some(m) => m,
        None => return Ok(None),
    };

    #[cfg(feature = "rust-transcribe")]
    {
        Ok(manager.get_current_model())
    }

    #[cfg(not(feature = "rust-transcribe"))]
    {
        Ok(None)
    }
}

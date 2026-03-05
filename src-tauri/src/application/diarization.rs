use std::path::Path;
use std::sync::Arc;

use tauri::{AppHandle, Emitter};

fn check_sherpa_models_present(models_dir: &Path) -> Result<(), String> {
    let nested_seg_dir = models_dir
        .join("sherpa-onnx-diarization")
        .join("sherpa-onnx-reverb-diarization-v1");
    let flat_seg_dir = models_dir.join("sherpa-onnx-reverb-diarization-v1");

    let nested_emb = models_dir
        .join("sherpa-onnx-diarization")
        .join("sherpa-onnx-embedding")
        .join("3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx");
    let flat_emb = models_dir
        .join("sherpa-onnx-embedding")
        .join("3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx");

    let nested_seg_ok = nested_seg_dir.join("model.onnx").exists()
        || nested_seg_dir.join("model.int8.onnx").exists();
    let flat_seg_ok =
        flat_seg_dir.join("model.onnx").exists() || flat_seg_dir.join("model.int8.onnx").exists();

    let seg_ok = nested_seg_ok || flat_seg_ok;
    let emb_ok = nested_emb.exists() || flat_emb.exists();

    if seg_ok && emb_ok {
        return Ok(());
    }

    let mut missing = Vec::new();
    if !seg_ok {
        missing.push("segmentation model");
    }
    if !emb_ok {
        missing.push("embedding model");
    }

    Err(format!(
        "Native diarization models not found (missing: {}). \
         Please download the \"sherpa-onnx-diarization\" model first.",
        missing.join(", ")
    ))
}

pub(crate) async fn diarize_native(
    app: &AppHandle,
    task_id: String,
    audio_path: String,
    num_speakers: Option<i32>,
) -> Result<Vec<crate::types::SpeakerSegment>, String> {
    eprintln!(
        "[INFO] diarize_native called: task_id={}, audio= {}",
        task_id, audio_path
    );

    let validated_path =
        crate::path_validation::validate_file_path(&audio_path).map_err(|e| e.to_string())?;

    let models_dir = crate::models_dir::get_models_dir(app).map_err(|e| e.to_string())?;
    if let Err(msg) = check_sherpa_models_present(&models_dir) {
        eprintln!("[ERROR] {}", msg);
        let _ = app.emit(
            "transcription-error",
            serde_json::json!({
                "taskId": task_id,
                "error": msg,
            }),
        );
        return Err(msg);
    }

    let _ = app.emit(
        "progress-update",
        serde_json::json!({
            "taskId": task_id,
            "progress": 50,
            "stage": "diarization",
            "message": "Running native diarization...",
        }),
    );

    let mut audio_buffer = crate::audio::loader::load(&validated_path)
        .map_err(|e| format!("Failed to load audio for diarization: {e}"))?;

    if audio_buffer.channels > 1 {
        audio_buffer = audio_buffer.to_mono();
    }
    if audio_buffer.sample_rate != 16000 {
        audio_buffer = audio_buffer.resample(16000);
    }

    let engine = crate::diarization::DiarizationEngine::new(&models_dir);
    let mut config = crate::diarization::DiarizationConfig::default();
    config.num_speakers = num_speakers.filter(|v| *v > 0);

    let app_for_progress = app.clone();
    let task_id_for_progress = task_id.clone();
    let progress_callback: std::sync::Arc<dyn Fn(u8) + Send + Sync> = std::sync::Arc::new(move |pct| {
        let _ = app_for_progress.emit(
            "progress-update",
            serde_json::json!({
                "taskId": task_id_for_progress,
                "progress": 50 + ((pct as u16 * 45) / 100),
                "stage": "diarization",
                "message": format!("Running native diarization... {}%", pct),
            }),
        );
    });

    let task_id_for_error = task_id.clone();
    let app_for_error = app.clone();

    let samples: Arc<[f32]> = Arc::from(audio_buffer.samples.into_boxed_slice());

    let result = tokio::task::spawn_blocking(move || {
        engine.diarize_adaptive(samples, config, Some(progress_callback))
    })
    .await
    .map_err(|e| format!("Native diarization task failed: {e}"))?
    .map_err(|e| {
        eprintln!("[ERROR] Native diarization failed: {}", e);

        let _ = app_for_error.emit(
            "transcription-error",
            serde_json::json!({
                "taskId": task_id_for_error,
                "error": format!("Native diarization failed: {}", e),
            }),
        );
        e
    })?;

    eprintln!(
        "[INFO] Native diarization complete: {} segments",
        result.len()
    );
    Ok(result)
}

pub(crate) async fn diarize_sherpa(
    app: &AppHandle,
    task_id: String,
    audio_path: String,
    num_speakers: Option<i32>,
) -> Result<Vec<crate::types::SpeakerSegment>, String> {
    diarize_native(app, task_id, audio_path, num_speakers).await
}

use std::sync::Arc;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use tauri::{AppHandle, Emitter, State};

use crate::{
    app_state::{RustTaskHandles, TranscriptionManagerState},
    transcription::TranscriptionStage,
    SpeakerTurn, TranscriptionResult, TranscriptionSegment,
};

fn model_rtf_estimate(model: &str) -> f64 {
    match model {
        "whisper-tiny" => 3.0,
        "whisper-base" => 2.5,
        "whisper-small" => 1.8,
        "whisper-medium" => 1.2,
        "whisper-large" | "whisper-large-v2" | "whisper-large-v3" => 0.9,
        "parakeet" => 4.0,
        "parakeet-tdt-0.6b-v3" => 4.2,
        "gigaam-v3" => 5.5,
        "moonshine-tiny" => 3.5,
        "moonshine-base" => 2.0,
        _ => 1.5,
    }
}

pub(crate) async fn transcribe_rust(
    task_id: String,
    file_path: String,
    options: crate::RustTranscriptionOptions,
    app: AppHandle,
    state: State<'_, TranscriptionManagerState>,
    rust_handles: State<'_, RustTaskHandles>,
) -> Result<TranscriptionResult, String> {
    let task_id = crate::path_validation::validate_safe_path_component(&task_id, "Task ID")
        .map_err(|e| e.to_string())?;

    eprintln!(
        "[INFO] transcribe_rust called: task_id={}, file={}, model={}",
        task_id,
        file_path,
        options
            .language
            .as_ref()
            .map(|s: &String| s.as_str())
            .unwrap_or("auto")
    );

    let total_start = std::time::Instant::now();
    let model_load_start = std::time::Instant::now();

    crate::application::transcription::ensure_manager_initialized(&state, &app).await?;
    let model_load_ms = model_load_start.elapsed().as_millis() as u64;

    let validated_path = crate::path_validation::validate_scoped_existing_file_path(&app, &file_path)
        .map_err(|e| e.to_string())?;

    let decode_start = std::time::Instant::now();

    let needs_conversion = {
        let ext = std::path::Path::new(&validated_path)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();
        matches!(
            ext.as_str(),
            "mp4" | "mov" | "mkv" | "avi" | "webm" | "m4a" | "aac" | "flv" | "wmv"
        )
    };

    let audio_path = if needs_conversion {
        eprintln!(
            "[INFO] Converting {} to WAV for Rust transcription",
            validated_path.display()
        );

        let temp_dir = std::env::temp_dir();
        let wav_path = temp_dir.join(format!("transcribe_video_{}.wav", task_id));

        {
            let ffmpeg_res = async {
                let ffmpeg_path = crate::infrastructure::runtime::ffmpeg_manager::get_ffmpeg_path(&app)
                    .await
                    .map_err(|e| e.to_string())?;

                let output = std::process::Command::new(&ffmpeg_path)
                    .args([
                        "-y",
                        "-i",
                        &validated_path.to_string_lossy(),
                        "-vn",
                        "-acodec",
                        "pcm_s16le",
                        "-ar",
                        "16000",
                        "-ac",
                        "1",
                        &wav_path.to_string_lossy(),
                    ])
                    .creation_flags(0x08000000) // CREATE_NO_WINDOW: скрывает окно консоли на Windows
                    .output()
                    .map_err(|e| format!("Failed to run FFmpeg process: {}", e))?;

                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    return Err(format!("FFmpeg conversion failed: {}", stderr));
                }

                Ok::<_, String>(())
            }
            .await;

            match ffmpeg_res {
                Ok(_) => {
                    eprintln!(
                        "[INFO] FFmpeg audio conversion complete: {}",
                        wav_path.display()
                    );
                    wav_path
                }
                Err(e) => {
                    eprintln!(
                        "[WARN] FFmpeg audio conversion failed: {}. Falling back to Rust Symphonia...",
                        e
                    );

                    match crate::audio::converter::convert_to_wav(&validated_path, &wav_path) {
                        Ok(_) => {
                            eprintln!(
                                "[WARN] Rust audio conversion (Symphonia fallback) complete: {}. Note: AAC/M4A duration may be halved!",
                                wav_path.display()
                            );
                            wav_path
                        }
                        Err(rust_err) => {
                            return Err(format!(
                                "Both FFmpeg and Rust audio conversion failed.\nFFmpeg Error: {}\nRust Error: {}",
                                e, rust_err
                            ));
                        }
                    }
                }
            }
        }
    } else {
        validated_path.clone()
    };

    let decode_ms = decode_start.elapsed().as_millis() as u64;

    {
        let guard = state.lock().await;
        guard
            .as_ref()
            .ok_or_else(|| "TranscriptionManager not initialized".to_string())?;
    }

    #[cfg(feature = "rust-transcribe")]
    {
        let _ = app.emit(
            "progress-update",
            serde_json::json!({
                "taskId": task_id,
                "progress": 0,
                "stage": "loading",
                "message": "Loading audio and model...",
                "metrics": {
                    "modelLoadMs": model_load_ms,
                    "decodeMs": decode_ms,
                },
            }),
        );

        let model_name = options.model.as_str();
        let rtf = model_rtf_estimate(model_name);
        let estimated_duration_secs = 60.0;
        let expected_processing_secs = (estimated_duration_secs / rtf).max(5.0);

        eprintln!(
            "[PROGRESS] Estimated RTF={}, expected processing time={:.1}s",
            rtf, expected_processing_secs
        );

        let tm_options = crate::transcription_manager::TranscriptionOptions::from(options.clone());

        let _ = app.emit(
            "progress-update",
            serde_json::json!({
                "taskId": task_id,
                "progress": 10,
                "stage": "transcribing",
                "message": "Transcribing audio...",
                "metrics": {
                    "modelLoadMs": model_load_ms,
                    "decodeMs": decode_ms,
                },
            }),
        );

        eprintln!("[PROGRESS] Starting transcription...");

        let enable_diarization = options.enable_diarization;
        let state_arc = Arc::clone(&*state);
        let audio_path_for_spawn = audio_path.clone();

        let (stage_tx, mut stage_rx) =
            tokio::sync::mpsc::unbounded_channel::<TranscriptionStage>();

        let mut join_handle = tokio::spawn(async move {
            let guard = state_arc.lock().await;
            let manager = guard
                .as_ref()
                .ok_or_else(|| "TranscriptionManager not initialized".to_string())?;
            manager
                .transcribe_file(&audio_path_for_spawn, &tm_options, Some(&stage_tx))
                .await
                .map_err(|e| e.to_string())
        });

        {
            let mut handles = rust_handles.lock().await;
            handles.insert(task_id.clone(), join_handle.abort_handle());
        }

        let inference_start = std::time::Instant::now();
        let mut heartbeat_progress: u8 = 12;
        let mut heartbeat_timer = tokio::time::interval(tokio::time::Duration::from_secs(15));
        heartbeat_timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        let mut current_stage = "transcribing".to_string();
        let mut current_message = "Transcribing audio...".to_string();

        let join_result = loop {
            tokio::select! {
                result = &mut join_handle => {
                    break result;
                }
                _ = heartbeat_timer.tick() => {
                    heartbeat_progress = (heartbeat_progress.saturating_add(1)).min(89);
                    let _ = app.emit("progress-update", serde_json::json!({
                        "taskId": task_id,
                        "progress": heartbeat_progress,
                        "stage": current_stage,
                        "message": current_message,
                        "metrics": {
                            "modelLoadMs": model_load_ms,
                            "decodeMs": decode_ms,
                        }
                    }));
                }
                Some(stage) = stage_rx.recv() => {
                    match stage {
                        TranscriptionStage::Transcribing => {
                            current_stage = "transcribing".to_string();
                            current_message = "Transcribing audio...".to_string();
                            eprintln!("[PROGRESS] Stage changed to: transcribing");
                        }
                        TranscriptionStage::Diarizing => {
                            current_stage = "diarizing".to_string();
                            current_message = "Running speaker diarization...".to_string();
                            heartbeat_progress = 75;
                            eprintln!("[PROGRESS] Stage changed to: diarizing");

                            let _ = app.emit("progress-update", serde_json::json!({
                                "taskId": task_id,
                                "progress": heartbeat_progress,
                                "stage": current_stage,
                                "message": current_message,
                                "metrics": {
                                    "modelLoadMs": model_load_ms,
                                    "decodeMs": decode_ms,
                                }
                            }));
                        }
                        TranscriptionStage::DiarizingProgress(percent) => {
                            current_stage = "diarizing".to_string();
                            current_message = format!("Running speaker diarization... {}%", percent);
                            heartbeat_progress = heartbeat_progress.max(75).max((75 + (percent / 4)).min(98));

                            let _ = app.emit("progress-update", serde_json::json!({
                                "taskId": task_id,
                                "progress": heartbeat_progress,
                                "stage": current_stage,
                                "message": current_message,
                                "metrics": {
                                    "modelLoadMs": model_load_ms,
                                    "decodeMs": decode_ms,
                                }
                            }));
                        }
                    }
                }
            }
        };

        let result = match join_result {
            Ok(Ok(data)) => data,
            Ok(Err(e)) => {
                eprintln!("[ERROR] Rust transcription failed: {}", e);
                let _ = app.emit(
                    "transcription-error",
                    serde_json::json!({
                        "taskId": task_id,
                        "error": e,
                    }),
                );
                rust_handles.lock().await.remove(&task_id);
                return Err(e);
            }
            Err(ref e) if e.is_cancelled() => {
                eprintln!("[INFO] Rust transcription cancelled: {}", task_id);
                rust_handles.lock().await.remove(&task_id);
                return Err("CANCELLED".to_string());
            }
            Err(e) => {
                rust_handles.lock().await.remove(&task_id);
                return Err(format!("Transcription task panicked: {}", e));
            }
        };
        let inference_ms = inference_start.elapsed().as_millis() as u64;
        rust_handles.lock().await.remove(&task_id);

        let mut merged_metrics = result.metrics.clone().unwrap_or_default();
        merged_metrics.model_load_ms = Some(model_load_ms);
        merged_metrics.decode_ms = Some(decode_ms);
        merged_metrics.inference_ms = Some(merged_metrics.inference_ms.unwrap_or(inference_ms));
        merged_metrics.total_ms = Some(total_start.elapsed().as_millis() as u64);

        let audio_duration = result.duration;
        eprintln!(
            "[PROGRESS] Transcription done: audio_duration={:.1}s",
            audio_duration
        );

        let progress = if audio_duration > 300.0 {
            50
        } else if audio_duration > 60.0 {
            40
        } else {
            30
        };

        let _ = app.emit(
            "progress-update",
            serde_json::json!({
                "taskId": task_id,
                "progress": progress,
                "stage": "transcribing",
                "message": format!("Processed {:.0}s of audio...", audio_duration),
                "metrics": merged_metrics,
            }),
        );

        let final_duration = result.duration;
        eprintln!(
            "[PROGRESS] Transcription complete: duration={:.1}s",
            final_duration
        );

        let _ = app.emit("progress-update", serde_json::json!({
            "taskId": task_id,
            "progress": 90,
            "stage": if enable_diarization { "diarizing" } else { "finalizing" },
            "message": if enable_diarization { "Running speaker diarization..." } else { "Finalizing..." },
            "metrics": merged_metrics,
        }));

        if enable_diarization {
            eprintln!("[PROGRESS] Diarizing...");

            let _ = app.emit(
                "progress-update",
                serde_json::json!({
                    "taskId": task_id,
                    "progress": 98,
                    "stage": "finalizing",
                    "message": "Preparing output...",
                    "metrics": merged_metrics,
                }),
            );
        }

        eprintln!(
            "[INFO] Rust transcription complete: {} segments",
            result.segments.len()
        );

        let lib_result: TranscriptionResult = TranscriptionResult {
            segments: result
                .segments
                .into_iter()
                .map(|s| TranscriptionSegment {
                    start: s.start,
                    end: s.end,
                    text: s.text,
                    speaker: s.speaker,
                    confidence: s.confidence,
                })
                .collect(),
            language: result.language,
            duration: result.duration,
            speaker_turns: result.speaker_turns.map(|turns| {
                turns
                    .into_iter()
                    .map(|t| SpeakerTurn {
                        start: t.start,
                        end: t.end,
                        speaker: t.speaker,
                    })
                    .collect()
            }),
            speaker_segments: result.speaker_segments.map(|segs| {
                segs.into_iter()
                    .map(|s| TranscriptionSegment {
                        start: s.start,
                        end: s.end,
                        text: s.text,
                        speaker: s.speaker,
                        confidence: s.confidence,
                    })
                    .collect()
            }),
            metrics: Some(merged_metrics),
        };

        let _ = app.emit(
            "transcription-complete",
            serde_json::json!({
                "taskId": task_id,
                "result": lib_result,
            }),
        );

        Ok(lib_result)
    }

    #[cfg(not(feature = "rust-transcribe"))]
    {
        Err("rust-transcribe feature is not enabled".to_string())
    }
}

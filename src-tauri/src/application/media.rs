use std::path::Path;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::{AppError, FileMetadata, TranscriptionResult};

fn should_show_speaker(segments: &[crate::TranscriptionSegment]) -> bool {
    use std::collections::HashSet;
    let speakers: HashSet<_> = segments.iter().filter_map(|s| s.speaker.as_ref()).collect();
    speakers.len() > 1
}

fn format_time(seconds: f64) -> String {
    let hours = (seconds / 3600.0) as u32;
    let minutes = ((seconds % 3600.0) / 60.0) as u32;
    let secs = (seconds % 60.0) as u32;

    if hours > 0 {
        format!("{:02}:{:02}:{:02}", hours, minutes, secs)
    } else {
        format!("{:02}:{:02}", minutes, secs)
    }
}

fn format_vtt_time(seconds: f64) -> String {
    let hours = (seconds / 3600.0) as u32;
    let minutes = ((seconds % 3600.0) / 60.0) as u32;
    let secs = (seconds % 60.0) as u32;
    let millis = ((seconds % 1.0) * 1000.0) as u32;

    format!("{:02}:{:02}:{:02}.{:03}", hours, minutes, secs, millis)
}

fn format_srt_time(seconds: f64) -> String {
    let hours = (seconds / 3600.0) as u32;
    let minutes = ((seconds % 3600.0) / 60.0) as u32;
    let secs = (seconds % 60.0) as u32;
    let millis = ((seconds % 1.0) * 1000.0) as u32;

    format!("{:02}:{:02}:{:02},{:03}", hours, minutes, secs, millis)
}

pub(crate) fn select_media_files(app: &AppHandle) -> Result<Vec<String>, AppError> {
    let files = app
        .dialog()
        .file()
        .set_title("Select Media Files")
        .add_filter(
            "Media Files",
            &[
                "mp3", "mp4", "wav", "m4a", "flac", "ogg", "webm", "mov", "avi", "mkv",
            ],
        )
        .add_filter("Audio Files", &["mp3", "wav", "m4a", "flac", "ogg"])
        .add_filter("Video Files", &["mp4", "webm", "mov", "avi", "mkv"])
        .add_filter("All Files", &["*"])
        .blocking_pick_files();

    match files {
        Some(paths) => Ok(paths.into_iter().map(|path| path.to_string()).collect()),
        None => Ok(vec![]),
    }
}

pub(crate) fn export_transcription(
    app: &AppHandle,
    result: TranscriptionResult,
    format: String,
    output_path: String,
    export_mode: Option<String>,
) -> Result<(), AppError> {
    let content = build_export_content(&result, format.as_str(), export_mode.as_deref())?;

    let validated_output = crate::path_validation::validate_scoped_output_path(app, &output_path)?;
    std::fs::write(validated_output, content)?;

    Ok(())
}

fn build_export_content(
    result: &TranscriptionResult,
    format: &str,
    export_mode: Option<&str>,
) -> Result<String, AppError> {
    let export_mode = export_mode.unwrap_or("with_timestamps");
    let show_speaker = should_show_speaker(&result.segments);

    let content = match format {
        "json" => serde_json::to_string_pretty(result)?,
        "txt" => match export_mode {
            "plain_text" => result
                .segments
                .iter()
                .map(|s| s.text.clone())
                .collect::<Vec<_>>()
                .join(" "),
            _ => result
                .segments
                .iter()
                .map(|s| {
                    let time = format_time(s.start);
                    if show_speaker {
                        let speaker = s.speaker.as_deref().unwrap_or("Speaker");
                        format!("[{}] {}: {}", time, speaker, s.text)
                    } else {
                        format!("[{}] {}", time, s.text)
                    }
                })
                .collect::<Vec<_>>()
                .join("\n"),
        },
        "srt" => result
            .segments
            .iter()
            .enumerate()
            .map(|(i, s)| {
                format!(
                    "{}\n{} --> {}\n{}\n",
                    i + 1,
                    format_srt_time(s.start),
                    format_srt_time(s.end),
                    s.text
                )
            })
            .collect::<Vec<_>>()
            .join("\n"),
        "vtt" => {
            let mut lines = vec!["WEBVTT".to_string(), "".to_string()];
            lines.extend(result.segments.iter().enumerate().map(|(i, s)| {
                format!(
                    "{}\n{} --> {}\n{}\n",
                    i + 1,
                    format_vtt_time(s.start),
                    format_vtt_time(s.end),
                    s.text
                )
            }));
            lines.join("\n")
        }
        "md" => match export_mode {
            "plain_text" => result
                .segments
                .iter()
                .map(|s| s.text.clone())
                .collect::<Vec<_>>()
                .join(" "),
            _ => result
                .segments
                .iter()
                .map(|s| {
                    let time = format_time(s.start);
                    if show_speaker {
                        let speaker = s.speaker.as_deref().unwrap_or("Speaker");
                        format!("**[{}]** **{}:** {}", time, speaker, s.text)
                    } else {
                        format!("**[{}]** {}", time, s.text)
                    }
                })
                .collect::<Vec<_>>()
                .join("\n"),
        },
        _ => return Err(AppError::Other(format!("Unknown format: {}", format))),
    };

    Ok(content)
}

#[cfg(test)]
mod tests {
    use super::build_export_content;
    use crate::post_processing::PostProcessing;
    use crate::types::{TranscriptionResult, TranscriptionSegment};

    fn sample_result() -> TranscriptionResult {
        TranscriptionResult {
            segments: vec![
                TranscriptionSegment {
                    start: 0.0,
                    end: 2.5,
                    text: "hello there friends right now".to_string(),
                    speaker: Some("SPEAKER_00".to_string()),
                    confidence: 0.9,
                },
                TranscriptionSegment {
                    start: 2.5,
                    end: 5.0,
                    text: "this line is already sanitized".to_string(),
                    speaker: Some("SPEAKER_01".to_string()),
                    confidence: 0.95,
                },
            ],
            language: "en".to_string(),
            duration: 5.0,
            speaker_turns: None,
            speaker_segments: None,
            metrics: None,
        }
    }

    #[test]
    fn export_plain_text_keeps_segment_text_order() {
        let content = build_export_content(&sample_result(), "txt", Some("plain_text"))
            .expect("plain text export should succeed");

        assert_eq!(
            content,
            "hello there friends right now this line is already sanitized"
        );
    }

    #[test]
    fn export_srt_and_vtt_keep_exact_text_payload() {
        let result = sample_result();
        let srt = build_export_content(&result, "srt", None).expect("srt export should succeed");
        let vtt = build_export_content(&result, "vtt", None).expect("vtt export should succeed");

        for segment in &result.segments {
            assert!(
                srt.contains(&segment.text),
                "SRT should include exact segment text: {}",
                segment.text
            );
            assert!(
                vtt.contains(&segment.text),
                "VTT should include exact segment text: {}",
                segment.text
            );
        }
    }

    #[test]
    fn golden_post_processing_to_exports_keeps_sanitized_text_consistent() {
        let raw_segments = vec![
            TranscriptionSegment {
                start: 0.0,
                end: 2.0,
                text: "Thanks for watching".to_string(),
                speaker: Some("SPEAKER_00".to_string()),
                confidence: 0.9,
            },
            TranscriptionSegment {
                start: 2.0,
                end: 4.0,
                text: "Hello team update".to_string(),
                speaker: Some("SPEAKER_00".to_string()),
                confidence: 0.95,
            },
            TranscriptionSegment {
                start: 4.0,
                end: 6.0,
                text: "Please subscribe".to_string(),
                speaker: Some("SPEAKER_00".to_string()),
                confidence: 0.9,
            },
        ];

        let filtered_segments = PostProcessing::filter_hallucinations(&raw_segments);
        assert_eq!(filtered_segments.len(), 1, "Only non-hallucination segment should remain");
        assert_eq!(filtered_segments[0].text, "Hello team update");
        assert!((filtered_segments[0].start - 2.0).abs() < f64::EPSILON);
        assert!((filtered_segments[0].end - 4.0).abs() < f64::EPSILON);

        let result = TranscriptionResult {
            segments: filtered_segments,
            language: "en".to_string(),
            duration: 6.0,
            speaker_turns: None,
            speaker_segments: None,
            metrics: None,
        };

        let txt_plain = build_export_content(&result, "txt", Some("plain_text"))
            .expect("plain text export should succeed");
        let srt = build_export_content(&result, "srt", None).expect("srt export should succeed");
        let vtt = build_export_content(&result, "vtt", None).expect("vtt export should succeed");

        assert_eq!(txt_plain, "Hello team update");
        assert_eq!(
            srt,
            "1\n00:00:02,000 --> 00:00:04,000\nHello team update\n"
        );
        assert_eq!(
            vtt,
            "WEBVTT\n\n1\n00:00:02.000 --> 00:00:04.000\nHello team update\n"
        );
    }
}

pub(crate) fn get_files_metadata(app: &AppHandle, file_paths: Vec<String>) -> Result<Vec<FileMetadata>, AppError> {
    let mut metadata_list = Vec::new();

    for file_path in file_paths {
        let path = Path::new(&file_path);

        let scoped_path = match crate::path_validation::validate_scoped_existing_file_path(app, &file_path) {
            Ok(valid_path) => valid_path,
            Err(_) => {
                metadata_list.push(FileMetadata {
                    path: file_path.clone(),
                    name: path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| file_path.clone()),
                    size: 0,
                    exists: false,
                });
                continue;
            }
        };

        if !scoped_path.exists() {
            metadata_list.push(FileMetadata {
                path: file_path.clone(),
                name: path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| file_path.clone()),
                size: 0,
                exists: false,
            });
            continue;
        }

        let metadata = std::fs::metadata(&scoped_path).map_err(AppError::IoError)?;

        let file_name = scoped_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| file_path.clone());

        metadata_list.push(FileMetadata {
            path: file_path,
            name: file_name,
            size: metadata.len(),
            exists: true,
        });
    }

    Ok(metadata_list)
}

pub(crate) fn read_file_as_base64(app: &AppHandle, file_path: String) -> Result<String, AppError> {
    let validated_path = crate::path_validation::validate_scoped_existing_file_path(app, &file_path)?;
    let bytes = std::fs::read(&validated_path).map_err(AppError::IoError)?;

    use base64::{engine::general_purpose, Engine as _};
    Ok(general_purpose::STANDARD.encode(&bytes))
}

pub(crate) fn get_file_size(app: &AppHandle, path: String) -> Result<u64, AppError> {
    let validated_path = crate::path_validation::validate_scoped_existing_file_path(app, &path)?;
    let metadata = std::fs::metadata(&validated_path).map_err(AppError::IoError)?;
    Ok(metadata.len())
}

pub(crate) fn delete_file(app: &AppHandle, path: String) -> Result<(), AppError> {
    let validated_path = crate::path_validation::validate_scoped_existing_file_path(app, &path)?;
    std::fs::remove_file(&validated_path).map_err(AppError::IoError)?;
    Ok(())
}

pub(crate) async fn convert_to_mp3(
    app: &AppHandle,
    input_path: String,
    output_path: String,
) -> Result<String, AppError> {
    eprintln!(
        "[DEBUG] convert_to_mp3 called: input={}, output={}",
        input_path, output_path
    );

    let validated_input = crate::path_validation::validate_scoped_existing_file_path(app, &input_path)?;
    eprintln!("[DEBUG] validated input path: {}", validated_input.display());

    let validated_output = crate::path_validation::validate_scoped_output_path(app, &output_path)?;
    eprintln!("[DEBUG] output path: {}", validated_output.display());

    let ffmpeg_path = match crate::infrastructure::runtime::ffmpeg_manager::get_ffmpeg_path(app).await {
        Ok(path) => {
            eprintln!("[DEBUG] FFmpeg path found: {}", path.display());
            path
        }
        Err(e) => {
            eprintln!("[ERROR] FFmpeg not found: {}", e);
            return Err(AppError::Other(format!("FFmpeg not found: {}", e)));
        }
    };

    eprintln!("[DEBUG] Running FFmpeg conversion...");

    let status = std::process::Command::new(&ffmpeg_path)
        .args([
            "-i",
            validated_input.to_str().unwrap_or(&input_path),
            "-vn",
            "-acodec",
            "libmp3lame",
            "-q:a",
            "2",
            "-y",
            validated_output.to_str().unwrap_or(&output_path),
        ])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW: скрывает окно консоли на Windows
        .output()
        .map_err(AppError::IoError)?;

    if !status.status.success() {
        let stderr = String::from_utf8_lossy(&status.stderr);
        let stdout = String::from_utf8_lossy(&status.stdout);
        eprintln!(
            "[ERROR] FFmpeg conversion failed: status={}, stderr={}",
            status.status, stderr
        );
        eprintln!("[DEBUG] FFmpeg stdout: {}", stdout);
        return Err(AppError::Other(format!("FFmpeg conversion failed: {}", stderr)));
    }

    if !validated_output.exists() {
        eprintln!(
            "[ERROR] Output file was not created: {}",
            validated_output.display()
        );
        return Err(AppError::Other("Output file was not created".to_string()));
    }

    eprintln!("[DEBUG] Conversion successful: {}", validated_output.display());
    Ok(validated_output.to_string_lossy().to_string())
}

//! Rust-native model downloader.
//!
//! Downloads AI models directly in Rust without spawning a Python process,
//! emitting Tauri progress events throughout.
//!
//! # Supported model types
//!
//! | `model_type`  | `model_name`               | Source                          |
//! |---------------|----------------------------|---------------------------------|
//! | `"whisper"`   | `whisper-tiny` … `large-v3`| HuggingFace CDN (redirect)      |
//! | `"parakeet"`  | `parakeet-tdt-0.6b-v3` etc.| HuggingFace CDN (nvidia repos)  |
//! | `"diarization"` | `sherpa-onnx-diarization`| GitHub Releases (2 files)       |
//!
//! **PyAnnote diarization** (`pyannote-diarization`) stays Python-only because
//! it requires gated HuggingFace repos accessed via `huggingface_hub`, whose
//! file-layout the `pyannote` library reads at runtime.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use bzip2::read::BzDecoder;
use futures_util::StreamExt;
use reqwest::Client;
use tar::Archive;
use tauri::{AppHandle, Emitter};

use crate::{AppError, ModelDownloadProgress};

/// Minimum milliseconds between successive `model-download-progress` events.
/// Avoids flooding the React event bus without losing perceived smoothness.
const PROGRESS_INTERVAL_MS: u128 = 150;

// ============================================================================
// Error type
// ============================================================================

#[derive(Debug, thiserror::Error)]
pub enum DownloadError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Download cancelled")]
    Cancelled,

    #[error("{0}")]
    Other(String),
}

impl From<DownloadError> for AppError {
    fn from(e: DownloadError) -> Self {
        match e {
            DownloadError::Cancelled => AppError::ModelError("Download cancelled".to_string()),
            other => AppError::ModelError(other.to_string()),
        }
    }
}

// ============================================================================
// ModelDownloader
// ============================================================================

/// Rust-native downloader with Tauri progress events and cancellation support.
///
/// Construct once per download task via [`ModelDownloader::new`]; the internal
/// `reqwest::Client` is cheap to clone/create and follows redirects by default.
pub struct ModelDownloader {
    client: Client,
    app: AppHandle,
    models_dir: PathBuf,
}

impl ModelDownloader {
    /// Create a new downloader targeting `models_dir`.
    pub fn new(app: AppHandle, models_dir: PathBuf) -> Self {
        // Policy::limited(10) follows up to 10 redirects — needed for HuggingFace CDN.
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::limited(10))
            .user_agent("Mozilla/5.0 transcribe-video/1.0")
            .build()
            .expect("Failed to build reqwest client");
        Self {
            client,
            app,
            models_dir,
        }
    }

    // ── Public dispatch ────────────────────────────────────────────────────

    /// Download a model, routing by `model_type` and `model_name`.
    ///
    /// Emits `model-download-progress` during the download and
    /// `model-download-complete` on success.
    ///
    /// Returns `Err(DownloadError::Cancelled)` when `cancel` is set.
    pub async fn download(
        &self,
        model_name: &str,
        model_type: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<(), DownloadError> {
        eprintln!(
            "[ModelDownloader] download(type={}, name={})",
            model_type, model_name
        );
        match model_type {
            "whisper" => self.download_whisper(model_name, &cancel).await,
            "parakeet" => self.download_parakeet_nemo(model_name, &cancel).await,
            "diarization" if model_name == "sherpa-onnx-diarization" => {
                self.download_sherpa_onnx(&cancel).await
            }
            _ => Err(DownloadError::Other(format!(
                "Unsupported: model_type='{}', model_name='{}'. \
                 PyAnnote must be downloaded via Python engine.",
                model_type, model_name
            ))),
        }
    }

    // ── Whisper GGML ──────────────────────────────────────────────────────

    async fn download_whisper(
        &self,
        model_name: &str,
        cancel: &Arc<AtomicBool>,
    ) -> Result<(), DownloadError> {
        let file_name = whisper_ggml_filename(model_name).ok_or_else(|| {
            DownloadError::Other(format!("Unknown Whisper model: '{}'", model_name))
        })?;

        let dest = self.models_dir.join(file_name);

        if dest.exists() {
            eprintln!("[ModelDownloader] Whisper {} already present, skipping.", model_name);
            self.emit_complete(model_name, file_size_mb(&dest), &dest);
            return Ok(());
        }

        let url = format!(
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}",
            file_name
        );

        eprintln!("[ModelDownloader] Whisper '{}' → {}", model_name, url);
        self.stream_to_file(&url, &dest, model_name, cancel).await?;
        self.emit_complete(model_name, file_size_mb(&dest), &dest);
        Ok(())
    }

    // ── Parakeet NeMo ─────────────────────────────────────────────────────

    async fn download_parakeet_nemo(
        &self,
        model_name: &str,
        cancel: &Arc<AtomicBool>,
    ) -> Result<(), DownloadError> {
        let (repo_id, nemo_filename) = parakeet_nemo_info(model_name).ok_or_else(|| {
            DownloadError::Other(format!("Unknown Parakeet model: '{}'", model_name))
        })?;

        // Match path structure produced by Python for backward compatibility:
        //   {models_dir}/nemo/{safe_repo}/{filename}.nemo
        let safe_repo = repo_id.replace('/', "_");
        let nemo_dir = self.models_dir.join("nemo").join(&safe_repo);
        std::fs::create_dir_all(&nemo_dir)?;

        let dest = nemo_dir.join(&nemo_filename);

        if dest.exists() {
            eprintln!("[ModelDownloader] Parakeet {} already present, skipping.", model_name);
            self.emit_complete(model_name, file_size_mb(&dest), &dest);
            return Ok(());
        }

        let url = format!(
            "https://huggingface.co/{}/resolve/main/{}",
            repo_id, nemo_filename
        );

        eprintln!("[ModelDownloader] Parakeet '{}' → {}", model_name, url);
        self.stream_to_file(&url, &dest, model_name, cancel).await?;
        self.emit_complete(model_name, file_size_mb(&dest), &dest);
        Ok(())
    }

    // ── Sherpa-ONNX diarization ───────────────────────────────────────────

    /// Downloads two files that make up the Sherpa-ONNX diarization model:
    ///
    /// 1. Segmentation — `.tar.bz2` from GitHub Releases, extracted to
    ///    `sherpa-onnx-diarization/sherpa-onnx-segmentation/`
    /// 2. Embedding — single `.onnx` from GitHub Releases, saved to
    ///    `sherpa-onnx-diarization/sherpa-onnx-embedding/`
    async fn download_sherpa_onnx(&self, cancel: &Arc<AtomicBool>) -> Result<(), DownloadError> {
        const MODEL_NAME: &str = "sherpa-onnx-diarization";

        let base_dir = self.models_dir.join(MODEL_NAME);
        let seg_dir = base_dir.join("sherpa-onnx-segmentation");
        let emb_dir = base_dir.join("sherpa-onnx-embedding");
        std::fs::create_dir_all(&seg_dir)?;
        std::fs::create_dir_all(&emb_dir)?;

        // ── Stage 1: Segmentation model (tar.bz2) ─────────────────────────
        const SEG_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/\
            speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2";

        if !has_onnx_files(&seg_dir) {
            if cancel.load(Ordering::Relaxed) {
                return Err(DownloadError::Cancelled);
            }

            // Emit stage info so UI can show "Downloading segmentation model"
            self.emit_stage(MODEL_NAME, "segmentation", 0.0, 0.0, 0.0);

            let seg_archive = seg_dir.join("segmentation.tar.bz2");
            eprintln!("[ModelDownloader] Sherpa segmentation → {}", SEG_URL);
            self.stream_to_file(SEG_URL, &seg_archive, MODEL_NAME, cancel)
                .await?;

            eprintln!(
                "[ModelDownloader] Extracting segmentation archive to {:?}",
                seg_dir
            );
            extract_tar_bz2(&seg_archive, &seg_dir)?;
            let _ = std::fs::remove_file(&seg_archive);
            // If the tar contained a single top-level directory, flatten it.
            flatten_single_subdir(&seg_dir)?;
            self.emit_stage_complete(MODEL_NAME, "segmentation");
        } else {
            eprintln!("[ModelDownloader] Sherpa segmentation already present, skipping.");
        }

        // ── Stage 2: Embedding model (single .onnx) ───────────────────────
        const EMB_FILENAME: &str =
            "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx";
        const EMB_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/\
            speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx";

        let emb_dest = emb_dir.join(EMB_FILENAME);
        if !emb_dest.exists() {
            if cancel.load(Ordering::Relaxed) {
                return Err(DownloadError::Cancelled);
            }

            self.emit_stage(MODEL_NAME, "embedding", 0.0, 0.0, 0.0);
            eprintln!("[ModelDownloader] Sherpa embedding → {}", EMB_URL);
            self.stream_to_file(EMB_URL, &emb_dest, MODEL_NAME, cancel)
                .await?;
            self.emit_stage_complete(MODEL_NAME, "embedding");
        } else {
            eprintln!("[ModelDownloader] Sherpa embedding already present, skipping.");
        }

        let size_mb = dir_size_mb(&base_dir);
        eprintln!("[ModelDownloader] Sherpa-ONNX done — {} MB", size_mb);
        self.emit_complete(MODEL_NAME, size_mb, &base_dir);
        Ok(())
    }

    // ── Core: streaming GET → file ─────────────────────────────────────────

    /// Stream `url` to `dest`, emitting progress events during download.
    ///
    /// The download is performed **atomically**: bytes are written to a `.tmp`
    /// sidecar file and renamed to `dest` only on success. A partial `.tmp`
    /// file is deleted on cancellation or error.
    async fn stream_to_file(
        &self,
        url: &str,
        dest: &Path,
        model_name: &str,
        cancel: &Arc<AtomicBool>,
    ) -> Result<u64, DownloadError> {
        let resp = self.client.get(url).send().await?.error_for_status()?;
        let total_bytes = resp.content_length().unwrap_or(0);

        // Atomic write: use a temp file.
        let tmp = dest.with_extension("tmp");
        if let Some(parent) = tmp.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut file = std::fs::File::create(&tmp)?;

        let mut downloaded: u64 = 0;
        let mut last_emit = Instant::now();
        let mut last_bytes_at_emit: u64 = 0;
        let start_time = Instant::now();
        let mut stream = resp.bytes_stream();

        while let Some(chunk_result) = stream.next().await {
            // Honour cancellation between chunks.
            if cancel.load(Ordering::Relaxed) {
                let _ = std::fs::remove_file(&tmp);
                return Err(DownloadError::Cancelled);
            }

            let chunk = chunk_result?;
            downloaded += chunk.len() as u64;
            file.write_all(&chunk)?;

            let now = Instant::now();
            let elapsed_since_emit = now.duration_since(last_emit).as_millis();
            if elapsed_since_emit >= PROGRESS_INTERVAL_MS {
                let window_s = elapsed_since_emit as f64 / 1000.0;
                let speed_mb_s =
                    ((downloaded - last_bytes_at_emit) as f64 / window_s) / (1024.0 * 1024.0);
                let total_mb = total_bytes as f64 / (1024.0 * 1024.0);
                let current_mb = downloaded as f64 / (1024.0 * 1024.0);
                let percent = if total_bytes > 0 {
                    (downloaded as f64 / total_bytes as f64 * 100.0).clamp(0.0, 99.9)
                } else {
                    0.0
                };
                let eta_s = if speed_mb_s > 0.01 && total_bytes > downloaded {
                    Some((total_mb - current_mb) / speed_mb_s)
                } else {
                    None
                };

                self.emit_progress(
                    model_name,
                    current_mb,
                    total_mb,
                    percent,
                    speed_mb_s,
                    eta_s,
                    total_bytes == 0,
                );

                last_bytes_at_emit = downloaded;
                last_emit = now;
            }
        }

        // Flush and atomically rename.
        drop(file);
        std::fs::rename(&tmp, dest)?;

        // Emit 100% on successful completion.
        let final_mb = downloaded as f64 / (1024.0 * 1024.0);
        let avg_speed = downloaded as f64
            / start_time.elapsed().as_secs_f64().max(0.001)
            / (1024.0 * 1024.0);
        self.emit_progress(model_name, final_mb, final_mb, 100.0, avg_speed, Some(0.0), false);

        Ok(downloaded)
    }

    // ── Event emitters ────────────────────────────────────────────────────

    fn emit_progress(
        &self,
        model_name: &str,
        current_mb: f64,
        total_mb: f64,
        percent: f64,
        speed_mb_s: f64,
        eta_s: Option<f64>,
        total_estimated: bool,
    ) {
        let _ = self.app.emit(
            "model-download-progress",
            ModelDownloadProgress {
                model_name: model_name.to_string(),
                current_mb: current_mb.round() as u64,
                total_mb: total_mb.round() as u64,
                percent,
                speed_mb_s,
                status: "downloading".to_string(),
                eta_s,
                total_estimated,
            },
        );
    }

    fn emit_complete(&self, model_name: &str, size_mb: u64, path: &Path) {
        let _ = self.app.emit(
            "model-download-complete",
            serde_json::json!({
                "modelName": model_name,
                "size": size_mb,
                "path": path.to_string_lossy(),
            }),
        );
    }

    /// Emit a stage-progress event so the UI can show per-stage progress bars
    /// (used by Sherpa-ONNX which has segmentation + embedding stages).
    fn emit_stage(&self, model_name: &str, stage: &str, percent: f64, current_mb: f64, total_mb: f64) {
        let _ = self.app.emit(
            "model-download-stage",
            serde_json::json!({
                "modelName": model_name,
                "stage": stage,
                "submodelName": stage,
                "currentMb": current_mb,
                "totalMb": total_mb,
                "percent": percent,
                "speedMbS": 0.0,
            }),
        );
    }

    fn emit_stage_complete(&self, model_name: &str, stage: &str) {
        let _ = self.app.emit(
            "model-download-stage-complete",
            serde_json::json!({
                "modelName": model_name,
                "stage": stage,
            }),
        );
    }
}

// ============================================================================
// Static helpers — model metadata
// ============================================================================

/// Map a Whisper model name (with or without the `whisper-` prefix) to the
/// corresponding GGML filename hosted on HuggingFace.
pub fn whisper_ggml_filename(model_name: &str) -> Option<&'static str> {
    let size = model_name.strip_prefix("whisper-").unwrap_or(model_name);
    match size {
        "tiny" => Some("ggml-tiny.bin"),
        "base" => Some("ggml-base.bin"),
        "small" => Some("ggml-small.bin"),
        "medium" => Some("ggml-medium.bin"),
        "large" | "large-v1" => Some("ggml-large-v1.bin"),
        "large-v2" => Some("ggml-large-v2.bin"),
        "large-v3" => Some("ggml-large-v3.bin"),
        _ => None,
    }
}

/// Map a Parakeet model name to its HuggingFace `(repo_id, .nemo filename)`.
pub fn parakeet_nemo_info(model_name: &str) -> Option<(&'static str, String)> {
    match model_name {
        "parakeet-tdt-0.6b-v3" | "parakeet" => Some((
            "nvidia/parakeet-tdt-0.6b-v3",
            "parakeet-tdt-0.6b-v3.nemo".to_string(),
        )),
        "parakeet-tdt-1.1b" => Some((
            "nvidia/parakeet-tdt-1.1b",
            "parakeet-tdt-1.1b.nemo".to_string(),
        )),
        _ => None,
    }
}

// ============================================================================
// Archive / filesystem helpers
// ============================================================================

/// Extract a `.tar.bz2` archive into `dest_dir`.
fn extract_tar_bz2(archive: &Path, dest_dir: &Path) -> Result<(), DownloadError> {
    let file = std::fs::File::open(archive).map_err(DownloadError::Io)?;
    let decoder = BzDecoder::new(file);
    let mut tarball = Archive::new(decoder);
    std::fs::create_dir_all(dest_dir).map_err(DownloadError::Io)?;
    tarball
        .unpack(dest_dir)
        .map_err(|e| DownloadError::Other(format!("Failed to extract tar.bz2: {}", e)))?;
    Ok(())
}

/// If `dir` contains exactly one entry and it is a directory, move its
/// contents up into `dir` and remove the now-empty subdirectory.
///
/// This normalises tarballs that wrap everything in a top-level folder (e.g.
/// `sherpa-onnx-pyannote-segmentation-3-0/`) so downstream code sees files
/// directly inside `seg_dir`.
fn flatten_single_subdir(dir: &Path) -> Result<(), DownloadError> {
    let entries: Vec<_> = std::fs::read_dir(dir)
        .map_err(DownloadError::Io)?
        .flatten()
        .collect();

    if entries.len() != 1 {
        return Ok(());
    }
    let subdir = entries[0].path();
    if !subdir.is_dir() {
        return Ok(());
    }

    for sub_entry in std::fs::read_dir(&subdir).map_err(DownloadError::Io)?.flatten() {
        let src = sub_entry.path();
        let dst = dir.join(src.file_name().expect("DirEntry has a filename"));
        std::fs::rename(&src, &dst).map_err(DownloadError::Io)?;
    }
    std::fs::remove_dir(&subdir).map_err(DownloadError::Io)?;
    Ok(())
}

/// Returns `true` if any `.onnx` file exists anywhere under `dir`.
fn has_onnx_files(dir: &Path) -> bool {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                if has_onnx_files(&p) {
                    return true;
                }
            } else if p.extension().and_then(|e| e.to_str()) == Some("onnx") {
                return true;
            }
        }
    }
    false
}

/// Size of a single file in MiB.
fn file_size_mb(path: &Path) -> u64 {
    std::fs::metadata(path)
        .map(|m| m.len() / (1024 * 1024))
        .unwrap_or(0)
}

/// Recursive size of a directory tree in MiB.
fn dir_size_mb(path: &Path) -> u64 {
    let mut total: u64 = 0;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                total += dir_size_mb(&p);
            } else if let Ok(meta) = std::fs::metadata(&p) {
                total += meta.len();
            }
        }
    }
    total / (1024 * 1024)
}

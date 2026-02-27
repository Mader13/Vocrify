//! Rust-native model downloader.
//!
//! Downloads AI models directly in Rust without spawning a Python process,
//! emitting Tauri progress events throughout.
//!
//! # Supported model types
//!
//! | `model_type`  | `model_name`               | Source                          |
//! |---------------|----------------------------|---------------------------------|
//! | `"whisper"`   | `whisper-tiny` … `large-v3-turbo`| HuggingFace CDN (redirect) |
//! | `"parakeet"`  | `parakeet-tdt-0.6b-v3` etc.| HuggingFace CDN (nvidia repos)  |
//! | `"diarization"` | `sherpa-onnx-diarization`| GitHub Releases (2 files)       |
//!
//! All models are downloaded via `reqwest` with Tauri progress events.

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
const WHISPER_CPP_BASE_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

struct ParakeetRegistry {
    download_url: &'static str,
    archive_name: &'static str,
    target_dir: &'static str,
}

const PARAKEET_REGISTRY: ParakeetRegistry = ParakeetRegistry {
    download_url: "https://blob.handy.computer/parakeet-v3-int8.tar.gz",
    archive_name: "parakeet-v3-int8.tar.gz",
    target_dir: "parakeet-tdt-0.6b-v3",
};

struct SherpaRegistry {
    model_name: &'static str,
    segmentation_dir: &'static str,
    embedding_dir: &'static str,
    segmentation_archive_name: &'static str,
    segmentation_url: &'static str,
    segmentation_required_file: &'static str,
    embedding_filename: &'static str,
    embedding_url: &'static str,
}

const SHERPA_REGISTRY: SherpaRegistry = SherpaRegistry {
    model_name: "sherpa-onnx-diarization",
    segmentation_dir: "sherpa-onnx-reverb-diarization-v1",
    embedding_dir: "sherpa-onnx-embedding",
    segmentation_archive_name: "sherpa-onnx-reverb-diarization-v1.tar.bz2",
    segmentation_url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-reverb-diarization-v1.tar.bz2",
    segmentation_required_file: "model.onnx",
    embedding_filename: "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
    embedding_url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
};

const WHISPER_GGML_MODELS: [(&str, &str); 9] = [
    ("tiny", "ggml-tiny.bin"),
    ("base", "ggml-base.bin"),
    ("small", "ggml-small.bin"),
    ("medium", "ggml-medium.bin"),
    ("large", "ggml-large-v1.bin"),
    ("large-v1", "ggml-large-v1.bin"),
    ("large-v2", "ggml-large-v2.bin"),
    ("large-v3", "ggml-large-v3.bin"),
    ("large-v3-turbo", "ggml-large-v3-turbo.bin"),
];

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
        // Policy::limited(10) follows up to 10 redirects - needed for HuggingFace CDN.
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

    /// Maximum retry attempts for failed downloads
    const MAX_RETRIES: u32 = 3;
    /// Base delay between retries in seconds
    const RETRY_DELAY_SECS: u64 = 2;

    /// Download a model, routing by `model_type` and `model_name`.
    ///
    /// Emits `model-download-progress` during the download and
    /// `model-download-complete` on success.
    ///
    /// Returns `Err(DownloadError::Cancelled)` when `cancel` is set.
    /// Implements automatic retry (up to 3 attempts) for network errors.
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

        let mut last_error_msg: Option<String> = None;

        for attempt in 1..=Self::MAX_RETRIES {
            // Check for cancellation before each attempt
            if cancel.load(Ordering::Relaxed) {
                return Err(DownloadError::Cancelled);
            }

            let result = match model_type {
                "whisper" => self.download_whisper(model_name, &cancel).await,
                "parakeet" => self.download_parakeet_onnx(model_name, &cancel).await,
                "diarization" if model_name == "sherpa-onnx-diarization" => {
                    self.download_sherpa_onnx(&cancel).await
                }
                _ => Err(DownloadError::Other(format!(
                    "Unsupported model: model_type='{}', model_name='{}'.",
                    model_type, model_name
                ))),
            };

            match result {
                Ok(()) => return Ok(()),
                Err(e) => {
                    last_error_msg = Some(e.to_string());

                    // Check if error is retryable (network-related)
                    let is_retryable = matches!(e, DownloadError::Http(_))
                        || matches!(e, DownloadError::Io(ref io_err) 
                            if io_err.kind() == std::io::ErrorKind::ConnectionRefused
                            || io_err.kind() == std::io::ErrorKind::TimedOut
                            || io_err.kind() == std::io::ErrorKind::NotConnected);

                    // Only retry if error is retryable and we have attempts left
                    if is_retryable && attempt < Self::MAX_RETRIES {
                        let delay = Self::RETRY_DELAY_SECS * (2_u64.pow(attempt - 1));
                        eprintln!(
                            "[ModelDownloader] Retryable error on attempt {}/{}, retrying in {}s...",
                            attempt, Self::MAX_RETRIES, delay
                        );

                        // Emit retrying event for UI
                        let _ = self.app.emit("model-download-retrying", serde_json::json!({
                            "modelName": model_name,
                            "message": format!("Retrying download (attempt {}/{})...", attempt + 1, Self::MAX_RETRIES),
                            "attempt": attempt,
                            "maxAttempts": Self::MAX_RETRIES,
                        }));

                        tokio::time::sleep(tokio::time::Duration::from_secs(delay)).await;
                        continue;
                    }

                    // Non-retryable error or out of retries - return error
                    return Err(e);
                }
            }
        }

        // Should not reach here, but handle gracefully
        Err(last_error_msg
            .map(DownloadError::Other)
            .unwrap_or_else(|| DownloadError::Other("Download failed".to_string())))
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

        // Clean up any partial downloads - remove existing file to ensure fresh download
        if dest.exists() {
            std::fs::remove_file(&dest).map_err(DownloadError::Io)?;
        }

        // Also clean up any .tmp files for this model
        let tmp_file = dest.with_extension("tmp");
        if tmp_file.exists() {
            let _ = std::fs::remove_file(&tmp_file);
        }

        let url = format!("{}/{}", WHISPER_CPP_BASE_URL, file_name);

        eprintln!("[ModelDownloader] Whisper '{}' → {}", model_name, url);
        self.stream_to_file(&url, &dest, model_name, cancel).await?;
        self.emit_complete(model_name, file_size_mb(&dest), &dest);
        Ok(())
    }

    // ── Parakeet ONNX ─────────────────────────────────────────────────────

    async fn download_parakeet_onnx(
        &self,
        model_name: &str,
        cancel: &Arc<AtomicBool>,
    ) -> Result<(), DownloadError> {
        let target_dir = self.models_dir.join(PARAKEET_REGISTRY.target_dir);
        let tmp_extract_dir = self
            .models_dir
            .join(format!("{}.tmp_extract", PARAKEET_REGISTRY.target_dir));

        cleanup_dir_if_exists(&tmp_extract_dir)?;
        std::fs::create_dir_all(&tmp_extract_dir).map_err(DownloadError::Io)?;

        let archive_path = tmp_extract_dir.join(PARAKEET_REGISTRY.archive_name);
        eprintln!(
            "[ModelDownloader] Parakeet '{}' → {}",
            model_name, PARAKEET_REGISTRY.download_url
        );

        if let Err(err) = self
            .stream_to_file(
                PARAKEET_REGISTRY.download_url,
                &archive_path,
                model_name,
                cancel,
            )
            .await
        {
            let _ = std::fs::remove_dir_all(&tmp_extract_dir);
            return Err(err);
        }

        let extract_result: Result<(), DownloadError> = (|| {
            eprintln!(
                "[ModelDownloader] Extracting Parakeet archive to {:?}",
                tmp_extract_dir
            );
            self.extract_tar_gz(&archive_path, &tmp_extract_dir)?;
            let _ = std::fs::remove_file(&archive_path);

            flatten_single_subdir(&tmp_extract_dir)?;

            // Migrate .int8.onnx files to expected .onnx filenames
            let files_to_migrate = [
                ("encoder-model.int8.onnx", "encoder-model.onnx"),
                ("decoder_joint-model.int8.onnx", "decoder_joint-model.onnx"),
                ("model.int8.onnx", "model.onnx"), // fallback if named differently
            ];

            for (src_name, dst_name) in files_to_migrate.iter() {
                let src_path = tmp_extract_dir.join(src_name);
                let dst_path = tmp_extract_dir.join(dst_name);

                if src_path.exists() && !dst_path.exists() {
                    eprintln!(
                        "[ModelDownloader] Migrating Parakeet file {:?} to {:?}",
                        src_name, dst_name
                    );
                    if let Err(e) = std::fs::rename(&src_path, &dst_path) {
                        eprintln!(
                            "[WARN] Failed to rename {:?} to {:?}: {}",
                            src_path, dst_path, e
                        );
                    }
                }
            }

            if !has_parakeet_required_files(&tmp_extract_dir) {
                return Err(DownloadError::Other(format!(
                    "Parakeet ONNX validation failed: missing encoder*/decoder*.onnx in {:?}. Found: {:?}",
                    tmp_extract_dir,
                    list_model_files(&tmp_extract_dir)
                )));
            }

            Ok(())
        })();

        if let Err(err) = extract_result {
            let _ = std::fs::remove_dir_all(&tmp_extract_dir);
            return Err(err);
        }

        cleanup_dir_if_exists(&target_dir)?;
        std::fs::rename(&tmp_extract_dir, &target_dir).map_err(DownloadError::Io)?;

        let size_mb = dir_size_mb(&target_dir);
        eprintln!("[ModelDownloader] Parakeet ONNX done - {} MB", size_mb);
        self.emit_complete(model_name, size_mb, &target_dir);
        Ok(())
    }

    // Extract tar.gz archive
    fn extract_tar_gz(&self, archive: &Path, dest_dir: &Path) -> Result<(), DownloadError> {
        use flate2::read::GzDecoder;
        use tar::Archive;

        let file = std::fs::File::open(archive).map_err(DownloadError::Io)?;
        let decoder = GzDecoder::new(file);
        let mut tarball = Archive::new(decoder);
        tarball
            .unpack(dest_dir)
            .map_err(|e| DownloadError::Other(format!("Failed to extract tar.gz: {}", e)))?;
        Ok(())
    }

    // ── Sherpa-ONNX diarization ───────────────────────────────────────────

    /// Downloads two files that make up the Sherpa-ONNX diarization model:
    ///
    /// 1. Segmentation - `.tar.bz2` from GitHub Releases, extracted to
    ///    `sherpa-onnx-diarization/sherpa-onnx-reverb-diarization-v1/`
    /// 2. Embedding - single `.onnx` from GitHub Releases, saved to
    ///    `sherpa-onnx-diarization/sherpa-onnx-embedding/`
    async fn download_sherpa_onnx(&self, cancel: &Arc<AtomicBool>) -> Result<(), DownloadError> {
        let base_dir = self.models_dir.join(SHERPA_REGISTRY.model_name);
        let seg_dir = base_dir.join(SHERPA_REGISTRY.segmentation_dir);
        let emb_dir = base_dir.join(SHERPA_REGISTRY.embedding_dir);
        let seg_tmp_extract =
            base_dir.join(format!("{}.tmp_extract", SHERPA_REGISTRY.segmentation_dir));

        std::fs::create_dir_all(&base_dir)?;
        std::fs::create_dir_all(&emb_dir)?;

        if !has_any_required_files(
            &seg_dir,
            &[SHERPA_REGISTRY.segmentation_required_file, "model.int8.onnx"],
        ) {
            if cancel.load(Ordering::Relaxed) {
                return Err(DownloadError::Cancelled);
            }

            self.emit_stage(SHERPA_REGISTRY.model_name, "segmentation", 0.0, 0.0, 0.0);

            cleanup_dir_if_exists(&seg_tmp_extract)?;
            std::fs::create_dir_all(&seg_tmp_extract).map_err(DownloadError::Io)?;

            let seg_archive = seg_tmp_extract.join(SHERPA_REGISTRY.segmentation_archive_name);
            eprintln!(
                "[ModelDownloader] Sherpa segmentation → {}",
                SHERPA_REGISTRY.segmentation_url
            );
            if let Err(err) = self
                .stream_to_file(
                    SHERPA_REGISTRY.segmentation_url,
                    &seg_archive,
                    SHERPA_REGISTRY.model_name,
                    cancel,
                )
                .await
            {
                let _ = std::fs::remove_dir_all(&seg_tmp_extract);
                return Err(err);
            }

            eprintln!(
                "[ModelDownloader] Extracting segmentation archive to {:?}",
                seg_tmp_extract
            );
            extract_tar_bz2(&seg_archive, &seg_tmp_extract)?;
            let _ = std::fs::remove_file(&seg_archive);

            flatten_single_subdir(&seg_tmp_extract)?;

            if !has_any_required_files(
                &seg_tmp_extract,
                &[SHERPA_REGISTRY.segmentation_required_file, "model.int8.onnx"],
            ) {
                let _ = std::fs::remove_dir_all(&seg_tmp_extract);
                return Err(DownloadError::Other(format!(
                    "Sherpa segmentation validation failed: missing model.onnx/model.int8.onnx in {:?}. Found: {:?}",
                    seg_tmp_extract,
                    list_model_files(&seg_tmp_extract)
                )));
            }

            if !validate_non_empty_files(&seg_tmp_extract, &["model.onnx", "model.int8.onnx"]) {
                let _ = std::fs::remove_dir_all(&seg_tmp_extract);
                return Err(DownloadError::Other(
                    "Sherpa segmentation validation failed: model file size is zero".to_string(),
                ));
            }

            cleanup_dir_if_exists(&seg_dir)?;
            std::fs::rename(&seg_tmp_extract, &seg_dir).map_err(DownloadError::Io)?;
            self.emit_stage_complete(SHERPA_REGISTRY.model_name, "segmentation");
        } else {
            eprintln!("[ModelDownloader] Sherpa segmentation already present, skipping.");
        }

        let emb_dest = emb_dir.join(SHERPA_REGISTRY.embedding_filename);
        if !emb_dest.exists() {
            if cancel.load(Ordering::Relaxed) {
                return Err(DownloadError::Cancelled);
            }

            self.emit_stage(SHERPA_REGISTRY.model_name, "embedding", 0.0, 0.0, 0.0);
            eprintln!(
                "[ModelDownloader] Sherpa embedding → {}",
                SHERPA_REGISTRY.embedding_url
            );
            self.stream_to_file(
                SHERPA_REGISTRY.embedding_url,
                &emb_dest,
                SHERPA_REGISTRY.model_name,
                cancel,
            )
            .await?;

            if !validate_non_empty_file(&emb_dest) {
                return Err(DownloadError::Other(format!(
                    "Sherpa embedding validation failed: file is empty ({})",
                    emb_dest.display()
                )));
            }

            self.emit_stage_complete(SHERPA_REGISTRY.model_name, "embedding");
        } else {
            eprintln!("[ModelDownloader] Sherpa embedding already present, skipping.");
        }

        let size_mb = dir_size_mb(&base_dir);
        eprintln!("[ModelDownloader] Sherpa-ONNX done - {} MB", size_mb);
        self.emit_complete(SHERPA_REGISTRY.model_name, size_mb, &base_dir);
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
        let avg_speed =
            downloaded as f64 / start_time.elapsed().as_secs_f64().max(0.001) / (1024.0 * 1024.0);
        self.emit_progress(
            model_name,
            final_mb,
            final_mb,
            100.0,
            avg_speed,
            Some(0.0),
            false,
        );

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
    fn emit_stage(
        &self,
        model_name: &str,
        stage: &str,
        percent: f64,
        current_mb: f64,
        total_mb: f64,
    ) {
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
// Static helpers - model metadata
// ============================================================================

/// Map a Whisper model name (with or without the `whisper-` prefix) to the
/// corresponding GGML filename hosted on HuggingFace.
pub fn whisper_ggml_filename(model_name: &str) -> Option<&'static str> {
    let size = model_name.strip_prefix("whisper-").unwrap_or(model_name);
    WHISPER_GGML_MODELS
        .iter()
        .find_map(|(name, filename)| if *name == size { Some(*filename) } else { None })
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
/// `sherpa-onnx-reverb-diarization-v1/`) so downstream code sees files
/// directly inside `seg_dir`.
fn flatten_single_subdir(dir: &Path) -> Result<(), DownloadError> {
    let entries: Vec<_> = std::fs::read_dir(dir)
        .map_err(DownloadError::Io)?
        .flatten()
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            !name.starts_with("._") && !name.starts_with(".DS_Store")
        })
        .collect();

    if entries.len() != 1 {
        return Ok(());
    }
    let subdir = entries[0].path();
    if !subdir.is_dir() {
        return Ok(());
    }

    for sub_entry in std::fs::read_dir(&subdir)
        .map_err(DownloadError::Io)?
        .flatten()
    {
        let src = sub_entry.path();
        let dst = dir.join(src.file_name().expect("DirEntry has a filename"));
        std::fs::rename(&src, &dst).map_err(DownloadError::Io)?;
    }
    std::fs::remove_dir(&subdir).map_err(DownloadError::Io)?;
    Ok(())
}

/// Returns `true` if an `.onnx` file with `prefix` exists in `dir`.
fn has_onnx_with_prefix(dir: &Path, prefix: &str) -> bool {
    let prefix_lc = prefix.to_ascii_lowercase();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|v| v.to_str()) {
                    let lower_name = name.to_ascii_lowercase();
                    if lower_name.starts_with(&prefix_lc) && lower_name.ends_with(".onnx") {
                        return true;
                    }
                }
            }
        }
    }
    false
}

fn has_parakeet_required_files(dir: &Path) -> bool {
    has_onnx_with_prefix(dir, "encoder") && has_onnx_with_prefix(dir, "decoder")
}

fn has_any_required_files(dir: &Path, file_names: &[&str]) -> bool {
    file_names.iter().any(|name| dir.join(name).exists())
}

fn validate_non_empty_file(path: &Path) -> bool {
    std::fs::metadata(path)
        .map(|m| m.is_file() && m.len() > 0)
        .unwrap_or(false)
}

fn validate_non_empty_files(dir: &Path, candidates: &[&str]) -> bool {
    candidates
        .iter()
        .map(|name| dir.join(name))
        .filter(|path| path.exists())
        .any(|path| validate_non_empty_file(&path))
}

fn cleanup_dir_if_exists(dir: &Path) -> Result<(), DownloadError> {
    if dir.exists() {
        std::fs::remove_dir_all(dir).map_err(DownloadError::Io)?;
    }
    Ok(())
}

fn list_model_files(dir: &Path) -> Vec<String> {
    let mut found_files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|v| v.to_str()) {
                    found_files.push(name.to_string());
                }
            }
        }
    }
    found_files.sort();
    found_files
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

//! Transcribe Video - Tauri Backend
//!
//! This module provides Rust backend for Transcribe Video application.
//! It handles:
//! - Task queue management
//! - Native process spawning and monitoring
//! - Event emission to the frontend
//! - Model management (download, list, delete)

use std::env;
use std::path::PathBuf;


pub mod audio;
pub(crate) mod application;
pub mod app_state;
mod api_types;
mod bootstrap;
pub mod chunking_strategy;
mod command_registry;
pub mod commands;
pub mod disk_utils;
pub mod diarization;
pub mod domain;
pub mod engine_router;
mod errors;
pub mod ffmpeg_manager;
pub mod hallucination_bag;
pub(crate) mod infrastructure;
pub mod interfaces;
mod lifecycle;
pub mod model_downloader;
pub mod performance_config;
pub mod post_processing;
pub mod quality_gate;
mod path_validation;
mod setup_runtime;
pub mod storage;
mod store_io;
pub(crate) mod task_queue;
pub mod timeline_normalizer;
pub mod transcription;
pub mod transcription_manager;
mod models_dir;
pub mod types;

#[cfg(test)]
#[path = "tests/task_queue_tests.rs"]
mod task_queue_tests;

#[cfg(test)]
#[path = "tests/transcription_manager_memory_tests.rs"]
mod transcription_manager_memory_tests;

#[cfg(test)]
#[path = "tests/transcription_manager_tests.rs"]
mod transcription_manager_tests;

#[cfg(test)]
#[path = "tests/local_models_tests.rs"]
mod local_models_tests;

#[cfg(test)]
#[path = "tests/runtime_compat_tests.rs"]
mod runtime_compat_tests;

#[cfg(test)]
#[path = "tests/app_commands_tests.rs"]
mod app_commands_tests;

// Re-export FFmpeg types for frontend
pub use ffmpeg_manager::{
    download_ffmpeg, get_ffmpeg_path, get_ffmpeg_status, FFmpegDownloadProgressEvent, FFmpegStatus,
};

// Re-export TranscriptionManager types for frontend (Phase 3: transcribe-rs)
#[allow(unused_imports)]
pub use transcription_manager::{
    EngineType, SpeakerTurn as TSpeakerTurn, TranscriptionError, TranscriptionManager,
    TranscriptionOptions as TOptions, TranscriptionResult as TResult,
    TranscriptionSegment as TSegment,
};

pub use types::SpeakerSegment;

// Re-export EngineRouter types for frontend
pub use engine_router::{EnginePreference, EngineRouter};

// Re-export PerformanceConfig types for frontend
pub use performance_config::PerformanceConfig;
pub use errors::AppError;

pub use api_types::{
    AudioInfo, DeviceCheckResult, DeviceInfo, DevicesResponse, DiskUsage, EnvironmentStatus,
    FFmpegCheckResult, FFmpegInstallState, FFmpegStatusResponse, FileMetadata, LocalModel,
    LocalModelInfo, ModelCheckResult,
    ModelDownloadProgress, ProgressEvent, ProgressMetrics, RuntimeCheckResult,
    RuntimeReadinessStatus, RustTranscriptionOptions, TranscriptionOptions,
};
pub(crate) use api_types::SetModelsDirResponse;

/// Maximum concurrent model downloads
pub(crate) const MAX_CONCURRENT_DOWNLOADS: usize = 3;

/// Ensure C-runtime stdio descriptors are valid on Windows.
///
/// Some native libraries (notably diarization stacks) may call low-level CRT reads
/// even in GUI/dev contexts where stdin/stdout/stderr are not opened by parent process.
/// That can trigger a CRT debug assertion:
/// `_osfile(fh) & FOPEN` in `read.cpp`.
#[cfg(windows)]
fn ensure_windows_stdio_descriptors() {
    const O_RDONLY: i32 = 0x0000;
    const O_WRONLY: i32 = 0x0001;

    unsafe extern "C" {
        fn _wopen(filename: *const u16, oflag: i32, pmode: i32) -> i32;
        fn _dup2(fd1: i32, fd2: i32) -> i32;
        fn _close(fd: i32) -> i32;
    }

    fn redirect_fd(target_fd: i32, flags: i32, mode_name: &str) {
        let nul: Vec<u16> = "NUL\0".encode_utf16().collect();
        // SAFETY: `_wopen/_dup2/_close` are C runtime functions with C ABI.
        // We pass a valid NUL-terminated UTF-16 path and plain integer fd values.
        unsafe {
            let fd = _wopen(nul.as_ptr(), flags, 0);
            if fd < 0 {
                eprintln!(
                    "[WARN] Failed to open NUL for fd {} ({})",
                    target_fd, mode_name
                );
                return;
            }

            if _dup2(fd, target_fd) != 0 {
                eprintln!(
                    "[WARN] Failed to dup NUL into fd {} ({})",
                    target_fd, mode_name
                );
            }

            let _ = _close(fd);
        }
    }

    redirect_fd(0, O_RDONLY, "stdin");
    redirect_fd(1, O_WRONLY, "stdout");
    redirect_fd(2, O_WRONLY, "stderr");
}

/// Initialize ONNX Runtime from an explicit DLL path to avoid loading old system DLLs.
///
/// Search order:
/// 1. `ORT_DYLIB_PATH` environment variable (explicit override)
/// 2. Bundled resources next to the exe (`<exe_dir>/resources/ort/onnxruntime.dll`)
/// 3. Next to the executable (`<exe_dir>/onnxruntime.dll`)
/// 4. `CARGO_MANIFEST_DIR/resources/ort/` (dev-time only, compile-time path)
///
/// The function **refuses** to fall back to a system-wide DLL (e.g.
/// `C:\Windows\System32\onnxruntime.dll`) because version mismatches cause
/// hard-to-diagnose ONNX session errors.
#[cfg(feature = "rust-transcribe")]
fn init_onnx_runtime() -> Result<(), String> {
    let ort_dll_name = if cfg!(windows) {
        "onnxruntime.dll"
    } else if cfg!(target_os = "macos") {
        "libonnxruntime.dylib"
    } else {
        "libonnxruntime.so"
    };

    let mut candidates: Vec<PathBuf> = Vec::new();

    // 1. Explicit env override - highest priority
    if let Ok(path) = env::var("ORT_DYLIB_PATH") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            candidates.push(PathBuf::from(trimmed));
        }
    }

    // 2-3. Paths relative to the running executable (works in both dev and prod).
    // Prefer the bundled resources path first to avoid stale DLLs left in target/debug.
    if let Ok(exe_path) = std::env::current_exe() {
        let base_dir = exe_path.parent().unwrap_or(std::path::Path::new(""));
        candidates.push(base_dir.join("resources").join("ort").join(ort_dll_name));
        candidates.push(base_dir.join(ort_dll_name));
    }

    // 4. CARGO_MANIFEST_DIR - only useful during `cargo run` from the source tree.
    //    In production builds the compile-time path is baked in and may not exist;
    //    that's fine - we just skip it when the file is absent.
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("ort")
            .join(ort_dll_name),
    );

    let mut checked_paths: Vec<String> = Vec::new();
    let mut last_load_error: Option<String> = None;

    for dll_path in &candidates {
        checked_paths.push(dll_path.display().to_string());

        if !dll_path.exists() {
            continue;
        }

        eprintln!("[INFO] Trying ONNX Runtime DLL: {:?}", dll_path);
        let init = ort::init_from(dll_path.to_string_lossy().to_string());
        match init.commit() {
            Ok(_) => {
                eprintln!(
                    "[INFO] ONNX Runtime initialized successfully from {:?}",
                    dll_path
                );
                return Ok(());
            }
            Err(error) => {
                let message = format!(
                    "Failed to initialize ONNX Runtime from {:?}: {}",
                    dll_path, error
                );
                eprintln!("[WARN] {}", message);
                last_load_error = Some(message);
            }
        }
    }

    // If we found a DLL but it failed to load, that's a hard error.
    if let Some(error) = last_load_error {
        return Err(error);
    }

    // No DLL found at all - warn but allow the ort crate's default loader
    // to try its own built-in search. We explicitly warn if a stale system
    // DLL might be picked up.
    eprintln!(
        "[WARN] ONNX Runtime DLL not found in any bundled location. Checked: {}",
        checked_paths.join(", ")
    );

    #[cfg(windows)]
    {
        let system_dll = PathBuf::from(r"C:\Windows\System32\onnxruntime.dll");
        if system_dll.exists() {
            eprintln!(
                "[ERROR] A system-wide {} exists and will likely be loaded by the OS. \
                 This may cause version-mismatch crashes. \
                 Set ORT_DYLIB_PATH or place the correct DLL in resources/ort/.",
                ort_dll_name
            );
            return Err(format!(
                "ONNX Runtime DLL not bundled, and a potentially incompatible system-wide {} exists at {}. \
                 Please bundle the correct version in resources/ort/ or set ORT_DYLIB_PATH.",
                ort_dll_name,
                system_dll.display()
            ));
        }
    }

    Ok(())
}

// TranscriptionSegment, SpeakerTurn, TranscriptionResult - canonical definitions in types.rs
pub use types::{SpeakerTurn, TranscriptionResult, TranscriptionSegment};

use app_state::create_managed_state;

/// Main entry point
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    ensure_windows_stdio_descriptors();

    // Initialize ONNX Runtime with an explicit DLL path before transcribe-rs usage.
    #[cfg(feature = "rust-transcribe")]
    {
        if let Err(e) = init_onnx_runtime() {
            eprintln!("[ERROR] Failed to initialize ONNX Runtime: {}", e);
        }
    }

    let managed_state = create_managed_state();
    let app = bootstrap::build_app(managed_state);
    bootstrap::run_app(app);
}


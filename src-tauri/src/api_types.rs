use serde::{Deserialize, Serialize};

/// Transcription options passed from the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionOptions {
    pub model: String,
    pub device: String,
    pub language: String,
    pub enable_diarization: bool,
    pub diarization_provider: Option<String>,
    pub num_speakers: i32,
    pub audio_profile: Option<String>,
}

/// Transcription options for Rust transcribe-rs (Phase 3)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RustTranscriptionOptions {
    pub model: String,
    pub device: String,
    pub language: Option<String>,
    pub enable_diarization: bool,
    pub diarization_provider: Option<String>,
    pub num_speakers: i32,
    pub audio_profile: Option<String>,
}

/// Implement From for RustTranscriptionOptions -> TranscriptionOptions
impl From<RustTranscriptionOptions> for TranscriptionOptions {
    fn from(opts: RustTranscriptionOptions) -> Self {
        Self {
            model: opts.model,
            device: opts.device,
            language: opts.language.unwrap_or_else(|| "auto".to_string()),
            enable_diarization: opts.enable_diarization,
            diarization_provider: opts.diarization_provider,
            num_speakers: opts.num_speakers,
            audio_profile: opts.audio_profile,
        }
    }
}

/// Progress event sent to the frontend
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub task_id: String,
    pub progress: u8,
    pub stage: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metrics: Option<ProgressMetrics>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProgressMetrics {
    pub realtime_factor: Option<f64>,
    pub processed_duration: Option<f64>,
    pub total_duration: Option<f64>,
    pub estimated_time_remaining: Option<f64>,
    pub gpu_usage: Option<f64>,
    pub cpu_usage: Option<f64>,
    pub memory_usage: Option<f64>,
    pub model_load_ms: Option<u64>,
    pub decode_ms: Option<u64>,
    pub inference_ms: Option<u64>,
    pub diarization_ms: Option<u64>,
    pub total_ms: Option<u64>,
}

/// Model management types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModel {
    pub name: String,
    pub size_mb: u64,
    pub model_type: String,
    pub installed: bool,
    pub path: Option<String>,
}

/// Result of runtime environment check for Setup Wizard
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCheckResult {
    pub status: String,
    pub version: Option<String>,
    pub executable: Option<String>,
    #[serde(rename = "inVirtualEnv", alias = "in_venv", alias = "inVenv")]
    pub in_virtual_env: bool,
    pub message: String,
}

/// Result of FFmpeg installation check for Setup Wizard
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FFmpegCheckResult {
    pub status: String,
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub message: String,
}

/// Response for `get_ffmpeg_status` command.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FFmpegStatusResponse {
    pub status: FFmpegInstallState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

/// Installation state for FFmpeg status contract.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FFmpegInstallState {
    Installed,
    NotInstalled,
}

/// Result of AI models check for Setup Wizard
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCheckResult {
    pub status: String,
    pub installed_models: Vec<LocalModelInfo>,
    pub has_required_model: bool,
    pub message: String,
}

/// Local model info for Setup Wizard (simplified version)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelInfo {
    pub name: String,
    pub model_type: String,
    pub size_mb: u64,
}

/// Device check result for Setup Wizard
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCheckResult {
    pub status: String,
    pub devices: Vec<DeviceInfo>,
    pub recommended: Option<DeviceInfo>,
    pub message: String,
}

/// Complete environment status for Setup Wizard
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentStatus {
    pub runtime: RuntimeCheckResult,
    pub ffmpeg: FFmpegCheckResult,
    pub models: ModelCheckResult,
    pub devices: DeviceCheckResult,
    pub overall_status: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeReadinessStatus {
    pub ready: bool,
    pub runtime_ready: bool,
    pub ffmpeg_ready: bool,
    pub runtime_message: String,
    pub ffmpeg_message: String,
    pub message: String,
    pub checked_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskUsage {
    pub total_size_mb: u64,
    pub free_space_mb: u64,
}

/// Device information for ML acceleration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub device_type: String,
    pub name: String,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_mb: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compute_capability: Option<String>,
    pub is_recommended: bool,
}

/// Response containing all available devices
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicesResponse {
    pub devices: Vec<DeviceInfo>,
    pub recommended: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDownloadProgress {
    pub model_name: String,
    pub current_mb: u64,
    pub total_mb: u64,
    pub percent: f64,
    pub speed_mb_s: f64,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eta_s: Option<f64>,
    pub total_estimated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetModelsDirResponse {
    pub(crate) path: String,
    pub(crate) moved_items: u64,
    pub(crate) moved_existing_models: bool,
}

/// Audio information response
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioInfo {
    pub sample_rate: u32,
    pub channels: u16,
    pub duration: f64,
    pub format: String,
}

/// File metadata structure
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub exists: bool,
}

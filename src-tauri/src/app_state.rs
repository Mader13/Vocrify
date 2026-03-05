use std::collections::HashMap;
use std::sync::{atomic::AtomicBool, Arc, OnceLock, RwLock};

use tokio::sync::Mutex;

use crate::performance_config::PerformanceConfig;
use crate::task_queue::TaskManager;
use crate::transcription_manager::TranscriptionManager;
use crate::DevicesResponse;

pub(crate) type TaskManagerState = Arc<Mutex<TaskManager>>;

/// TranscriptionManager state for Rust-based transcription
pub(crate) type TranscriptionManagerState = Arc<Mutex<Option<TranscriptionManager>>>;

/// Abort handles for active Rust transcribe-rs tasks (enables cancel_transcription)
pub(crate) type RustTaskHandles = Arc<Mutex<HashMap<String, tokio::task::AbortHandle>>>;

/// Performance configuration state for feature flags
/// Uses RwLock to allow updating config after initial setup
pub(crate) type PerformanceConfigState = Arc<RwLock<PerformanceConfig>>;
pub(crate) type QuitGuardState = Arc<AtomicBool>;
pub(crate) type CloseBehaviorState = Arc<RwLock<CloseBehavior>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CloseBehavior {
    HideToTray,
    Exit,
}

impl Default for CloseBehavior {
    fn default() -> Self {
        Self::HideToTray
    }
}

/// Global cache for device detection
/// Persists for the app session to avoid repeated hardware probing
pub(crate) static DEVICE_CACHE: OnceLock<Arc<Mutex<Option<DevicesResponse>>>> = OnceLock::new();

pub(crate) struct ManagedState {
    pub(crate) task_manager: TaskManagerState,
    pub(crate) transcription_manager_state: TranscriptionManagerState,
    pub(crate) rust_task_handles: RustTaskHandles,
    pub(crate) performance_config_state: PerformanceConfigState,
    pub(crate) quit_guard_state: QuitGuardState,
    pub(crate) close_behavior_state: CloseBehaviorState,
}

pub(crate) fn create_managed_state() -> ManagedState {
    ManagedState {
        task_manager: Arc::new(Mutex::new(TaskManager::default())),
        transcription_manager_state: Arc::new(Mutex::new(None)),
        rust_task_handles: Arc::new(Mutex::new(HashMap::new())),
        performance_config_state: Arc::new(RwLock::new(PerformanceConfig::default())),
        quit_guard_state: Arc::new(AtomicBool::new(false)),
        close_behavior_state: Arc::new(RwLock::new(CloseBehavior::default())),
    }
}

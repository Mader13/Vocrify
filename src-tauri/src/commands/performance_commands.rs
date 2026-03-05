use tauri::{AppHandle, State};

use crate::{app_state::PerformanceConfigState, PerformanceConfig};

/// Get the current performance configuration
#[tauri::command]
#[allow(dead_code)]
pub(crate) fn get_performance_config(
    perf_config: State<'_, PerformanceConfigState>,
) -> Result<PerformanceConfig, String> {
    crate::application::performance::get_performance_config(&perf_config)
}

/// Update performance configuration
#[tauri::command]
#[allow(dead_code)]
pub(crate) async fn update_performance_config(
    app: AppHandle,
    perf_config: State<'_, PerformanceConfigState>,
    config: PerformanceConfig,
    persist: bool,
) -> Result<PerformanceConfig, String> {
    crate::application::performance::update_performance_config(&app, &perf_config, config, persist)
        .await
}

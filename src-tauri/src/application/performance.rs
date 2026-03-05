use tauri::{AppHandle, Manager, State};

use crate::{app_state::PerformanceConfigState, PerformanceConfig};

pub(crate) fn get_performance_config(
    perf_config: &State<'_, PerformanceConfigState>,
) -> Result<PerformanceConfig, String> {
    perf_config
        .read()
        .map(|cfg| cfg.clone())
        .map_err(|e| format!("Failed to read performance config: {}", e))
}

pub(crate) async fn update_performance_config(
    app: &AppHandle,
    perf_config: &State<'_, PerformanceConfigState>,
    config: PerformanceConfig,
    persist: bool,
) -> Result<PerformanceConfig, String> {
    eprintln!(
        "[INFO] Updating performance configuration: persist={}",
        persist
    );

    {
        let mut config_guard = perf_config
            .write()
            .map_err(|e| format!("Failed to acquire write lock: {}", e))?;
        *config_guard = config.clone();
    }

    if persist {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {}", e))?;

        config
            .save_to_file(&app_data_dir)
            .map_err(|e| format!("Failed to save performance config: {}", e))?;

        eprintln!("[INFO] Performance configuration saved to file");
    }

    Ok(config)
}

//! Setup-related application services (use cases).

use tauri::{AppHandle, State};

use crate::{
	app_state::PerformanceConfigState, RuntimeReadinessStatus,
};
use crate::infrastructure::runtime::ffmpeg_manager::get_ffmpeg_path;
use crate::setup_runtime::{
	evaluate_runtime_readiness, load_setup_state, mark_setup_complete_impl, now_rfc3339,
	reset_setup_impl, run_environment_status_check_impl, run_ffmpeg_status_check_impl,
	run_models_status_check_impl, run_runtime_environment_check_impl, update_runtime_state_impl,
};

pub(crate) async fn check_runtime_environment(
	app: &AppHandle,
) -> Result<crate::RuntimeCheckResult, String> {
	run_runtime_environment_check_impl(app).await
}

pub(crate) async fn check_ffmpeg_status(app: &AppHandle) -> Result<crate::FFmpegCheckResult, String> {
	run_ffmpeg_status_check_impl(app).await
}

pub(crate) async fn check_runtime_readiness(app: &AppHandle) -> Result<RuntimeReadinessStatus, String> {
	Ok(evaluate_runtime_readiness(app).await.readiness)
}

pub(crate) async fn check_models_status(app: &AppHandle) -> Result<crate::ModelCheckResult, String> {
	run_models_status_check_impl(app).await
}

pub(crate) async fn get_environment_status(app: &AppHandle) -> Result<crate::EnvironmentStatus, String> {
	run_environment_status_check_impl(app).await
}

pub(crate) async fn mark_setup_complete(app: &AppHandle) -> Result<(), String> {
	let ffmpeg_path = get_ffmpeg_path(app)
		.await
		.ok()
		.map(|p| p.to_string_lossy().to_string());

	let readiness = RuntimeReadinessStatus {
		ready: true,
		runtime_ready: true,
		ffmpeg_ready: true,
		runtime_message: "Runtime verified by frontend".to_string(),
		ffmpeg_message: "FFmpeg verified by frontend".to_string(),
		message: "Runtime is ready".to_string(),
		checked_at: now_rfc3339(),
	};

	mark_setup_complete_impl(app, &readiness, Some(now_rfc3339()), None, ffmpeg_path)
}

pub(crate) fn reset_setup(app: &AppHandle) -> Result<(), String> {
	reset_setup_impl(app)
}

pub(crate) async fn is_setup_complete_fast(
	app: &AppHandle,
	perf_config: &State<'_, PerformanceConfigState>,
) -> Result<bool, String> {
	let fast_check_enabled = perf_config
		.read()
		.map(|cfg| cfg.fast_setup_check_enabled)
		.unwrap_or(true);

	if !fast_check_enabled {
		eprintln!("[INFO] Fast setup check is disabled, falling back to full check");
		return is_setup_complete(app).await;
	}

	if let Some(state) = load_setup_state(app) {
		if state.completed_at.is_some() {
			if let Some(completed_at_str) = &state.completed_at {
				if let Ok(completed_at) = chrono::DateTime::parse_from_rfc3339(completed_at_str) {
					let now = chrono::Utc::now();
					let days_old = now
						.signed_duration_since(completed_at.with_timezone(&chrono::Utc))
						.num_days();
					eprintln!(
						"[INFO] Fast setup check: setup completed {} days ago, wizard was finished",
						days_old
					);
				}
			}
			eprintln!("[INFO] Fast setup check: completed_at exists, setup was completed");
			return Ok(true);
		}

		eprintln!("[INFO] Fast setup check: no completed_at, setup not finished");
	} else {
		eprintln!("[INFO] Fast setup check: no cached state, falling back to full check");
	}

	is_setup_complete(app).await
}

pub(crate) async fn is_setup_complete(app: &AppHandle) -> Result<bool, String> {
	if let Some(state) = load_setup_state(app) {
		if state.completed_at.is_some() {
			eprintln!("[INFO] Setup complete status: completed_at exists, setup was finished");
			return Ok(true);
		}
	}

	let readiness = evaluate_runtime_readiness(app).await;
	update_runtime_state_impl(
		app,
		&readiness.readiness,
		readiness.runtime_executable.clone(),
		readiness.ffmpeg_path.clone(),
	)?;
	eprintln!(
		"[INFO] Setup complete status (runtime-ready): {}",
		readiness.readiness.ready
	);
	Ok(readiness.readiness.ready)
}

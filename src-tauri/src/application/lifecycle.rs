//! Application lifecycle and app-level use cases.

use tauri::{AppHandle, Manager, State};

use crate::{
	app_state::{CloseBehavior, CloseBehaviorState, TaskManagerState},
	AppError,
};

pub(crate) fn parse_close_behavior(value: &str) -> CloseBehavior {
	if value.eq_ignore_ascii_case("exit") {
		CloseBehavior::Exit
	} else {
		CloseBehavior::HideToTray
	}
}

pub(crate) fn close_behavior_to_str(value: CloseBehavior) -> &'static str {
	match value {
		CloseBehavior::HideToTray => "hide_to_tray",
		CloseBehavior::Exit => "exit",
	}
}

fn open_dir_in_file_manager(path: &str) -> Result<(), AppError> {
	#[cfg(target_os = "windows")]
	{
		std::process::Command::new("explorer")
			.arg(path)
			.spawn()
			.map_err(AppError::IoError)?;
	}

	#[cfg(target_os = "macos")]
	{
		std::process::Command::new("open")
			.arg(path)
			.spawn()
			.map_err(AppError::IoError)?;
	}

	#[cfg(target_os = "linux")]
	{
		let open_result = std::process::Command::new("xdg-open").arg(path).spawn();

		if open_result.is_err() {
			std::process::Command::new("nautilus")
				.arg(path)
				.spawn()
				.map_err(AppError::IoError)?;
		}
	}

	Ok(())
}

pub(crate) fn open_archive_folder(app: &AppHandle) -> Result<(), AppError> {
	let app_data = app.path().app_data_dir().map_err(|_| {
		AppError::IoError(std::io::Error::new(
			std::io::ErrorKind::Other,
			"Failed to get app data dir",
		))
	})?;

	let archive_dir = app_data.join("archive");
	let archive_dir_str = archive_dir.to_string_lossy().to_string();

	eprintln!("[DEBUG] Opening archive folder: {:?}", archive_dir_str);

	if !archive_dir.exists() {
		std::fs::create_dir_all(&archive_dir).map_err(AppError::IoError)?;
	}

	open_dir_in_file_manager(&archive_dir_str)?;

	eprintln!("[DEBUG] Successfully opened archive folder: {:?}", archive_dir_str);
	Ok(())
}

pub(crate) fn open_app_directory(app: &AppHandle) -> Result<(), AppError> {
	let app_data = app.path().app_data_dir().map_err(|_| {
		AppError::IoError(std::io::Error::new(
			std::io::ErrorKind::Other,
			"Failed to get app data dir",
		))
	})?;

	let app_dir = app_data.join("Vocrify");
	let app_dir_str = app_dir.to_string_lossy().to_string();

	eprintln!("[DEBUG] Opening app directory: {:?}", app_dir_str);

	if !app_dir.exists() {
		std::fs::create_dir_all(&app_dir).map_err(AppError::IoError)?;
	}

	open_dir_in_file_manager(&app_dir_str)?;

	eprintln!("[DEBUG] Successfully opened app directory: {:?}", app_dir_str);
	Ok(())
}

pub(crate) fn set_close_behavior(
	close_behavior_state: &State<'_, CloseBehaviorState>,
	close_behavior: String,
) -> Result<(), AppError> {
	let parsed = parse_close_behavior(&close_behavior);
	let mut guard = close_behavior_state.write().map_err(|_| {
		AppError::Other("Failed to acquire close behavior state lock".to_string())
	})?;
	*guard = parsed;
	Ok(())
}

pub(crate) fn get_close_behavior(
	close_behavior_state: &State<'_, CloseBehaviorState>,
) -> Result<String, AppError> {
	let behavior = *close_behavior_state.read().map_err(|_| {
		AppError::Other("Failed to read close behavior state".to_string())
	})?;

	Ok(close_behavior_to_str(behavior).to_string())
}

pub(crate) async fn has_active_work_now(
	task_manager: &State<'_, TaskManagerState>,
) -> Result<bool, AppError> {
	let manager = task_manager.lock().await;
	Ok(!manager.running_tasks.is_empty() || !manager.queued_tasks.is_empty())
}

pub(crate) fn quit_application(app: &AppHandle) {
	app.exit(0);
}

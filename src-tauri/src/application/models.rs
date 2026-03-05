//! Model management use cases.

use std::path::PathBuf;
use std::sync::{
	atomic::{AtomicBool, Ordering},
	Arc,
};

use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

use crate::{
	app_state::{TaskManagerState, TranscriptionManagerState},
	AppError, DiskUsage, LocalModel, MAX_CONCURRENT_DOWNLOADS, SetModelsDirResponse,
};

async fn spawn_model_download(
	app: AppHandle,
	model_name: String,
	model_type: String,
	cache_dir: PathBuf,
	_token_file: Option<PathBuf>,
	_child_arc: Arc<Mutex<Option<tokio::process::Child>>>,
	cancel: Arc<AtomicBool>,
) -> Result<(), String> {
	let downloader = crate::model_downloader::ModelDownloader::new(app, cache_dir);
	downloader
		.download(&model_name, &model_type, cancel)
		.await
		.map_err(|e| e.to_string())
}

fn validate_model_name(model_name: &str) -> Result<String, AppError> {
	crate::path_validation::validate_safe_path_component(model_name, "Model name")
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

pub(crate) fn get_models_dir(app: &AppHandle) -> Result<String, AppError> {
	let models_dir = crate::models_dir::get_models_dir(app)?;
	Ok(models_dir.to_string_lossy().to_string())
}

pub(crate) async fn set_models_dir(
	app: &AppHandle,
	state: &State<'_, TranscriptionManagerState>,
	models_dir: String,
	move_existing_models: Option<bool>,
) -> Result<SetModelsDirResponse, AppError> {
	let trimmed = models_dir.trim();
	if trimmed.is_empty() {
		return Err(AppError::Other(
			"Models directory path cannot be empty".to_string(),
		));
	}

	let selected_dir = PathBuf::from(trimmed);

	if selected_dir.exists() && !selected_dir.is_dir() {
		return Err(AppError::Other(format!(
			"Selected path is not a directory: {}",
			selected_dir.display()
		)));
	}

	std::fs::create_dir_all(&selected_dir).map_err(AppError::IoError)?;
	let normalized = dunce::simplified(&selected_dir).to_path_buf();
	let current_models_dir = crate::models_dir::get_models_dir(app)?;
	let should_move_existing = move_existing_models.unwrap_or(false) && current_models_dir != normalized;

	let moved_items = if should_move_existing {
		let source = current_models_dir.clone();
		let destination = normalized.clone();
		let app_handle = app.clone();
		match tokio::task::spawn_blocking(move || {
			crate::models_dir::move_models_contents(&source, &destination, &app_handle)
		})
		.await {
			Ok(Ok(moved)) => moved,
			Ok(Err(error)) => {
				return Err(error);
			}
			Err(error) => {
				return Err(AppError::Other(format!(
					"Failed to move models directory: {}",
					error
				)));
			}
		}
	} else {
		0
	};

	crate::models_dir::save_custom_models_dir(app, &normalized)?;

	if let Ok(mut manager_guard) = state.try_lock() {
		*manager_guard = None;
	} else {
		eprintln!(
			"[WARN] TranscriptionManager is busy, new models directory will apply after current task"
		);
	}

	eprintln!(
		"[INFO] Models directory updated: {:?} (moved_items={})",
		normalized, moved_items
	);

	Ok(SetModelsDirResponse {
		path: normalized.to_string_lossy().to_string(),
		moved_items,
		moved_existing_models: should_move_existing,
	})
}

pub(crate) fn open_models_folder(app: &AppHandle) -> Result<(), AppError> {
	let models_dir = crate::models_dir::get_models_dir(app)?;
	let models_dir_str = models_dir.to_string_lossy().to_string();

	eprintln!("[DEBUG] Opening models folder: {:?}", models_dir_str);
	open_dir_in_file_manager(&models_dir_str)?;
	eprintln!("[DEBUG] Successfully opened folder: {:?}", models_dir_str);
	Ok(())
}

pub(crate) async fn download_model(
	app: &AppHandle,
	task_manager: &State<'_, TaskManagerState>,
	model_name: String,
	model_type: String,
	hugging_face_token: Option<String>,
) -> Result<String, AppError> {
	let model_name = validate_model_name(&model_name)?;

	{
		let manager = task_manager.lock().await;
		if manager.downloading_models.len() >= MAX_CONCURRENT_DOWNLOADS {
			return Err(AppError::ModelError(
				"Maximum concurrent downloads reached".to_string(),
			));
		}
		if manager.downloading_models.contains_key(&model_name) {
			return Err(AppError::ModelError(format!(
				"Download already in progress for: {}",
				model_name
			)));
		}
	}

	let models_dir = crate::models_dir::get_models_dir(app)?;

	let token_file: Option<PathBuf> = if hugging_face_token.is_some() {
		None
	} else {
		None
	};

	let child_arc: Arc<Mutex<Option<tokio::process::Child>>> = Arc::new(Mutex::new(None));
	let cancel_token: Arc<AtomicBool> = Arc::new(AtomicBool::new(false));

	let task_manager_clone = task_manager.inner().clone();
	let app_clone = app.clone();
	let model_name_clone = model_name.clone();
	let model_type_clone = model_type.clone();
	let cache_dir = models_dir.clone();
	let token_file_clone = token_file.clone();
	let token_file_for_cleanup = token_file;
	let child_arc_for_task = child_arc.clone();
	let cancel_token_for_task = cancel_token.clone();

	let handle = tokio::spawn(async move {
		let app_for_events = app_clone.clone();

		let download_result = spawn_model_download(
			app_clone,
			model_name_clone.clone(),
			model_type_clone,
			cache_dir,
			token_file_clone,
			child_arc_for_task,
			cancel_token_for_task,
		)
		.await;

		if let Some(path) = token_file_for_cleanup {
			let _ = std::fs::remove_file(path);
		}

		{
			let mut manager = task_manager_clone.lock().await;
			manager.downloading_models.remove(&model_name_clone);
			manager.downloading_processes.remove(&model_name_clone);
			manager.cancel_tokens.remove(&model_name_clone);
		}

		match download_result {
			Ok(_) => {
				eprintln!("[INFO] Model download complete: {}", model_name_clone);
			}
			Err(e) => {
				let error_text = e.to_string();
				eprintln!(
					"[ERROR] Model download failed for {}: {}",
					model_name_clone, error_text
				);
				let _ = app_for_events.emit(
					"model-download-error",
					serde_json::json!({
						"modelName": model_name_clone,
						"error": error_text,
					}),
				);
			}
		}
	});

	{
		let mut manager = task_manager.lock().await;
		manager
			.downloading_models
			.insert(model_name.clone(), handle);
		manager
			.downloading_processes
			.insert(model_name.clone(), child_arc);
		manager
			.cancel_tokens
			.insert(model_name.clone(), cancel_token);
	}

	Ok(model_name)
}

pub(crate) fn get_local_models(app: &AppHandle) -> Result<Vec<LocalModel>, AppError> {
	let models_dir = crate::models_dir::get_models_dir(app)?;
	crate::models_dir::get_local_models_internal(&models_dir)
		.map_err(|e| AppError::ModelError(e.to_string()))
}

pub(crate) async fn delete_model(app: &AppHandle, model_name: String) -> Result<(), AppError> {
	let model_name = validate_model_name(&model_name)?;
	let models_dir = crate::models_dir::get_models_dir(app)?;

	eprintln!("Deleting model: {}", model_name);

	let whisper_bin_name = model_name
		.strip_prefix("whisper-")
		.map(|size| format!("ggml-{}.bin", size));
	let gigaam_file_names = if model_name == "gigaam-v3" {
		vec!["v3_e2e_ctc.int8.onnx", "v3_e2e_ctc.onnx"]
	} else {
		Vec::new()
	};
	let mut deleted_any = false;

	let mut candidate_paths = vec![models_dir.join(&model_name)];
	candidate_paths.push(
		whisper_bin_name
			.as_ref()
			.map(|name| models_dir.join(name))
			.unwrap_or_else(|| models_dir.join("__non_existing__")),
	);
	candidate_paths.extend(gigaam_file_names.into_iter().map(|name| models_dir.join(name)));

	for candidate in candidate_paths {
		if !candidate.exists() {
			continue;
		}

		if candidate.is_dir() {
			std::fs::remove_dir_all(&candidate).map_err(|e| {
				AppError::ModelError(format!(
					"Failed to delete model directory {}: {}",
					candidate.display(),
					e
				))
			})?;
		} else {
			std::fs::remove_file(&candidate).map_err(|e| {
				AppError::ModelError(format!(
					"Failed to delete model file {}: {}",
					candidate.display(),
					e
				))
			})?;
		}

		deleted_any = true;
		eprintln!("[INFO] Deleted model artifact: {}", candidate.display());
	}

	if !deleted_any {
		return Err(AppError::ModelError(format!(
			"Model not found on disk: {}",
			model_name
		)));
	}

	tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

	let store_path = crate::store_io::get_store_path(app);
	if store_path.exists() {
		if let Ok(content) = std::fs::read_to_string(&store_path) {
			if let Ok(store_data) = serde_json::from_str::<serde_json::Value>(&content) {
				if let Some(selected) = store_data.get("selected_model").and_then(|v| v.as_str()) {
					let needs_clear = selected == model_name
						|| selected == format!("transcription:{}", model_name)
						|| selected == format!("diarization:{}", model_name);

					if needs_clear {
						let mut updated_data = store_data.clone();
						updated_data["selected_model"] = serde_json::Value::Null;

						if crate::store_io::save_store_data(&store_path, &updated_data).is_ok() {
							eprintln!("Cleared selected model from store (deleted: {})", model_name);
						}
					}
				}
			}
		}
	}

	Ok(())
}

pub(crate) async fn cancel_model_download(
	task_manager: &State<'_, TaskManagerState>,
	model_name: String,
) -> Result<(), AppError> {
	let model_name = validate_model_name(&model_name)?;

	let (handle, child_arc, cancel_token) = {
		let mut manager = task_manager.lock().await;
		let handle = manager.downloading_models.remove(&model_name);
		let child_arc = manager.downloading_processes.remove(&model_name);
		let cancel_token = manager.cancel_tokens.remove(&model_name);
		(handle, child_arc, cancel_token)
	};

	if handle.is_none() && child_arc.is_none() && cancel_token.is_none() {
		return Err(AppError::ModelError(format!(
			"Model download not found: {}",
			model_name
		)));
	}

	if let Some(token) = cancel_token {
		token.store(true, Ordering::Relaxed);
	}

	if let Some(arc) = child_arc {
		let mut guard = arc.lock().await;
		if let Some(child) = guard.as_mut() {
			let _ = child.start_kill();
		}
	}

	if let Some(h) = handle {
		h.abort();
	}

	Ok(())
}

pub(crate) fn get_disk_usage(app: &AppHandle) -> Result<DiskUsage, AppError> {
	let models_dir = crate::models_dir::get_models_dir(app)?;

	let total_size_mb = if models_dir.exists() {
		let mut total_size = 0u64;
		for dir_entry in std::fs::read_dir(&models_dir)? {
			let dir_entry = dir_entry?;
			if let Ok(metadata) = dir_entry.metadata() {
				if metadata.is_dir() {
					for sub_entry in std::fs::read_dir(dir_entry.path())? {
						if let Ok(sub_meta) = sub_entry?.metadata() {
							total_size += sub_meta.len();
						}
					}
				} else {
					total_size += metadata.len();
				}
			}
		}
		total_size / (1024 * 1024)
	} else {
		0
	};

	let free_space_mb = crate::disk_utils::get_free_space_mb(&models_dir);

	Ok(DiskUsage {
		total_size_mb,
		free_space_mb,
	})
}

pub(crate) fn clear_cache(app: &AppHandle) -> Result<(), AppError> {
	let models_dir = crate::models_dir::get_models_dir(app)?;
	let cache_dirs = vec![models_dir.join(".hf_cache"), models_dir.join("hf_cache")];

	let mut cleared_count = 0;
	let mut error_count = 0;

	for cache_dir in cache_dirs {
		if cache_dir.exists() {
			match std::fs::remove_dir_all(&cache_dir) {
				Ok(_) => {
					eprintln!("[INFO] Cleared cache directory: {:?}", cache_dir);
					cleared_count += 1;
				}
				Err(e) => {
					eprintln!(
						"[WARN] Failed to clear cache directory {:?}: {}",
						cache_dir, e
					);
					error_count += 1;
				}
			}
		}
	}

	if cleared_count == 0 && error_count == 0 {
		eprintln!("[INFO] No cache directories found to clear");
	} else {
		eprintln!(
			"[INFO] Cache clear completed: {} cleared, {} errors",
			cleared_count, error_count
		);
	}

	Ok(())
}

pub(crate) fn save_selected_model(app: &AppHandle, model: String) -> Result<(), AppError> {
	let store_path = crate::store_io::get_store_path(app);
	let mut store_data = crate::store_io::load_store_data(&store_path)?;
	store_data["selected_model"] = serde_json::Value::String(model);
	crate::store_io::save_store_data(&store_path, &store_data)?;

	Ok(())
}

pub(crate) fn load_selected_model(app: &AppHandle) -> Result<Option<String>, AppError> {
	let store_path = crate::store_io::get_store_path(app);

	if !store_path.exists() {
		return Ok(None);
	}

	let content = std::fs::read_to_string(&store_path).map_err(AppError::IoError)?;

	let store_data: serde_json::Value = serde_json::from_str(&content).map_err(AppError::JsonError)?;

	Ok(store_data
		.get("selected_model")
		.and_then(|v| v.as_str().map(|s| s.to_string())))
}

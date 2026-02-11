import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import type {
  TranscriptionOptions,
  TranscriptionResult,
  ProgressEvent,
  SegmentEvent,
  LocalModel,
  DiskUsage,
  ModelDownloadProgress,
  ModelDownloadStageEvent,
  FileMetadata,
  ExportMode,
  DevicesResponse,
} from "@/types";
import type {
  PythonCheckResult,
  FFmpegCheckResult,
  ModelCheckResult,
  EnvironmentStatus,
} from "@/types/setup";
import { logger } from "@/lib/logger";

/**
 * Handle log events from Python backend
 */
function handleBackendLog(logEvent: {
  level: string;
  category: string;
  message: string;
  data?: any;
  taskId?: string;
  fileName?: string;
}) {
  const level = logEvent.level === "debug" ? 0 
    : logEvent.level === "info" ? 1 
    : logEvent.level === "warning" ? 2 
    : 3;
  
  const category = logEvent.category as "transcription" | "upload" | "model" | "system";
  
  switch (category) {
    case "transcription":
      if (level === 0) logger.transcriptionDebug(logEvent.message, logEvent.data, { taskId: logEvent.taskId, fileName: logEvent.fileName });
      else if (level === 1) logger.transcriptionInfo(logEvent.message, logEvent.data, { taskId: logEvent.taskId, fileName: logEvent.fileName });
      else if (level === 2) logger.transcriptionWarn(logEvent.message, logEvent.data, { taskId: logEvent.taskId, fileName: logEvent.fileName });
      else logger.transcriptionError(logEvent.message, logEvent.data, { taskId: logEvent.taskId, fileName: logEvent.fileName });
      break;
    case "upload":
      if (level === 0) logger.uploadDebug(logEvent.message, logEvent.data, { taskId: logEvent.taskId, fileName: logEvent.fileName });
      else if (level === 1) logger.uploadInfo(logEvent.message, logEvent.data, { taskId: logEvent.taskId, fileName: logEvent.fileName });
      else if (level === 2) logger.uploadWarn(logEvent.message, logEvent.data, { taskId: logEvent.taskId, fileName: logEvent.fileName });
      else logger.uploadError(logEvent.message, logEvent.data, { taskId: logEvent.taskId, fileName: logEvent.fileName });
      break;
    case "model":
      if (level === 0) logger.modelDebug(logEvent.message, logEvent.data);
      else if (level === 1) logger.modelInfo(logEvent.message, logEvent.data);
      else if (level === 2) logger.modelWarn(logEvent.message, logEvent.data);
      else logger.modelError(logEvent.message, logEvent.data);
      break;
    default:
      if (level === 0) logger.debug(logEvent.message, logEvent.data, { taskId: logEvent.taskId, fileName: logEvent.fileName });
      else if (level === 1) logger.info(logEvent.message, logEvent.data, { taskId: logEvent.taskId, fileName: logEvent.fileName });
      else if (level === 2) logger.warn(logEvent.message, logEvent.data, { taskId: logEvent.taskId, fileName: logEvent.fileName });
      else logger.error(logEvent.message, logEvent.data, { taskId: logEvent.taskId, fileName: logEvent.fileName });
  }
}

/**
 * Tauri command response types
 */
interface CommandResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Start a transcription task
 */
export async function startTranscription(
  taskId: string,
  filePath: string,
  options: TranscriptionOptions
): Promise<CommandResult<void>> {
  logger.transcriptionInfo("Starting transcription", { taskId, fileName: filePath });

  // Convert numSpeakers to Python format: -1 for auto, or positive integer for specific count
  // The value comes from UI as a string ("auto" | "2" | "3"...) but Rust expects i32
  const numSpeakersAsNumber = typeof options.numSpeakers === 'string'
    ? (options.numSpeakers === 'auto' ? -1 : parseInt(options.numSpeakers, 10))
    : options.numSpeakers;

  logger.transcriptionDebug("Transcription options", {
    model: options.model,
    device: options.device,
    language: options.language,
    enableDiarization: options.enableDiarization,
    diarizationProvider: options.diarizationProvider,
    numSpeakers: options.numSpeakers,
    numSpeakersConverted: numSpeakersAsNumber,
  });

  try {
    await invoke("start_transcription", {
      taskId,
      filePath,
      options: {
        model: options.model,
        device: options.device,
        language: options.language,
        enable_diarization: options.enableDiarization,
        diarization_provider: options.diarizationProvider,
        num_speakers: numSpeakersAsNumber,
      },
    });
    logger.transcriptionInfo("Transcription started successfully", { taskId });
    return { success: true };
  } catch (error) {
    logger.transcriptionError("Failed to start transcription", {
      taskId,
      error: String(error),
      errorDetails: error instanceof Error ? error.stack : String(error)
    });
    return { success: false, error: String(error) };
  }
}

/**
 * Cancel a running transcription task
 */
export async function cancelTranscription(
  taskId: string
): Promise<CommandResult<void>> {
  logger.transcriptionInfo("Cancelling transcription", { taskId });
  
  try {
    await invoke("cancel_transcription", { taskId });
    logger.transcriptionInfo("Transcription cancelled", { taskId });
    return { success: true };
  } catch (error) {
    logger.transcriptionError("Failed to cancel transcription", { taskId, error: String(error) });
    return { success: false, error: String(error) };
  }
}

/**
 * Get the current task queue status
 */
export async function getQueueStatus(): Promise<
  CommandResult<{ running: number; queued: number }>
> {
  try {
    const data = await invoke<{ running: number; queued: number }>(
      "get_queue_status"
    );
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Test the Python engine connection
 */
export async function testPythonEngine(): Promise<CommandResult<string>> {
  try {
    const output = await invoke<string>("run_python_engine");
    return { success: true, data: output };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Check if CUDA is available
 */
export async function checkCudaAvailable(): Promise<CommandResult<boolean>> {
  try {
    const available = await invoke<boolean>("check_cuda_available");
    return { success: true, data: available };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Subscribe to progress updates
 */
export async function onProgressUpdate(
  callback: (event: ProgressEvent) => void
): Promise<UnlistenFn> {
  return listen<ProgressEvent>("progress-update", (event) => {
    callback(event.payload);
  });
}

/**
 * Subscribe to transcription complete events
 */
export async function onTranscriptionComplete(
  callback: (taskId: string, result: TranscriptionResult) => void
): Promise<UnlistenFn> {
  return listen<{ taskId: string; result: TranscriptionResult }>(
    "transcription-complete",
    (event) => {
      callback(event.payload.taskId, event.payload.result);
    }
  );
}

/**
 * Subscribe to transcription error events
 */
export async function onTranscriptionError(
  callback: (taskId: string, error: string) => void
): Promise<UnlistenFn> {
  return listen<{ taskId: string; error: string }>(
    "transcription-error",
    (event) => {
      callback(event.payload.taskId, event.payload.error);
    }
  );
}

/**
 * Subscribe to streaming segment events
 * Emitted as each transcription segment is completed during processing
 */
export async function onSegmentUpdate(
  callback: (event: { taskId: string; segment: SegmentEvent }) => void
): Promise<UnlistenFn> {
  return listen<{ taskId: string; segment: SegmentEvent }>(
    "segment-update",
    (event) => {
      callback(event.payload);
    }
  );
}

/**
 * Get metadata for multiple files including size
 */
export async function getFilesMetadata(filePaths: string[]): Promise<CommandResult<FileMetadata[]>> {
  try {
    const metadata = await invoke<FileMetadata[]>("get_files_metadata", {
      filePaths,
    });
    return { success: true, data: metadata };
  } catch (error) {
    logger.error("Failed to get file metadata", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

/**
 * Open a file dialog for selecting media files using tauri-plugin-dialog
 * Returns file paths with metadata (including size)
 */
export async function selectMediaFiles(): Promise<CommandResult<FileMetadata[]>> {
  try {
    const selected = await open({
      multiple: true,
      filters: [
        {
          name: "Media Files",
          extensions: ["mp3", "mp4", "wav", "m4a", "flac", "ogg", "webm", "mov", "avi", "mkv"],
        },
        {
          name: "Audio Files",
          extensions: ["mp3", "wav", "m4a", "flac", "ogg"],
        },
        {
          name: "Video Files",
          extensions: ["mp4", "webm", "mov", "avi", "mkv"],
        },
        {
          name: "All Files",
          extensions: ["*"],
        },
      ],
    });

    if (selected === null) {
      return { success: true, data: [] };
    }

    const filePaths = Array.isArray(selected) ? selected : [selected];

    // Fetch metadata including file sizes from Rust backend
    const metadataResult = await getFilesMetadata(filePaths);
    if (!metadataResult.success || !metadataResult.data) {
      return { success: false, error: metadataResult.error || "Failed to get file metadata" };
    }

    return { success: true, data: metadataResult.data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Open a directory dialog for selecting output directory
 */
export async function selectOutputDirectory(): Promise<CommandResult<string | null>> {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
    });

    return { success: true, data: selected };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Open a save dialog for exporting transcription
 */
export async function selectExportPath(
  defaultName: string,
  format: "txt" | "srt" | "vtt" | "json" | "md"
): Promise<CommandResult<string | null>> {
  const formatLabels: Record<string, string> = {
    txt: "Text Files",
    srt: "Subtitle Files",
    vtt: "WebVTT Files",
    json: "JSON Files",
    md: "Markdown Files",
  };

  try {
    const selected = await save({
      filters: [
        {
          name: formatLabels[format] || format.toUpperCase(),
          extensions: [format],
        },
        {
          name: "All Files",
          extensions: ["*"],
        },
      ],
      defaultPath: defaultName,
    });

    return { success: true, data: selected };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Export transcription to file
 */
export async function exportTranscription(
  result: TranscriptionResult,
  format: "txt" | "srt" | "vtt" | "json" | "md",
  outputPath: string,
  exportMode: ExportMode = "with_timestamps"
): Promise<CommandResult<void>> {
  try {
    await invoke("export_transcription", {
      result,
      format,
      outputPath,
      exportMode,
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Get models directory
 */
export async function getModelsDir(): Promise<CommandResult<string>> {
  try {
    const dir = await invoke<string>("get_models_dir_command");
    return { success: true, data: dir };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Download a model
 */
export async function downloadModel(
  modelName: string,
  modelType: string,
  huggingFaceToken?: string | null
): Promise<CommandResult<string>> {
  logger.modelInfo("Starting model download", { modelName, modelType });
  
  try {
    const result = await invoke<string>("download_model", {
      modelName,
      modelType,
      huggingFaceToken: huggingFaceToken || null,
    });
    logger.modelInfo("Model download started", { modelName });
    return { success: true, data: result };
  } catch (error) {
    logger.modelError("Failed to download model", { modelName, error: String(error) });
    return { success: false, error: String(error) };
  }
}

/**
 * Get list of installed models
 */
export async function getLocalModels(): Promise<CommandResult<LocalModel[]>> {
  try {
    const models = await invoke<LocalModel[]>("get_local_models");
    return { success: true, data: models };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Save HuggingFace token to backend store
 */
export async function saveHuggingFaceToken(token: string): Promise<CommandResult<void>> {
  try {
    await invoke("save_huggingface_token", { token });
    return { success: true };
  } catch (error) {
    logger.error("Failed to save HuggingFace token", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

/**
 * Get HuggingFace token from backend store
 */
export async function getHuggingFaceToken(): Promise<CommandResult<string | null>> {
  try {
    const token = await invoke<string | null>("get_huggingface_token_command");
    return { success: true, data: token };
  } catch (error) {
    logger.error("Failed to get HuggingFace token", { error: String(error) });
    return { success: false, error: String(error), data: null };
  }
}

/**
 * Delete a model
 */
export async function deleteModel(modelName: string): Promise<CommandResult<void>> {
  try {
    await invoke("delete_model", { modelName });
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Open models directory in system file manager
 */
export async function openModelsFolder(): Promise<CommandResult<void>> {
  try {
    await invoke("open_models_folder_command");
    return { success: true };
  } catch (error) {
    console.error("Failed to open models folder:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * Get disk usage
 */
export async function getDiskUsage(): Promise<CommandResult<DiskUsage>> {
  try {
    const usage = await invoke<any>("get_disk_usage");

    // Normalize backend response to match frontend DiskUsage interface
    // Backend may return snake_case (total_size_mb) or camelCase - handle both
    const normalized: DiskUsage = {
      totalSizeMb:
        typeof usage?.totalSizeMb === "number"
          ? usage.totalSizeMb
          : typeof usage?.total_size_mb === "number"
          ? usage.total_size_mb
          : 0,
      freeSpaceMb:
        typeof usage?.freeSpaceMb === "number"
          ? usage.freeSpaceMb
          : typeof usage?.free_space_mb === "number"
          ? usage.free_space_mb
          : 0,
    };

    return { success: true, data: normalized };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Save selected model
 */
export async function saveSelectedModel(model: string): Promise<CommandResult<void>> {
  try {
    await invoke("save_selected_model", { model });
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Load selected model
 */
export async function loadSelectedModel(): Promise<CommandResult<string | null>> {
  try {
    const model = await invoke<string | null>("load_selected_model");
    return { success: true, data: model };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Subscribe to model download progress events
 */
export async function onModelDownloadProgress(
  callback: (progress: ModelDownloadProgress) => void
): Promise<UnlistenFn> {
  return listen<ModelDownloadProgress>("model-download-progress", (event) => {
    callback(event.payload);
  });
}

/**
 * Subscribe to model download complete events
 */
export async function onModelDownloadComplete(
  callback: (modelName: string) => void
): Promise<UnlistenFn> {
  return listen<{ modelName: string }>("model-download-complete", (event) => {
    callback(event.payload.modelName);
  });
}

/**
 * Subscribe to model download error events
 */
export async function onModelDownloadError(
  callback: (modelName: string, error: string) => void
): Promise<UnlistenFn> {
  return listen<{ modelName: string; error: string }>(
    "model-download-error",
    (event) => {
      callback(event.payload.modelName, event.payload.error);
    }
  );
}

/**
 * Subscribe to model download stage progress events
 */
export async function onModelDownloadStage(
  callback: (stage: ModelDownloadStageEvent) => void
): Promise<UnlistenFn> {
  return listen<ModelDownloadStageEvent>("model-download-stage", (event) => {
    callback(event.payload);
  });
}

/**
 * Subscribe to model download stage complete events
 */
export async function onModelDownloadStageComplete(
  callback: (modelName: string, stage: string) => void
): Promise<UnlistenFn> {
  return listen<{ modelName: string; stage: string }>(
    "model-download-stage-complete",
    (event) => {
      callback(event.payload.modelName, event.payload.stage);
    }
  );
}

/**
 * Subscribe to backend log events
 */
export async function onBackendLogs(
  callback: (logEvent: {
    level: string;
    category: string;
    message: string;
    data?: any;
    taskId?: string;
    fileName?: string;
  }) => void
): Promise<UnlistenFn> {
  return listen("backend-log", (event) => {
    const payload = event.payload as {
      level: string;
      category: string;
      message: string;
      data?: any;
      taskId?: string;
      fileName?: string;
    };
    handleBackendLog(payload);
    callback(payload);
  });
}

/**
 * Cancel a model download
 */
export async function cancelModelDownload(
  modelName: string
): Promise<CommandResult<void>> {
  try {
    await invoke("cancel_model_download", { modelName });
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Convert a local file path to a Tauri asset URL that can be loaded in the webview
 * This is required because Tauri blocks direct access to file:// URLs for security
 */
export function getAssetUrl(filePath: string): string {
  return convertFileSrc(filePath);
}

/**
 * Get available compute devices (CPU, CUDA, MPS)
 * Returns list of available devices and the recommended one
 */
export async function getAvailableDevices(): Promise<CommandResult<DevicesResponse>> {
  try {
    const response = await invoke<DevicesResponse>("get_available_devices");
    logger.info("Detected compute devices", { 
      devices: response.devices.map(d => `${d.name} (${d.type})`).join(", "),
      recommended: response.recommended?.name 
    });
    return { success: true, data: response };
  } catch (error) {
    logger.error("Failed to get available devices", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

/**
 * Subscribe to device detection events
 * Emitted when devices are re-detected (e.g., GPU hot-plug)
 */
export async function onDevicesDetected(
  callback: (response: DevicesResponse) => void
): Promise<UnlistenFn> {
  return listen<DevicesResponse>("devices-detected", (event) => {
    callback(event.payload);
  });
}

/**
 * Read a file as Base64 encoded string
 * This is used for loading media files into WaveSurfer.js which cannot fetch from Tauri asset URLs
 */
export async function readFileAsBase64(filePath: string): Promise<CommandResult<string>> {
  try {
    const base64 = await invoke<string>("read_file_as_base64", { filePath });
    return { success: true, data: base64 };
  } catch (error) {
    logger.error("Failed to read file as base64", { filePath, error: String(error) });
    return { success: false, error: String(error) };
  }
}

/**
 * FFmpeg status types
 */
export type FFmpegStatus =
  | { tag: "NotInstalled" }
  | { tag: "Installed"; path: string }
  | { tag: "Downloading" }
  | { tag: "Extracting" }
  | { tag: "Completed" }
  | { tag: "Failed"; error: string };

export interface FFmpegProgress {
  currentBytes: number;
  totalBytes: number;
  percent: number;
  status: string;
}

export interface FFmpegStatusEvent {
  status: string;
  message: string;
}

/**
 * Check FFmpeg installation status
 */
export async function getFFmpegStatus(): Promise<CommandResult<FFmpegStatus>> {
  try {
    const result = await invoke<{ status: string; path?: string }>("get_ffmpeg_status");
    
    if (result.status === "installed" && result.path) {
      return { success: true, data: { tag: "Installed", path: result.path } };
    } else {
      return { success: true, data: { tag: "NotInstalled" } };
    }
  } catch (error) {
    logger.error("Failed to check FFmpeg status", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

/**
 * Start FFmpeg download
 */
export async function downloadFFmpeg(): Promise<CommandResult<void>> {
  try {
    await invoke("download_ffmpeg");
    return { success: true };
  } catch (error) {
    logger.error("Failed to download FFmpeg", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

/**
 * Subscribe to FFmpeg download progress events
 */
export async function onFFmpegProgress(
  callback: (progress: FFmpegProgress) => void
): Promise<UnlistenFn> {
  return listen<FFmpegProgress>("ffmpeg-download-progress", (event) => {
    callback(event.payload);
  });
}

/**
 * Subscribe to FFmpeg status events
 */
export async function onFFmpegStatus(
  callback: (status: FFmpegStatusEvent) => void
): Promise<UnlistenFn> {
  return listen<FFmpegStatusEvent>("ffmpeg-status", (event) => {
    callback(event.payload);
  });
}

// ============================================
// Setup Wizard API Functions
// ============================================

/**
 * Check Python environment
 * Returns Python version, PyTorch status, and acceleration availability
 */
export async function checkPythonEnvironment(): Promise<CommandResult<PythonCheckResult>> {
  try {
    const result = await invoke<PythonCheckResult>("check_python_environment");
    logger.info("Python environment checked", {
      version: result.version,
      pytorchInstalled: result.pytorchInstalled,
      cudaAvailable: result.cudaAvailable,
      mpsAvailable: result.mpsAvailable
    });
    return { success: true, data: result };
  } catch (error) {
    logger.error("Failed to check Python environment", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

/**
 * Check FFmpeg installation status
 */
export async function checkFFmpegStatus(): Promise<CommandResult<FFmpegCheckResult>> {
  try {
    const result = await invoke<FFmpegCheckResult>("check_ffmpeg_status");
    logger.info("FFmpeg status checked", {
      installed: result.installed,
      version: result.version
    });
    return { success: true, data: result };
  } catch (error) {
    logger.error("Failed to check FFmpeg status", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

/**
 * Check AI models status
 */
export async function checkModelsStatus(): Promise<CommandResult<ModelCheckResult>> {
  try {
    const result = await invoke<ModelCheckResult>("check_models_status");
    logger.info("Models status checked", {
      installedCount: result.installedModels.length,
      hasRequiredModel: result.hasRequiredModel
    });
    return { success: true, data: result };
  } catch (error) {
    logger.error("Failed to check models status", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

/**
 * Get complete environment status
 * Returns all checks in a single call
 */
export async function getEnvironmentStatus(): Promise<CommandResult<EnvironmentStatus>> {
  try {
    const result = await invoke<EnvironmentStatus>("get_environment_status");
    logger.info("Environment status retrieved");
    return { success: true, data: result };
  } catch (error) {
    logger.error("Failed to get environment status", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

/**
 * Check if setup wizard has been completed
 */
export async function isSetupComplete(): Promise<CommandResult<boolean>> {
  try {
    const result = await invoke<boolean>("is_setup_complete");
    return { success: true, data: result };
  } catch (error) {
    logger.error("Failed to check setup status", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

/**
 * Mark setup wizard as completed
 */
export async function markSetupComplete(): Promise<CommandResult<void>> {
  try {
    await invoke("mark_setup_complete");
    logger.info("Setup marked as complete");
    return { success: true };
  } catch (error) {
    logger.error("Failed to mark setup complete", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

/**
 * Reset setup wizard status
 * Allows the wizard to be shown again on next launch
 */
export async function resetSetup(): Promise<CommandResult<void>> {
  try {
    await invoke("reset_setup");
    logger.info("Setup status reset");
    return { success: true };
  } catch (error) {
    logger.error("Failed to reset setup", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

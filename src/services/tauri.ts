export * from "./tauri";

export type { CommandResult } from "./tauri/core";
export { handleBackendLog } from "./tauri/log-handler";
export { startTranscription, cancelTranscription, getQueueStatus, testPythonEngine, checkCudaAvailable } from "./tauri/transcription-commands";
export { downloadModel, getLocalModels, saveHuggingFaceToken, getHuggingFaceToken, deleteModel, openModelsFolder, getDiskUsage, clearCache, saveSelectedModel, loadSelectedModel, cancelModelDownload } from "./tauri/model-commands";
export type { ModelDownloadProgress, ModelDownloadStageEvent } from "./tauri/model-commands";
export { getAvailableDevices, getFFmpegStatus, downloadFFmpeg } from "./tauri/device-commands";
export type { FFmpegStatus, FFmpegProgress, FFmpegStatusEvent } from "./tauri/device-commands";
export { getFilesMetadata, selectMediaFiles, selectOutputDirectory, selectExportPath, exportTranscription, getModelsDir, getAssetUrl, readFileAsBase64 } from "./tauri/dialog-commands";
export { onProgressUpdate, onTranscriptionComplete, onTranscriptionError, onSegmentUpdate, onModelDownloadProgress, onModelDownloadComplete, onModelDownloadError, onModelDownloadRetrying, onModelDownloadStage, onModelDownloadStageComplete, onBackendLogs, onDevicesDetected, onFFmpegProgress, onFFmpegStatus } from "./tauri/events";
export { checkPythonEnvironment, checkFFmpegStatus, checkModelsStatus, getEnvironmentStatus, checkRuntimeReadiness, isSetupComplete, markSetupComplete, resetSetup, installPythonFull, checkPythonInstalled, getPythonInstallProgress, cancelPythonInstall, onPythonInstallProgress } from "./tauri/setup-commands";
export type { InstallProgress } from "./tauri/setup-commands";
export { getFileSize, deleteFile, convertToMp3, getArchiveDir } from "./tauri/archive-commands";

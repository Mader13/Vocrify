export * from "./tauri";

export type { CommandResult } from "./tauri/core";
export { handleBackendLog } from "./tauri/log-handler";
export { startTranscription, cancelTranscription, getQueueStatus, testPythonEngine, checkCudaAvailable, loadModelRust, transcribeRust, initTranscriptionManager } from "./tauri/transcription-commands";
export type { RustTranscriptionOptions, RustTranscriptionResult } from "./tauri/transcription-commands";
export { downloadModel, getLocalModels, deleteModel, openModelsFolder, setModelsDir, getDiskUsage, clearCache, saveSelectedModel, loadSelectedModel, cancelModelDownload } from "./tauri/model-commands";
export type { ModelDownloadProgress, ModelDownloadStageEvent } from "./tauri/model-commands";
export { getAvailableDevices, getFFmpegStatus, downloadFFmpeg } from "./tauri/device-commands";
export type { FFmpegStatus, FFmpegProgress, FFmpegStatusEvent } from "./tauri/device-commands";
export { getFilesMetadata, selectMediaFiles, selectOutputDirectory, selectExportPath, exportTranscription, getModelsDir, getAssetUrl, readFileAsBase64, readFileAsArrayBuffer, generateWaveformPeaks } from "./tauri/dialog-commands";
export { onProgressUpdate, onTranscriptionComplete, onTranscriptionError, onSegmentUpdate, onModelDownloadProgress, onModelDownloadComplete, onModelDownloadError, onModelDownloadRetrying, onModelDownloadStage, onModelDownloadStageComplete, onModelsDirMoveProgress, onBackendLogs, onDevicesDetected, onFFmpegProgress, onFFmpegStatus } from "./tauri/events";
export { checkPythonEnvironment, checkFFmpegStatus, checkModelsStatus, getEnvironmentStatus, checkRuntimeReadiness, isSetupComplete, isSetupCompleteFast, markSetupComplete, resetSetup, installPythonFull, checkPythonInstalled, getPythonInstallProgress, cancelPythonInstall, onPythonInstallProgress } from "./tauri/setup-commands";
export type { InstallProgress } from "./tauri/setup-commands";
export { getFileSize, deleteFile, copyFile, compressMedia, convertToMp3, getArchiveDir, openArchiveFolder } from "./tauri/archive-commands";
export { getAppVersion, openAppDirectory } from "./tauri/app-commands";
export { getPerformanceConfig, updatePerformanceConfig } from "./tauri/performance-commands";
export type { PerformanceConfig } from "@/types/settings";

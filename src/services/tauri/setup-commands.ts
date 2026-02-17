import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import type {
  PythonCheckResult,
  FFmpegCheckResult,
  ModelCheckResult,
  EnvironmentStatus,
  RuntimeReadinessStatus,
} from "@/types/setup";
import { logger } from "@/lib/logger";
import type { CommandResult } from "./core";

export interface InstallProgress {
  stage: "idle" | "checking" | "downloadingPython" | "extractingPython" | "installingPip" | "installingPytorch" | "installingDependencies" | "complete" | "error";
  percent: number;
  message: string;
  error?: string;
}

export async function checkPythonEnvironment(): Promise<CommandResult<PythonCheckResult>> {
  try {
    const result = await invoke<PythonCheckResult>("check_python_environment");
    logger.info("Python environment checked", {
      version: result.version,
      pytorchInstalled: result.pytorchInstalled,
      cudaAvailable: result.cudaAvailable,
      mpsAvailable: result.mpsAvailable,
    });
    return { success: true, data: result };
  } catch (error) {
    logger.error("Failed to check Python environment", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function checkFFmpegStatus(): Promise<CommandResult<FFmpegCheckResult>> {
  try {
    const result = await invoke<FFmpegCheckResult>("check_ffmpeg_status");
    logger.info("FFmpeg status checked", {
      installed: result.installed,
      version: result.version,
    });
    return { success: true, data: result };
  } catch (error) {
    logger.error("Failed to check FFmpeg status", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function checkModelsStatus(): Promise<CommandResult<ModelCheckResult>> {
  try {
    const result = await invoke<ModelCheckResult>("check_models_status");
    logger.info("Models status checked", {
      installedCount: result.installedModels.length,
      hasRequiredModel: result.hasRequiredModel,
    });
    return { success: true, data: result };
  } catch (error) {
    logger.error("Failed to check models status", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

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

export async function checkRuntimeReadiness(): Promise<CommandResult<RuntimeReadinessStatus>> {
  try {
    const result = await invoke<RuntimeReadinessStatus>("check_runtime_readiness");
    logger.info("Runtime readiness checked", {
      ready: result.ready,
      pythonReady: result.pythonReady,
      ffmpegReady: result.ffmpegReady,
    });
    return { success: true, data: result };
  } catch (error) {
    logger.error("Failed to check runtime readiness", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function isSetupComplete(): Promise<CommandResult<boolean>> {
  try {
    const result = await invoke<boolean>("is_setup_complete");
    return { success: true, data: result };
  } catch (error) {
    logger.error("Failed to check setup status", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function isSetupCompleteFast(): Promise<CommandResult<boolean>> {
  try {
    const result = await invoke<boolean>("is_setup_complete_fast");
    logger.info("Fast setup check completed", { isComplete: result });
    return { success: true, data: result };
  } catch (error) {
    logger.error("Failed to check setup status (fast path)", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

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

export async function checkPythonInstalled(): Promise<CommandResult<boolean>> {
  try {
    const result = await invoke<boolean>("check_python_installed");
    logger.info("Python installation check", { installed: result });
    return { success: true, data: result };
  } catch (error) {
    logger.error("Failed to check Python installation", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function installPythonFull(): Promise<CommandResult<void>> {
  try {
    logger.info("Starting Python installation");
    await invoke("install_python_full");
    logger.info("Python installation completed");
    return { success: true };
  } catch (error) {
    logger.error("Failed to install Python", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

export async function getPythonInstallProgress(): Promise<CommandResult<InstallProgress>> {
  try {
    const result = await invoke<InstallProgress>("get_python_install_progress");
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function cancelPythonInstall(): Promise<CommandResult<void>> {
  try {
    await invoke("cancel_python_install");
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export function onPythonInstallProgress(
  callback: (progress: InstallProgress) => void
): Promise<UnlistenFn> {
  return listen<InstallProgress>("python-install-progress", (event) => {
    callback(event.payload);
  });
}

/**
 * Setup Wizard Store
 * Manages state for the First-Launch Setup Wizard
 */

import { create } from "zustand";
import type {
  SetupStep,
  PythonCheckResult,
  FFmpegCheckResult,
  ModelCheckResult,
  DeviceCheckResult,
  RuntimeReadinessStatus,
} from "@/types/setup";
import { logger } from "@/lib/logger";
import {
  checkPythonEnvironment,
  checkFFmpegStatus,
  checkModelsStatus,
  isSetupComplete,
  isSetupCompleteFast,
  markSetupComplete,
  resetSetup as apiResetSetup,
  getAvailableDevices,
  downloadFFmpeg,
  onFFmpegProgress,
  onFFmpegStatus,
  type FFmpegProgress,
} from "@/services/tauri";

interface SetupStore {
  // Navigation state
  currentStep: SetupStep;
  isComplete: boolean;
  isChecking: boolean;

  // Check results
  pythonCheck: PythonCheckResult | null;
  ffmpegCheck: FFmpegCheckResult | null;
  deviceCheck: DeviceCheckResult | null;
  modelCheck: ModelCheckResult | null;
  runtimeReadiness: RuntimeReadinessStatus | null;

  // FFmpeg installation progress
  ffmpegProgress: FFmpegProgress | null;
  ffmpegInstallStatus: "idle" | "downloading" | "extracting" | "completed" | "failed";

  // Error state
  error: string | null;

  // Actions - Checks
  checkAll: () => Promise<void>;
  checkPython: () => Promise<void>;
  checkFFmpeg: () => Promise<void>;
  checkDevice: () => Promise<void>;
  checkModel: () => Promise<void>;
  installFFmpeg: () => Promise<void>;

  // Actions - Device Detection (deferred/on-demand)
  fetchDevices: (forceRefresh?: boolean) => Promise<void>;

  // Actions - Navigation
  nextStep: () => void;
  prevStep: () => void;
  goToStep: (step: SetupStep) => void;

  // Actions - Completion
  completeSetup: () => Promise<void>;
  skipSetup: () => void;
  resetSetupState: () => Promise<void>;

  // Actions - Initialization
  initialize: () => Promise<void>;
  backgroundValidate: () => Promise<void>;
}

const STEPS: SetupStep[] = ["python", "ffmpeg", "device", "model", "summary"];

const initialState = {
  currentStep: "python" as SetupStep,
  isComplete: false,
  isChecking: false,
  pythonCheck: null as PythonCheckResult | null,
  ffmpegCheck: null as FFmpegCheckResult | null,
  deviceCheck: null as DeviceCheckResult | null,
  modelCheck: null as ModelCheckResult | null,
  runtimeReadiness: null as RuntimeReadinessStatus | null,
  ffmpegProgress: null as FFmpegProgress | null,
  ffmpegInstallStatus: "idle" as "idle" | "downloading" | "extracting" | "completed" | "failed",
  error: null as string | null,
};

function failedPythonCheck(message: string): PythonCheckResult {
  return {
    status: "error",
    version: null,
    executable: null,
    inVenv: false,
    message,
  };
}

function failedFFmpegCheck(message: string): FFmpegCheckResult {
  return {
    status: "error",
    installed: false,
    path: null,
    version: null,
    message,
  };
}

function failedDeviceCheck(message: string): DeviceCheckResult {
  return {
    status: "error",
    devices: [],
    recommended: null,
    message,
  };
}

function failedModelCheck(message: string): ModelCheckResult {
  return {
    status: "error",
    installedModels: [],
    hasRequiredModel: false,
    message,
  };
}

function buildRuntimeReadiness(
  pythonCheck: PythonCheckResult,
  ffmpegCheck: FFmpegCheckResult
): RuntimeReadinessStatus {
  const pythonReady = pythonCheck.status === "ok";
  const ffmpegReady = ffmpegCheck.installed && ffmpegCheck.status !== "error";
  // Python is optional for basic transcription, so we only strictly require FFmpeg
  const ready = ffmpegReady;

  return {
    ready,
    pythonReady,
    ffmpegReady,
    pythonMessage: pythonCheck.message,
    ffmpegMessage: ffmpegCheck.message,
    message: ready
      ? "Runtime ready"
      : "Runtime is not ready: FFmpeg is missing",
    checkedAt: new Date().toISOString(),
  };
}

export const useSetupStore = create<SetupStore>()((set, get) => ({
  ...initialState,

  initialize: async () => {
    const { isChecking, isComplete } = get();

    if (isComplete || isChecking) {
      return;
    }

    set({ isChecking: true });
    try {
      // Use fast-path check with 7-day TTL cache
      const result = await isSetupCompleteFast();
      if (result.success && result.data) {
        set({ isComplete: true });
      }
    } catch (error) {
      logger.error("Failed to check setup status", { error: String(error) });
    } finally {
      set({ isChecking: false });
    }
  },

  backgroundValidate: async () => {
    const { isComplete } = get();

    // Skip background validation if setup is not complete
    if (!isComplete) {
      return;
    }

    logger.info("Running background setup validation");
    try {
      const result = await isSetupComplete();
      if (result.success && result.data) {
        logger.info("Background validation: setup still complete");
      } else {
        logger.warn("Background validation: setup no longer complete, showing wizard");
        set({ isComplete: false });
      }
    } catch (error) {
      logger.error("Background validation failed", { error: String(error) });
      // Don't change state on error - assume still complete
    }
  },

  checkAll: async () => {
    const { isChecking } = get();
    if (isChecking) {
      return;
    }

    set({ isChecking: true, error: null });
    logger.info("Running all setup checks (excluding devices - call fetchDevices separately)");

    try {
      const [pythonResult, ffmpegResult, modelsResult] =
        await Promise.all([
          checkPythonEnvironment(),
          checkFFmpegStatus(),
          checkModelsStatus(),
        ]);

      const pythonCheck: PythonCheckResult =
        pythonResult.success && pythonResult.data
          ? pythonResult.data
          : failedPythonCheck(pythonResult.error || "Failed to check Python");

      const ffmpegCheck: FFmpegCheckResult =
        ffmpegResult.success && ffmpegResult.data
          ? ffmpegResult.data
          : failedFFmpegCheck(ffmpegResult.error || "Failed to check FFmpeg");

      const modelCheck: ModelCheckResult =
        modelsResult.success && modelsResult.data
          ? modelsResult.data
          : failedModelCheck(modelsResult.error || "Failed to check models");

      const runtimeReadiness = buildRuntimeReadiness(pythonCheck, ffmpegCheck);

      set({
        pythonCheck,
        ffmpegCheck,
        modelCheck,
        runtimeReadiness,
        isChecking: false,
      });

      logger.info("All setup checks completed", {
        python: pythonCheck.status,
        ffmpeg: ffmpegCheck.status,
        model: modelCheck.status,
        runtimeReady: runtimeReadiness.ready,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      set({ error: errorMessage, isChecking: false });
      logger.error("Failed to run setup checks", { error: errorMessage });
    }
  },

  checkPython: async () => {
    logger.info("Checking Python environment");
    try {
      const result = await checkPythonEnvironment();
      if (result.success && result.data) {
        set({ pythonCheck: result.data });
      } else {
        set({
          pythonCheck: failedPythonCheck(result.error || "Check failed"),
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Check failed";
      set({ pythonCheck: failedPythonCheck(errorMessage) });
      logger.error("Python check failed", { error: errorMessage });
    }
  },

  checkFFmpeg: async () => {
    logger.info("Checking FFmpeg");
    try {
      const result = await checkFFmpegStatus();
      if (result.success && result.data) {
        set({ ffmpegCheck: result.data });
      } else {
        set({ ffmpegCheck: failedFFmpegCheck(result.error || "Check failed") });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Check failed";
      set({ ffmpegCheck: failedFFmpegCheck(errorMessage) });
      logger.error("FFmpeg check failed", { error: errorMessage });
    }
  },

  installFFmpeg: async () => {
    logger.info("Installing FFmpeg automatically");
    set({ isChecking: true, error: null, ffmpegInstallStatus: "downloading", ffmpegProgress: null });

    // Listen to progress events
    const unlistenProgress = onFFmpegProgress((progress) => {
      logger.debug("FFmpeg download progress", progress);
      set({ ffmpegProgress: progress });
    });

    // Listen to status events
    const unlistenStatus = onFFmpegStatus((event) => {
      logger.debug("FFmpeg status event", event);
      switch (event.status) {
        case "downloading":
          set({ ffmpegInstallStatus: "downloading" });
          break;
        case "extracting":
          set({ ffmpegInstallStatus: "extracting" });
          break;
        case "completed":
          set({ ffmpegInstallStatus: "completed" });
          break;
        case "failed":
          set({
            ffmpegInstallStatus: "failed",
            ffmpegCheck: failedFFmpegCheck(event.message),
            isChecking: false,
          });
          break;
      }
    });

    try {
      const result = await downloadFFmpeg();
      if (result.success) {
        logger.info("FFmpeg downloaded successfully, verifying...");
        await get().checkFFmpeg();
        const isInstalled = Boolean(get().ffmpegCheck?.installed && get().ffmpegCheck?.status === "ok");
        set({
          isChecking: false,
          ffmpegInstallStatus: isInstalled ? "completed" : "failed",
        });
      } else {
        set({
          ffmpegCheck: failedFFmpegCheck(result.error || "Download failed"),
          isChecking: false,
          ffmpegInstallStatus: "failed",
        });
        logger.error("FFmpeg download failed", { error: result.error });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Install failed";
      set({
        ffmpegCheck: failedFFmpegCheck(errorMessage),
        isChecking: false,
        ffmpegInstallStatus: "failed",
      });
      logger.error("FFmpeg install failed", { error: errorMessage });
    } finally {
      // Clean up listeners
      unlistenProgress.then((f) => f?.()).catch((err) =>
        logger.error("Failed to unlisten FFmpeg progress", { error: String(err) })
      );
      unlistenStatus.then((f) => f?.()).catch((err) =>
        logger.error("Failed to unlisten FFmpeg status", { error: String(err) })
      );
    }
  },

  checkDevice: async () => {
    logger.info("Checking compute devices (using cache)");
    try {
      const result = await getAvailableDevices(false); // Use cache by default
      if (result.success && result.data) {
        const devices = result.data.devices;
        set({
          deviceCheck: {
            status: "ok",
            devices,
            recommended: result.data.recommended || null,
            message: `Devices found: ${devices.filter((d) => d.available).length}`,
          },
        });
      } else {
        set({
          deviceCheck: failedDeviceCheck(result.error || "Check failed"),
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Check failed";
      set({ deviceCheck: failedDeviceCheck(errorMessage) });
      logger.error("Device check failed", { error: errorMessage });
    }
  },

  checkModel: async () => {
    logger.info("Checking AI models");
    try {
      const result = await checkModelsStatus();
      if (result.success && result.data) {
        set({ modelCheck: result.data });
      } else {
        set({ modelCheck: failedModelCheck(result.error || "Check failed") });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Check failed";
      set({ modelCheck: failedModelCheck(errorMessage) });
      logger.error("Model check failed", { error: errorMessage });
    }
  },

  /**
   * On-demand device detection
   * @param forceRefresh - If true, bypass cache and re-detect devices
   *
   * Device detection is deferred until the user opens Settings or Setup Wizard.
   * This avoids expensive PyTorch imports during app initialization.
   * Results are cached in the Rust backend for the app session.
   */
  fetchDevices: async (forceRefresh = false) => {
    logger.info("Fetching compute devices", { forceRefresh });
    try {
      const result = await getAvailableDevices(forceRefresh);
      if (result.success && result.data) {
        const devices = result.data.devices;
        set({
          deviceCheck: {
            status: "ok",
            devices,
            recommended: result.data.recommended || null,
            message: `Devices found: ${devices.filter((d) => d.available).length}`,
          },
        });
      } else {
        set({
          deviceCheck: failedDeviceCheck(result.error || "Check failed"),
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Check failed";
      set({ deviceCheck: failedDeviceCheck(errorMessage) });
      logger.error("Device detection failed", { error: errorMessage });
    }
  },

  nextStep: () => {
    const { currentStep } = get();
    const currentIndex = STEPS.indexOf(currentStep);
    if (currentIndex < STEPS.length - 1) {
      set({ currentStep: STEPS[currentIndex + 1] });
    }
  },

  prevStep: () => {
    const { currentStep } = get();
    const currentIndex = STEPS.indexOf(currentStep);
    if (currentIndex > 0) {
      set({ currentStep: STEPS[currentIndex - 1] });
    }
  },

  goToStep: (step: SetupStep) => {
    set({ currentStep: step });
  },

  completeSetup: async () => {
    logger.info("Completing setup");
    try {
      const { pythonCheck, ffmpegCheck } = get();

      // Python is optional, so we don't block on it failing
      if (!pythonCheck) {
        set({
          isComplete: false,
          error: "Python check not completed",
        });
        return;
      }

      if (!ffmpegCheck || ffmpegCheck.status !== "ok") {
        set({
          isComplete: false,
          error: "FFmpeg check not completed or failed",
        });
        return;
      }

      // Build runtime readiness from cached results
      const readiness = buildRuntimeReadiness(pythonCheck, ffmpegCheck);
      set({ runtimeReadiness: readiness });

      if (!readiness.ready) {
        set({ isComplete: false, error: readiness.message || "Runtime is not ready" });
        return;
      }

      const result = await markSetupComplete();
      if (result.success) {
        set({ isComplete: true, error: null });
      } else {
        set({ isComplete: false, error: result.error || "Failed to complete setup" });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to complete setup";
      set({ isComplete: false, error: errorMessage });
      logger.error("Failed to complete setup", { error: errorMessage });
    }
  },

  skipSetup: () => {
    set({
      isComplete: false,
      error: "Setup cannot be skipped until required runtime dependencies are ready.",
    });
    logger.info("Setup skip blocked: runtime-ready gate is enforced");
  },

  resetSetupState: async () => {
    logger.info("Resetting setup state");
    try {
      const result = await apiResetSetup();
      if (result.success) {
        set(initialState);
      } else {
        set({ error: result.error || "Failed to reset setup" });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to reset setup";
      set({ error: errorMessage });
      logger.error("Failed to reset setup", { error: errorMessage });
    }
  },
}));

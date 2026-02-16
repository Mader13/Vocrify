/**
 * Setup Wizard Store
 * Manages state for the First-Launch Setup Wizard
 */

import { create } from "zustand";
import type {
  SetupStep,
  CheckStatus,
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
  checkRuntimeReadiness,
  isSetupComplete,
  markSetupComplete,
  resetSetup as apiResetSetup,
  getAvailableDevices,
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

  // Error state
  error: string | null;

  // Actions - Checks
  checkAll: () => Promise<void>;
  checkPython: () => Promise<void>;
  checkFFmpeg: () => Promise<void>;
  checkDevice: () => Promise<void>;
  checkModel: () => Promise<void>;

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
}

const STEPS: SetupStep[] = ["python", "ffmpeg", "device", "optional"];

const initialState = {
  currentStep: "python" as SetupStep,
  isComplete: false,
  isChecking: false,
  pythonCheck: null as PythonCheckResult | null,
  ffmpegCheck: null as FFmpegCheckResult | null,
  deviceCheck: null as DeviceCheckResult | null,
  modelCheck: null as ModelCheckResult | null,
  runtimeReadiness: null as RuntimeReadinessStatus | null,
  error: null as string | null,
};

function failedPythonCheck(message: string): PythonCheckResult {
  return {
    status: "error",
    version: null,
    executable: null,
    inVenv: false,
    pytorchInstalled: false,
    pytorchVersion: null,
    cudaAvailable: false,
    mpsAvailable: false,
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
  const ready = pythonReady && ffmpegReady;

  return {
    ready,
    pythonReady,
    ffmpegReady,
    pythonMessage: pythonCheck.message,
    ffmpegMessage: ffmpegCheck.message,
    message: ready
      ? "Runtime ready"
      : "Runtime is not ready: Python and/or FFmpeg are missing",
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
      const result = await isSetupComplete();
      if (result.success && result.data) {
        set({ isComplete: true });
      }
    } catch (error) {
      logger.error("Failed to check setup status", { error: String(error) });
    } finally {
      set({ isChecking: false });
    }
  },

  checkAll: async () => {
    const { isChecking } = get();
    if (isChecking) {
      return;
    }

    set({ isChecking: true, error: null });
    logger.info("Running all setup checks");

    try {
      const [pythonResult, ffmpegResult, devicesResult, modelsResult] =
        await Promise.all([
          checkPythonEnvironment(),
          checkFFmpegStatus(),
          getAvailableDevices(),
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

      const deviceCheck: DeviceCheckResult =
        devicesResult.success && devicesResult.data
          ? {
              status: "ok" as CheckStatus,
              devices: devicesResult.data.devices,
              recommended: devicesResult.data.recommended || null,
              message: `Devices found: ${devicesResult.data.devices.filter((d) => d.available).length}`,
            }
          : failedDeviceCheck(devicesResult.error || "Failed to check devices");

      const modelCheck: ModelCheckResult =
        modelsResult.success && modelsResult.data
          ? modelsResult.data
          : failedModelCheck(modelsResult.error || "Failed to check models");

      const runtimeReadiness = buildRuntimeReadiness(pythonCheck, ffmpegCheck);

      set({
        pythonCheck,
        ffmpegCheck,
        deviceCheck,
        modelCheck,
        runtimeReadiness,
        isChecking: false,
      });

      logger.info("All setup checks completed", {
        python: pythonCheck.status,
        ffmpeg: ffmpegCheck.status,
        device: deviceCheck.status,
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

  checkDevice: async () => {
    logger.info("Checking compute devices");
    try {
      const result = await getAvailableDevices();
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
      const readinessResult = await checkRuntimeReadiness();
      if (!readinessResult.success || !readinessResult.data) {
        set({
          isComplete: false,
          error: readinessResult.error || "Failed to verify runtime readiness",
        });
        return;
      }

      const readiness = readinessResult.data;
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

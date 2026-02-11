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
} from "@/types/setup";
import { logger } from "@/lib/logger";
import {
  checkPythonEnvironment,
  checkFFmpegStatus,
  checkModelsStatus,
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

// Step order for navigation
const STEPS: SetupStep[] = ["python", "ffmpeg", "device", "optional"];

// Initial state
const initialState = {
  currentStep: "python" as SetupStep,
  isComplete: false,
  isChecking: false,
  pythonCheck: null as PythonCheckResult | null,
  ffmpegCheck: null as FFmpegCheckResult | null,
  deviceCheck: null as DeviceCheckResult | null,
  modelCheck: null as ModelCheckResult | null,
  error: null as string | null,
};

export const useSetupStore = create<SetupStore>()((set, get) => ({
  ...initialState,

  /**
   * Initialize store - check if setup was already completed
   */
  initialize: async () => {
    const { isChecking, isComplete } = get();
    
    // Skip if already checked and complete
    if (isComplete) {
      logger.debug("Setup already initialized and complete");
      return;
    }
    
    // Skip if already checking
    if (isChecking) {
      logger.debug("Setup initialization already in progress");
      return;
    }
    
    set({ isChecking: true });
    try {
      const result = await isSetupComplete();
      if (result.success && result.data) {
        set({ isComplete: true });
        logger.info("Setup already completed");
      } else {
        logger.info("Setup not completed, wizard will be shown");
      }
    } catch (error) {
      logger.error("Failed to check setup status", { error: String(error) });
    } finally {
      set({ isChecking: false });
    }
  },

  /**
   * Run all checks in parallel
   */
  checkAll: async () => {
    const { isChecking } = get();
    if (isChecking) {
      logger.info("Checks already in progress, skipping");
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

      // Process Python check
      const pythonCheck: PythonCheckResult = pythonResult.success
        ? pythonResult.data!
        : {
            status: "error" as CheckStatus,
            version: null,
            executable: null,
            inVenv: false,
            pytorchInstalled: false,
            pytorchVersion: null,
            cudaAvailable: false,
            mpsAvailable: false,
            message: pythonResult.error || "Не удалось проверить окружение Python",
          };

      // Process FFmpeg check
      const ffmpegCheck: FFmpegCheckResult = ffmpegResult.success
        ? ffmpegResult.data!
        : {
            status: "error" as CheckStatus,
            installed: false,
            path: null,
            version: null,
            message: ffmpegResult.error || "Не удалось проверить FFmpeg",
          };

      // Process Device check
      const availableDevicesCount = devicesResult.success ? devicesResult.data!.devices.filter(d => d.available).length : 0;
      const deviceCheck: DeviceCheckResult = devicesResult.success
        ? {
            status: "ok" as CheckStatus,
            devices: devicesResult.data!.devices,
            recommended: devicesResult.data!.recommended || null,
            message: `Обнаружено устройств: ${availableDevicesCount}`,
          }
        : {
            status: "error" as CheckStatus,
            devices: [],
            recommended: null,
            message: devicesResult.error || "Не удалось проверить устройства",
          };

      // Process Model check
      const modelCheck: ModelCheckResult = modelsResult.success
        ? modelsResult.data!
        : {
            status: "error" as CheckStatus,
            installedModels: [],
            hasRequiredModel: false,
            message: modelsResult.error || "Не удалось проверить модели",
          };

      set({
        pythonCheck,
        ffmpegCheck,
        deviceCheck,
        modelCheck,
        isChecking: false,
      });

      logger.info("All setup checks completed", {
        python: pythonCheck.status,
        ffmpeg: ffmpegCheck.status,
        device: deviceCheck.status,
        model: modelCheck.status,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      set({ error: errorMessage, isChecking: false });
      logger.error("Failed to run setup checks", { error: errorMessage });
    }
  },

  /**
   * Check Python environment only
   */
  checkPython: async () => {
    logger.info("Checking Python environment");
    try {
      const result = await checkPythonEnvironment();
      if (result.success && result.data) {
        set({ pythonCheck: result.data });
        logger.info("Python check completed", { status: result.data.status });
      } else {
        set({
          pythonCheck: {
            status: "error",
            version: null,
            executable: null,
            inVenv: false,
            pytorchInstalled: false,
            pytorchVersion: null,
            cudaAvailable: false,
            mpsAvailable: false,
            message: result.error || "Check failed",
          },
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Check failed";
      set({
        pythonCheck: {
          status: "error",
          version: null,
          executable: null,
          inVenv: false,
          pytorchInstalled: false,
          pytorchVersion: null,
          cudaAvailable: false,
          mpsAvailable: false,
          message: errorMessage,
        },
      });
      logger.error("Python check failed", { error: errorMessage });
    }
  },

  /**
   * Check FFmpeg installation only
   */
  checkFFmpeg: async () => {
    logger.info("Checking FFmpeg");
    try {
      const result = await checkFFmpegStatus();
      if (result.success && result.data) {
        set({ ffmpegCheck: result.data });
        logger.info("FFmpeg check completed", { status: result.data.status });
      } else {
        set({
          ffmpegCheck: {
            status: "error",
            installed: false,
            path: null,
            version: null,
            message: result.error || "Check failed",
          },
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Check failed";
      set({
        ffmpegCheck: {
          status: "error",
          installed: false,
          path: null,
          version: null,
          message: errorMessage,
        },
      });
      logger.error("FFmpeg check failed", { error: errorMessage });
    }
  },

  /**
   * Check compute devices only
   */
  checkDevice: async () => {
    logger.info("Checking compute devices");
    try {
      const result = await getAvailableDevices();
      if (result.success && result.data) {
        const devices = result.data.devices;
        const availableDevicesCount = devices.filter(d => d.available).length;
        const recommended = result.data.recommended;
        set({
          deviceCheck: {
            status: "ok",
            devices: devices,
            recommended: recommended || null,
            message: `Обнаружено устройств: ${availableDevicesCount}`,
          },
        });
        logger.info("Device check completed", {
          deviceCount: devices.length,
        });
      } else {
        set({
          deviceCheck: {
            status: "error",
            devices: [],
            recommended: null,
            message: result.error || "Check failed",
          },
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Check failed";
      set({
        deviceCheck: {
          status: "error",
          devices: [],
          recommended: null,
          message: errorMessage,
        },
      });
      logger.error("Device check failed", { error: errorMessage });
    }
  },

  /**
   * Check AI models only
   */
  checkModel: async () => {
    logger.info("Checking AI models");
    try {
      const result = await checkModelsStatus();
      if (result.success && result.data) {
        set({ modelCheck: result.data });
        logger.info("Model check completed", { status: result.data.status });
      } else {
        set({
          modelCheck: {
            status: "error",
            installedModels: [],
            hasRequiredModel: false,
            message: result.error || "Check failed",
          },
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Check failed";
      set({
        modelCheck: {
          status: "error",
          installedModels: [],
          hasRequiredModel: false,
          message: errorMessage,
        },
      });
      logger.error("Model check failed", { error: errorMessage });
    }
  },

  /**
   * Navigate to next step
   */
  nextStep: () => {
    const { currentStep } = get();
    const currentIndex = STEPS.indexOf(currentStep);
    if (currentIndex < STEPS.length - 1) {
      const nextStepValue = STEPS[currentIndex + 1];
      set({ currentStep: nextStepValue });
      logger.debug("Setup step changed", { step: nextStepValue });
    }
  },

  /**
   * Navigate to previous step
   */
  prevStep: () => {
    const { currentStep } = get();
    const currentIndex = STEPS.indexOf(currentStep);
    if (currentIndex > 0) {
      const prevStepValue = STEPS[currentIndex - 1];
      set({ currentStep: prevStepValue });
      logger.debug("Setup step changed", { step: prevStepValue });
    }
  },

  /**
   * Navigate to specific step
   */
  goToStep: (step: SetupStep) => {
    set({ currentStep: step });
    logger.debug("Setup step changed", { step });
  },

  /**
   * Mark setup as completed
   */
  completeSetup: async () => {
    logger.info("Completing setup");
    try {
      const result = await markSetupComplete();
      if (result.success) {
        set({ isComplete: true });
        logger.info("Setup marked as complete");
      } else {
        set({ error: result.error || "Failed to complete setup" });
        logger.error("Failed to mark setup complete", { error: result.error });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to complete setup";
      set({ error: errorMessage });
      logger.error("Failed to complete setup", { error: errorMessage });
    }
  },

  /**
   * Skip setup wizard
   */
  skipSetup: () => {
    set({ isComplete: true });
    logger.info("Setup skipped by user");
  },

  /**
   * Reset setup state and allow wizard to be shown again
   */
  resetSetupState: async () => {
    logger.info("Resetting setup state");
    try {
      const result = await apiResetSetup();
      if (result.success) {
        set(initialState);
        logger.info("Setup state reset");
      } else {
        set({ error: result.error || "Failed to reset setup" });
        logger.error("Failed to reset setup", { error: result.error });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to reset setup";
      set({ error: errorMessage });
      logger.error("Failed to reset setup", { error: errorMessage });
    }
  },
}));

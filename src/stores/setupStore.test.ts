import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/tauri", () => ({
  autoInstallPython: vi.fn(),
  cancelSetupStep: vi.fn(),
  checkAndRetryStep: vi.fn(),
  checkFFmpegStatus: vi.fn(),
  checkModelsStatus: vi.fn(),
  checkPythonEnvironment: vi.fn(),
  getAvailableDevices: vi.fn(),
  isSetupComplete: vi.fn(),
  markSetupComplete: vi.fn(),
  onFFmpegInstallProgress: vi.fn().mockResolvedValue(() => {}),
  onPythonInstallProgress: vi.fn().mockResolvedValue(() => {}),
  resetSetup: vi.fn(),
}));

import {
  autoInstallPython,
  cancelSetupStep,
  checkAndRetryStep,
  checkFFmpegStatus,
  checkModelsStatus,
  checkPythonEnvironment,
  getAvailableDevices,
  isSetupComplete,
  markSetupComplete,
  resetSetup,
} from "@/services/tauri";
import { useSetupStore } from "@/stores/setupStore";

const mockedAutoInstallPython = vi.mocked(autoInstallPython);
const mockedCancelSetupStep = vi.mocked(cancelSetupStep);
const mockedCheckAndRetryStep = vi.mocked(checkAndRetryStep);
const mockedCheckFFmpegStatus = vi.mocked(checkFFmpegStatus);
const mockedCheckModelsStatus = vi.mocked(checkModelsStatus);
const mockedCheckPythonEnvironment = vi.mocked(checkPythonEnvironment);
const mockedGetAvailableDevices = vi.mocked(getAvailableDevices);
const mockedIsSetupComplete = vi.mocked(isSetupComplete);
const mockedMarkSetupComplete = vi.mocked(markSetupComplete);
const mockedResetSetup = vi.mocked(resetSetup);

function resetStore() {
  useSetupStore.setState({
    currentStep: "python",
    isComplete: false,
    isChecking: false,
    stepStates: {
      python: "idle",
      ffmpeg: "idle",
      device: "idle",
      optional: "idle",
      summary: "idle",
    },
    isAutoMode: true,
    currentAttempt: 0,
    stepStartTime: 0,
    stepTimeoutMs: 0,
    isPaused: false,
    installProgress: {
      stage: "idle",
      percent: 0,
      message: "Ожидание",
    },
    pythonCheck: null,
    ffmpegCheck: null,
    deviceCheck: null,
    modelCheck: null,
    error: null,
  });
}

describe("setupStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    resetStore();

    mockedIsSetupComplete.mockResolvedValue({ success: true, data: false });
    mockedCheckPythonEnvironment.mockResolvedValue({
      success: true,
      data: {
        status: "ok",
        version: "3.11.9",
        executable: "python",
        inVenv: true,
        pytorchInstalled: true,
        pytorchVersion: "2.5.1",
        cudaAvailable: false,
        mpsAvailable: false,
        message: "ok",
      },
    });
    mockedCheckFFmpegStatus.mockResolvedValue({
      success: true,
      data: {
        status: "ok",
        installed: true,
        path: "ffmpeg",
        version: "7.1",
        message: "ok",
      },
    });
    mockedGetAvailableDevices.mockResolvedValue({
      success: true,
      data: {
        type: "devices",
        devices: [
          {
            type: "cpu",
            name: "CPU",
            available: true,
            isRecommended: true,
          },
        ],
        recommended: {
          type: "cpu",
          name: "CPU",
          available: true,
          isRecommended: true,
        },
      },
    });
    mockedCheckModelsStatus.mockResolvedValue({
      success: true,
      data: {
        status: "ok",
        installedModels: [],
        hasRequiredModel: true,
        message: "ok",
      },
    });
    mockedMarkSetupComplete.mockResolvedValue({ success: true });
    mockedResetSetup.mockResolvedValue({ success: true });
    mockedAutoInstallPython.mockResolvedValue({
      success: true,
      data: {
        status: "ok",
        version: "3.11.9",
        executable: "python",
        inVenv: true,
        pytorchInstalled: true,
        pytorchVersion: "2.5.1",
        cudaAvailable: false,
        mpsAvailable: false,
        message: "installed",
      },
    });
    mockedCheckAndRetryStep.mockResolvedValue({
      success: true,
      data: {
        status: "ok",
        installed: true,
        path: "ffmpeg",
        version: "7.1",
        message: "ok",
      },
    });
    mockedCancelSetupStep.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("initialize marks setup complete when backend says complete", async () => {
    mockedIsSetupComplete.mockResolvedValueOnce({ success: true, data: true });

    await useSetupStore.getState().initialize();

    expect(useSetupStore.getState().isComplete).toBe(true);
  });

  it("runStepWithRetry completes python step and auto-advances", async () => {
    const promise = useSetupStore.getState().runStepWithRetry("python", 3);
    await promise;

    expect(useSetupStore.getState().stepStates.python).toBe("completed");
    expect(useSetupStore.getState().pythonCheck?.status).toBe("ok");

    vi.advanceTimersByTime(1300);
    expect(useSetupStore.getState().currentStep).toBe("ffmpeg");
  });

  it("runStepWithRetry sets error after failed attempts", async () => {
    mockedCheckAndRetryStep.mockResolvedValue({ success: false, error: "ffmpeg failed" });

    const promise = useSetupStore.getState().runStepWithRetry("ffmpeg", 3);
    await vi.advanceTimersByTimeAsync(7000);
    await promise;

    expect(useSetupStore.getState().stepStates.ffmpeg).toBe("error");
    expect(useSetupStore.getState().error).toContain("ffmpeg failed");
    expect(mockedCheckAndRetryStep).toHaveBeenCalledTimes(3);
  });

  it("skipCurrentStep marks skipped and moves next", () => {
    useSetupStore.getState().skipCurrentStep();

    expect(useSetupStore.getState().stepStates.python).toBe("skipped");
    expect(useSetupStore.getState().currentStep).toBe("ffmpeg");
  });

  it("cancelCurrentStep cancels running step and resets to idle", async () => {
    useSetupStore.setState((prev) => ({
      stepStates: { ...prev.stepStates, python: "running" },
    }));

    await useSetupStore.getState().cancelCurrentStep();

    expect(mockedCancelSetupStep).toHaveBeenCalledWith("python");
    expect(useSetupStore.getState().stepStates.python).toBe("idle");
    expect(useSetupStore.getState().installProgress.stage).toBe("cancelled");
  });

  it("checkAll populates all checks", async () => {
    await useSetupStore.getState().checkAll();

    const state = useSetupStore.getState();
    expect(state.pythonCheck?.status).toBe("ok");
    expect(state.ffmpegCheck?.installed).toBe(true);
    expect(state.deviceCheck?.status).toBe("ok");
    expect(state.modelCheck?.status).toBe("ok");
  });

  it("completeSetup marks store complete", async () => {
    await useSetupStore.getState().completeSetup();
    expect(useSetupStore.getState().isComplete).toBe(true);
  });

  it("resetSetupState resets state when backend reset succeeds", async () => {
    useSetupStore.setState({
      currentStep: "summary",
      isComplete: true,
      error: "boom",
    });

    await useSetupStore.getState().resetSetupState();

    const state = useSetupStore.getState();
    expect(state.currentStep).toBe("python");
    expect(state.isComplete).toBe(false);
    expect(state.error).toBe(null);
    expect(state.stepStates.python).toBe("idle");
  });
});

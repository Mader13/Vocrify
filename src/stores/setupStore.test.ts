import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/tauri", () => ({
  checkFFmpegStatus: vi.fn(),
  checkModelsStatus: vi.fn(),
  checkPythonEnvironment: vi.fn(),
  getAvailableDevices: vi.fn(),
  isSetupComplete: vi.fn(),
  markSetupComplete: vi.fn(),
  resetSetup: vi.fn(),
}));

import {
  checkFFmpegStatus,
  checkModelsStatus,
  checkPythonEnvironment,
  getAvailableDevices,
  isSetupComplete,
  markSetupComplete,
  resetSetup,
} from "@/services/tauri";
import { useSetupStore } from "@/stores/setupStore";

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

  it("checkPython populates pythonCheck", async () => {
    await useSetupStore.getState().checkPython();

    const state = useSetupStore.getState();
    expect(state.pythonCheck?.status).toBe("ok");
    expect(state.pythonCheck?.version).toBe("3.11.9");
  });

  it("checkFFmpeg populates ffmpegCheck", async () => {
    await useSetupStore.getState().checkFFmpeg();

    const state = useSetupStore.getState();
    expect(state.ffmpegCheck?.status).toBe("ok");
    expect(state.ffmpegCheck?.installed).toBe(true);
  });

  it("checkDevice populates deviceCheck", async () => {
    await useSetupStore.getState().checkDevice();

    const state = useSetupStore.getState();
    expect(state.deviceCheck?.status).toBe("ok");
    expect(state.deviceCheck?.devices).toHaveLength(1);
  });

  it("checkModel populates modelCheck", async () => {
    await useSetupStore.getState().checkModel();

    const state = useSetupStore.getState();
    expect(state.modelCheck?.status).toBe("ok");
    expect(state.modelCheck?.hasRequiredModel).toBe(true);
  });

  it("checkAll populates all checks", async () => {
    await useSetupStore.getState().checkAll();

    const state = useSetupStore.getState();
    expect(state.pythonCheck?.status).toBe("ok");
    expect(state.ffmpegCheck?.installed).toBe(true);
    expect(state.deviceCheck?.status).toBe("ok");
    expect(state.modelCheck?.status).toBe("ok");
  });

  it("goToStep changes current step", () => {
    useSetupStore.getState().goToStep("ffmpeg");
    expect(useSetupStore.getState().currentStep).toBe("ffmpeg");
  });

  it("nextStep advances to next step in order", () => {
    useSetupStore.getState().goToStep("python");
    useSetupStore.getState().nextStep();
    expect(useSetupStore.getState().currentStep).toBe("ffmpeg");
  });

  it("prevStep goes back to previous step", () => {
    useSetupStore.getState().goToStep("ffmpeg");
    useSetupStore.getState().prevStep();
    expect(useSetupStore.getState().currentStep).toBe("python");
  });

  it("completeSetup marks store complete", async () => {
    await useSetupStore.getState().completeSetup();
    expect(useSetupStore.getState().isComplete).toBe(true);
  });

  it("skipSetup marks store complete", () => {
    useSetupStore.getState().skipSetup();
    expect(useSetupStore.getState().isComplete).toBe(true);
  });

  it("resetSetupState resets state when backend reset succeeds", async () => {
    useSetupStore.setState({
      currentStep: "device",
      isComplete: true,
      error: "boom",
    });

    await useSetupStore.getState().resetSetupState();

    const state = useSetupStore.getState();
    expect(state.currentStep).toBe("python");
    expect(state.isComplete).toBe(false);
    expect(state.error).toBe(null);
  });

  it("checkPython handles error gracefully", async () => {
    mockedCheckPythonEnvironment.mockResolvedValueOnce({
      success: false,
      error: "Python not found",
    });

    await useSetupStore.getState().checkPython();

    const state = useSetupStore.getState();
    expect(state.pythonCheck?.status).toBe("error");
    expect(state.pythonCheck?.message).toBe("Python not found");
  });
});

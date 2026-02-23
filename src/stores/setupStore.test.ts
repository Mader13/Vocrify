import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/tauri", () => ({
  checkFFmpegStatus: vi.fn(),
  checkModelsStatus: vi.fn(),
  checkPythonEnvironment: vi.fn(),
  checkRuntimeReadiness: vi.fn(),
  downloadFFmpeg: vi.fn(),
  getAvailableDevices: vi.fn(),
  isSetupComplete: vi.fn(),
  isSetupCompleteFast: vi.fn(),
  markSetupComplete: vi.fn(),
  onFFmpegProgress: vi.fn(),
  onFFmpegStatus: vi.fn(),
  resetSetup: vi.fn(),
}));

import {
  checkFFmpegStatus,
  checkModelsStatus,
  checkPythonEnvironment,
  checkRuntimeReadiness,
  downloadFFmpeg,
  getAvailableDevices,
  isSetupComplete,
  isSetupCompleteFast,
  markSetupComplete,
  onFFmpegProgress,
  onFFmpegStatus,
  resetSetup,
} from "@/services/tauri";
import { useSetupStore } from "@/stores/setupStore";

const mockedCheckFFmpegStatus = vi.mocked(checkFFmpegStatus);
const mockedCheckModelsStatus = vi.mocked(checkModelsStatus);
const mockedCheckPythonEnvironment = vi.mocked(checkPythonEnvironment);
const mockedCheckRuntimeReadiness = vi.mocked(checkRuntimeReadiness);
const mockedDownloadFFmpeg = vi.mocked(downloadFFmpeg);
const mockedGetAvailableDevices = vi.mocked(getAvailableDevices);
const mockedIsSetupComplete = vi.mocked(isSetupComplete);
const mockedIsSetupCompleteFast = vi.mocked(isSetupCompleteFast);
const mockedMarkSetupComplete = vi.mocked(markSetupComplete);
const mockedOnFFmpegProgress = vi.mocked(onFFmpegProgress);
const mockedOnFFmpegStatus = vi.mocked(onFFmpegStatus);
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
    runtimeReadiness: null,
    ffmpegProgress: null,
    ffmpegInstallStatus: "idle",
    error: null,
  });
}

describe("setupStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    resetStore();

    mockedIsSetupComplete.mockResolvedValue({ success: true, data: false });
    mockedIsSetupCompleteFast.mockResolvedValue({ success: true, data: false });
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
            deviceType: "cpu",
            name: "CPU",
            available: true,
            isRecommended: true,
          },
        ],
        recommended: "cpu",
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
    mockedCheckRuntimeReadiness.mockResolvedValue({
      success: true,
      data: {
        ready: true,
        pythonReady: true,
        ffmpegReady: true,
        pythonMessage: "ok",
        ffmpegMessage: "ok",
        message: "Runtime is ready",
        checkedAt: "2026-02-16T00:00:00.000Z",
      },
    });
    mockedDownloadFFmpeg.mockResolvedValue({ success: true });
    mockedOnFFmpegProgress.mockResolvedValue(() => undefined);
    mockedOnFFmpegStatus.mockResolvedValue(() => undefined);
    mockedMarkSetupComplete.mockResolvedValue({ success: true });
    mockedResetSetup.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("initialize marks setup complete when backend says complete", async () => {
    mockedIsSetupCompleteFast.mockResolvedValueOnce({ success: true, data: true });

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

  it("checkAll populates all checks and runtime readiness", async () => {
    await useSetupStore.getState().checkAll();

    const state = useSetupStore.getState();
    expect(state.pythonCheck?.status).toBe("ok");
    expect(state.ffmpegCheck?.installed).toBe(true);
    expect(state.deviceCheck).toBe(null);
    expect(state.modelCheck?.status).toBe("ok");
    expect(state.runtimeReadiness?.ready).toBe(true);
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

  it("completeSetup marks store complete when runtime is ready", async () => {
    await useSetupStore.getState().checkPython();
    await useSetupStore.getState().checkFFmpeg();
    await useSetupStore.getState().completeSetup();
    expect(useSetupStore.getState().isComplete).toBe(true);
  });

  it("completeSetup fails when runtime is not ready", async () => {
    mockedCheckPythonEnvironment.mockResolvedValueOnce({
      success: true,
      data: {
        status: "error",
        version: null,
        executable: null,
        inVenv: false,
        pytorchInstalled: false,
        pytorchVersion: null,
        cudaAvailable: false,
        mpsAvailable: false,
        message: "python missing",
      },
    });

    await useSetupStore.getState().checkPython();
    await useSetupStore.getState().checkFFmpeg();

    await useSetupStore.getState().completeSetup();

    const state = useSetupStore.getState();
    expect(state.isComplete).toBe(false);
    expect(state.error).toContain("Python check not completed or failed");
    expect(mockedMarkSetupComplete).not.toHaveBeenCalled();
  });

  it("completeSetup fails when FFmpeg check is not ready", async () => {
    mockedCheckFFmpegStatus.mockResolvedValueOnce({
      success: true,
      data: {
        status: "error",
        installed: false,
        path: null,
        version: null,
        message: "ffmpeg missing",
      },
    });

    await useSetupStore.getState().checkPython();
    await useSetupStore.getState().checkFFmpeg();

    await useSetupStore.getState().completeSetup();

    const state = useSetupStore.getState();
    expect(state.isComplete).toBe(false);
    expect(state.error).toContain("FFmpeg check not completed or failed");
    expect(mockedMarkSetupComplete).not.toHaveBeenCalled();
  });

  it("completeSetup reports backend failure from markSetupComplete", async () => {
    mockedMarkSetupComplete.mockResolvedValueOnce({
      success: false,
      error: "backend unavailable",
    });

    await useSetupStore.getState().checkPython();
    await useSetupStore.getState().checkFFmpeg();
    await useSetupStore.getState().completeSetup();

    const state = useSetupStore.getState();
    expect(state.isComplete).toBe(false);
    expect(state.error).toContain("backend unavailable");
  });

  it("skipSetup does not mark store complete", () => {
    useSetupStore.getState().skipSetup();

    const state = useSetupStore.getState();
    expect(state.isComplete).toBe(false);
    expect(state.error).toContain("cannot be skipped");
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

  it("backgroundValidate re-opens setup when live validation fails", async () => {
    useSetupStore.setState({ isComplete: true });
    mockedIsSetupComplete.mockResolvedValueOnce({ success: true, data: false });

    await useSetupStore.getState().backgroundValidate();

    expect(useSetupStore.getState().isComplete).toBe(false);
  });

  it("backgroundValidate keeps setup complete on transient backend errors", async () => {
    useSetupStore.setState({ isComplete: true });
    mockedIsSetupComplete.mockRejectedValueOnce(new Error("timeout"));

    await useSetupStore.getState().backgroundValidate();

    expect(useSetupStore.getState().isComplete).toBe(true);
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

  it("installFFmpeg marks installation completed on successful download", async () => {
    await useSetupStore.getState().installFFmpeg();

    const state = useSetupStore.getState();
    expect(state.ffmpegInstallStatus).toBe("completed");
    expect(state.ffmpegCheck?.status).toBe("ok");
    expect(state.isChecking).toBe(false);
  });

  it("installFFmpeg marks installation failed when download command fails", async () => {
    mockedDownloadFFmpeg.mockResolvedValueOnce({ success: false, error: "network fail" });

    await useSetupStore.getState().installFFmpeg();

    const state = useSetupStore.getState();
    expect(state.ffmpegInstallStatus).toBe("failed");
    expect(state.ffmpegCheck?.status).toBe("error");
    expect(state.ffmpegCheck?.message).toContain("network fail");
    expect(state.isChecking).toBe(false);
  });
});

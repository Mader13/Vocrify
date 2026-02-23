import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SetupWizard } from "./SetupWizard";
import { useSetupStore } from "@/stores/setupStore";

vi.mock("@/services/tauri/setup-commands", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/services/tauri/setup-commands")>();

  return {
    ...original,
    installPythonFull: vi.fn(async () => ({ success: true })),
    onPythonInstallProgress: vi.fn(async () => () => undefined),
    cancelPythonInstall: vi.fn(async () => ({ success: true })),
  };
});

function setHappyPathState() {
  const noopAsync = vi.fn(async () => undefined);

  useSetupStore.setState({
    currentStep: "ffmpeg",
    isComplete: false,
    isChecking: false,
    pythonCheck: {
      status: "ok",
      version: "3.12.0",
      executable: "python",
      inVenv: true,
      pytorchInstalled: true,
      pytorchVersion: "2.5.1",
      cudaAvailable: false,
      mpsAvailable: false,
      message: "ok",
    },
    ffmpegCheck: {
      status: "ok",
      installed: true,
      path: "ffmpeg",
      version: "7.1",
      message: "ok",
    },
    deviceCheck: {
      status: "ok",
      devices: [
        {
          deviceType: "cpu",
          name: "CPU",
          available: true,
          isRecommended: true,
        },
      ],
      recommended: "cpu",
      message: "Devices found: 1",
    },
    modelCheck: {
      status: "ok",
      installedModels: [],
      hasRequiredModel: false,
      message: "No models yet",
    },
    runtimeReadiness: {
      ready: true,
      pythonReady: true,
      ffmpegReady: true,
      pythonMessage: "ok",
      ffmpegMessage: "ok",
      message: "Runtime ready",
      checkedAt: new Date().toISOString(),
    },
    ffmpegProgress: null,
    ffmpegInstallStatus: "idle",
    error: null,
    checkAll: noopAsync,
    fetchDevices: noopAsync,
  });
}

describe("SetupWizard flow", () => {
  beforeEach(() => {
    setHappyPathState();
  });

  it("walks through all steps and completes setup", async () => {
    const onComplete = vi.fn();

    render(<SetupWizard onComplete={onComplete} />);

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByRole("heading", { name: "Devices" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByRole("heading", { name: "Optional settings" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByRole("heading", { name: /you're almost ready/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /finish setup/i }));

    await waitFor(() => {
      expect(useSetupStore.getState().isComplete).toBe(true);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("blocks forward navigation on Python step until check turns green", async () => {
    const noopAsync = vi.fn(async () => undefined);

    useSetupStore.setState({
      currentStep: "python",
      isComplete: false,
      isChecking: false,
      pythonCheck: {
        status: "error",
        version: null,
        executable: null,
        inVenv: false,
        pytorchInstalled: false,
        pytorchVersion: null,
        cudaAvailable: false,
        mpsAvailable: false,
        message: "Python not ready",
      },
      ffmpegCheck: {
        status: "ok",
        installed: true,
        path: "ffmpeg",
        version: "7.1",
        message: "ok",
      },
      deviceCheck: {
        status: "ok",
        devices: [],
        recommended: "cpu",
        message: "ok",
      },
      modelCheck: {
        status: "ok",
        installedModels: [],
        hasRequiredModel: false,
        message: "No models yet",
      },
      runtimeReadiness: null,
      ffmpegProgress: null,
      ffmpegInstallStatus: "idle",
      error: null,
      checkAll: noopAsync,
      fetchDevices: noopAsync,
    });

    render(<SetupWizard />);

    const continueButton = screen.getByRole("button", { name: /continue/i });
    expect(continueButton).toBeDisabled();

    act(() => {
      useSetupStore.setState({
        pythonCheck: {
          status: "ok",
          version: "3.12.0",
          executable: "python",
          inVenv: true,
          pytorchInstalled: true,
          pytorchVersion: "2.5.1",
          cudaAvailable: false,
          mpsAvailable: false,
          message: "ok",
        },
      });
    });

    await waitFor(() => {
      expect(continueButton).toBeEnabled();
    });

    fireEvent.click(continueButton);
    expect(screen.getByRole("heading", { level: 3, name: "FFmpeg" })).toBeInTheDocument();
  });

  it("keeps FFmpeg gate closed until auto-install completes", async () => {
    const noopAsync = vi.fn(async () => undefined);
    const installFFmpeg = vi.fn(async () => {
      useSetupStore.setState({ ffmpegInstallStatus: "downloading" });
      useSetupStore.setState({
        ffmpegInstallStatus: "completed",
        ffmpegCheck: {
          status: "ok",
          installed: true,
          path: "ffmpeg",
          version: "7.1",
          message: "ok",
        },
      });
    });

    useSetupStore.setState({
      currentStep: "ffmpeg",
      isComplete: false,
      isChecking: false,
      pythonCheck: {
        status: "ok",
        version: "3.12.0",
        executable: "python",
        inVenv: true,
        pytorchInstalled: true,
        pytorchVersion: "2.5.1",
        cudaAvailable: false,
        mpsAvailable: false,
        message: "ok",
      },
      ffmpegCheck: {
        status: "error",
        installed: false,
        path: null,
        version: null,
        message: "FFmpeg missing",
      },
      deviceCheck: {
        status: "ok",
        devices: [],
        recommended: "cpu",
        message: "ok",
      },
      modelCheck: {
        status: "ok",
        installedModels: [],
        hasRequiredModel: false,
        message: "No models yet",
      },
      runtimeReadiness: null,
      ffmpegProgress: null,
      ffmpegInstallStatus: "idle",
      error: null,
      installFFmpeg,
      checkAll: noopAsync,
      fetchDevices: noopAsync,
    });

    render(<SetupWizard />);

    const continueButton = screen.getByRole("button", { name: /continue/i });
    expect(continueButton).toBeDisabled();

    fireEvent.click(screen.getAllByRole("button", { name: /install automatically/i })[0]);

    await waitFor(() => {
      expect(installFFmpeg).toHaveBeenCalledTimes(1);
      expect(continueButton).toBeEnabled();
    });

    fireEvent.click(continueButton);
    expect(screen.getByRole("heading", { name: "Devices" })).toBeInTheDocument();
  });
});

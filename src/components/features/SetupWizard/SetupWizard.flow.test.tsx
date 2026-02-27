import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    currentStep: "language",
    isComplete: false,
    isChecking: false,
    pythonCheck: {
      status: "ok",
      version: "3.12.0",
      executable: "python",
      inVenv: true,
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

    // Language step
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    
    await waitFor(() => {
      expect(screen.getAllByRole("heading", { name: "FFmpeg" })[0]).toBeInTheDocument();
    });

    // FFmpeg step
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    
    await waitFor(() => {
      expect(screen.getAllByRole("heading", { name: "Devices" })[0]).toBeInTheDocument();
    });

    // Device step
    fireEvent.click(screen.getByRole("button", { name: /skip setup|continue/i }));
    
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 3, name: "AI Models" })).toBeInTheDocument();
    });

    // Model step
    fireEvent.click(screen.getByRole("button", { name: /skip setup|continue/i }));
    
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /almost ready/i })).toBeInTheDocument();
    });

    // Summary step
    fireEvent.click(screen.getByRole("button", { name: /finish setup/i }));

    await waitFor(() => {
      expect(useSetupStore.getState().isComplete).toBe(true);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
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
    
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Devices" })).toBeInTheDocument();
    });
  });
});

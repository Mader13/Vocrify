import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SetupWizard } from "./SetupWizard";
import { useSetupStore } from "@/stores/setupStore";

function setSummaryFailureState() {
  const noopAsync = vi.fn(async () => undefined);

  useSetupStore.setState({
    currentStep: "summary",
    isComplete: false,
    isChecking: false,
    ffmpegCheck: {
      status: "error",
      installed: false,
      path: null,
      version: null,
      message: "FFmpeg not ready",
    },
    deviceCheck: null,
    modelCheck: null,
    runtimeReadiness: null,
    ffmpegProgress: null,
    ffmpegInstallStatus: "idle",
    error: null,
    checkAll: noopAsync,
    fetchDevices: noopAsync,
  });
}

describe("SetupWizard", () => {
  beforeEach(() => {
    setSummaryFailureState();
  });

  it("does not call onComplete when runtime checks fail", async () => {
    const onComplete = vi.fn();

    render(<SetupWizard onComplete={onComplete} />);

    fireEvent.click(screen.getByRole("button", { name: /finish setup/i }));

    await waitFor(() => {
      expect(useSetupStore.getState().isComplete).toBe(false);
    });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("does not call onSkip when skip gate is enforced", () => {
    const onSkip = vi.fn();

    render(<SetupWizard onSkip={onSkip} />);

    fireEvent.click(screen.getByRole("button", { name: /skip setup/i }));

    expect(onSkip).not.toHaveBeenCalled();
    expect(useSetupStore.getState().error).toContain("cannot be skipped");
  });
});

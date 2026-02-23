import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SetupWizardGuard } from "./SetupWizard";
import { useSetupStore } from "@/stores/setupStore";

function resetSetupStoreState() {
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

describe("SetupWizardGuard", () => {
  beforeEach(() => {
    resetSetupStoreState();
  });

  it("renders main content immediately when setup is already complete", () => {
    useSetupStore.setState({ isComplete: true });

    render(
      <SetupWizardGuard>
        <div data-testid="main-content">Main content</div>
      </SetupWizardGuard>
    );

    expect(screen.getByTestId("main-content")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /initial setup/i })).not.toBeInTheDocument();
  });
});

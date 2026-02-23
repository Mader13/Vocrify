import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeviceStep } from "./DeviceStep";
import { useSetupStore } from "@/stores/setupStore";

describe("DeviceStep", () => {
  beforeEach(() => {
    useSetupStore.setState({
      currentStep: "device",
      isComplete: false,
      isChecking: false,
      pythonCheck: null,
      ffmpegCheck: null,
      modelCheck: null,
      runtimeReadiness: null,
      ffmpegProgress: null,
      ffmpegInstallStatus: "idle",
      error: null,
      deviceCheck: {
        status: "ok",
        devices: [
          {
            deviceType: "vulkan",
            name: "",
            available: true,
            isRecommended: true,
          },
        ],
        recommended: "vulkan",
        message: "Devices found: 1",
      },
    });
  });

  it("shows dedicated label and performance hint for Vulkan devices", () => {
    render(<DeviceStep />);

    expect(screen.getByText("AMD/Intel GPU (Vulkan)")).toBeInTheDocument();
    expect(screen.getByText("⚡ Fast")).toBeInTheDocument();
  });
});

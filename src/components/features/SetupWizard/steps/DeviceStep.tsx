import * as React from "react";
import { useEffect } from "react";
import { Cpu, Monitor, Zap, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CheckCard } from "../CheckCard";
import { useSetupStore } from "@/stores/setupStore";
import { cn } from "@/lib/utils";
import type { DeviceInfo } from "@/types";

/**
 * Get icon for device type
 */
function getDeviceIcon(deviceType: string): React.ReactNode {
  switch (deviceType) {
    case "cuda":
      return <Zap className="h-5 w-5" aria-hidden="true" />;
    case "vulkan":
      return <Zap className="h-5 w-5" aria-hidden="true" />;
    case "mps":
      return <Monitor className="h-5 w-5" aria-hidden="true" />;
    case "cpu":
    default:
      return <Cpu className="h-5 w-5" aria-hidden="true" />;
  }
}

/**
 * Get performance label for device type
 */
function getPerformanceLabel(deviceType: string): string {
  switch (deviceType) {
    case "cuda":
      return "Fastest";
    case "vulkan":
      return "Fast";
    case "mps":
      return "Fast";
    case "cpu":
    default:
      return "Slow";
  }
}

/**
 * Get device type display name
 */
function getDeviceTypeName(deviceType: string): string {
  switch (deviceType) {
    case "cuda":
      return "NVIDIA GPU (CUDA)";
    case "vulkan":
      return "AMD/Intel GPU (Vulkan)";
    case "mps":
      return "Apple Silicon (MPS)";
    case "cpu":
    default:
      return "CPU";
  }
}

/**
 * Device card component
 */
interface DeviceCardProps {
  device: DeviceInfo;
  isRecommended?: boolean;
}

function DeviceCard({ device, isRecommended }: DeviceCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border-2 p-4 transition-colors",
        isRecommended
          ? "border-green-500/50 bg-green-500/5"
          : "border-muted bg-muted/30"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "shrink-0 p-2 rounded-lg",
            isRecommended ? "bg-green-500/10 text-green-600" : "bg-muted text-muted-foreground"
          )}
        >
          {getDeviceIcon(device.deviceType)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-medium">{device.name || getDeviceTypeName(device.deviceType)}</h4>
            {isRecommended && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-3 w-3" />
                Recommended
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {getPerformanceLabel(device.deviceType)}
          </p>
          {device.memoryMb && (
            <p className="text-xs text-muted-foreground mt-1">
              Memory: {device.memoryMb} MB
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Step 3: Compute Device Check
 * Shows available compute devices (CUDA, MPS, CPU)
 */
export function DeviceStep() {
  const { deviceCheck, checkDevice, isChecking } = useSetupStore();

  // Run check on mount
  useEffect(() => {
    if (!deviceCheck) {
      checkDevice();
    }
  }, [deviceCheck, checkDevice]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Devices</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Available devices for transcription processing
        </p>
      </div>

      {/* Main check card */}
      <CheckCard
        title="Compute Devices"
        status={deviceCheck?.status ?? "pending"}
        message={deviceCheck?.message ?? "Searching for devices..."}
        onRetry={checkDevice}
      />

      {/* Device list - only show available devices */}
      {deviceCheck && deviceCheck.devices.filter(d => d.available).length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground">
            Devices found: {deviceCheck.devices.filter(d => d.available).length}
          </h4>
          <div className="grid gap-3">
            {deviceCheck.devices
              .filter(device => device.available)
              .map((device, index) => (
                <DeviceCard
                  key={`${device.deviceType}-${index}`}
                  device={device}
                  isRecommended={deviceCheck.recommended === device.deviceType}
                />
              ))}
          </div>
        </div>
      )}

      {/* No devices found */}
      {deviceCheck && deviceCheck.devices.filter(d => d.available).length === 0 && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4">
          <p className="text-sm text-yellow-600 dark:text-yellow-400">
            No devices detected. CPU will be used.
          </p>
        </div>
      )}

      {/* Loading state */}
      {isChecking && !deviceCheck && (
        <div className="flex items-center justify-center py-8">
          <div className="animate-pulse text-muted-foreground">
            Searching for devices...
          </div>
        </div>
      )}

      {/* Info about device priority */}
      {deviceCheck && deviceCheck.devices.length > 1 && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Device priority:</span>{" "}
            {"CUDA (NVIDIA GPU) -> MPS (Apple Silicon) -> Vulkan (AMD/Intel GPU) -> CPU"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Recommended device is selected automatically for maximum performance.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Footer actions for Device step
 */
export interface DeviceStepFooterProps {
  onBack: () => void;
  onNext: () => void;
}

export function DeviceStepFooter({ onBack, onNext }: DeviceStepFooterProps) {
  const { deviceCheck, checkDevice, isChecking } = useSetupStore();

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        {deviceCheck?.status === "error" && (
          <Button
            variant="outline"
            onClick={() => checkDevice()}
            disabled={isChecking}
          >
            Retry
          </Button>
        )}
      </div>
      <Button onClick={onNext} disabled={isChecking}>
        Continue
      </Button>
    </div>
  );
}


export type DeviceType = "auto" | "cpu" | "cuda" | "mps" | "vulkan";

export interface DeviceInfo {
  deviceType: DeviceType;
  name: string;
  available: boolean;
  memoryMb?: number;
  computeCapability?: string;
  isRecommended: boolean;
}

export interface DevicesResponse {
  type: "devices";
  devices: DeviceInfo[];
  recommended: string;
}

export const DEVICE_NAMES: Record<DeviceType, string> = {
  auto: "Auto (Recommended)",
  cpu: "CPU (Slow)",
  cuda: "NVIDIA GPU (CUDA)",
  mps: "Apple Silicon (MPS)",
  vulkan: "GPU (Vulkan - AMD/Intel)",
};

export const DEVICE_DESCRIPTIONS: Record<DeviceType, string> = {
  auto: "Automatically select the best device",
  cpu: "CPU only, works everywhere but slow",
  cuda: "NVIDIA GPU with CUDA, maximum speed",
  mps: "Apple Silicon M1/M2/M3, good performance on Mac",
  vulkan: "AMD/Intel GPU via Vulkan, good acceleration",
};

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
  auto: "Auto (рекомендуется)",
  cpu: "CPU (медленно)",
  cuda: "NVIDIA GPU (CUDA)",
  mps: "Apple Silicon (MPS)",
  vulkan: "GPU (Vulkan - AMD/Intel)",
};

export const DEVICE_DESCRIPTIONS: Record<DeviceType, string> = {
  auto: "Автоматический выбор лучшего устройства",
  cpu: "Только процессор, работает везде, но медленно",
  cuda: "NVIDIA видеокарта с CUDA, максимальная скорость",
  mps: "Apple Silicon M1/M2/M3, хорошая производительность на Mac",
  vulkan: "AMD/Intel видеокарта через Vulkan, хорошее ускорение",
};

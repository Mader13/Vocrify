import type { DiarizationProvider, EnginePreference, DeviceType } from "@/types";
import type { AppSettings } from "../index";

export function setSettingsPure(stateSettings: AppSettings, newSettings: Partial<AppSettings>): AppSettings {
  return { ...stateSettings, ...newSettings };
}

export function updateSettingsPure(stateSettings: AppSettings, newSettings: Partial<AppSettings>): AppSettings {
  return { ...stateSettings, ...newSettings };
}

export function updateLastDiarizationProviderPure(
  stateSettings: AppSettings,
  provider: DiarizationProvider
): AppSettings {
  return { ...stateSettings, lastDiarizationProvider: provider };
}

export function setHuggingFaceTokenPure(stateSettings: AppSettings, token: string | null): AppSettings {
  return { ...stateSettings, huggingFaceToken: token };
}

export function validateSettings(settings: AppSettings): Partial<AppSettings> {
  const updates: Partial<AppSettings> = {};
  const validEnginePrefs: EnginePreference[] = ["auto", "rust", "python"];
  const validDevices: DeviceType[] = ["auto", "cpu", "cuda", "mps", "vulkan"];

  if (settings.enginePreference && !validEnginePrefs.includes(settings.enginePreference)) {
    updates.enginePreference = "auto";
  }

  if (settings.defaultDevice && !validDevices.includes(settings.defaultDevice)) {
    updates.defaultDevice = "auto";
  }

  return updates;
}

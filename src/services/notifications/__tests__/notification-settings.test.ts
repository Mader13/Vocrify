import { beforeEach, describe, expect, it } from "vitest";

import { useNotificationStore as useUINotificationStore } from "@/components/ui/notifications";
import {
  useNotificationSettingsStore,
  showNotificationWithSettings,
} from "@/services/notifications";

function resetUIStore() {
  useUINotificationStore.setState({
    notifications: [],
    queue: [],
    position: "bottom-right",
    maxVisible: 5,
  });
}

function resetSettingsStore() {
  useNotificationSettingsStore.setState({
    settings: {
      enabled: true,
      position: "top-right",
      duration: 4000,
      soundEnabled: false,
      desktopNotificationsEnabled: false,
      categories: {
        download: true,
        transcription: true,
        error: true,
        info: true,
      },
    },
  });
}

describe("notification settings runtime bridge", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetUIStore();
    resetSettingsStore();
  });

  it("blocks notifications when notifications are disabled", () => {
    useNotificationSettingsStore.getState().updateSettings({ enabled: false });

    const id = showNotificationWithSettings({
      type: "info",
      title: "Should not render",
      message: "Disabled by settings",
      category: "info",
    });

    expect(id).toBeNull();
    expect(useUINotificationStore.getState().notifications).toHaveLength(0);
  });

  it("applies configured position and duration to shown notifications", () => {
    useNotificationSettingsStore.getState().updateSettings({
      position: "top-left",
      duration: 2500,
    });

    const id = showNotificationWithSettings({
      type: "success",
      title: "Applied config",
      message: "Uses runtime settings",
      category: "info",
    });

    expect(id).not.toBeNull();

    const uiState = useUINotificationStore.getState();
    expect(uiState.position).toBe("top-left");
    expect(uiState.notifications[0]?.duration).toBe(2500);
  });

  it("respects category-level toggles", () => {
    const settingsStore = useNotificationSettingsStore.getState();
    settingsStore.updateSettings({
      categories: {
        ...settingsStore.settings.categories,
        transcription: false,
      },
    });

    const id = showNotificationWithSettings({
      type: "success",
      title: "Transcription complete",
      category: "transcription",
    });

    expect(id).toBeNull();
    expect(useUINotificationStore.getState().notifications).toHaveLength(0);
  });
});

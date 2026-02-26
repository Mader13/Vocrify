/**
 * Notification Settings Store
 *
 * Zustand store for persistent notification preferences.
 * Renamed from `useNotificationStore` to `useNotificationSettingsStore`
 * to avoid collision with the UI toast store in components/ui/notifications.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useNotificationStore as useUINotificationStore } from "@/components/ui/notifications";
import type { NotificationSettings } from "@/types";

export interface NotificationSettingsState {
  settings: NotificationSettings;
  updateSettings: (updates: Partial<NotificationSettings>) => void;
  addNotification: (notification: {
    title: string;
    message: string;
    type: "success" | "error" | "warning" | "info";
    category?: string;
  }) => string;
}

const defaultSettings: NotificationSettings = {
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
};

export const useNotificationSettingsStore = create<NotificationSettingsState>()(
  persist(
    (set) => ({
      settings: defaultSettings,
      updateSettings: (updates) => {
        set((state) => ({
          settings: { ...state.settings, ...updates },
        }));
      },
      addNotification: (notification) => {
        const uiStore = useUINotificationStore.getState();
        return uiStore.show({
          type: notification.type,
          title: notification.title,
          message: notification.message,
        });
      },
    }),
    {
      name: "notification-settings",
      storage: createJSONStorage(() => localStorage),
    }
  )
);

/** @deprecated Use `useNotificationSettingsStore` instead */
export const useNotificationStore = useNotificationSettingsStore;

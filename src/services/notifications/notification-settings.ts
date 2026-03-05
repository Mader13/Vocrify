/**
 * Notification Settings Store
 *
 * Zustand store for persistent notification preferences.
 * Renamed from `useNotificationStore` to `useNotificationSettingsStore`
 * to avoid collision with the UI toast store in components/ui/notifications.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationCategory,
  type NotificationSettings,
} from "@/types";
import {
  dispatchNotification,
  getDispatchedPosition,
  setDispatchedPosition,
  type NotificationInput,
} from "./notification-dispatcher";

export interface NotificationSettingsState {
  settings: NotificationSettings;
  updateSettings: (updates: Partial<NotificationSettings>) => void;
  addNotification: (notification: {
    title: string;
    message: string;
    type: NotificationInput["type"];
    category?: NotificationCategory;
    duration?: number | null;
    progress?: number;
    actions?: NotificationInput["actions"];
    ariaLabel?: string;
  }) => string | null;
}

const defaultSettings: NotificationSettings = {
  ...DEFAULT_NOTIFICATION_SETTINGS,
  categories: { ...DEFAULT_NOTIFICATION_SETTINGS.categories },
};

interface ConfiguredNotification {
  type: NotificationInput["type"];
  title: string;
  message?: string;
  category?: NotificationCategory;
  duration?: number | null;
  progress?: number;
  actions?: NotificationInput["actions"];
  ariaLabel?: string;
}

function resolveCategory(type: NotificationInput["type"], category?: NotificationCategory): NotificationCategory {
  if (category) {
    return category;
  }

  return type === "error" ? "error" : "info";
}

function resolveDuration(
  type: NotificationInput["type"],
  settingsDuration: NotificationSettings["duration"],
  explicitDuration?: number | null
): number | null | undefined {
  if (explicitDuration !== undefined) {
    return explicitDuration;
  }

  if (type === "loading") {
    return null;
  }

  return settingsDuration === "infinite" ? null : settingsDuration;
}

function syncUIPosition(position: NotificationSettings["position"]): void {
  const uiPosition = getDispatchedPosition();
  if (uiPosition !== position) {
    setDispatchedPosition(position);
  }
}

export function showNotificationWithSettings(notification: ConfiguredNotification): string | null {
  const { settings } = useNotificationSettingsStore.getState();
  if (!settings.enabled) {
    return null;
  }

  const category = resolveCategory(notification.type, notification.category);
  if (!settings.categories[category]) {
    return null;
  }

  syncUIPosition(settings.position);
  return dispatchNotification({
    type: notification.type,
    title: notification.title,
    message: notification.message,
    duration: resolveDuration(notification.type, settings.duration, notification.duration),
    progress: notification.progress,
    actions: notification.actions,
    ariaLabel: notification.ariaLabel,
  });
}

export const useNotificationSettingsStore = create<NotificationSettingsState>()(
  persist(
    (set) => ({
      settings: defaultSettings,
      updateSettings: (updates) => {
        set((state) => ({
          settings: { ...state.settings, ...updates },
        }));

        const nextPosition = updates.position ?? useNotificationSettingsStore.getState().settings.position;
        syncUIPosition(nextPosition);
      },
      addNotification: (notification) => {
        return showNotificationWithSettings(notification);
      },
    }),
    {
      name: "notification-settings",
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        syncUIPosition(state?.settings.position ?? defaultSettings.position);
      },
    }
  )
);

syncUIPosition(defaultSettings.position);

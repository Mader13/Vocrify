/**
 * Zustand store for notification center state management with Tauri Store persistence
 * @module notification-center/store
 */

import { create } from "zustand";
import type { NotificationCenterState, PersistentNotification, NotificationPriority } from "./types";
import { saveNotifications, loadNotifications, clearNotifications as clearStoreNotifications } from "@/services/store";

/**
 * Create the notification center store with Tauri Store persistence
 */
export const useNotificationCenterStore = create<NotificationCenterState>((set, get) => ({
  notifications: [],
  isOpen: false,

  addNotification: async (notification) => {
    const id = crypto.randomUUID();
    const now = new Date();

    const newNotification: PersistentNotification = {
      id,
      type: notification.type,
      priority: notification.priority,
      title: notification.title,
      message: notification.message,
      actionLink: notification.actionLink,
      actionLabel: notification.actionLabel,
      createdAt: now,
      read: false,
    };

    // Update state
    set((state) => {
      const updated = [newNotification, ...state.notifications].slice(0, 100);
      return { notifications: updated };
    });

    // Persist to Tauri Store
    const currentNotifications = get().notifications;
    await saveNotifications(currentNotifications);

    return id;
  },

  markAsRead: async (id) => {
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      ),
    }));

    // Persist to Tauri Store
    const currentNotifications = get().notifications;
    await saveNotifications(currentNotifications);
  },

  markAllAsRead: async () => {
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
    }));

    // Persist to Tauri Store
    const currentNotifications = get().notifications;
    await saveNotifications(currentNotifications);
  },

  deleteNotification: async (id) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));

    // Persist to Tauri Store
    const currentNotifications = get().notifications;
    await saveNotifications(currentNotifications);
  },

  clearAll: async () => {
    set({ notifications: [] });
    await clearStoreNotifications();
  },

  toggle: () => {
    set((state) => ({ isOpen: !state.isOpen }));
  },

  open: () => {
    set({ isOpen: true });
  },

  close: () => {
    set({ isOpen: false });
  },

  getUnreadCount: () => {
    return get().notifications.filter((n) => !n.read).length;
  },
}));

/**
 * Initialize notifications from Tauri Store
 * Call this on app startup
 */
export async function initializeNotifications(): Promise<void> {
  const saved = await loadNotifications();
  if (saved.length > 0) {
    // Validate and restore notifications
    const notifications: PersistentNotification[] = saved
      .map((n) => ({
        id: (n as any).id ?? crypto.randomUUID(),
        type: (n as any).type ?? "info",
        priority: (n as any).priority ?? "low",
        title: (n as any).title ?? "Notification",
        message: (n as any).message,
        actionLink: (n as any).actionLink,
        actionLabel: (n as any).actionLabel,
        createdAt: new Date((n as any).createdAt ?? Date.now()),
        read: (n as any).read ?? false,
      }))
      .filter((n) => n.id && n.title); // Filter out invalid entries

    useNotificationCenterStore.setState({ notifications });
  }
}

/**
 * Convenience hooks for common operations
 */

/**
 * Hook to get unread count
 */
export const useUnreadCount = () => useNotificationCenterStore((s) => s.getUnreadCount());

/**
 * Hook to get notifications
 */
export const useNotifications = () => useNotificationCenterStore((s) => s.notifications);

/**
 * Hook to check if panel is open
 */
export const useNotificationCenterOpen = () => useNotificationCenterStore((s) => s.isOpen);

/**
 * Helper function to add a notification with predefined priority
 */
export const addSuccessNotification = async (
  title: string,
  message?: string,
  priority: NotificationPriority = "low"
) => {
  return await useNotificationCenterStore.getState().addNotification({
    type: "success",
    priority,
    title,
    message,
  });
};

export const addErrorNotification = async (
  title: string,
  message?: string,
  priority: NotificationPriority = "high"
) => {
  return await useNotificationCenterStore.getState().addNotification({
    type: "error",
    priority,
    title,
    message,
  });
};

export const addWarningNotification = async (
  title: string,
  message?: string,
  priority: NotificationPriority = "medium"
) => {
  return await useNotificationCenterStore.getState().addNotification({
    type: "warning",
    priority,
    title,
    message,
  });
};

export const addInfoNotification = async (
  title: string,
  message?: string,
  priority: NotificationPriority = "low"
) => {
  return await useNotificationCenterStore.getState().addNotification({
    type: "info",
    priority,
    title,
    message,
  });
};

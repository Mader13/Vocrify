/**
 * Hook for working with notification center
 * @module notification-center/use-notification-center
 */

import { useNotificationCenterStore } from "./store";
import type { NotificationPriority } from "./types";

/**
 * Hook for managing notification center
 * Provides convenient methods for adding notifications
 */
export function useNotificationCenter() {
  const {
    notifications,
    isOpen,
    addNotification,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll,
    toggle,
    open,
    close,
    getUnreadCount,
  } = useNotificationCenterStore();

  return {
    notifications,
    isOpen,
    unreadCount: getUnreadCount(),
    toggle,
    open,
    close,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll,

    // Convenience methods for adding notifications (async)
    success: (title: string, message?: string, priority?: NotificationPriority) =>
      addNotification({ type: "success", title, message, priority: priority || "low" }),

    error: (title: string, message?: string, priority?: NotificationPriority) =>
      addNotification({ type: "error", title, message, priority: priority || "high" }),

    warning: (title: string, message?: string, priority?: NotificationPriority) =>
      addNotification({ type: "warning", title, message, priority: priority || "medium" }),

    info: (title: string, message?: string, priority?: NotificationPriority) =>
      addNotification({ type: "info", title, message, priority: priority || "low" }),
  };
}

/**
 * React Hook for Notifications
 *
 * Provides a convenient React hook for accessing the UI notification store.
 */

import { useNotificationStore as useUINotificationStore } from "@/components/ui/notifications";

/**
 * React hook for accessing notifications.
 *
 * @example
 * ```tsx
 * const { notifications, success, error, dismiss } = useNotifications();
 * ```
 */
export function useNotifications() {
  return useUINotificationStore();
}

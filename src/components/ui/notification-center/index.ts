/**
 * Notification Center UI Components
 * @module notification-center
 */

export { NotificationCenterButton } from "./notification-center-button";
export { NotificationCenterPanel } from "./notification-center-panel";
export { NotificationListItem } from "./notification-list-item";
export { useNotificationCenter } from "./use-notification-center";
export { useNotificationCenterStore, useUnreadCount, useNotifications, useNotificationCenterOpen, initializeNotifications } from "./store";
export type { PersistentNotification, NotificationCenterState, NotificationPriority } from "./types";

// Convenience functions for adding notifications
export {
  addSuccessNotification,
  addErrorNotification,
  addWarningNotification,
  addInfoNotification,
} from "./store";

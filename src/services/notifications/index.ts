/**
 * Notification Service — barrel re-exports.
 *
 * All consumers should import from `@/services/notifications`.
 * Internal modules live in separate files for maintainability.
 */

// ---------------------------------------------------------------------------
// Settings store
// ---------------------------------------------------------------------------
export {
  useNotificationSettingsStore,
  useNotificationStore,
  type NotificationSettingsState,
} from "./notification-settings";

// ---------------------------------------------------------------------------
// Emitter (Tauri event → UI toast bridge)
// ---------------------------------------------------------------------------
export {
  NotificationEmitter,
  type NotificationEmitterConfig,
  getNotificationEmitter,
  initializeNotifications,
  destroyNotifications,
} from "./notification-emitter";

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------
export {
  notifySuccess,
  notifyError,
  notifyWarning,
  notifyInfo,
  notifyProgress,
  updateNotification,
  dismissNotification,
  clearAllNotifications,
  emitModelDownloadNotification,
  emitTranscriptionNotification,
  setupGlobalErrorNotifications,
} from "./notification-helpers";

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------
export { useNotifications } from "./useNotifications";

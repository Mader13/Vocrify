/**
 * Notification Service - barrel re-exports.
 *
 * All consumers should import from `@/services/notifications`.
 * Internal modules live in separate files for maintainability.
 */

// ---------------------------------------------------------------------------
// Settings store
// ---------------------------------------------------------------------------
export {
  useNotificationSettingsStore,
  type NotificationSettingsState,
  showNotificationWithSettings,
} from "./notification-settings";

export {
  dispatchNotification,
  updateDispatchedNotification,
  dismissDispatchedNotification,
  clearDispatchedNotifications,
  getDispatchedPosition,
  setDispatchedPosition,
  setNotificationDispatcher,
  type NotificationDispatcher,
  type NotificationInput,
  type NotificationUpdate,
} from "./notification-dispatcher";

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

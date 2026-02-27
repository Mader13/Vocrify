/**
 * Zustand store for notification state management
 * @module notifications/store
 */

import { create } from "zustand";
import type {
  Notification,
  NotificationType,
  NotificationPosition,
  QueuedNotification,
} from "./types";

/**
 * Default auto-dismiss duration by notification type (in milliseconds)
 */
const DEFAULT_DURATIONS: Record<NotificationType, number | null> = {
  success: 4000,
  error: 6000,
  warning: 5000,
  info: 4000,
  loading: null, // Loading notifications are persistent by default
};

/**
 * Maximum number of notifications visible at once
 */
const DEFAULT_MAX_VISIBLE = 5;

/**
 * Default position for notification container
 */
const DEFAULT_POSITION: NotificationPosition = "bottom-right";

/**
 * Notification store state and actions
 */
interface NotificationState {
  /** Currently visible notifications */
  notifications: Notification[];
  /** Queue for notifications waiting to be shown (when maxVisible is reached) */
  queue: QueuedNotification[];
  /** Container position on screen */
  position: NotificationPosition;
  /** Maximum number of visible notifications */
  maxVisible: number;

  // Actions

  /**
   * Show a notification with full control over all options
   * @param notification - Notification data (id and createdAt are auto-generated)
   * @returns The ID of the created notification
   */
  show: (notification: Omit<Notification, "id" | "createdAt">) => string;

  /**
   * Show a success notification with default duration
   * @param title - Bold heading text
   * @param message - Optional detailed message
   * @returns The ID of the created notification
   */
  success: (title: string, message?: string) => string;

  /**
   * Show an error notification with longer default duration
   * @param title - Bold heading text
   * @param message - Optional detailed message
   * @returns The ID of the created notification
   */
  error: (title: string, message?: string) => string;

  /**
   * Show a warning notification
   * @param title - Bold heading text
   * @param message - Optional detailed message
   * @returns The ID of the created notification
   */
  warning: (title: string, message?: string) => string;

  /**
   * Show an info notification
   * @param title - Bold heading text
   * @param message - Optional detailed message
   * @returns The ID of the created notification
   */
  info: (title: string, message?: string) => string;

  /**
   * Show a loading notification (persistent by default)
   * @param title - Bold heading text
   * @param message - Optional detailed message
   * @param progress - Optional progress value (0-100)
   * @returns The ID of the created notification
   */
  loading: (title: string, message?: string, progress?: number) => string;

  /**
   * Update an existing notification
   * @param id - Notification ID
   * @param updates - Partial notification data to update
   */
  update: (id: string, updates: Partial<Notification>) => void;

  /**
   * Dismiss a notification by ID
   * @param id - Notification ID to dismiss
   */
  dismiss: (id: string) => void;

  /**
   * Dismiss all notifications
   */
  clear: () => void;

  /**
   * Set the container position for notifications
   * @param position - New position
   */
  setPosition: (position: NotificationPosition) => void;

  /**
   * Set the maximum number of visible notifications
   * @param max - Maximum visible count
   */
  setMaxVisible: (max: number) => void;

  /**
   * Process the queue and show next notifications if slots available
   * @internal
   */
  _processQueue: () => void;
}

/**
 * Create the notification store with all state and actions
 */
export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  queue: [],
  position: DEFAULT_POSITION,
  maxVisible: DEFAULT_MAX_VISIBLE,

  show: (notification) => {
    const id = crypto.randomUUID();
    const now = new Date();

    const newNotification: Notification = {
      id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      duration:
        notification.duration ??
        (notification.type === "loading" ? null : DEFAULT_DURATIONS[notification.type]),
      progress: notification.progress,
      actions: notification.actions,
      createdAt: now,
      ariaLabel: notification.ariaLabel,
    };

    const { notifications, maxVisible, queue } = get();

    // If we haven't reached max visible, show immediately
    if (notifications.length < maxVisible) {
      set({ notifications: [...notifications, newNotification] });

      // Set up auto-dismiss if duration is set
      if (newNotification.duration !== null) {
        setTimeout(() => {
          get().dismiss(id);
        }, newNotification.duration);
      }

      return id;
    }

    // Otherwise, add to queue
    set({
      queue: [...queue, { notification: newNotification }],
    });

    return id;
  },

  success: (title, message) =>
    get().show({
      type: "success",
      title,
      message,
    }),

  error: (title, message) =>
    get().show({
      type: "error",
      title,
      message,
    }),

  warning: (title, message) =>
    get().show({
      type: "warning",
      title,
      message,
    }),

  info: (title, message) =>
    get().show({
      type: "info",
      title,
      message,
    }),

  loading: (title, message, progress) =>
    get().show({
      type: "loading",
      title,
      message,
      progress,
      duration: null, // Loading notifications don't auto-dismiss
    }),

  update: (id, updates) => {
    set((state) => ({
      notifications: state.notifications.map((notification) =>
        notification.id === id ? { ...notification, ...updates } : notification
      ),
      queue: state.queue.map((queued) =>
        queued.notification.id === id
          ? { ...queued, notification: { ...queued.notification, ...updates } }
          : queued
      ),
    }));
  },

  dismiss: (id) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));

    // Process queue after a short delay for exit animation
    setTimeout(() => {
      get()._processQueue();
    }, 300);
  },

  clear: () => {
    set({ notifications: [], queue: [] });
  },

  setPosition: (position) => {
    set({ position });
  },

  setMaxVisible: (max) => {
    set({ maxVisible: max });
  },

  _processQueue: () => {
    const { queue, notifications, maxVisible } = get();

    // If queue is empty or we're at max capacity, do nothing
    if (queue.length === 0 || notifications.length >= maxVisible) {
      return;
    }

    // Take the next notification from the queue
    const [nextItem, ...remainingQueue] = queue;
    set({
      queue: remainingQueue,
      notifications: [...notifications, nextItem.notification],
    });

    // Set up auto-dismiss if duration is set
    if (nextItem.notification.duration !== null) {
      setTimeout(() => {
        get().dismiss(nextItem.notification.id);
      }, nextItem.notification.duration);
    }
  },
}));

/**
 * Hook alias for the notification store
 * Provides a more semantic name for consumers
 */
export const useNotifications = useNotificationStore;

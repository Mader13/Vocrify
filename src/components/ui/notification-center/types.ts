/**
 * Notification Center type definitions
 * @module notification-center/types
 */

/**
 * Available notification types
 */
export type NotificationCenterType =
  | "success"  // Green checkmark, used for successful operations
  | "error"    // Red error icon, used for failures
  | "warning"  // Amber warning icon, used for cautionary messages
  | "info"     // Blue info icon, used for informational messages
  | "loading"; // Blue with spinner, used for async operations in progress

/**
 * Priority level for notifications
 */
export type NotificationPriority = "low" | "medium" | "high";

/**
 * Persistent notification data structure
 */
export interface PersistentNotification {
  /** Unique identifier (UUID) */
  id: string;
  /** Type determines the visual style and icon */
  type: NotificationCenterType;
  /** Priority level */
  priority: NotificationPriority;
  /** Bold heading text */
  title: string;
  /** Optional detailed message */
  message?: string;
  /** When the notification was created */
  createdAt: Date;
  /** Whether the user has read this notification */
  read: boolean;
  /** Optional link to navigate to */
  actionLink?: string;
  /** Optional action label */
  actionLabel?: string;
}

/**
 * Notification center state
 */
export interface NotificationCenterState {
  /** List of persistent notifications */
  notifications: PersistentNotification[];
  /** Whether the notification center panel is open */
  isOpen: boolean;

  // Actions

  /**
   * Add a new notification (async for Tauri Store persistence)
   */
  addNotification: (notification: Omit<PersistentNotification, "id" | "createdAt" | "read">) => Promise<string>;

  /**
   * Mark a notification as read (async for Tauri Store persistence)
   */
  markAsRead: (id: string) => Promise<void>;

  /**
   * Mark all notifications as read (async for Tauri Store persistence)
   */
  markAllAsRead: () => Promise<void>;

  /**
   * Delete a notification (async for Tauri Store persistence)
   */
  deleteNotification: (id: string) => Promise<void>;

  /**
   * Clear all notifications (async for Tauri Store persistence)
   */
  clearAll: () => Promise<void>;

  /**
   * Toggle notification center panel
   */
  toggle: () => void;

  /**
   * Open notification center panel
   */
  open: () => void;

  /**
   * Close notification center panel
   */
  close: () => void;

  /**
   * Get count of unread notifications
   */
  getUnreadCount: () => number;
}

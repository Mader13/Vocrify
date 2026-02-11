/**
 * Notification type definitions
 * @module notifications/types
 */

/**
 * Available notification types
 * Each type has its own visual style and icon
 */
export type NotificationType =
  | "success"  // Green checkmark, used for successful operations
  | "error"    // Red error icon, used for failures
  | "warning"  // Amber warning icon, used for cautionary messages
  | "info"     // Blue info icon, used for informational messages
  | "loading"; // Blue with spinner, used for async operations in progress

/**
 * Notification container position on screen
 */
export type NotificationPosition =
  | "top-right"
  | "top-left"
  | "bottom-right"
  | "bottom-left"
  | "top-center"
  | "bottom-center";

/**
 * Action button variant for notification actions
 */
export type NotificationActionVariant = "primary" | "secondary" | "destructive";

/**
 * Action button that can be attached to a notification
 */
export interface NotificationAction {
  /** Display label for the button */
  label: string;
  /** Click handler */
  onClick: () => void;
  /** Button style variant */
  variant?: NotificationActionVariant;
}

/**
 * Individual notification data structure
 */
export interface Notification {
  /** Unique identifier (UUID) */
  id: string;
  /** Type determines the visual style and icon */
  type: NotificationType;
  /** Bold heading text */
  title: string;
  /** Optional detailed message */
  message?: string;
  /** Auto-dismiss duration in ms, null for persistent (manual close only) */
  duration?: number | null;
  /** Progress value 0-100 for progress notifications */
  progress?: number;
  /** Optional action buttons */
  actions?: NotificationAction[];
  /** When the notification was created */
  createdAt: Date;
  /** ARIA label for accessibility */
  ariaLabel?: string;
}

/**
 * Notification queue item for managing max visible notifications
 */
export interface QueuedNotification {
  notification: Notification;
  timeoutId?: ReturnType<typeof setTimeout>;
}

/**
 * Internal notification state with animation tracking
 */
export interface NotificationWithAnimation extends Notification {
  /** Is notification currently animating in */
  isAnimatingIn?: boolean;
  /** Is notification currently hovered (pauses auto-dismiss) */
  isHovered?: boolean;
}

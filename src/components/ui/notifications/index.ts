/**
 * Notification system exports
 * @module notifications
 *
 * A comprehensive notification system for React applications
 * featuring auto-dismiss, progress tracking, action buttons,
 * keyboard accessibility, and smooth animations.
 *
 * @example
 * ```tsx
 * // App.tsx - Add provider near root
 * import { NotificationProvider } from "@/components/ui/notifications";
 *
 * function App() {
 *   return (
 *     <>
 *       <NotificationProvider />
 *       {/* Your app content *\/}
 *     </>
 *   );
 * }
 *
 * // In any component
 * import { useNotify } from "@/components/ui/notifications";
 *
 * function MyComponent() {
 *   const notify = useNotify();
 *
 *   const handleClick = () => {
 *     notify.success("Operation completed!");
 *   };
 *
 *   return <button onClick={handleClick}>Click me</button>;
 * }
 * ```
 */

// Types
export type {
  Notification,
  NotificationType,
  NotificationPosition,
  NotificationAction,
  NotificationActionVariant,
  QueuedNotification,
  NotificationWithAnimation,
} from "./types";

// Store
export { useNotificationStore, useNotifications } from "./notification-store";

// Components
export { NotificationItem } from "./notification-item";
export {
  NotificationContainer,
  NotificationProvider,
} from "./notification-container";

// Hooks
export {
  useNotify,
  useLoadingNotification,
  useConfirmNotification,
  useValidationNotification,
} from "./use-notifications";

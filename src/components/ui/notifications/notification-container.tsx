/**
 * Notification container component
 * Manages positioning and animation of multiple notifications
 * @module notifications/container
 */

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { NotificationItem } from "./notification-item";
import { useNotificationStore } from "./notification-store";
import type { NotificationAction, NotificationPosition } from "./types";

/**
 * Position-specific container styles
 */
const positionStyles: Record<
  NotificationPosition,
  {
    container: string;
    item: "top" | "bottom" | "center";
  }
> = {
  "top-right": {
    container: "top-4 right-4 flex-col items-end",
    item: "top",
  },
  "top-left": {
    container: "top-4 left-4 flex-col items-start",
    item: "top",
  },
  "top-center": {
    container: "top-4 left-1/2 -translate-x-1/2 flex-col items-center",
    item: "top",
  },
  "bottom-right": {
    container: "bottom-4 right-4 flex-col-reverse items-end",
    item: "bottom",
  },
  "bottom-left": {
    container: "bottom-4 left-4 flex-col-reverse items-start",
    item: "bottom",
  },
  "bottom-center": {
    container: "bottom-4 left-1/2 -translate-x-1/2 flex-col-reverse items-center",
    item: "bottom",
  },
};

/**
 * Container gap for stack animations
 */
const STACK_GAP = 12;

export interface NotificationContainerProps {
  /** Override the position from store */
  position?: NotificationPosition;
  /** Maximum width for notifications */
  maxWidth?: string;
  /** Additional class names */
  className?: string;
  /** Custom class for notification items */
  notificationClassName?: string;
  /** Callback when notification is dismissed */
  onDismiss?: (id: string) => void;
  /** Callback when action is clicked */
  onActionClick?: (action: NotificationAction, notificationId: string) => void;
}

/**
 * Notification container component
 *
 * Features:
 * - Position-based layout (6 positions available)
 * - AnimatePresence for smooth enter/exit
 * - Stack animations with proper spacing
 * - Responsive design (adjusts on mobile)
 * - Keyboard accessible (ESC to dismiss all)
 */
export const NotificationContainer = React.memo(
  ({
    position: positionProp,
    maxWidth = "420px",
    className,
    onDismiss,
    onActionClick,
  }: NotificationContainerProps) => {
    const storePosition = useNotificationStore((state) => state.position);
    const notifications = useNotificationStore((state) => state.notifications);
    const dismiss = useNotificationStore((state) => state.dismiss);

    const position = positionProp ?? storePosition;
    const styles = positionStyles[position];

    // Handle keyboard dismiss for all notifications
    React.useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape" && notifications.length > 0) {
          // Dismiss the most recent notification
          const mostRecent = notifications[notifications.length - 1];
          dismiss(mostRecent.id);
          onDismiss?.(mostRecent.id);
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [notifications, dismiss, onDismiss]);

    const handleDismiss = React.useCallback(
      (id: string) => {
        dismiss(id);
        onDismiss?.(id);
      },
      [dismiss, onDismiss]
    );

    const handleActionClick = React.useCallback(
      (action: NotificationAction, notificationId: string) => {
        onActionClick?.(action, notificationId);
      },
      [onActionClick]
    );

    return (
      <div
        className={cn(
          "fixed z-50 flex gap-3 p-4 pointer-events-none",
          "max-[640px]:!left-4 max-[640px]:!right-4 max-[640px]:!translate-x-0",
          styles.container,
          className
        )}
        style={{ maxWidth: "calc(100vw - 2rem)" }}
        role="region"
        aria-label="Notifications"
        aria-live="polite"
      >
        <AnimatePresence mode="popLayout">
          {notifications.map((notification, index) => (
            <motion.div
              key={notification.id}
              layout
              className="pointer-events-auto"
              style={{
                maxWidth,
                marginBottom:
                  styles.item === "top" && index < notifications.length - 1
                    ? STACK_GAP
                    : undefined,
                marginTop:
                  styles.item === "bottom" && index < notifications.length - 1
                    ? STACK_GAP
                    : undefined,
              }}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{
                opacity: 1,
                scale: 1,
              }}
              exit={{
                opacity: 0,
                scale: 0.9,
                transition: { duration: 0.2 },
              }}
              transition={{
                type: "spring",
                damping: 25,
                stiffness: 300,
              }}
            >
              <NotificationItem
                notification={notification}
                position={styles.item}
                index={0}
                onDismiss={handleDismiss}
                onActionClick={handleActionClick}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    );
  }
);

NotificationContainer.displayName = "NotificationContainer";

/**
 * Provider component that renders the notification container
 * Place this near the root of your app
 */
export const NotificationProvider: React.FC<
  Omit<NotificationContainerProps, "position"> & { children?: React.ReactNode }
> = (props) => {
  const { children, ...containerProps } = props;
  return (
    <>
      <NotificationContainer {...containerProps} />
      {children}
    </>
  );
};

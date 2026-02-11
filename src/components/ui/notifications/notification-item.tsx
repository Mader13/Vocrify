/**
 * Individual notification component with animations and interactions
 * @module notifications/item
 */

import * as React from "react";
import { motion } from "framer-motion";
import { cva } from "class-variance-authority";
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
  Loader2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Notification, NotificationAction } from "./types";

/**
 * Animation spring configuration for smooth, natural motion
 */
const SPRING_CONFIG = {
  type: "spring" as const,
  damping: 25,
  stiffness: 300,
};

/**
 * Slide and fade animation variants for different positions
 */
const getVariants = (position: "top" | "bottom" | "center", index: number) => {
  const isTop = position === "top";
  const yOffset = isTop ? -50 : 50;
  const staggerDelay = index * 50;

  return {
    enter: {
      y: yOffset,
      opacity: 0,
      scale: 0.95,
    },
    center: {
      y: 0,
      opacity: 1,
      scale: 1,
      transition: {
        ...SPRING_CONFIG,
        delay: staggerDelay / 1000,
      },
    },
    exit: {
      y: yOffset,
      opacity: 0,
      scale: 0.95,
      transition: {
        duration: 0.2,
        ease: "easeIn" as const,
      },
    },
  };
};

/**
 * Icon mapping for each notification type
 */
const NOTIFICATION_ICONS: Record<
  Notification["type"],
  React.ComponentType<{ className?: string }>
> = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  loading: Loader2,
};

/**
 * Notification item variants using CVA
 */
const notificationVariants = cva(
  [
    "relative flex items-start gap-3 p-4 rounded-lg border shadow-lg backdrop-blur-sm",
    "min-w-[320px] max-w-[420px] w-full",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  ],
  {
    variants: {
      variant: {
        success: [
          "bg-background/95 border-[color:var(--status-completed)]/30",
          "text-foreground",
        ],
        error: [
          "bg-background/95 border-[color:var(--status-failed)]/50",
          "text-foreground",
        ],
        warning: [
          "bg-background/95 border-[color:var(--status-queued)]/40",
          "text-foreground",
        ],
        info: [
          "bg-background/95 border-[color:var(--status-processing)]/30",
          "text-foreground",
        ],
        loading: [
          "bg-background/95 border-[color:var(--status-processing)]/30",
          "text-foreground",
        ],
      },
    },
    defaultVariants: {
      variant: "info",
    },
  }
);

/**
 * Action button variants
 */
const actionButtonVariants = cva(
  [
    "inline-flex items-center justify-center rounded-md text-sm font-medium",
    "transition-colors focus-visible:outline-none focus-visible:ring-2",
    "focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
    "px-3 py-1.5 h-auto",
  ],
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
      },
    },
    defaultVariants: {
      variant: "secondary",
    },
  }
);

/**
 * Progress bar color by notification type
 */
const getProgressColor = (type: Notification["type"]): string => {
  const colors: Record<Notification["type"], string> = {
    success: "oklch(0.652 0.177 142.50)", // --status-completed
    error: "oklch(0.5778 0.2236 27.6936)", // --status-failed
    warning: "oklch(0.721 0.151 68.96)", // --status-queued
    info: "oklch(0.627 0.195 253.21)", // --status-processing
    loading: "oklch(0.627 0.195 253.21)", // --status-processing
  };
  return colors[type];
};

export interface NotificationItemProps {
  /** The notification to display */
  notification: Notification;
  /** Container position for animation direction */
  position?: "top" | "bottom" | "center";
  /** Index for staggered animations */
  index?: number;
  /** Callback when notification is dismissed */
  onDismiss: (id: string) => void;
  /** Callback when action is clicked */
  onActionClick?: (action: NotificationAction, notificationId: string) => void;
}

/**
 * Individual notification component
 *
 * Features:
 * - Icon based on type (with spinner animation for loading)
 * - Progress bar when progress prop is provided
 * - Action buttons support
 * - Close button
 * - Countdown indicator for auto-dismiss
 * - Keyboard accessible
 * - Pause auto-dismiss on hover
 */
export const NotificationItem = React.memo(
  ({
    notification,
    position = "top",
    index = 0,
    onDismiss,
    onActionClick,
  }: NotificationItemProps) => {
    const {
      id,
      type,
      title,
      message,
      duration,
      progress,
      actions,
      ariaLabel,
    } = notification;

    const [isHovered, setIsHovered] = React.useState(false);
    const [timeLeft, setTimeLeft] = React.useState(duration ?? 0);
    const [isPaused, setIsPaused] = React.useState(false);

    const IconComponent = NOTIFICATION_ICONS[type];
    const isLoading = type === "loading";
    const hasProgress = typeof progress === "number" && progress >= 0 && progress <= 100;

    // Handle countdown for auto-dismiss
    React.useEffect(() => {
      if (duration === null || isPaused || isHovered) return;

      const interval = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 100) {
            onDismiss(id);
            return 0;
          }
          return prev - 100;
        });
      }, 100);

      return () => clearInterval(interval);
    }, [duration, isPaused, isHovered, id, onDismiss]);

    // Reset timer when notification changes
    React.useEffect(() => {
      if (duration != null) {
        setTimeLeft(duration);
      }
    }, [duration]);

    // Handle keyboard dismiss
    const handleKeyDown = React.useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
          onDismiss(id);
        }
      },
      [id, onDismiss]
    );

    // Handle action button click
    const handleActionClick = React.useCallback(
      (action: NotificationAction) => {
        action.onClick();
        onActionClick?.(action, id);
      },
      [id, onActionClick]
    );

    const variants = getVariants(position, index);

    return (
      <motion.div
        variants={variants}
        initial="enter"
        animate="center"
        exit="exit"
        layout
        className={cn(notificationVariants({ variant: type }))}
        onMouseEnter={() => {
          setIsHovered(true);
          if (duration !== null) setIsPaused(true);
        }}
        onMouseLeave={() => {
          setIsHovered(false);
          if (duration !== null) setIsPaused(false);
        }}
        onKeyDown={handleKeyDown}
        role="alert"
        aria-live={type === "error" ? "assertive" : "polite"}
        aria-label={ariaLabel ?? `${type}: ${title}`}
        tabIndex={0}
      >
        {/* Icon */}
        <div className="flex-shrink-0 mt-0.5">
          <IconComponent
            className={cn(
              "w-5 h-5",
              type === "success" && "text-[color:var(--status-completed)]",
              type === "error" && "text-[color:var(--status-failed)]",
              type === "warning" && "text-[color:var(--status-queued)]",
              (type === "info" || type === "loading") && "text-[color:var(--status-processing)]",
              isLoading && "animate-spin"
            )}
            aria-hidden="true"
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-1">
          {/* Title */}
          <p className="text-sm font-semibold leading-tight">{title}</p>

          {/* Message */}
          {message && (
            <p className="text-sm text-muted-foreground leading-snug">{message}</p>
          )}

          {/* Progress bar */}
          {hasProgress && (
            <div className="mt-2">
              <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <motion.div
                  className="absolute inset-y-0 left-0 h-full rounded-full"
                  style={{ backgroundColor: getProgressColor(type) }}
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground text-right">
                {Math.round(progress)}%
              </p>
            </div>
          )}

          {/* Action buttons */}
          {actions && actions.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {actions.map((action, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleActionClick(action)}
                  className={actionButtonVariants({
                    variant: action.variant ?? "secondary",
                  })}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Close button */}
        <button
          type="button"
          onClick={() => onDismiss(id)}
          className={cn(
            "flex-shrink-0 rounded-md p-1",
            "text-muted-foreground hover:text-foreground",
            "hover:bg-accent/50",
            "transition-colors focus-visible:outline-none focus-visible:ring-2",
            "focus-visible:ring-ring"
          )}
          aria-label="Dismiss notification"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Countdown indicator (thin bar at bottom) */}
        {duration !== null && !hasProgress && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-muted overflow-hidden rounded-b-lg">
            <motion.div
              className="h-full bg-current opacity-30"
              initial={{ width: "100%" }}
              animate={{
                width: isPaused || isHovered ? `${(timeLeft / duration!) * 100}%` : "0%",
              }}
              transition={{
                duration: isPaused || isHovered ? 0.3 : timeLeft / 1000,
                ease: "linear",
              }}
            />
          </div>
        )}
      </motion.div>
    );
  }
);

NotificationItem.displayName = "NotificationItem";

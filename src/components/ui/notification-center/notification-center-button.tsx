/**
 * Notification Center Button Component
 * @module notification-center/notification-center-button
 */

import * as React from "react";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUnreadCount } from "./store";

interface NotificationCenterButtonProps {
  className?: string;
  size?: "sm" | "md" | "lg";
}

const sizeMap = {
  sm: "h-8 w-8",
  md: "h-9 w-9",
  lg: "h-10 w-10",
};

const iconSizeMap = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-5 w-5",
};

export function NotificationCenterButton({
  className,
  size = "md",
}: NotificationCenterButtonProps) {
  const unreadCount = useUnreadCount();
  const buttonRef = React.useRef<HTMLButtonElement>(null);

  return (
    <button
      ref={buttonRef}
      type="button"
      className={cn(
        "relative inline-flex items-center justify-center",
        "rounded-md transition-colors",
        "hover:bg-accent hover:text-accent-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        sizeMap[size],
        className
      )}
      aria-label={`Уведомления${unreadCount > 0 ? ` (${unreadCount} непрочитанных)` : ""}`}
    >
      <Bell className={iconSizeMap[size]} />

      {/* Badge for unread count */}
      {unreadCount > 0 && (
        <span
          className={cn(
            "absolute -top-1 -right-1",
            "flex h-5 min-w-[1.25rem] items-center justify-center",
            "rounded-full bg-destructive px-1",
            "text-[10px] font-medium text-destructive-foreground",
            "transition-all",
            "animate-in zoom-in duration-200"
          )}
          aria-label={`${unreadCount} непрочитанных уведомлений`}
        >
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </button>
  );
}

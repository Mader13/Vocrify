/**
 * Notification List Item Component
 * @module notification-center/notification-list-item
 */

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "@/lib/date-utils";
import { CheckCircle, XCircle, AlertTriangle, Info, Loader2, X } from "lucide-react";
import type { PersistentNotification } from "./types";

interface NotificationListItemProps {
  notification: PersistentNotification;
  onMarkAsRead: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  index?: number;
}

const iconMap = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
  loading: Loader2,
};

const colorMap = {
  success: "text-green-500",
  error: "text-red-500",
  warning: "text-amber-500",
  info: "text-blue-500",
  loading: "text-blue-500",
};

const bgColorMap = {
  success: "bg-green-50 dark:bg-green-950",
  error: "bg-red-50 dark:bg-red-950",
  warning: "bg-amber-50 dark:bg-amber-950",
  info: "bg-blue-50 dark:bg-blue-950",
  loading: "bg-blue-50 dark:bg-blue-950",
};

const priorityBadgeMap = {
  low: null,
  medium: "text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground",
  high: "text-xs bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded",
};

export function NotificationListItem({
  notification,
  onMarkAsRead,
  onDelete,
  index = 0,
}: NotificationListItemProps) {
  const Icon = iconMap[notification.type];
  const colorClass = colorMap[notification.type];
  const bgColorClass = bgColorMap[notification.type];
  const priorityBadge = priorityBadgeMap[notification.priority];
  const [isOperating, setIsOperating] = React.useState(false);

  const handleClick = () => {
    if (!notification.read && !isOperating) {
      setIsOperating(true);
      onMarkAsRead(notification.id).finally(() => setIsOperating(false));
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isOperating) {
      setIsOperating(true);
      onDelete(notification.id).finally(() => setIsOperating(false));
    }
  };

  const timeAgo = formatDistanceToNow(new Date(notification.createdAt));

  // Staggered animation delay (max 10 items for performance)
  const animationDelay = Math.min(index * 0.03, 0.3);

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        delay: animationDelay,
        duration: 0.25,
        ease: "easeOut",
      }}
      className={cn(
        "group relative flex items-start gap-3 p-3 rounded-lg transition-all cursor-pointer",
        "hover:bg-accent/50",
        !notification.read && "bg-accent/30",
        bgColorClass,
        !notification.read && "border-l-2 border-l-primary",
        isOperating && "opacity-70"
      )}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label={`Уведомление: ${notification.title}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      {/* Icon */}
      <div className={cn("flex-shrink-0 mt-0.5", colorClass)}>
        <Icon className="h-5 w-5" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h4 className={cn(
            "text-sm font-medium truncate",
            !notification.read && "font-semibold"
          )}>
            {notification.title}
          </h4>
          {priorityBadge && (
            <span className={priorityBadge}>
              {notification.priority === "high" ? "Важно" : "Среднее"}
            </span>
          )}
        </div>

        {notification.message && (
          <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
            {notification.message}
          </p>
        )}

        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-xs text-muted-foreground">
            {timeAgo}
          </span>
          {!notification.read && (
            <span className="text-xs text-primary font-medium">
              Новое
            </span>
          )}
        </div>
      </div>

      {/* Delete button */}
      <button
        onClick={handleDelete}
        disabled={isOperating}
        className={cn(
          "flex-shrink-0 opacity-0 group-hover:opacity-100",
          "p-1 rounded-md transition-all",
          "hover:bg-destructive/10 hover:text-destructive",
          "focus-visible:opacity-100 focus-visible:outline-none",
          "disabled:opacity-50 disabled:cursor-not-allowed"
        )}
        aria-label="Удалить уведомление"
      >
        <X className="h-4 w-4" />
      </button>
    </motion.div>
  );
}

/**
 * Notification Center Panel Component
 * @module notification-center/notification-center-panel
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { Check, Trash2, Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNotificationCenterStore } from "./store";
import { NotificationListItem } from "./notification-list-item";

interface NotificationCenterPanelProps {
  /** Element that triggers the panel */
  children: React.ReactNode;
  /** Optional className for the trigger */
  triggerClassName?: string;
}

export function NotificationCenterPanel({
  children,
  triggerClassName,
}: NotificationCenterPanelProps) {
  const {
    notifications,
    isOpen,
    toggle,
    close,
    markAllAsRead,
    clearAll,
    markAsRead,
    deleteNotification,
  } = useNotificationCenterStore();

  const panelRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const [isOperating, setIsOperating] = React.useState(false);

  // Handle click outside to close
  React.useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        close();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, close]);

  // Mark all as read when opening
  React.useEffect(() => {
    if (isOpen && notifications.some(n => !n.read)) {
      markAllAsRead().catch(console.error);
    }
  }, [isOpen, notifications, markAllAsRead]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleClearAll = async () => {
    setIsOperating(true);
    try {
      await clearAll();
    } finally {
      setIsOperating(false);
    }
  };

  const handleMarkAllAsRead = async () => {
    setIsOperating(true);
    try {
      await markAllAsRead();
    } finally {
      setIsOperating(false);
    }
  };

  return (
    <div className="relative">
      {/* Trigger */}
      <div
        ref={triggerRef}
        onClick={toggle}
        className={cn("cursor-pointer", triggerClassName)}
        role="button"
        tabIndex={0}
        aria-label="Открыть центр уведомлений"
        aria-expanded={isOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
      >
        {children}
      </div>

      {/* Panel */}
      {isOpen && (
        <div
          ref={panelRef}
          className={cn(
            "absolute right-0 top-full mt-2 z-50",
            "w-full sm:w-80 md:w-96",
            "bg-background border rounded-lg shadow-lg",
            "overflow-hidden"
          )}
          role="dialog"
          aria-modal="false"
          aria-label="Центр уведомлений"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b">
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-muted-foreground" />
              <h3 className="font-semibold">Уведомления</h3>
              {unreadCount > 0 && (
                <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
                  {unreadCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {notifications.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClearAll();
                  }}
                  disabled={isOperating}
                  aria-label="Очистить все уведомления"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={(e) => {
                  e.stopPropagation();
                  close();
                }}
                aria-label="Закрыть"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Content */}
          <div className="max-h-96">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                  <Bell className="h-8 w-8 text-muted-foreground" />
                </div>
                <h4 className="font-medium mb-1">Нет уведомлений</h4>
                <p className="text-sm text-muted-foreground">
                  Здесь будут отображаться ваши уведомления
                </p>
              </div>
            ) : (
              <ScrollArea className="h-96">
                <div className="p-2 space-y-1">
                  {notifications.map((notification) => (
                    <NotificationListItem
                      key={notification.id}
                      notification={notification}
                      onMarkAsRead={markAsRead}
                      onDelete={deleteNotification}
                    />
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Footer with Mark all as read button */}
          {notifications.length > 0 && unreadCount > 0 && (
            <div className="p-3 border-t bg-muted/30">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2"
                onClick={(e) => {
                  e.stopPropagation();
                  handleMarkAllAsRead();
                }}
                disabled={isOperating}
              >
                <Check className="h-4 w-4" />
                Отметить все как прочитанные
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

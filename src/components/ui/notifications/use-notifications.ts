/**
 * React hooks for easy notification usage
 * @module notifications/hooks
 */

import { useCallback } from "react";
import { useNotificationStore } from "./notification-store";
import type { NotificationAction } from "./types";

/**
 * Full notification store hook
 * Provides access to all notifications and actions
 *
 * @example
 * ```tsx
 * const { notifications, success, error, dismiss } = useNotifications();
 *
 * const handleSuccess = () => {
 *   const id = success("Operation completed", "Your changes have been saved");
 * };
 * ```
 */
export const useNotifications = useNotificationStore;

/**
 * Simplified notification hook
 * Returns only the notification methods for quick usage
 *
 * @example
 * ```tsx
 * const notify = useNotify();
 *
 * // Simple notifications
 * notify.success("Saved successfully");
 * notify.error("Something went wrong");
 * notify.warning("Check your input");
 * notify.info("New message received");
 *
 * // With custom options
 * notify.loading("Processing...", "Please wait", 50);
 *
 * // With actions
 * notify.show({
 *   type: "warning",
 *   title: "Unsaved changes",
 *   message: "You have unsaved changes. Do you want to save them?",
 *   actions: [
 *     { label: "Save", onClick: handleSave, variant: "primary" },
 *     { label: "Discard", onClick: handleDiscard, variant: "destructive" },
 *   ],
 *   duration: null, // Persistent
 * });
 * ```
 */
export const useNotify = () => {
  const store = useNotificationStore();

  return {
    /**
     * Show a success notification
     * @param title - Bold heading text
     * @param message - Optional detailed message
     * @returns Notification ID
     */
    success: useCallback(
      (title: string, message?: string) => store.success(title, message),
      [store]
    ),

    /**
     * Show an error notification
     * @param title - Bold heading text
     * @param message - Optional detailed message
     * @returns Notification ID
     */
    error: useCallback(
      (title: string, message?: string) => store.error(title, message),
      [store]
    ),

    /**
     * Show a warning notification
     * @param title - Bold heading text
     * @param message - Optional detailed message
     * @returns Notification ID
     */
    warning: useCallback(
      (title: string, message?: string) => store.warning(title, message),
      [store]
    ),

    /**
     * Show an info notification
     * @param title - Bold heading text
     * @param message - Optional detailed message
     * @returns Notification ID
     */
    info: useCallback(
      (title: string, message?: string) => store.info(title, message),
      [store]
    ),

    /**
     * Show a loading notification (persistent by default)
     * @param title - Bold heading text
     * @param message - Optional detailed message
     * @param progress - Optional progress value (0-100)
     * @returns Notification ID
     */
    loading: useCallback(
      (title: string, message?: string, progress?: number) =>
        store.loading(title, message, progress),
      [store]
    ),

    /**
     * Show a custom notification with full control
     * @param config - Notification configuration (excluding id and createdAt)
     * @returns Notification ID
     */
    show: useCallback(
      (config: {
        type: "success" | "error" | "warning" | "info" | "loading";
        title: string;
        message?: string;
        duration?: number | null;
        progress?: number;
        actions?: NotificationAction[];
        ariaLabel?: string;
      }) => store.show(config),
      [store]
    ),

    /**
     * Update an existing notification
     * @param id - Notification ID
     * @param updates - Partial notification data to update
     */
    update: useCallback(
      (id: string, updates: Parameters<typeof store.update>[1]) =>
        store.update(id, updates),
      [store]
    ),

    /**
     * Dismiss a notification by ID
     * @param id - Notification ID to dismiss
     */
    dismiss: useCallback(
      (id: string) => store.dismiss(id),
      [store]
    ),

    /**
     * Dismiss all notifications
     */
    clear: useCallback(() => store.clear(), [store]),

    /**
     * Set the container position for notifications
     * @param position - New position
     */
    setPosition: useCallback(
      (position: "top-right" | "top-left" | "bottom-right" | "bottom-left" | "top-center" | "bottom-center") =>
        store.setPosition(position),
      [store]
    ),
  };
};

/**
 * Hook for managing loading state with automatic notifications
 * Wraps an async operation with loading notifications
 *
 * @example
 * ```tsx
 * const withLoadingNotification = useLoadingNotification();
 *
 * const handleSave = async () => {
 *   await withLoadingNotification(
 *     async () => {
 *       await saveData();
 *       return { type: 'success', title: 'Saved!' };
 *     },
 *     'Saving...',
 *     'Please wait while we save your changes'
 *   );
 * };
 * ```
 */
export const useLoadingNotification = () => {
  const notify = useNotify();

  const withLoadingNotification = useCallback(
    async <T,>(
      operation: () => Promise<{ type: "success" | "error" | "warning" | "info"; title: string; message?: string } | T>,
      loadingTitle: string = "Processing...",
      loadingMessage?: string
    ): Promise<T | null> => {
      const id = notify.loading(loadingTitle, loadingMessage);

      try {
        const result = await operation();

        // Handle different return types
        if (result && typeof result === "object" && "type" in result) {
          // Operation returned a notification config
          const { type, title, message } = result;
          notify[type](title, message);
          return null;
        }

        // Operation returned data directly
        return result;
      } catch (error) {
        notify.error(
          "Operation failed",
          error instanceof Error ? error.message : "An unexpected error occurred"
        );
        return null;
      } finally {
        // Dismiss the loading notification
        notify.update(id, { duration: 0 });
        setTimeout(() => notify.dismiss(id), 100);
      }
    },
    [notify]
  );

  return withLoadingNotification;
};

/**
 * Hook for confirming actions with notifications
 * Shows a warning notification with action buttons
 *
 * @example
 * ```tsx
 * const confirmDelete = useConfirmNotification();
 *
 * const handleDelete = () => {
 *   confirmDelete({
 *     title: "Delete item?",
 *     message: "This action cannot be undone.",
 *     confirmLabel: "Delete",
 *     onConfirm: () => deleteItem(),
 *   });
 * };
 * ```
 */
export const useConfirmNotification = () => {
  const notify = useNotify();

  return useCallback(
    (config: {
      title: string;
      message?: string;
      confirmLabel?: string;
      cancelLabel?: string;
      onConfirm: () => void;
      onCancel?: () => void;
      variant?: "primary" | "destructive";
    }) => {
      const {
        title,
        message,
        confirmLabel = "Confirm",
        cancelLabel = "Cancel",
        onConfirm,
        onCancel,
        variant = "destructive",
      } = config;

      notify.show({
        type: "warning",
        title,
        message,
        duration: null,
        actions: [
          {
            label: cancelLabel,
            onClick: () => {
              onCancel?.();
              notify.clear();
            },
            variant: "secondary",
          },
          {
            label: confirmLabel,
            onClick: () => {
              notify.clear();
              onConfirm();
            },
            variant,
          },
        ],
      });
    },
    [notify]
  );
};

/**
 * Hook for form validation notifications
 * Shows error notifications for form validation failures
 *
 * @example
 * ```tsx
 * const { showValidationErrors } = useValidationNotification();
 *
 * const handleSubmit = (errors: Record<string, string>) => {
 *   if (Object.keys(errors).length > 0) {
 *     showValidationErrors(errors);
 *     return;
 *   }
 *   submitForm();
 * };
 * ```
 */
export const useValidationNotification = () => {
  const notify = useNotify();

  const showValidationErrors = useCallback(
    (errors: Record<string, string>, title: string = "Validation errors") => {
      const errorCount = Object.keys(errors).length;
      const firstError = Object.values(errors)[0];

      notify.error(
        title,
        errorCount === 1
          ? firstError
          : `${firstError} (${errorCount} errors total)`
      );
    },
    [notify]
  );

  return { showValidationErrors };
};

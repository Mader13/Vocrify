import {
  useNotificationStore as useUINotificationStore,
  type Notification,
  type NotificationPosition,
} from "@/components/ui/notifications";

export type NotificationInput = Omit<Notification, "id" | "createdAt">;
export type NotificationUpdate = Partial<Notification>;

export interface NotificationDispatcher {
  show: (notification: NotificationInput) => string;
  update: (id: string, updates: NotificationUpdate) => void;
  dismiss: (id: string) => void;
  clear: () => void;
  getPosition: () => NotificationPosition;
  setPosition: (position: NotificationPosition) => void;
}

const defaultNotificationDispatcher: NotificationDispatcher = {
  show: (notification) => useUINotificationStore.getState().show(notification),
  update: (id, updates) => useUINotificationStore.getState().update(id, updates),
  dismiss: (id) => useUINotificationStore.getState().dismiss(id),
  clear: () => useUINotificationStore.getState().clear(),
  getPosition: () => useUINotificationStore.getState().position,
  setPosition: (position) => useUINotificationStore.getState().setPosition(position),
};

let activeNotificationDispatcher: NotificationDispatcher = defaultNotificationDispatcher;

export function setNotificationDispatcher(dispatcher: NotificationDispatcher): () => void {
  activeNotificationDispatcher = dispatcher;
  return () => {
    activeNotificationDispatcher = defaultNotificationDispatcher;
  };
}

export function dispatchNotification(notification: NotificationInput): string {
  return activeNotificationDispatcher.show(notification);
}

export function updateDispatchedNotification(id: string, updates: NotificationUpdate): void {
  activeNotificationDispatcher.update(id, updates);
}

export function dismissDispatchedNotification(id: string): void {
  activeNotificationDispatcher.dismiss(id);
}

export function clearDispatchedNotifications(): void {
  activeNotificationDispatcher.clear();
}

export function getDispatchedPosition(): NotificationPosition {
  return activeNotificationDispatcher.getPosition();
}

export function setDispatchedPosition(position: NotificationPosition): void {
  activeNotificationDispatcher.setPosition(position);
}

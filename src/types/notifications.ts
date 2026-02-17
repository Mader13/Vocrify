export type NotificationPosition =
  | "top-right"
  | "top-left"
  | "bottom-right"
  | "bottom-left"
  | "top-center"
  | "bottom-center";

export type NotificationDuration = number | "infinite";

export type NotificationCategory = "download" | "transcription" | "error" | "info";

export type NotificationVariant = "success" | "error" | "warning" | "info" | "loading";

export interface Notification {
  id: string;
  type: NotificationVariant;
  title: string;
  message?: string;
  duration?: NotificationDuration;
  category?: NotificationCategory;
  variant?: NotificationVariant;
}

export interface NotificationSettings {
  enabled: boolean;
  position: NotificationPosition;
  duration: NotificationDuration;
  soundEnabled: boolean;
  desktopNotificationsEnabled: boolean;
  categories: Record<NotificationCategory, boolean>;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  position: "top-right",
  duration: 4000,
  soundEnabled: false,
  desktopNotificationsEnabled: false,
  categories: {
    download: true,
    transcription: true,
    error: true,
    info: true,
  },
};

export const NOTIFICATION_POSITION_LABELS: Record<NotificationPosition, string> = {
  "top-right": "Top Right",
  "top-left": "Top Left",
  "bottom-right": "Bottom Right",
  "bottom-left": "Bottom Left",
  "top-center": "Top Center",
  "bottom-center": "Bottom Center",
};

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  download: "Model Download",
  transcription: "Transcription",
  error: "Errors",
  info: "Information",
};

export const NOTIFICATION_CATEGORY_ICONS: Record<NotificationCategory, string> = {
  download: "Download",
  transcription: "FileText",
  error: "AlertCircle",
  info: "Info",
};

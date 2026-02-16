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
  "top-right": "Сверху справа",
  "top-left": "Сверху слева",
  "bottom-right": "Снизу справа",
  "bottom-left": "Снизу слева",
  "top-center": "По центру сверху",
  "bottom-center": "По центру снизу",
};

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  download: "Загрузка моделей",
  transcription: "Транскрибация",
  error: "Ошибки",
  info: "Информация",
};

export const NOTIFICATION_CATEGORY_ICONS: Record<NotificationCategory, string> = {
  download: "Download",
  transcription: "FileText",
  error: "AlertCircle",
  info: "Info",
};

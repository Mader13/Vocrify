# Notification Center

Централизованная система уведомлений с историей и отслеживанием прочитанных.

## Особенности

- **История уведомлений** - Все уведомления сохраняются в localStorage
- **Отслеживание прочитанных** - Визуальное отображение новых уведомлений
- **Приоритеты** - low, medium, high
- **Адаптивный UI** - Работает на всех размерах экрана
- **Удаление** - По одному или все сразу

## Использование

### Добавление уведомлений

```tsx
import { useNotificationCenter } from "@/components/ui/notification-center";

function MyComponent() {
  const { success, error, warning, info } = useNotificationCenter();

  const handleSuccess = () => {
    success("Заголовок", "Сообщение", "low");
  };

  const handleError = () => {
    error("Ошибка", "Описание ошибки", "high");
  };

  // ... или напрямую через store
  import { addSuccessNotification } from "@/components/ui/notification-center";

  addSuccessNotification("Транскрипция завершена", "Файл video.txt готов");
}
```

### Компоненты

#### NotificationCenterButton
Кнопка с иконкой колокольчика и бейджем непрочитанных.

```tsx
<NotificationCenterButton size="md" />
```

#### NotificationCenterPanel
Попап со списком уведомлений.

```tsx
<NotificationCenterPanel>
  <NotificationCenterButton />
</NotificationCenterPanel>
```

## API

### useNotificationCenter Hook

```tsx
const {
  notifications,      // Массив уведомлений
  isOpen,            // Открыт ли попап
  unreadCount,       // Количество непрочитанных
  toggle,            // Переключить попап
  open,              // Открыть попап
  close,             // Закрыть попап
  markAsRead,        // Отметить как прочитанное
  markAllAsRead,     // Отметить все как прочитанные
  deleteNotification,// Удалить уведомление
  clearAll,          // Удалить все
  success,           // Добавить success уведомление
  error,             // Добавить error уведомление
  warning,           // Добавить warning уведомление
  info,              // Добавить info уведомление
} = useNotificationCenter();
```

### Типы

```tsx
type NotificationType = "success" | "error" | "warning" | "info" | "loading";
type NotificationPriority = "low" | "medium" | "high";

interface PersistentNotification {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message?: string;
  createdAt: Date;
  read: boolean;
  actionLink?: string;
  actionLabel?: string;
}
```

## Интеграция с транскрибацией

Пример добавления уведомлений при событиях транскрибации:

```tsx
// При завершении транскрибации
addSuccessNotification(
  "Транскрибация завершена",
  `Файл ${fileName} успешно обработан`,
  "low"
);

// При ошибке
addErrorNotification(
  "Ошибка транскрибации",
  error.message,
  "high"
);

// При начале загрузки модели
addInfoNotification(
  "Загрузка модели",
  `Модель ${modelName} загружается...`,
  "medium"
);
```

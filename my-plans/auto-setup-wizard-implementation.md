# Автоматизированный SetupWizard — План реализации (Validated v2)

**Статус:** Провалидирован и готов к поэтапной реализации  
**Дата:** 2026-02-13  
**Автор:** Claude Code Agent + ревью Copilot

---

## Что изменено в v2 (по итогам валидации)

1. **Python-шаг теперь условно-обязательный**: обязателен только для функций, требующих Python (в первую очередь диаризация). Для базовой транскрипции через Rust pipeline пользователь может завершить онбординг без Python.
2. **Стабилизирован UX автопереходов**: автопереход после успеха с задержкой 1.2–1.5 сек и возможностью перейти сразу по кнопке.
3. **Разделены стратегии установки Python по платформам**:
   - Windows: embedded/portable runtime в `AppData/Vocrify/python`
   - macOS/Linux: standalone runtime strategy (не `.pkg`-интерактивный инсталлятор)
4. **Retry/Timeout остаются в оркестрации фронтенда**, backend даёт атомарные команды + события прогресса.
5. **Добавлен контракт событий и state machine для шагов**, чтобы избежать гонок и повторных запусков.

---

## Обзор

Полуавтоматизированный онбординг с приоритетом на **автоматические действия** и минимальное участие пользователя.

- Шаги инфраструктуры (Python/FFmpeg/Devices) запускаются автоматически.
- Пользователь может **пропустить**, **повторить** и **вернуться назад** (когда шаг не в активной установке).
- Финальные шаги (`Optional`, `Summary`) подтверждаются вручную.

---

## Цели

1. Сократить time-to-first-transcription.
2. Минимизировать ручные действия пользователя.
3. Сохранить предсказуемость состояния при ошибках/повторных попытках.
4. Не блокировать сценарий без Python, если пользователь не использует диаризацию.

---

## Архитектура шагов

| Шаг | Название | Тип                       | Описание                                          | Автопереход      |
| --- | -------- | ------------------------- | ------------------------------------------------- | ---------------- |
| 1   | Python   | Автоматический (условный) | Проверка/установка Python runtime для diarization | Да, после успеха |
| 2   | FFmpeg   | Автоматический            | Проверка/скачивание FFmpeg                        | Да, после успеха |
| 3   | Devices  | Автоматический            | Детект доступных вычислительных устройств         | Да, после успеха |
| 4   | Optional | Пользовательский          | HuggingFace token (опционально)                   | Нет              |
| 5   | Summary  | Пользовательский          | Итог, предупреждения, завершение                  | Нет              |

### Логика обязательности Python

- Если пользователь не включает diarization — Python может быть **skipped** без блокировки завершения онбординга.
- Если пользователь включает diarization (в Optional или позже в UI транскрипции) — требуется Python runtime + корректные зависимости.

---

## UX и поведение шагов

### Общие правила

- Автозапуск проверки/установки при входе в шаг.
- После `completed`: автопереход через **1.2–1.5 сек**.
- На шаге всегда видны:
  - текущая стадия,
  - прогресс,
  - текст статуса,
  - действие `Пропустить` (если допустимо),
  - действие `Повторить` (при ошибке).

### Ошибки и retries

Каждый автоматический шаг: до **3 попыток**.

1. Attempt #1 — сразу
2. Attempt #2 — через 2 секунды
3. Attempt #3 — через 5 секунд

После 3 неудач:

- показываем причину ошибки,
- кнопки: `Повторить` (сброс счётчика), `Пропустить шаг`.

### Таймауты

| Шаг     | Таймаут  | Поведение                                      |
| ------- | -------- | ---------------------------------------------- |
| Python  | 12 минут | Предупреждение + `Ждать дальше` / `Пропустить` |
| FFmpeg  | 7 минут  | Предупреждение + `Ждать дальше` / `Пропустить` |
| Devices | 1 минута | Ошибка + Retry                                 |

### Назад

- Доступно только когда шаг **не в состоянии running/installing**.
- Если шаг уже completed/skipped — отображаем сохранённый результат, без автоматического повторного запуска.

---

## UI шагов (обновлённые требования)

### 1) PythonStep

Состояния:

- `checking`: проверка наличия runtime
- `installing`: стадийная установка
- `completed`: готово
- `skipped`: пропущено
- `error`: ошибка после retries

Стадии установки:

1. `downloading_runtime`
2. `extracting_runtime`
3. `bootstrapping_pip`
4. `installing_torch`
5. `installing_deps`
6. `verifying`
7. `complete`

### 2) FFmpegStep

Показывает:

- проценты,
- downloaded/total,
- скорость,
- ETA,
- состояние распаковки/проверки.

### 3) DeviceStep

Показывает:

- список доступных устройств,
- рекомендованное устройство,
- короткую подсказку по приоритету (CUDA > MPS > Vulkan > CPU).

### 4) OptionalStep

- Поле HuggingFace token.
- Подсказка, что токен нужен для pyannote diarization.
- Сохранение токена в backend store.
- Модели НЕ проверяются на этом шаге.

### 5) SummaryStep

Итог:

- Python (installed/skipped/error)
- FFmpeg (installed/skipped/error)
- Devices (detected/fallback)
- HuggingFace token (set/missing)

Если Python skipped:

- явный блок: «Диаризация недоступна до установки Python» + `Установить сейчас`.

---

## State machine (Frontend)

Для каждого шага:

- `idle`
- `running`
- `completed`
- `error`
- `skipped`
- `timed_out`

Переходы:

- `idle -> running` (auto start)
- `running -> completed | error | timed_out | skipped`
- `error -> running` (retry)
- `timed_out -> running | skipped`

Это исключает двойные вызовы и race conditions при автонавигации.

---

## Backend API (Rust) — v2 контракт

### Новые команды

#### `auto_install_python`

```rust
#[tauri::command]
async fn auto_install_python(app: AppHandle, window: Window) -> Result<PythonCheckResult, String>
```

#### `check_and_retry_step`

```rust
#[tauri::command]
async fn check_and_retry_step(step: String, attempt: u32) -> Result<serde_json::Value, String>
```

#### `cancel_setup_step`

```rust
#[tauri::command]
async fn cancel_setup_step(step: String) -> Result<(), String>
```

### События

- `python-install-stage`
- `python-install-progress`
- `python-install-error`
- `python-install-complete`
- `ffmpeg-install-stage`
- `ffmpeg-install-progress`
- `ffmpeg-install-error`
- `ffmpeg-install-complete`

### Обновление `get_python_executable` (приоритет)

1. `AppData/Vocrify/python` runtime
2. `ai-engine/venv`
3. `ai-engine/.venv`
4. project `.venv` / system python

---

## Frontend Store (Zustand)

```typescript
interface SetupStore {
  currentStep: SetupStep;
  stepStates: Record<SetupStep, "idle" | "running" | "completed" | "error" | "skipped" | "timed_out">;

  isAutoMode: true;
  currentAttempt: number;
  stepStartTime: number;
  stepTimeoutMs: number;
  isPaused: boolean;

  installProgress: {
    stage: string;
    percent: number;
    message: string;
    speedMbS?: number;
    etaSec?: number;
  };

  runStepWithRetry: (step: SetupStep, maxAttempts?: number) => Promise<void>;
  skipCurrentStep: () => void;
  pauseAutoProgress: () => void;
  resumeAutoProgress: () => void;
  canGoBack: () => boolean;
  goToPreviousStep: () => void;
  cancelCurrentStep: () => Promise<void>;
}
```

---

## Платформенная стратегия Python

### Windows

- Runtime в `AppData/Vocrify/python`
- Установка зависимостей в локальный runtime
- CUDA/CPU выбор пакетов torch по доступности

### macOS/Linux

- Без интерактивных `.pkg` сценариев
- Используется standalone/runtime-friendly установка в app data
- Фолбэк: системный Python + валидация зависимостей

---

## Интеграция в приложение

### Модальное окно старта транскрипции

Если diarization включён и Python отсутствует:

- предупреждение,
- CTA `Установить Python` (быстрый переход в Setup Components).

### Настройки > Компоненты

Новый раздел:

- Python runtime: status + `Установить/Переустановить/Удалить`
- FFmpeg: status + `Установить/Переустановить`
- HuggingFace token: `Сохранить/Обновить/Удалить`

---

## Порядок реализации (обновлён)

### Phase 1 — Backend foundation

- [ ] Добавить типы прогресса Python/FFmpeg
- [ ] Реализовать `auto_install_python`
- [ ] Реализовать события прогресса
- [ ] Реализовать `cancel_setup_step`
- [ ] Обновить приоритет `get_python_executable`

### Phase 2 — Frontend orchestration

- [ ] Внедрить step state machine в `setupStore`
- [ ] Retry/timeout/autostep логика
- [ ] Связка с backend событиями прогресса

### Phase 3 — UI

- [ ] Обновить `SetupWizard.tsx` (автонавигация + guard от гонок)
- [ ] Обновить шаги `Python/FFmpeg/Device/Optional`
- [ ] Добавить `SummaryStep.tsx`
- [ ] Обновить `ProgressBar.tsx` (статусы шага)

### Phase 4 — Product integration

- [ ] Проверка Python только при включении diarization
- [ ] Раздел «Компоненты» в настройках
- [ ] Установка Python «по требованию» из flow транскрипции

### Phase 5 — Testing

- [ ] Чистая установка
- [ ] Python skipped + базовая транскрипция работает
- [ ] Diarization запрошен без Python (корректный CTA)
- [ ] Retry/timeout сценарии
- [ ] Back navigation
- [ ] Windows/macOS/Linux smoke

---

## Технические заметки

1. **Не парсить pip прогресс как единственный источник истины** — использовать стадийные события + heartbeat.
2. **Отмена** должна завершать дочерние процессы и чистить временные артефакты.
3. **Идемпотентность**: повторный запуск не ломает уже установленные компоненты.
4. **Безопасность токена**: долгосрочно перейти на OS keychain/secure storage.

---

## Чеклист перед релизом

- [ ] Все пути установки протестированы на пустой системе
- [ ] Ошибки и recovery понятны пользователю
- [ ] Skip/Back не повреждают state machine
- [ ] Diarization UX корректен при отсутствии Python
- [ ] События прогресса стабильны при медленной сети
- [ ] Документация и release notes обновлены

---

## Связанные файлы

- `src/components/features/SetupWizard/SetupWizard.tsx`
- `src/components/features/SetupWizard/steps/PythonStep.tsx`
- `src/components/features/SetupWizard/steps/FFmpegStep.tsx`
- `src/components/features/SetupWizard/steps/DeviceStep.tsx`
- `src/components/features/SetupWizard/steps/OptionalStep.tsx`
- `src/components/features/SetupWizard/steps/SummaryStep.tsx` (new)
- `src/stores/setupStore.ts`
- `src/services/tauri.ts`
- `src-tauri/src/lib.rs`
- `src-tauri/src/python_installer.rs` (new)

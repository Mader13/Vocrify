# TTS (Голосовой ввод) — Дизайн-документ

**Дата:** 2026-02-10
**Статус:** Утверждён

## Обзор

Добавление функции голосового ввода (TTS — Text-to-Speech, точнее Speech-to-Text для диктовки) в приложение. Пользователь нажимает горячую клавишу, говорит, и текст попадает в буфер обмена / активное текстовое поле.

## Принятые решения

| Вопрос              | Решение                                                            |
| ------------------- | ------------------------------------------------------------------ |
| Архитектура         | Гибридная (Rust для hotkeys/audio/clipboard, Python для inference) |
| Режим активации     | Push-to-talk + Toggle (на выбор)                                   |
| После транскрибации | Буфер + автовставка (настройка)                                    |
| Визуальный фидбек   | Overlay + tray icon                                                |
| Модели              | Отдельная настройка для TTS, дефолт Parakeet                       |
| Хоткеи              | Пресеты: Ctrl+Shift+Space, Ctrl+Space, F9 + пользовательский       |
| Язык                | Отдельная настройка для TTS, дефолт "авто"                         |
| GPU конкуренция     | Background Hot-Swap (CPU → GPU при освобождении)                   |
| История             | Опционально, лимит 2/5/10/25/50                                    |
| Overlay             | Компактный popup + streaming текст                                 |
| Streaming           | Текст появляется в overlay по мере распознавания                   |

## Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                      Rust Backend                           │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌────────────────────────────────┐  │
│  │   TaskManager    │  │        TTS Manager             │  │
│  │   (файлы)        │  │  • Global Hotkeys (rdev)       │  │
│  │                  │  │  • Audio Recording (cpal)      │  │
│  │                  │  │  • Clipboard (tauri-plugin)    │  │
│  │                  │  │  • Auto-insert (enigo)         │  │
│  └────────┬─────────┘  └──────────────┬─────────────────┘  │
│           │                           │                     │
└───────────┼───────────────────────────┼─────────────────────┘
            │                           │
      ┌─────▼─────┐               ┌─────▼─────┐
      │  Python   │               │  Python   │
      │  main.py  │               │  tts.py   │
      │ (per task)│               │ (daemon)  │
      │  GPU      │               │ Hot-Swap  │
      └───────────┘               │ CPU→GPU   │
                                  └───────────┘
```

### Компоненты

| Компонент          | Технология                               | Функция                                         |
| ------------------ | ---------------------------------------- | ----------------------------------------------- |
| **TTS Daemon**     | Python                                   | Долгоживущий процесс, держит модель в памяти    |
| **Hot-Swap**       | Python                                   | Background загрузка GPU модели при освобождении |
| **Global Hotkeys** | Rust (rdev/tauri-plugin-global-shortcut) | Перехват хоткеев в любой момент                 |
| **Audio Recorder** | Rust (cpal)                              | Запись с микрофона, VAD                         |
| **Clipboard**      | tauri-plugin-clipboard-manager           | Копирование результата                          |
| **Auto-insert**    | enigo                                    | Вставка в активное поле                         |
| **Overlay**        | Tauri WebviewWindow                      | Компактный popup со streaming                   |

### Hot-Swap Logic

```
TTS Daemon:
┌────────────────────────────────────────────────────────────┐
│                                                            │
│  Active Model (текущая)     Shadow Model (фоновая)        │
│  ┌──────────────────┐       ┌──────────────────┐          │
│  │ CPU: Parakeet    │       │ (пусто)          │          │
│  │ ← используется   │       │                  │          │
│  └──────────────────┘       └──────────────────┘          │
│                                                             │
│  Когда GPU освобождается:                                   │
│  1. Фоновый поток начинает грузить Shadow на GPU           │
│  2. Пользователь использует Active (CPU) без задержки       │
│  3. Когда Shadow готов → атомарный swap                     │
│  4. Старая модель выгружается                               │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

## Rust зависимости (новые)

```toml
[dependencies]
rdev = "0.5"  # или tauri-plugin-global-shortcut
cpal = "0.16"
enigo = "0.3"
```

## Python (ai-engine/tts_daemon.py)

Новый модуль для TTS:

- JSON IPC через stdin/stdout (как main.py)
- Hot-swap модели при освобождении GPU
- Streaming результатов

## UI компоненты

### Страница "Голосовой ввод"

```
┌────────────────────────────────────────┐
│ 🎤 Голосовой ввод                       │
├────────────────────────────────────────┤
│ Модель: [Parakeet TDT 0.6B ▼]          │
│ Устройство: CPU (GPU занят)            │
│ Статус: ● Готов                        │
├────────────────────────────────────────┤
│ История (10)        [⚙ Настройки]      │
├────────────────────────────────────────┤
│ • "Привет, как дела?"     14:32        │
│ • "Напиши письмо..."      14:28        │
│ • "Открой файл..."        14:25        │
└────────────────────────────────────────┘
```

### Overlay

```
┌─────────────────────────────┐
│ 🔴 Recording...             │
│ ▁▂▃▅▇▅▃▂▁                  │  ← audio level
│                             │
│ "Привет, как дела..."       │  ← streaming text
└─────────────────────────────┘
```

## Настройки TTS

```typescript
interface TTSSettings {
  // Активация
  mode: 'push-to-talk' | 'toggle';
  hotkey: 'ctrl+shift+space' | 'ctrl+space' | 'f9' | 'custom';
  customHotkey?: string;

  // Модель и язык
  model: string;  // ID модели
  language: 'auto' | string;

  // Поведение
  autoInsert: boolean;  // автовставка в активное поле
  copyToClipboard: boolean;

  // История
  historyEnabled: boolean;
  historyLimit: 2 | 5 | 10 | 25 | 50;

  // Overlay
  showOverlay: boolean;
  overlayPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}
```

## IPC протокол TTS Daemon

```json
// Запуск записи
{"command": "start_recording", "requestId": "1"}

// Streaming результат
{"type": "partial", "text": "Привет", "requestId": "1"}
{"type": "partial", "text": "Привет, как", "requestId": "1"}
{"type": "final", "text": "Привет, как дела?", "requestId": "1"}

// Статус устройства
{"type": "device_changed", "device": "cuda", "reason": "gpu_available"}
```

## Этапы реализации

### Этап 1: Rust Infrastructure

- [ ] Интеграция rdev или tauri-plugin-global-shortcut для global hotkeys
- [ ] Добавить cpal для audio recording
- [ ] Реализовать VAD (Voice Activity Detection)

### Этап 2: Python TTS Daemon

- [ ] Создать ai-engine/tts_daemon.py
- [ ] JSON IPC протокол (stdin/stdout)
- [ ] Hot-swap логика для CPU → GPU
- [ ] Streaming результатов

### Этап 3: Rust TTS Manager

- [ ] TTS Manager для координации hotkeys/recording/daemon
- [ ] Интеграция clipboard (tauri-plugin-clipboard-manager)
- [ ] Интеграция auto-insert (enigo)

### Этап 4: Frontend Overlay

- [ ] Создать WebviewWindow для overlay
- [ ] Streaming текст в overlay
- [ ] Audio level визуализация

### Этап 5: Frontend TTS Page

- [ ] Страница "Голосовой ввод" в навигации
- [ ] Компонент истории
- [ ] Компонент настроек
- [ ] Zustand store для TTS

### Этап 6: Integration

- [ ] Связать все компоненты
- [ ] Error handling
- [ ] Testing на разных устройствах

## Файловая структура (новые файлы)

```
ai-engine/
├── tts_daemon.py          # TTS daemon процесс
├── tts_hot_swap.py        # Логика hot-swap модели
└── tts_ipc.py             # IPC протокол

src-tauri/src/
├── tts/
│   ├── mod.rs
│   ├── manager.rs         # TTS Manager
│   ├── hotkeys.rs         # Global hotkeys
│   ├── audio.rs           # Audio recording
│   └── clipboard.rs       # Clipboard + auto-insert
└── commands/
    └── tts.rs             # Tauri commands для TTS

src/
├── components/features/tts/
│   ├── TTSPage.tsx
│   ├── TTSHistory.tsx
│   ├── TTSSettings.tsx
│   └── TTSOverlay.tsx
├── stores/
│   └── tts.ts             # Zustand store для TTS
└── types/
    └── tts.ts             # TypeScript типы для TTS
```

## Риски и митигация

| Риск                                    | Митигация                                        |
| --------------------------------------- | ------------------------------------------------ |
| GPU OOM при hot-swap                    | Проверять свободную VRAM перед загрузкой         |
| Конфликт hotkeys с другими приложениями | Разрешить пользователю настроить свои комбинации |
| Задержка при первом запуске             | Preload daemon при старте приложения             |
| Несовместимость VAD                     | Fallback на простое определение тишины по уровню |

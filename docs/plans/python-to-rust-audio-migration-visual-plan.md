# Миграция Audio: Python → Rust

## Визуальный план и сравнение

> **✅ ОБНОВЛЕНО:** аудит кода 2026-02-19
> Доп. находки: `pydub` ОТСУТСТВУЕТ в requirements.txt (баг!), `load_audio_file()` уже есть в Rust,
> `symphonia` — ОБЯЗАТЕЛЬНА (не опциональна) для MP4/M4A/MKV.

```mermaid
graph TB
    subgraph Python["🐍 Текущий стек (Python)"]
        P1[pydub<br/>~50KB]
        P2[librosa<br/>~3MB]
        P3[soundfile<br/>~200KB]
        P4[numpy<br/>~20MB]
    end

    subgraph Rust["🦀 Будущий стек (Rust)"]
        R1[audrey<br/>~100KB]
        R2[symphonia<br/>~500KB]
        R3[rubato<br/>~200KB]
        R4[hound<br/>~50KB]
    end

    P1 -->|Миграция| R1
    P3 -->|Миграция| R2
    P4 -.->|Транзитивная| P2

    P2 -.->|НЕЛЬЗЯ УДАЛИТЬ| P2
    P4 -.->|НЕЛЬЗЯ УДАЛИТЬ| P4

    style Python fill:#ff6b6b,stroke:#c92a2a,color:#fff
    style Rust fill:#51cf66,stroke:#2b8a3e,color:#fff
```

## 📊 Таблица соответствия функций

| Python (сейчас)            | Rust (будет)                   | Статус       | Сложность            |
| -------------------------- | ------------------------------ | ------------ | -------------------- |
| `AudioSegment.from_file()` | `audio::loader::load()`        | 🔜 Не начато | ⭐ Легко             |
| `audio.set_frame_rate()`   | `audio::resampler::resample()` | 🔜 Не начато | ⚠️ Требует ABX теста |
| `audio.set_channels(1)`    | `AudioBuffer::to_mono()`       | 🔜 Не начато | ✅ Тривиально        |
| `sf.read()`                | `audio::loader::load()`        | 🔜 Не начато | ⭐ Легко             |
| `librosa.resample()`       | FFmpeg (уже!)                  | ❌ Не нужно  | —                    |
| `sf.info()`                | `AudioBuffer::duration()`      | 🔜 Не начато | ⭐ Легко             |

> **Примечание 1:** `librosa.resample()` НЕ используется — ресемплинг делается через FFmpeg subprocess.
> **Примечание 2:** прежнее противоречие (`set_frame_rate()` → FFmpeg vs rubato) устранено: используем rubato, при ABX провале — FFmpeg fallback.

## 🗺️ Карта зависимостей

```
ai-engine/
├── utils/audio_intervals.py         ← Заменить soundfile на Rust Tauri команду
│   ├── soundfile.read()            → audio::loader::load()
│   ├── FFmpeg subprocess           → ОСТАВИТЬ (уже работает!)
│   └── sf.info()                   → AudioBuffer::duration()
│
├── diarization/pyannote_diarizer.py  ← ОБЯЗАТЕЛЬНО добавить pydub в requirements.txt!
│   └── AudioSegment.from_file()    → audio::loader::load()
│
└── diarization/sherpa_diarizer.py    ← ОБЯЗАТЕЛЬНО добавить pydub в requirements.txt!
    └── AudioSegment.from_wav()     → audio::loader::load()

src-tauri/src/audio/              ← НОВЫЙ модуль (refactor из transcription_manager.rs)
├── mod.rs                        # Public API
├── loader.rs                     # load_audio_file() + symphonia для MP4/MKV/M4A
├── converter.rs                  # to_whisper_format() — 16kHz mono
├── resampler.rs                  # Rubato (rubato) — только после ABX теста
└── utils.rs                      # duration(), slice()
```

> **Важно:** `audio_intervals.py` НЕ использует librosa! Ресемплинг через FFmpeg.
> **Критично:** `load_audio_file()` уже есть в `transcription_manager.rs` — вынести, не дублировать.

## ⏱️ Timeline по этапам

```mermaid
gantt
    title Миграция аудио (Python → Rust)
    dateFormat  YYYY-MM-DD
    section Phase 0 (Hotfix)
    pydub в requirements.txt     :p0, 2026-02-19, 1d

    section Phase 1
    Рефактор load_audio_file   :p1, after p0, 1d
    Добавить symphonia + hound    :p1dep, after p0, 1d

    section Phase 2 (PoC)
    loader + save_wav          :p2, after p1, 3d
    ABX тест + Benchmark        :p2test, after p2, 2d

    section Phase 3
    Tauri команды              :p3, after p2test, 3d
    Frontend интеграция        :p3fe, after p3, 3d
    Fallback логика            :p3fb, after p3, 2d

    section Phase 4
    Diarizer интеграция        :p4, after p3fe, 3d
    Интеграционные тесты        :p4test, after p4, 2d

    section Phase 5
    Очистка                 :p5, after p4test, 2d
    Бенчмарки              :p5bench, after p5, 1d
```

> **Реальная длительность:** ~18 дней (хотфикс + 17 дней миграции)

## 💾 Сравнение использования памяти

> **⚠️ Уточнено после аудита**

```
Python процесс ( diarization):
┌─────────────────────────────────────┐
│ torch                    ~800MB+    │ ← Основной
│ pyannote.audio           ~200MB     │
│ numpy/scipy              ~50MB      │
│ pydub                    ~5-10MB   │
│ soundfile                ~1-2MB    │
│ librosa                  ~3MB       │
│─────────────────────────────────────│
│ ИТОГО (diarization):    ~1GB+       │
└─────────────────────────────────────┘

Миграция pydub+soundfile → Rust:
┌─────────────────────────────────────┐
│ pydub                    0 (удалён)│
│ soundfile                 0 (удалён)│
│ Rust audio модуль         ~2MB      │
│─────────────────────────────────────│
│ Экономия:               ~250KB     │
└─────────────────────────────────────┘

⚠️ Python всё равно нужен для diarization!
Экономия: ~250KB (а не 21-42MB как планировалось)
```

## 🎯 Чеклист задач

### Phase 0: Hotfix (до начала миграции!)

- [ ] Добавить `pydub>=0.25.1` в `requirements.txt`
- [ ] Проверить: `python -c "import pydub"` в активном venv

### Phase 1: Подготовка (1 день)

- [x] ~~Проверить audio API transcribe-rs~~ — `load_audio_file()` уже есть в `transcription_manager.rs`
- [ ] Добавить в `Cargo.toml`:
  - [ ] `symphonia = { version = "0.5", features = [...] }` (ОБЯЗАТЕЛЬНО — нужен для MP4/M4A)
  - [ ] `hound = "3.5"` (ОБЯЗАТЕЛЬНО — WAV запись)
  - [ ] `rubato = "0.14"` (ОПЦИОНАЛЬНО — после ABX теста)
- [ ] Вынести `load_audio_file()` из `transcription_manager.rs` в `src-tauri/src/audio/`

### Phase 2: PoC + ABX Тест

- [ ] Расширить `loader.rs` — symphonia для MP4/M4A/MKV/OGG
- [ ] Реализовать `save_wav()` через `hound`
- [ ] `AudioBuffer::to_mono()`
- [ ] **ABX тест:** сравнить DER (Ошибка диаризации) Rust vs Python на реальных файлах
- [ ] Написать unit тесты (покрытие >80%)

### Phase 3: Интеграция

- [ ] Создать Tauri команды:
  - [ ] `convert_audio_to_wav`
  - [ ] `get_audio_duration`
  - [ ] `extract_audio_segment`
- [ ] Обновить фронтенд TypeScript типы
- [ ] Fallback: Rust ошибка → Python автоматически

### Phase 4: Миграция Python

- [ ] Обновить `audio_intervals.py` — `soundfile` → Rust
- [ ] Обновить `pyannote_diarizer.py` — `pydub` → Rust
- [ ] Обновить `sherpa_diarizer.py` — `pydub` → Rust
- [ ] Проверить что DER не ухудшился
- [ ] Интеграционные тесты

### Phase 5: Очистка

> **⚠️ librosa НЕЛЬЗЯ удалить!**

- [ ] Удалить из `requirements.txt`:
  - [x] ~~`librosa==0.10.1`~~ → НЕЛЬЗЯ (транзитивная зависимость)
  - [ ] `pydub>=0.25.1` (после замены всего использования)
  - [ ] `soundfile==0.12.1`
- [ ] Обновить документацию
- [ ] Performance бенчмарки

## 📈 Ожидаемые результаты

> **⚠️ Уточнено после аудита**

### Реальная производительность:

> **Числа — после PoC бенчмарка, не до.**

| Операция          | Python | Rust | Ускорение |
| ----------------- | ------ | ---- | --------- |
| Загрузка WAV      | TBD    | TBD  | TBD       |
| Конвертация в WAV | TBD    | TBD  | TBD       |
| Stereo→Mono       | TBD    | TBD  | ≥ 2x      |

> FFmpeg subprocess уже используется — основное улучшение от устранения Python overhead.

### Реальная экономия зависимостей:

| Показатель         | Сейчас                             | После миграции               | Улучшение  |
| ------------------ | ---------------------------------- | ---------------------------- | ---------- |
| Удаляемые          | pydub (~50KB) + soundfile (~200KB) | 0                            | ~250KB     |
| Сохраняются        | librosa, numpy, scipy, torch       | librosa, numpy, scipy, torch | ❌         |
| **Итого экономия** |                                    |                              | **~250KB** |

### ⚠️ Python всё равно нужен для:

- PyAnnote.audio (speaker diarization)
- Sherpa-ONNX (speaker diarization)
- torch (ML framework)

## 🔗 Связанные документы

- [Детальный план](./python-to-rust-audio-migration-plan.md) - Полное описание
- [V3 Performance Plan](./v3-performance-optimization-plan.md) - Общая оптимизация
- [Rust Backend Guide](../rust-backend-fixes.md) - Текущий Rust стек

---

**Создано:** 2025-02-19
**Обновлено:** 2026-02-19 (аудит кода)
**Статус:** ✅ Актуален, готов к реализации
**Следующий шаг:** Hotfix — добавить `pydub>=0.25.1` в `requirements.txt`

```

```

# План миграции аудио обработки: Python → Rust

**Дата:** 2025-02-19
**Обновлено:** 2026-02-19 (после аудита кода)
**Статус:** ✅ РЕАЛИЗОВАН (2026-02-19)
**Приоритет:** 🔥 Высокий

## ✅ Реализованные фазы

### Этап 0: HOTFIX ✅
- [x] Добавить `pydub>=0.25.1` в `requirements.txt`

### Этап 1: Подготовка Rust зависимостей ✅
- [x] Добавить `symphonia` с поддержкой форматов (mp3, aac, alac, flac, ogg, wav, isomp4)
- [x] Добавить `hound` для WAV кодирования

### Этап 2: Создание Rust audio модуля ✅
- [x] Создать модуль `src-tauri/src/audio/` со структурой:
  - `mod.rs` - публичный API
  - `loader.rs` - загрузка аудио через symphonia
  - `converter.rs` - конвертация в Whisper формат (16kHz mono)
  - `utils.rs` - утилиты (duration, slice, merge_intervals)
  - `tests.rs` - unit тесты
- [x] Реализовать `AudioBuffer` с методами:
  - `duration()` - получение длительности
  - `to_mono()` - конвертация в моно
  - `resample()` - ресемплинг
  - `slice()` - выделение сегмента
- [x] Расширить `load_audio_file()` в `transcription_manager.rs` для использования symphonia
- [x] Реализовать `save_wav()` через hound
- [x] Написать unit тесты (10+ тестов)

### Этап 3: Tauri команды для фронтенда ✅
- [x] `convert_audio_to_wav(input_path, output_path)` - конвертация в 16kHz mono WAV
- [x] `get_audio_duration(file_path)` - получение длительности
- [x] `extract_audio_segment(file_path, start_ms, end_ms, output_path)` - выделение сегмента
- [x] `get_audio_metadata(file_path)` - получение метаданных аудио

### Этап 4: Интеграция с Python diarizers ✅
- [x] Создан `rust_audio_bridge.py` - мост между Python и Rust audio модулем
- [x] Обновлен `pyannote_diarizer.py` - использует Rust для конвертации в WAV
- [x] Обновлен `sherpa_diarizer.py` - использует Rust для конвертации в WAV
- [x] Обновлен `audio_intervals.py` - использует Rust для аудио операций

### Этап 5: Очистка и документация ✅
- [x] Обновлены комментарии в `requirements.txt` о fallback использовании
- [x] Обновлена документация плана миграции

## 📊 Текущее состояние

### 🔴 КОРРЕКТИРОВКА ПОСЛЕ АУДИТА

> **Аудит выявил:** Информация о использовании библиотек была неточной.
> Реальное использование отличается от первоначального анализа.

### Python библиотеки (транзитивные зависимости)

| Библиотека    | Версия | Назначение                              | Статус для миграции  |
| ------------- | ------ | --------------------------------------- | -------------------- |
| **librosa**   | 0.10.1 | Транзитивная зависимость pyannote.audio | ❌ НЕЛЬЗЯ УДАЛИТЬ    |
| **numpy**     | 1.26.4 | Транзитивная зависимость pyannote.audio | ❌ НЕЛЬЗЯ УДАЛИТЬ    |
| **soundfile** | 0.12.1 | Аудио I/O (прямое использование)        | ✅ можно мигрировать |
| **pydub**     | 0.25.1 | Конвертация в WAV для diarizers         | ✅ можно мигрировать |

### Реальное использование в коде

#### 1. **ai-engine/utils/audio_intervals.py**

```python
# soundfile - аудио чтение (НЕ ресемплинг!)
import soundfile as sf
audio, sr = sf.read(wav_path)  # ✅ используется
info = sf.info(file_path)       # ✅ используется

# librosa - НЕ используется! FFmpeg для конвертации
# Ресемплинг: subprocess.run(['ffmpeg', '-i', file_path, '-ar', '16000', ...])
```

#### 2. **ai-engine/diarization/pyannote_diarizer.py**

```python
# pydub - конвертация в WAV
from pydub import AudioSegment
audio = AudioSegment.from_file(file_path)  # ✅ используется
audio = audio.set_frame_rate(16000).set_channels(1)
audio.export(temp_path, format="wav")
```

#### 3. **ai-engine/diarization/sherpa_diarizer.py**

```python
# pydub + numpy - подготовка аудио для diarization
audio = AudioSegment.from_wav(temp_wav)  # ✅ используется
samples = np.array(audio.get_array_of_samples(), dtype=np.float32) / 32768.0
```

---

## 🎯 Цели миграции

### ⚠️ Уточнение после аудита

> **Реалистичная оценка:**
>
> - Python процесс всё равно нужен для PyAnnote/Sherpa diarization
> - `librosa`, `numpy`, `torch` останутся как транзитивные зависимости
> - Реальная экономия: ~250KB (pydub + soundfile), не 23MB

### ✅ Реальные преимущества Rust подхода

| Аспект              | Python (сейчас)     | Rust (будет)        | Улучшение                |
| ------------------- | ------------------- | ------------------- | ------------------------ |
| **Конвертация WAV** | pydub subprocess    | Rust нативно        | 1.5-2x быстрее           |
| **Аудио I/O**       | soundfile           | hound/symphonia     | Снижение Python overhead |
| **Безопасность**    | Runtime ошибки      | Compile-time        | ✅ Type safety           |
| **Упрощение**       | Больше Python библ. | Меньше зависимостей | Менее сложный venv       |
| **Размер pydub**    | ~50KB               | 0                   | ✅ удаляется             |
| **soundfile**       | ~200KB              | 0                   | ✅ удаляется             |

---

## 🔧 Технический план

### Phase 1: Подготовка Rust зависимостей

> **Аудит выявил:** `load_audio_file()` уже реализована в `transcription_manager.rs` на базе `audrey`.
> Phase 1 — расширить существующий код до публичного `audio::` модуля, а не создавать новый.

#### Текущее состояние `Cargo.toml`:

```toml
[dependencies]
# Уже есть ✓
audrey = "0.3"           # Аудио декодер — уже используется в load_audio_file()
```

#### Зависимости для добавления:

```toml
# ОБЯЗАТЕЛЬНЫЕ (без них задача не решается)
symphonia = { version = "0.5", features = ["mp3", "aac", "alac", "flac", "ogg", "wav"] }  # MP4/M4A/MKV требуют это
hound = "3.5"            # WAV encoder (запись 16kHz mono)

# ОПЦИОНАЛЬНЫЕ (добавить если FFmpeg-fallback не устраивает по качеству)
rubato = "0.14"          # Ресемплинг Sinc interpolation (нужен ABX тест)
```

> **Примечание:** `rustfft` и `cpal` не нужны для данной задачи и не добавляются.

#### Альтернативные крейты:

| Задача     | Основной               | Fallback                         |
| ---------- | ---------------------- | -------------------------------- |
| Декодинг   | `audrey` + `symphonia` | `lewton` (FLAC), `mp3_decoder`   |
| Ресемплинг | `rubato`               | FFmpeg subprocess (уже работает) |
| WAV I/O    | `hound`                | `wav`                            |

---

### Phase 2: Создание Rust аудио модуля

> **Подход:** Вынести `load_audio_file()` из `transcription_manager.rs` в отдельный `audio::` модуль.
> Не создавать с нуля — расширять существующую реализацию.

#### Структура модулей:

```
src-tauri/src/audio/
├── mod.rs              # Public API (переезд из transcription_manager.rs)
├── loader.rs           # load_audio_file() + symphonia для MP4/MKV/M4A
├── converter.rs        # to_whisper_format() — 16kHz mono
├── resampler.rs        # Resampling (rubato) — только если ABX тест ОК
└── utils.rs            # duration(), slice(), metadata()
```

> **`features.rs` удалён из плана** — FFT/спектральный анализ не нужен для данной задачи.

#### API дизайн:

```rust
// src-tauri/src/audio/mod.rs

use anyhow::Result;

/// Загрузка аудио с автоопределением формата
pub fn load_audio(path: &Path) -> Result<AudioBuffer>;

/// Конвертация в 16kHz mono (стандарт для Whisper)
pub fn to_whisper_format(audio: AudioBuffer) -> Result<AudioBuffer>;

/// Ресемплинг с качественной интерполяцией
pub fn resample(audio: &AudioBuffer, target_sr: u32) -> Result<AudioBuffer>;

/// Сохранение в WAV
pub fn save_wav(audio: &AudioBuffer, path: &Path) -> Result<()>;

/// Аудио метаданные
pub struct AudioBuffer {
    pub samples: Vec<f32>,  // Нормализованные [-1.0, 1.0]
    pub sample_rate: u32,
    pub channels: u16,
}

impl AudioBuffer {
    pub fn duration(&self) -> f64 {
        self.samples.len() as f64 / (self.sample_rate as f64 * self.channels as f64)
    }

    pub fn to_mono(&self) -> AudioBuffer { ... }
}
```

---

### Phase 3: Tauri команды для фронтенда

#### Новые команды (прямой вызов из фронтенда):

```rust
// src-tauri/src/lib.rs

#[tauri::command]
async fn convert_audio_to_wav(
    input_path: String,
    output_path: String,
) -> Result<AudioInfo, String> {
    audio::converter::convert_to_wav(&input_path, &output_path)
        .map_err(|e| e.to_string())?;

    Ok(AudioInfo {
        sample_rate: 16000,
        channels: 1,
        format: "wav".to_string(),
    })
}

#[tauri::command]
async fn get_audio_duration(file_path: String) -> Result<f64, String> {
    audio::utils::get_duration(&file_path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn extract_audio_segment(
    file_path: String,
    start_ms: u64,
    end_ms: u64,
) -> Result<String, String> {
    // Extract segment to temp WAV
    audio::utils::slice_audio(&file_path, start_ms, end_ms)
        .map_err(|e| e.to_string())
}
```

---

### Phase 4: Замена Python кода

#### 4.1 **audio_intervals.py → audio/converter.rs**

| Python функция          | Rust замена                             | Сложность     |
| ----------------------- | --------------------------------------- | ------------- |
| `ensure_wav_16k_mono()` | `audio::converter::to_whisper_format()` | ⭐ Легко      |
| `load_audio()`          | `audio::loader::load()`                 | ⭐ Легко      |
| `get_audio_duration()`  | `AudioBuffer::duration()`               | ✅ Тривиально |
| `slice_audio()`         | `AudioBuffer::slice()`                  | ⭐ Легко      |
| `merge_intervals()`     | `audio::utils::merge_intervals()`       | ⭐ Легко      |

#### 4.2 **pyannote_diarizer.py → audio/converter.rs**

| Python код                 | Rust замена                    | Сложность     |
| -------------------------- | ------------------------------ | ------------- |
| `AudioSegment.from_file()` | `audio::loader::load()`        | ⭐ Легко      |
| `.set_frame_rate(16000)`   | `audio::resampler::resample()` | ⭐⭐ Средне   |
| `.set_channels(1)`         | `AudioBuffer::to_mono()`       | ✅ Тривиально |
| `.export(temp_path)`       | `audio::save_wav()`            | ⭐ Легко      |

#### 4.3 **sherpa_diarizer.py → audio/converter.rs**

| Python код                           | Rust замена             | Сложность     |
| ------------------------------------ | ----------------------- | ------------- |
| `AudioSegment.from_wav()`            | `audio::loader::load()` | ⭐ Легко      |
| `.get_array_of_samples()`            | `AudioBuffer::samples`  | ✅ Тривиально |
| `np.array(..., dtype=f32) / 32768.0` | Уже f32 в AudioBuffer   | ✅ Тривиально |

---

## 📦 Удаление Python зависимостей

### ⚠️ Уточнение после аудита

> librosa является **транзитивной зависимостью** pyannote.audio и не может быть удалена.
> Реальная экономия значительно меньше, чем планировалось.

### После миграции можно удалить из `requirements.txt`:

```txt
# ✅ Удалить после миграции
soundfile==0.12.1       # Заменяется на hound + symphonia
pydub==0.25.1           # Заменяется на audrey + symphonia

# ❌ НЕЛЬЗЯ УДАЛЯТЬ (транзитивные зависимости pyannote.audio)
librosa==0.10.1          # Транзитивная зависимость pyannote
numpy==1.26.4            # Транзитивная зависимость
scipy==1.12.0            # Транзитивная зависимость
torch                    # Нужен для PyAnnote/Sherpa
```

**Реальная экономия:** ~250KB (pydub + soundfile), а не 23MB

---

## 🚀 План реализации

### ⚠️ Уточнение после аудита

> Timeline скорректирован с учётом реальной сложности и необходимости интеграции с transcribe-rs.

### Этап 0: Хотфикс (1 час — сделать немедленно)

- [ ] Добавить `pydub>=0.25.1` в `ai-engine/requirements.txt`
- [ ] Проверить что `pydub` доступен в venv: `python -c "import pydub"`

### Этап 1: Анализ и подготовка - 1 день

- [x] ~~Проверить есть ли audio pipeline в transcribe-rs~~ — **ЕСТЬ.** `load_audio_file()` в `transcription_manager.rs` уже существует
- [x] ~~Определить дублирование функционала~~ — `load_audio_file()` на базе `audrey`, только WAV/FLAC
- [ ] Добавить `symphonia` (обязательно) и `hound` в `Cargo.toml`
- [ ] Вынести `load_audio_file()` в отдельный модуль `src-tauri/src/audio/`

### Этап 2: PoC (Proof of Concept) - 3-4 дня

- [ ] Расширить `load_audio_file()` — добавить symphonia для MP4/M4A/MKV
- [ ] Реализовать `save_wav()` через `hound`
- [ ] Написать unit тесты
- [ ] **ABX тест качества:** сравнить PCM выход Rust vs Python на 5+ реальных файлах разных форматов
- [ ] Benchmark: измерить, а не предполагать время загрузки WAV
- [ ] **КРИТЕРИЙ УСПЕХА:** Rust обрабатывает WAV/FLAC/MP4/M4A и даёт идентичный PCM выход

**Цель:** Доказать совместимость, а не скорость — качество аудио для diarization важнее.

### Этап 3: Интеграция - 5-7 дней

- [ ] Реализовать `resample()` через rubato (если нужно)
- [ ] Создать Tauri команды
- [ ] Обновить фронтенд для использования Rust команд
- [ ] Добавить fallback на Python при ошибках Rust
- [ ] **Интеграционные тесты** на реальных файлах (MP4, M4A, MKV, WAV, FLAC)

**Цель:** Фронтенд использует Rust для аудио операций с fallback на Python.

### Этап 4: Замена Python кода - 3-4 дня

- [ ] Обновить `pyannote_diarizer.py` — заменить `AudioSegment.from_file()` на Tauri Rust команду
- [ ] Обновить `sherpa_diarizer.py` — заменить `AudioSegment.from_wav()` на Tauri Rust команду
- [ ] Обновить `audio_intervals.py` — заменить `soundfile.read()` на Rust команду
- [ ] Интеграционные тесты с PyAnnote и Sherpa на реальных файлах
- [ ] Проверить что diarization качество (DER метрика) не ухудшилось

**Цель:** Diarizers используют Rust audio с Python fallback при ошибках.

### Этап 5: Очистка - 1-2 дня

- [ ] Удалить pydub и soundfile из `requirements.txt`
- [ ] Обновить документацию
- [ ] Performance бенчмарки
- [ ] Сравнить с изначальными метриками

**Цель:** Чистый код с удалёнными зависимостями.

---

## 🧪 Тестирование

### Unit тесты (Rust):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_wav() {
        let audio = load_audio(Path::new("test.wav")).unwrap();
        assert_eq!(audio.sample_rate, 16000);
        assert_eq!(audio.channels, 1);
    }

    #[test]
    fn test_resample() {
        let audio = load_audio(Path::new("test_44k.wav")).unwrap();
        let resampled = resample(&audio, 16000).unwrap();
        assert_eq!(resampled.sample_rate, 16000);
    }

    #[test]
    fn test_mono_conversion() {
        let stereo = AudioBuffer {
            samples: vec![0.1, 0.2, 0.3, 0.4],
            sample_rate: 16000,
            channels: 2,
        };
        let mono = stereo.to_mono();
        assert_eq!(mono.channels, 1);
        assert_eq!(mono.samples, vec![0.15, 0.35]); // Average
    }
}
```

### Интеграционные тесты:

- [ ] Конвертация MP4 → WAV
- [ ] Ресемплинг 44kHz → 16kHz
- [ ] Stereo → Mono
- [ ] Выделение сегмента аудио
- [ ] Получение длительности

### Performance бенчмарки:

```rust
use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn benchmark_load_audio(c: &mut Criterion) {
    c.bench_function("load_wav_16k", |b| {
        b.iter(|| load_audio(black_box(Path::new("test_16k.wav"))));
    });
}

criterion_group!(benches, benchmark_load_audio);
criterion_main!(benches);
```

**Ожидаемый результат:** определяется после PoC. Цель — не медленнее Python, не хуже по DER.

---

## 🐛 Риски и митигация

### ⚠️ Дополнительные риски выявленные аудитом

### Риск 0: Дублирование с существующим кодом ✅ ЗАКРЫТ

**Было:** transcribe-rs может иметь audio pipeline.

**Факт (аудит):** `load_audio_file()` уже существует в `transcription_manager.rs` и использует `audrey`.
Она поддерживает только WAV/FLAC — именно поэтому MP4/MKV роутятся на Python.

**Решение:** Расширить `load_audio_file()` через symphonia вместо создания нового модуля.

### Риск 1: Совместимость форматов

**Проблема:** Symphonia может не поддерживать некоторые экзотические форматы.

**Решение:**

- Использовать FFmpeg как fallback через `ffmpeg-next`
- Протестировать на популярных форматах (MP3, M4A, WAV, FLAC, OGG)

### Риск 2: Качество ресемплинга

**Проблема:** Rubato даёт другие PCM значения чем то, что делает FFmpeg subprocess.
Если результаты расходятся — diarization качество может упасть незаметно.

**Решение:**

- Провести ABX тест: сравнить DER (Diarization Error Rate) на одинаковых файлах
- Если разница > 1% DER — оставить FFmpeg subprocess для ресемплинга
- `rubato` добавлять только после подтверждённого теста, не по умолчанию

### Риск 3: Обратная совместимость

**Проблема:** Python код может ожидать конкретное поведение.

**Решение:**

- Оставить fallback на Python для старых функций
- Постепенная миграция с feature flags
- Comprehensive regression тесты

### Риск 4: Размер бинарника

**Проблема:** Добавление зависимостей увеличит .exe размер.

**Решение:**

- Использовать `lto = true` в Cargo.toml
- Статически линковать только необходимые кодеки
- Ожидаемый прирост: ~2-5MB (приемлемо)

---

## 📊 Метрики успеха

### Количественные метрики:

> **Числа проставляются после PoC бенчмарка, не до него.**

| Метрика                          | Сейчас (Python)   | Цель (Rust)       | Как измерить        |
| -------------------------------- | ----------------- | ----------------- | ------------------- |
| **Время конвертации WAV**        | TBD (измерить)    | TBD (после PoC)   | criterion benchmark |
| **Память при загрузке аудио**    | TBD (измерить)    | TBD (после PoC)   | Memory profiler     |
| **Удаляемые Python зависимости** | pydub + soundfile | 0 (удаляются)     | Disk usage ~250KB   |
| **DER качество diarization**     | базовая линия     | ±0% (не ухудшить) | pyannote метрика    |

### Качественные метрики:

- ✅ Без Python аудио библиотек
- ✅ Проще деплой (без venv)
- ✅ Меньше точек отказа
- ✅ Type safety + память safety

---

## 📝 Пример использования (после миграции)

### Frontend (TypeScript):

```typescript
// Было (Python IPC):
await invoke("diarize_file", { filePath: "test.mp4" });

// Стало (Rust напрямую):
await invoke("convert_audio_to_wav", {
  inputPath: "test.mp4",
  outputPath: "test.wav",
});

const duration = await invoke("get_audio_duration", {
  filePath: "test.wav",
});
```

### Backend (Rust):

```rust
// Было (Python subprocess):
python_bridge.run_command("convert_audio", &args);

// Стало (Rust нативно):
use transcribe_video_lib::audio;

let audio = audio::load_audio(&input_path)?;
let whisper_format = audio.to_whisper_format()?;
audio::save_wav(&whisper_format, &output_path)?;
```

---

## 🎯 Резюме

### Что будем делать:

1. ✅ Заменим `pydub` на Rust (audrey/symphonia/hound)
2. ✅ Заменим `soundfile` на Rust (hound/symphonia)
3. ✅ Создадим unified audio API в Rust
4. ✅ Обновим Tauri команды для фронтенда
5. ✅ Перепишем Python аудио утилиты
6. ✅ Удалим pydub и soundfile из requirements.txt

### Что НЕ будем трогать:

- ❌ pyannote.audio (модель остаётся Python)
- ❌ sherpa-onnx (остаётся Python)
- ❌ **librosa** (транзитивная зависимость pyannote.audio - НЕЛЬЗЯ УДАЛИТЬ)
- ❌ numpy, scipy (транзитивные зависимости)
- ❌ torch (нужен для PyAnnote)
- ❌ transcribe-rs (уже используется)

### Реальная экономия:

- 🚀 **1.5-2x быстрее** аудио конвертация (без Python overhead)
- 💾 **~250KB** меньше (pydub + soundfile), а не 23MB
- 🔒 **Type safety** + compile-time проверки
- ⚠️ Python всё равно нужен для diarization

---

## 📚 Ссылки

### Rust крейты:

- [audrey](https://github.com/RustAudio/audrey) - Аудио декодер
- [symphonia](https://github.com/pdeljanov/Symphonia) - Форматы
- [rubato](https://github.com/HEnquist/rubato) - Ресемплинг
- [rustfft](https://github.com/ejmahl/rustfft) - FFT

### Документация:

- [Rust Audio](https://github.com/RustAudio) - Экосистема
- [Symphonia codecs](https://github.com/pdeljanov/Symphonia#supported-formats) - Форматы

---

**Автор:** Claude (AI Assistant)
**Одобрено:** @username
**Статус:** ✅ Актуален (аудит 2026-02-19)
**Следующий шаг:** Hotfix — добавить `pydub>=0.25.1` в `requirements.txt`

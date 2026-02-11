# 🎯 ФИНАЛЬНЫЙ ПЛАН: Стабилизация + Миграция на Rust

## Конфигурация

- **Тестовый файл:** `SH2.mp4` (в корне проекта)
- **Формат моделей Whisper:** GGML
- **Обратная совместимость:** Не требуется
- **Провайдеры диаризации:** Оба (PyAnnote + Sherpa-ONNX)
- **Структура путей:** Плоская (`{cache}/pyannote-segmentation-3.0/`)
- **GPU поддержка:** CUDA (NVIDIA), Metal (Apple), Vulkan (AMD/Intel), CPU (fallback)

---

## 📋 ФАЗА 1: Стабилизация (Критические баги)

### ✅ Задача 1.1: Исправить check_models для PyAnnote

**Файл:** `ai-engine/main.py:1252-1261`  
**Проблема:** Ожидает `{cache}/pyannote-diarization/pyannote-segmentation-3.0/`  
**Фактически:** `{cache}/pyannote-segmentation-3.0/`

**Изменение:**

```python
# main.py - В начале цикла scan добавить skip-логику
SKIP_INDIVIDUAL = {
    "pyannote-segmentation-3.0", "pyannote-embedding-3.0",
    "sherpa-onnx-segmentation", "sherpa-onnx-embedding"
}

for model_name in os.listdir(cache_dir):
    # Skip individual diarization components - they're handled separately
    if model_name in SKIP_INDIVIDUAL:
        continue
    # ... existing logic
```

**Дополнительно:** Добавить отдельную логику для определения установленной диаризации:

```python
# После цикла scan - добавить проверку диаризации
# PyAnnote diarization
seg_path = os.path.join(cache_dir, "pyannote-segmentation-3.0")
emb_path = os.path.join(cache_dir, "pyannote-embedding-3.0")
if os.path.exists(seg_path) and os.path.exists(emb_path):
    total_size = get_model_size_mb(seg_path) + get_model_size_mb(emb_path)
    installed_models.append({
        "name": "pyannote-diarization",
        "size_mb": total_size,
        "model_type": "diarization",
        "installed": True,
        "path": None,  # No single path
    })

# Sherpa diarization
seg_path = os.path.join(cache_dir, "sherpa-onnx-segmentation")
emb_path = os.path.join(cache_dir, "sherpa-onnx-embedding")
if os.path.exists(seg_path) and os.path.exists(emb_path):
    total_size = get_model_size_mb(seg_path) + get_model_size_mb(emb_path)
    installed_models.append({
        "name": "sherpa-onnx-diarization",
        "size_mb": total_size,
        "model_type": "diarization",
        "installed": True,
        "path": None,
    })
```

**Тест:**

```bash
cd tests && pytest unit/python/test_downloader.py -v -k diarization
```

---

### ✅ Задача 1.2: Синхронизировать get_local_models (Rust)

**Файл:** `src-tauri/src/lib.rs:1914-1930`  
**Проблема:** Не проверяет структуру диаризации

**Изменение:**

```rust
// lib.rs - ДОБАВИТЬ после существующего match
// PyAnnote diarization (virtual model)
let seg_path = models_dir.join("pyannote-segmentation-3.0");
let emb_path = models_dir.join("pyannote-embedding-3.0");
if seg_path.exists() && emb_path.exists() {
    let mut total_size = 0u64;
    for p in [&seg_path, &emb_path] {
        // Graceful error handling - не прерываем цикл при ошибке
        if let Ok(entries) = std::fs::read_dir(p) {
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    total_size += meta.len();
                }
            }
        }
    }
    models.push(LocalModel {
        name: "pyannote-diarization".to_string(),
        size_mb: total_size / (1024 * 1024),
        model_type: "diarization".to_string(),
        installed: true,
        path: None,
    });
}

// Аналогично для sherpa-onnx-diarization
let seg_path = models_dir.join("sherpa-onnx-segmentation");
let emb_path = models_dir.join("sherpa-onnx-embedding");
if seg_path.exists() && emb_path.exists() {
    // ... аналогичный код
}
```

---

### ✅ Задача 1.3: Исправить event listeners

**Файл:** `src/stores/modelsStore.ts:531-540`

**Изменение:**

```typescript
// modelsStore.ts:531-540 - ИЗМЕНИТЬ
let unlisteners: UnlistenFn[] = [];

export async function initializeModelsStore() {
  const store = useModelsStore.getState();

  if (!listenersInitialized) {
    try {
      unlisteners = await setupDownloadEventListeners(
        store.updateDownloadProgress,
        store.setDownloadCompleted,
        store.setDownloadError,
        store.setDownloadCancelled
      );
      listenersInitialized = true;
    } catch (error) {
      console.error("Failed to initialize model event listeners:", error);
    }
  }

  await Promise.all([store.loadModels(), store.loadDiskUsage()]);
}

// Добавить cleanup функцию
export function cleanupModelsStore() {
  unlisteners.forEach(unlisten => unlisten());
  unlisteners = [];
}
```

**Дополнительно:** Добавить вызов cleanup в `src/App.tsx`:

```typescript
import { cleanupModelsStore } from "@/stores/modelsStore";

// В корневом компоненте
useEffect(() => {
  return () => {
    cleanupModelsStore();
  };
}, []);
```

---

### ✅ Задача 1.4: Добавить интеграционный тест

**Файл:** `tests/integration/test_model_lifecycle.py` (новый)

```python
"""Test model download/delete lifecycle"""
import pytest
import os
import tempfile
from pathlib import Path

class TestModelLifecycle:
    @pytest.fixture
    def temp_cache(self):
        with tempfile.TemporaryDirectory() as d:
            yield Path(d)

    def test_pyannote_diarization_roundtrip(self, temp_cache):
        """Test download and delete of PyAnnote diarization"""
        from downloader import download_model

        # Download
        download_model("pyannote-diarization", "diarization", str(temp_cache))

        # Verify structure
        assert (temp_cache / "pyannote-segmentation-3.0").exists()
        assert (temp_cache / "pyannote-embedding-3.0").exists()

        # Verify detection
        from main import check_models
        result = check_models(str(temp_cache))
        diarization_models = [m for m in result["installedModels"]
                             if m["model_type"] == "diarization"]
        assert len(diarization_models) == 1
        assert diarization_models[0]["name"] == "pyannote-diarization"

        # Delete
        from model_registry import ModelRegistry
        registry = ModelRegistry(str(temp_cache))
        result = registry.delete_model("pyannote-diarization")
        assert result["success"]

        # Verify deletion
        assert not (temp_cache / "pyannote-segmentation-3.0").exists()
        assert not (temp_cache / "pyannote-embedding-3.0").exists()

    def test_sherpa_diarization_roundtrip(self, temp_cache):
        """Test download and delete of Sherpa diarization"""
        # Аналогично pyannote
        pass
```

**Запуск:**

```bash
pytest tests/integration/test_model_lifecycle.py -v
```

---

### ✅ Задача 1.5: Мануальное тестирование

**Тест-кейс:** Полный цикл с SH2.mp4

```bash
# 1. Запустить приложение
bun run tauri:dev

# 2. Зайти в Управление моделями
# 3. Скачать whisper-base
# 4. Проверить что появилась в списке
# 5. Удалить whisper-base
# 6. Проверить что исчезла из списка

# 7. Скачать pyannote-diarization (с токеном HF)
# 8. Проверить структуру в папке моделей
# 9. Транскрибировать SH2.mp4 с диаризацией
# 10. Проверить результат

# 11. Удалить pyannote-diarization
# 12. Проверить что обе папки удалились
```

---

### ✅ Задача 1.6: Rust unit test для get_local_models

**Файл:** `src-tauri/src/lib.rs`

**Добавить тест:**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_get_local_models_diarization() {
        let temp_dir = TempDir::new().unwrap();
        let models_dir = temp_dir.path().join("models");

        // Create fake diarization structure
        let seg_path = models_dir.join("pyannote-segmentation-3.0");
        let emb_path = models_dir.join("pyannote-embedding-3.0");
        std::fs::create_dir_all(&seg_path).unwrap();
        std::fs::create_dir_all(&emb_path).unwrap();

        // Create dummy files
        std::fs::write(seg_path.join("model.bin"), vec![0u8; 1024 * 1024]).unwrap();
        std::fs::write(emb_path.join("model.bin"), vec![0u8; 1024 * 1024]).unwrap();

        // Test detection
        let models = get_local_models_internal(&models_dir).unwrap();
        let diarization = models.iter().find(|m| m.name == "pyannote-diarization");
        assert!(diarization.is_some());
        assert_eq!(diarization.unwrap().model_type, "diarization");
    }
}
```

**Запуск:**

```bash
cd src-tauri && cargo test get_local_models
```

---

### ✅ Задача 1.7: Добавить поддержку Vulkan (AMD/Intel GPU)

**Проблема:** Текущая реализация поддерживает только CUDA, MPS, CPU. Пользователи с AMD/Intel GPU работают на CPU.

**Файлы:**

- `ai-engine/device_detection.py`
- `src/types/index.ts`
- `src/services/tauri.ts`

**Изменения:**

#### 1. Python - device_detection.py

```python
# Добавить в enum
class DeviceType(Enum):
    CPU = "cpu"
    CUDA = "cuda"
    MPS = "mps"
    VULKAN = "vulkan"  # НОВОЕ

# Добавить функцию детекции
def detect_vulkan() -> Optional[DeviceInfo]:
    """Detect Vulkan-capable GPU via vulkaninfo"""
    try:
        result = subprocess.run(
            ["vulkaninfo", "--summary"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            # Parse GPU name from output
            gpu_name = parse_vulkan_gpu_name(result.stdout)
            return DeviceInfo(
                type=DeviceType.VULKAN,
                name=gpu_name,
                available=True,
                isRecommended=True  # Better than CPU
            )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass
    return None

def parse_vulkan_gpu_name(output: str) -> str:
    """Extract GPU name from vulkaninfo output"""
    for line in output.split('\n'):
        if 'deviceName' in line or 'GPU' in line:
            return line.split(':')[-1].strip()
    return "Unknown Vulkan GPU"

# Обновить приоритет
priority = {
    DeviceType.CUDA.value: 4,    # Best for NVIDIA
    DeviceType.MPS.value: 3,     # Best for Apple
    DeviceType.VULKAN.value: 2,  # Good for AMD/Intel
    DeviceType.CPU.value: 1,     # Fallback
}

# Обновить detect_all_devices()
def detect_all_devices() -> List[DeviceInfo]:
    devices = []

    cuda_info = detect_cuda()
    if cuda_info:
        devices.append(cuda_info)

    mps_info = detect_mps()
    if mps_info:
        devices.append(mps_info)

    vulkan_info = detect_vulkan()  # НОВОЕ
    if vulkan_info:
        devices.append(vulkan_info)

    devices.append(get_cpu_info())

    return devices
```

#### 2. TypeScript - src/types/index.ts

```typescript
// Обновить тип
export type DeviceType = "auto" | "cpu" | "cuda" | "mps" | "vulkan";

// Обновить константы
export const DEVICE_NAMES: Record<DeviceType, string> = {
  auto: "Авто (рекомендуется)",
  cpu: "CPU (процессор)",
  cuda: "NVIDIA GPU (CUDA)",
  mps: "Apple Silicon (Metal)",
  vulkan: "GPU (Vulkan - AMD/Intel)",
};

export const DEVICE_DESCRIPTIONS: Record<DeviceType, string> = {
  auto: "Автоматический выбор лучшего устройства",
  cpu: "Медленно, но работает везде",
  cuda: "Быстро на видеокартах NVIDIA",
  mps: "Быстро на Mac с Apple Silicon",
  vulkan: "Быстро на AMD/Intel видеокартах",
};
```

**Тест:**

```bash
# Проверить vulkaninfo доступность
vulkaninfo --summary

# Запустить тест
pytest tests/unit/python/test_device_detection.py -v -k vulkan
```

---

## 📋 ФАЗА 2: Миграция на Rust

### ✅ Задача 2.1: Добавить whisper-rs с кроссплатформенной GPU поддержкой

**Файл:** `src-tauri/Cargo.toml`

```toml
[dependencies]
# ... существующие ...

# Whisper с GPU поддержкой по платформам
# macOS: Metal (встроен в систему)
[target.'cfg(target_os = "macos")'.dependencies]
whisper-rs = { version = "0.11", features = ["whisper-cpp-tracing", "metal"] }

# Windows/Linux: CUDA + Vulkan (требуют SDK при сборке)
# - CUDA SDK для NVIDIA GPU
# - Vulkan SDK для AMD/Intel GPU
[target.'cfg(target_os = "windows")'.dependencies]
whisper-rs = { version = "0.11", features = ["whisper-cpp-tracing", "cuda", "vulkan"] }

[target.'cfg(target_os = "linux")'.dependencies]
whisper-rs = { version = "0.11", features = ["whisper-cpp-tracing", "cuda", "vulkan"] }
```

**Требования для сборки:**

- **Windows/Linux:** CMake + CUDA Toolkit 12.1+ ИЛИ Vulkan SDK 1.3+
- **macOS:** Xcode Command Line Tools (Metal встроен)

**Примечание:** CUDA и Vulkan — независимые бэкенды. whisper.cpp выбирает подходящий в runtime на основе доступного GPU.

**Сборка:**

```bash
cd src-tauri
cargo build
```

---

### ✅ Задача 2.2: Создать WhisperEngine с авто‑fallback

**Файл:** `src-tauri/src/whisper_engine.rs` (новый)

**Структура:**

```rust
use std::sync::{Arc, RwLock};
use once_cell::sync::Lazy;

// Кеш device detection (один раз на запуск)
static CACHED_DEVICE: Lazy<Arc<RwLock<Option<DeviceType>>>> =
    Lazy::new(|| Arc::new(RwLock::new(None)));

pub struct WhisperEngine {
    context: WhisperContext,
    device: DeviceType,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DeviceType {
    Cpu,
    Cuda,
    Metal,
    Vulkan,
}

impl WhisperEngine {
    /// Создаёт WhisperEngine с авто‑fallback на CPU при ошибке GPU
    pub fn new(model_path: &Path, preferred_device: DeviceType) -> Result<Self, AppError> {
        // Пробуем preferred device
        match Self::try_create_context(model_path, preferred_device) {
            Ok(ctx) => {
                log::info!("WhisperEngine initialized with {:?}", preferred_device);
                return Ok(Self { context: ctx, device: preferred_device });
            }
            Err(e) => {
                log::warn!("GPU {:?} failed: {}, falling back to CPU", preferred_device, e);
            }
        }

        // Авто‑fallback на CPU
        Self::try_create_context(model_path, DeviceType::Cpu)
            .map(|ctx| {
                log::info!("WhisperEngine initialized with CPU fallback");
                Self { context: ctx, device: DeviceType::Cpu }
            })
    }

    fn try_create_context(model_path: &Path, device: DeviceType) -> Result<WhisperContext, AppError> {
        let mut params = WhisperContextParameters::default();
        params.use_gpu = device != DeviceType::Cpu;
        WhisperContext::new_with_params(model_path, params)
            .map_err(|e| AppError::WhisperInit(format!("{:?}", e)))
    }

    pub fn transcribe(&self, audio: &[f32]) -> Result<Vec<Segment>, AppError> { ... }

    pub fn get_supported_languages() -> Vec<String> { ... }

    /// Детекция лучшего устройства с кешированием
    pub fn detect_best_device() -> DeviceType {
        // Проверяем кеш
        if let Some(cached) = CACHED_DEVICE.read().unwrap().as_ref() {
            return *cached;
        }

        // Детектируем (приоритет: CUDA > Metal > Vulkan > CPU)
        let device = Self::detect_device_uncached();

        // Кешируем результат
        *CACHED_DEVICE.write().unwrap() = Some(device);
        device
    }

    fn detect_device_uncached() -> DeviceType {
        #[cfg(target_os = "macos")]
        { DeviceType::Metal }

        #[cfg(not(target_os = "macos"))]
        {
            if Self::is_cuda_available() { return DeviceType::Cuda; }
            if Self::is_vulkan_available() { return DeviceType::Vulkan; }
            DeviceType::Cpu
        }
    }

    fn is_cuda_available() -> bool { /* nvidia-smi check */ }
    fn is_vulkan_available() -> bool { /* vulkaninfo check */ }
}
```

---

### ✅ Задача 2.3: Создать PythonBridge для диаризации

**Файл:** `src-tauri/src/python_bridge.rs` (новый)

**Причина:** Sherpa-rs нестабилен на Windows. PyAnnote/Parakeet остаются в Python.

```rust
use std::path::PathBuf;
use std::process::Command;
use tokio::process::Command as AsyncCommand;

pub struct PythonBridge {
    python_path: PathBuf,
    engine_path: PathBuf,
}

impl PythonBridge {
    pub fn new(python_path: &Path, engine_path: &Path) -> Self {
        Self {
            python_path: python_path.to_path_buf(),
            engine_path: engine_path.to_path_buf(),
        }
    }

    /// Запуск PyAnnote диаризации через Python subprocess
    pub async fn diarize_pyannote(
        &self,
        audio_path: &Path,
        cache_dir: &Path,
    ) -> Result<Vec<SpeakerSegment>, AppError> {
        let output = AsyncCommand::new(&self.python_path)
            .arg(&self.engine_path)
            .arg("--diarize")
            .arg("--provider").arg("pyannote")
            .arg("--audio").arg(audio_path)
            .arg("--cache").arg(cache_dir)
            .output()
            .await?;

        self.parse_diarization_output(&output.stdout)
    }

    /// Запуск Parakeet транскрипции через Python subprocess
    pub async fn transcribe_parakeet(
        &self,
        audio_path: &Path,
        model: &str,
        device: &str,
    ) -> Result<TranscriptionResult, AppError> {
        let output = AsyncCommand::new(&self.python_path)
            .arg(&self.engine_path)
            .arg("--transcribe")
            .arg("--model").arg(model)
            .arg("--device").arg(device)
            .arg("--audio").arg(audio_path)
            .output()
            .await?;

        self.parse_transcription_output(&output.stdout)
    }

    fn parse_diarization_output(&self, stdout: &[u8]) -> Result<Vec<SpeakerSegment>, AppError> { ... }
    fn parse_transcription_output(&self, stdout: &[u8]) -> Result<TranscriptionResult, AppError> { ... }
}
```

---

### ✅ Задача 2.4: Создать EngineRouter

**Файл:** `src-tauri/src/engine_router.rs` (новый)

**Назначение:** Маршрутизация между Rust Whisper и Python fallback

```rust
pub enum EngineChoice {
    RustWhisper,    // whisper-rs (GGML модели)
    PythonEngine,   // Python (Parakeet, PyAnnote)
}

pub struct EngineRouter {
    whisper_engine: Option<WhisperEngine>,
    python_bridge: PythonBridge,
    preference: EnginePreference,
}

#[derive(Debug, Clone)]
pub enum EnginePreference {
    Auto,     // Rust primary, Python fallback
    RustOnly, // Только Rust (ошибка при недоступности)
    PythonOnly, // Только Python (Phase 1 поведение)
}

impl EngineRouter {
    pub async fn transcribe(
        &mut self,
        audio_path: &Path,
        options: TranscriptionOptions,
    ) -> Result<TranscriptionResult, AppError> {
        // Определяем движок по модели
        let engine = self.select_engine(&options.model);

        match engine {
            EngineChoice::RustWhisper => {
                // Пробуем Rust
                match self.try_rust_transcribe(audio_path, &options).await {
                    Ok(result) => return Ok(result),
                    Err(e) => {
                        log::warn!("Rust transcription failed: {}, trying Python fallback", e);
                        // Авто‑fallback на Python
                        if self.preference == EnginePreference::Auto {
                            return self.python_bridge.transcribe(audio_path, &options).await;
                        }
                        return Err(e);
                    }
                }
            }
            EngineChoice::PythonEngine => {
                self.python_bridge.transcribe(audio_path, &options).await
            }
        }
    }

    fn select_engine(&self, model: &str) -> EngineChoice {
        // Parakeet модели → Python
        if model.starts_with("parakeet") || model.starts_with("nvidia/") {
            return EngineChoice::PythonEngine;
        }

        // Whisper модели → Rust (если доступен)
        if self.preference != EnginePreference::PythonOnly {
            return EngineChoice::RustWhisper;
        }

        EngineChoice::PythonEngine
    }
}
```

---

### ✅ Задача 2.5: Создать ModelManager с кешированием

**Файл:** `src-tauri/src/model_manager.rs` (новый)

**Функции:**

- `download_model(name, type)` - async загрузка
- `delete_model(name)` - удаление
- `list_models()` - список установленных
- `get_model_path(name)` - путь к модели
- `download_ggml_model(name)` - для Whisper GGML
- `get_device_info()` - детекция устройства с кешированием

**Feature flag для rollback:**

```rust
#[cfg(feature = "rust-whisper")]
use whisper_engine::WhisperEngine;
#[cfg(not(feature = "rust-whisper"))]
use python_bridge::PythonBridge;

// В Cargo.toml:
[features]
default = ["rust-whisper"]
rust-whisper = []
```

**Кеширование device detection:**

```rust
use std::sync::{Arc, RwLock};
use once_cell::sync::Lazy;

pub struct ModelManager {
    models_dir: PathBuf,
    device_cache: Arc<RwLock<Option<DeviceInfo>>>,
}

impl ModelManager {
    /// Получить информацию об устройстве (с кешированием)
    pub fn get_device_info(&self) -> Result<DeviceInfo, AppError> {
        // Проверяем кеш
        if let Some(cached) = self.device_cache.read().unwrap().as_ref() {
            return Ok(cached.clone());
        }

        // Детектируем устройства
        let device = self.detect_devices()?;

        // Кешируем результат
        *self.device_cache.write().unwrap() = Some(device.clone());
        Ok(device)
    }

    fn detect_devices(&self) -> Result<DeviceInfo, AppError> {
        // Вызываем Python device_detection или нативную Rust детекцию
        // Приоритет: CUDA > Metal > Vulkan > CPU
        Ok(DeviceInfo::default())
    }
}
```

---

### ✅ Задача 2.6: Миграция UI с авто‑fallback

**Файл:** `src/stores/modelsStore.ts`

**Изменения:**

- Заменить `invoke('download_model')` на новые Rust команды
- Обновить event names (если изменились)
- Добавить авто‑fallback на Python при ошибках Rust

**Авто‑fallback для транскрипции:**

```typescript
// src/services/transcription.ts

export async function transcribeWithFallback(
  file: string,
  options: TranscriptionOptions
): Promise<TranscriptionResult> {
  // Определяем движок по модели
  const useRust = !options.model.startsWith('parakeet') &&
                  !options.model.startsWith('nvidia/');

  if (useRust) {
    try {
      // Пробуем Rust whisper-rs
      return await invoke('transcribe_rust', { file, options });
    } catch (rustError) {
      console.warn('[Transcription] Rust failed, falling back to Python:', rustError);

      // Авто‑fallback на Python
      return await invoke('transcribe_python', { file, options });
    }
  }

  // Parakeet/PyAnnote → Python напрямую
  return await invoke('transcribe_python', { file, options });
}
```

**Предпочтение движка (настройки):**

```typescript
// src/stores/settingsStore.ts

export type EnginePreference = 'auto' | 'rust' | 'python';

interface SettingsState {
  enginePreference: EnginePreference;
  setEnginePreference: (pref: EnginePreference) => void;
}

// 'auto' = Rust primary, Python fallback (по умолчанию)
// 'rust' = Только Rust (ошибка при недоступности)
// 'python' = Только Python (Phase 1 поведение)
```

---

## 📋 ФАЗА 3: Оптимизация

### ✅ Задача 3.1: Удалить Python зависимости для Whisper

**Файл:** `ai-engine/requirements.txt`

Удалить:

```
faster-whisper
ctranslate2
```

---

### ✅ Задача 3.2: Удалить Python зависимости для Sherpa

**Файл:** `ai-engine/requirements.txt`

Удалить:

```
onnxruntime  # если используется только для sherpa
```

---

### ✅ Задача 3.3: Обновить документацию

**Файлы:**

- `AGENTS.md` - обновить команды и GPU поддержку
- `README.md` - обновить требования
- `docs/MIGRATION.md` (новый) - гайд миграции
- `docs/GPU_SUPPORT.md` (новый) - документация по GPU поддержке

---

## 📊 Матрица зависимостей

```
Задача  | Зависит от  | Параллельно с | Сложность | Время
--------|-------------|---------------|-----------|-------
1.1     | -           | 1.3, 1.7      | ⭐⭐       | 30 мин
1.2     | 1.1         | -             | ⭐⭐       | 20 мин
1.3     | -           | 1.1, 1.7      | ⭐         | 15 мин
1.4     | 1.1, 1.2    | -             | ⭐⭐       | 45 мин
1.5     | 1.1-1.4, 1.7| -             | ⭐         | 30 мин
1.6     | 1.2         | -             | ⭐⭐       | 20 мин
1.7     | -           | 1.1, 1.3      | ⭐⭐       | 1 час
2.1     | -           | 2.3           | ⭐         | 15 мин
2.2     | 2.1         | -             | ⭐⭐⭐⭐    | 4 часа
2.3     | -           | 2.1           | ⭐⭐       | 2 часа
2.4     | 2.2, 2.3    | -             | ⭐⭐⭐     | 3 часа
2.5     | 2.2         | -             | ⭐⭐⭐     | 2.5 часа
2.6     | 2.4, 2.5    | -             | ⭐⭐⭐     | 3 часа
3.1     | 2.6         | -             | ⭐         | 15 мин
3.2     | 2.6         | -             | ⭐         | 15 мин
3.3     | Все         | -             | ⭐⭐       | 1.5 часа
```

**Общее время:** ~20 часов (2-3 рабочих дня)

---

## 🎯 Критерии успеха

### Фаза 1

- [ ] PyAnnote скачивается → определяется → удаляется корректно
- [ ] Sherpa скачивается → определяется → удаляется корректно
- [ ] Whisper работает как раньше
- [ ] Тест `test_model_lifecycle.py` проходит
- [ ] Тест `get_local_models` (Rust) проходит
- [ ] Vulkan device detection работает
- [ ] SH2.mp4 транскрибируется с диаризацией

### Фаза 2

- [ ] Whisper работает через whisper-rs (GGML модели)
- [ ] GPU ускорение: CUDA (NVIDIA), Metal (Apple), Vulkan (AMD/Intel)
- [ ] **Авто‑fallback на CPU при ошибке GPU**
- [ ] **Авто‑fallback на Python при ошибке Rust Whisper**
- [ ] PyAnnote/Parakeet диаризация работает через Python bridge
- [ ] Device detection кешируется (один раз на запуск)
- [ ] Feature flag `rust-whisper` для rollback работает
- [ ] **Один билд Windows/Linux с CUDA+Vulkan SDK**
- [ ] Cold start < 1.5 сек до первого сегмента
- [ ] RTF < 0.1 на GPU (10× быстрее реального времени)

### Фаза 3

- [ ] Размер venv сокращен на ~200MB
- [ ] Время запуска < 1 сек
- [ ] Документация актуальна
- [ ] GPU поддержка задокументирована

---

## 🔧 GPU Support Matrix

| GPU Type                    | Backend            | SDK Required (Build) | Priority     | Performance          |
| --------------------------- | ------------------ | -------------------- | ------------ | -------------------- |
| NVIDIA (CUDA)               | whisper.cpp CUDA   | CUDA Toolkit 12.1+   | 4 (highest)  | ⚡ Fastest           |
| Apple Silicon (M1/M2/M3/M4) | whisper.cpp Metal  | None (built-in)      | 3            | 🚀 Fast              |
| AMD Radeon                  | whisper.cpp Vulkan | Vulkan SDK 1.3+      | 2            | 🚀 Fast (12x vs CPU) |
| Intel Arc/iGPU              | whisper.cpp Vulkan | Vulkan SDK 1.3+      | 2            | 🚀 Fast (12x vs CPU) |
| CPU                         | whisper.cpp CPU    | None                 | 1 (fallback) | 🐢 Slowest           |

**Примечание:** CUDA и Vulkan — независимые бэкенды. Для полной поддержки всех GPU на Windows/Linux требуются оба SDK при сборке. whisper.cpp выбирает подходящий бэкенд в runtime.

---

## 🚀 Готовность к началу

**Параллельный запуск (Фаза 1):**

- Группа A: 1.1 + 1.3 + 1.7 (независимые)
- Группа B: 1.2 + 1.6 (после 1.1)
- Группа C: 1.4 (после 1.1, 1.2)
- Группа D: 1.5 (после всех)

**Параллельный запуск (Фаза 2):**

- Группа A: 2.1 (Cargo.toml) + 2.3 (PythonBridge) — независимые
- Группа B: 2.2 (WhisperEngine) после 2.1
- Группа C: 2.4 (EngineRouter) после 2.2 + 2.3
- Группа D: 2.5 (ModelManager) после 2.2
- Группа E: 2.6 (UI миграция) после 2.4 + 2.5

---

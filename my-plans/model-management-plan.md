# План: Система управления моделями

## 🎯 Требования

- ✅ Отдельная страница `/models` для управления моделями
- ✅ Хранилище в Tauri app data директории: `{app_data_dir}/Vocrify/models/`
- ✅ Поддержка офлайн режима (предварительное скачивание)
- ✅ Показывать занимаемое место моделей + свободное дисковое пространство
- ✅ Модель по умолчанию: спрашивать пользователя (нет дефолтной)
- ✅ Для скачанных моделей: "Уже установлено" + кнопка "Переустановить"
- ✅ Сохранение выбора модели в Tauri store API (НЕ localStorage!)
- ✅ Поддержка Parakeet сразу
- ✅ Параллельное скачивание моделей

---

## 📦 Модели для интеграции

### Whisper (faster-whisper)

| Модель | Размер | Описание |
|---------|---------|-----------|
| whisper-tiny | ~40MB | Самый быстрый |
| whisper-base | ~80MB | Баланс |
| whisper-small | ~250MB | Лучше точность |
| whisper-medium | ~760MB | Высокая точность |
| whisper-large-v3 | ~1.5GB | Максимальная точность |

### Parakeet (NeMo Toolkit)

| Модель | Размер | Описание |
|---------|---------|-----------|
| parakeet-tdt-0.6b-v3 | ~640MB | Многоязычная, включая русский! 🇷🇺 |
| parakeet-tdt-1.1b | ~2.49GB | Только английский, высокая точность |

---

## 🏗️ Фазы реализации

### Phase 1: Backend - ai-engine (Python)

**Файлы:**

```
ai-engine/
├── main.py              # + команды download/delete/list
├── models/
│   ├── whisper.py       # + download_root параметр
│   └── parakeet.py      # NEW
└── requirements.txt     # + huggingface_hub, nemo-toolkit
```

**Команды CLI:**

```python
--download-model <model_name> --cache-dir <path> --model-type <whisper|parakeet>
  ├── Эмитит: Progress { current, total, percent, speed_mb/s }
  ├── Эмитит: DownloadComplete { model_name, size_mb, path }
  └── Эмитит: Error { message, code }

--list-models --cache-dir <path>
  └── Эмитит: ModelsList [{ name, size_mb, model_type, installed, path }]

--delete-model <model_name> --cache-dir <path>
  └── Эмитит: DeleteComplete { model_name }
```

**Whisper integration (whisper.py):**

```python
class WhisperModel(BaseModel):
    def __init__(self, model_name, device, download_root=None):
        self.model = WhisperModel(
            model_name,
            device=device,
            compute_type="int8_float16" if device == "cuda" else "int8",
            download_root=download_root  # <-- NEW
        )
```

**Parakeet integration (parakeet.py):**

```python
import nemo.collections.asr as nemo_asr

class ParakeetModel(BaseModel):
    def __init__(self, model_name, device, download_root=None):
        self.model = nemo_asr.models.ASRModel.from_pretrained(
            f"nvidia/{model_name}",
            map_location=device
        )
```

**Progress handling:**

```python
from huggingface_hub import snapshot_download
from tqdm import tqdm

def download_model_with_progress(model_name, cache_dir, model_type):
    def progress_callback(progress):
        emit_json({
            "type": "Progress",
            "data": {
                "current": progress.current,
                "total": progress.total,
                "percent": progress.current / progress.total * 100,
                "speed_mb_s": progress.speed
            }
        })
    
    try:
        if model_type == "whisper":
            model = WhisperModel(model_name, download_root=cache_dir)
        else:  # parakeet
            snapshot_download(
                repo_id=f"nvidia/{model_name}",
                cache_dir=cache_dir,
                local_dir=os.path.join(cache_dir, model_name),
                progress_bar=progress_callback
            )
        
        emit_json({"type": "DownloadComplete", "data": {...}})
    except Exception as e:
        emit_json({"type": "Error", "data": {"message": str(e)}})
```

---

### Phase 2: Backend - Tauri (Rust)

**Файл:** `src-tauri/src/lib.rs`

```rust
// Новые команды
#[tauri::command]
async fn get_models_dir() -> Result<String, String> {
    let app_data = path::app_data_dir(&Config::default())
        .map_err(|e| e.to_string())?;
    
    let models_dir = app_data.join("Vocrify").join("models");
    fs::create_dir_all(&models_dir)
        .map_err(|e| e.to_string())?;
    
    Ok(models_dir.to_string_lossy().to_string())
}

#[tauri::command]
async fn download_model(model_name: String, model_type: String) -> Result<String, String> {
    // Запускать Python с --download-model
    // Возвращать task_id для отслеживания
}

#[tauri::command]
async fn get_local_models() -> Result<Vec<LocalModel>, String> {
    // Сканировать директорию и возвращать список
}

#[tauri::command]
async fn delete_model(model_name: String) -> Result<(), String> {
    // Удалять директорию модели
}

#[tauri::command]
async fn get_disk_usage() -> Result<DiskUsage, String> {
    // total_size_mb + free_space_mb
}
```

**Структуры:**

```rust
#[derive(Serialize, Deserialize)]
struct LocalModel {
    name: String,
    size_mb: u64,
    model_type: String,  // "whisper" or "parakeet"
    installed: bool,
}

#[derive(Serialize, Deserialize)]
struct DiskUsage {
    total_size_mb: u64,
    free_space_mb: u64,
}
```

**Параллельное скачивание:**
- Использовать `tokio::spawn` для асинхронного скачивания
- Хранить активные задачи в HashMap: `HashMap<String, Child>`
- Отправлять события через `Event` канал

---

### Phase 3: Frontend - React + Zustand

**Файлы:**

```
src/
├── stores/
│   └── modelsStore.ts              # NEW
├── pages/
│   └── models.tsx                  # NEW
├── components/
│   ├── features/
│   │   ├── ModelCard.tsx           # NEW
│   │   └── ModelSelectorModal.tsx  # NEW
│   └── layout/
│       └── StatsBar.tsx            # NEW
└── services/
    └── tauri.ts                    # UPDATE + model commands
```

**Zustand store (modelsStore.ts):**

```typescript
interface ModelDownload {
  model_name: string
  progress: number
  current_mb: number
  total_mb: number
  speed_mb_s: string
  status: 'downloading' | 'completed' | 'error'
  error?: string
}

interface ModelsState {
  availableModels: Array<{
    name: string
    sizeMb: number
    modelType: 'whisper' | 'parakeet'
    description: string
    installed: boolean
    path?: string
  }>
  downloads: Map<string, ModelDownload>
  diskUsage: {
    totalSizeMb: number
    freeSpaceMb: number
  }
  selectedModel: string | null
  
  // Actions
  loadModels: () => Promise<void>
  downloadModel: (name: string, modelType: string) => Promise<void>
  deleteModel: (name: string) => Promise<void>
  setSelectedModel: (model: string | null) => void
  loadDiskUsage: () => Promise<void>
}

export const useModelsStore = create<ModelsState>((set, get) => ({
  // implementation...
}))
```

**Страница models.tsx:**

```tsx
export default function ModelsPage() {
  const { availableModels, downloads, diskUsage, loadModels } = useModelsStore()
  
  return (
    <div className="container">
      <Header>Управление моделями</Header>
      
      <StatsBar>
        Модели: {formatSize(diskUsage.totalSizeMb)} / 
        Свободно: {formatSize(diskUsage.freeSpaceMb)}
      </StatsBar>
      
      <div className="models-grid">
        {availableModels.map(model => (
          <ModelCard key={model.name} model={model} />
        ))}
      </div>
    </div>
  )
}
```

**ModelCard.tsx:**

```tsx
export function ModelCard({ model, download, delete, downloadState }: ModelCardProps) {
  const isDownloading = downloadState?.status === 'downloading'
  const isError = downloadState?.status === 'error'
  
  return (
    <Card>
      <Icon>{model.modelType === 'whisper' ? '🐍' : '🦜'}</Icon>
      <h3>{model.name}</h3>
      <p>{model.description}</p>
      <Size>{formatSize(model.sizeMb)}</Size>
      
      <Status>
        {model.installed ? 'Установлено' : 'Не установлено'}
      </Status>
      
      {isDownloading && (
        <ProgressBar 
          value={downloadState!.progress} 
          text={`${downloadState!.current_mb}MB / ${downloadState!.total_mb}MB`}
        />
      )}
      
      <Actions>
        {model.installed ? (
          <Button variant="outline" onClick={delete}>Удалить</Button>
        ) : (
          <Button onClick={download}>Скачать</Button>
        )}
      </Actions>
    </Card>
  )
}
```

**ModelSelectorModal.tsx:**

```tsx
export function ModelSelectorModal({ isOpen, onClose, onSelect }: Props) {
  const { availableModels, setSelectedModel } = useModelsStore()
  
  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <h2>Выберите модель для первой транскрипции</h2>
      
      <ModelList>
        {availableModels.map(model => (
          <ModelOption 
            key={model.name}
            model={model}
            onClick={() => {
              setSelectedModel(model.name)
              onSelect(model.name)
            }}
          />
        ))}
      </ModelList>
      
      <Actions>
        <Button variant="outline" onClick={onClose}>Отмена</Button>
        <Button onClick={() => onClose()}>Начать</Button>
      </Actions>
    </Modal>
  )
}
```

**Tauri service update (src/services/tauri.ts):**

```typescript
export async function getModelsDir(): Promise<string> {
  return invoke('get_models_dir')
}

export async function downloadModel(modelName: string, modelType: string): Promise<string> {
  return invoke('download_model', { modelName, modelType })
}

export async function getLocalModels(): Promise<LocalModel[]> {
  return invoke('get_local_models')
}

export async function deleteModel(modelName: string): Promise<void> {
  return invoke('delete_model', { modelName })
}

export async function getDiskUsage(): Promise<DiskUsage> {
  return invoke('get_disk_usage')
}
```

---

### Phase 4: Оптимизации и UX

**Параллельное скачивание:**
- Разрешить скачивать до 3 моделей одновременно
- Показывать progress bar для каждой
- Очередь: если больше 3, то ставить в pending

**Tauri Store для сохранения:**

```rust
#[tauri::command]
async fn save_selected_model(model: String) -> Result<(), String> {
    let store = Store::default("settings");
    store.set("selected_model", model)?;
    Ok(())
}

#[tauri::command]
async fn load_selected_model() -> Result<Option<String>, String> {
    let store = Store::default("settings");
    Ok(store.get("selected_model"))
}
```

**Отмена скачивания:**
- Добавить команду `cancel_download(model_name)`
- Убивать Python процесс
- Очищать частично скачанные файлы

---

## 📊 Список моделей с описанием

| Модель | Тип | Размер | Описание |
|---------|------|---------|-----------|
| whisper-tiny | whisper | 40MB | Самый быстрый, минимальная точность |
| whisper-base | whisper | 80MB | Баланс скорости и точности |
| whisper-small | whisper | 250MB | Хорошая точность, средняя скорость |
| whisper-medium | whisper | 760MB | Высокая точность |
| whisper-large-v3 | whisper | 1.5GB | Максимальная точность, медленный |
| parakeet-tdt-0.6b-v3 | parakeet | 640MB | Многоязычная, включая русский 🇷🇺 |
| parakeet-tdt-1.1b | parakeet | 2.49GB | Английский, высокая точность |

---

## ✅ Критерий завершения

### Backend (Python)
- [ ] `--download-model` команда с прогрессом
- [ ] `--list-models` команда
- [ ] `--delete-model` команда
- [ ] Whisper + Parakeet интеграция
- [ ] JSON события для прогресса

### Backend (Tauri)
- [ ] `get_models_dir()` команда
- [ ] `download_model()` команда
- [ ] `get_local_models()` команда
- [ ] `delete_model()` команда
- [ ] `get_disk_usage()` команда
- [ ] Tauri store для `selected_model`

### Frontend
- [ ] Страница `/models`
- [ ] ModelCard компонент
- [ ] ModelSelectorModal компонент
- [ ] StatsBar для диска
- [ ] modelsStore (Zustand)
- [ ] Tauri service функции

### Интеграция
- [ ] Параллельное скачивание (до 3 моделей)
- [ ] Отмена скачивания
- [ ] Автоматическая загрузка при первой транскрипции
- [ ] Сохранение выбранной модели
- [ ] Прогресс-бары для скачивания

---

## 🚀 Порядок реализации

1. **ai-engine**: добавить команды + Parakeet
2. **src-tauri**: добавить команды Rust
3. **Frontend**: создать modelsStore и компоненты
4. **Интеграция**: связать все вместе
5. **Тестирование**: проверить все флоу

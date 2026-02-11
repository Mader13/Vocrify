# Download Manager Integration Guide

This guide shows how to integrate the new `DownloadManager` module into the existing Tauri backend.

## Overview

The new `DownloadManager` module provides:
- **Download queue** with automatic retry capability (max 3 attempts)
- **Progress tracking** with proper parsing of Python events
- **State persistence** for resume after app restart
- **Concurrent download limiting** (max 3 simultaneous downloads)
- **Better cleanup** on cancellation
- **Error handling** with retry logic

## Integration Steps

### 1. Update `lib.rs` Imports

Add the module import at the top of `lib.rs`:

```rust
mod download_manager;
```

### 2. Replace Simple Download Tracking

The existing `TaskManager` struct has a simple `downloading_models` HashMap. Replace this with the new `DownloadManager`:

**Before (in `lib.rs`):**
```rust
pub struct TaskManager {
    running_tasks: HashMap<String, RunningTask>,
    queued_tasks: Vec<QueuedTask>,
    downloading_models: HashMap<String, tokio::task::JoinHandle<()>>,
    processing_queue: bool,
}
```

**After:**
```rust
use download_manager::DownloadManager;

pub struct TaskManager {
    running_tasks: HashMap<String, RunningTask>,
    queued_tasks: Vec<QueuedTask>,
    download_manager: Arc<Mutex<DownloadManager>>,
    processing_queue: bool,
}
```

### 3. Initialize DownloadManager in `run()` function

**Before:**
```rust
pub fn run() {
    let task_manager: TaskManagerState = Arc::new(Mutex::new(TaskManager::default()));

    tauri::Builder::default()
        // ...
        .manage(task_manager)
        // ...
}
```

**After:**
```rust
pub fn run() {
    // Create download manager first
    let download_manager = Arc::new(Mutex::new(
        DownloadManager::new(app_handle.clone()).expect("Failed to create download manager")
    ));

    let task_manager: TaskManagerState = Arc::new(Mutex::new(TaskManager {
        running_tasks: HashMap::new(),
        queued_tasks: Vec::new(),
        download_manager: download_manager.clone(),
        processing_queue: false,
    }));

    // Initialize download manager (load persisted state)
    tokio::spawn(async move {
        let mut manager = download_manager.lock().await;
        manager.initialize().await.expect("Failed to initialize download manager");
    });

    tauri::Builder::default()
        // ...
        .manage(task_manager)
        // ...
}
```

### 4. Replace `download_model` Command

**Old implementation (lines 1089-1139 in `lib.rs`):**
```rust
#[tauri::command]
async fn download_model(
    app: AppHandle,
    task_manager: State<'_, TaskManagerState>,
    model_name: String,
    model_type: String,
    hugging_face_token: Option<String>,
) -> Result<String, AppError> {
    let mut manager = task_manager.lock().await;

    if manager.downloading_models.len() >= MAX_CONCURRENT_DOWNLOADS {
        return Err(AppError::ModelError("Maximum concurrent downloads reached".to_string()));
    }

    // ... spawn download logic

    Ok(model_name)
}
```

**New implementation:**
```rust
#[tauri::command]
async fn download_model(
    task_manager: State<'_, TaskManagerState>,
    model_name: String,
    model_type: String,
    hugging_face_token: Option<String>,
) -> Result<String, AppError> {
    let mut manager = task_manager.lock().await;
    let mut download_manager = manager.download_manager.lock().await;

    download_manager.queue_download(
        model_name.clone(),
        model_type,
        hugging_face_token,
    ).await?;

    Ok(model_name)
}
```

### 5. Replace `cancel_model_download` Command

**Old implementation (lines 1234-1248 in `lib.rs`):**
```rust
#[tauri::command]
async fn cancel_model_download(
    task_manager: State<'_, TaskManagerState>,
    model_name: String,
) -> Result<(), AppError> {
    let mut manager = task_manager.lock().await;

    if let Some(handle) = manager.downloading_models.remove(&model_name) {
        handle.abort();
        return Ok(());
    }

    Err(AppError::ModelError(format!("Model download not found: {}", model_name)))
}
```

**New implementation:**
```rust
#[tauri::command]
async fn cancel_model_download(
    task_manager: State<'_, TaskManagerState>,
    model_name: String,
) -> Result<(), AppError> {
    let manager = task_manager.lock().await;
    let mut download_manager = manager.download_manager.lock().await;

    download_manager.cancel_download(&model_name).await
}
```

### 6. Add New Commands

Add these additional commands to expose more download manager functionality:

```rust
/// Get all download states
#[tauri::command]
async fn get_download_states(
    task_manager: State<'_, TaskManagerState>,
) -> Result<Vec<DownloadState>, AppError> {
    let manager = task_manager.lock().await;
    let download_manager = manager.download_manager.lock().await;
    Ok(download_manager.get_downloads())
}

/// Retry a failed download
#[tauri::command]
async fn retry_model_download(
    task_manager: State<'_, TaskManagerState>,
    model_name: String,
) -> Result<(), AppError> {
    let manager = task_manager.lock().await;
    let mut download_manager = manager.download_manager.lock().await;
    download_manager.retry_download(&model_name).await
}

/// Clear completed downloads from state
#[tauri::command]
async fn clear_completed_downloads(
    task_manager: State<'_, TaskManagerState>,
) -> Result<(), AppError> {
    let manager = task_manager.lock().await;
    let mut download_manager = manager.download_manager.lock().await;
    download_manager.clear_completed()
}
```

### 7. Register New Commands

Update the `invoke_handler` registration:

```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    download_model,
    cancel_model_download,
    get_download_states,  // NEW
    retry_model_download, // NEW
    clear_completed_downloads, // NEW
    // ... other commands ...
])
```

### 8. Update Frontend Types

Add these types to `src/types/index.ts`:

```typescript
// Download status
export type DownloadStatus =
  | "Queued"
  | "Downloading"
  | "Paused"
  | "Completed"
  | "Failed"
  | "Cancelled";

// Download state
export interface DownloadState {
  modelName: string;
  modelType: string;
  status: DownloadStatus;
  retryCount: number;
  currentBytes: number;
  totalBytes: number;
  lastError?: string;
  startedAt?: number;
  completedAt?: number;
}

// Download progress event
export interface DownloadProgressEvent {
  modelName: string;
  currentBytes: number;
  totalBytes: number;
  percent: number;
  speedMbS: number;
  status: DownloadStatus;
  retryCount: number;
}
```

### 9. Update Frontend Service

Add these wrappers to `src/services/tauri.ts`:

```typescript
// Get all download states
export async function getDownloadStates(): Promise<DownloadState[]> {
  return invoke<DownloadState[]>("get_download_states");
}

// Retry a failed download
export async function retryModelDownload(modelName: string): Promise<void> {
  return invoke("retry_model_download", { modelName });
}

// Clear completed downloads
export async function clearCompletedDownloads(): Promise<void> {
  return invoke("clear_completed_downloads");
}
```

## Benefits of the New Implementation

### 1. Queue Management
- Downloads are automatically queued when concurrent limit is reached
- Queue is processed in order
- Queue state is persisted across app restarts

### 2. Retry Capability
- Failed downloads can be retried up to 3 times
- Each retry increments the `retry_count` in the state
- Clear error messages for each failed attempt

### 3. Better Progress Parsing
- Properly handles all Python message types (`ProgressDownload`, `DownloadComplete`, `error`)
- Emits structured progress events to frontend
- Better error detection and reporting

### 4. State Persistence
- All download states saved to `~/.config/Vocrify/download_state.json`
- Automatically resumes interrupted downloads on app start
- Completed downloads are tracked for history

### 5. Improved Cleanup
- Uses `scopeguard` to ensure process cleanup on panic
- Properly kills child process on cancellation
- Removes download from active counter when cancelled

### 6. Better Error Handling
- Distinguishes between retryable and non-retryable errors
- Stores last error message in state
- Emits errors to frontend in real-time

## Frontend Integration Example

Here's how to use the new download manager in a React component:

```typescript
import { useEffect, useState } from 'react';
import { getDownloadStates, downloadModel, cancelModelDownload, retryModelDownload } from '@/services/tauri';
import type { DownloadState } from '@/types';

export function ModelDownloads() {
  const [downloads, setDownloads] = useState<DownloadState[]>([]);

  // Load download states
  useEffect(() => {
    loadStates();

    // Listen for progress updates
    const unlistenProgress = listen<DownloadProgressEvent>(
      'model-download-progress',
      (event) => {
        console.log('Progress:', event.payload);
        loadStates(); // Refresh states
      }
    );

    // Listen for completion
    const unlistenComplete = listen(
      'model-download-complete',
      () => {
        loadStates();
      }
    );

    // Listen for errors
    const unlistenError = listen(
      'model-download-error',
      (event) => {
        console.error('Download error:', event.payload);
        loadStates();
      }
    );

    return () => {
      unlistenProgress.then(f => f());
      unlistenComplete.then(f => f());
      unlistenError.then(f => f());
    };
  }, []);

  const loadStates = async () => {
    const states = await getDownloadStates();
    setDownloads(states);
  };

  const handleDownload = async (modelName: string, modelType: string) => {
    try {
      await downloadModel(modelName, modelType, null);
      await loadStates();
    } catch (error) {
      console.error('Failed to start download:', error);
    }
  };

  const handleCancel = async (modelName: string) => {
    try {
      await cancelModelDownload(modelName);
      await loadStates();
    } catch (error) {
      console.error('Failed to cancel download:', error);
    }
  };

  const handleRetry = async (modelName: string) => {
    try {
      await retryModelDownload(modelName);
      await loadStates();
    } catch (error) {
      console.error('Failed to retry download:', error);
    }
  };

  return (
    <div>
      {downloads.map((download) => (
        <div key={download.modelName}>
          <h3>{download.modelName}</h3>
          <p>Status: {download.status}</p>
          {download.status === 'Failed' && download.lastError && (
            <p className="text-red-500">{download.lastError}</p>
          )}
          {download.retryCount > 0 && (
            <p>Retry attempt {download.retryCount}/3</p>
          )}
          <progress value={download.currentBytes} max={download.totalBytes} />
          {download.status === 'Downloading' && (
            <button onClick={() => handleCancel(download.modelName)}>
              Cancel
            </button>
          )}
          {download.status === 'Failed' && download.retryCount < 3 && (
            <button onClick={() => handleRetry(download.modelName)}>
              Retry
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
```

## Migration Checklist

- [ ] Add `mod download_manager;` to `lib.rs`
- [ ] Update `TaskManager` struct to include `download_manager`
- [ ] Initialize `DownloadManager` in `run()` function
- [ ] Replace `download_model` command implementation
- [ ] Replace `cancel_model_download` command implementation
- [ ] Add new commands (`get_download_states`, `retry_model_download`, `clear_completed_downloads`)
- [ ] Register all commands in `invoke_handler`
- [ ] Update frontend types in `src/types/index.ts`
- [ ] Add frontend service wrappers in `src/services/tauri.ts`
- [ ] Update frontend components to use new download manager
- [ ] Test download queue functionality
- [ ] Test retry mechanism
- [ ] Test state persistence (restart app during download)
- [ ] Test cancellation and cleanup

## Notes

1. **Backward Compatibility**: The existing `spawn_model_download()` function (lines 909-1087) can be removed after integration, as its logic is now in `DownloadManager::spawn_download()`.

2. **Token Handling**: The new implementation supports token files but defaults to `None`. Update `queue_download()` to handle `hugging_face_token` parameter if needed.

3. **Testing**: The module includes unit tests for serialization. Add integration tests for the full download flow.

4. **Performance**: State is saved synchronously on state changes. For high-frequency updates, consider debouncing the save operation.

5. **Error Recovery**: The download manager automatically retries failed downloads up to 3 times. After that, the download stays in `Failed` status and must be manually retried.

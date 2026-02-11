# DownloadManager API Reference

## Module: `download_manager`

### Overview

The `DownloadManager` provides robust model download management with queueing, retry capability, state persistence, and comprehensive error handling.

---

## Struct: `DownloadManager`

Main download management struct.

### Constructor

```rust
pub fn new(app: AppHandle) -> Result<Self, AppError>
```

Creates a new download manager instance.

**Parameters:**
- `app: AppHandle` - Tauri app handle for event emission

**Returns:**
- `Result<DownloadManager, AppError>` - Download manager instance or error

**Example:**
```rust
let download_manager = DownloadManager::new(app_handle.clone())?;
```

---

### Methods

#### `initialize`

```rust
pub async fn initialize(&mut self) -> Result<(), AppError>
```

Initializes the download manager by loading persisted state and processing the queue.

**Returns:**
- `Result<(), AppError>` - Success or error

**Example:**
```rust
let mut manager = DownloadManager::new(app)?;
manager.initialize().await?;
```

---

#### `queue_download`

```rust
pub async fn queue_download(
    &mut self,
    model_name: String,
    model_type: String,
    hugging_face_token: Option<String>,
) -> Result<(), AppError>
```

Queues a model for download. If the download limit is reached, the model is queued and will start automatically when a slot becomes available.

**Parameters:**
- `model_name: String` - Name of the model (e.g., "whisper-base")
- `model_type: String` - Type of model (e.g., "whisper", "diarization")
- `hugging_face_token: Option<String>` - Optional HuggingFace authentication token

**Returns:**
- `Result<(), AppError>` - Success or error

**Errors:**
- Returns error if model is already downloading or queued

**Emits:**
- `model-download-queued` event with `{"modelName": "..."}`

**Example:**
```rust
manager.queue_download(
    "whisper-base".to_string(),
    "whisper".to_string(),
    Some("hf_xxx".to_string()),
).await?;
```

---

#### `cancel_download`

```rust
pub async fn cancel_download(&mut self, model_name: &str) -> Result<(), AppError>
```

Cancels an active or queued download. Properly cleans up child processes and updates state.

**Parameters:**
- `model_name: &str` - Name of the model to cancel

**Returns:**
- `Result<(), AppError>` - Success or error

**Errors:**
- Returns error if download not found

**Emits:**
- `model-download-cancelled` event with `{"modelName": "..."}`

**Example:**
```rust
manager.cancel_download("whisper-base").await?;
```

---

#### `retry_download`

```rust
pub async fn retry_download(&mut self, model_name: &str) -> Result<(), AppError>
```

Retries a failed download. Increments the retry counter and re-queues the download.

**Parameters:**
- `model_name: &str` - Name of the model to retry

**Returns:**
- `Result<(), AppError>` - Success or error

**Errors:**
- Returns error if maximum retry attempts (3) reached
- Returns error if download not found

**Example:**
```rust
manager.retry_download("whisper-base").await?;
```

---

#### `get_downloads`

```rust
pub fn get_downloads(&self) -> Vec<DownloadState>
```

Gets all download states (active, queued, completed, failed).

**Returns:**
- `Vec<DownloadState>` - Vector of all download states

**Example:**
```rust
let downloads = manager.get_downloads();
for download in downloads {
    println!("{}: {:?}", download.model_name, download.status);
}
```

---

#### `get_download`

```rust
pub fn get_download(&self, model_name: &str) -> Option<DownloadState>
```

Gets a specific download state by model name.

**Parameters:**
- `model_name: &str` - Name of the model

**Returns:**
- `Option<DownloadState>` - Download state if found, None otherwise

**Example:**
```rust
if let Some(state) = manager.get_download("whisper-base") {
    println!("Status: {:?}", state.status);
    println!("Progress: {} / {} bytes", state.current_bytes, state.total_bytes);
}
```

---

#### `clear_completed`

```rust
pub fn clear_completed(&mut self) -> Result<(), AppError>
```

Removes completed downloads from the state (keeps failed, cancelled, and active).

**Returns:**
- `Result<(), AppError>` - Success or error

**Example:**
```rust
manager.clear_completed()?;
```

---

## Struct: `DownloadState`

Represents the state of a download.

### Fields

```rust
pub struct DownloadState {
    pub model_name: String,           // Model identifier
    pub model_type: String,           // Model type (whisper, diarization, etc.)
    pub status: DownloadStatus,       // Current status
    pub retry_count: u32,             // Number of retry attempts
    pub current_bytes: u64,           // Bytes downloaded
    pub total_bytes: u64,             // Total bytes to download
    pub last_error: Option<String>,   // Last error message (if any)
    pub started_at: Option<u64>,      // Unix timestamp when started
    pub completed_at: Option<u64>,    // Unix timestamp when completed
}
```

### Example

```rust
let state = DownloadState {
    model_name: "whisper-base".to_string(),
    model_type: "whisper".to_string(),
    status: DownloadStatus::Downloading,
    retry_count: 0,
    current_bytes: 150_000_000,  // 150 MB
    total_bytes: 300_000_000,    // 300 MB
    last_error: None,
    started_at: Some(1704067200),
    completed_at: None,
};
```

---

## Enum: `DownloadStatus`

Status of a download.

### Variants

```rust
pub enum DownloadStatus {
    Queued,      // In queue, waiting to start
    Downloading, // Currently downloading
    Paused,      // Paused by user (future feature)
    Completed,   // Successfully downloaded
    Failed,      // Failed with error (can retry)
    Cancelled,   // Cancelled by user
}
```

### Serialization

The enum serializes to camelCase strings:
- `Queued` → `"Queued"`
- `Downloading` → `"Downloading"`
- `Paused` → `"Paused"`
- `Completed` → `"Completed"`
- `Failed` → `"Failed"`
- `Cancelled` → `"Cancelled"`

---

## Struct: `DownloadProgressEvent`

Progress event emitted to frontend.

### Fields

```rust
pub struct DownloadProgressEvent {
    pub model_name: String,        // Model identifier
    pub current_bytes: u64,        // Bytes downloaded
    pub total_bytes: u64,          // Total bytes
    pub percent: f64,              // Percentage (0.0 - 100.0)
    pub speed_mb_s: f64,           // Download speed in MB/s
    pub status: DownloadStatus,    // Current status
    pub retry_count: u32,          // Number of retry attempts
}
```

### Example

```rust
let event = DownloadProgressEvent {
    model_name: "whisper-base".to_string(),
    current_bytes: 150_000_000,
    total_bytes: 300_000_000,
    percent: 50.0,
    speed_mb_s: 5.2,
    status: DownloadStatus::Downloading,
    retry_count: 0,
};

app.emit("model-download-progress", event)?;
```

---

## Events Emitted

### `model-download-queued`

Emitted when a download is added to the queue.

**Payload:**
```json
{
  "modelName": "whisper-base"
}
```

**When:** Immediately after calling `queue_download()`

---

### `model-download-progress`

Emitted periodically during download with progress information.

**Payload:**
```json
{
  "modelName": "whisper-base",
  "currentBytes": 150000000,
  "totalBytes": 300000000,
  "percent": 50.0,
  "speedMbS": 5.2,
  "status": "Downloading",
  "retryCount": 0
}
```

**When:** When Python engine emits `ProgressDownload` message

---

### `model-download-complete`

Emitted when download completes successfully.

**Payload:**
```json
{
  "modelName": "whisper-base"
}
```

**When:** When Python process exits successfully

---

### `model-download-error`

Emitted when an error occurs during download.

**Payload:**
```json
{
  "modelName": "whisper-base",
  "error": "Network timeout"
}
```

**When:** When Python engine emits error message or process fails

---

### `model-download-cancelled`

Emitted when download is cancelled by user.

**Payload:**
```json
{
  "modelName": "whisper-base"
}
```

**When:** After calling `cancel_download()`

---

## Constants

```rust
const MAX_CONCURRENT_DOWNLOADS: usize = 3;  // Max simultaneous downloads
const MAX_RETRY_ATTEMPTS: u32 = 3;           // Max retries per download
const STATE_FILE: &str = "download_state.json";  // State file name
```

---

## State Persistence

Download state is persisted to:
- **Windows:** `%APPDATA%\Vocrify\download_state.json`
- **macOS:** `~/Library/Application Support/Vocrify/download_state.json`
- **Linux:** `~/.config/Vocrify/download_state.json`

### State File Format

```json
{
  "whisper-base": {
    "modelName": "whisper-base",
    "modelType": "whisper",
    "status": "Completed",
    "retryCount": 0,
    "currentBytes": 300000000,
    "totalBytes": 300000000,
    "lastError": null,
    "startedAt": 1704067200,
    "completedAt": 1704067500
  },
  "whisper-large": {
    "modelName": "whisper-large",
    "modelType": "whisper",
    "status": "Queued",
    "retryCount": 1,
    "currentBytes": 0,
    "totalBytes": 0,
    "lastError": "Network timeout",
    "startedAt": 1704067600,
    "completedAt": null
  }
}
```

---

## Usage Examples

### Basic Download

```rust
// Create manager
let mut manager = DownloadManager::new(app_handle.clone())?;
manager.initialize().await?;

// Queue download
manager.queue_download(
    "whisper-base".to_string(),
    "whisper".to_string(),
    None, // No token needed for public models
).await?;
```

### Download with Authentication

```rust
manager.queue_download(
    "pyannote/speaker-diarization".to_string(),
    "diarization".to_string(),
    Some("hf_xxx_token_here".to_string()),  // HuggingFace token
).await?;
```

### Check Download Status

```rust
if let Some(state) = manager.get_download("whisper-base") {
    match state.status {
        DownloadStatus::Downloading => {
            let percent = (state.current_bytes as f64 / state.total_bytes as f64) * 100.0;
            println!("Download: {:.1}%", percent);
        }
        DownloadStatus::Completed => {
            println!("Download completed!");
        }
        DownloadStatus::Failed => {
            println!("Download failed: {:?}", state.last_error);
            if state.retry_count < 3 {
                println!("Retrying... (attempt {}/3)", state.retry_count + 1);
                manager.retry_download("whisper-base").await?;
            }
        }
        _ => {}
    }
}
```

### List All Downloads

```rust
let downloads = manager.get_downloads();

for download in downloads {
    println!("Model: {}", download.model_name);
    println!("  Status: {:?}", download.status);
    println!("  Size: {} / {} bytes", download.current_bytes, download.total_bytes);

    if let Some(error) = &download.last_error {
        println!("  Error: {}", error);
    }

    if download.retry_count > 0 {
        println!("  Retries: {}/3", download.retry_count);
    }
}
```

### Cancel Download

```rust
match manager.cancel_download("whisper-base").await {
    Ok(_) => println!("Download cancelled"),
    Err(e) => eprintln!("Failed to cancel: {}", e),
}
```

### Cleanup Completed Downloads

```rust
// Remove completed downloads from state
manager.clear_completed()?;
```

---

## Error Handling

### Common Errors

```rust
match manager.queue_download(...).await {
    Ok(_) => println!("Download queued"),
    Err(AppError::ModelError(msg)) => {
        if msg.contains("already being downloaded") {
            println!("Download already in progress");
        } else {
            println!("Model error: {}", msg);
        }
    }
    Err(e) => eprintln!("Unexpected error: {}", e),
}
```

### Retry on Failure

```rust
// Automatically retry failed downloads
let downloads = manager.get_downloads();
for download in downloads {
    if download.status == DownloadStatus::Failed && download.retry_count < 3 {
        println!("Retrying {} (attempt {}/3)",
                 download.model_name,
                 download.retry_count + 1);
        manager.retry_download(&download.model_name).await?;
    }
}
```

---

## Integration with Tauri Commands

### Command: `download_model`

```rust
#[tauri::command]
async fn download_model(
    task_manager: State<'_, TaskManagerState>,
    model_name: String,
    model_type: String,
    hugging_face_token: Option<String>,
) -> Result<String, AppError> {
    let manager = task_manager.lock().await;
    let mut download_manager = manager.download_manager.lock().await;

    download_manager.queue_download(
        model_name.clone(),
        model_type,
        hugging_face_token,
    ).await?;

    Ok(model_name)
}
```

### Command: `cancel_model_download`

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

### Command: `get_download_states`

```rust
#[tauri::command]
async fn get_download_states(
    task_manager: State<'_, TaskManagerState>,
) -> Result<Vec<DownloadState>, AppError> {
    let manager = task_manager.lock().await;
    let download_manager = manager.download_manager.lock().await;
    Ok(download_manager.get_downloads())
}
```

### Command: `retry_model_download`

```rust
#[tauri::command]
async fn retry_model_download(
    task_manager: State<'_, TaskManagerState>,
    model_name: String,
) -> Result<(), AppError> {
    let manager = task_manager.lock().await;
    let mut download_manager = manager.download_manager.lock().await;
    download_manager.retry_download(&model_name).await
}
```

### Command: `clear_completed_downloads`

```rust
#[tauri::command]
async fn clear_completed_downloads(
    task_manager: State<'_, TaskManagerState>,
) -> Result<(), AppError> {
    let manager = task_manager.lock().await;
    let mut download_manager = manager.download_manager.lock().await;
    download_manager.clear_completed()
}
```

---

## Frontend Integration

### TypeScript Types

```typescript
// src/types/index.ts
export type DownloadStatus =
  | "Queued"
  | "Downloading"
  | "Paused"
  | "Completed"
  | "Failed"
  | "Cancelled";

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

### React Hook Example

```typescript
import { useEffect, useState } from 'react';
import { getDownloadStates, downloadModel } from '@/services/tauri';
import type { DownloadState } from '@/types';

export function useDownloadManager() {
  const [downloads, setDownloads] = useState<DownloadState[]>([]);

  useEffect(() => {
    // Load initial state
    getDownloadStates().then(setDownloads);

    // Listen for updates
    const unlisten = Promise.all([
      listen('model-download-queued', () => refresh()),
      listen('model-download-progress', () => refresh()),
      listen('model-download-complete', () => refresh()),
      listen('model-download-error', () => refresh()),
      listen('model-download-cancelled', () => refresh()),
    ]);

    return () => {
      unlisten.then(([u1, u2, u3, u4, u5]) => {
        u1();
        u2();
        u3();
        u4();
        u5();
      });
    };
  }, []);

  const refresh = async () => {
    const states = await getDownloadStates();
    setDownloads(states);
  };

  const download = async (modelName: string, modelType: string) => {
    await downloadModel(modelName, modelType, null);
    await refresh();
  };

  return { downloads, download, refresh };
}
```

---

## Testing

### Unit Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_download_state_serialization() {
        let state = DownloadState {
            model_name: "whisper-base".to_string(),
            model_type: "whisper".to_string(),
            status: DownloadStatus::Queued,
            retry_count: 0,
            current_bytes: 0,
            total_bytes: 0,
            last_error: None,
            started_at: Some(1234567890),
            completed_at: None,
        };

        let json = serde_json::to_string(&state).unwrap();
        let deserialized: DownloadState = serde_json::from_str(&json).unwrap();

        assert_eq!(state.model_name, deserialized.model_name);
        assert_eq!(state.status, deserialized.status);
    }

    #[test]
    fn test_progress_calculation() {
        let state = DownloadState {
            current_bytes: 150_000_000,
            total_bytes: 300_000_000,
            // ... other fields
        };

        let percent = (state.current_bytes as f64 / state.total_bytes as f64) * 100.0;
        assert_eq!(percent, 50.0);
    }
}
```

---

## Performance Considerations

### State File I/O

State is saved synchronously on every change. For high-frequency updates:

```rust
// Debounce state saves if needed
use std::time::{Duration, Instant};
use tokio::time::sleep;

let mut last_save = Instant::now();
let save_interval = Duration::from_secs(1);

// Only save if 1 second has passed since last save
if last_save.elapsed() >= save_interval {
    self.save_state()?;
    last_save = Instant::now();
}
```

### Memory Usage

Each download state consumes approximately 350 bytes:
- Model name: ~20 bytes
- Model type: ~10 bytes
- Status: 1 byte
- Counters: 16 bytes
- Timestamps: 16 bytes
- Strings (error, etc.): ~50-100 bytes
- JSON overhead: ~200 bytes

For 100 downloads: ~35KB (negligible)

---

## Security Considerations

### Token Handling

HuggingFace tokens are passed via secure temp files (not environment variables):

```rust
// Token file is created with restrictive permissions
#[cfg(unix)]
{
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(temp_file.path())?;
    perms.set_mode(0o400); // Read-only for owner
    std::fs::set_permissions(temp_file.path(), perms)?;
}
```

Token files are automatically deleted after download:

```rust
// Clean up token file after download
if let Some(path) = token_file {
    let _ = std::fs::remove_file(path);
}
```

---

## Future Enhancements

### Planned Features

1. **Pause/Resume**
   ```rust
   pub async fn pause_download(&mut self, model_name: &str) -> Result<(), AppError>
   pub async fn resume_download(&mut self, model_name: &str) -> Result<(), AppError>
   ```

2. **Download Priorities**
   ```rust
   pub enum DownloadPriority { High, Normal, Low }
   pub async fn queue_download_with_priority(...) -> Result<(), AppError>
   ```

3. **Bandwidth Throttling**
   ```rust
   pub async fn set_max_bandwidth(&mut self, mb_per_second: f64)
   ```

4. **Download Scheduling**
   ```rust
   pub async fn schedule_download(&mut self, start_time: u64) -> Result<(), AppError>
   ```

5. **Checksum Verification**
   ```rust
   pub async fn verify_download(&self, model_name: &str) -> Result<bool, AppError>
   ```

---

## Troubleshooting

### Download Not Starting

**Symptom:** Download stuck in "Queued" status

**Solutions:**
1. Check concurrent download limit (max 3)
2. Check if other downloads are stuck
3. Cancel stuck downloads
4. Restart app to reload state

### High Retry Count

**Symptom:** Download failing repeatedly

**Solutions:**
1. Check `last_error` field for specific error
2. Verify network connectivity
3. Check available disk space
4. Verify HuggingFace token (if needed)
5. Check Python engine logs

### State File Corruption

**Symptom:** Failed to load state on startup

**Solutions:**
1. Delete state file: `~/.config/Vocrify/download_state.json`
2. Restart app (will create fresh state)
3. Check logs for specific parse error

---

## License

This module is part of the Transcribe Video project and follows the same license.

## Contributing

When modifying this module:
1. Update state version if format changes
2. Add tests for new functionality
3. Update this documentation
4. Consider backward compatibility

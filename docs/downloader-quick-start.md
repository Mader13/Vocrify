# Model Downloader - Quick Start Guide

## Installation

No additional installation needed. The downloader uses existing dependencies:

```bash
# Already installed in ai-engine/requirements.txt
pip install huggingface_hub requests
```

## Basic Usage

### Simple Download

```python
from downloader import download_model

# Download from HuggingFace Hub
model_path = download_model(
    repo_id="guillaumekln/faster-whisper-tiny",
    target_dir="/path/to/cache",
)
```

### With Progress Tracking

```python
import threading
from downloader import ModelDownloader, DownloadProgress

cancel_event = threading.Event()

def on_progress(progress: DownloadProgress):
    """Handle progress updates."""
    print(f"{progress.stage.value}: {progress.progress_percent:.1f}%")
    print(f"  {progress.message}")
    if progress.speed_bytes_per_sec > 0:
        print(f"  Speed: {progress.speed_bytes_per_sec / (1024**2):.2f} MB/s")
    if progress.eta_seconds > 0:
        print(f"  ETA: {progress.eta_seconds:.0f} seconds")

downloader = ModelDownloader(
    progress_callback=on_progress,
    cancel_event=cancel_event,
)

model_path = downloader.download_from_huggingface(
    repo_id="guillaumekln/faster-whisper-base",
    target_dir="/path/to/cache",
    model_name="whisper-base",
)
```

### Download from URL

```python
from downloader import download_from_url

# Download from GitHub releases or other URL
file_path = download_from_url(
    url="https://github.com/user/repo/releases/download/v1.0/model.onnx",
    target_dir="/path/to/cache",
    filename="model.onnx",  # Optional, uses URL basename if not provided
    extract=True,  # Extract tar/zip archives automatically
)
```

### With Authentication

```python
from downloader import download_model

# Download gated model (requires HuggingFace token)
model_path = download_model(
    repo_id="pyannote/speaker-diarization-3.1",
    target_dir="/path/to/cache",
    token="hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",  # Or read from file
)
```

## Configuration

### Default Configuration

```python
from downloader import DownloadConfig, ModelDownloader

config = DownloadConfig()
# Defaults:
# - max_retries: 3
# - retry_delay_base: 1.0 seconds
# - retry_delay_max: 60.0 seconds
# - chunk_size: 8192 bytes
# - timeout: 300 seconds
# - max_download_size: 10GB
# - resume_enabled: True
# - verify_checksum: True
# - check_disk_space: True
# - disk_space_buffer: 1.5

downloader = ModelDownloader(config=config)
```

### Custom Configuration

```python
config = DownloadConfig(
    max_retries=5,                    # More retries for unreliable networks
    retry_delay_base=2.0,             # Start with 2 second delay
    chunk_size=16384,                 # Larger chunks for faster downloads
    timeout=600,                      # 10 minute timeout
    max_download_size=20 * 1024**3,   # 20GB max size
    resume_enabled=True,              # Allow resume on interruption
    verify_checksum=True,             # Verify file integrity
    check_disk_space=True,            # Check space before download
    disk_space_buffer=2.0,            # Require 2x space for safety
)
```

## Error Handling

### Basic Error Handling

```python
from downloader import (
    ModelDownloader,
    DownloadFailedException,
    InsufficientDiskSpaceException,
    ChecksumVerificationException,
    DownloadCancelledException,
)

downloader = ModelDownloader()

try:
    model_path = downloader.download_from_huggingface(
        repo_id="org/model",
        target_dir="/path/to/cache",
    )
    print(f"Downloaded to: {model_path}")

except InsufficientDiskSpaceException as e:
    print(f"ERROR: Not enough disk space")
    print(f"  Required: {e.required_bytes / (1024**3):.2f} GB")
    print(f"  Available: {e.available_bytes / (1024**3):.2f} GB")
    print(f"  Please free up {e.required_bytes / (1024**3):.2f} GB")

except DownloadFailedException as e:
    print(f"ERROR: Download failed after {e.retry_count} attempts")
    print(f"  Last error: {e.last_error}")
    print(f"  Check your internet connection and try again")

except ChecksumVerificationException as e:
    print(f"ERROR: Download corrupted")
    print(f"  File: {e.file_path}")
    print(f"  Expected: {e.expected_checksum}")
    print(f"  Actual: {e.actual_checksum}")
    print(f"  Please try downloading again")

except DownloadCancelledException:
    print("Download was cancelled by user")

except Exception as e:
    print(f"Unexpected error: {e}")
```

### Retry with Different Configuration

```python
from downloader import ModelDownloader, DownloadConfig

# First attempt with default config
try:
    downloader = ModelDownloader()
    model_path = downloader.download_from_huggingface(...)
except DownloadFailedException:
    # Retry with more patience for slow networks
    config = DownloadConfig(
        max_retries=5,
        retry_delay_base=5.0,
        timeout=900,
    )
    downloader = ModelDownloader(config=config)
    model_path = downloader.download_from_huggingface(...)
```

## Cancellation

### Cancel from Main Thread

```python
import threading
from downloader import ModelDownloader

cancel_event = threading.Event()

downloader = ModelDownloader(cancel_event=cancel_event)

# Start download in background
import threading
download_thread = threading.Thread(
    target=lambda: downloader.download_from_huggingface(...)
)
download_thread.start()

# Cancel if needed
# cancel_event.set()
# download_thread.join()
```

### Cancel with Timeout

```python
import threading
import time
from downloader import ModelDownloader

cancel_event = threading.Event()
downloader = ModelDownloader(cancel_event=cancel_event)

def download_with_timeout(repo_id, target_dir, timeout_seconds=300):
    """Download with timeout."""
    def do_download():
        return downloader.download_from_huggingface(repo_id, target_dir)

    thread = threading.Thread(target=do_download)
    thread.start()

    # Wait for completion or timeout
    thread.join(timeout=timeout_seconds)

    if thread.is_alive():
        # Timeout reached, cancel download
        cancel_event.set()
        thread.join()
        raise TimeoutError(f"Download timed out after {timeout_seconds} seconds")

    return thread.result  # or however you get the result
```

## Checksum Verification

### Calculate Checksum for Verification

```python
import hashlib

def calculate_file_checksum(file_path: str) -> str:
    """Calculate SHA256 checksum of a file."""
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256.update(chunk)
    return sha256.hexdigest()

# Use for verification
checksum = calculate_file_checksum("/path/to/downloaded/file.bin")

# Then download with verification
from downloader import ModelDownloader
downloader = ModelDownloader()
file_path = downloader.download_from_url(
    url="https://example.com/file.bin",
    target_dir="/path/to/cache",
    checksum=checksum,
)
```

### Download with Trusted Checksum

```python
# Checksum from trusted source (e.g., model card)
TRUSTED_CHECKSUMS = {
    "whisper-tiny": "abc123...",
    "whisper-base": "def456...",
    "whisper-small": "ghi789...",
}

from downloader import ModelDownloader
downloader = ModelDownloader()

model_path = downloader.download_from_huggingface(
    repo_id="guillaumekln/faster-whisper-tiny",
    target_dir="/path/to/cache",
    model_name="whisper-tiny",
)

# Verify after download (manual verification)
actual_checksum = calculate_file_checksum(model_path)
expected_checksum = TRUSTED_CHECKSUMS["whisper-tiny"]
if actual_checksum != expected_checksum:
    raise ValueError(f"Checksum mismatch!")
```

## Progress Stages

The downloader emits progress updates with the following stages:

```python
from downloader import DownloadStage

stages = {
    DownloadStage.INITIALIZING: "Preparing download...",
    DownloadStage.VALIDATING: "Validating model information...",
    DownloadStage.CHECKING_DISK: "Checking disk space...",
    DownloadStage.DOWNLOADING: "Downloading model files...",
    DownloadStage.VERIFYING: "Verifying file integrity...",
    DownloadStage.EXTRACTING: "Extracting archive...",
    DownloadStage.COMPLETE: "Download complete!",
    DownloadStage.FAILED: "Download failed",
    DownloadStage.CANCELLED: "Download cancelled",
}
```

### React to Different Stages

```python
def on_progress(progress: DownloadProgress):
    """Handle different download stages."""
    if progress.stage == DownloadStage.CHECKING_DISK:
        print("Checking if you have enough space...")

    elif progress.stage == DownloadStage.DOWNLOADING:
        mb_downloaded = progress.downloaded_bytes / (1024**2)
        mb_total = progress.total_bytes / (1024**2)
        speed_mb = progress.speed_bytes_per_sec / (1024**2)
        print(f"Downloading: {mb_downloaded:.1f}/{mb_total:.1f} MB")
        print(f"  Speed: {speed_mb:.2f} MB/s")
        print(f"  ETA: {progress.eta_seconds:.0f} seconds")

    elif progress.stage == DownloadStage.VERIFYING:
        print("Verifying download integrity...")

    elif progress.stage == DownloadStage.COMPLETE:
        print("Download complete!")

    elif progress.stage == DownloadStage.FAILED:
        print(f"Download failed: {progress.message}")
```

## Integration with Existing Code

### Replacing old download_model()

```python
# In main.py or wherever you call download_model

# OLD CODE:
from main import download_model, _download_cancelled
download_model(
    model_name="whisper-tiny",
    cache_dir="/path/to/cache",
    model_type="whisper",
)

# NEW CODE:
from downloader import download_model

# Map model names to repo IDs (use existing MODEL_REPOSITORIES)
MODEL_REPOS = {
    "whisper-tiny": "guillaumekln/faster-whisper-tiny",
    "whisper-base": "guillaumekln/faster-whisper-base",
    # ... etc
}

repo_id = MODEL_REPOS.get("whisper-tiny")
if repo_id:
    model_path = download_model(
        repo_id=repo_id,
        target_dir="/path/to/cache/whisper-tiny",
    )
```

### With Tauri Integration

```python
# In ai-engine/main.py

import threading
from downloader import ModelDownloader

_download_cancel_event = threading.Event()

def download_model_for_tauri(model_name: str, cache_dir: str):
    """Download model and emit progress as JSON for Tauri."""

    def progress_callback(progress):
        """Emit progress as JSON for frontend."""
        emit_progress(
            progress.stage.value,
            int(progress.progress_percent),
            progress.message
        )

    try:
        downloader = ModelDownloader(
            progress_callback=progress_callback,
            cancel_event=_download_cancel_event,
        )

        # Use existing MODEL_REPOSITORIES mapping
        repo_id = MODEL_REPOSITORIES.get(model_name)
        if not repo_id:
            emit_error(f"Unknown model: {model_name}")
            return

        target_dir = os.path.join(cache_dir, model_name)

        # Download
        path = downloader.download_from_huggingface(
            repo_id=repo_id,
            target_dir=target_dir,
            model_name=model_name,
        )

        # Emit completion
        size_mb = get_model_size_mb(path)
        emit_download_complete(model_name, size_mb, path)

    except Exception as e:
        emit_error(f"Download failed: {str(e)}")

def cancel_download():
    """Cancel active download."""
    _download_cancel_event.set()
```

## Common Patterns

### Download Multiple Models

```python
from downloader import ModelDownloader

models = [
    ("guillaumekln/faster-whisper-tiny", "/cache/whisper-tiny"),
    ("guillaumekln/faster-whisper-base", "/cache/whisper-base"),
]

downloader = ModelDownloader()

for repo_id, target_dir in models:
    print(f"Downloading {repo_id}...")
    try:
        path = downloader.download_from_huggingface(repo_id, target_dir)
        print(f"  Success: {path}")
    except Exception as e:
        print(f"  Failed: {e}")
```

### Download with Retry on Failure

```python
from downloader import ModelDownloader, DownloadFailedException
import time

downloader = ModelDownloader()

max_attempts = 3
for attempt in range(max_attempts):
    try:
        model_path = downloader.download_from_huggingface(...)
        break  # Success
    except DownloadFailedException as e:
        if attempt < max_attempts - 1:
            print(f"Attempt {attempt + 1} failed, retrying in 5 seconds...")
            time.sleep(5)
        else:
            print(f"All {max_attempts} attempts failed")
            raise
```

### Download with Progress Bar (CLI)

```python
from downloader import ModelDownloader, DownloadProgress
import sys

def progress_bar(progress: DownloadProgress):
    """Display terminal progress bar."""
    if progress.stage == DownloadStage.DOWNLOADING:
        percent = progress.progress_percent
        bar_length = 50
        filled = int(bar_length * percent / 100)
        bar = '█' * filled + '░' * (bar_length - filled)

        speed = progress.speed_bytes_per_sec / (1024**2)
        eta = progress.eta_seconds

        sys.stdout.write(f"\r[{bar}] {percent:.1f}% | {speed:.2f} MB/s | ETA: {eta:.0f}s")
        sys.stdout.flush()

    elif progress.stage == DownloadStage.COMPLETE:
        print()  # New line after progress bar

downloader = ModelDownloader(progress_callback=progress_bar)
model_path = downloader.download_from_huggingface(...)
```

## Troubleshooting

### Download Fails Immediately

**Problem:** Download fails with "not in whitelist" error

**Solution:** The URL is not in the allowed hosts list. Add it to `ALLOWED_HOSTS` in `downloader.py`:

```python
ALLOWED_HOSTS = {
    "github.com",
    "huggingface.co",
    "cdn-lfs.huggingface.co",
    "objects.githubusercontent.com",
    "your-custom-host.com",  # Add here
}
```

### Download Stalls

**Problem:** Download starts but stops making progress

**Solution:** Enable more retries and longer timeout:

```python
config = DownloadConfig(
    max_retries=5,
    retry_delay_base=5.0,
    timeout=900,  # 15 minutes
)
downloader = ModelDownloader(config=config)
```

### Out of Memory

**Problem:** Large downloads cause memory issues

**Solution:** Reduce chunk size:

```python
config = DownloadConfig(chunk_size=4096)  # Smaller chunks
downloader = ModelDownloader(config=config)
```

### Checksum Mismatch

**Problem:** Download fails with checksum verification error

**Solution:** The file is corrupted. Try:
1. Download again (resume will skip already-downloaded bytes)
2. Disable verification if checksums are unavailable:
   ```python
   config = DownloadConfig(verify_checksum=False)
   ```

## Best Practices

1. **Always use progress callbacks** for user feedback
2. **Enable disk space checking** to fail fast
3. **Use checksums** when available for integrity
4. **Set appropriate timeouts** for your network
5. **Handle cancellation** gracefully in your UI
6. **Log errors** for troubleshooting
7. **Use retry** for unreliable networks
8. **Verify disk space** before large downloads

## API Reference

See the full API documentation in `docs/downloader-improvements.md`.

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review error messages (they're detailed!)
3. See `docs/downloader-improvements.md` for architecture details
4. Check `tests/unit/python/test_downloader_new.py` for examples

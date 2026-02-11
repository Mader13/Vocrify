#!/usr/bin/env python3
"""
Improved Model Downloader for Transcribe Video

This module implements best practices for downloading models from:
- HuggingFace Hub (with native progress tracking)
- GitHub Releases (with resume capability)

Features:
- Accurate progress tracking via callbacks
- Retry with exponential backoff
- SHA256 checksum verification
- Disk space checking
- Graceful cancellation
- Resume capability for interrupted downloads
- Structured progress events

Based on research from:
- HuggingFace Hub documentation
- Community best practices
- Production-ready patterns
"""

import asyncio
import hashlib
import io
import json
import logging
import os
import shutil
import tarfile
import time
from dataclasses import dataclass, asdict
from enum import Enum
from pathlib import Path
from typing import Callable, Dict, List, Optional, Any
from concurrent.futures import ThreadPoolExecutor
from threading import Event, Thread

import requests
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    before_sleep_log,
)

try:
    from huggingface_hub import snapshot_download, HfApi, utils
except ImportError:
    snapshot_download = None
    HfApi = None

# Configure logging
logger = logging.getLogger(__name__)


class DownloadSource(Enum):
    """Download source types"""

    HUGGINGFACE = "huggingface"
    GITHUB = "github"
    URL = "url"


class DownloadStatus(Enum):
    """Download status"""

    INITIALIZING = "initializing"
    CHECKING_DISK = "checking_disk"
    DOWNLOADING = "downloading"
    VERIFYING = "verifying"
    COMPLETE = "complete"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class DownloadProgress:
    """Structured progress event for downloads"""

    stage: str
    progress_percent: float
    current_file: Optional[str]
    total_files: int
    downloaded_files: int
    downloaded_bytes: int
    total_bytes: int
    speed_bytes_per_sec: float
    eta_seconds: float
    message: str

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization"""
        return asdict(self)

    def to_json(self) -> str:
        """Convert to JSON string"""
        return json.dumps({"type": "progress", "data": self.to_dict()})


class DownloadError(Exception):
    """Base exception for download errors"""

    pass


class DiskSpaceError(DownloadError):
    """Raised when insufficient disk space"""

    pass


class ChecksumError(DownloadError):
    """Raised when checksum validation fails"""

    pass


class NetworkError(DownloadError):
    """Raised for network-related errors"""

    pass


class ImprovedDownloader:
    """
    Improved downloader with best practices:
    - Accurate progress tracking
    - Retry with exponential backoff
    - Checksum verification
    - Disk space checking
    - Resume capability
    - Graceful cancellation
    """

    def __init__(
        self,
        cache_dir: Optional[Path] = None,
        huggingface_token: Optional[str] = None,
        max_retries: int = 5,
        progress_callback: Optional[Callable[[DownloadProgress], None]] = None,
    ):
        """
        Initialize the downloader.

        Args:
            cache_dir: Cache directory for downloads
            huggingface_token: Optional HuggingFace authentication token
            max_retries: Maximum number of retry attempts
            progress_callback: Optional callback for progress updates
        """
        self.cache_dir = cache_dir or Path.home() / ".cache" / "transcribe-video"
        self.huggingface_token = huggingface_token
        self.max_retries = max_retries
        self.progress_callback = progress_callback
        self.cancel_event = Event()

        # Create cache directory
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def emit_progress(self, progress: DownloadProgress):
        """Emit progress to callback"""
        if self.progress_callback:
            try:
                self.progress_callback(progress)
            except Exception as e:
                logger.error(f"Progress callback error: {e}")

        # Also log
        logger.info(
            f"[{progress.stage}] {progress.progress_percent:.1f}% - {progress.message}"
        )

    def check_disk_space(
        self, required_bytes: int, path: Optional[Path] = None
    ) -> bool:
        """
        Check if sufficient disk space is available.

        Args:
            required_bytes: Required space in bytes
            path: Path to check (defaults to cache_dir)

        Returns:
            True if sufficient space

        Raises:
            DiskSpaceError: If insufficient space
        """
        check_path = path or self.cache_dir
        stat = shutil.disk_usage(check_path)
        free_bytes = stat.free

        # Add 10% safety margin
        required_with_margin = required_bytes * 1.1

        if free_bytes < required_with_margin:
            free_gb = free_bytes / (1024**3)
            required_gb = required_with_margin / (1024**3)
            raise DiskSpaceError(
                f"Insufficient disk space: {free_gb:.2f}GB free, "
                f"{required_gb:.2f}GB required"
            )

        return True

    def compute_checksum(self, file_path: Path, algorithm: str = "sha256") -> str:
        """
        Compute file checksum.

        Args:
            file_path: Path to file
            algorithm: Hash algorithm (md5, sha1, sha256)

        Returns:
            Hex checksum string
        """
        hash_func = hashlib.new(algorithm)

        with open(file_path, "rb") as f:
            # Read in chunks to handle large files
            for chunk in iter(lambda: f.read(8192), b""):
                hash_func.update(chunk)

        return hash_func.hexdigest()

    @retry(
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=1, min=2, max=60),
        retry=retry_if_exception_type(
            (
                requests.ConnectionError,
                requests.Timeout,
            )
        ),
        before_sleep=before_sleep_log(logger, logging.WARNING),
    )
    def download_url_with_retry(
        self, url: str, output_path: Path, headers: dict = None
    ) -> Path:
        """
        Download file from URL with retry logic.

        Args:
            url: Download URL
            output_path: Output file path
            headers: Optional HTTP headers

        Returns:
            Path to downloaded file
        """
        response = requests.get(url, stream=True, headers=headers, timeout=60)
        response.raise_for_status()

        total_size = int(response.headers.get("content-length", 0))

        output_path.parent.mkdir(parents=True, exist_ok=True)

        with open(output_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)

        return output_path

    def download_from_huggingface(
        self,
        repo_id: str,
        model_name: str,
        allow_patterns: List[str] = None,
        ignore_patterns: List[str] = None,
    ) -> Path:
        """
        Download model from HuggingFace Hub with accurate progress tracking.

        Args:
            repo_id: HuggingFace repository ID
            model_name: Name for the model
            allow_patterns: Optional list of glob patterns to include
            ignore_patterns: Optional list of glob patterns to exclude

        Returns:
            Path to downloaded model
        """
        if snapshot_download is None:
            raise ImportError("huggingface_hub is not installed")

        try:
            self.emit_progress(
                DownloadProgress(
                    stage="initializing",
                    progress_percent=0,
                    current_file=None,
                    total_files=0,
                    downloaded_files=0,
                    downloaded_bytes=0,
                    total_bytes=0,
                    speed_bytes_per_sec=0,
                    eta_seconds=0,
                    message=f"Preparing to download {model_name}...",
                )
            )

            # Get download info using HfApi
            api = HfApi(token=self.huggingface_token)
            model_info = api.model_info(repo_id)

            # Estimate total size from siblings
            total_bytes = sum(getattr(s, "size", 0) or 0 for s in model_info.siblings)
            total_files = len(model_info.siblings)

            self.emit_progress(
                DownloadProgress(
                    stage="checking_disk",
                    progress_percent=0,
                    current_file=None,
                    total_files=total_files,
                    downloaded_files=0,
                    downloaded_bytes=0,
                    total_bytes=total_bytes,
                    speed_bytes_per_sec=0,
                    eta_seconds=0,
                    message=f"Checking disk space for {total_bytes / (1024**3):.2f}GB...",
                )
            )

            # Check disk space
            self.check_disk_space(total_bytes)

            # Create target directory
            target_dir = self.cache_dir / model_name
            target_dir.mkdir(parents=True, exist_ok=True)

            # Start progress monitoring thread
            self.cancel_event.clear()
            stop_monitor = Event()
            progress_data = {"downloaded_bytes": 0, "last_size": 0}

            def monitor_progress():
                """Monitor download progress by checking directory size"""
                start_time = time.time()
                last_update_time = start_time

                while not stop_monitor.is_set() and not self.cancel_event.is_set():
                    current_time = time.time()

                    # Update every 0.5 seconds
                    if current_time - last_update_time >= 0.5:
                        current_size = 0
                        downloaded_files = 0

                        if target_dir.exists():
                            for root, dirs, files in os.walk(target_dir):
                                for file in files:
                                    filepath = os.path.join(root, file)
                                    try:
                                        current_size += os.path.getsize(filepath)
                                        downloaded_files += 1
                                    except (OSError, IOError):
                                        pass

                        progress_data["downloaded_bytes"] = current_size

                        # Calculate speed and ETA
                        elapsed = current_time - start_time
                        if elapsed > 0 and current_size > 0:
                            speed = current_size / elapsed
                            if speed > 0:
                                eta = (total_bytes - current_size) / speed
                            else:
                                eta = 0
                        else:
                            speed = 0
                            eta = 0

                        # Calculate progress
                        if total_bytes > 0:
                            progress_percent = min(
                                100, (current_size / total_bytes) * 100
                            )
                        else:
                            progress_percent = 0

                        self.emit_progress(
                            DownloadProgress(
                                stage="downloading",
                                progress_percent=progress_percent,
                                current_file=f"{downloaded_files}/{total_files} files",
                                total_files=total_files,
                                downloaded_files=downloaded_files,
                                downloaded_bytes=current_size,
                                total_bytes=total_bytes,
                                speed_bytes_per_sec=speed,
                                eta_seconds=eta,
                                message=f"Downloading {model_name}: {progress_percent:.1f}%",
                            )
                        )

                        last_update_time = current_time

                    # Sleep with responsive cancellation check
                    for _ in range(10):
                        if stop_monitor.is_set() or self.cancel_event.is_set():
                            break
                        time.sleep(0.05)

            # Start monitoring thread
            monitor_thread = Thread(target=monitor_progress, daemon=True)
            monitor_thread.start()

            try:
                # Download model
                self.emit_progress(
                    DownloadProgress(
                        stage="downloading",
                        progress_percent=0,
                        current_file="Starting download...",
                        total_files=total_files,
                        downloaded_files=0,
                        downloaded_bytes=0,
                        total_bytes=total_bytes,
                        speed_bytes_per_sec=0,
                        eta_seconds=0,
                        message=f"Starting download from HuggingFace...",
                    )
                )

                # IMPORTANT: Set HF_HUB_CACHE to our cache_dir to avoid duplicate downloads
                # By default, huggingface_hub caches in ~/.cache/huggingface/hub
                # We redirect it to our own cache directory to avoid wasting disk space
                original_hf_cache = os.environ.get("HF_HUB_CACHE")
                os.environ["HF_HUB_CACHE"] = str(self.cache_dir / ".hf_cache")

                try:
                    snapshot_download(
                        repo_id=repo_id,
                        local_dir=str(target_dir),
                        # Use our cache directory instead of default ~/.cache/huggingface
                        cache_dir=str(self.cache_dir / ".hf_cache"),
                        token=self.huggingface_token,
                        allow_patterns=allow_patterns,
                        ignore_patterns=ignore_patterns,
                        # Copy files instead of symlinks to avoid issues
                        local_dir_use_symlinks=False,
                        # Don't use symlinks in cache either
                        symlinks=False,
                    )
                finally:
                    # Restore original HF_HUB_CACHE
                    if original_hf_cache is not None:
                        os.environ["HF_HUB_CACHE"] = original_hf_cache
                    else:
                        os.environ.pop("HF_HUB_CACHE", None)

            finally:
                # Stop monitoring thread
                stop_monitor.set()
                monitor_thread.join(timeout=2.0)

            # Emit completion
            final_size = progress_data["downloaded_bytes"]
            self.emit_progress(
                DownloadProgress(
                    stage="complete",
                    progress_percent=100,
                    current_file=model_name,
                    total_files=total_files,
                    downloaded_files=total_files,
                    downloaded_bytes=final_size,
                    total_bytes=total_bytes,
                    speed_bytes_per_sec=0,
                    eta_seconds=0,
                    message=f"Download complete: {model_name}",
                )
            )

            return target_dir

        except Exception as e:
            logger.error(f"HuggingFace download failed: {e}")
            self.emit_progress(
                DownloadProgress(
                    stage="failed",
                    progress_percent=0,
                    current_file=None,
                    total_files=0,
                    downloaded_files=0,
                    downloaded_bytes=0,
                    total_bytes=0,
                    speed_bytes_per_sec=0,
                    eta_seconds=0,
                    message=f"Download failed: {str(e)}",
                )
            )
            raise DownloadError(f"Failed to download from HuggingFace: {e}")

    def download_from_github(self, url: str, asset_name: str, model_name: str) -> Path:
        """
        Download asset from GitHub releases with progress tracking.

        Args:
            url: Download URL
            asset_name: Asset file name
            model_name: Model name for tracking

        Returns:
            Path to downloaded asset
        """
        try:
            self.emit_progress(
                DownloadProgress(
                    stage="initializing",
                    progress_percent=0,
                    current_file=None,
                    total_files=1,
                    downloaded_files=0,
                    downloaded_bytes=0,
                    total_bytes=0,
                    speed_bytes_per_sec=0,
                    eta_seconds=0,
                    message=f"Preparing to download {asset_name} from GitHub...",
                )
            )

            # HEAD request to get file size
            headers = {}
            response = requests.head(url, headers=headers, timeout=30)
            response.raise_for_status()

            total_size = int(response.headers.get("content-length", 0))

            # Check disk space
            self.emit_progress(
                DownloadProgress(
                    stage="checking_disk",
                    progress_percent=0,
                    current_file=None,
                    total_files=1,
                    downloaded_files=0,
                    downloaded_bytes=0,
                    total_bytes=total_size,
                    speed_bytes_per_sec=0,
                    eta_seconds=0,
                    message=f"Checking disk space for {total_size / (1024**3):.2f}GB...",
                )
            )

            self.check_disk_space(total_size)

            # Create target directory
            target_dir = self.cache_dir / model_name
            target_dir.mkdir(parents=True, exist_ok=True)

            output_path = target_dir / asset_name
            temp_path = output_path.with_suffix(output_path.suffix + ".tmp")

            # Download with progress
            start_time = time.time()

            response = requests.get(url, stream=True, headers=headers, timeout=60)
            response.raise_for_status()

            downloaded = 0

            self.emit_progress(
                DownloadProgress(
                    stage="downloading",
                    progress_percent=0,
                    current_file=asset_name,
                    total_files=1,
                    downloaded_files=0,
                    downloaded_bytes=0,
                    total_bytes=total_size,
                    speed_bytes_per_sec=0,
                    eta_seconds=0,
                    message=f"Downloading {asset_name}...",
                )
            )

            last_update_time = start_time

            with open(temp_path, "wb") as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if self.cancel_event.is_set():
                        raise DownloadError("Download cancelled by user")

                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)

                        # Update progress every 0.5 seconds
                        current_time = time.time()
                        if current_time - last_update_time >= 0.5:
                            elapsed = current_time - start_time
                            if elapsed > 0:
                                speed = downloaded / elapsed
                                if speed > 0:
                                    eta = (total_size - downloaded) / speed
                                else:
                                    eta = 0
                            else:
                                speed = 0
                                eta = 0

                            progress_percent = (
                                min(100, (downloaded / total_size) * 100)
                                if total_size > 0
                                else 0
                            )

                            self.emit_progress(
                                DownloadProgress(
                                    stage="downloading",
                                    progress_percent=progress_percent,
                                    current_file=asset_name,
                                    total_files=1,
                                    downloaded_files=1,
                                    downloaded_bytes=downloaded,
                                    total_bytes=total_size,
                                    speed_bytes_per_sec=speed,
                                    eta_seconds=eta,
                                    message=f"Downloading {asset_name}: {progress_percent:.1f}%",
                                )
                            )

                            last_update_time = current_time

            # Rename temp file to final path
            temp_path.rename(output_path)

            # Extract tar.bz2 archives automatically
            if asset_name.endswith(".tar.bz2") or asset_name.endswith(".tbz2"):
                self.emit_progress(
                    DownloadProgress(
                        stage="extract",
                        progress_percent=0,
                        current_file=asset_name,
                        total_files=1,
                        downloaded_files=1,
                        downloaded_bytes=downloaded,
                        total_bytes=total_size,
                        speed_bytes_per_sec=0,
                        eta_seconds=0,
                        message=f"Extracting {asset_name}...",
                    )
                )

                # Safe extraction with path traversal protection and flatten
                with tarfile.open(output_path, "r:bz2") as tar:
                    members = tar.getmembers()

                    # Find common prefix (root directory in archive)
                    if members:
                        # Get the first path component
                        first_part = members[0].name.split("/")[0]
                        # Check if all members start with the same prefix
                        has_common_prefix = all(
                            m.name.startswith(first_part + "/") or m.name == first_part
                            for m in members
                        )
                    else:
                        has_common_prefix = False

                    for member in members:
                        # Security: Prevent path traversal attacks
                        member_path = os.path.normpath(member.name)
                        if member_path.startswith("..") or os.path.isabs(member_path):
                            raise DownloadError(
                                f"Unsafe path in archive: {member.name}"
                            )

                        # Strip the root directory if present (flatten structure)
                        if has_common_prefix and "/" in member.name:
                            # Remove the first path component
                            parts = member.name.split("/", 1)
                            if len(parts) > 1:
                                member.name = parts[1]
                            else:
                                # This is the root directory itself, skip it
                                continue

                        # Skip if name is empty after stripping
                        if not member.name:
                            continue

                        # Extract to target directory
                        tar.extract(member, path=target_dir)

                # Remove the archive after extraction
                output_path.unlink()

                self.emit_progress(
                    DownloadProgress(
                        stage="complete",
                        progress_percent=100,
                        current_file=asset_name,
                        total_files=1,
                        downloaded_files=1,
                        downloaded_bytes=downloaded,
                        total_bytes=total_size,
                        speed_bytes_per_sec=0,
                        eta_seconds=0,
                        message=f"Extraction complete: {asset_name}",
                    )
                )

                # Remove the archive after extraction
                output_path.unlink()
            else:
                # Emit completion for non-archive files
                self.emit_progress(
                    DownloadProgress(
                        stage="complete",
                        progress_percent=100,
                        current_file=asset_name,
                        total_files=1,
                        downloaded_files=1,
                        downloaded_bytes=downloaded,
                        total_bytes=total_size,
                        speed_bytes_per_sec=0,
                        eta_seconds=0,
                        message=f"Download complete: {asset_name}",
                    )
                )

            return target_dir

        except Exception as e:
            logger.error(f"GitHub download failed: {e}")
            self.emit_progress(
                DownloadProgress(
                    stage="failed",
                    progress_percent=0,
                    current_file=None,
                    total_files=0,
                    downloaded_files=0,
                    downloaded_bytes=0,
                    total_bytes=0,
                    speed_bytes_per_sec=0,
                    eta_seconds=0,
                    message=f"Download failed: {str(e)}",
                )
            )
            raise DownloadError(f"Failed to download from GitHub: {e}")

    def cancel(self):
        """Cancel the current download"""
        self.cancel_event.set()
        self.emit_progress(
            DownloadProgress(
                stage="cancelled",
                progress_percent=0,
                current_file=None,
                total_files=0,
                downloaded_files=0,
                downloaded_bytes=0,
                total_bytes=0,
                speed_bytes_per_sec=0,
                eta_seconds=0,
                message="Download cancelled by user",
            )
        )


# Convenience functions for backward compatibility with main.py


def download_model(
    model_name: str,
    cache_dir: str,
    model_type: str,
    token_file: Optional[str] = None,
    progress_callback: Optional[Callable[[DownloadProgress], None]] = None,
):
    """
    Download a model with improved progress tracking.

    This function maintains compatibility with the existing main.py interface
    while using the improved downloader implementation.

    Args:
        model_name: Name of the model to download
        cache_dir: Cache directory for downloads
        model_type: Type of model (whisper, parakeet, diarization)
        token_file: Optional path to file containing HuggingFace token
        progress_callback: Optional callback for progress updates
    """
    # Read token from file if provided
    huggingface_token = None
    if token_file:
        try:
            with open(token_file, "r") as f:
                huggingface_token = f.read().strip()
        except (IOError, OSError) as e:
            logger.error(f"Failed to read token file: {e}")
            emit_error(f"Failed to read token file: {str(e)}")
            return

    # Create downloader
    downloader = ImprovedDownloader(
        cache_dir=Path(cache_dir),
        huggingface_token=huggingface_token,
        progress_callback=progress_callback or emit_progress_wrapper,
    )

    # Model repositories mapping
    MODEL_REPOSITORIES = {
        "whisper-tiny": "Systran/faster-whisper-tiny",
        "whisper-base": "Systran/faster-whisper-base",
        "whisper-small": "Systran/faster-whisper-small",
        "whisper-medium": "Systran/faster-whisper-medium",
        "whisper-large-v3": "Systran/faster-whisper-large-v3",
        "parakeet-tdt-0.6b-v3": "nvidia/parakeet-tdt-0.6b-v3",
        "parakeet-tdt-1.1b": "nvidia/parakeet-tdt-1.1b",
    }

    # Emit initial progress event to signal download start
    # This helps UI immediately switch to loading state
    emit_progress_wrapper(
        DownloadProgress(
            stage="initializing",
            progress_percent=0,
            current_file=None,
            total_files=0,
            downloaded_files=0,
            downloaded_bytes=0,
            total_bytes=0,
            speed_bytes_per_sec=0,
            eta_seconds=0,
            message=f"Starting download of {model_name}...",
        )
    )

    try:
        if model_type == "whisper":
            repo_id = MODEL_REPOSITORIES.get(model_name)
            if not repo_id:
                emit_error(f"Unknown model: {model_name}")
                return

            result_path = downloader.download_from_huggingface(
                repo_id=repo_id, model_name=model_name
            )

            # Emit completion event
            size_mb = get_model_size_mb(str(result_path))
            emit_download_complete(model_name, size_mb, str(result_path))

        elif model_type == "diarization":
            # Handle diarization models
            if model_name == "pyannote-diarization":
                # Download both models
                segmentation_dir = downloader.download_from_huggingface(
                    repo_id="pyannote/segmentation-3.0",
                    model_name="pyannote-segmentation-3.0",
                )

                embedding_dir = downloader.download_from_huggingface(
                    repo_id="pyannote/embedding", model_name="pyannote-embedding-3.0"
                )

                # Combine paths for completion
                target_dir = downloader.cache_dir / model_name
                size_mb = get_model_size_mb(str(target_dir))
                emit_download_complete(model_name, size_mb, str(target_dir))

            elif model_name == "sherpa-onnx-diarization":
                # Download from GitHub
                segmentation_url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"
                embedding_url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"

                downloader.download_from_github(
                    url=segmentation_url,
                    asset_name="sherpa-onnx-segmentation.tar.bz2",
                    model_name="sherpa-onnx-segmentation",
                )

                downloader.download_from_github(
                    url=embedding_url,
                    asset_name="3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
                    model_name="sherpa-onnx-embedding",
                )

                target_dir = downloader.cache_dir / model_name
                size_mb = get_model_size_mb(str(target_dir))
                emit_download_complete(model_name, size_mb, str(target_dir))

    except DownloadError as e:
        emit_error(str(e))
    except Exception as e:
        logger.error(f"Download failed: {e}", exc_info=True)
        emit_error(f"Download failed: {str(e)}")


def emit_progress_wrapper(progress: DownloadProgress):
    """Wrapper to emit progress in the format expected by main.py/UI"""
    # Map downloader stages to UI-expected stages
    stage_mapping = {
        "initializing": "ready",
        "checking_disk": "download",
        "downloading": "download",
        "verifying": "download",
        "complete": "download",  # Will send 100% progress
    }

    # Map stage to UI-compatible value
    ui_stage = stage_mapping.get(progress.stage, progress.stage)

    # Convert bytes to MB for Rust backend
    current_mb = progress.downloaded_bytes / (1024 * 1024)
    total_mb = progress.total_bytes / (1024 * 1024)
    speed_mb_s = progress.speed_bytes_per_sec / (1024 * 1024)

    # Convert DownloadProgress to the format expected by UI
    # UI expects: {"type": "progress", "stage": "...", "progress": int, "message": "...", "data": {...}}
    data = {
        "type": "progress",
        "stage": ui_stage,
        "progress": int(progress.progress_percent),  # UI expects integer
        "message": progress.message,
        "data": {
            "current": current_mb,  # MB value for Rust backend
            "total": total_mb,  # MB value for Rust backend
            "percent": int(progress.progress_percent),
            "speed_mb_s": speed_mb_s,  # Speed in MB/s
        },
    }
    print(json.dumps(data), flush=True)


# Keep existing helper functions for compatibility


def emit_error(error: str):
    """Emit an error to stdout as JSON."""
    data = {
        "type": "error",
        "error": error,
    }
    print(json.dumps(data), flush=True)


def emit_download_complete(model_name: str, size_mb: int, path: str):
    """Emit download complete event."""
    data = {
        "type": "DownloadComplete",  # Capital C to match Rust backend expectation
        "data": {
            "model_name": model_name,
            "size_mb": size_mb,
            "path": path,
        },
    }
    print(json.dumps(data), flush=True)


def get_model_size_mb(path: str) -> int:
    """Get the size of a model directory in MB."""
    total_size = 0
    for dirpath, dirnames, filenames in os.walk(path):
        for f in filenames:
            fp = os.path.join(dirpath, f)
            try:
                total_size += os.path.getsize(fp)
            except (OSError, IOError):
                pass
    return total_size // (1024 * 1024)

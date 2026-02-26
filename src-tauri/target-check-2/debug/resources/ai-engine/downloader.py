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

import hashlib
import json
import logging
import os
import shutil
import tarfile
import time
import fnmatch
from dataclasses import dataclass, asdict
from enum import Enum
from pathlib import Path
from typing import Callable, List, Optional
from threading import Event, Thread

import requests  # type: ignore[reportMissingModuleSource]
from tenacity import (  # type: ignore[reportMissingImports]
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    before_sleep_log,
)

try:
    from huggingface_hub import snapshot_download, HfApi  # type: ignore[reportMissingImports]
except ImportError:
    snapshot_download = None
    HfApi = None

from ipc_events import emit_download_complete, emit_error

# Configure logging
logger = logging.getLogger(__name__)


# Fallback size estimates (in bytes) used when upstream does not provide Content-Length.
# Values are intentionally approximate and are used only for progress estimation.
MODEL_SIZE_ESTIMATES_MB = {
    "whisper-tiny": 74,
    "whisper-base": 139,
    "whisper-small": 466,
    "whisper-medium": 1505,
    "whisper-large-v3": 2960,
    "distil-small": 378,
    "distil-medium": 756,
    "distil-large-v2": 1400,
    "distil-large-v3": 1480,
    "parakeet-tdt-0.6b-v3": 640,
    "parakeet-tdt-1.1b": 2490,
    "sherpa-onnx-diarization": 45,
}

ASSET_SIZE_ESTIMATES_MB = {
    "sherpa-onnx-segmentation.tar.bz2": 7,
    "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx": 38,
}


def estimate_model_size_bytes(model_name: str) -> int:
    """Return best-effort total size estimate for a model in bytes."""
    exact = MODEL_SIZE_ESTIMATES_MB.get(model_name)
    if exact is not None:
        return int(exact * 1024 * 1024)

    # Fallback: support namespaced/internal folder names like
    # "nemo/nvidia_parakeet-tdt-0.6b-v3" by matching known model IDs.
    normalized = model_name.lower().replace("_", "-")
    for known_model, size_mb in MODEL_SIZE_ESTIMATES_MB.items():
        if known_model in normalized:
            return int(size_mb * 1024 * 1024)

    return 0


def estimate_asset_size_bytes(asset_name: str) -> int:
    """Return best-effort size estimate for a downloadable asset in bytes."""
    return int(ASSET_SIZE_ESTIMATES_MB.get(asset_name, 0) * 1024 * 1024)


def calculate_directory_stats(path: Path) -> tuple[int, int]:
    """Return total size and file count for a directory."""
    total_bytes = 0
    total_files = 0
    if not path.exists():
        return 0, 0

    for root, _, files in os.walk(path):
        for file in files:
            file_path = os.path.join(root, file)
            try:
                total_bytes += os.path.getsize(file_path)
            except (OSError, IOError):
                continue
            total_files += 1

    return total_bytes, total_files


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
    total_is_estimate: bool = False

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
                ConnectionResetError,
                ConnectionAbortedError,
            )
        ),
        before_sleep=before_sleep_log(logger, logging.WARNING),
    )
    def download_url_with_retry(
        self, url: str, output_path: Path, headers: dict[str, str] | None = None
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
        local_dir_name: Optional[str] = None,
        allow_patterns: Optional[List[str]] = None,
        ignore_patterns: Optional[List[str]] = None,
    ) -> Path:
        """
        Download model from HuggingFace Hub with accurate progress tracking.

        Args:
            repo_id: HuggingFace repository ID
            model_name: Canonical model name for logs/progress/size estimation
            local_dir_name: Optional directory name under cache for local files
            allow_patterns: Optional list of glob patterns to include
            ignore_patterns: Optional list of glob patterns to exclude

        Returns:
            Path to downloaded model
        """
        if snapshot_download is None or HfApi is None:
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
            try:
                model_info = api.model_info(repo_id, files_metadata=True)
            except TypeError:
                # Backward compatibility with older huggingface_hub versions.
                model_info = api.model_info(repo_id)

            # Estimate total size from siblings, respecting allow/ignore patterns.
            siblings = model_info.siblings or []

            def _sibling_name(sibling: object) -> str:
                return (
                    str(getattr(sibling, "rfilename", "") or "")
                    or str(getattr(sibling, "path", "") or "")
                    or str(getattr(sibling, "filename", "") or "")
                )

            def _matches_any(name: str, patterns: Optional[List[str]]) -> bool:
                if not patterns:
                    return True
                return any(fnmatch.fnmatch(name, pattern) for pattern in patterns)

            def _is_ignored(name: str, patterns: Optional[List[str]]) -> bool:
                if not patterns:
                    return False
                return any(fnmatch.fnmatch(name, pattern) for pattern in patterns)

            filtered_siblings = [
                s
                for s in siblings
                if _matches_any(_sibling_name(s), allow_patterns)
                and not _is_ignored(_sibling_name(s), ignore_patterns)
            ]
            if filtered_siblings:
                siblings = filtered_siblings

            total_bytes = sum(getattr(s, "size", 0) or 0 for s in siblings)
            total_is_estimate = False
            if total_bytes <= 0:
                estimated = estimate_model_size_bytes(model_name)
                if estimated > 0:
                    logger.info(
                        "Using fallback size estimate for %s: %.1f MB",
                        model_name,
                        estimated / (1024 * 1024),
                    )
                    total_bytes = estimated
                    total_is_estimate = True
            total_files = len(siblings)

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
                    total_is_estimate=total_is_estimate,
                )
            )

            # Check disk space
            self.check_disk_space(total_bytes)

            # Create target directory
            target_dir = self.cache_dir / (local_dir_name or model_name)
            target_dir.mkdir(parents=True, exist_ok=True)
            baseline_bytes, baseline_files = calculate_directory_stats(target_dir)

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
                        current_file_count = 0

                        if target_dir.exists():
                            for root, dirs, files in os.walk(target_dir):
                                for file in files:
                                    filepath = os.path.join(root, file)
                                    try:
                                        current_size += os.path.getsize(filepath)
                                        current_file_count += 1
                                    except (OSError, IOError):
                                        pass

                        downloaded_bytes = max(current_size - baseline_bytes, 0)
                        downloaded_files = max(current_file_count - baseline_files, 0)
                        progress_data["downloaded_bytes"] = downloaded_bytes

                        # Calculate speed and ETA
                        elapsed = current_time - start_time
                        if elapsed > 0 and downloaded_bytes > 0:
                            speed = downloaded_bytes / elapsed
                            if speed > 0:
                                remaining_bytes = max(total_bytes - downloaded_bytes, 0)
                                eta = remaining_bytes / speed if total_bytes > 0 else 0
                            else:
                                eta = 0
                        else:
                            speed = 0
                            eta = 0

                        # Calculate progress
                        if total_bytes > 0:
                            progress_percent = min(
                                100, (downloaded_bytes / total_bytes) * 100
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
                                downloaded_bytes=downloaded_bytes,
                                total_bytes=total_bytes,
                                speed_bytes_per_sec=speed,
                                eta_seconds=eta,
                                message=f"Downloading {model_name}: {progress_percent:.1f}%",
                                total_is_estimate=total_is_estimate,
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
                        total_is_estimate=total_is_estimate,
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
            final_bytes, _ = calculate_directory_stats(target_dir)
            final_size = final_bytes // (1024 * 1024)
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
                    total_is_estimate=total_is_estimate,
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

            # HEAD request to get file size (with retry)
            headers = {}
            max_retries = 5
            last_error = None
            response = None
            for attempt in range(max_retries):
                try:
                    # allow_redirects=True is critical for GitHub releases:
                    # without it the HEAD response is the 302 redirect itself
                    # whose Content-Length is the tiny HTML body, not the file.
                    response = requests.head(url, headers=headers, timeout=30, allow_redirects=True)
                    response.raise_for_status()
                    break
                except (
                    requests.ConnectionError,
                    requests.Timeout,
                    ConnectionResetError,
                    ConnectionAbortedError,
                ) as e:
                    last_error = e
                    if attempt < max_retries - 1:
                        wait_time = min(2**attempt, 60)
                        logger.warning(
                            f"HEAD request attempt {attempt + 1} failed: {e}. Retrying in {wait_time}s..."
                        )
                        time.sleep(wait_time)
                    else:
                        raise DownloadError(
                            f"Failed to get file info after {max_retries} attempts: {last_error}"
                        )

            if response is None:
                raise DownloadError("Failed to get file info: no response")

            total_size = int(response.headers.get("content-length", 0))
            total_is_estimate = False

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
                    total_is_estimate=total_is_estimate,
                )
            )

            self.check_disk_space(total_size)

            # Create target directory
            # For GGML Whisper models, save directly to cache_dir root as .bin file
            # For other models, save to subdirectory
            if asset_name.startswith("ggml-") and asset_name.endswith(".bin"):
                # GGML Whisper model - save directly to cache_dir root
                # Note: model_name may be "small", "base", etc. (without "whisper-" prefix)
                output_path = self.cache_dir / asset_name
                output_path.parent.mkdir(parents=True, exist_ok=True)
                target_dir = output_path.parent
            else:
                # Other models - save to subdirectory
                target_dir = self.cache_dir / model_name
                target_dir.mkdir(parents=True, exist_ok=True)
                output_path = target_dir / asset_name
            temp_path = output_path.with_suffix(output_path.suffix + ".tmp")

            # Download with progress and retry
            start_time = time.time()

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
                    total_is_estimate=total_is_estimate,
                )
            )

            # Download with retry logic
            max_retries = 5
            last_error = None
            response = None
            for attempt in range(max_retries):
                try:
                    response = requests.get(
                        url, stream=True, headers=headers, timeout=60
                    )
                    response.raise_for_status()
                    break
                except (
                    requests.ConnectionError,
                    requests.Timeout,
                    ConnectionResetError,
                    ConnectionAbortedError,
                ) as e:
                    last_error = e
                    if attempt < max_retries - 1:
                        wait_time = min(2**attempt, 60)
                        logger.warning(
                            f"Download attempt {attempt + 1} failed: {e}. Retrying in {wait_time}s..."
                        )
                        time.sleep(wait_time)
                    else:
                        raise DownloadError(
                            f"Failed to download after {max_retries} attempts: {last_error}"
                        )

            if response is None:
                raise DownloadError("Failed to download: no response")

            # Some sources don't provide Content-Length on HEAD,
            # but do provide it on the actual GET response.
            # Also: if the HEAD was a redirect and returned a small body size,
            # the actual GET response will have the correct file size — always prefer it.
            actual_size = int(response.headers.get("content-length", 0) or 0)
            if actual_size > total_size:
                total_size = actual_size

            # Final fallback for progress tracking when server omits Content-Length.
            if total_size <= 0:
                estimated = estimate_asset_size_bytes(asset_name)
                if estimated > 0:
                    logger.info(
                        "Using fallback asset size estimate for %s: %.1f MB",
                        asset_name,
                        estimated / (1024 * 1024),
                    )
                    total_size = estimated
                    total_is_estimate = True

            downloaded = 0
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
                                    total_is_estimate=total_is_estimate,
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
                        total_is_estimate=total_is_estimate,
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
                        total_is_estimate=total_is_estimate,
                    )
                )

                # Remove the archive after extraction if it exists
                if output_path.exists():
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
                        total_is_estimate=total_is_estimate,
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
    # IMPORTANT: Use GGML models for Rust whisper.cpp engine
    MODEL_REPOSITORIES = {
        "whisper-tiny": "ggerganov/whisper.cpp",
        "whisper-base": "ggerganov/whisper.cpp",
        "whisper-small": "ggerganov/whisper.cpp",
        "whisper-medium": "ggerganov/whisper.cpp",
        "whisper-large-v3": "ggerganov/whisper.cpp",
        "distil-small": "Systran/faster-distil-whisper-small.en",
        "distil-medium": "distil-whisper/distil-medium.en",
        "distil-large-v2": "distil-whisper/distil-large-v2",
        "distil-large-v3": "distil-whisper/distil-large-v3",
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
            # Use direct download from GitHub for GGML models
            # Map model names to GGML filenames
            model_filename = {
                "tiny": "ggml-tiny.bin",
                "base": "ggml-base.bin",
                "small": "ggml-small.bin",
                "medium": "ggml-medium.bin",
                "large": "ggml-large-v1.bin",
                "large-v1": "ggml-large-v1.bin",
                "large-v2": "ggml-large-v2.bin",
                "large-v3": "ggml-large-v3.bin",
            }.get(model_name)

            if not model_filename:
                emit_error(f"Unknown Whisper model: {model_name}")
                return

            # Construct URL for GGML model
            url = f"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{model_filename}"

            result_path = downloader.download_from_github(
                url=url,
                asset_name=model_filename,
                model_name=model_name
            )

            # Emit completion event
            size_mb = get_model_size_mb(str(result_path))
            emit_download_complete(model_name, size_mb, str(result_path))

        elif model_type == "parakeet":
            # Handle Parakeet models (NeMo .nemo files)
            # Extract size from model name (e.g., "parakeet-tdt-0.6b-v3" -> "0.6b", "parakeet-tdt-1.1b" -> "1.1b")
            import re
            match = re.search(r'parakeet-tdt-([\d.]+)[bB]', model_name)
            if not match:
                emit_error(f"Invalid Parakeet model name: {model_name}")
                return
            repo_id = MODEL_REPOSITORIES.get(model_name)
            if not repo_id:
                emit_error(f"Unknown Parakeet model: {model_name}")
                return

            # Download .nemo file to nemo cache directory.
            # Keep structure compatible with ModelRegistry.get_parakeet_path():
            #   {cache_dir}/nemo/{repo_id with slash replaced}/<repo_last_part>.nemo
            if snapshot_download is None:
                emit_error("huggingface_hub is not installed")
                return

            safe_repo_name = repo_id.replace("/", "_")
            repo_basename = repo_id.split("/")[-1]
            nemo_dir = downloader.cache_dir / "nemo" / safe_repo_name
            nemo_dir.mkdir(parents=True, exist_ok=True)

            logger.info(f"Downloading Parakeet model from {repo_id} to {nemo_dir}")

            # Download only .nemo artifacts into deterministic local directory
            # using shared HF download logic (with live progress reporting).
            downloader.download_from_huggingface(
                repo_id=repo_id,
                model_name=model_name,
                local_dir_name=f"nemo/{safe_repo_name}",
                allow_patterns=["*.nemo"],
            )

            # Prefer canonical filename expected by registry, fallback to any .nemo in folder.
            preferred_nemo_path = nemo_dir / f"{repo_basename}.nemo"
            if preferred_nemo_path.exists():
                nemo_path = preferred_nemo_path
            else:
                nemo_files = list(nemo_dir.rglob("*.nemo"))
                if not nemo_files:
                    emit_error(
                        f"Parakeet .nemo file not found after download in: {nemo_dir}"
                    )
                    return
                nemo_path = nemo_files[0]

            size_mb = max(1, int(nemo_path.stat().st_size / (1024 * 1024)))
            logger.info(f"Parakeet model ready: {nemo_path} ({size_mb} MB)")
            emit_download_complete(model_name, size_mb, str(nemo_path))

        elif model_type == "diarization":
            # Handle diarization models (only sherpa-onnx is supported)
            if model_name == "sherpa-onnx-diarization":
                # Download from GitHub to sherpa-onnx-diarization/ subdirectory
                # This matches the path expected by model_registry.py
                segmentation_url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"
                embedding_url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"

                # Download segmentation model to sherpa-onnx-diarization/sherpa-onnx-segmentation/
                downloader.download_from_github(
                    url=segmentation_url,
                    asset_name="sherpa-onnx-segmentation.tar.bz2",
                    model_name="sherpa-onnx-diarization/sherpa-onnx-segmentation",
                )

                # Download embedding model to sherpa-onnx-diarization/sherpa-onnx-embedding/
                downloader.download_from_github(
                    url=embedding_url,
                    asset_name="3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
                    model_name="sherpa-onnx-diarization/sherpa-onnx-embedding",
                )

                target_dir = downloader.cache_dir / "sherpa-onnx-diarization"
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
        "extract": "download",
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
            "eta_s": progress.eta_seconds,
            "total_estimated": progress.total_is_estimate,
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

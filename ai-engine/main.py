#!/usr/bin/env python3
"""
Transcribe Video - AI Engine
Main entry point for the transcription engine.

Usage:
    python main.py --file <path> --model <model_name> --device <cpu|cuda> --language <lang>
    python main.py --download-model <model_name> --cache-dir <path> --model-type <whisper|parakeet>
    python main.py --list-models --cache-dir <path>
    python main.py --validate-models [--cache-dir <path>] [model_name]
    python main.py --delete-model <model_name> --cache-dir <path>
"""

import argparse
import json
import os
import platform
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

# Suppress OneLogger warning from nemo_toolkit before any model imports
os.environ["NEMO_ONE_LOGGER_ERROR_HANDLING_STRATEGY"] = "DISABLE_QUIETLY"

# Suppress noisy NeMo/PyTorch warnings (training data, validation config, etc.)
# These are irrelevant for inference-only usage.
os.environ["NEMO_TESTING"] = "1"  # Suppresses model setup warnings
import warnings

warnings.filterwarnings("ignore", category=RuntimeWarning, module="pydub")
warnings.filterwarnings("ignore", message=".*If you intend to do training.*")
warnings.filterwarnings("ignore", message=".*If you intend to do validation.*")

# Redirect all Python logging to stderr so stdout stays clean for JSON IPC.
# NeMo, PyTorch, and other libraries log to the root logger which defaults to stdout.
import logging

logging.basicConfig(stream=sys.stderr, level=logging.WARNING, force=True)
# Ensure NeMo loggers go to stderr (NeMo creates its own handlers)
for _logger_name in ("nemo", "nemo_logger", "nemo.collections", "pytorch_lightning"):
    _lib_logger = logging.getLogger(_logger_name)
    _lib_logger.handlers.clear()
    _stderr_handler = logging.StreamHandler(sys.stderr)
    _lib_logger.addHandler(_stderr_handler)
    _lib_logger.propagate = False

# MEDIUM-5: Graceful shutdown flag
shutdown_requested = False


def signal_handler(signum, frame):
    """Handle SIGINT/SIGTERM for graceful shutdown."""
    global shutdown_requested
    shutdown_requested = True
    print(
        json.dumps({"type": "error", "message": "Operation interrupted by user"}),
        flush=True,
    )
    sys.exit(1)


# Register signal handlers
signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

# Security: Download limits
MAX_DOWNLOAD_SIZE = 2 * 1024 * 1024 * 1024  # 2GB max download size
DOWNLOAD_TIMEOUT = 300  # 5 minutes timeout

from factory import ModelFactory
from logger import logger, transcription_logger, upload_logger, model_logger
from model_pool import model_pool
from model_registry import ModelRegistry, ModelInfo

# Import tenacity for retry logic
try:
    from tenacity import (
        retry,
        stop_after_attempt,
        wait_exponential,
        retry_if_exception_type,
        before_sleep_log,
    )

    TENACITY_AVAILABLE = True
except ImportError:
    TENACITY_AVAILABLE = False

# Disable HuggingFace progress bars to avoid interfering with JSON output
os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"

# Disable symlink warning on Windows (symlinks require Developer Mode or admin)
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

# Security constants for JSON deserialization
MAX_JSON_SIZE = 10 * 1024 * 1024  # 10MB max payload size
MAX_JSON_DEPTH = 100  # Maximum nesting depth
ALLOWED_COMMAND_TYPES = {
    "transcribe",
    "ping",
    "shutdown",
    "get_devices",
    "check_python",
    "check_ffmpeg",
    "check_models",
    "check_environment",
}

# HIGH-4: JSON Schema definitions for command validation
COMMAND_SCHEMAS = {
    "transcribe": {
        "required": ["type", "file"],
        "optional": [
            "model",
            "device",
            "language",
            "diarization",
            "taskId",
            "huggingfaceToken",
            "diarization_provider",
            "num_speakers",
        ],
        "types": {
            "type": str,
            "file": str,
            "model": str,
            "device": str,
            "language": str,
            "diarization": bool,
            "taskId": str,
            "huggingfaceToken": str,
            "diarization_provider": str,
            "num_speakers": int,
        },
    },
    "ping": {
        "required": ["type"],
        "optional": [],
        "types": {"type": str},
    },
    "shutdown": {
        "required": ["type"],
        "optional": [],
        "types": {"type": str},
    },
    "get_devices": {
        "required": ["type"],
        "optional": [],
        "types": {"type": str},
    },
    "check_python": {
        "required": ["type"],
        "optional": [],
        "types": {"type": str},
    },
    "check_ffmpeg": {
        "required": ["type"],
        "optional": [],
        "types": {"type": str},
    },
    "check_models": {
        "required": ["type"],
        "optional": ["cache_dir"],
        "types": {"type": str, "cache_dir": str},
    },
    "check_environment": {
        "required": ["type"],
        "optional": ["cache_dir"],
        "types": {"type": str, "cache_dir": str},
    },
}

# Security: URL whitelist for model downloads to prevent SSRF attacks
ALLOWED_HOSTS = {
    "github.com",
    "huggingface.co",
    "cdn-lfs.huggingface.co",
}


def validate_model_name(model_name: str) -> str:
    """
    Validate model name to prevent path traversal attacks.

    Args:
        model_name: The model name to validate

    Returns:
        The validated model name

    Raises:
        ValueError: If model name contains invalid characters
    """
    if not VALID_MODEL_NAME.match(model_name):
        raise ValueError(
            f"Invalid model name: {model_name}\n"
            "Model names must contain only letters, numbers, underscores, and hyphens"
        )
    return model_name


def safe_join(base: Path, *paths: str) -> Path:
    """
    Safely join paths and prevent traversal attacks.

    This function ensures that the resulting path is within the base directory
    to prevent path traversal attacks.

    Args:
        base: The base directory path
        *paths: Path components to join

    Returns:
        The joined and resolved Path object

    Raises:
        ValueError: If path traversal is detected
    """
    try:
        result = base.absolute().resolve()
        for path in paths:
            # Convert to Path and resolve to eliminate any '..' or symlinks
            p = Path(path).absolute().resolve()

            # Check if the resolved path is within the base directory
            # or if it's a direct subdirectory we're creating
            try:
                if not p.is_relative_to(result):
                    raise ValueError(
                        f"Path traversal detected: {path}\n"
                        f"Attempted to access path outside base directory"
                    )
            except ValueError:
                # Python < 3.9 doesn't have is_relative_to, use manual check
                try:
                    p.relative_to(result)
                except ValueError:
                    raise ValueError(
                        f"Path traversal detected: {path}\n"
                        f"Attempted to access path outside base directory"
                    )

        # Join all paths and resolve the final result
        final_path = result.joinpath(*paths).absolute().resolve()

        # Final safety check: ensure result is still within base
        try:
            if not final_path.is_relative_to(result):
                raise ValueError(
                    f"Path traversal detected in final path\n"
                    f"Attempted to access path outside base directory"
                )
        except ValueError:
            # Python < 3.9 fallback
            try:
                final_path.relative_to(result)
            except ValueError:
                raise ValueError(
                    f"Path traversal detected in final path\n"
                    f"Attempted to access path outside base directory"
                )

        return final_path
    except Exception as e:
        if "traversal" in str(e).lower():
            raise
        raise ValueError(f"Invalid path: {str(e)}") from e


# Security constants for model name validation
VALID_MODEL_NAME = re.compile(r"^[a-zA-Z0-9_.-]+$")

# Supported language codes for Whisper
SUPPORTED_LANGUAGES = [
    "auto",  # Auto-detection
    "en",
    "es",
    "fr",
    "de",
    "it",
    "pt",  # European
    "ru",
    "pl",
    "nl",
    "cs",
    "ar",
    "tr",  # More European/Middle East
    "zh",
    "ja",
    "ko",
    "th",
    "vi",
    "id",  # Asian
    "hi",
    "bn",
    "ta",
    "te",
    "mr",  # Indian
    "sw",
    "af",
    "sq",
    "hy",
    "az",
    "be",  # Others
    # Add more as needed - Whisper supports 99 languages
]


def validate_language(language: str) -> str:
    """Validate language code is supported."""
    if language == "auto":
        return language

    # Also accept numeric language IDs (Whisper internal)
    if language.isdigit():
        return language

    if language not in SUPPORTED_LANGUAGES:
        raise ValueError(
            f"Unsupported language: {language}\n"
            f"Supported languages: {', '.join(SUPPORTED_LANGUAGES[:10])}...\n"
            f"See https://github.com/openai/whisper/blob/main/whisper/tokenizer.py"
        )
    return language


def check_json_depth(obj, current_depth=0):
    """
    Recursively check JSON nesting depth to prevent DoS attacks.

    Args:
        obj: Parsed JSON object to check
        current_depth: Current depth level (used internally for recursion)

    Returns:
        bool: True if depth is within limits, False otherwise

    Raises:
        ValueError: If nesting depth exceeds MAX_JSON_DEPTH
    """
    if current_depth > MAX_JSON_DEPTH:
        raise ValueError(
            f"JSON nesting depth exceeds maximum allowed depth of {MAX_JSON_DEPTH}"
        )

    if isinstance(obj, dict):
        for value in obj.values():
            check_json_depth(value, current_depth + 1)
    elif isinstance(obj, list):
        for item in obj:
            check_json_depth(item, current_depth + 1)

    return True


def safe_json_loads(data: str) -> dict:
    """
    Safely parse JSON with validation for size, depth, and structure.

    This function implements multiple security checks to prevent DoS attacks:
    1. Size validation - rejects payloads > 10MB
    2. JSON parsing with error handling
    3. Depth validation - rejects nesting > 100 levels
    4. Type validation - ensures dict object
    5. Command type validation - only allows whitelisted commands

    Args:
        data: JSON string to parse

    Returns:
        dict: Parsed and validated JSON object

    Raises:
        ValueError: If any validation fails with descriptive error message
        json.JSONDecodeError: If JSON parsing fails
    """
    # Check 1: Size validation
    data_size = len(data.encode("utf-8"))
    if data_size > MAX_JSON_SIZE:
        raise ValueError(
            f"JSON payload size ({data_size} bytes) exceeds maximum allowed size of {MAX_JSON_SIZE} bytes"
        )

    # Check 2: Parse JSON with error handling
    try:
        parsed = json.loads(data)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON format: {e.msg}") from e

    # Check 3: Depth validation
    try:
        check_json_depth(parsed)
    except ValueError as e:
        raise ValueError(f"JSON depth validation failed: {str(e)}") from e

    # Check 4: Type validation - must be a dict
    if not isinstance(parsed, dict):
        raise ValueError(
            f"JSON payload must be an object/dict, got {type(parsed).__name__}"
        )

    # Check 5: Command type validation
    cmd_type = parsed.get("type")
    if not cmd_type:
        raise ValueError("JSON payload missing required 'type' field")

    if cmd_type not in ALLOWED_COMMAND_TYPES:
        raise ValueError(
            f"Unknown command type: '{cmd_type}'. "
            f"Allowed commands: {', '.join(sorted(ALLOWED_COMMAND_TYPES))}"
        )

    # HIGH-4: Validate command schema
    schema = COMMAND_SCHEMAS.get(cmd_type)
    if schema:
        # Check required fields
        for field in schema["required"]:
            if field not in parsed:
                raise ValueError(
                    f"Command '{cmd_type}' missing required field: '{field}'"
                )

        # Check field types
        for field, value in parsed.items():
            if field in schema["types"]:
                expected_type = schema["types"][field]
                if not isinstance(value, expected_type):
                    raise ValueError(
                        f"Field '{field}' must be of type {expected_type.__name__}, "
                        f"got {type(value).__name__}"
                    )

    return parsed


MODEL_REPOSITORIES = {
    "whisper-tiny": "Systran/faster-whisper-tiny",
    "whisper-base": "Systran/faster-whisper-base",
    "whisper-small": "Systran/faster-whisper-small",
    "whisper-medium": "Systran/faster-whisper-medium",
    "whisper-large-v3": "Systran/faster-whisper-large-v3",
    "distil-small": "distil-whisper/distil-small.en",
    "distil-medium": "distil-whisper/distil-medium.en",
    "distil-large": "distil-whisper/distil-large-v3",
    "distil-large-v3": "distil-whisper/distil-large-v3",
    "parakeet-tdt-0.6b-v3": "nvidia/parakeet-tdt-0.6b-v3",
    "parakeet-tdt-1.1b": "nvidia/parakeet-tdt-1.1b",
    "pyannote-diarization": "pyannote-combined",  # Special marker for combined download
    "pyannote-segmentation-3.0": "pyannote/segmentation-3.0",
    "pyannote-embedding-3.0": "pyannote/embedding",
    "sherpa-onnx-diarization": "sherpa-combined",  # Special marker for combined download
    "sherpa-onnx-segmentation": "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2",
    "sherpa-onnx-embedding": "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
}


def parse_args():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Transcribe Video AI Engine",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--file",
        type=str,
        default=None,
        help="Path to the media file to transcribe",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="whisper-base",
        choices=[
            "whisper-tiny",
            "whisper-base",
            "whisper-small",
            "whisper-medium",
            "whisper-large",
            "distil-small",
            "distil-medium",
            "distil-large",
            "distil-large-v3",
            "parakeet",
            "parakeet-tdt-0.6b-v3",
            "parakeet-tdt-1.1b",
            "parakeet-tdt-1.1b-ls",
        ],
        help="Model to use for transcription",
    )
    parser.add_argument(
        "--device",
        type=str,
        default="cpu",
        choices=["cpu", "cuda"],
        help="Device to run inference on",
    )
    parser.add_argument(
        "--language",
        type=str,
        default="auto",
        help="Language code (e.g., 'en', 'ru', 'auto' for auto-detection)",
    )
    parser.add_argument(
        "--diarization",
        action="store_true",
        default=False,
        help="Enable speaker diarization",
    )
    parser.add_argument(
        "--diarization-provider",
        type=str,
        default="none",
        choices=["none", "pyannote", "sherpa-onnx"],
        help="Diarization provider to use (only applies when --diarization is set)",
    )
    parser.add_argument(
        "--num-speakers",
        type=int,
        default=-1,
        help="Number of speakers for sherpa-onnx (-1 for auto-detection)",
    )
    parser.add_argument(
        "--test",
        action="store_true",
        help="Run in test mode (prints hello message and exits)",
    )
    parser.add_argument(
        "--server",
        action="store_true",
        help="Run in server mode (reads JSON commands from stdin)",
    )
    parser.add_argument(
        "--download-model",
        type=str,
        default=None,
        help="Download a model to the specified cache directory",
    )
    parser.add_argument(
        "--cache-dir",
        type=str,
        default=None,
        help="Cache directory for model storage",
    )
    parser.add_argument(
        "--model-type",
        type=str,
        default="whisper",
        choices=["whisper", "parakeet", "diarization"],
        help="Type of model to download",
    )
    parser.add_argument(
        "--list-models",
        action="store_true",
        help="List all installed models in the cache directory",
    )
    parser.add_argument(
        "--delete-model",
        type=str,
        default=None,
        help="Delete a specific model from the cache directory",
    )
    parser.add_argument(
        "--cancel-download",
        type=str,
        default=None,
        help="Cancel an ongoing model download",
    )
    # HIGH-7: Use token file instead of env var for security
    parser.add_argument(
        "--token-file",
        type=str,
        default=None,
        help="Path to file containing HuggingFace token (more secure than env var)",
    )
    parser.add_argument(
        "--command",
        type=str,
        default=None,
        choices=["check_python", "check_ffmpeg", "check_models", "check_environment"],
        help="Execute a setup wizard command and output JSON result",
    )
    parser.add_argument(
        "--validate-models",
        type=str,
        default=None,
        nargs="?",
        const="",
        metavar="MODEL_NAME",
        help="Validate model availability (optionally specify a specific model name)",
    )
    return parser.parse_args()


def emit_progress(
    stage: str, progress: int, message: str, metrics: Optional[dict] = None
):
    """Emit a progress update to stdout as JSON."""
    data = {
        "type": "progress",
        "stage": stage,
        "progress": progress,
        "message": message,
    }
    if metrics:
        data["metrics"] = metrics
    print(json.dumps(data), flush=True)


try:
    import psutil
except ImportError:
    psutil = None

try:
    import pynvml  # type: ignore

    pynvml.nvmlInit()
    _NVML_HANDLE = pynvml.nvmlDeviceGetHandleByIndex(0)
except Exception:
    pynvml = None
    _NVML_HANDLE = None


def get_system_metrics() -> dict:
    metrics = {}
    if psutil:
        try:
            metrics["cpuUsage"] = round(psutil.cpu_percent(interval=None), 1)
            metrics["memoryUsage"] = round(
                psutil.virtual_memory().used / (1024 * 1024), 1
            )
        except Exception:
            pass
    if _NVML_HANDLE and pynvml:
        try:
            util = pynvml.nvmlDeviceGetUtilizationRates(_NVML_HANDLE)
            metrics["gpuUsage"] = float(util.gpu)
        except Exception:
            pass
    return metrics


def build_progress_metrics(
    processed_duration: Optional[float],
    total_duration: Optional[float],
    start_time: Optional[float],
) -> Optional[dict]:
    metrics = get_system_metrics()

    if processed_duration is not None:
        metrics["processedDuration"] = round(processed_duration, 2)
    if total_duration is not None:
        metrics["totalDuration"] = round(total_duration, 2)

    if start_time is not None and processed_duration is not None:
        elapsed = time.time() - start_time
        if elapsed > 0:
            realtime_factor = processed_duration / elapsed
            metrics["realtimeFactor"] = round(realtime_factor, 2)
            if total_duration is not None and realtime_factor > 0:
                remaining = max(total_duration - processed_duration, 0)
                metrics["estimatedTimeRemaining"] = round(
                    remaining / realtime_factor, 2
                )

    return metrics or None


def emit_download_progress(current: float, total: float, speed_mb_s: float):
    """Emit download progress update in UI-compatible format."""
    percent = int((current / total * 100) if total > 0 else 0)
    current_mb = current / (1024 * 1024)
    total_mb = total / (1024 * 1024)

    # UI expects: {"type": "progress", "stage": "download", "progress": int, "message": "..."}
    # Rust backend also expects "data" field with all progress info
    data = {
        "type": "progress",
        "stage": "download",
        "progress": percent,
        "message": f"Downloading... {current_mb:.0f}MB / {total_mb:.0f}MB ({percent}%)",
        "data": {
            "current": current_mb,  # MB value for Rust backend
            "total": total_mb,  # MB value for Rust backend
            "percent": percent,  # Progress percent
            "speed_mb_s": speed_mb_s,  # Speed in MB/s
        },
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


def emit_download_stage(
    model_name: str,
    stage: str,
    submodel_name: str,
    current: float,
    total: float,
    percent: int,
    speed_mb_s: float = 0,
):
    """Emit multi-stage download progress for diarization models.

    Args:
        model_name: Main model name (e.g., "pyannote-diarization")
        stage: Stage name ("segmentation" or "embedding")
        submodel_name: Actual model being downloaded (e.g., "pyannote-segmentation-3.0")
        current: Current bytes downloaded
        total: Total bytes for this submodel
        percent: Progress percentage (0-100)
        speed_mb_s: Download speed in MB/s
    """
    data = {
        "type": "download_stage",
        "data": {
            "model_name": model_name,
            "stage": stage,
            "submodel_name": submodel_name,
            "current": current / (1024 * 1024),
            "total": total / (1024 * 1024),
            "percent": percent,
            "speed_mb_s": speed_mb_s,
        },
    }
    print(json.dumps(data), flush=True)


def emit_models_list(models: list):
    """Emit list of installed models."""
    data = {
        "type": "models_list",
        "data": models,
    }
    print(json.dumps(data), flush=True)


def emit_validation_results(results: list, cache_dir: str):
    """Emit model validation results."""
    data = {
        "type": "validation_results",
        "cache_dir": cache_dir,
        "data": results,
    }
    print(json.dumps(data, indent=2), flush=True)


def emit_delete_complete(model_name: str):
    """Emit delete complete event."""
    data = {
        "type": "delete_complete",
        "data": {
            "model_name": model_name,
        },
    }
    print(json.dumps(data), flush=True)


def validate_url(url: str) -> None:
    """
    Validate URL to prevent SSRF attacks.

    Performs comprehensive security checks on URLs before allowing downloads:
    - Ensures HTTPS scheme only (no HTTP, file://, etc.)
    - Checks hostname against whitelist of trusted domains
    - Detects path traversal attempts in URL path
    - Detects null byte injection attempts

    Args:
        url: The URL to validate

    Raises:
        ValueError: If URL fails any security check with specific error message

    Examples:
        >>> validate_url("https://github.com/k2-fsa/sherpa-onnx/...")  # OK
        >>> validate_url("http://malicious.com/file.bin")  # Raises: HTTP not allowed
        >>> validate_url("https://github.com/../../../etc/passwd")  # Raises: Path traversal
    """
    try:
        parsed = urlparse(url)
    except Exception as e:
        raise ValueError(f"Invalid URL format: {e}")

    # Check scheme - HTTPS only for security
    if parsed.scheme != "https":
        raise ValueError(
            f"URL scheme must be HTTPS, got: {parsed.scheme}. "
            f"HTTP is not allowed for security reasons."
        )

    # Check hostname against whitelist
    if not parsed.hostname:
        raise ValueError("URL must contain a valid hostname")

    if parsed.hostname not in ALLOWED_HOSTS:
        raise ValueError(
            f"URL hostname '{parsed.hostname}' is not in the allowed list. "
            f"Allowed hosts: {', '.join(sorted(ALLOWED_HOSTS))}"
        )

    # Check for path traversal attempts
    if (
        ".." in parsed.path
        or "%2e%2e" in parsed.path.lower()
        or "%2E%2E" in parsed.path
    ):
        raise ValueError(
            f"Path traversal detected in URL path. "
            f"The URL path contains '..' or encoded sequences that attempt directory traversal."
        )

    # Check for null byte injection
    if "\0" in url or "%00" in url.lower():
        raise ValueError(
            f"Null byte detected in URL. "
            f"This is a potential injection attack and is not allowed."
        )


def safe_extract(tar: "tarfile.TarFile", target_dir: str) -> None:
    """
    Safely extract tar archive members, preventing path traversal and symlink attacks.

    Iterates through all members before extraction to validate each path:
    - Rejects paths with traversal sequences (..)
    - Rejects absolute paths (would overwrite system files)
    - Rejects symlinks entirely (could point outside target dir)
    - Only extracts if all members pass validation

    Args:
        tar: The TarFile object to extract from
        target_dir: The destination directory for extraction

    Raises:
        ValueError: If any member path is suspicious or potentially malicious

    Security:
        This is a critical security function. Archive extraction is a common
        attack vector. Never use tar.extractall() directly without these checks.
    """
    import tarfile

    # Validate all members before extraction
    for member in tar.getmembers():
        # Check for path traversal
        if ".." in member.name or member.name.startswith("/"):
            raise ValueError(
                f"Path traversal detected in archive: '{member.name}'. "
                f"Archive member contains '..' or absolute path."
            )

        # Reject symlinks entirely (could point outside target_dir)
        if member.issym() or member.islnk():
            raise ValueError(
                f"Symlinks are not allowed in archives for security reasons. "
                f"Found symlink: '{member.name}'"
            )

        # Resolve the final path and ensure it's within target_dir
        import os

        target_path = os.path.normpath(os.path.join(target_dir, member.name))
        if not target_path.startswith(os.path.normpath(target_dir)):
            raise ValueError(
                f"Archive member '{member.name}' would extract outside target directory. "
                f"This is a path traversal attack."
            )

    # All members validated - safe to extract
    tar.extractall(path=target_dir)


def _download_with_retry(url: str, timeout: int, max_retries: int = 5):
    """
    Download with retry logic for handling connection resets.
    Falls back to simple requests if tenacity is not available.
    """
    import requests
    import time

    if TENACITY_AVAILABLE:
        # Use tenacity for robust retry logic
        @retry(
            stop=stop_after_attempt(max_retries),
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
        def _do_request():
            return requests.get(url, stream=True, timeout=timeout)

        return _do_request()
    else:
        # Fallback: manual retry logic
        last_error = None
        for attempt in range(max_retries):
            try:
                return requests.get(url, stream=True, timeout=timeout)
            except (
                requests.ConnectionError,
                requests.Timeout,
                ConnectionResetError,
                ConnectionAbortedError,
            ) as e:
                last_error = e
                if attempt < max_retries - 1:
                    wait_time = min(2**attempt, 60)  # Exponential backoff, max 60s
                    logger.warning(
                        f"Download attempt {attempt + 1} failed: {e}. Retrying in {wait_time}s..."
                    )
                    time.sleep(wait_time)
                else:
                    raise last_error


def download_sherpa_onnx_model(model_name: str, url: str, target_dir: str):
    """Download Sherpa-ONNX model from GitHub releases."""
    import requests
    import io

    emit_progress("download", 0, f"Downloading {model_name} from GitHub...")

    # Security: Validate URL before making any request
    try:
        validate_url(url)
    except ValueError as e:
        emit_error(f"URL validation failed: {str(e)}")
        if os.path.exists(target_dir):
            shutil.rmtree(target_dir)
        return

    try:
        response = _download_with_retry(url, DOWNLOAD_TIMEOUT)
        response.raise_for_status()

        # Security: Check content length before downloading
        total_size = int(response.headers.get("content-length", 0))
        if total_size > MAX_DOWNLOAD_SIZE:
            raise ValueError(
                f"Download size {total_size} bytes exceeds maximum allowed {MAX_DOWNLOAD_SIZE} bytes"
            )

        downloaded = 0

        if model_name == "sherpa-onnx-segmentation":
            # Extract tar.bz2
            with io.BytesIO() as buffer:
                for chunk in response.iter_content(chunk_size=8192):
                    if _download_cancelled["cancelled"]:
                        raise KeyboardInterrupt("Download cancelled")
                    buffer.write(chunk)
                    downloaded += len(chunk)

                    if total_size > 0:
                        percent = int((downloaded / total_size) * 100)
                        emit_progress(
                            "download", percent, f"Downloading {model_name}: {percent}%"
                        )

                buffer.seek(0)
                with tarfile.open(fileobj=buffer, mode="r:bz2") as tar:
                    # Security: Use safe extraction instead of extractall
                    safe_extract(tar, target_dir)

        else:
            # Download .onnx file directly
            filename = os.path.basename(url)
            filepath = os.path.join(target_dir, filename)
            with open(filepath, "wb") as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if _download_cancelled["cancelled"]:
                        raise KeyboardInterrupt("Download cancelled")
                    f.write(chunk)
                    downloaded += len(chunk)

                    if total_size > 0:
                        percent = int((downloaded / total_size) * 100)
                        emit_progress(
                            "download", percent, f"Downloading {model_name}: {percent}%"
                        )

        emit_progress("extract", 100, f"Extracting {model_name}...")
        size_mb = get_model_size_mb(target_dir)
        emit_download_complete(model_name, size_mb, target_dir)

    except Exception as e:
        emit_error(f"Failed to download {model_name}: {str(e)}")
        if os.path.exists(target_dir):
            shutil.rmtree(target_dir)


def emit_result(
    segments,
    language: str = "auto",
    duration: float = 0.0,
    speaker_turns: Optional[list] = None,
    speaker_segments: Optional[list] = None,
):
    """Emit the final result to stdout as JSON.

    Args:
        segments: Original Whisper segments
        language: Detected or specified language
        duration: Audio duration in seconds
        speaker_turns: Raw diarization turns (optional)
        speaker_segments: Segments split by speaker (optional)
    """
    # Calculate duration from segments if not provided
    if duration == 0.0 and segments:
        duration = max(s.get("end", 0) for s in segments)

    data = {
        "type": "result",
        "segments": segments,
        "language": language,
        "duration": duration,
    }

    # Add diarization data if available
    if speaker_turns is not None:
        data["speakerTurns"] = speaker_turns
        print(
            json.dumps(
                {
                    "type": "debug",
                    "message": f"Emitting {len(speaker_turns)} speaker turns: {speaker_turns[:3]}..."
                    if len(speaker_turns) > 3
                    else f"Emitting {len(speaker_turns)} speaker turns: {speaker_turns}",
                }
            ),
            flush=True,
            file=sys.stderr,
        )
    if speaker_segments is not None:
        data["speakerSegments"] = speaker_segments
        print(
            json.dumps(
                {
                    "type": "debug",
                    "message": f"Emitting {len(speaker_segments)} speaker segments (original had {len(segments)} segments)",
                }
            ),
            flush=True,
            file=sys.stderr,
        )
    else:
        print(
            json.dumps(
                {
                    "type": "debug",
                    "message": "speaker_segments is None - not sending split data",
                }
            ),
            flush=True,
            file=sys.stderr,
        )

    print(json.dumps(data), flush=True)


def emit_error(error: str):
    """Emit an error to stdout as JSON."""
    data = {
        "type": "error",
        "error": error,
    }
    print(json.dumps(data), flush=True)


# ============================================================================
# Setup Wizard Environment Check Functions
# ============================================================================

# Supported Python versions (3.10, 3.11, 3.12 are supported; 3.13+ is NOT supported)
SUPPORTED_PYTHON_VERSIONS = [(3, 10), (3, 11), (3, 12)]


def check_python_environment() -> dict[str, Any]:
    """
    Check Python environment for Setup Wizard.

    Returns:
        PythonCheckResult dict with:
        - status: "ok" | "warning" | "error"
        - version: Python version string (e.g., "3.10.12")
        - executable: Path to Python executable
        - inVenv: True if running in virtual environment
        - pytorchInstalled: True if PyTorch is installed
        - pytorchVersion: PyTorch version or None
        - cudaAvailable: True if CUDA is available
        - mpsAvailable: True if MPS is available
        - message: Human-readable message
    """
    try:
        # Get Python version info
        version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        executable = sys.executable
        in_venv = hasattr(sys, "real_prefix") or (
            hasattr(sys, "base_prefix") and sys.base_prefix != sys.prefix
        )

        # Check if Python version is supported
        version_tuple = (sys.version_info.major, sys.version_info.minor)
        version_supported = version_tuple in SUPPORTED_PYTHON_VERSIONS

        # Check PyTorch installation
        pytorch_installed = False
        pytorch_version = None
        cuda_available = False
        mps_available = False

        try:
            import torch

            pytorch_installed = True
            pytorch_version = torch.__version__
            cuda_available = torch.cuda.is_available()

            # Check MPS availability (Apple Silicon)
            if hasattr(torch.backends, "mps"):
                mps_available = torch.backends.mps.is_available()
        except ImportError:
            pass

        # Determine status and message
        if not version_supported:
            if version_tuple >= (3, 13):
                status = "error"
                message = f"Python {version} НЕ поддерживается. Требуется Python 3.10, 3.11 или 3.12."
            else:
                status = "warning"
                message = f"Python {version} не тестировался. Рекомендуется 3.10, 3.11 или 3.12."
        elif not pytorch_installed:
            status = "error"
            message = f"Python {version} OK, но PyTorch не установлен. Выполните: pip install torch"
        else:
            # Determine acceleration status
            acceleration = []
            if cuda_available:
                acceleration.append("CUDA")
            if mps_available:
                acceleration.append("MPS")
            if not acceleration:
                acceleration.append("только CPU")

            status = "ok"
            message = f"Python {version}, PyTorch {pytorch_version} ({', '.join(acceleration)})"

        return {
            "status": status,
            "version": version,
            "executable": executable,
            "inVenv": in_venv,
            "pytorchInstalled": pytorch_installed,
            "pytorchVersion": pytorch_version,
            "cudaAvailable": cuda_available,
            "mpsAvailable": mps_available,
            "message": message,
        }

    except Exception as e:
        return {
            "status": "error",
            "version": None,
            "executable": None,
            "inVenv": False,
            "pytorchInstalled": False,
            "pytorchVersion": None,
            "cudaAvailable": False,
            "mpsAvailable": False,
            "message": f"Ошибка при проверке Python: {str(e)}",
        }


def check_ffmpeg() -> dict[str, Any]:
    """
    Check FFmpeg installation for Setup Wizard.

    Returns:
        FFmpegCheckResult dict with:
        - status: "ok" | "warning" | "error"
        - installed: True if FFmpeg is found
        - path: Path to FFmpeg executable or None
        - version: FFmpeg version string or None
        - message: Human-readable message
    """
    try:
        ffmpeg_path = shutil.which("ffmpeg")

        if not ffmpeg_path:
            return {
                "status": "error",
                "installed": False,
                "path": None,
                "version": None,
                "message": "FFmpeg не найден. Установите FFmpeg для работы с видео/аудио.",
            }

        # Get FFmpeg version
        try:
            # On Windows, shell=True may be needed for PATH lookup
            use_shell = platform.system() == "Windows"
            result = subprocess.run(
                [ffmpeg_path, "-version"],
                capture_output=True,
                text=True,
                timeout=10,
                shell=use_shell,
            )

            # Parse version from output like "ffmpeg version 5.1.2"
            version_line = result.stdout.split("\n")[0] if result.stdout else ""
            parts = version_line.split()
            version = None
            if len(parts) >= 3 and "ffmpeg" in parts[0].lower():
                version = parts[2]

            return {
                "status": "ok",
                "installed": True,
                "path": ffmpeg_path,
                "version": version,
                "message": f"FFmpeg {version or 'unknown'} найден: {ffmpeg_path}",
            }

        except subprocess.TimeoutExpired:
            return {
                "status": "warning",
                "installed": True,
                "path": ffmpeg_path,
                "version": None,
                "message": f"FFmpeg найден ({ffmpeg_path}), но не удалось получить версию.",
            }
        except Exception as e:
            return {
                "status": "warning",
                "installed": True,
                "path": ffmpeg_path,
                "version": None,
                "message": f"FFmpeg найден, но ошибка при проверке версии: {str(e)}",
            }

    except Exception as e:
        return {
            "status": "error",
            "installed": False,
            "path": None,
            "version": None,
            "message": f"Ошибка при проверке FFmpeg: {str(e)}",
        }


def check_models(cache_dir: Optional[str] = None) -> dict[str, Any]:
    """
    Check installed AI models for Setup Wizard.

    Args:
        cache_dir: Optional cache directory path. If not provided, uses default.

    Returns:
        ModelCheckResult dict with:
        - status: "ok" | "warning" | "error"
        - installedModels: List of installed model info
        - hasRequiredModel: True if at least one transcription model is installed
        - message: Human-readable message
    """
    try:
        # Determine cache directory
        if not cache_dir:
            # Use default cache directory
            cache_dir = os.path.join(
                os.path.expanduser("~"), ".cache", "transcribe-video"
            )

        installed_models = []

        if not os.path.exists(cache_dir):
            return {
                "status": "warning",
                "installedModels": [],
                "hasRequiredModel": False,
                "message": f"Директория моделей не существует: {cache_dir}",
            }

        # Individual diarization components to skip - they're handled separately
        SKIP_INDIVIDUAL = {
            "pyannote-segmentation-3.0",
            "pyannote-embedding-3.0",
            "sherpa-onnx-segmentation",
            "sherpa-onnx-embedding",
        }

        # Scan for installed models
        for model_name in os.listdir(cache_dir):
            model_path = os.path.join(cache_dir, model_name)
            if not os.path.isdir(model_path):
                continue

            # Skip individual diarization components - they're handled separately
            if model_name in SKIP_INDIVIDUAL:
                continue

            # Get model size
            size_mb = get_model_size_mb(model_path)

            # Infer model type from directory name
            if model_name.startswith("whisper-"):
                model_type = "whisper"
            elif model_name.startswith("parakeet-"):
                model_type = "parakeet"
            elif model_name.startswith("distil-"):
                model_type = "whisper"  # Distil-Whisper models
            else:
                continue

            installed_models.append(
                {
                    "name": model_name,
                    "size_mb": size_mb,
                    "model_type": model_type,
                    "installed": True,
                    "path": model_path,
                }
            )

        # Check for diarization models (flat structure: segmentation + embedding in cache root)
        # PyAnnote diarization
        seg_path = os.path.join(cache_dir, "pyannote-segmentation-3.0")
        emb_path = os.path.join(cache_dir, "pyannote-embedding-3.0")
        if os.path.exists(seg_path) and os.path.exists(emb_path):
            total_size = get_model_size_mb(seg_path) + get_model_size_mb(emb_path)
            installed_models.append(
                {
                    "name": "pyannote-diarization",
                    "size_mb": total_size,
                    "model_type": "diarization",
                    "installed": True,
                    "path": None,  # No single path
                }
            )

        # Sherpa-ONNX diarization
        seg_path = os.path.join(cache_dir, "sherpa-onnx-segmentation")
        emb_path = os.path.join(cache_dir, "sherpa-onnx-embedding")
        if os.path.exists(seg_path) and os.path.exists(emb_path):
            total_size = get_model_size_mb(seg_path) + get_model_size_mb(emb_path)
            installed_models.append(
                {
                    "name": "sherpa-onnx-diarization",
                    "size_mb": total_size,
                    "model_type": "diarization",
                    "installed": True,
                    "path": None,  # No single path
                }
            )

        # Check if we have at least one transcription model
        transcription_models = [
            m for m in installed_models if m["model_type"] in ("whisper", "parakeet")
        ]
        has_required = len(transcription_models) > 0

        # Determine status and message
        if not installed_models:
            status = "warning"
            message = "Модели не установлены. Рекомендуется скачать whisper-base."
        elif not has_required:
            status = "warning"
            message = f"Установлено {len(installed_models)} моделей, но нет моделей транскрипции."
        else:
            status = "ok"
            model_names = [m["name"] for m in transcription_models]
            message = f"Установлено моделей: {len(installed_models)} ({', '.join(model_names[:3])}{'...' if len(model_names) > 3 else ''})"

        return {
            "status": status,
            "installedModels": installed_models,
            "hasRequiredModel": has_required,
            "message": message,
        }

    except Exception as e:
        return {
            "status": "error",
            "installedModels": [],
            "hasRequiredModel": False,
            "message": f"Ошибка при проверке моделей: {str(e)}",
        }


def get_full_environment_status(cache_dir: Optional[str] = None) -> dict[str, Any]:
    """
    Get complete environment status for Setup Wizard.

    Combines all checks into a single response for efficient initialization.

    Args:
        cache_dir: Optional cache directory path for model check.

    Returns:
        Dict with all check results:
        - python: PythonCheckResult
        - ffmpeg: FFmpegCheckResult
        - models: ModelCheckResult
        - devices: Device check result from device_detection
        - overallStatus: "ok" | "warning" | "error"
        - message: Overall status message
    """
    try:
        # Run all checks
        python_result = check_python_environment()
        ffmpeg_result = check_ffmpeg()
        models_result = check_models(cache_dir)

        # Get device info
        devices_result = {
            "status": "error",
            "devices": [],
            "recommended": None,
            "message": "",
        }
        try:
            from device_detection import detect_all_devices, get_recommended_device
            from dataclasses import asdict

            devices = detect_all_devices()
            recommended = get_recommended_device(devices)

            devices_result = {
                "status": "ok",
                "devices": [asdict(d) for d in devices],
                "recommended": asdict(recommended),
                "message": f"Доступно устройств: {len(devices)}",
            }
        except Exception as e:
            devices_result = {
                "status": "error",
                "devices": [],
                "recommended": None,
                "message": f"Ошибка определения устройств: {str(e)}",
            }

        # Determine overall status
        statuses = [
            python_result["status"],
            ffmpeg_result["status"],
            models_result["status"],
            devices_result["status"],
        ]

        if "error" in statuses:
            overall_status = "error"
            error_count = statuses.count("error")
            message = f"Обнаружено {error_count} проблем(ы). Требуется внимание."
        elif "warning" in statuses:
            overall_status = "warning"
            message = "Среда настроена с предупреждениями."
        else:
            overall_status = "ok"
            message = "Все компоненты установлены и настроены."

        return {
            "type": "environment_status",
            "python": python_result,
            "ffmpeg": ffmpeg_result,
            "models": models_result,
            "devices": devices_result,
            "overallStatus": overall_status,
            "message": message,
        }

    except Exception as e:
        return {
            "type": "environment_status",
            "python": {
                "status": "error",
                "version": None,
                "executable": None,
                "inVenv": False,
                "pytorchInstalled": False,
                "pytorchVersion": None,
                "cudaAvailable": False,
                "mpsAvailable": False,
                "message": f"Ошибка: {str(e)}",
            },
            "ffmpeg": {
                "status": "error",
                "installed": False,
                "path": None,
                "version": None,
                "message": f"Ошибка: {str(e)}",
            },
            "models": {
                "status": "error",
                "installedModels": [],
                "hasRequiredModel": False,
                "message": f"Ошибка: {str(e)}",
            },
            "devices": {
                "status": "error",
                "devices": [],
                "recommended": None,
                "message": f"Ошибка: {str(e)}",
            },
            "overallStatus": "error",
            "message": f"Критическая ошибка при проверке окружения: {str(e)}",
        }


def emit_segment(segment: dict, index: int, total: Optional[int] = None):
    """Emit a single transcription segment to stdout as JSON for streaming.

    This allows the frontend to display segments as they are generated,
    rather than waiting for the entire transcription to complete.

    Args:
        segment: Transcription segment dict with start, end, text, speaker, confidence
        index: Segment index (0-based)
        total: Optional total number of segments (for progress tracking)
    """
    data = {
        "type": "segment",
        "segment": segment,
        "index": index,
        "total": total,
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


# Global flag to track download cancellation
_download_cancelled = {"cancelled": False}

# Global state to track multi-stage diarization downloads
_current_diarization_download = {
    "active": False,
    "model_name": None,
    "stage": None,
}


def cancel_download():
    """Cancel the current download operation."""
    _download_cancelled["cancelled"] = True
    emit_progress("cancelled", 0, "Download cancelled by user")


def reset_download_cancel():
    """Reset the download cancellation flag."""
    _download_cancelled["cancelled"] = False


def cancel_model_download(model_name: str):
    """Cancel an ongoing model download."""
    _download_cancelled["cancelled"] = True
    emit_progress("cancelled", 0, f"Download cancelled for {model_name}")


def validate_cache_dir(cache_dir: str) -> bool:
    """MEDIUM-3: Validate cache directory is writable."""
    try:
        if not os.path.exists(cache_dir):
            try:
                os.makedirs(cache_dir, exist_ok=True)
            except OSError as e:
                emit_error(f"Cannot create cache directory: {str(e)}")
                return False

        test_file = os.path.join(cache_dir, ".write_test.tmp")
        try:
            with open(test_file, "w") as f:
                f.write("test")
            os.remove(test_file)
            return True
        except OSError as e:
            emit_error(f"Cache directory not writable: {str(e)}")
            return False
    except Exception as e:
        emit_error(f"Cache validation error: {str(e)}")
        return False


def download_model(
    model_name: str, cache_dir: str, model_type: str, token_file: Optional[str] = None
):
    """Download a model to cache directory with progress updates.

    IMPROVED: Now uses ImprovedDownloader with better progress tracking,
    retry logic, and error handling.
    """
    import shutil
    import time as time_module
    from huggingface_hub import snapshot_download, login

    # Try to use improved downloader if available
    ImprovedDownloader = None
    DownloadError = Exception
    DiskSpaceError = Exception
    logger = None
    try:
        from downloader import ImprovedDownloader as _ImprovedDownloader
        from downloader import DownloadError as _DownloadError
        from downloader import DiskSpaceError as _DiskSpaceError

        ImprovedDownloader = _ImprovedDownloader
        DownloadError = _DownloadError
        DiskSpaceError = _DiskSpaceError
        _use_improved = True
    except ImportError:
        _use_improved = False

    if _use_improved:
        print(
            json.dumps(
                {
                    "type": "debug",
                    "message": f"Using ImprovedDownloader for {model_name}",
                }
            ),
            flush=True,
        )

    # MEDIUM-3: Validate cache directory is writable before downloading
    if not validate_cache_dir(cache_dir):
        return

    # Security: Validate model name to prevent path traversal
    try:
        model_name = validate_model_name(model_name)
    except ValueError as e:
        emit_error(str(e))
        return

    reset_download_cancel()

    # Validate dependencies first
    try:
        import huggingface_hub

        print(
            json.dumps(
                {"type": "debug", "message": "huggingface_hub imported successfully"}
            ),
            flush=True,
        )
    except ImportError as e:
        print(
            json.dumps({"type": "debug", "message": f"ImportError: {str(e)}"}),
            flush=True,
        )
        emit_error(
            f"Missing required dependency: huggingface_hub. Install with: pip install huggingface_hub"
        )
        return

    # === IMPROVED: Use ImprovedDownloader if available ===
    if _use_improved:
        try:
            # Read token from file if provided
            huggingface_token = None
            if token_file:
                try:
                    with open(token_file, "r") as f:
                        huggingface_token = f.read().strip()
                except (IOError, OSError) as e:
                    emit_error(f"Failed to read token file: {str(e)}")
                    return

            # Create improved downloader
            from pathlib import Path

            if ImprovedDownloader is None:
                emit_error("ImprovedDownloader is not available")
                return

            downloader = ImprovedDownloader(
                cache_dir=Path(cache_dir),
                huggingface_token=huggingface_token,
                progress_callback=lambda p: emit_download_progress_wrapper(p),
            )

            # Model repositories mapping (local copy to avoid scope issues)
            IMPROVED_MODEL_REPOSITORIES = {
                "whisper-tiny": "Systran/faster-whisper-tiny",
                "whisper-base": "Systran/faster-whisper-base",
                "whisper-small": "Systran/faster-whisper-small",
                "whisper-medium": "Systran/faster-whisper-medium",
                "whisper-large-v3": "Systran/faster-whisper-large-v3",
                "parakeet-tdt-0.6b-v3": "nvidia/parakeet-tdt-0.6b-v3",
                "parakeet-tdt-1.1b": "nvidia/parakeet-tdt-1.1b",
            }

            # Sherpa-ONNX URLs for GitHub downloads
            IMPROVED_SHERPA_URLS = {
                "sherpa-onnx-segmentation": "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2",
                "sherpa-onnx-embedding": "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
            }

            # Download based on model type
            if model_type == "whisper":
                repo_id = IMPROVED_MODEL_REPOSITORIES.get(model_name)
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
                # Emit initial progress for diarization models
                emit_progress("ready", 0, f"Starting download of {model_name}...")

                # Handle diarization models
                if model_name == "pyannote-diarization":
                    if not huggingface_token:
                        emit_error(
                            "PyAnnote models require HUGGINGFACE_ACCESS_TOKEN environment variable"
                        )
                        return

                    # Set current multi-stage download context
                    _current_diarization_download["active"] = True
                    _current_diarization_download["model_name"] = model_name

                    # Stage 1: Download segmentation
                    _current_diarization_download["stage"] = "segmentation"
                    segmentation_dir = downloader.download_from_huggingface(
                        repo_id="pyannote/segmentation-3.0",
                        model_name="pyannote-segmentation-3.0",
                    )

                    # Emit stage completion
                    data = {
                        "type": "download_stage_complete",
                        "data": {"model_name": model_name, "stage": "segmentation"},
                    }
                    print(json.dumps(data), flush=True)

                    # Stage 2: Download embedding
                    _current_diarization_download["stage"] = "embedding"
                    embedding_dir = downloader.download_from_huggingface(
                        repo_id="pyannote/embedding",
                        model_name="pyannote-embedding-3.0",
                    )

                    # Emit stage completion
                    data = {
                        "type": "download_stage_complete",
                        "data": {"model_name": model_name, "stage": "embedding"},
                    }
                    print(json.dumps(data), flush=True)

                    # Clear multi-stage download context
                    _current_diarization_download["active"] = False
                    _current_diarization_download["stage"] = None

                    # Combine paths for completion
                    target_dir = downloader.cache_dir / model_name
                    size_mb = get_model_size_mb(str(target_dir))
                    emit_download_complete(model_name, size_mb, str(target_dir))

                elif model_name == "sherpa-onnx-diarization":
                    # Set current multi-stage download context
                    _current_diarization_download["active"] = True
                    _current_diarization_download["model_name"] = model_name

                    # Stage 1: Download segmentation to sherpa-onnx-diarization/sherpa-onnx-segmentation/
                    _current_diarization_download["stage"] = "segmentation"
                    downloader.download_from_github(
                        url=IMPROVED_SHERPA_URLS["sherpa-onnx-segmentation"],
                        asset_name="sherpa-onnx-segmentation.tar.bz2",
                        model_name="sherpa-onnx-diarization/sherpa-onnx-segmentation",
                    )

                    # Emit stage completion
                    data = {
                        "type": "download_stage_complete",
                        "data": {"model_name": model_name, "stage": "segmentation"},
                    }
                    print(json.dumps(data), flush=True)

                    # Stage 2: Download embedding to sherpa-onnx-diarization/sherpa-onnx-embedding/
                    _current_diarization_download["stage"] = "embedding"
                    downloader.download_from_github(
                        url=IMPROVED_SHERPA_URLS["sherpa-onnx-embedding"],
                        asset_name="3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
                        model_name="sherpa-onnx-diarization/sherpa-onnx-embedding",
                    )

                    # Emit stage completion
                    data = {
                        "type": "download_stage_complete",
                        "data": {"model_name": model_name, "stage": "embedding"},
                    }
                    print(json.dumps(data), flush=True)

                    # Clear multi-stage download context
                    _current_diarization_download["active"] = False
                    _current_diarization_download["stage"] = None

                    target_dir = downloader.cache_dir / "sherpa-onnx-diarization"
                    size_mb = get_model_size_mb(str(target_dir))
                    emit_download_complete(model_name, size_mb, str(target_dir))

            elif model_name.startswith("sherpa-onnx-"):
                repo_id = IMPROVED_MODEL_REPOSITORIES.get(model_name)
                if not repo_id:
                    emit_error(f"Unknown model: {model_name}")
                    return

                downloader.download_from_github(
                    url=repo_id, asset_name=model_name, model_name=model_name
                )

                target_dir = downloader.cache_dir / model_name
                size_mb = get_model_size_mb(str(target_dir))
                emit_download_complete(model_name, size_mb, str(target_dir))

            elif model_name.startswith("pyannote-"):
                if not huggingface_token:
                    emit_error(
                        "PyAnnote models require HUGGINGFACE_ACCESS_TOKEN environment variable"
                    )
                    return

                repo_id = IMPROVED_MODEL_REPOSITORIES.get(model_name)
                if not repo_id:
                    emit_error(f"Unknown model: {model_name}")
                    return

                downloader.download_from_huggingface(
                    repo_id=repo_id, model_name=model_name
                )

                target_dir = downloader.cache_dir / model_name
                size_mb = get_model_size_mb(str(target_dir))
                emit_download_complete(model_name, size_mb, str(target_dir))

            else:
                emit_error(f"Unknown diarization model: {model_name}")
                return

            # Download successful
            return

        except DownloadError as e:
            emit_error(str(e))
            return
        except DiskSpaceError as e:
            emit_error(str(e))
            return
        except Exception as e:
            logger.error(f"Download failed: {e}", exc_info=True) if logger else None
            emit_error(f"Download failed: {str(e)}")
            return

    # === FALLBACK: Original implementation ===

    # Convert to absolute path for Windows compatibility (avoids canonicalize issues)
    original_cache_dir = cache_dir
    cache_dir = os.path.abspath(cache_dir) if cache_dir else cache_dir
    print(
        json.dumps(
            {
                "type": "debug",
                "message": f"Cache dir conversion: {original_cache_dir} -> {cache_dir}",
            }
        ),
        flush=True,
    )

    # Use full model name for all models to maintain consistency with delete/list operations
    target_dir = os.path.abspath(os.path.join(cache_dir, model_name))

    # Ensure directories exist
    os.makedirs(cache_dir, exist_ok=True)

    # Check if model already exists
    if os.path.exists(target_dir):
        # Check if model files are present
        model_files = []
        for root, dirs, files in os.walk(target_dir):
            for f in files:
                if f.endswith((".bin", ".onnx", ".ggml", ".pt", ".safetensors")):
                    model_files.append(os.path.join(root, f))

        if model_files:
            # Model already downloaded
            size_mb = get_model_size_mb(target_dir)
            print(
                json.dumps(
                    {
                        "type": "debug",
                        "message": f"Model already exists: {model_name} ({size_mb}MB)",
                    }
                ),
                flush=True,
            )
            emit_download_complete(model_name, size_mb, target_dir)
            return

        # No model files, try to clean up
        try:
            shutil.rmtree(target_dir)
        except (PermissionError, OSError) as e:
            # If directory is locked, try to continue anyway
            print(
                json.dumps(
                    {
                        "type": "debug",
                        "message": f"Could not remove existing directory: {str(e)}",
                    }
                ),
                flush=True,
            )

    os.makedirs(target_dir, exist_ok=True)

    # Startup validation complete - signal ready to download
    emit_progress("ready", 0, f"Starting download of {model_name}...")
    print(
        json.dumps(
            {
                "type": "debug",
                "message": "Ready signal emitted, starting actual download",
            }
        ),
        flush=True,
    )

    emit_progress("download", 0, f"Starting download of {model_name}...")
    print(
        json.dumps({"type": "debug", "message": "Download progress 0% emitted"}),
        flush=True,
    )

    # HIGH-7: Read token from file if provided, otherwise fall back to env var
    hf_token = None
    if token_file:
        try:
            with open(token_file, "r") as f:
                hf_token = f.read().strip()
        except (IOError, OSError) as e:
            emit_error(f"Failed to read token file: {str(e)}")
            return
    else:
        # Fallback to env var (less secure)
        hf_token = os.environ.get("HUGGINGFACE_ACCESS_TOKEN") or os.environ.get(
            "HF_TOKEN"
        )

    try:
        if model_type == "whisper":
            from huggingface_hub import snapshot_download

            repo_id = MODEL_REPOSITORIES.get(model_name)
            if not repo_id:
                print(
                    json.dumps(
                        {
                            "type": "debug",
                            "message": f"Model not found in repositories: {model_name}",
                        }
                    ),
                    flush=True,
                )
                emit_error(f"Unknown model: {model_name}")
                return

            print(
                json.dumps(
                    {
                        "type": "debug",
                        "message": f"Starting snapshot_download for repo_id: {repo_id}",
                    }
                ),
                flush=True,
            )

            # Emit initial progress event so UI immediately shows loading state
            emit_progress("ready", 0, f"Starting download of {model_name}...")

            # Progress tracking - monitor directory size in a thread
            import threading

            stop_monitor = threading.Event()
            last_progress_time = time_module.time()
            last_size_mb = 0

            print(
                json.dumps(
                    {
                        "type": "debug",
                        "message": f"Starting download monitor for target_dir: {target_dir}",
                    }
                ),
                flush=True,
            )

            def monitor_download_progress():
                """Monitor download progress by checking directory size."""
                nonlocal last_progress_time, last_size_mb

                print(
                    json.dumps(
                        {
                            "type": "debug",
                            "message": "Monitor function started, waiting for stop signal",
                        }
                    ),
                    flush=True,
                )

                while not stop_monitor.is_set():
                    current_time = time_module.time()
                    time_elapsed = current_time - last_progress_time

                    # Check every 0.5 seconds with responsive stop check
                    if time_elapsed >= 0.5:
                        # Immediately check stop flag again to ensure responsiveness
                        if stop_monitor.is_set():
                            break

                        current_mb = (
                            get_model_size_mb(target_dir)
                            if os.path.exists(target_dir)
                            else 0
                        )

                        # Check if size changed
                        if (
                            abs(current_mb - last_size_mb) >= 0.1
                        ):  # More than 0.1MB change = progress
                            last_size_mb = current_mb  # Update on progress

                        # Always emit progress if there's any data
                        if current_mb > 0:
                            # Estimate total size (use typical model sizes)
                            if "tiny" in model_name:
                                estimated_total_mb = 80
                            elif "base" in model_name:
                                estimated_total_mb = 160
                            elif "small" in model_name:
                                estimated_total_mb = 500
                            elif "medium" in model_name:
                                estimated_total_mb = 1600
                            elif "large" in model_name:
                                estimated_total_mb = 3200
                            else:
                                estimated_total_mb = max(current_mb * 1.2, 150)

                            # Calculate speed based on change since last check
                            if time_elapsed > 0 and current_mb > last_size_mb:
                                speed_mb_s = (current_mb - last_size_mb) / time_elapsed
                            else:
                                speed_mb_s = 0

                            # Calculate progress percentage
                            progress_percent = min(
                                100, int((current_mb / estimated_total_mb) * 100)
                            )

                            print(
                                json.dumps(
                                    {
                                        "type": "debug",
                                        "message": f"Progress: {current_mb}MB / {estimated_total_mb}MB ({progress_percent}%), Speed: {speed_mb_s:.2f}MB/s",
                                    }
                                ),
                                flush=True,
                            )

                            # Emit progress
                            current_bytes = current_mb * 1024 * 1024
                            total_bytes = estimated_total_mb * 1024 * 1024
                            emit_download_progress(
                                current_bytes, total_bytes, speed_mb_s
                            )

                            last_progress_time = current_time

                    # Sleep with responsive stop checking
                    for _ in range(
                        5
                    ):  # Sleep in smaller chunks for better responsiveness
                        if stop_monitor.is_set():
                            break
                        time_module.sleep(0.02)  # 0.1s total / 5 chunks

                    # Double-check stop flag after sleep loop
                    if stop_monitor.is_set():
                        break

                print(
                    json.dumps(
                        {
                            "type": "debug",
                            "message": "Monitor function loop exited cleanly",
                        }
                    ),
                    flush=True,
                )

            # Start monitoring thread
            print(
                json.dumps(
                    {
                        "type": "debug",
                        "message": "Download monitor thread started",
                    }
                ),
                flush=True,
            )
            monitor_thread = threading.Thread(
                target=monitor_download_progress, daemon=True
            )
            monitor_thread.start()

            try:
                snapshot_download(
                    repo_id=repo_id,
                    local_dir=target_dir,
                    cache_dir=None,
                )
            finally:
                # Stop monitoring thread
                print(
                    json.dumps(
                        {
                            "type": "debug",
                            "message": "Stopping download monitor",
                        }
                    ),
                    flush=True,
                )
                stop_monitor.set()
                # Wait for thread to finish with a reasonable timeout
                monitor_thread.join(timeout=1.0)
                if monitor_thread.is_alive():
                    print(
                        json.dumps(
                            {
                                "type": "warning",
                                "message": "Monitoring thread did not stop gracefully, forcing cleanup",
                            }
                        ),
                        flush=True,
                    )
                    # The thread is daemon=True, so it will be killed when the main thread exits

                # Final size check
                final_size_mb = (
                    get_model_size_mb(target_dir) if os.path.exists(target_dir) else 0
                )

                # List files in directory for debugging
                files_list = []
                if os.path.exists(target_dir):
                    for root, dirs, files in os.walk(target_dir):
                        for file in files:
                            filepath = os.path.join(root, file)
                            filesize = os.path.getsize(filepath) / (1024 * 1024)  # MB
                            files_list.append(f"{file}: {filesize:.2f}MB")

                print(
                    json.dumps(
                        {
                            "type": "debug",
                            "message": f"Final download size: {final_size_mb}MB in {target_dir}",
                            "files": files_list,
                        }
                    ),
                    flush=True,
                )

            print(
                json.dumps(
                    {
                        "type": "debug",
                        "message": "snapshot_download completed successfully",
                    }
                ),
                flush=True,
            )

            # Emit 100% progress
            emit_progress("download", 100, "Download complete!")

            # Emit download complete event
            final_size_mb = (
                get_model_size_mb(target_dir) if os.path.exists(target_dir) else 0
            )
            emit_download_complete(model_name, final_size_mb, str(target_dir))
        elif model_type == "diarization":
            # Emit initial progress for diarization models
            emit_progress("ready", 0, f"Starting download of {model_name}...")

            repo_id = MODEL_REPOSITORIES.get(model_name)
            if not repo_id:
                emit_error(f"Unknown model: {model_name}")
                return

            # PyAnnote combined diarization model
            if model_name == "pyannote-diarization":
                if not hf_token:
                    emit_error(
                        "PyAnnote models require HUGGINGFACE_ACCESS_TOKEN environment variable"
                    )
                    return

                login(token=hf_token)

                # Download both segmentation and embedding models
                segmentation_repo = MODEL_REPOSITORIES["pyannote-segmentation-3.0"]
                embedding_repo = MODEL_REPOSITORIES["pyannote-embedding-3.0"]

                # Create subdirectories for each model
                segmentation_dir = os.path.join(target_dir, "pyannote-segmentation-3.0")
                embedding_dir = os.path.join(target_dir, "pyannote-embedding-3.0")

                os.makedirs(segmentation_dir, exist_ok=True)
                os.makedirs(embedding_dir, exist_ok=True)

                # Download segmentation model
                emit_progress(
                    "download", 0, "Downloading PyAnnote segmentation model..."
                )
                snapshot_download(
                    repo_id=segmentation_repo,
                    local_dir=segmentation_dir,
                    cache_dir=None,
                    token=hf_token,
                )

                # Download embedding model
                emit_progress("download", 50, "Downloading PyAnnote embedding model...")
                snapshot_download(
                    repo_id=embedding_repo,
                    local_dir=embedding_dir,
                    cache_dir=None,
                    token=hf_token,
                )

                emit_progress(
                    "download",
                    100,
                    "PyAnnote diarization models downloaded successfully",
                )
            # Sherpa-ONNX models are downloaded from GitHub releases (no auth needed)
            elif model_name == "sherpa-onnx-diarization":
                # Download both segmentation and embedding models
                segmentation_url = MODEL_REPOSITORIES["sherpa-onnx-segmentation"]
                embedding_url = MODEL_REPOSITORIES["sherpa-onnx-embedding"]

                # Create subdirectories for each model
                segmentation_dir = os.path.join(target_dir, "sherpa-onnx-segmentation")
                embedding_dir = os.path.join(target_dir, "sherpa-onnx-embedding")

                os.makedirs(segmentation_dir, exist_ok=True)
                os.makedirs(embedding_dir, exist_ok=True)

                # Download segmentation model
                emit_progress(
                    "download", 0, "Downloading Sherpa-ONNX segmentation model..."
                )
                download_sherpa_onnx_model(
                    "sherpa-onnx-segmentation", segmentation_url, segmentation_dir
                )

                # Download embedding model
                emit_progress(
                    "download", 50, "Downloading Sherpa-ONNX embedding model..."
                )
                download_sherpa_onnx_model(
                    "sherpa-onnx-embedding", embedding_url, embedding_dir
                )

                emit_progress(
                    "download",
                    100,
                    "Sherpa-ONNX diarization models downloaded successfully",
                )
            elif model_name.startswith("sherpa-onnx-"):
                download_sherpa_onnx_model(model_name, repo_id, target_dir)
            elif model_name.startswith("pyannote-"):
                if not hf_token:
                    emit_error(
                        "PyAnnote models require HUGGINGFACE_ACCESS_TOKEN environment variable"
                    )
                    return

                login(token=hf_token)

                snapshot_download(
                    repo_id=repo_id,
                    local_dir=target_dir,
                    cache_dir=None,
                    token=hf_token,
                )
            else:
                emit_error(f"Unknown diarization model: {model_name}")
                return
        else:
            repo_id = MODEL_REPOSITORIES.get(model_name)
            if not repo_id:
                emit_error(f"Unknown model: {model_name}")
                return

            snapshot_download(
                repo_id=repo_id,
                local_dir=target_dir,
                cache_dir=None,
            )

        if _download_cancelled["cancelled"]:
            emit_progress("cancelled", 0, "Download cancelled by user")
            raise KeyboardInterrupt("Download cancelled by user")

        if os.path.exists(target_dir):
            size_mb = get_model_size_mb(target_dir)
            # Debug output
            print(
                json.dumps(
                    {
                        "type": "debug",
                        "message": f"Download complete, size: {size_mb}MB, dir: {target_dir}",
                    }
                ),
                flush=True,
            )
            emit_download_complete(model_name, size_mb, target_dir)
            print(
                json.dumps({"type": "debug", "message": "DownloadComplete emitted"}),
                flush=True,
            )
        else:
            emit_error(f"Model directory not found: {target_dir}")

    except KeyboardInterrupt as e:
        if "cancelled" in str(e):
            emit_progress("cancelled", 0, "Download cancelled by user")
            if os.path.exists(target_dir):
                shutil.rmtree(target_dir)
            return
        else:
            raise
    except Exception as e:
        error_msg = str(e)
        if "gated" in error_msg.lower() or "unauthorized" in error_msg.lower():
            emit_error(
                f"Gated model: {model_name}. Set HUGGINGFACE_ACCESS_TOKEN env variable"
            )
        else:
            emit_error(f"Download failed: {error_msg}")
        if os.path.exists(target_dir):
            shutil.rmtree(target_dir)


def list_models(cache_dir: str):
    """List all installed models in the cache directory."""
    logger.info(f"Listing models in cache directory: {cache_dir}")
    models = []

    if not os.path.exists(cache_dir):
        logger.warning("Cache directory does not exist", {"path": cache_dir})
        emit_models_list(models)
        return

    # Individual diarization components to skip (these are part of composite models)
    skip_individual_components = {
        "pyannote-segmentation-3.0",
        "pyannote-embedding-3.0",
        "sherpa-onnx-segmentation",
        "sherpa-onnx-embedding",
    }

    for model_name in os.listdir(cache_dir):
        model_path = os.path.join(cache_dir, model_name)
        if not os.path.isdir(model_path):
            logger.debug(f"Skipping non-directory entry: {model_name}")
            continue

        # Skip individual diarization components (they are part of composite models)
        if model_name in skip_individual_components:
            logger.debug(f"Skipping individual diarization component: {model_name}")
            continue

        # Check for expected subdirectories in diarization models
        if model_name == "pyannote-diarization":
            seg_path = os.path.join(model_path, "pyannote-segmentation-3.0")
            emb_path = os.path.join(model_path, "pyannote-embedding-3.0")
            if not os.path.exists(seg_path) or not os.path.exists(emb_path):
                logger.debug(
                    f"Skipping incomplete pyannote-diarization (missing subdirectories)"
                )
                continue
        elif model_name == "sherpa-onnx-diarization":
            seg_path = os.path.join(model_path, "sherpa-onnx-segmentation")
            emb_path = os.path.join(model_path, "sherpa-onnx-embedding")
            if not os.path.exists(seg_path) or not os.path.exists(emb_path):
                logger.debug(
                    f"Skipping incomplete sherpa-onnx-diarization (missing subdirectories)"
                )
                continue

        size_mb = get_model_size_mb(model_path)
        logger.debug(f"Found model: {model_name}", {"sizeMb": size_mb})

        # Infer model type from directory name
        if model_name.startswith("whisper-"):
            model_type = "whisper"
        elif model_name.startswith("parakeet-"):
            model_type = "parakeet"
        elif model_name.startswith("sherpa-onnx-"):
            model_type = "diarization"
        elif model_name == "sherpa-onnx-diarization":
            model_type = "diarization"
        elif model_name.startswith("pyannote-"):
            model_type = "diarization"
        elif model_name == "pyannote-diarization":
            model_type = "diarization"
        else:
            continue

        models.append(
            {
                "name": model_name,
                "size_mb": size_mb,
                "model_type": model_type,
                "installed": True,
                "path": model_path,
            }
        )

    emit_models_list(models)


def validate_models(cache_dir: str, model_name: Optional[str] = None):
    """
    Validate model availability using ModelRegistry.

    Args:
        cache_dir: Cache directory for model storage
        model_name: Optional specific model name to validate.
                   If None, validates all registered models.
    """
    logger.info(f"Validating models in cache directory: {cache_dir}")
    if model_name:
        logger.info(f"Validating specific model: {model_name}")

    # Initialize ModelRegistry with the provided cache directory
    registry = ModelRegistry(cache_dir)

    results = []

    def add_result(
        name: str,
        available: bool,
        provider: str,
        path: Optional[Path] = None,
        size_mb: Optional[float] = None,
    ):
        """Helper to add a validation result."""
        result = {
            "name": name,
            "available": available,
            "provider": provider,
            "status": "OK" if available else "NOT INSTALLED",
        }
        if path:
            result["path"] = str(path)
        if size_mb is not None:
            result["size_mb"] = round(size_mb, 2)
        results.append(result)

    # If a specific model is requested, validate only that one
    if model_name:
        # Parse model name to determine provider
        if model_name.startswith("whisper-"):
            size = model_name.replace("whisper-", "")
            path, repo_id = registry.get_whisper_path(size)
            size_mb = get_model_size_mb(str(path)) if path else None
            add_result(model_name, path is not None, "whisper", path, size_mb)
        elif model_name.startswith("distil-"):
            # Handle both "distil-large" and "distil-whisper-large" formats
            if model_name.startswith("distil-whisper-"):
                size = model_name.replace("distil-whisper-", "")
            else:
                size = model_name.replace("distil-", "")
            path, repo_id = registry.get_distil_whisper_path(size)
            size_mb = get_model_size_mb(str(path)) if path else None
            add_result(model_name, path is not None, "distil-whisper", path, size_mb)
        elif model_name.startswith("parakeet-"):
            size = model_name.replace("parakeet-", "").replace("tdt-", "")
            try:
                path, model_id = registry.get_parakeet_path(size)
                size_mb = get_model_size_mb(str(path)) if path else None
                add_result(model_name, path is not None, "parakeet", path, size_mb)
            except ValueError:
                add_result(model_name, False, "parakeet", None, None)
        elif model_name == "sherpa-onnx-diarization" or model_name.startswith(
            "sherpa-onnx"
        ):
            sherpa_paths = registry.get_sherpa_diarization_paths()
            available = all(p is not None for p in sherpa_paths.values())
            path = registry.diarization_cache / "sherpa-onnx" if available else None
            size_mb = get_model_size_mb(str(path)) if path else None
            add_result(model_name, available, "sherpa-onnx", path, size_mb)
        elif model_name == "pyannote-diarization" or model_name.startswith("pyannote"):
            pyannote_paths = registry.get_pyannote_diarization_paths()
            available = all(p[0] is not None for p in pyannote_paths.values())
            path = registry.diarization_cache / "pyannote" if available else None
            size_mb = get_model_size_mb(str(path)) if path else None
            add_result(model_name, available, "pyannote", path, size_mb)
        else:
            # Unknown model format
            add_result(model_name, False, "unknown", None, None)
    else:
        # Validate all Whisper models
        for size in registry.WHISPER_REPOS.keys():
            path, repo_id = registry.get_whisper_path(size)
            size_mb = get_model_size_mb(str(path)) if path else None
            add_result(f"whisper-{size}", path is not None, "whisper", path, size_mb)

        # Validate all Distil-Whisper models
        for size in registry.DISTIL_WHISPER_REPOS.keys():
            path, repo_id = registry.get_distil_whisper_path(size)
            size_mb = get_model_size_mb(str(path)) if path else None
            add_result(
                f"distil-whisper-{size}",
                path is not None,
                "distil-whisper",
                path,
                size_mb,
            )

        # Validate all Parakeet models
        for size in registry.PARAKEET_MODELS.keys():
            path, model_id = registry.get_parakeet_path(size)
            size_mb = get_model_size_mb(str(path)) if path else None
            add_result(
                f"parakeet-tdt-{size}", path is not None, "parakeet", path, size_mb
            )

        # Validate Sherpa diarization
        sherpa_paths = registry.get_sherpa_diarization_paths()
        available = all(p is not None for p in sherpa_paths.values())
        path = registry.diarization_cache / "sherpa-onnx" if available else None
        size_mb = get_model_size_mb(str(path)) if path else None
        add_result("sherpa-onnx-diarization", available, "sherpa-onnx", path, size_mb)

        # Validate PyAnnote diarization
        pyannote_paths = registry.get_pyannote_diarization_paths()
        available = all(p[0] is not None for p in pyannote_paths.values())
        path = registry.diarization_cache / "pyannote" if available else None
        size_mb = get_model_size_mb(str(path)) if path else None
        add_result("pyannote-diarization", available, "pyannote", path, size_mb)

    emit_validation_results(results, cache_dir)


def delete_model(model_name: str, cache_dir: str):
    """
    Delete a model from the cache directory using ModelRegistry.

    Handles deletion from appropriate cache locations:
    - Whisper/Distil: hf_cache/hub/models--{org}--{name}/
    - Parakeet: nemo/{model_name}/
    - Sherpa: diarization/sherpa-onnx/ (segmentation + embedding)
    - PyAnnote: hf_cache/hub/models--pyannote--*/ (all pyannote models)

    IMPORTANT: Clears model pool first to release file handles.
    """
    logger.info(f"Deleting model: {model_name} from cache: {cache_dir}")

    # CRITICAL: Clear model pool first to release file handles
    # This prevents "os error 32" (file in use) on Windows
    try:
        model_pool.clear()
        logger.info(f"Cleared model pool before deleting {model_name}")
        # Give a moment for cleanup to complete
        import time

        time.sleep(0.1)
    except Exception as e:
        logger.warning(f"Error clearing model pool: {e}")

    # Initialize ModelRegistry with the provided cache directory
    registry = ModelRegistry(cache_dir)

    # Use ModelRegistry to delete the model
    result = registry.delete_model(model_name)

    if result["success"]:
        logger.info(
            f"Model deleted successfully: {model_name}",
            {"deleted_paths": result["deleted_paths"]},
        )
        emit_delete_complete(model_name)
    else:
        logger.warning(
            f"Failed to delete model: {model_name}",
            {"message": result["message"]},
        )
        emit_error(result["message"])


def run_server_mode():
    """Run in server mode, listening for JSON commands on stdin."""
    import traceback

    # Preload commonly used models for faster first use
    logger.info("Preloading models...")
    preload_configs = []

    # Always preload CPU models
    preload_configs.extend(
        [
            {"model_name": "whisper-base", "device": "cpu"},
        ]
    )

    # Check if CUDA is available and preload GPU models
    try:
        import torch

        if torch.cuda.is_available():
            logger.info(f"CUDA available: {torch.cuda.get_device_name(0)}")
            preload_configs.append({"model_name": "whisper-base", "device": "cuda"})
    except ImportError:
        logger.debug("PyTorch not available, skipping CUDA preload")

    # Preload models
    if preload_configs:
        loaded = model_pool.preload_models(preload_configs)
        logger.info(f"Preloaded {loaded}/{len(preload_configs)} models")

        # Log pool stats
        stats = model_pool.get_stats()
        logger.info(f"Model pool stats: {stats}")

    # Send ready signal
    print(json.dumps({"type": "ready", "message": "AI Engine ready"}), flush=True)
    logger.info("AI Engine server started")

    # Read commands from stdin
    _stdin = sys.stdin
    for line in _stdin:
        line = line.strip()
        if not line:
            continue

        try:
            command = safe_json_loads(line)
            cmd_type = command.get("type")

            if cmd_type == "ping":
                logger.debug("Ping received")
                print(json.dumps({"type": "pong"}), flush=True)

            elif cmd_type == "transcribe":
                # Extract parameters
                file_path = command.get("file")
                model_name = command.get("model", "whisper-base")
                device = command.get("device", "cpu")
                language = command.get("language", "auto")
                enable_diarization = command.get("diarization", False)
                task_id = command.get("taskId")
                huggingface_token = command.get("huggingfaceToken")
                # Default to "none" - only use diarization provider if explicitly enabled
                diarization_provider = command.get("diarization_provider", "none")
                num_speakers = command.get("num_speakers", -1)

                transcription_logger.set_context(
                    task_id=task_id,
                    file_name=os.path.basename(file_path) if file_path else None,
                )

                if not file_path:
                    transcription_logger.error("Missing 'file' parameter")
                    emit_error("Missing 'file' parameter")
                    continue

                # Validate diarization settings
                print(
                    json.dumps(
                        {
                            "type": "debug",
                            "message": f"Diarization settings: enable={enable_diarization}, provider={diarization_provider}",
                        }
                    ),
                    flush=True,
                    file=sys.stderr,
                )
                if enable_diarization and diarization_provider == "none":
                    transcription_logger.error(
                        "Diarization enabled but provider is 'none'"
                    )
                    emit_error(
                        "Diarization is enabled but diarization_provider is set to 'none'. Please specify 'pyannote' or 'sherpa-onnx'"
                    )
                    continue

                # Set HuggingFace token as environment variable for pyannote
                if huggingface_token:
                    os.environ["HF_TOKEN"] = huggingface_token
                    logger.info("HuggingFace token set from command parameters")

                # MEDIUM-4: Validate language parameter
                language = command.get("language", "auto")
                try:
                    validate_language(language)
                except ValueError as e:
                    transcription_logger.error(str(e))
                    emit_error(str(e))
                    continue

                # Validate file
                file_obj = Path(file_path)
                if not file_obj.exists():
                    transcription_logger.error(f"File not found: {file_path}")
                    emit_error(f"File not found: {file_path}")
                    continue

                upload_logger.file_received(
                    os.path.basename(file_path), file_obj.stat().st_size
                )
                upload_logger.file_validating(os.path.basename(file_path))

                try:
                    # Initialize model (from pool or create new)
                    transcription_logger.model_loading(model_name, 0)
                    emit_progress("loading", 0, f"Loading {model_name} model...")

                    # Debug: log what diarization provider we're passing to model_pool
                    actual_provider = (
                        diarization_provider if enable_diarization else "none"
                    )
                    print(
                        json.dumps(
                            {
                                "type": "debug",
                                "message": f"Calling model_pool.get_model with diarization_provider={actual_provider} (enable={enable_diarization})",
                            }
                        ),
                        flush=True,
                        file=sys.stderr,
                    )

                    model = model_pool.get_model(
                        model_name=model_name,
                        device=device,
                        download_root=command.get("cache_dir"),
                        diarization_provider=diarization_provider
                        if enable_diarization
                        else "none",
                        num_speakers=num_speakers,
                        vad_provider=command.get(
                            "vad_provider",
                            diarization_provider if enable_diarization else "none",
                        ),
                    )

                    model_logger.model_loaded(model_name, device)
                    emit_progress("loading", 20, "Model loaded successfully")
                    transcription_logger.model_loading(model_name, 20)

                    # Enable interval-based transcription if diarization is planned
                    if enable_diarization and hasattr(model, "enable_diarization_mode"):
                        print(
                            json.dumps(
                                {
                                    "type": "debug",
                                    "message": "Enabling interval-based transcription for diarization",
                                }
                            ),
                            flush=True,
                            file=sys.stderr,
                        )
                        model.enable_diarization_mode()

                    # Transcribe
                    transcription_logger.transcription_start(
                        os.path.basename(file_path), language
                    )
                    start_time = time.time()
                    emit_progress(
                        "transcribing",
                        25,
                        "Starting transcription...",
                        get_system_metrics(),
                    )

                    segments = model.transcribe(
                        file_path=str(file_obj),
                        language=language if language != "auto" else None,
                    )

                    transcription_logger.transcription_complete(0, len(segments))
                    processed_duration = max(
                        (s.get("end", 0) for s in segments), default=0.0
                    )
                    progress_metrics = build_progress_metrics(
                        processed_duration, processed_duration, start_time
                    )
                    emit_progress(
                        "transcribing", 80, "Transcription complete", progress_metrics
                    )

                    # Diarization if requested
                    speaker_turns = None
                    speaker_segments = None

                    if enable_diarization:
                        transcription_logger.diarization_start()
                        emit_progress(
                            "diarizing",
                            85,
                            "Running speaker diarization...",
                            progress_metrics,
                        )

                        # Run diarization - returns tuple of (segments, speaker_turns)
                        segments, speaker_turns_raw = model.diarize(
                            segments, str(file_obj)
                        )

                        # Debug logging: Log speaker_turns_raw type and length
                        print(
                            json.dumps(
                                {
                                    "type": "debug",
                                    "message": f"speaker_turns_raw type: {type(speaker_turns_raw).__name__}, length: {len(speaker_turns_raw) if hasattr(speaker_turns_raw, '__len__') else 'N/A'}",
                                }
                            ),
                            flush=True,
                            file=sys.stderr,
                        )

                        # Debug logging: Log first few speaker turns if available
                        if speaker_turns_raw and hasattr(speaker_turns_raw, "__iter__"):
                            first_turns = list(speaker_turns_raw)[:3]
                            first_turns_info = []
                            for turn in first_turns:
                                if (
                                    hasattr(turn, "speaker")
                                    and hasattr(turn, "start")
                                    and hasattr(turn, "end")
                                ):
                                    first_turns_info.append(
                                        {
                                            "speaker": turn.speaker,
                                            "start": turn.start,
                                            "end": turn.end,
                                        }
                                    )
                            print(
                                json.dumps(
                                    {
                                        "type": "debug",
                                        "message": f"First {len(first_turns_info)} speaker_turns_raw: {first_turns_info}",
                                    }
                                ),
                                flush=True,
                                file=sys.stderr,
                            )

                        # Convert SpeakerTurn objects to dictionaries for JSON serialization
                        if speaker_turns_raw:
                            speaker_turns = [
                                {
                                    "speaker": turn.speaker,
                                    "start": turn.start,
                                    "end": turn.end,
                                }
                                for turn in speaker_turns_raw
                            ]
                            print(
                                json.dumps(
                                    {
                                        "type": "debug",
                                        "message": f"Converted {len(speaker_turns)} speaker turns to dict format",
                                    }
                                ),
                                flush=True,
                                file=sys.stderr,
                            )

                            # Create speaker segments - either via split_by_speakers or use segments directly
                            if hasattr(model, "split_by_speakers"):
                                speaker_segments = model.split_by_speakers(
                                    segments, speaker_turns
                                )
                                # Debug logging: Log speaker_segments length and method
                                print(
                                    json.dumps(
                                        {
                                            "type": "debug",
                                            "message": f"split_by_speakers returned {len(speaker_segments)} segments",
                                        }
                                    ),
                                    flush=True,
                                    file=sys.stderr,
                                )
                                print(
                                    json.dumps(
                                        {
                                            "type": "debug",
                                            "message": "Using split_by_speakers method",
                                        }
                                    ),
                                    flush=True,
                                    file=sys.stderr,
                                )
                            else:
                                # Fallback: use segments with speaker labels as speaker_segments
                                speaker_segments = segments
                                # Debug logging: Log speaker_segments length and method
                                print(
                                    json.dumps(
                                        {
                                            "type": "debug",
                                            "message": f"Using {len(segments)} segments with speaker labels as speaker_segments",
                                        }
                                    ),
                                    flush=True,
                                    file=sys.stderr,
                                )
                                print(
                                    json.dumps(
                                        {
                                            "type": "debug",
                                            "message": "Using fallback method (segments with speaker labels)",
                                        }
                                    ),
                                    flush=True,
                                    file=sys.stderr,
                                )

                        # Count unique speakers
                        unique_speakers = set(
                            s.get("speaker") for s in segments if s.get("speaker")
                        )

                        transcription_logger.diarization_complete(len(unique_speakers))
                        emit_progress(
                            "diarizing", 95, "Diarization complete", progress_metrics
                        )

                    # Debug logging: Before emit_result, log final counts and first 3 segments
                    speaker_turns_count = (
                        len(speaker_turns) if speaker_turns is not None else 0
                    )
                    speaker_segments_count = (
                        len(speaker_segments) if speaker_segments is not None else 0
                    )
                    print(
                        json.dumps(
                            {
                                "type": "debug",
                                "message": f"Final counts - speaker_turns: {speaker_turns_count}, speaker_segments: {speaker_segments_count}",
                            }
                        ),
                        flush=True,
                        file=sys.stderr,
                    )
                    if speaker_segments and len(speaker_segments) > 0:
                        first_3_segments = speaker_segments[:3]
                        first_3_with_speaker = []
                        for seg in first_3_segments:
                            if isinstance(seg, dict):
                                text_val = seg.get("text", "")
                                # Truncate text if too long
                                if text_val and len(text_val) > 50:
                                    text_val = text_val[:50] + "..."
                                first_3_with_speaker.append(
                                    {
                                        "speaker": seg.get("speaker"),
                                        "start": seg.get("start"),
                                        "end": seg.get("end"),
                                        "text": text_val,
                                    }
                                )
                        print(
                            json.dumps(
                                {
                                    "type": "debug",
                                    "message": f"First 3 speaker_segments with speaker field: {first_3_with_speaker}",
                                }
                            ),
                            flush=True,
                            file=sys.stderr,
                        )

                    # Result
                    # Calculate duration from last segment
                    duration = max((s.get("end", 0) for s in segments), default=0.0)
                    progress_metrics = build_progress_metrics(
                        duration, duration, start_time
                    )
                    emit_progress(
                        "finalizing", 98, "Preparing output...", progress_metrics
                    )
                    emit_result(
                        segments,
                        language=language,
                        duration=duration,
                        speaker_turns=speaker_turns,
                        speaker_segments=speaker_segments,
                    )
                    emit_progress("finalizing", 100, "Done!", progress_metrics)
                    transcription_logger.info("Transcription completed successfully")

                except Exception as e:
                    transcription_logger.error("Transcription failed", exc=e)
                    emit_error(str(e))

            elif cmd_type == "shutdown":
                logger.info("Shutting down AI Engine")
                print(
                    json.dumps({"type": "shutdown", "message": "Shutting down"}),
                    flush=True,
                )
                return 0

            elif cmd_type == "get_devices":
                # Return available compute devices (CPU, CUDA, MPS)
                logger.debug("Get devices request received")
                try:
                    from device_detection import emit_device_info

                    emit_device_info()
                except ImportError as e:
                    logger.error(f"Failed to import device_detection: {e}")
                    emit_error(f"Device detection not available: {str(e)}")
                except Exception as e:
                    logger.error(f"Device detection failed: {e}")
                    emit_error(f"Failed to detect devices: {str(e)}")

            elif cmd_type == "check_python":
                # Check Python environment for Setup Wizard
                logger.debug("Check Python environment request received")
                result = check_python_environment()
                print(json.dumps({"type": "python_check", **result}), flush=True)

            elif cmd_type == "check_ffmpeg":
                # Check FFmpeg installation for Setup Wizard
                logger.debug("Check FFmpeg request received")
                result = check_ffmpeg()
                print(json.dumps({"type": "ffmpeg_check", **result}), flush=True)

            elif cmd_type == "check_models":
                # Check installed AI models for Setup Wizard
                logger.debug("Check models request received")
                cache_dir = command.get("cache_dir")
                result = check_models(cache_dir)
                print(json.dumps({"type": "models_check", **result}), flush=True)

            elif cmd_type == "check_environment":
                # Get full environment status for Setup Wizard
                logger.debug("Check environment request received")
                cache_dir = command.get("cache_dir")
                result = get_full_environment_status(cache_dir)
                print(json.dumps(result), flush=True)

            elif cmd_type == "delete_model":
                # Delete a model from cache (clears model pool first to release file handles)
                logger.debug("Delete model request received")
                model_name = command.get("model_name")
                cache_dir = command.get("cache_dir")

                if not model_name:
                    emit_error(
                        "Missing 'model_name' parameter for delete_model command"
                    )
                    continue

                if not cache_dir:
                    emit_error("Missing 'cache_dir' parameter for delete_model command")
                    continue

                delete_model(model_name, cache_dir)

            else:
                logger.warning(f"Unknown command type: {cmd_type}")
                emit_error(f"Unknown command type: {cmd_type}")

        except ValueError as e:
            logger.error(f"JSON validation failed", exc=e)
            emit_error(f"JSON validation error: {str(e)}")
        except Exception as e:
            logger.error("Server error", exc=e)
            emit_error(f"Server error: {str(e)}\n{traceback.format_exc()}")

    return 0


def emit_download_progress_wrapper(progress):
    """Wrapper to emit progress from ImprovedDownloader in the format expected by Rust backend."""
    from downloader import DownloadProgress

    # Check if we're in a multi-stage diarization download
    if _current_diarization_download["active"]:
        # Extract stage information from the progress object
        # The progress.model_name contains the actual submodel being downloaded
        submodel_name = (
            progress.model_name if hasattr(progress, "model_name") else "unknown"
        )
        stage = _current_diarization_download["stage"]
        model_name = _current_diarization_download["model_name"]

        # Calculate percentage
        percent = (
            int((progress.downloaded_bytes / progress.total_bytes * 100))
            if progress.total_bytes > 0
            else 0
        )

        # Emit stage-specific progress
        emit_download_stage(
            model_name=model_name,
            stage=stage,
            submodel_name=submodel_name,
            current=progress.downloaded_bytes,
            total=progress.total_bytes,
            percent=percent,
            speed_mb_s=progress.speed_bytes_per_sec / (1024 * 1024)
            if progress.speed_bytes_per_sec > 0
            else 0,
        )
    else:
        # Emit in the format expected by the Rust backend (single-stage download)
        # Note: emit_download_progress calculates percent internally from current/total
        emit_download_progress(
            current=progress.downloaded_bytes,  # Pass in bytes
            total=progress.total_bytes,  # Pass in bytes
            speed_mb_s=progress.speed_bytes_per_sec / (1024 * 1024)
            if progress.speed_bytes_per_sec > 0
            else 0,
        )


def main():
    """Main entry point."""
    args = parse_args()

    # Debug: log all arguments immediately
    print(
        json.dumps(
            {
                "type": "debug",
                "message": "Python process started",
                "sys_argv": sys.argv,
                "parsed_args": {
                    "download_model": args.download_model,
                    "cache_dir": args.cache_dir,
                    "model_type": args.model_type,
                    "command": args.command,
                },
            }
        ),
        flush=True,
        file=sys.stderr,
    )

    # Download model mode
    if args.download_model:
        if not args.cache_dir:
            emit_error("--cache-dir is required for --download-model")
            return 1

        print(
            json.dumps({"type": "debug", "message": "About to call download_model"}),
            flush=True,
        )
        download_model(
            args.download_model, args.cache_dir, args.model_type, args.token_file
        )
        print(
            json.dumps(
                {"type": "debug", "message": "download_model returned, exiting main()"}
            ),
            flush=True,
        )
        sys.stdout.flush()
        return 0

    # List models mode
    if args.list_models:
        if not args.cache_dir:
            emit_error("--cache-dir is required for --list-models")
            return 1

        list_models(args.cache_dir)
        return 0

    # Validate models mode
    if args.validate_models is not None:
        if not args.cache_dir:
            emit_error("--cache-dir is required for --validate-models")
            return 1

        validate_models(
            args.cache_dir, args.validate_models if args.validate_models else None
        )
        return 0

    # Delete model mode
    if args.delete_model:
        if not args.cache_dir:
            emit_error("--cache-dir is required for --delete-model")
            return 1

        delete_model(args.delete_model, args.cache_dir)
        return 0

    # Cancel download mode
    if args.cancel_download:
        cancel_model_download(args.cancel_download)
        return 0

    # Setup wizard command mode
    if args.command:
        if args.command == "check_python":
            result = check_python_environment()
            print(json.dumps(result), flush=True)
            return 0
        elif args.command == "check_ffmpeg":
            result = check_ffmpeg()
            print(json.dumps(result), flush=True)
            return 0
        elif args.command == "check_models":
            result = check_models(args.cache_dir)
            print(json.dumps(result), flush=True)
            return 0
        elif args.command == "check_environment":
            result = get_full_environment_status(args.cache_dir)
            print(json.dumps(result), flush=True)
            return 0

    # Test mode - just verify the engine works
    if args.test:
        print(
            json.dumps(
                {
                    "type": "hello",
                    "message": "Hello from AI Engine!",
                    "version": "0.1.0",
                    "python_version": sys.version,
                }
            ),
            flush=True,
        )
        return 0

    # Server mode - listen for JSON commands on stdin
    if args.server:
        return run_server_mode()

    # Validate input file
    if not args.file:
        emit_error("--file argument is required")
        return 1

    file_path = Path(args.file)
    if not file_path.exists():
        emit_error(f"File not found: {args.file}")
        return 1

    # CRITICAL: Set HuggingFace token from environment for CLI mode diarization
    # Rust backend sets HF_TOKEN and HUGGINGFACE_ACCESS_TOKEN as env vars
    # This is required for pyannote diarization to work
    huggingface_token = os.environ.get("HF_TOKEN") or os.environ.get(
        "HUGGINGFACE_ACCESS_TOKEN"
    )
    if huggingface_token:
        os.environ["HF_TOKEN"] = huggingface_token
        os.environ["HUGGINGFACE_ACCESS_TOKEN"] = huggingface_token
        print(
            json.dumps(
                {
                    "type": "debug",
                    "message": "HuggingFace token loaded from environment",
                }
            ),
            flush=True,
        )

    # Validate diarization provider
    if args.diarization and args.diarization_provider == "none":
        emit_error(
            "Diarization is enabled but diarization_provider is set to 'none'. Please specify 'pyannote' or 'sherpa-onnx'"
        )
        return 1

    try:
        # Initialize the model (from pool or create new)
        emit_progress("loading", 0, f"Loading {args.model} model...")

        model = model_pool.get_model(
            model_name=args.model,
            device=args.device,
            download_root=args.cache_dir,
            diarization_provider=args.diarization_provider
            if args.diarization
            else "none",
            num_speakers=args.num_speakers,
            vad_provider=args.diarization_provider if args.diarization else "none",
        )

        emit_progress("loading", 20, "Model loaded successfully")

        # Enable interval-based transcription if diarization is planned
        if args.diarization and hasattr(model, "enable_diarization_mode"):
            print(
                json.dumps(
                    {
                        "type": "debug",
                        "message": "Enabling interval-based transcription for diarization",
                    }
                ),
                flush=True,
                file=sys.stderr,
            )
            model.enable_diarization_mode()

        # Run transcription
        emit_progress("transcribing", 25, "Starting transcription...")

        segments = model.transcribe(
            file_path=str(file_path),
            language=args.language if args.language != "auto" else None,
        )

        emit_progress("transcribing", 80, "Transcription complete")

        # Run diarization if requested
        speaker_turns = None
        speaker_segments = None

        if args.diarization:
            emit_progress("diarizing", 85, "Running speaker diarization...")

            # Run diarization - returns tuple of (segments, speaker_turns)
            segments, speaker_turns_raw = model.diarize(segments, str(file_path))

            # Convert SpeakerTurn objects to dictionaries for JSON serialization
            if speaker_turns_raw:
                speaker_turns = [
                    {"speaker": turn.speaker, "start": turn.start, "end": turn.end}
                    for turn in speaker_turns_raw
                ]

                # Create speaker segments - either via split_by_speakers or use segments directly
                if hasattr(model, "split_by_speakers"):
                    speaker_segments = model.split_by_speakers(segments, speaker_turns)
                else:
                    # Fallback: use segments with speaker labels as speaker_segments
                    speaker_segments = segments

            emit_progress("diarizing", 95, "Diarization complete")

        # Finalize and emit result
        emit_progress("finalizing", 98, "Preparing output...")
        emit_result(
            segments,
            language=args.language,
            speaker_turns=speaker_turns,
            speaker_segments=speaker_segments,
        )
        emit_progress("finalizing", 100, "Done!")

        return 0

    except Exception as e:
        emit_error(str(e))
        return 1


if __name__ == "__main__":
    sys.exit(main())

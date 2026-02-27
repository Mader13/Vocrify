"""Thin download service facade.

This module keeps the public API expected by `main.py` while delegating
all heavy download logic to `downloader.py`.
"""

from __future__ import annotations

import os
import re

from ipc_events import emit_error, emit_progress
from logger import logger

__all__ = ["download_model", "cancel_model_download"]

# Security constants for model name validation
VALID_MODEL_NAME = re.compile(r"^[a-zA-Z0-9_.-]+$")


def validate_model_name(model_name: str) -> str:
    """Validate model name to prevent path traversal attacks."""
    if not VALID_MODEL_NAME.match(model_name):
        raise ValueError(
            f"Invalid model name: {model_name}\n"
            "Model names must contain only letters, numbers, underscores, dots, and hyphens"
        )
    return model_name


def validate_cache_dir(cache_dir: str) -> bool:
    """Validate cache directory exists and is writable."""
    try:
        if not os.path.exists(cache_dir):
            os.makedirs(cache_dir, exist_ok=True)

        test_file = os.path.join(cache_dir, ".write_test.tmp")
        with open(test_file, "w", encoding="utf-8") as f:
            f.write("ok")
        os.remove(test_file)
        return True
    except OSError as e:
        emit_error(f"Cache directory is not writable: {str(e)}")
        return False
    except Exception as e:
        emit_error(f"Cache validation error: {str(e)}")
        return False


def cancel_model_download(model_name: str) -> None:
    """Emit cancellation event.

    Note: underlying downloader currently does not expose a global cancellation
    handle in this process boundary, so we preserve existing IPC behavior.
    """
    logger.info(f"Cancellation requested for model download: {model_name}")
    emit_progress("cancelled", 0, f"Download cancelled for {model_name}")


def download_model(
    model_name: str,
    cache_dir: str,
    model_type: str,
    token_file: str | None = None,
) -> None:
    """Download model with pre-validation and delegated implementation."""
    # Import lazily so non-download commands (e.g. --delete-model) do not require
    # optional downloader dependencies at process startup.
    from downloader import download_model as downloader_download_model

    try:
        safe_model_name = validate_model_name(model_name)
    except ValueError as e:
        emit_error(str(e))
        return

    if not validate_cache_dir(cache_dir):
        return

    try:
        downloader_download_model(
            model_name=safe_model_name,
            cache_dir=cache_dir,
            model_type=model_type,
            token_file=token_file,
        )
    except Exception as e:
        # Keep backward-compatible error event shape for UI consumers.
        logger.error(f"Download failed: {e}", exc=e)
        emit_error(f"Download failed: {str(e)}")

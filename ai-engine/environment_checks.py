"""Environment checks extracted from main.py.

This module keeps JSON response semantics compatible with existing setup wizard flows.
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
from typing import Any, Optional

from model_config import get_model_size_mb
from utils.ffmpeg_utils import (
    get_windows_path_from_registry as _get_windows_path_from_registry,
    find_ffmpeg_in_paths as _find_ffmpeg_in_paths,
    check_ffmpeg_executable as _check_ffmpeg_executable,
    find_ffmpeg,
)

SUPPORTED_PYTHON_VERSIONS = [(3, 10), (3, 11), (3, 12), (3, 13), (3, 14)]


def check_python_environment() -> dict[str, Any]:
    """Check Python environment for Setup Wizard."""
    try:
        version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        executable = sys.executable
        in_venv = hasattr(sys, "real_prefix") or (
            hasattr(sys, "base_prefix") and sys.base_prefix != sys.prefix
        )

        version_tuple = (sys.version_info.major, sys.version_info.minor)
        version_supported = version_tuple in SUPPORTED_PYTHON_VERSIONS

        if not version_supported:
            if version_tuple >= (3, 15):
                status = "error"
                message = f"Python {version} is not supported. Requires Python 3.10-3.14."
            else:
                status = "warning"
                message = f"Python {version} is not officially tested. Recommended 3.10-3.14."
        else:
            status = "ok"
            message = f"Python {version} is installed."

        return {
            "status": status,
            "version": version,
            "executable": executable,
            "in_venv": in_venv,
            "message": message,
        }

    except Exception as e:
        return {
            "status": "error",
            "version": None,
            "executable": None,
            "in_venv": False,
            "message": f"Error while checking Python: {str(e)}",
        }


# _get_windows_path_from_registry, _find_ffmpeg_in_paths, _check_ffmpeg_executable
# are now imported from utils.ffmpeg_utils (see top of file).


def check_ffmpeg() -> dict[str, Any]:
    """Check FFmpeg installation for Setup Wizard."""
    try:
        ffmpeg_path, search_locations = find_ffmpeg()

        if not ffmpeg_path:
            return {
                "status": "error",
                "installed": False,
                "path": None,
                "version": None,
                "message": "FFmpeg ÃƒÂÃ‚Â½ÃƒÂÃ‚Âµ ÃƒÂÃ‚Â½ÃƒÂÃ‚Â°ÃƒÂÃ‚Â¹ÃƒÂÃ‚Â´ÃƒÂÃ‚ÂµÃƒÂÃ‚Â½. ÃƒÂÃ‚Â£Ãƒâ€˜Ã‚ÂÃƒâ€˜Ã¢â‚¬Å¡ÃƒÂÃ‚Â°ÃƒÂÃ‚Â½ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â²ÃƒÂÃ‚Â¸Ãƒâ€˜Ã¢â‚¬Å¡ÃƒÂÃ‚Âµ FFmpeg ÃƒÂÃ‚Â´ÃƒÂÃ‚Â»Ãƒâ€˜Ã‚Â Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â°ÃƒÂÃ‚Â±ÃƒÂÃ‚Â¾Ãƒâ€˜Ã¢â‚¬Å¡Ãƒâ€˜Ã¢â‚¬Â¹ Ãƒâ€˜Ã‚Â ÃƒÂÃ‚Â²ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â´ÃƒÂÃ‚ÂµÃƒÂÃ‚Â¾/ÃƒÂÃ‚Â°Ãƒâ€˜Ã†â€™ÃƒÂÃ‚Â´ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â¾.",
            }

        # Verify executable and get version
        is_valid, version = _check_ffmpeg_executable(ffmpeg_path)

        if not is_valid:
            return {
                "status": "error",
                "installed": False,
                "path": ffmpeg_path,
                "version": None,
                "message": f"FFmpeg ÃƒÂÃ‚Â½ÃƒÂÃ‚Â°ÃƒÂÃ‚Â¹ÃƒÂÃ‚Â´ÃƒÂÃ‚ÂµÃƒÂÃ‚Â½ ({ffmpeg_path}), ÃƒÂÃ‚Â½ÃƒÂÃ‚Â¾ ÃƒÂÃ‚Â½ÃƒÂÃ‚Âµ ÃƒÂÃ‚Â·ÃƒÂÃ‚Â°ÃƒÂÃ‚Â¿Ãƒâ€˜Ã†â€™Ãƒâ€˜Ã‚ÂÃƒÂÃ‚ÂºÃƒÂÃ‚Â°ÃƒÂÃ‚ÂµÃƒâ€˜Ã¢â‚¬Å¡Ãƒâ€˜Ã‚ÂÃƒâ€˜Ã‚Â. ÃƒÂÃ…Â¸Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â²ÃƒÂÃ‚ÂµÃƒâ€˜Ã¢â€šÂ¬Ãƒâ€˜Ã…â€™Ãƒâ€˜Ã¢â‚¬Å¡ÃƒÂÃ‚Âµ ÃƒÂÃ‚Â¿Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â°ÃƒÂÃ‚Â²ÃƒÂÃ‚Â° ÃƒÂÃ‚Â´ÃƒÂÃ‚Â¾Ãƒâ€˜Ã‚ÂÃƒâ€˜Ã¢â‚¬Å¡Ãƒâ€˜Ã†â€™ÃƒÂÃ‚Â¿ÃƒÂÃ‚Â° ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â»ÃƒÂÃ‚Â¸ ÃƒÂÃ‚Â¿ÃƒÂÃ‚ÂµÃƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚ÂµÃƒâ€˜Ã†â€™Ãƒâ€˜Ã‚ÂÃƒâ€˜Ã¢â‚¬Å¡ÃƒÂÃ‚Â°ÃƒÂÃ‚Â½ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â²ÃƒÂÃ‚Â¸Ãƒâ€˜Ã¢â‚¬Å¡ÃƒÂÃ‚Âµ.",
            }

        if version is None:
            return {
                "status": "warning",
                "installed": True,
                "path": ffmpeg_path,
                "version": None,
                "message": f"FFmpeg ÃƒÂÃ‚Â½ÃƒÂÃ‚Â°ÃƒÂÃ‚Â¹ÃƒÂÃ‚Â´ÃƒÂÃ‚ÂµÃƒÂÃ‚Â½ ({ffmpeg_path}), ÃƒÂÃ‚Â½ÃƒÂÃ‚Â¾ ÃƒÂÃ‚Â½ÃƒÂÃ‚Âµ Ãƒâ€˜Ã†â€™ÃƒÂÃ‚Â´ÃƒÂÃ‚Â°ÃƒÂÃ‚Â»ÃƒÂÃ‚Â¾Ãƒâ€˜Ã‚ÂÃƒâ€˜Ã…â€™ ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â¿Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚ÂµÃƒÂÃ‚Â´ÃƒÂÃ‚ÂµÃƒÂÃ‚Â»ÃƒÂÃ‚Â¸Ãƒâ€˜Ã¢â‚¬Å¡Ãƒâ€˜Ã…â€™ ÃƒÂÃ‚Â²ÃƒÂÃ‚ÂµÃƒâ€˜Ã¢â€šÂ¬Ãƒâ€˜Ã‚ÂÃƒÂÃ‚Â¸Ãƒâ€˜Ã…Â½.",
            }

        return {
            "status": "ok",
            "installed": True,
            "path": ffmpeg_path,
            "version": version,
            "message": f"FFmpeg {version} ÃƒÂÃ‚Â½ÃƒÂÃ‚Â°ÃƒÂÃ‚Â¹ÃƒÂÃ‚Â´ÃƒÂÃ‚ÂµÃƒÂÃ‚Â½: {ffmpeg_path}",
        }

    except Exception as e:
        return {
            "status": "error",
            "installed": False,
            "path": None,
            "version": None,
            "message": f"ÃƒÂÃ…Â¾Ãƒâ€˜Ã‹â€ ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â±ÃƒÂÃ‚ÂºÃƒÂÃ‚Â° ÃƒÂÃ‚Â¿Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â¸ ÃƒÂÃ‚Â¿Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â²ÃƒÂÃ‚ÂµÃƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚ÂºÃƒÂÃ‚Âµ FFmpeg: {str(e)}",
        }


def check_models(cache_dir: Optional[str] = None) -> dict[str, Any]:
    """Check installed AI models for Setup Wizard."""
    try:
        if not cache_dir:
            cache_dir = os.path.join(
                os.path.expanduser("~"), ".cache", "transcribe-video"
            )

        installed_models = []

        if not os.path.exists(cache_dir):
            return {
                "status": "warning",
                "installedModels": [],
                "hasRequiredModel": False,
                "message": f"Models directory does not exist: {cache_dir}",
            }

        skip_individual = {
            "sherpa-onnx-segmentation",
            "sherpa-onnx-embedding",
        }

        for model_name in os.listdir(cache_dir):
            model_path = os.path.join(cache_dir, model_name)
            if not os.path.isdir(model_path):
                continue
            if model_name in skip_individual:
                continue

            size_mb = get_model_size_mb(model_path)

            if model_name.startswith("whisper-"):
                model_type = "whisper"
            elif model_name.startswith("parakeet-"):
                model_type = "parakeet"
            elif model_name.startswith("distil-"):
                model_type = "whisper"
            else:
                continue

            installed_models.append(
                {
                    "name": model_name,
                    "sizeMb": size_mb,
                    "modelType": model_type,
                    "installed": True,
                    "path": model_path,
                }
            )

        seg_path = os.path.join(cache_dir, "sherpa-onnx-segmentation")
        emb_path = os.path.join(cache_dir, "sherpa-onnx-embedding")
        if os.path.exists(seg_path) and os.path.exists(emb_path):
            total_size = get_model_size_mb(seg_path) + get_model_size_mb(emb_path)
            installed_models.append(
                {
                    "name": "sherpa-onnx-diarization",
                    "sizeMb": total_size,
                    "modelType": "diarization",
                    "installed": True,
                    "path": None,
                }
            )

        transcription_models = [
            m for m in installed_models if m["modelType"] in ("whisper", "parakeet")
        ]
        has_required = len(transcription_models) > 0

        if not installed_models:
            status = "warning"
            message = (
                "No models are installed. "
                "Install at least one transcription model (for example: whisper-base)."
            )
        elif not has_required:
            status = "warning"
            message = (
                f"Installed models: {len(installed_models)}. "
                "No transcription model was found."
            )
        else:
            status = "ok"
            model_names = [m["name"] for m in transcription_models]
            suffix = "..." if len(model_names) > 3 else ""
            message = (
                f"Installed models: {len(installed_models)} "
                f"({', '.join(model_names[:3])}{suffix})"
            )

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
            "message": f"Error while checking models: {str(e)}",
        }


def get_full_environment_status(cache_dir: Optional[str] = None) -> dict[str, Any]:
    """Get complete environment status for Setup Wizard."""
    try:
        python_result = check_python_environment()
        ffmpeg_result = check_ffmpeg()
        models_result = check_models(cache_dir)

        devices_result = {
            "status": "error",
            "devices": [],
            "recommended": None,
            "message": "",
        }
        try:
            from dataclasses import asdict
            from device_detection import detect_all_devices, get_recommended_device

            devices = detect_all_devices()
            recommended = get_recommended_device(devices)

            devices_result = {
                "status": "ok",
                "devices": [asdict(d) for d in devices],
                "recommended": asdict(recommended),
                "message": f"ÃƒÂÃ¢â‚¬ÂÃƒÂÃ‚Â¾Ãƒâ€˜Ã‚ÂÃƒâ€˜Ã¢â‚¬Å¡Ãƒâ€˜Ã†â€™ÃƒÂÃ‚Â¿ÃƒÂÃ‚Â½ÃƒÂÃ‚Â¾ Ãƒâ€˜Ã†â€™Ãƒâ€˜Ã‚ÂÃƒâ€˜Ã¢â‚¬Å¡Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â¹Ãƒâ€˜Ã‚ÂÃƒâ€˜Ã¢â‚¬Å¡ÃƒÂÃ‚Â²: {len(devices)}",
            }
        except Exception as e:
            devices_result = {
                "status": "error",
                "devices": [],
                "recommended": None,
                "message": f"ÃƒÂÃ…Â¾Ãƒâ€˜Ã‹â€ ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â±ÃƒÂÃ‚ÂºÃƒÂÃ‚Â° ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â¿Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚ÂµÃƒÂÃ‚Â´ÃƒÂÃ‚ÂµÃƒÂÃ‚Â»ÃƒÂÃ‚ÂµÃƒÂÃ‚Â½ÃƒÂÃ‚Â¸Ãƒâ€˜Ã‚Â Ãƒâ€˜Ã†â€™Ãƒâ€˜Ã‚ÂÃƒâ€˜Ã¢â‚¬Å¡Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â¹Ãƒâ€˜Ã‚ÂÃƒâ€˜Ã¢â‚¬Å¡ÃƒÂÃ‚Â²: {str(e)}",
            }

        statuses = [
            python_result["status"],
            ffmpeg_result["status"],
            models_result["status"],
            devices_result["status"],
        ]

        if "error" in statuses:
            overall_status = "error"
            error_count = statuses.count("error")
            message = f"ÃƒÂÃ…Â¾ÃƒÂÃ‚Â±ÃƒÂÃ‚Â½ÃƒÂÃ‚Â°Ãƒâ€˜Ã¢â€šÂ¬Ãƒâ€˜Ã†â€™ÃƒÂÃ‚Â¶ÃƒÂÃ‚ÂµÃƒÂÃ‚Â½ÃƒÂÃ‚Â¾ {error_count} ÃƒÂÃ‚Â¿Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â±ÃƒÂÃ‚Â»ÃƒÂÃ‚ÂµÃƒÂÃ‚Â¼(Ãƒâ€˜Ã¢â‚¬Â¹). ÃƒÂÃ‚Â¢Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚ÂµÃƒÂÃ‚Â±Ãƒâ€˜Ã†â€™ÃƒÂÃ‚ÂµÃƒâ€˜Ã¢â‚¬Å¡Ãƒâ€˜Ã‚ÂÃƒâ€˜Ã‚Â ÃƒÂÃ‚Â²ÃƒÂÃ‚Â½ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â¼ÃƒÂÃ‚Â°ÃƒÂÃ‚Â½ÃƒÂÃ‚Â¸ÃƒÂÃ‚Âµ."
        elif "warning" in statuses:
            overall_status = "warning"
            message = "ÃƒÂÃ‚Â¡Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚ÂµÃƒÂÃ‚Â´ÃƒÂÃ‚Â° ÃƒÂÃ‚Â½ÃƒÂÃ‚Â°Ãƒâ€˜Ã‚ÂÃƒâ€˜Ã¢â‚¬Å¡Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â¾ÃƒÂÃ‚ÂµÃƒÂÃ‚Â½ÃƒÂÃ‚Â° Ãƒâ€˜Ã‚Â ÃƒÂÃ‚Â¿Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚ÂµÃƒÂÃ‚Â´Ãƒâ€˜Ã†â€™ÃƒÂÃ‚Â¿Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚ÂµÃƒÂÃ‚Â¶ÃƒÂÃ‚Â´ÃƒÂÃ‚ÂµÃƒÂÃ‚Â½ÃƒÂÃ‚Â¸Ãƒâ€˜Ã‚ÂÃƒÂÃ‚Â¼ÃƒÂÃ‚Â¸."
        else:
            overall_status = "ok"
            message = "ÃƒÂÃ¢â‚¬â„¢Ãƒâ€˜Ã‚ÂÃƒÂÃ‚Âµ ÃƒÂÃ‚ÂºÃƒÂÃ‚Â¾ÃƒÂÃ‚Â¼ÃƒÂÃ‚Â¿ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â½ÃƒÂÃ‚ÂµÃƒÂÃ‚Â½Ãƒâ€˜Ã¢â‚¬Å¡Ãƒâ€˜Ã¢â‚¬Â¹ Ãƒâ€˜Ã†â€™Ãƒâ€˜Ã‚ÂÃƒâ€˜Ã¢â‚¬Å¡ÃƒÂÃ‚Â°ÃƒÂÃ‚Â½ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â²ÃƒÂÃ‚Â»ÃƒÂÃ‚ÂµÃƒÂÃ‚Â½Ãƒâ€˜Ã¢â‚¬Â¹ ÃƒÂÃ‚Â¸ ÃƒÂÃ‚Â½ÃƒÂÃ‚Â°Ãƒâ€˜Ã‚ÂÃƒâ€˜Ã¢â‚¬Å¡Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â¾ÃƒÂÃ‚ÂµÃƒÂÃ‚Â½Ãƒâ€˜Ã¢â‚¬Â¹."

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
                "message": f"ÃƒÂÃ…Â¾Ãƒâ€˜Ã‹â€ ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â±ÃƒÂÃ‚ÂºÃƒÂÃ‚Â°: {str(e)}",
            },
            "ffmpeg": {
                "status": "error",
                "installed": False,
                "path": None,
                "version": None,
                "message": f"ÃƒÂÃ…Â¾Ãƒâ€˜Ã‹â€ ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â±ÃƒÂÃ‚ÂºÃƒÂÃ‚Â°: {str(e)}",
            },
            "models": {
                "status": "error",
                "installedModels": [],
                "hasRequiredModel": False,
                "message": f"ÃƒÂÃ…Â¾Ãƒâ€˜Ã‹â€ ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â±ÃƒÂÃ‚ÂºÃƒÂÃ‚Â°: {str(e)}",
            },
            "devices": {
                "status": "error",
                "devices": [],
                "recommended": None,
                "message": f"ÃƒÂÃ…Â¾Ãƒâ€˜Ã‹â€ ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â±ÃƒÂÃ‚ÂºÃƒÂÃ‚Â°: {str(e)}",
            },
            "overallStatus": "error",
            "message": f"ÃƒÂÃ…Â¡Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â¸Ãƒâ€˜Ã¢â‚¬Å¡ÃƒÂÃ‚Â¸Ãƒâ€˜Ã¢â‚¬Â¡ÃƒÂÃ‚ÂµÃƒâ€˜Ã‚ÂÃƒÂÃ‚ÂºÃƒÂÃ‚Â°Ãƒâ€˜Ã‚Â ÃƒÂÃ‚Â¾Ãƒâ€˜Ã‹â€ ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â±ÃƒÂÃ‚ÂºÃƒÂÃ‚Â° ÃƒÂÃ‚Â¿Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â¸ ÃƒÂÃ‚Â¿Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â²ÃƒÂÃ‚ÂµÃƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚ÂºÃƒÂÃ‚Âµ ÃƒÂÃ‚Â¾ÃƒÂÃ‚ÂºÃƒâ€˜Ã¢â€šÂ¬Ãƒâ€˜Ã†â€™ÃƒÂÃ‚Â¶ÃƒÂÃ‚ÂµÃƒÂÃ‚Â½ÃƒÂÃ‚Â¸Ãƒâ€˜Ã‚Â: {str(e)}",
        }



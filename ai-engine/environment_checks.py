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
                "message": "FFmpeg not found. Install FFmpeg to work with video/audio files.",
            }

        # Verify executable and get version
        is_valid, version = _check_ffmpeg_executable(ffmpeg_path)

        if not is_valid:
            return {
                "status": "error",
                "installed": False,
                "path": ffmpeg_path,
                "version": None,
                "message": f"FFmpeg found at {ffmpeg_path}, but it is not executable. Check permissions or reinstall FFmpeg.",
            }

        if version is None:
            return {
                "status": "warning",
                "installed": True,
                "path": ffmpeg_path,
                "version": None,
                "message": f"FFmpeg found at {ffmpeg_path}, but version could not be determined.",
            }

        return {
            "status": "ok",
            "installed": True,
            "path": ffmpeg_path,
            "version": version,
            "message": f"FFmpeg {version} found: {ffmpeg_path}",
        }

    except Exception as e:
        return {
            "status": "error",
            "installed": False,
            "path": None,
            "version": None,
            "message": f"Error while checking FFmpeg: {str(e)}",
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
                "message": f"Devices detected: {len(devices)}",
            }
        except Exception as e:
            devices_result = {
                "status": "error",
                "devices": [],
                "recommended": None,
                "message": f"Error during device detection: {str(e)}",
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
            message = f"Detected {error_count} setup issue(s). Please review the details."
        elif "warning" in statuses:
            overall_status = "warning"
            message = "Setup completed with warnings."
        else:
            overall_status = "ok"
            message = "All components are installed and configured."

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
                "message": f"Error: {str(e)}",
            },
            "ffmpeg": {
                "status": "error",
                "installed": False,
                "path": None,
                "version": None,
                "message": f"Error: {str(e)}",
            },
            "models": {
                "status": "error",
                "installedModels": [],
                "hasRequiredModel": False,
                "message": f"Error: {str(e)}",
            },
            "devices": {
                "status": "error",
                "devices": [],
                "recommended": None,
                "message": f"Error: {str(e)}",
            },
            "overallStatus": "error",
            "message": f"Critical error while checking environment: {str(e)}",
        }



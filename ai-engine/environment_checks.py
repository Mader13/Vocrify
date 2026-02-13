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

SUPPORTED_PYTHON_VERSIONS = [(3, 10), (3, 11), (3, 12)]


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

        pytorch_installed = False
        pytorch_version = None
        cuda_available = False
        mps_available = False

        try:
            import torch

            pytorch_installed = True
            pytorch_version = torch.__version__
            cuda_available = torch.cuda.is_available()
            if hasattr(torch.backends, "mps"):
                mps_available = torch.backends.mps.is_available()
        except ImportError:
            pass

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
    """Check FFmpeg installation for Setup Wizard."""
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

        try:
            use_shell = platform.system() == "Windows"
            result = subprocess.run(
                [ffmpeg_path, "-version"],
                capture_output=True,
                text=True,
                timeout=10,
                shell=use_shell,
            )

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
                "message": f"Директория моделей не существует: {cache_dir}",
            }

        skip_individual = {
            "pyannote-segmentation-3.0",
            "pyannote-embedding-3.0",
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
                    "size_mb": size_mb,
                    "model_type": model_type,
                    "installed": True,
                    "path": model_path,
                }
            )

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
                    "path": None,
                }
            )

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
                    "path": None,
                }
            )

        transcription_models = [
            m for m in installed_models if m["model_type"] in ("whisper", "parakeet")
        ]
        has_required = len(transcription_models) > 0

        if not installed_models:
            status = "warning"
            message = "Модели не установлены. Рекомендуется скачать whisper-base."
        elif not has_required:
            status = "warning"
            message = (
                f"Установлено {len(installed_models)} моделей, но нет моделей транскрипции."
            )
        else:
            status = "ok"
            model_names = [m["name"] for m in transcription_models]
            suffix = "..." if len(model_names) > 3 else ""
            message = (
                f"Установлено моделей: {len(installed_models)} "
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
            "message": f"Ошибка при проверке моделей: {str(e)}",
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
                "message": f"Доступно устройств: {len(devices)}",
            }
        except Exception as e:
            devices_result = {
                "status": "error",
                "devices": [],
                "recommended": None,
                "message": f"Ошибка определения устройств: {str(e)}",
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

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

SUPPORTED_PYTHON_VERSIONS = [(3, 10), (3, 11), (3, 12), (3, 13), (3, 14)]


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

        if not version_supported:
            if version_tuple >= (3, 13):
                status = "error"
                message = f"Python {version} НЕ поддерживается. Требуется Python 3.10, 3.11 или 3.12."
            else:
                status = "warning"
                message = f"Python {version} не тестировался. Рекомендуется 3.10, 3.11 или 3.12."
        else:
            status = "ok"
            message = f"Python {version} установлен."

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
            "message": f"Ошибка при проверке Python: {str(e)}",
        }


def _get_windows_path_from_registry() -> list[str]:
    """Read PATH from Windows registry (HKCU and HKLM)."""
    if platform.system() != "Windows":
        return []

    try:
        import winreg
    except ImportError:
        return []

    paths: list[str] = []

    # Registry keys to check
    keys_to_check = [
        (winreg.HKEY_CURRENT_USER, r"Environment"),
        (
            winreg.HKEY_LOCAL_MACHINE,
            r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
        ),
    ]

    for hkey, subkey in keys_to_check:
        try:
            with winreg.OpenKey(hkey, subkey, 0, winreg.KEY_READ) as key:
                try:
                    value, _ = winreg.QueryValueEx(key, "Path")
                    if value and isinstance(value, str):
                        paths.extend(value.split(os.pathsep))
                except FileNotFoundError:
                    pass
        except Exception:
            pass

    return paths


def _find_ffmpeg_in_paths(paths: list[str]) -> str | None:
    """Find ffmpeg.exe in a list of paths."""
    for path in paths:
        if not path:
            continue
        # Expand environment variables (e.g., %LOCALAPPDATA%)
        try:
            expanded = os.path.expandvars(path)
        except Exception:
            expanded = path

        # Clean quotes
        expanded = expanded.strip('"').strip("'")

        if not os.path.isdir(expanded):
            continue

        # Check for ffmpeg.exe directly in this path
        ffmpeg_candidate = os.path.join(expanded, "ffmpeg.exe")
        if os.path.isfile(ffmpeg_candidate):
            return ffmpeg_candidate

        # Also check bin subdirectory (common for many installs)
        bin_candidate = os.path.join(expanded, "bin", "ffmpeg.exe")
        if os.path.isfile(bin_candidate):
            return bin_candidate

    return None


def _check_ffmpeg_executable(ffmpeg_path: str) -> tuple[bool, str | None]:
    """Check if ffmpeg is executable and get version. Returns (success, version)."""
    try:
        # Don't use shell=True - it's unreliable and hides errors
        result = subprocess.run(
            [ffmpeg_path, "-version"],
            capture_output=True,
            text=True,
            timeout=10,
            shell=False,
        )

        if result.returncode != 0:
            return False, None

        version_line = result.stdout.split("\n")[0] if result.stdout else ""
        parts = version_line.split()
        version = None
        if len(parts) >= 3 and "ffmpeg" in parts[0].lower():
            version = parts[2]

        return True, version
    except subprocess.TimeoutExpired:
        return True, None  # Found but timeout - treat as found
    except FileNotFoundError:
        return False, None  # Not executable
    except Exception:
        return True, None  # Found but error getting version


def check_ffmpeg() -> dict[str, Any]:
    """Check FFmpeg installation for Setup Wizard.

    Searches in order:
    1. shutil.which() - standard PATH lookup
    2. Windows registry PATH (HKCU/HKLM)
    3. Winget links directory (%LOCALAPPDATA%\\Microsoft\\WinGet\\Links)
    4. App-managed FFmpeg (downloaded by app)
    """
    try:
        ffmpeg_path: str | None = None
        search_locations: list[str] = []

        # 1. Try shutil.which first (handles most normal cases)
        ffmpeg_path = shutil.which("ffmpeg")
        if ffmpeg_path:
            search_locations.append(f"shutil.which: {ffmpeg_path}")

        # 2. On Windows, also check registry PATH and winget links
        if not ffmpeg_path and platform.system() == "Windows":
            # Check registry PATH
            registry_paths = _get_windows_path_from_registry()
            if registry_paths:
                ffmpeg_path = _find_ffmpeg_in_paths(registry_paths)
                if ffmpeg_path:
                    search_locations.append(f"Windows Registry PATH: {ffmpeg_path}")

            # Check winget links directory (where winget installs apps)
            if not ffmpeg_path:
                local_app_data = os.environ.get("LOCALAPPDATA", "")
                if local_app_data:
                    winget_links = os.path.join(
                        local_app_data, "Microsoft", "WinGet", "Links"
                    )
                    if os.path.isdir(winget_links):
                        winget_ffmpeg = os.path.join(winget_links, "ffmpeg.exe")
                        if os.path.isfile(winget_ffmpeg):
                            ffmpeg_path = winget_ffmpeg
                            search_locations.append(f"Winget links: {winget_ffmpeg}")

        # 3. Check app-managed FFmpeg (downloaded by this app)
        if not ffmpeg_path:
            app_data = os.environ.get("APPDATA", "")
            if app_data:
                downloaded_ffmpeg = os.path.join(
                    app_data, "com.vocrify.app", "Vocrify", "ffmpeg", "ffmpeg.exe"
                )
                if os.path.exists(downloaded_ffmpeg):
                    ffmpeg_path = downloaded_ffmpeg
                    search_locations.append(
                        f"App managed (APPDATA): {downloaded_ffmpeg}"
                    )

        # 4. Check LOCALAPPDATA as fallback (for development)
        if not ffmpeg_path:
            local_app_data = os.environ.get("LOCALAPPDATA", "")
            if local_app_data:
                downloaded_ffmpeg = os.path.join(
                    local_app_data,
                    "com.vocrify.app",
                    "Vocrify",
                    "ffmpeg",
                    "ffmpeg.exe",
                )
                if os.path.exists(downloaded_ffmpeg):
                    ffmpeg_path = downloaded_ffmpeg
                    search_locations.append(
                        f"App managed (LOCALAPPDATA): {downloaded_ffmpeg}"
                    )

        if not ffmpeg_path:
            return {
                "status": "error",
                "installed": False,
                "path": None,
                "version": None,
                "message": "FFmpeg не найден. Установите FFmpeg для работы с видео/аудио.",
            }

        # Verify executable and get version
        is_valid, version = _check_ffmpeg_executable(ffmpeg_path)

        if not is_valid:
            return {
                "status": "error",
                "installed": False,
                "path": ffmpeg_path,
                "version": None,
                "message": f"FFmpeg найден ({ffmpeg_path}), но не запускается. Проверьте права доступа или переустановите.",
            }

        if version is None:
            return {
                "status": "warning",
                "installed": True,
                "path": ffmpeg_path,
                "version": None,
                "message": f"FFmpeg найден ({ffmpeg_path}), но не удалось определить версию.",
            }

        return {
            "status": "ok",
            "installed": True,
            "path": ffmpeg_path,
            "version": version,
            "message": f"FFmpeg {version} найден: {ffmpeg_path}",
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

        installed_models: list[dict[str, Any]] = []

        if not os.path.exists(cache_dir):
            return {
                "status": "warning",
                "installedModels": [],
                "hasRequiredModel": False,
                "message": f"Директория моделей не существует: {cache_dir}",
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
                    "size_mb": size_mb,
                    "model_type": model_type,
                    "installed": True,
                    "path": model_path,
                }
            )

        seg_path = os.path.join(cache_dir, "sherpa-onnx-segmentation")
        emb_path = os.path.join(cache_dir, "sherpa-onnx-embedding")
        if os.path.exists(seg_path) and os.path.exists(emb_path):
            total_size_mb = get_model_size_mb(seg_path) + get_model_size_mb(emb_path)
            installed_models.append(
                {
                    "name": "sherpa-onnx-diarization",
                    "size_mb": total_size_mb,
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
            message = f"Установлено {len(installed_models)} моделей, но нет моделей транскрипции."
        else:
            status = "ok"
            names = [str(m["name"]) for m in transcription_models]
            suffix = "..." if len(names) > 3 else ""
            message = (
                f"Установлено моделей: {len(installed_models)} "
                f"({', '.join(names[:3])}{suffix})"
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
                "in_venv": False,
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

"""
Shared FFmpeg discovery utilities.

Single source of truth for finding ffmpeg on the system.
Used by both environment_checks.py and check_environment.py.
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
from typing import Any, Optional


def get_windows_path_from_registry() -> list[str]:
    """Read PATH from Windows registry (HKCU and HKLM)."""
    import winreg

    paths: list[str] = []

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
                    if value:
                        paths.extend(value.split(os.pathsep))
                except FileNotFoundError:
                    pass
        except Exception:
            pass

    return paths


def find_ffmpeg_in_paths(paths: list[str]) -> str | None:
    """Find ffmpeg.exe in a list of paths."""
    for path in paths:
        if not path:
            continue
        try:
            expanded = os.path.expandvars(path)
        except Exception:
            expanded = path

        expanded = expanded.strip('"').strip("'")

        if not os.path.isdir(expanded):
            continue

        ffmpeg_candidate = os.path.join(expanded, "ffmpeg.exe")
        if os.path.isfile(ffmpeg_candidate):
            return ffmpeg_candidate

        bin_candidate = os.path.join(expanded, "bin", "ffmpeg.exe")
        if os.path.isfile(bin_candidate):
            return bin_candidate

    return None


def check_ffmpeg_executable(ffmpeg_path: str) -> tuple[bool, str | None]:
    """Check if ffmpeg is executable and get version. Returns (success, version)."""
    try:
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


def find_ffmpeg() -> tuple[str | None, list[str]]:
    """
    Find ffmpeg on the system. Returns (ffmpeg_path, search_locations).

    Searches in order:
    1. shutil.which() — standard PATH lookup
    2. Windows registry PATH (HKCU/HKLM)
    3. Winget links directory (%LOCALAPPDATA%\\Microsoft\\WinGet\\Links)
    4. App-managed FFmpeg directories (APPDATA / LOCALAPPDATA)
    """
    ffmpeg_path: str | None = None
    search_locations: list[str] = []

    # 1. Try shutil.which first
    ffmpeg_path = shutil.which("ffmpeg")
    if ffmpeg_path:
        search_locations.append(f"shutil.which: {ffmpeg_path}")
        return ffmpeg_path, search_locations

    # 2. On Windows, check registry PATH and winget links
    if platform.system() == "Windows":
        registry_paths = get_windows_path_from_registry()
        if registry_paths:
            ffmpeg_path = find_ffmpeg_in_paths(registry_paths)
            if ffmpeg_path:
                search_locations.append(f"Windows Registry PATH: {ffmpeg_path}")
                return ffmpeg_path, search_locations

        # Check winget links directory
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
                    return ffmpeg_path, search_locations

    # 3. Check app-managed FFmpeg (APPDATA)
    app_data = os.environ.get("APPDATA", "")
    if app_data:
        downloaded_ffmpeg = os.path.join(
            app_data, "com.vocrify.app", "Vocrify", "ffmpeg", "ffmpeg.exe"
        )
        if os.path.exists(downloaded_ffmpeg):
            ffmpeg_path = downloaded_ffmpeg
            search_locations.append(f"App managed (APPDATA): {downloaded_ffmpeg}")
            return ffmpeg_path, search_locations

    # 4. Check LOCALAPPDATA as fallback
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    if local_app_data:
        downloaded_ffmpeg = os.path.join(
            local_app_data, "com.vocrify.app", "Vocrify", "ffmpeg", "ffmpeg.exe"
        )
        if os.path.exists(downloaded_ffmpeg):
            ffmpeg_path = downloaded_ffmpeg
            search_locations.append(
                f"App managed (LOCALAPPDATA): {downloaded_ffmpeg}"
            )
            return ffmpeg_path, search_locations

    return None, search_locations

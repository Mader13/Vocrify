#!/usr/bin/env python3
"""
Environment Check Script for Transcribe Video AI Engine

This script checks if the current Python environment is compatible
with the required dependencies.

Usage:
    python check_environment.py
"""

import sys
import os
import shutil
import subprocess
import importlib
from pathlib import Path

from utils.ffmpeg_utils import (
    get_windows_path_from_registry as _get_windows_path_from_registry,
    find_ffmpeg_in_paths as _find_ffmpeg_in_paths,
    find_ffmpeg,
    check_ffmpeg_executable,
)


def check_python_version():
    """Check if Python version is compatible."""
    print("=" * 70)
    print("Python Version Check")
    print("=" * 70)

    version = sys.version_info
    current = f"{version.major}.{version.minor}.{version.micro}"
    print(f"Current Python version: {current}")
    print(f"Python executable: {sys.executable}")

    if version.major == 3 and 8 <= version.minor <= 12:
        print("✅ Python version is COMPATIBLE (3.8-3.12)")
        return True
    else:
        print("❌ Python version is INCOMPATIBLE")
        print("   Required: Python 3.8-3.12")
        print("   Current: Python", current)

        if version.minor >= 13:
            print("\n⚠️  CRITICAL: Python 3.13+ is NOT supported")
            print("   Some packaged dependencies may not be available for 3.13+ yet.")
            print("\n📖 Solution:")
            print("   1. Install Python 3.12 from https://www.python.org/downloads/")
            print("   2. Create new venv: py -3.12 -m venv venv")
            print("   3. Activate: venv\\Scripts\\activate")
            print("   4. Install: pip install -r requirements.txt")

        return False


def check_dependencies():
    """Check if required dependencies are installed."""
    print("\n" + "=" * 70)
    print("Dependency Check")
    print("=" * 70)

    # Core dependencies for setup/model utilities
    core_deps = {
        "requests": "2.31.0",
        "tenacity": "8.5.0",
        "tqdm": "4.66.4",
        "jsonschema": "4.22.0",
        "packaging": "24.0",
        "psutil": "6.1.0",
    }

    all_ok = True

    for module_name, min_version in core_deps.items():
        try:
            module = importlib.import_module(module_name)
            version = getattr(module, "__version__", "unknown")

            # Try alternative version attributes
            if version == "unknown":
                version = getattr(module, "version", "unknown")

            # Check version
            try:
                installed = tuple(map(int, version.split(".")[:2]))
                required = tuple(map(int, min_version.split(".")[:2]))

                if installed >= required:
                    print(f"✅ {module_name:25s} {version:15s} (OK)")
                else:
                    print(
                        f"⚠️  {module_name:25s} {version:15s} (old, requires {min_version}+)"
                    )
                    all_ok = False
            except (ValueError, AttributeError):
                print(f"✅ {module_name:25s} {version:15s} (version check skipped)")

        except ImportError:
            print(f"❌ {module_name:25s} {'NOT INSTALLED':15s}")
            all_ok = False

    return all_ok


def check_parakeet_dependencies():
    """Check if Parakeet (NeMo Toolkit) dependencies are installed."""
    print("\n" + "=" * 70)
    print("Parakeet (NeMo Toolkit) Dependency Check")
    print("=" * 70)
    print("ℹ️  Parakeet support is OPTIONAL. Only required if using Parakeet models.")
    print()

    parakeet_deps = {
        "nemo": "2.2.1",
        "omegaconf": "2.3.0",
        "hydra": "core",  # Special case for hydra-core
    }

    all_ok = True
    installed_count = 0

    for module_name, min_version in parakeet_deps.items():
        try:
            if module_name == "hydra":
                # hydra-core imports as hydra
                module = importlib.import_module("hydra")
                version = getattr(module, "__version__", "unknown")
            else:
                module = importlib.import_module(module_name)
                if module_name == "nemo":
                    # nemo_toolkit imports as nemo
                    version = getattr(module, "__version__", "unknown")
                else:
                    version = getattr(module, "__version__", "unknown")

            installed_count += 1

            # Check version (if not "core" special case)
            if min_version != "core":
                try:
                    installed = tuple(map(int, version.split(".")[:2]))
                    required = tuple(map(int, min_version.split(".")[:2]))

                    if installed >= required:
                        print(f"✅ {module_name:25s} {version:15s} (OK)")
                    else:
                        print(
                            f"⚠️  {module_name:25s} {version:15s} (old, requires {min_version}+)"
                        )
                        all_ok = False
                except (ValueError, AttributeError):
                    print(f"✅ {module_name:25s} {version:15s} (version check skipped)")
            else:
                print(f"✅ {module_name:25s} {version:15s} (OK)")

        except ImportError:
            print(f"❌ {module_name:25s} {'NOT INSTALLED':15s}")
            all_ok = False

    # Summary
    print("\n" + "-" * 70)
    if installed_count == 0:
        print("ℹ️  Parakeet dependencies NOT installed")
        print("\n📖 To install Parakeet support:")
        print("   pip install -r requirements-parakeet.txt")
        print("\n⚠️  WARNING: NeMo Toolkit has heavy dependencies (~500MB)")
        print("   May require separate virtual environment")
    elif all_ok:
        print("✅ All Parakeet dependencies installed")
        print("\n📖 Parakeet models are available:")
        print("   - parakeet-tdt-0.6b-v3 (multilingual)")
    else:
        print("⚠️  Some Parakeet dependencies missing or outdated")
        print("\n📖 To fix:")
        print("   pip install -r requirements-parakeet.txt --upgrade")

    return all_ok


def _get_windows_path_from_registry() -> list[str]:
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


def _find_ffmpeg_in_paths(paths: list[str]) -> str | None:
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


def check_ffmpeg():
    """Check if FFmpeg is available."""
    import platform

    print("\n" + "=" * 70)
    print("FFmpeg Check")
    print("=" * 70)

    ffmpeg_path = shutil.which("ffmpeg")

    # Also check registry PATH on Windows
    if not ffmpeg_path and platform.system() == "Windows":
        registry_paths = _get_windows_path_from_registry()
        if registry_paths:
            ffmpeg_path = _find_ffmpeg_in_paths(registry_paths)

        # Check winget links directory
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

    # Also check in app data directory (downloaded FFmpeg)
    if not ffmpeg_path:
        app_data = os.environ.get("APPDATA", "")
        if app_data:
            downloaded_ffmpeg = os.path.join(
                app_data, "com.vocrify.app", "Vocrify", "ffmpeg", "ffmpeg.exe"
            )
            if os.path.exists(downloaded_ffmpeg):
                ffmpeg_path = downloaded_ffmpeg
        # Also check local app data (development)
        if not ffmpeg_path:
            local_app_data = os.environ.get("LOCALAPPDATA", "")
            if local_app_data:
                downloaded_ffmpeg = os.path.join(
                    local_app_data, "com.vocrify.app", "Vocrify", "ffmpeg", "ffmpeg.exe"
                )
                if os.path.exists(downloaded_ffmpeg):
                    ffmpeg_path = downloaded_ffmpeg

    if ffmpeg_path:
        print(f"✅ FFmpeg found at: {ffmpeg_path}")

        try:
            result = subprocess.run(
                [ffmpeg_path, "-version"],
                capture_output=True,
                text=True,
                timeout=5,
                shell=False,
            )
            if result.returncode == 0:
                version_line = result.stdout.split("\n")[0]
                print(f"   {version_line}")
                return True
            else:
                print(f"⚠️  FFmpeg found but returned error code: {result.returncode}")
        except FileNotFoundError:
            print(f"⚠️  FFmpeg found but not executable: {ffmpeg_path}")
        except Exception as e:
            print(f"⚠️  FFmpeg found but error running: {e}")
    else:
        print("❌ FFmpeg NOT found")
        print("\n📖 Solution (choose one):")
        print("\n   Option 1 - Winget (recommended for Windows):")
        print("   winget install -e --id Gyan.FFmpeg")
        print("\n   Option 2 - Manual download:")
        print("   1. Download from https://www.gyan.dev/ffmpeg/builds/")
        print("   2. Extract to C:\\ffmpeg")
        print('   3. Add to PATH: setx PATH "%PATH%;C:\\ffmpeg\\bin"')
        print("   4. Restart terminal")
        print("\n   Option 3 - Chocolatey:")
        print("   choco install ffmpeg")

    return False


def check_huggingface_token():
    """Check if HuggingFace token is configured (optional)."""
    print("\n" + "=" * 70)
    print("HuggingFace Token Check")
    print("=" * 70)

    import os

    token = os.environ.get("HUGGINGFACE_ACCESS_TOKEN") or os.environ.get("HF_TOKEN")

    if token:
        print(f"✅ HuggingFace token found (length: {len(token)} chars)")
        return True
    else:
        print("ℹ️  HuggingFace token NOT found (optional for sherpa-onnx)")
        print("\n📖 Token is optional - needed only for private HuggingFace repos:")
        print("   1. Get token: https://huggingface.co/settings/tokens")
        print("   3. Login: huggingface-cli login")
        print("   4. Or set env var: set HUGGINGFACE_ACCESS_TOKEN=your_token")

    return False


def check_cuda():
    """Check if CUDA is available."""
    print("\n" + "=" * 70)
    print("CUDA/GPU Check")
    print("=" * 70)

    try:
        import torch

        cuda_available = torch.cuda.is_available()

        if cuda_available:
            print(f"✅ CUDA available: {torch.version.cuda}")
            print(f"   GPU: {torch.cuda.get_device_name(0)}")
            print(f"   GPU Count: {torch.cuda.device_count()}")
            return True
        else:
            print("ℹ️  CUDA NOT available (CPU-only mode)")
            print("   Transcription will work but be slower")
            print("\n📖 For GPU acceleration:")
            print(
                "   1. Install CUDA Toolkit: https://developer.nvidia.com/cuda-downloads"
            )
            print("   2. Reinstall torch with CUDA support")
            print("   3. See PYTHON_SETUP.md for details")
    except ImportError:
        print("⚠️  PyTorch not installed, cannot check CUDA")

    return False


def check_virtual_env():
    """Check if running in a virtual environment."""
    print("\n" + "=" * 70)
    print("Virtual Environment Check")
    print("=" * 70)

    in_venv = hasattr(sys, "real_prefix") or (
        hasattr(sys, "base_prefix") and sys.base_prefix != sys.prefix
    )

    if in_venv:
        print(f"✅ Running in virtual environment")
        print(f"   venv path: {sys.prefix}")
        return True
    else:
        print("⚠️  NOT running in a virtual environment")
        print("   It's recommended to use a venv for isolation")
        print("\n📖 Create venv:")
        print("   python -m venv venv")
        print("   venv\\Scripts\\activate  (Windows)")
        print("   source venv/bin/activate  (Linux/Mac)")

    return False


def main():
    """Run all checks."""
    print("\n")
    print("╔" + "=" * 68 + "╗")
    print("║" + " " * 20 + "AI ENGINE ENVIRONMENT CHECK" + " " * 20 + "║")
    print("╚" + "=" * 68 + "╝")

    results = {}

    # Run all checks
    results["python"] = check_python_version()
    results["venv"] = check_virtual_env()
    results["dependencies"] = check_dependencies()
    results["parakeet"] = check_parakeet_dependencies()
    results["ffmpeg"] = check_ffmpeg()
    results["cuda"] = check_cuda()
    results["hf_token"] = check_huggingface_token()

    # Summary
    print("\n" + "=" * 70)
    print("Summary")
    print("=" * 70)

    for check, passed in results.items():
        status = "✅ OK" if passed else "❌ FAIL"
        print(f"{status:8s} {check}")

    # Overall status
    critical_ok = results["python"] and results["dependencies"]
    optional_ok = results["ffmpeg"] and results["hf_token"]
    parakeet_ok = results["parakeet"]

    print("\n" + "=" * 70)

    if critical_ok:
        if optional_ok and parakeet_ok:
            print("🎉 All checks passed! Your environment is fully ready.")
            print("\nNext step: python main.py --test")
        elif optional_ok:
            print("✅ Core functionality ready!")
            print("ℹ️  Parakeet models not available (see above)")
            print("\nNext step: python main.py --test")
        else:
            print("⚠️  Core functionality OK, but some features limited.")
            print("   You can run basic transcription, but may have issues with:")
            if not results["ffmpeg"]:
                print("   - Audio file processing (FFmpeg missing)")
            if not results["hf_token"]:
                print("   - Speaker diarization (HuggingFace token missing)")
            if not results["parakeet"]:
                print("   - Parakeet models (NeMo Toolkit not installed)")
    else:
        print("❌ Critical issues found. Please fix the above errors.")
        print("   See PYTHON_SETUP.md for detailed instructions.")

    print("=" * 70)

    return 0 if critical_ok else 1


if __name__ == "__main__":
    sys.exit(main())

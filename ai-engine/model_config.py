"""
Canonical model configuration — single source of truth.

All model repository mappings, GGML filenames, and size estimates
live here. Other modules (model_registry, downloader, environment_checks,
model_management_service) import from this file instead of defining their
own copies.
"""

from __future__ import annotations

import os
from typing import Optional


# ---------------------------------------------------------------------------
# Whisper GGML models (for Rust whisper.cpp engine)
# ---------------------------------------------------------------------------
WHISPER_REPOS: dict[str, str] = {
    "tiny": "ggerganov/whisper.cpp",
    "base": "ggerganov/whisper.cpp",
    "small": "ggerganov/whisper.cpp",
    "medium": "ggerganov/whisper.cpp",
    "large-v2": "ggerganov/whisper.cpp",
    "large-v3": "ggerganov/whisper.cpp",
}

# Maps size key → GGML .bin filename
GGML_FILENAMES: dict[str, str] = {
    "tiny": "ggml-tiny.bin",
    "base": "ggml-base.bin",
    "small": "ggml-small.bin",
    "medium": "ggml-medium.bin",
    "large": "ggml-large-v1.bin",
    "large-v1": "ggml-large-v1.bin",
    "large-v2": "ggml-large-v2.bin",
    "large-v3": "ggml-large-v3.bin",
}

# ---------------------------------------------------------------------------
# Distil-Whisper models
# ---------------------------------------------------------------------------
DISTIL_WHISPER_REPOS: dict[str, str] = {
    "small": "Systran/faster-distil-whisper-small.en",
    "small.en": "Systran/faster-distil-whisper-small.en",
    "medium-en": "distil-whisper/distil-medium.en",
    "large-v2": "distil-whisper/distil-large-v2",
    "large-v3": "distil-whisper/distil-large-v3",
}

# ---------------------------------------------------------------------------
# Parakeet (NeMo ONNX) models
# ---------------------------------------------------------------------------
PARAKEET_MODELS: dict[str, str] = {
    "0.6b": "nvidia/parakeet-tdt-0.6b-v3",
}

# ---------------------------------------------------------------------------
# Combined model-name → repo-id mapping used by the downloader
# ---------------------------------------------------------------------------
MODEL_REPOSITORIES: dict[str, str] = {
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

# ---------------------------------------------------------------------------
# Sherpa-ONNX diarization URLs
# ---------------------------------------------------------------------------
SHERPA_DIARIZATION_URLS: dict[str, str] = {
    "segmentation": "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2",
    "embedding": "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx.tar.bz2",
}

# ---------------------------------------------------------------------------
# Size estimates (MB) — used for progress bars when Content-Length is absent
# ---------------------------------------------------------------------------
MODEL_SIZE_ESTIMATES_MB: dict[str, int] = {
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

ASSET_SIZE_ESTIMATES_MB: dict[str, int] = {
    "sherpa-onnx-segmentation.tar.bz2": 7,
    "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx": 38,
}


# ---------------------------------------------------------------------------
# Shared utility — get_model_size_mb  (was duplicated in 3 files)
# ---------------------------------------------------------------------------
def get_model_size_mb(path: str) -> int:
    """Get the size of a model directory (or single file) in MB."""
    if os.path.isfile(path):
        try:
            return os.path.getsize(path) // (1024 * 1024)
        except (OSError, IOError):
            return 0

    total_size = 0
    for dirpath, _dirnames, filenames in os.walk(path):
        for f in filenames:
            fp = os.path.join(dirpath, f)
            try:
                total_size += os.path.getsize(fp)
            except (OSError, IOError):
                pass
    return total_size // (1024 * 1024)


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

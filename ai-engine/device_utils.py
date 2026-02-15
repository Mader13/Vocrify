"""Device normalization helpers for Python inference backends.

This module provides a single source of truth for mapping user-requested
runtime devices to the currently supported Python backend device values.
"""

from __future__ import annotations


def is_cuda_available() -> bool:
    """Return True when CUDA is available in the current Python environment."""
    try:
        import torch  # type: ignore[reportMissingImports]

        return bool(torch.cuda.is_available())
    except Exception:
        return False


def normalize_inference_device(requested_device: str | None) -> str:
    """Normalize requested device to Python backend-compatible value.

    Supported output values for current Python backend are: ``cpu`` and ``cuda``.
    Input values may come from UI/runtime preferences: ``auto``, ``cpu``, ``cuda``,
    ``mps``, ``vulkan``.

    Rules:
    - auto -> cuda if available else cpu
    - cuda -> cuda if available else cpu
    - cpu -> cpu
    - mps/vulkan -> cpu (current Python pipeline does not expose those targets)
    - unknown -> cpu
    """
    device = (requested_device or "auto").strip().lower()
    cuda_available = is_cuda_available()

    if device == "auto":
        return "cuda" if cuda_available else "cpu"

    if device == "cuda":
        return "cuda" if cuda_available else "cpu"

    if device == "cpu":
        return "cpu"

    if device in {"mps", "vulkan"}:
        return "cpu"

    return "cpu"

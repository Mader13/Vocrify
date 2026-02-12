"""
Speaker diarization module.

Provides multiple diarization backends: Sherpa-ONNX and PyAnnote.
"""

from typing import Optional

from .base import BaseDiarizer

# Import diarizers with try/except to handle missing dependencies
try:
    from .sherpa_diarizer import SherpaDiarizer

    SHERPA_AVAILABLE = True
except ImportError:
    SHERPA_AVAILABLE = False
    SherpaDiarizer = None

try:
    from .pyannote_diarizer import PyAnnoteDiarizer

    PYANNOTE_AVAILABLE = True
except ImportError:
    PYANNOTE_AVAILABLE = False
    PyAnnoteDiarizer = None


def get_diarizer(
    provider: str, device: str = "cpu", **kwargs
) -> Optional[BaseDiarizer]:
    """
    Factory function to get a diarization provider.

    Args:
        provider: Provider name ('sherpa', 'pyannote', 'none')
        device: Device to run on ('cpu' or 'cuda')
        **kwargs: Additional provider-specific arguments

    Returns:
        BaseDiarizer instance

    Raises:
        ValueError: If provider is unknown or unavailable
    """
    original_provider = provider
    provider = provider.lower()

    if provider == "none" or not provider:
        print(f"[DEBUG] Diarization provider is 'none', skipping initialization")
        return None

    # Handle 'sherpa-onnx' as alias for 'sherpa'
    if provider == "sherpa-onnx":
        print(f"[DEBUG] Normalizing provider 'sherpa-onnx' -> 'sherpa'")
        provider = "sherpa"

    print(
        f"[DEBUG] Creating diarizer for provider: {original_provider} (normalized: {provider})"
    )

    if provider == "sherpa":
        if not SHERPA_AVAILABLE:
            raise ValueError(
                "Sherpa-ONNX diarization not available. Install sherpa-onnx."
            )
        return SherpaDiarizer(device=device, **kwargs)

    elif provider == "pyannote":
        if not PYANNOTE_AVAILABLE:
            raise ValueError(
                "PyAnnote diarization not available. Install pyannote.audio."
            )
        return PyAnnoteDiarizer(device=device, **kwargs)

    else:
        raise ValueError(f"Unknown diarization provider: {provider}")


__all__ = [
    "BaseDiarizer",
    "SherpaDiarizer",
    "PyAnnoteDiarizer",
    "get_diarizer",
    "SHERPA_AVAILABLE",
    "PYANNOTE_AVAILABLE",
]

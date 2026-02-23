"""
Diarization factory for Phase 4.
Python ai-engine is now a Sherpa-ONNX diarization-only microservice.
All transcription is handled by Rust transcribe-rs.
"""

import warnings

logger = __import__("logging").getLogger(__name__)


def _validate_sherpa_provider(provider: str, cache_dir: str = "./models_cache") -> str:
    """
    Validate sherpa-onnx diarization provider availability.
    Returns 'sherpa-onnx' if models are found, otherwise 'none'.
    """
    if provider == "none" or not provider:
        return provider

    if provider not in ("sherpa-onnx", "sherpa"):
        warnings.warn(
            f"Unknown diarization provider '{provider}'. Only 'sherpa-onnx' is supported. "
            f"Falling back to 'none'.",
            UserWarning,
            stacklevel=2,
        )
        return "none"

    try:
        from model_registry import ModelRegistry

        registry = ModelRegistry(cache_dir=cache_dir)
        paths = registry.get_sherpa_diarization_paths()
        if not all(p is not None for p in paths.values()):
            missing = [k for k, v in paths.items() if v is None]
            warnings.warn(
                f"Sherpa-ONNX diarization models not found locally. "
                f"Missing: {', '.join(missing)}. Falling back to 'none'.",
                UserWarning,
                stacklevel=2,
            )
            return "none"
    except Exception as e:
        logger.warning(f"Could not validate sherpa-onnx paths: {e}")

    return "sherpa-onnx"

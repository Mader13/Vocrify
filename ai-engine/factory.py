"""
Model factory for creating transcription model instances using Registry pattern.
"""

import warnings
from typing import Optional

logger = __import__("logging").getLogger(__name__)


class ModelRegistry:
    """Registry for model factories - OCP compliant."""

    _registry: dict[str, "ModelFactory"] = {}

    @classmethod
    def register(cls, name: str, factory: "ModelFactory"):
        """Register a model factory."""
        cls._registry[name] = factory

    @classmethod
    def get(cls, name: str) -> Optional["ModelFactory"]:
        """Get factory by name."""
        return cls._registry.get(name)

    @classmethod
    def list_models(cls) -> list[str]:
        """List all registered model names."""
        return list(cls._registry.keys())


class ModelFactory:
    """Abstract base class for model factories."""

    @staticmethod
    def create(model_name: str, device: str, **kwargs):
        """Create a model instance - to be implemented by subclasses."""
        raise NotImplementedError


def _validate_diarization_provider(
    provider: str, cache_dir: str = "./models_cache"
) -> str:
    """
    Validate diarization provider availability and warn if models are missing.
    """
    if provider == "none" or not provider:
        return provider

    from model_registry import ModelRegistry

    registry = ModelRegistry(cache_dir=cache_dir)
    logger.info(f"Validating diarization provider: {provider}")

    if provider in ("sherpa-onnx", "sherpa"):
        paths = registry.get_sherpa_diarization_paths()
        if not all(p is not None for p in paths.values()):
            missing = [k for k, v in paths.items() if v is None]
            warnings.warn(
                f"Sherpa-ONNX diarization models not found locally. "
                f"Missing components: {', '.join(missing)}. "
                f"Falling back to 'none' diarization provider.",
                UserWarning,
                stacklevel=2,
            )
            logger.warning(
                f"Sherpa-ONNX diarization unavailable (missing: {missing}). "
                f"Falling back to 'none' diarization."
            )
            return "none"

    elif provider == "pyannote":
        paths = registry.get_pyannote_diarization_paths()
        if not all(p[0] is not None for p in paths.values()):
            missing = [k for k, v in paths.items() if v[0] is None]
            warnings.warn(
                f"PyAnnote diarization models not found locally. "
                f"Missing components: {', '.join(missing)}. "
                f"Falling back to 'none' diarization provider.",
                UserWarning,
                stacklevel=2,
            )
            logger.warning(
                f"PyAnnote diarization unavailable (missing: {missing}). "
                f"Falling back to 'none' diarization."
            )
            return "none"

    logger.info(f"Diarization provider validated: {provider}")
    return provider


class WhisperFactory(ModelFactory):
    """Factory for Whisper models."""

    VALID_SIZES = {"tiny", "base", "small", "medium", "large", "large-v2", "large-v3"}

    @staticmethod
    def create(model_name: str, device: str, **kwargs):
        from models.whisper import WhisperModel

        size = model_name.replace("whisper-", "") or "base"
        if size not in WhisperFactory.VALID_SIZES:
            raise ValueError(
                f"Invalid model size '{size}'. Valid sizes: {', '.join(sorted(WhisperFactory.VALID_SIZES))}. "
                f"Model name was: {model_name}"
            )

        return WhisperModel(
            device=device,
            model_size=size,
            download_root=kwargs.get("download_root"),
            diarization_provider=kwargs.get("diarization_provider"),
            beam_size=kwargs.get("beam_size", 1),
            best_of=kwargs.get("best_of", 1),
        )


class DistilWhisperFactory(ModelFactory):
    """Factory for Distil-Whisper models."""

    VALID_SIZES = {
        "small",
        "small.en",
        "medium",
        "medium-en",
        "large",
        "large-v2",
        "large-v3",
    }

    @staticmethod
    def create(model_name: str, device: str, **kwargs):
        from models.distil_whisper import DistilWhisperModel

        size = model_name.replace("distil-", "").replace("whisper-", "")
        if not size or size == "whisper":
            size = "large-v3"

        if size not in DistilWhisperFactory.VALID_SIZES:
            raise ValueError(
                f"Invalid Distil-Whisper model size '{size}'. Valid sizes: {', '.join(sorted(DistilWhisperFactory.VALID_SIZES))}. "
                f"Model name was: {model_name}"
            )

        return DistilWhisperModel(
            device=device,
            model_size=size,
            download_root=kwargs.get("download_root"),
            diarization_provider=kwargs.get("diarization_provider"),
            batch_size=kwargs.get("batch_size", 16 if device == "cuda" else 1),
            chunk_length_s=kwargs.get("chunk_length_s", 30),
            beam_size=kwargs.get("beam_size", 1),
        )


class ParakeetFactory(ModelFactory):
    """Factory for Parakeet models."""

    @staticmethod
    def create(model_name: str, device: str, **kwargs):
        from models.parakeet import ParakeetModel

        if model_name == "parakeet":
            parakeet_size = "0.6b"
        elif "0.6b" in model_name or "0.6" in model_name:
            parakeet_size = "0.6b"
        elif "1.1b" in model_name or "1.1" in model_name:
            parakeet_size = "1.1b"
        else:
            parakeet_size = "0.6b"

        return ParakeetModel(
            model_size=parakeet_size,
            device=device,
            download_root=kwargs.get("download_root"),
            diarization_provider=kwargs.get("diarization_provider"),
        )


ModelRegistry.register("whisper", WhisperFactory)
ModelRegistry.register("distil", DistilWhisperFactory)
ModelRegistry.register("parakeet", ParakeetFactory)


def create(model_name: str, device: str = "cpu", **kwargs):
    """
    Create a model instance using Registry pattern.

    Args:
        model_name: Name of the model (e.g., 'whisper-base')
        device: Device to run on ('cpu' or 'cuda')
        **kwargs: Additional model-specific arguments

    Returns:
        Initialized model instance

    Raises:
        ValueError: If model is not found
    """
    diarization_provider = _validate_diarization_provider(
        kwargs.get("diarization_provider", "pyannote"),
        kwargs.get("download_root", "./models_cache"),
    )
    kwargs["diarization_provider"] = diarization_provider

    for prefix, factory in [
        ("whisper-", "whisper"),
        ("distil-", "distil"),
        ("parakeet", "parakeet"),
    ]:
        if model_name.startswith(prefix) or (
            prefix == "parakeet" and model_name == "parakeet"
        ):
            model_factory = ModelRegistry.get(factory)
            if model_factory:
                return model_factory.create(model_name, device, **kwargs)

    raise ValueError(f"Unknown model: {model_name}")


def list_models() -> list[str]:
    """List all available model names."""
    return [
        "whisper-tiny",
        "whisper-base",
        "whisper-small",
        "whisper-medium",
        "whisper-large",
        "distil-small",
        "distil-medium",
        "distil-large",
        "distil-large-v3",
        "parakeet",
        "parakeet-tdt-0.6b-v3",
        "parakeet-tdt-1.1b",
        "parakeet-tdt-1.1b-ls",
    ]


def get_model_info(model_name: str) -> dict:
    """Get information about a model."""
    info = {
        "whisper-tiny": {
            "name": "Whisper Tiny",
            "size": "~75 MB",
            "speed": "fastest",
            "quality": "lowest",
        },
        "whisper-base": {
            "name": "Whisper Base",
            "size": "~150 MB",
            "speed": "fast",
            "quality": "good",
        },
        "whisper-small": {
            "name": "Whisper Small",
            "size": "~500 MB",
            "speed": "medium",
            "quality": "better",
        },
        "whisper-medium": {
            "name": "Whisper Medium",
            "size": "~1.5 GB",
            "speed": "slow",
            "quality": "great",
        },
        "whisper-large": {
            "name": "Whisper Large",
            "size": "~3 GB",
            "speed": "slowest",
            "quality": "best",
        },
        "parakeet": {
            "name": "Parakeet TDT 0.6B",
            "size": "~600 MB",
            "speed": "very fast",
            "quality": "excellent",
        },
        "parakeet-tdt-0.6b-v3": {
            "name": "Parakeet TDT 0.6B v3",
            "size": "~600 MB",
            "speed": "very fast",
            "quality": "excellent",
        },
        "parakeet-tdt-1.1b": {
            "name": "Parakeet TDT 1.1B",
            "size": "~1.1 GB",
            "speed": "fast",
            "quality": "excellent",
        },
        "distil-small": {
            "name": "Distil-Whisper Small",
            "size": "~380 MB",
            "speed": "6x faster",
            "quality": "good",
        },
        "distil-medium": {
            "name": "Distil-Whisper Medium",
            "size": "~760 MB",
            "speed": "6x faster",
            "quality": "better",
        },
        "distil-large": {
            "name": "Distil-Whisper Large",
            "size": "~1.5 GB",
            "speed": "6x faster",
            "quality": "excellent",
        },
        "distil-large-v3": {
            "name": "Distil-Whisper Large V3",
            "size": "~1.5 GB",
            "speed": "6x faster",
            "quality": "excellent",
        },
    }
    return info.get(model_name, {"name": model_name, "note": "Unknown model"})

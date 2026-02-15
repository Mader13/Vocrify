"""
Model factory for creating transcription model instances.
"""

import logging
import warnings
from typing import Optional
from base import BaseModel
from model_registry import ModelRegistry

logger = logging.getLogger(__name__)


class ModelFactory:
    """Factory for creating transcription model instances."""

    # Registry of available models
    _models: dict[str, type[BaseModel]] = {}

    @classmethod
    def register(cls, name: str, model_class: type[BaseModel]):
        """Register a model class."""
        cls._models[name] = model_class

    @classmethod
    def _validate_diarization_provider(
        cls, provider: str, cache_dir: str = "./models_cache"
    ) -> str:
        """
        Validate diarization provider availability and warn if models are missing.

        Args:
            provider: Diarization provider name ('sherpa-onnx', 'pyannote', or 'none')
            cache_dir: Root directory for model cache

        Returns:
            Validated provider name (falls back to 'none' if unavailable)
        """
        if provider == "none" or not provider:
            return provider

        registry = ModelRegistry(cache_dir=cache_dir)
        logger.info(f"Validating diarization provider: {provider}")

        if provider == "sherpa-onnx" or provider == "sherpa":
            paths = registry.get_sherpa_diarization_paths()
            if not all(p is not None for p in paths.values()):
                missing = [k for k, v in paths.items() if v is None]
                warnings.warn(
                    f"Sherpa-ONNX diarization models not found locally. "
                    f"Missing components: {', '.join(missing)}. "
                    f"Falling back to 'none' diarization provider.",
                    UserWarning,
                    stacklevel=3,
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
                    stacklevel=3,
                )
                logger.warning(
                    f"PyAnnote diarization unavailable (missing: {missing}). "
                    f"Falling back to 'none' diarization."
                )
                return "none"

        logger.info(f"Diarization provider validated: {provider}")
        return provider

    @classmethod
    def create(
        cls,
        model_name: str,
        device: str = "cpu",
        **kwargs,
    ) -> BaseModel:
        """
        Create a model instance.

        Args:
            model_name: Name of the model (e.g., 'whisper-base')
            device: Device to run on ('cpu' or 'cuda')
            **kwargs: Additional model-specific arguments

        Returns:
            Initialized model instance

        Raises:
            ValueError: If model is not found
        """
        # Parse model name (e.g., 'whisper-base' -> 'whisper', 'base')
        if model_name.startswith("whisper"):
            from models.whisper import WhisperModel

            size = model_name.replace("whisper-", "") or "base"

            # Validate size is a valid Whisper model size
            valid_sizes = {
                "tiny",
                "base",
                "small",
                "medium",
                "large",
                "large-v2",
                "large-v3",
            }
            if size not in valid_sizes:
                raise ValueError(
                    f"Invalid model size '{size}'. Valid sizes: {', '.join(sorted(valid_sizes))}. "
                    f"Model name was: {model_name}"
                )

            # Validate diarization provider availability before instantiation
            diarization_provider = cls._validate_diarization_provider(
                kwargs.get("diarization_provider", "pyannote"),
                kwargs.get("download_root", "./models_cache"),
            )

            return WhisperModel(
                device=device,
                model_size=size,
                download_root=kwargs.get("download_root"),
                diarization_provider=diarization_provider,
                beam_size=kwargs.get("beam_size", 1),
                best_of=kwargs.get("best_of", 1),
            )

        elif model_name.startswith("distil"):
            from models.distil_whisper import DistilWhisperModel

            # Map distil-large -> large, distil-small -> small, etc.
            size = model_name.replace("distil-", "").replace("whisper-", "")
            if not size or size == "whisper":
                size = "large-v3"

            # Validate size is a valid Distil-Whisper model size
            valid_sizes = {
                "small",
                "small.en",
                "medium",
                "medium-en",
                "large",
                "large-v2",
                "large-v3",
            }
            if size not in valid_sizes:
                raise ValueError(
                    f"Invalid Distil-Whisper model size '{size}'. Valid sizes: {', '.join(sorted(valid_sizes))}. "
                    f"Model name was: {model_name}"
                )

            # Validate diarization provider availability before instantiation
            diarization_provider = cls._validate_diarization_provider(
                kwargs.get("diarization_provider", "pyannote"),
                kwargs.get("download_root", "./models_cache"),
            )

            return DistilWhisperModel(
                device=device,
                model_size=size,
                download_root=kwargs.get("download_root"),
                diarization_provider=diarization_provider,
                batch_size=kwargs.get("batch_size", 16 if device == "cuda" else 1),
                chunk_length_s=kwargs.get("chunk_length_s", 30),
                beam_size=kwargs.get("beam_size", 1),
            )

        elif model_name == "parakeet" or model_name.startswith("parakeet-"):
            from models.parakeet import ParakeetModel

            # Extract model size from name (e.g., "parakeet-tdt-0.6b-v3" -> "0.6b")
            # Valid sizes: "0.6b", "1.1b"
            if model_name == "parakeet":
                parakeet_size = "0.6b"
            elif "0.6b" in model_name or "0.6" in model_name:
                parakeet_size = "0.6b"
            elif "1.1b" in model_name or "1.1" in model_name:
                parakeet_size = "1.1b"
            else:
                parakeet_size = "0.6b"  # Default

            # Validate diarization provider availability before instantiation
            diarization_provider = cls._validate_diarization_provider(
                kwargs.get("diarization_provider", "pyannote"),
                kwargs.get("download_root", "./models_cache"),
            )

            return ParakeetModel(
                model_size=parakeet_size,
                device=device,
                download_root=kwargs.get("download_root"),
                diarization_provider=diarization_provider,
            )

        else:
            raise ValueError(f"Unknown model: {model_name}")

    @classmethod
    def list_models(cls) -> list[str]:
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
            "parakeet-tdt-1.1b-ls",  # Large speaker diarization variant
        ]

    @classmethod
    def get_model_info(cls, model_name: str) -> dict:
        """Get information about a model."""
        info = {
            "whisper-tiny": {
                "name": "Whisper Tiny",
                "size": "~75 MB",
                "speed": "fastest",
                "quality": "lowest",
                "languages": "99+",
            },
            "whisper-base": {
                "name": "Whisper Base",
                "size": "~150 MB",
                "speed": "fast",
                "quality": "good",
                "languages": "99+",
            },
            "whisper-small": {
                "name": "Whisper Small",
                "size": "~500 MB",
                "speed": "medium",
                "quality": "better",
                "languages": "99+",
            },
            "whisper-medium": {
                "name": "Whisper Medium",
                "size": "~1.5 GB",
                "speed": "slow",
                "quality": "great",
                "languages": "99+",
            },
            "whisper-large": {
                "name": "Whisper Large",
                "size": "~3 GB",
                "speed": "slowest",
                "quality": "best",
                "languages": "99+",
            },
            "parakeet": {
                "name": "Parakeet TDT 0.6B (NVIDIA)",
                "size": "~600 MB",
                "speed": "very fast",
                "quality": "excellent",
                "languages": "Multilingual (English, Spanish, French, German, Italian)",
                "note": "Fast and accurate, supports timestamp extraction",
            },
            "parakeet-tdt-0.6b-v3": {
                "name": "Parakeet TDT 0.6B v3 (NVIDIA)",
                "size": "~600 MB",
                "speed": "very fast",
                "quality": "excellent",
                "languages": "Multilingual (5 languages)",
                "note": "Balanced speed and accuracy with timestamp support",
            },
            "parakeet-tdt-1.1b": {
                "name": "Parakeet TDT 1.1B (NVIDIA)",
                "size": "~1.1 GB",
                "speed": "fast",
                "quality": "excellent",
                "languages": "Multilingual (5 languages)",
                "note": "Higher accuracy, larger model size",
            },
            # Distil-Whisper models: 6x faster with ~1% WER loss
            "distil-small": {
                "name": "Distil-Whisper Small",
                "size": "~380 MB",
                "speed": "6x faster than large",
                "quality": "good",
                "languages": "English only",
                "note": "⚡ Recommended for English transcription - fastest with good accuracy",
            },
            "distil-medium": {
                "name": "Distil-Whisper Medium",
                "size": "~760 MB",
                "speed": "6x faster than large",
                "quality": "better",
                "languages": "English only",
                "note": "⚡ Good balance for English transcription",
            },
            "distil-large": {
                "name": "Distil-Whisper Large",
                "size": "~1.5 GB",
                "speed": "6x faster than large",
                "quality": "excellent",
                "languages": "Multilingual",
                "note": "⚡ Multilingual with excellent accuracy",
            },
            "distil-large-v3": {
                "name": "Distil-Whisper Large V3",
                "size": "~1.5 GB",
                "speed": "6x faster than large",
                "quality": "excellent",
                "languages": "Multilingual",
                "note": "⚡⭐ BEST CHOICE: 6x speedup, multilingual, ~1% WER loss",
            },
        }
        return info.get(model_name, {"name": model_name, "note": "Unknown model"})

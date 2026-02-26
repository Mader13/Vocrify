"""
Model Pool for Reusing Pre-Loaded Models

Eliminates model reload overhead by keeping models in memory.
Thread-safe singleton pattern with LRU eviction.
"""

import os
import threading
import weakref
import logging
from typing import Dict, Optional, Any
from pathlib import Path

logger = logging.getLogger(__name__)


class ModelPool:
    """
    Pool of pre-loaded models for reuse.

    Features:
    - Thread-safe singleton pattern
    - Model reuse across tasks
    - Optional LRU eviction for memory management
    - Weak references for automatic cleanup
    - Statistics tracking
    """

    _instance: Optional["ModelPool"] = None
    _lock = threading.Lock()

    def __new__(cls) -> "ModelPool":
        """Ensure singleton pattern."""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        """Initialize the model pool."""
        if self._initialized:
            return

        self._models: Dict[str, Any] = {}
        self._model_refs: Dict[str, weakref.ref] = {}
        self._access_order: list = []  # For LRU
        self._max_models = 3  # Max models to keep in memory
        self._lock = threading.RLock()
        self._initialized = True

        logger.info("ModelPool initialized with max_models=%d", self._max_models)

    def _get_key(self, model_name: str, device: str, **kwargs) -> str:
        """
        Generate cache key from parameters.

        Key format: model_name_device_model_size_diarization
        Diarization settings affect the model because diarizer is attached to it.
        """
        # Extract model size from kwargs
        size = kwargs.get("model_size", "base")

        # Normalize key components
        model_name_normalized = model_name.replace("whisper-", "").replace(
            "parakeet-", ""
        )

        # Include diarization provider in key to ensure models with/without diarization are cached separately
        diarization_provider = kwargs.get("diarization_provider", "none")

        return f"{model_name_normalized}_{device}_{size}_{diarization_provider}"

    def get_model(self, model_name: str, device: str = "cpu", **kwargs) -> Any:
        """
        Get or create model instance.

        Args:
            model_name: Name of the model (e.g., 'whisper-base', 'parakeet')
            device: Device to run on ('cpu' or 'cuda')
            **kwargs: Additional model parameters

        Returns:
            Model instance (cached or newly created)
        """
        key = self._get_key(model_name, device, **kwargs)
        logger.info(
            f"Model cache key: {key} (diarization_provider={kwargs.get('diarization_provider', 'none')})"
        )

        # Check if model exists in cache
        with self._lock:
            if key in self._models:
                # Update access order for LRU
                if key in self._access_order:
                    self._access_order.remove(key)
                self._access_order.append(key)

                logger.debug(f"Model cache hit: {key}")
                return self._models[key]

            # Evict oldest model if at capacity
            if len(self._models) >= self._max_models:
                self._evict_oldest()

            # Create new model
            logger.info(f"Loading new model: {key}")

            try:
                # Import here to avoid circular dependency
                import sys

                ai_engine_path = Path(__file__).parent
                if str(ai_engine_path) not in sys.path:
                    sys.path.insert(0, str(ai_engine_path))

                from factory import ModelFactory

                model = ModelFactory.create(model_name, device=device, **kwargs)

                # Store in cache
                self._models[key] = model
                self._access_order.append(key)

                logger.info(
                    f"Model loaded and cached: {key} (total cached: {len(self._models)})"
                )
                return model

            except Exception as e:
                logger.error(f"Failed to load model {key}: {e}")
                raise

    def preload_models(self, model_configs: list) -> int:
        """
        Preload models for faster first use.

        Args:
            model_configs: List of dicts with model configurations
                Example: [
                    {"model_name": "whisper-base", "device": "cpu"},
                    {"model_name": "whisper-base", "device": "cuda"},
                ]

        Returns:
            Number of successfully loaded models
        """
        loaded = 0
        failed = []

        for config in model_configs:
            try:
                model_name = config.get("model_name")
                device = config.get("device", "cpu")

                if not model_name:
                    logger.warning("Skipping preload: missing model_name")
                    continue

                # Remove model_name and device from config to avoid duplicate parameters
                config_filtered = {
                    k: v for k, v in config.items() if k not in ("model_name", "device")
                }
                self.get_model(model_name, device=device, **config_filtered)
                loaded += 1

            except Exception as e:
                failed.append((config.get("model_name", "unknown"), str(e)))
                logger.error(f"Failed to preload model {config}: {e}")

        logger.info(f"Preloaded {loaded}/{len(model_configs)} models")

        if failed:
            logger.warning(f"Failed to preload {len(failed)} models: {failed}")

        return loaded

    def _evict_oldest(self):
        """Evict least recently used model from cache."""
        if not self._access_order:
            return

        oldest_key = self._access_order.pop(0)

        if oldest_key in self._models:
            model = self._models.pop(oldest_key)
            logger.info(f"Evicted model from cache: {oldest_key}")

            # Try to clean up model resources
            try:
                if hasattr(model, "cleanup"):
                    model.cleanup()
                elif hasattr(model, "_model") and hasattr(model._model, "cleanup"):
                    model._model.cleanup()
            except Exception as e:
                logger.debug(f"Error during model cleanup: {e}")

    def clear(self):
        """Clear all models from cache."""
        with self._lock:
            # Try to clean up models before clearing
            for key, model in self._models.items():
                try:
                    if hasattr(model, "cleanup"):
                        model.cleanup()
                except Exception as e:
                    logger.debug(f"Error during cleanup of {key}: {e}")

            self._models.clear()
            self._model_refs.clear()
            self._access_order.clear()
            logger.info("Model pool cleared")

    def get_stats(self) -> dict:
        """Get pool statistics."""
        with self._lock:
            return {
                "cached_models": len(self._models),
                "max_models": self._max_models,
                "cached_keys": list(self._models.keys()),
                "access_order": self._access_order.copy(),
            }

    def set_max_models(self, max_models: int):
        """
        Set maximum number of models to cache.

        Args:
            max_models: Maximum number of models (must be >= 1)
        """
        if max_models < 1:
            raise ValueError("max_models must be at least 1")

        with self._lock:
            old_max = self._max_models
            self._max_models = max_models

            # Evict models if new limit is lower
            while len(self._models) > self._max_models:
                self._evict_oldest()

            logger.info(f"Max models updated: {old_max} -> {max_models}")


# Global instance
model_pool = ModelPool()

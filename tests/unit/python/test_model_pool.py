"""
Unit tests for ModelPool
"""

import pytest
import sys
from pathlib import Path

# Add ai-engine to path
ai_engine_path = Path(__file__).parent.parent.parent.parent / "ai-engine"
sys.path.insert(0, str(ai_engine_path))

from model_pool import ModelPool


class TestModelPool:
    """Test ModelPool functionality."""

    def setup_method(self):
        """Setup before each test."""
        self.pool = ModelPool()
        self.pool.clear()  # Start fresh

    def test_singleton_pattern(self):
        """Test that ModelPool is a singleton."""
        pool1 = ModelPool()
        pool2 = ModelPool()

        assert pool1 is pool2

    def test_model_caching(self):
        """Test that models are cached and reused."""
        # Get model twice
        # Note: This will fail if faster-whisper is not installed
        # but we're testing the caching logic, not the model loading
        try:
            model1 = self.pool.get_model("whisper-base", device="cpu")
            model2 = self.pool.get_model("whisper-base", device="cpu")

            # Should be same instance
            assert model1 is model2
        except ImportError:
            pytest.skip("faster-whisper not installed")

    def test_different_keys_different_models(self):
        """Test that different keys create different models."""
        try:
            model1 = self.pool.get_model("whisper-base", device="cpu")
            model2 = self.pool.get_model("whisper-tiny", device="cpu")

            # Should be different instances
            assert model1 is not model2
        except ImportError:
            pytest.skip("faster-whisper not installed")

    def test_lru_eviction(self):
        """Test LRU eviction when pool is full."""
        try:
            self.pool._max_models = 2  # Set small limit

            # Load 3 models
            model1 = self.pool.get_model("whisper-tiny", device="cpu")
            model2 = self.pool.get_model("whisper-base", device="cpu")
            model3 = self.pool.get_model("whisper-small", device="cpu")

            # First model should be evicted
            stats = self.pool.get_stats()
            assert stats["cached_models"] == 2

            # Check that tiny was evicted
            cached_keys = stats["cached_keys"]
            assert not any("tiny" in key for key in cached_keys)

        except ImportError:
            pytest.skip("faster-whisper not installed")

    def test_clear(self):
        """Test clearing the pool."""
        try:
            self.pool.get_model("whisper-base", device="cpu")
            assert self.pool.get_stats()["cached_models"] > 0

            self.pool.clear()
            assert self.pool.get_stats()["cached_models"] == 0

        except ImportError:
            # Pool should be empty if model loading failed
            assert self.pool.get_stats()["cached_models"] == 0

    def test_get_stats(self):
        """Test getting pool statistics."""
        stats = self.pool.get_stats()

        assert "cached_models" in stats
        assert "max_models" in stats
        assert "cached_keys" in stats
        assert "access_order" in stats

    def test_set_max_models(self):
        """Test setting max models."""
        old_max = self.pool._max_models

        self.pool.set_max_models(5)
        assert self.pool._max_models == 5

        # Should raise error for invalid values
        with pytest.raises(ValueError):
            self.pool.set_max_models(0)

        with pytest.raises(ValueError):
            self.pool.set_max_models(-1)

    def test_get_key_generation(self):
        """Test cache key generation."""
        # Test Whisper models
        key1 = self.pool._get_key("whisper-base", "cpu", model_size="base")
        assert "base" in key1
        assert "cpu" in key1

        # Test Parakeet models
        key2 = self.pool._get_key("parakeet-tdt-0.6b-v3", "cpu", model_size="0.6b")
        assert "0.6b" in key2 or "06b" in key2

    def test_preload_models(self):
        """Test preloading multiple models."""
        try:
            configs = [
                {"model_name": "whisper-base", "device": "cpu"},
            ]

            loaded = self.pool.preload_models(configs)

            assert loaded == 1
            assert self.pool.get_stats()["cached_models"] == 1

        except ImportError:
            pytest.skip("faster-whisper not installed")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

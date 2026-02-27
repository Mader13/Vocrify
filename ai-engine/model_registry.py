"""
ModelRegistry - Central cache manager for all models.

Uses huggingface_hub.snapshot_download() for offline detection.
Manages separate cache directories for HF models, NeMo, and diarization.
"""

import os
from pathlib import Path
from typing import Optional, Dict, List, Tuple, Any
from dataclasses import dataclass

from model_config import (
    WHISPER_REPOS,
    DISTIL_WHISPER_REPOS,
    PARAKEET_MODELS,
    SHERPA_DIARIZATION_URLS,
    GGML_FILENAMES,
)


@dataclass
class ModelInfo:
    """Information about a cached model."""

    name: str
    provider: str
    available: bool
    path: Optional[Path] = None
    repo_id: Optional[str] = None
    size_mb: Optional[float] = None


class ModelRegistry:
    """
    Central registry for model cache management.

    Cache structure:
    {cache_dir}/
      ├── hf_cache/              # HuggingFace snapshots
      ├── nemo/                  # NeMo .nemo files
      └── diarization/           # Diarization models
          ├── sherpa-onnx/
    """

    # Model config imported from model_config.py (canonical source of truth)
    # Class-level aliases for backward compatibility
    WHISPER_REPOS = WHISPER_REPOS
    DISTIL_WHISPER_REPOS = DISTIL_WHISPER_REPOS
    PARAKEET_MODELS = PARAKEET_MODELS
    SHERPA_DIARIZATION_URLS = SHERPA_DIARIZATION_URLS

    def __init__(self, cache_dir: str = "./models_cache"):
        """
        Initialize the model registry.

        Args:
            cache_dir: Root directory for all model caches
        """
        self.cache_dir = Path(cache_dir)
        # Use .hf_cache to match downloader.py convention
        self.hf_cache = self.cache_dir / ".hf_cache"
        self.nemo_cache = self.cache_dir / "nemo"
        self.diarization_cache = self.cache_dir / "diarization"

        # Create cache directories
        self.hf_cache.mkdir(parents=True, exist_ok=True)
        self.nemo_cache.mkdir(parents=True, exist_ok=True)
        self.diarization_cache.mkdir(parents=True, exist_ok=True)
        (self.diarization_cache / "sherpa-onnx").mkdir(exist_ok=True)

    def get_whisper_path(self, model_size: str) -> Tuple[Optional[Path], str]:
        """
        Get path to cached GGML Whisper model or repo ID for download.

        Args:
            model_size: Model size ('tiny', 'base', 'small', 'medium', 'large-v2', 'large-v3')

        Returns:
            Tuple of (local_path or None, repo_id)
        """
        repo_id = self.WHISPER_REPOS.get(model_size)
        if not repo_id:
            raise ValueError(f"Unknown Whisper model size: {model_size}")

        # Method 1: Check for GGML .bin file directly (for Rust whisper.cpp)
        ggml_filename = GGML_FILENAMES.get(model_size)

        if ggml_filename:
            # Check in models_cache root (direct download location)
            ggml_path = self.cache_dir / ggml_filename
            if ggml_path.exists():
                return ggml_path, repo_id

        # Method 2: Try HuggingFace cache structure first
        try:
            from huggingface_hub import snapshot_download

            local_path = snapshot_download(
                repo_id=repo_id, cache_dir=str(self.hf_cache), local_files_only=True
            )
            return Path(local_path), repo_id
        except Exception:
            pass  # Not found in HF cache, try direct directory

        # Method 3: Check direct model directory (e.g., models_cache/whisper-base/)
        # This handles models downloaded to simple directories with model.bin files
        model_dir = self.cache_dir / f"whisper-{model_size}"
        if model_dir.exists():
            # Check if required files exist
            required_files = [
                "model.bin",
                "config.json",
                "tokenizer.json",
                "vocabulary.txt",
            ]
            if all((model_dir / f).exists() for f in required_files):
                return model_dir, repo_id

        # Not found locally
        return None, repo_id

    def get_distil_whisper_path(self, model_size: str) -> Tuple[Optional[Path], str]:
        """
        Get path to cached Distil-Whisper model or repo ID.

        Args:
            model_size: Model size ('large-v2', 'large-v3', 'medium-en')

        Returns:
            Tuple of (local_path or None, repo_id)
        """
        repo_id = self.DISTIL_WHISPER_REPOS.get(model_size)
        if not repo_id:
            raise ValueError(f"Unknown Distil-Whisper model: {model_size}")

        try:
            from huggingface_hub import snapshot_download

            local_path = snapshot_download(
                repo_id=repo_id, cache_dir=str(self.hf_cache), local_files_only=True
            )
            return Path(local_path), repo_id
        except Exception:
            return None, repo_id

    def get_parakeet_path(self, model_size: str) -> Tuple[Optional[Path], str]:
        """
        Get path to cached Parakeet .nemo file.

        NeMo requires the actual .nemo file for restore_from().

        Args:
            model_size: Model size ('0.6b', '1.1b')

        Returns:
            Tuple of (.nemo file path or None, model_name)
        """
        model_name = self.PARAKEET_MODELS.get(model_size)
        if not model_name:
            raise ValueError(f"Unknown Parakeet model: {model_size}")

        # Check for .nemo file in cache
        model_dir = self.nemo_cache / model_name.replace("/", "_")
        nemo_file = model_dir / f"{model_name.split('/')[-1]}.nemo"

        if nemo_file.exists():
            return nemo_file, model_name

        return None, model_name

    def get_sherpa_diarization_paths(self) -> Dict[str, Optional[Path]]:
        """
        Get paths to Sherpa-ONNX diarization models.

        Returns:
            Dict with 'segmentation' and 'embedding' paths (or None if not cached)
        """
        # Models are downloaded to sherpa-onnx-diarization/ by downloader.py
        sherpa_dir = self.cache_dir / "sherpa-onnx-diarization"

        # Segmentation model: sherpa-onnx-diarization/sherpa-onnx-segmentation/model.int8.onnx
        # Note: The archive extracts directly to sherpa-onnx-segmentation/ without the nested folder
        seg_path = sherpa_dir / "sherpa-onnx-segmentation" / "model.int8.onnx"

        # Embedding model: sherpa-onnx-diarization/sherpa-onnx-embedding/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx
        # Note: The embedding is downloaded as a single .onnx file, not in a subdirectory
        emb_path = (
            sherpa_dir
            / "sherpa-onnx-embedding"
            / "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"
        )

        return {
            "segmentation": seg_path if seg_path.exists() else None,
            "embedding": emb_path if emb_path.exists() else None,
        }



    def validate_model(self, provider: str, model_id: str) -> bool:
        """
        Validate if a model is available locally.

        Args:
            provider: Provider name ('whisper', 'distil-whisper', 'parakeet')
            model_id: Model identifier

        Returns:
            True if model is cached locally
        """
        try:
            if provider == "whisper":
                path, _ = self.get_whisper_path(model_id)
                return path is not None
            elif provider == "distil-whisper":
                path, _ = self.get_distil_whisper_path(model_id)
                return path is not None
            elif provider == "parakeet":
                path, _ = self.get_parakeet_path(model_id)
                return path is not None
            else:
                return False
        except Exception:
            return False

    def list_available_models(self) -> List[ModelInfo]:
        """
        List all available models (cached and uncached).

        Returns:
            List of ModelInfo objects
        """
        models = []

        # Whisper models
        for size in self.WHISPER_REPOS.keys():
            path, repo_id = self.get_whisper_path(size)
            models.append(
                ModelInfo(
                    name=f"whisper-{size}",
                    provider="whisper",
                    available=path is not None,
                    path=path,
                    repo_id=repo_id,
                )
            )

        # Distil-Whisper models
        for size in self.DISTIL_WHISPER_REPOS.keys():
            path, repo_id = self.get_distil_whisper_path(size)
            models.append(
                ModelInfo(
                    name=f"distil-whisper-{size}",
                    provider="distil-whisper",
                    available=path is not None,
                    path=path,
                    repo_id=repo_id,
                )
            )

        # Parakeet models
        for size in self.PARAKEET_MODELS.keys():
            path, model_name = self.get_parakeet_path(size)
            models.append(
                ModelInfo(
                    name=f"parakeet-{size}",
                    provider="parakeet",
                    available=path is not None,
                    path=path,
                    repo_id=model_name,
                )
            )

        # Sherpa diarization
        sherpa_paths = self.get_sherpa_diarization_paths()
        models.append(
            ModelInfo(
                name="sherpa-onnx-diarization",
                provider="sherpa-onnx",
                available=all(p is not None for p in sherpa_paths.values()),
                path=self.cache_dir / "sherpa-onnx-diarization",
            )
        )

        return models

    def delete_model(self, model_name: str) -> Dict[str, Any]:
        """
        Delete a model from the cache directory.

        Args:
            model_name: Model name (e.g., "whisper-base", "distil-large-v3",
                        "parakeet-0.6b", "sherpa-onnx-diarization")

        Returns:
            Dict with 'success' (bool), 'message' (str), and 'deleted_paths' (list of str)
        """
        import shutil
        from typing import Any, Dict

        deleted_paths = []

        # Determine model type from name
        if model_name.startswith("whisper-"):
            # Whisper GGML models are downloaded as .bin files to {cache_dir}/
            # First check for GGML .bin file (primary location for Rust whisper.cpp)
            size = model_name.replace("whisper-", "")
            ggml_filename = GGML_FILENAMES.get(size)

            if ggml_filename:
                ggml_path = self.cache_dir / ggml_filename
                if ggml_path.exists():
                    try:
                        ggml_path.unlink()
                        deleted_paths.append(str(ggml_path))
                    except Exception as e:
                        return {
                            "success": False,
                            "message": f"Failed to delete {model_name}: {str(e)}",
                            "deleted_paths": deleted_paths,
                        }

            # Second: Check the direct model directory (legacy location)
            target_dir = self.cache_dir / model_name
            if target_dir.exists():
                try:
                    shutil.rmtree(target_dir)
                    deleted_paths.append(str(target_dir))
                except Exception as e:
                    return {
                        "success": False,
                        "message": f"Failed to delete {model_name}: {str(e)}",
                        "deleted_paths": deleted_paths,
                    }

            # Third: Fallback to HF cache structure (for legacy downloads)
            repo_id = self.WHISPER_REPOS.get(size)
            if repo_id:
                org, name = repo_id.split("/")
                hf_cache_name = f"models--{org}--{name}"
                target_dir = self.hf_cache / "hub" / hf_cache_name
                if target_dir.exists():
                    try:
                        shutil.rmtree(target_dir)
                        deleted_paths.append(str(target_dir))
                    except Exception as e:
                        return {
                            "success": False,
                            "message": f"Failed to delete {model_name}: {str(e)}",
                            "deleted_paths": deleted_paths,
                        }

            if not deleted_paths:
                return {
                    "success": False,
                    "message": f"Model not found: {model_name}",
                    "deleted_paths": deleted_paths,
                }

        elif model_name.startswith("distil-"):
            # Distil-Whisper models - check direct directory first
            target_dir = self.cache_dir / model_name
            if target_dir.exists():
                try:
                    shutil.rmtree(target_dir)
                    deleted_paths.append(str(target_dir))
                except Exception as e:
                    return {
                        "success": False,
                        "message": f"Failed to delete {model_name}: {str(e)}",
                        "deleted_paths": deleted_paths,
                    }
            else:
                # Fallback: Check HF cache structure
                parts = model_name.split("-")
                if len(parts) >= 2:
                    size = "-".join(parts[1:])  # large-v3, large-v2, medium-en
                    repo_id = self.DISTIL_WHISPER_REPOS.get(size)
                    if repo_id:
                        org, name = repo_id.split("/")
                        hf_cache_name = f"models--{org}--{name}"
                        target_dir = self.hf_cache / "hub" / hf_cache_name
                        if target_dir.exists():
                            try:
                                shutil.rmtree(target_dir)
                                deleted_paths.append(str(target_dir))
                            except Exception as e:
                                return {
                                    "success": False,
                                    "message": f"Failed to delete {model_name}: {str(e)}",
                                    "deleted_paths": deleted_paths,
                                }
                        else:
                            return {
                                "success": False,
                                "message": f"Model not found: {model_name}",
                                "deleted_paths": deleted_paths,
                            }
                    else:
                        return {
                            "success": False,
                            "message": f"Model not found: {model_name}",
                            "deleted_paths": deleted_paths,
                        }
                else:
                    return {
                        "success": False,
                        "message": f"Model not found: {model_name}",
                        "deleted_paths": deleted_paths,
                    }

        elif model_name.startswith("parakeet-"):
            # Parakeet ONNX models - check direct directory
            # Structure: {cache_dir}/parakeet-tdt-0.6b-v3/{encoder.onnx, decoder.onnx, ...}
            target_dir = self.cache_dir / model_name
            if target_dir.exists():
                try:
                    shutil.rmtree(target_dir)
                    deleted_paths.append(str(target_dir))
                except Exception as e:
                    return {
                        "success": False,
                        "message": f"Failed to delete {model_name}: {str(e)}",
                        "deleted_paths": deleted_paths,
                    }
            else:
                # Also check for legacy nemo cache structure (for backwards compatibility)
                size = model_name.replace("parakeet-", "")
                model_name_full = self.PARAKEET_MODELS.get(size)
                if model_name_full:
                    cache_name = model_name_full.replace("/", "_")
                    target_dir = self.nemo_cache / cache_name
                    if target_dir.exists():
                        try:
                            shutil.rmtree(target_dir)
                            deleted_paths.append(str(target_dir))
                        except Exception as e:
                            return {
                                "success": False,
                                "message": f"Failed to delete {model_name}: {str(e)}",
                                "deleted_paths": deleted_paths,
                            }
                # Model not found - not an error if it was already deleted
                return {
                    "success": True,
                    "message": f"Model {model_name} not found (may have been already deleted)",
                    "deleted_paths": deleted_paths,
                }

        elif model_name == "sherpa-onnx-diarization":
            # Sherpa diarization - models are in {cache_dir}/sherpa-onnx-diarization/
            # Structure: {cache_dir}/sherpa-onnx-diarization/sherpa-onnx-segmentation/ and sherpa-onnx-embedding/

            # Check if the parent directory exists
            sherpa_parent = self.cache_dir / "sherpa-onnx-diarization"
            if sherpa_parent.exists():
                try:
                    shutil.rmtree(sherpa_parent)
                    deleted_paths.append(str(sherpa_parent))
                except Exception as e:
                    return {
                        "success": False,
                        "message": f"Failed to delete sherpa diarization: {str(e)}",
                        "deleted_paths": deleted_paths,
                    }

            # Delete flat structure (old structure that Rust get_local_models_internal checks)
            # This is critical - Rust checks for sherpa-onnx-segmentation and sherpa-onnx-embedding
            # in the cache root, so we must delete them here
            flat_seg = self.cache_dir / "sherpa-onnx-segmentation"
            flat_emb = self.cache_dir / "sherpa-onnx-embedding"
            for flat_dir in [flat_seg, flat_emb]:
                if flat_dir.exists():
                    try:
                        shutil.rmtree(flat_dir)
                        deleted_paths.append(str(flat_dir))
                    except Exception as e:
                        return {
                            "success": False,
                            "message": f"Failed to delete sherpa flat directory: {str(e)}",
                            "deleted_paths": deleted_paths,
                        }

            # Fallback: Check legacy individual directories (very old structure)
            if not deleted_paths:
                sherpa_dir = self.diarization_cache / "sherpa-onnx"
                seg_dir_legacy = sherpa_dir / "sherpa-onnx-pyannote-segmentation-3-0"
                if seg_dir_legacy.exists():
                    try:
                        shutil.rmtree(seg_dir_legacy)
                        deleted_paths.append(str(seg_dir_legacy))
                    except Exception as e:
                        return {
                            "success": False,
                            "message": f"Failed to delete sherpa segmentation: {str(e)}",
                            "deleted_paths": deleted_paths,
                        }

                emb_dir_legacy = (
                    sherpa_dir / "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k"
                )
                if emb_dir_legacy.exists():
                    try:
                        shutil.rmtree(emb_dir_legacy)
                        deleted_paths.append(str(emb_dir_legacy))
                    except Exception as e:
                        return {
                            "success": False,
                            "message": f"Failed to delete sherpa embedding: {str(e)}",
                            "deleted_paths": deleted_paths,
                        }

            if not deleted_paths:
                return {
                    "success": False,
                    "message": f"Sherpa diarization models not found",
                    "deleted_paths": deleted_paths,
                }


        else:
            return {
                "success": False,
                "message": f"Unknown model: {model_name}",
                "deleted_paths": deleted_paths,
            }

        # Verify all deleted paths are actually removed
        import time

        time.sleep(0.5)  # Give filesystem time to sync

        for path_str in deleted_paths:
            path = Path(path_str)
            if path.exists():
                return {
                    "success": False,
                    "message": f"Failed to verify deletion of {model_name}: {path_str} still exists",
                    "deleted_paths": deleted_paths,
                }

        return {
            "success": True,
            "message": f"Successfully deleted {model_name}",
            "deleted_paths": deleted_paths,
        }

"""Model management operations extracted from main.py."""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Optional

from ipc_events import emit_delete_complete, emit_error, emit_models_list, emit_validation_results
from model_registry import ModelRegistry


def get_model_size_mb(path: str) -> int:
    """Get the size of a model directory in MB."""
    total_size = 0
    for dirpath, dirnames, filenames in os.walk(path):
        for f in filenames:
            fp = os.path.join(dirpath, f)
            try:
                total_size += os.path.getsize(fp)
            except (OSError, IOError):
                pass
    return total_size // (1024 * 1024)


def list_models(cache_dir: str, logger) -> None:
    """List all installed models in the cache directory."""
    logger.info(f"Listing models in cache directory: {cache_dir}")
    models = []

    if not os.path.exists(cache_dir):
        logger.warning("Cache directory does not exist", {"path": cache_dir})
        emit_models_list(models)
        return

    skip_individual_components = {
        "pyannote-segmentation-3.0",
        "pyannote-embedding-3.0",
        "sherpa-onnx-segmentation",
        "sherpa-onnx-embedding",
    }

    for model_name in os.listdir(cache_dir):
        model_path = os.path.join(cache_dir, model_name)
        if not os.path.isdir(model_path):
            logger.debug(f"Skipping non-directory entry: {model_name}")
            continue

        if model_name in skip_individual_components:
            logger.debug(f"Skipping individual diarization component: {model_name}")
            continue

        if model_name == "pyannote-diarization":
            seg_path = os.path.join(model_path, "pyannote-segmentation-3.0")
            emb_path = os.path.join(model_path, "pyannote-embedding-3.0")
            if not os.path.exists(seg_path) or not os.path.exists(emb_path):
                logger.debug(
                    "Skipping incomplete pyannote-diarization (missing subdirectories)"
                )
                continue
        elif model_name == "sherpa-onnx-diarization":
            seg_path = os.path.join(model_path, "sherpa-onnx-segmentation")
            emb_path = os.path.join(model_path, "sherpa-onnx-embedding")
            if not os.path.exists(seg_path) or not os.path.exists(emb_path):
                logger.debug(
                    "Skipping incomplete sherpa-onnx-diarization (missing subdirectories)"
                )
                continue

        size_mb = get_model_size_mb(model_path)
        logger.debug(f"Found model: {model_name}", {"sizeMb": size_mb})

        if model_name.startswith("whisper-"):
            model_type = "whisper"
        elif model_name.startswith("parakeet-"):
            model_type = "parakeet"
        elif model_name.startswith("sherpa-onnx-"):
            model_type = "diarization"
        elif model_name == "sherpa-onnx-diarization":
            model_type = "diarization"
        elif model_name.startswith("pyannote-"):
            model_type = "diarization"
        elif model_name == "pyannote-diarization":
            model_type = "diarization"
        else:
            continue

        models.append(
            {
                "name": model_name,
                "size_mb": size_mb,
                "model_type": model_type,
                "installed": True,
                "path": model_path,
            }
        )

    emit_models_list(models)


def validate_models(cache_dir: str, logger, model_name: Optional[str] = None) -> None:
    """Validate model availability using ModelRegistry."""
    logger.info(f"Validating models in cache directory: {cache_dir}")
    if model_name:
        logger.info(f"Validating specific model: {model_name}")

    registry = ModelRegistry(cache_dir)
    results = []

    def add_result(
        name: str,
        available: bool,
        provider: str,
        path: Optional[Path] = None,
        size_mb: Optional[float] = None,
    ):
        result = {
            "name": name,
            "available": available,
            "provider": provider,
            "status": "OK" if available else "NOT INSTALLED",
        }
        if path:
            result["path"] = str(path)
        if size_mb is not None:
            result["size_mb"] = round(size_mb, 2)
        results.append(result)

    if model_name:
        if model_name.startswith("whisper-"):
            size = model_name.replace("whisper-", "")
            path, repo_id = registry.get_whisper_path(size)
            size_mb = get_model_size_mb(str(path)) if path else None
            add_result(model_name, path is not None, "whisper", path, size_mb)
        elif model_name.startswith("distil-"):
            if model_name.startswith("distil-whisper-"):
                size = model_name.replace("distil-whisper-", "")
            else:
                size = model_name.replace("distil-", "")
            path, repo_id = registry.get_distil_whisper_path(size)
            size_mb = get_model_size_mb(str(path)) if path else None
            add_result(model_name, path is not None, "distil-whisper", path, size_mb)
        elif model_name.startswith("parakeet-"):
            size = model_name.replace("parakeet-", "").replace("tdt-", "")
            try:
                path, model_id = registry.get_parakeet_path(size)
                size_mb = get_model_size_mb(str(path)) if path else None
                add_result(model_name, path is not None, "parakeet", path, size_mb)
            except ValueError:
                add_result(model_name, False, "parakeet", None, None)
        elif model_name == "sherpa-onnx-diarization" or model_name.startswith(
            "sherpa-onnx"
        ):
            sherpa_paths = registry.get_sherpa_diarization_paths()
            available = all(p is not None for p in sherpa_paths.values())
            path = registry.diarization_cache / "sherpa-onnx" if available else None
            size_mb = get_model_size_mb(str(path)) if path else None
            add_result(model_name, available, "sherpa-onnx", path, size_mb)
        elif model_name == "pyannote-diarization" or model_name.startswith("pyannote"):
            pyannote_paths = registry.get_pyannote_diarization_paths()
            available = all(p[0] is not None for p in pyannote_paths.values())
            path = registry.diarization_cache / "pyannote" if available else None
            size_mb = get_model_size_mb(str(path)) if path else None
            add_result(model_name, available, "pyannote", path, size_mb)
        else:
            add_result(model_name, False, "unknown", None, None)
    else:
        for size in registry.WHISPER_REPOS.keys():
            path, repo_id = registry.get_whisper_path(size)
            size_mb = get_model_size_mb(str(path)) if path else None
            add_result(f"whisper-{size}", path is not None, "whisper", path, size_mb)

        for size in registry.DISTIL_WHISPER_REPOS.keys():
            path, repo_id = registry.get_distil_whisper_path(size)
            size_mb = get_model_size_mb(str(path)) if path else None
            add_result(
                f"distil-whisper-{size}",
                path is not None,
                "distil-whisper",
                path,
                size_mb,
            )

        for size in registry.PARAKEET_MODELS.keys():
            path, model_id = registry.get_parakeet_path(size)
            size_mb = get_model_size_mb(str(path)) if path else None
            add_result(f"parakeet-tdt-{size}", path is not None, "parakeet", path, size_mb)

        sherpa_paths = registry.get_sherpa_diarization_paths()
        available = all(p is not None for p in sherpa_paths.values())
        path = registry.diarization_cache / "sherpa-onnx" if available else None
        size_mb = get_model_size_mb(str(path)) if path else None
        add_result("sherpa-onnx-diarization", available, "sherpa-onnx", path, size_mb)

        pyannote_paths = registry.get_pyannote_diarization_paths()
        available = all(p[0] is not None for p in pyannote_paths.values())
        path = registry.diarization_cache / "pyannote" if available else None
        size_mb = get_model_size_mb(str(path)) if path else None
        add_result("pyannote-diarization", available, "pyannote", path, size_mb)

    emit_validation_results(results, cache_dir)


def delete_model(model_name: str, cache_dir: str, logger, model_pool) -> None:
    """Delete a model from cache and emit protocol events."""
    logger.info(f"Deleting model: {model_name} from cache: {cache_dir}")

    try:
        model_pool.clear()
        logger.info(f"Cleared model pool before deleting {model_name}")
        time.sleep(0.5)
    except Exception as e:
        logger.warning(f"Error clearing model pool: {e}")

    registry = ModelRegistry(cache_dir)
    result = registry.delete_model(model_name)

    if result["success"]:
        logger.info(
            f"Model deleted successfully: {model_name}",
            {"deleted_paths": result["deleted_paths"]},
        )
        emit_delete_complete(model_name)
    else:
        logger.warning(
            f"Failed to delete model: {model_name}",
            {"message": result["message"]},
        )
        emit_error(result["message"])

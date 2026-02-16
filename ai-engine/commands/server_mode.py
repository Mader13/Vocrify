"""Handle --server mode."""

import json
import traceback
from pathlib import Path

from command_router import handle_server_command
from command_validation import safe_json_loads
from device_detection import emit_device_info
from device_utils import normalize_inference_device
from environment_checks import (
    check_ffmpeg,
    check_models,
    check_python_environment,
    get_full_environment_status,
)
from ipc_events import emit_error
from logger import logger
from model_management_service import delete_model
from model_pool import model_pool
from transcription_service import handle_transcribe_command


def handle_server_mode(args, logger, model_pool) -> int:
    """Run in server mode, listening for JSON commands on stdin."""
    from ipc_events import emit_error as emit_err

    logger.info("Preloading models...")
    preload_configs = [{"model_name": "whisper-base", "device": "cpu"}]

    try:
        import torch

        if torch.cuda.is_available():
            logger.info(f"CUDA available: {torch.cuda.get_device_name(0)}")
            preload_configs.append({"model_name": "whisper-base", "device": "cuda"})
    except ImportError:
        logger.debug("PyTorch not available, skipping CUDA preload")

    if preload_configs:
        loaded = model_pool.preload_models(preload_configs)
        logger.info(f"Preloaded {loaded}/{len(preload_configs)} models")
        logger.info(f"Model pool stats: {model_pool.get_stats()}")

    print(json.dumps({"type": "ready", "message": "AI Engine ready"}), flush=True)
    logger.info("AI Engine server started")

    def _handle_get_devices():
        """Return available compute devices (CPU, CUDA, MPS)."""
        try:
            emit_device_info()
        except ImportError as e:
            logger.error(f"Failed to import device_detection: {e}")
            emit_err(f"Device detection not available: {str(e)}")
        except Exception as e:
            logger.error(f"Device detection failed: {e}")
            emit_err(f"Failed to detect devices: {str(e)}")

    def _handle_transcribe(command: dict):
        """Transcribe wrapper for command router."""
        handle_transcribe_command(
            command,
            model_pool=model_pool,
            transcription_logger=logger,
            upload_logger=logger,
            model_logger=logger,
            validate_language=lambda x: x,
            get_system_metrics=lambda: {},
            build_progress_metrics=lambda *a, **kw: None,
        )

    for line in __import__("sys").stdin:
        line = line.strip()
        if not line:
            continue

        try:
            command = safe_json_loads(line)
            should_shutdown = handle_server_command(
                command,
                logger=logger,
                handle_transcribe=_handle_transcribe,
                handle_get_devices=_handle_get_devices,
                check_python=check_python_environment,
                check_ffmpeg=check_ffmpeg,
                check_models=check_models,
                check_environment=get_full_environment_status,
                delete_model=lambda model_name, cache_dir: delete_model(
                    model_name, cache_dir, logger, model_pool
                ),
            )
            if should_shutdown:
                return 0

        except ValueError as e:
            logger.error("JSON validation failed", exc=e)
            emit_err(f"JSON validation error: {str(e)}")
        except Exception as e:
            logger.error("Server error", exc=e)
            emit_err(f"Server error: {str(e)}\n{traceback.format_exc()}")

    return 0

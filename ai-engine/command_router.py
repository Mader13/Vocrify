"""Server command routing for AI engine JSON IPC."""

from __future__ import annotations

import json

from ipc_events import emit_error


def handle_server_command(
    command: dict,
    *,
    logger,
    handle_transcribe,
    handle_get_devices,
    check_python,
    check_ffmpeg,
    check_models,
    check_environment,
    delete_model,
) -> bool:
    """Handle one server command.

    Returns:
        True if caller should shutdown loop, otherwise False.
    """
    cmd_type = command.get("type")

    if cmd_type == "ping":
        logger.debug("Ping received")
        print(json.dumps({"type": "pong"}), flush=True)
        return False

    if cmd_type == "transcribe":
        handle_transcribe(command)
        return False

    if cmd_type == "shutdown":
        logger.info("Shutting down AI Engine")
        print(json.dumps({"type": "shutdown", "message": "Shutting down"}), flush=True)
        return True

    if cmd_type == "get_devices":
        logger.debug("Get devices request received")
        handle_get_devices()
        return False

    if cmd_type == "check_python":
        logger.debug("Check Python environment request received")
        result = check_python()
        print(json.dumps({"type": "python_check", **result}), flush=True)
        return False

    if cmd_type == "check_ffmpeg":
        logger.debug("Check FFmpeg request received")
        result = check_ffmpeg()
        print(json.dumps({"type": "ffmpeg_check", **result}), flush=True)
        return False

    if cmd_type == "check_models":
        logger.debug("Check models request received")
        cache_dir = command.get("cache_dir")
        result = check_models(cache_dir)
        print(json.dumps({"type": "models_check", **result}), flush=True)
        return False

    if cmd_type == "check_environment":
        logger.debug("Check environment request received")
        cache_dir = command.get("cache_dir")
        result = check_environment(cache_dir)
        print(json.dumps(result), flush=True)
        return False

    if cmd_type == "delete_model":
        logger.debug("Delete model request received")
        model_name = command.get("model_name")
        cache_dir = command.get("cache_dir")

        if not model_name:
            emit_error("Missing 'model_name' parameter for delete_model command")
            return False

        if not cache_dir:
            emit_error("Missing 'cache_dir' parameter for delete_model command")
            return False

        delete_model(model_name, cache_dir)
        return False

    logger.warning(f"Unknown command type: {cmd_type}")
    emit_error(f"Unknown command type: {cmd_type}")
    return False

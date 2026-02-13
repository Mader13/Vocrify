"""Command validation utilities for AI engine JSON IPC."""

from __future__ import annotations

import json

MAX_JSON_SIZE = 10 * 1024 * 1024  # 10MB max payload size
MAX_JSON_DEPTH = 100  # Maximum nesting depth

ALLOWED_COMMAND_TYPES = {
    "transcribe",
    "ping",
    "shutdown",
    "get_devices",
    "check_python",
    "check_ffmpeg",
    "check_models",
    "check_environment",
    "delete_model",
}

COMMAND_SCHEMAS = {
    "transcribe": {
        "required": ["type", "file"],
        "optional": [
            "model",
            "device",
            "language",
            "diarization",
            "taskId",
            "huggingfaceToken",
            "diarization_provider",
            "num_speakers",
            "vad_provider",
            "cache_dir",
        ],
        "types": {
            "type": str,
            "file": str,
            "model": str,
            "device": str,
            "language": str,
            "diarization": bool,
            "taskId": str,
            "huggingfaceToken": str,
            "diarization_provider": str,
            "num_speakers": int,
            "vad_provider": str,
            "cache_dir": str,
        },
    },
    "ping": {
        "required": ["type"],
        "optional": [],
        "types": {"type": str},
    },
    "shutdown": {
        "required": ["type"],
        "optional": [],
        "types": {"type": str},
    },
    "get_devices": {
        "required": ["type"],
        "optional": [],
        "types": {"type": str},
    },
    "check_python": {
        "required": ["type"],
        "optional": [],
        "types": {"type": str},
    },
    "check_ffmpeg": {
        "required": ["type"],
        "optional": [],
        "types": {"type": str},
    },
    "check_models": {
        "required": ["type"],
        "optional": ["cache_dir"],
        "types": {"type": str, "cache_dir": str},
    },
    "check_environment": {
        "required": ["type"],
        "optional": ["cache_dir"],
        "types": {"type": str, "cache_dir": str},
    },
    "delete_model": {
        "required": ["type", "model_name", "cache_dir"],
        "optional": [],
        "types": {"type": str, "model_name": str, "cache_dir": str},
    },
}


def check_json_depth(obj, current_depth=0):
    """Recursively check JSON nesting depth to prevent DoS attacks."""
    if current_depth > MAX_JSON_DEPTH:
        raise ValueError(
            f"JSON nesting depth exceeds maximum allowed depth of {MAX_JSON_DEPTH}"
        )

    if isinstance(obj, dict):
        for value in obj.values():
            check_json_depth(value, current_depth + 1)
    elif isinstance(obj, list):
        for item in obj:
            check_json_depth(item, current_depth + 1)

    return True


def safe_json_loads(data: str) -> dict:
    """Safely parse JSON with validation for size, depth, and structure."""
    data_size = len(data.encode("utf-8"))
    if data_size > MAX_JSON_SIZE:
        raise ValueError(
            f"JSON payload size ({data_size} bytes) exceeds maximum allowed size of {MAX_JSON_SIZE} bytes"
        )

    try:
        parsed = json.loads(data)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON format: {e.msg}") from e

    try:
        check_json_depth(parsed)
    except ValueError as e:
        raise ValueError(f"JSON depth validation failed: {str(e)}") from e

    if not isinstance(parsed, dict):
        raise ValueError(
            f"JSON payload must be an object/dict, got {type(parsed).__name__}"
        )

    cmd_type = parsed.get("type")
    if not cmd_type:
        raise ValueError("JSON payload missing required 'type' field")

    if cmd_type not in ALLOWED_COMMAND_TYPES:
        raise ValueError(
            f"Unknown command type: '{cmd_type}'. "
            f"Allowed commands: {', '.join(sorted(ALLOWED_COMMAND_TYPES))}"
        )

    schema = COMMAND_SCHEMAS.get(cmd_type)
    if schema:
        for field in schema["required"]:
            if field not in parsed:
                raise ValueError(
                    f"Command '{cmd_type}' missing required field: '{field}'"
                )

        for field, value in parsed.items():
            if field in schema["types"]:
                expected_type = schema["types"][field]
                if not isinstance(value, expected_type):
                    raise ValueError(
                        f"Field '{field}' must be of type {expected_type.__name__}, "
                        f"got {type(value).__name__}"
                    )

    return parsed

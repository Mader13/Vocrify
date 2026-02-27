#!/usr/bin/env python3
"""
Transcribe Video - AI Engine
Utility entrypoint for setup checks and model management.

Usage:
    python main.py --download-model sherpa-onnx-diarization --cache-dir <path> --model-type diarization
    python main.py --list-models --cache-dir <path>
    python main.py --delete-model <model_name> --cache-dir <path>
"""

import json
import os
import signal
import sys
from pathlib import Path

# Ensure the engine directory is in sys.path for isolated Python builds.
ENGINE_DIR = Path(__file__).resolve().parent
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

from commands import (
    handle_check_command,
    handle_cancel_download,
    handle_delete_model,
    handle_download_model,
    handle_list_models,
    handle_validate_models,
)
from logger import logger

os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"


def signal_handler(signum, frame):
    """Handle SIGINT/SIGTERM for graceful shutdown."""
    print(
        json.dumps({"type": "error", "message": "Operation interrupted by user"}),
        flush=True,
    )
    sys.exit(1)


signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)


def parse_args():
    """Parse command line arguments."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Transcribe Video AI Engine - Diarization Microservice",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--download-model", type=str, default=None, help="Download a diarization model"
    )
    parser.add_argument(
        "--cache-dir", type=str, default=None, help="Cache directory for model storage"
    )
    parser.add_argument(
        "--model-type",
        type=str,
        default="diarization",
        choices=["diarization"],
    )
    parser.add_argument(
        "--list-models", action="store_true", help="List all installed models"
    )
    parser.add_argument(
        "--delete-model", type=str, default=None, help="Delete a specific model"
    )
    parser.add_argument(
        "--cancel-download",
        type=str,
        default=None,
        help="Cancel an ongoing model download",
    )
    parser.add_argument(
        "--command",
        type=str,
        default=None,
        choices=["check_python", "check_ffmpeg", "check_models", "check_environment"],
        help="Execute a setup wizard command",
    )
    parser.add_argument(
        "--validate-models",
        type=str,
        default=None,
        nargs="?",
        const="",
        metavar="MODEL_NAME",
        help="Validate model availability",
    )
    return parser.parse_args()


COMMANDS = {
    "download_model": lambda args: handle_download_model(args)
    if args.download_model
    else None,
    "list_models": lambda args: handle_list_models(args, logger)
    if args.list_models
    else None,
    "validate_models": lambda args: handle_validate_models(args, logger)
    if args.validate_models is not None
    else None,
    "delete_model": lambda args: handle_delete_model(args, logger)
    if args.delete_model
    else None,
    "cancel_download": lambda args: handle_cancel_download(args)
    if args.cancel_download
    else None,
    "check_command": lambda args: handle_check_command(args) if args.command else None,
}


def main():
    """Main entry point - diarization microservice dispatch."""
    args = parse_args()

    print(
        json.dumps(
            {
                "type": "debug",
                "message": "Python diarization process started",
                "sys_argv": sys.argv,
                "parsed_args": {
                    "download_model": args.download_model,
                    "cache_dir": args.cache_dir,
                },
            }
        ),
        flush=True,
        file=sys.stderr,
    )

    for cmd_name, cmd_handler in COMMANDS.items():
        result = cmd_handler(args)
        if result is not None:
            return result

    from ipc_events import emit_error

    emit_error("No valid command provided. Use --download-model, --list-models, --delete-model, etc.")
    return 1


if __name__ == "__main__":
    sys.exit(main())

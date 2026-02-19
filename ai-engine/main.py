#!/usr/bin/env python3
"""
Transcribe Video - AI Engine
Main entry point for the transcription engine.

Usage:
    python main.py --file <path> --model <model_name> --device <cpu|cuda> --language <lang>
    python main.py --download-model <model_name> --cache-dir <path> --model-type <whisper|parakeet>
    python main.py --list-models --cache-dir <path>
    python main.py --validate-models [--cache-dir <path>] [model_name]
    python main.py --delete-model <model_name> --cache-dir <path>
"""

import json
import os
import signal
import sys
import warnings
from pathlib import Path

# Embeddable/isolated Python builds may not include the script directory in sys.path.
ENGINE_DIR = Path(__file__).resolve().parent
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

from commands import (
    handle_check_command,
    handle_cancel_download,
    handle_delete_model,
    handle_diarize_only,
    handle_download_model,
    handle_list_models,
    handle_server_mode,
    handle_test_mode,
    handle_transcribe,
    handle_validate_models,
)
from logger import logger

os.environ["NEMO_ONE_LOGGER_ERROR_HANDLING_STRATEGY"] = "DISABLE_QUIETLY"
os.environ["NEMO_TESTING"] = "1"
warnings.filterwarnings("ignore", category=RuntimeWarning, module="pydub")
warnings.filterwarnings("ignore", message=".*If you intend to do training.*")
warnings.filterwarnings("ignore", message=".*If you intend to do validation.*")

import logging

logging.basicConfig(stream=sys.stderr, level=logging.WARNING, force=True)
for _logger_name in ("nemo", "nemo_logger", "nemo.collections", "pytorch_lightning"):
    _lib_logger = logging.getLogger(_logger_name)
    _lib_logger.handlers.clear()
    _stderr_handler = logging.StreamHandler(sys.stderr)
    _lib_logger.addHandler(_stderr_handler)
    _lib_logger.propagate = False

os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"


shutdown_requested = False


def signal_handler(signum, frame):
    """Handle SIGINT/SIGTERM for graceful shutdown."""
    global shutdown_requested
    shutdown_requested = True
    print(
        json.dumps({"type": "error", "message": "Operation interrupted by user"}),
        flush=True,
    )
    sys.exit(1)


signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)


SUPPORTED_LANGUAGES = [
    "auto",
    "en",
    "es",
    "fr",
    "de",
    "it",
    "pt",
    "ru",
    "pl",
    "nl",
    "cs",
    "ar",
    "tr",
    "zh",
    "ja",
    "ko",
    "th",
    "vi",
    "id",
    "hi",
    "bn",
    "ta",
    "te",
    "mr",
    "sw",
    "af",
    "sq",
    "hy",
    "az",
    "be",
]


def validate_language(language: str) -> str:
    """Validate language code is supported."""
    if language == "auto" or language.isdigit():
        return language
    if language not in SUPPORTED_LANGUAGES:
        raise ValueError(
            f"Unsupported language: {language}\n"
            f"Supported languages: {', '.join(SUPPORTED_LANGUAGES[:10])}...\n"
            f"See https://github.com/openai/whisper/blob/main/whisper/tokenizer.py"
        )
    return language


def parse_args():
    """Parse command line arguments."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Transcribe Video AI Engine",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--file", type=str, default=None, help="Path to the media file to transcribe"
    )
    parser.add_argument(
        "--model",
        type=str,
        default="whisper-base",
        choices=[
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
        ],
        help="Model to use for transcription",
    )
    parser.add_argument(
        "--device",
        type=str,
        default="auto",
        choices=["auto", "cpu", "cuda", "mps", "vulkan"],
        help="Requested inference device",
    )
    parser.add_argument("--language", type=str, default="auto", help="Language code")
    parser.add_argument(
        "--audio", type=str, default=None, help="Path to audio file (alias for --file)"
    )
    parser.add_argument(
        "--provider", type=str, default=None, help="Diarization provider alias"
    )
    parser.add_argument(
        "--diarize-only", action="store_true", help="Run diarization only"
    )
    parser.add_argument(
        "--transcribe-only", action="store_true", help="Run transcription only"
    )
    parser.add_argument(
        "--diarization",
        action="store_true",
        default=False,
        help="Enable speaker diarization",
    )
    parser.add_argument(
        "--diarization-provider",
        type=str,
        default="none",
        choices=["none", "pyannote", "sherpa-onnx"],
        help="Diarization provider",
    )
    parser.add_argument(
        "--num-speakers", type=int, default=-1, help="Number of speakers"
    )
    parser.add_argument("--test", action="store_true", help="Run in test mode")
    parser.add_argument("--server", action="store_true", help="Run in server mode")
    parser.add_argument(
        "--download-model", type=str, default=None, help="Download a model"
    )
    parser.add_argument(
        "--cache-dir", type=str, default=None, help="Cache directory for model storage"
    )
    parser.add_argument(
        "--model-type",
        type=str,
        default="whisper",
        choices=["whisper", "parakeet", "diarization"],
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
        "--token-file", type=str, default=None, help="Path to HuggingFace token file"
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
    "test": lambda args: handle_test_mode() if args.test else None,
    "server": lambda args: handle_server_mode(
        args, logger, __import__("model_pool").model_pool
    )
    if args.server
    else None,
    "diarize_only": lambda args: handle_diarize_only(args)
    if args.diarize_only
    else None,
    "transcribe": lambda args: handle_transcribe(args, validate_language)
    if args.file or args.audio
    else None,
}


def main():
    """Main entry point with command dispatch."""
    args = parse_args()

    print(
        json.dumps(
            {
                "type": "debug",
                "message": "Python process started",
                "sys_argv": sys.argv,
                "parsed_args": {
                    "download_model": args.download_model,
                    "cache_dir": args.cache_dir,
                    "model_type": args.model_type,
                    "command": args.command,
                    "diarize_only": args.diarize_only,
                    "transcribe_only": args.transcribe_only,
                    "audio": args.audio,
                    "provider": args.provider,
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

    emit_error("--file argument is required")
    return 1


if __name__ == "__main__":
    sys.exit(main())

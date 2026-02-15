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

import argparse
import json
import os
import signal
import sys
import time
import warnings
from pathlib import Path
from typing import Optional

from command_router import handle_server_command
from command_validation import safe_json_loads
from device_utils import normalize_inference_device
from download_service import cancel_model_download, download_model
from environment_checks import (
    check_ffmpeg,
    check_models,
    check_python_environment,
    get_full_environment_status,
)
from ipc_events import emit_error, emit_progress, emit_result
from logger import logger, model_logger, transcription_logger, upload_logger
from model_management_service import delete_model, list_models, validate_models
from model_pool import model_pool
from transcription_service import handle_transcribe_command

# Suppress OneLogger warning from nemo_toolkit before any model imports
os.environ["NEMO_ONE_LOGGER_ERROR_HANDLING_STRATEGY"] = "DISABLE_QUIETLY"

# Suppress noisy NeMo/PyTorch warnings (training data, validation config, etc.)
# These are irrelevant for inference-only usage.
os.environ["NEMO_TESTING"] = "1"
warnings.filterwarnings("ignore", category=RuntimeWarning, module="pydub")
warnings.filterwarnings("ignore", message=".*If you intend to do training.*")
warnings.filterwarnings("ignore", message=".*If you intend to do validation.*")

# Redirect all Python logging to stderr so stdout stays clean for JSON IPC.
import logging

logging.basicConfig(stream=sys.stderr, level=logging.WARNING, force=True)
for _logger_name in ("nemo", "nemo_logger", "nemo.collections", "pytorch_lightning"):
    _lib_logger = logging.getLogger(_logger_name)
    _lib_logger.handlers.clear()
    _stderr_handler = logging.StreamHandler(sys.stderr)
    _lib_logger.addHandler(_stderr_handler)
    _lib_logger.propagate = False

# Disable HuggingFace progress bars to avoid interfering with JSON output
os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
# Disable symlink warning on Windows
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
    if language == "auto":
        return language

    if language.isdigit():
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
    parser = argparse.ArgumentParser(
        description="Transcribe Video AI Engine",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--file", type=str, default=None, help="Path to the media file to transcribe")
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
        help="Requested inference device (auto resolves to best available backend device)",
    )
    parser.add_argument("--language", type=str, default="auto", help="Language code (e.g., 'en', 'ru', 'auto' for auto-detection)")
    parser.add_argument("--audio", type=str, default=None, help="Path to audio file (compatibility alias for --file)")
    parser.add_argument("--provider", type=str, default=None, help="Diarization provider alias (pyannote|sherpa-onnx)")
    parser.add_argument("--diarize-only", action="store_true", help="Run diarization only and emit speaker segments JSON")
    parser.add_argument("--transcribe-only", action="store_true", help="Run transcription only using --audio input (PythonBridge compatibility)")
    parser.add_argument("--diarization", action="store_true", default=False, help="Enable speaker diarization")
    parser.add_argument(
        "--diarization-provider",
        type=str,
        default="none",
        choices=["none", "pyannote", "sherpa-onnx"],
        help="Diarization provider to use (only applies when --diarization is set)",
    )
    parser.add_argument("--num-speakers", type=int, default=-1, help="Number of speakers for sherpa-onnx (-1 for auto-detection)")
    parser.add_argument("--test", action="store_true", help="Run in test mode (prints hello message and exits)")
    parser.add_argument("--server", action="store_true", help="Run in server mode (reads JSON commands from stdin)")
    parser.add_argument("--download-model", type=str, default=None, help="Download a model to the specified cache directory")
    parser.add_argument("--cache-dir", type=str, default=None, help="Cache directory for model storage")
    parser.add_argument("--model-type", type=str, default="whisper", choices=["whisper", "parakeet", "diarization"], help="Type of model to download")
    parser.add_argument("--list-models", action="store_true", help="List all installed models in the cache directory")
    parser.add_argument("--delete-model", type=str, default=None, help="Delete a specific model from the cache directory")
    parser.add_argument("--cancel-download", type=str, default=None, help="Cancel an ongoing model download")
    parser.add_argument("--token-file", type=str, default=None, help="Path to file containing HuggingFace token (more secure than env var)")
    parser.add_argument(
        "--command",
        type=str,
        default=None,
        choices=["check_python", "check_ffmpeg", "check_models", "check_environment"],
        help="Execute a setup wizard command and output JSON result",
    )
    parser.add_argument(
        "--validate-models",
        type=str,
        default=None,
        nargs="?",
        const="",
        metavar="MODEL_NAME",
        help="Validate model availability (optionally specify a specific model name)",
    )
    return parser.parse_args()


def run_diarization_only(args) -> int:
    """Run diarization-only mode for Rust PythonBridge compatibility."""
    from diarization import get_diarizer
    from pydub import AudioSegment

    if not args.audio:
        emit_error("--audio is required for --diarize-only")
        return 1

    audio_path = Path(args.audio)
    if not audio_path.exists():
        emit_error(f"File not found: {args.audio}")
        return 1

    provider = (args.provider or args.diarization_provider or "none").lower()
    if provider == "none":
        emit_error("--provider (pyannote|sherpa-onnx) is required for --diarize-only")
        return 1

    requested_device = normalize_inference_device(args.device)
    diarizer_device = "cuda" if requested_device == "cuda" else "cpu"
    num_speakers = args.num_speakers if args.num_speakers >= 0 else None

    try:
        diarizer = get_diarizer(
            provider=provider,
            device=diarizer_device,
            download_root=args.cache_dir,
            num_speakers=num_speakers,
        )
        if diarizer is None:
            emit_error(f"Unable to initialize diarizer for provider: {provider}")
            return 1

        duration = float(AudioSegment.from_file(str(audio_path)).duration_seconds)
        seed_segments = [{"start": 0.0, "end": max(duration, 0.01), "text": ""}]
        _, speaker_turns = diarizer.diarize(seed_segments, str(audio_path))

        segments = [
            {
                "start": float(turn.start),
                "end": float(turn.end),
                "speaker": str(turn.speaker),
            }
            for turn in speaker_turns
        ]

        print(json.dumps({"type": "segments", "segments": segments}), flush=True)
        return 0
    except Exception as e:
        emit_error(f"Diarization failed: {str(e)}")
        return 1


try:
    import psutil  # type: ignore[reportMissingModuleSource]
except ImportError:
    psutil = None

try:
    import pynvml  # type: ignore

    pynvml.nvmlInit()
    _NVML_HANDLE = pynvml.nvmlDeviceGetHandleByIndex(0)
except Exception:
    pynvml = None
    _NVML_HANDLE = None


def get_system_metrics() -> dict:
    metrics = {}
    if psutil:
        try:
            metrics["cpuUsage"] = round(psutil.cpu_percent(interval=None), 1)
            metrics["memoryUsage"] = round(psutil.virtual_memory().used / (1024 * 1024), 1)
        except Exception:
            pass
    if _NVML_HANDLE and pynvml:
        try:
            util = pynvml.nvmlDeviceGetUtilizationRates(_NVML_HANDLE)
            metrics["gpuUsage"] = float(util.gpu)
        except Exception:
            pass
    return metrics


def build_progress_metrics(
    processed_duration: Optional[float],
    total_duration: Optional[float],
    start_time: Optional[float],
) -> Optional[dict]:
    metrics = get_system_metrics()

    if processed_duration is not None:
        metrics["processedDuration"] = round(processed_duration, 2)
    if total_duration is not None:
        metrics["totalDuration"] = round(total_duration, 2)

    if start_time is not None and processed_duration is not None:
        elapsed = time.time() - start_time
        if elapsed > 0:
            realtime_factor = processed_duration / elapsed
            metrics["realtimeFactor"] = round(realtime_factor, 2)
            if total_duration is not None and realtime_factor > 0:
                remaining = max(total_duration - processed_duration, 0)
                metrics["estimatedTimeRemaining"] = round(remaining / realtime_factor, 2)

    return metrics or None


def run_server_mode():
    """Run in server mode, listening for JSON commands on stdin."""
    import traceback

    logger.info("Preloading models...")
    preload_configs = [{"model_name": "whisper-base", "device": "cpu"}]

    try:
        import torch  # type: ignore[reportMissingImports]

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
            from device_detection import emit_device_info

            emit_device_info()
        except ImportError as e:
            logger.error(f"Failed to import device_detection: {e}")
            emit_error(f"Device detection not available: {str(e)}")
        except Exception as e:
            logger.error(f"Device detection failed: {e}")
            emit_error(f"Failed to detect devices: {str(e)}")

    def _handle_transcribe(command: dict):
        """Transcribe wrapper for command router."""
        handle_transcribe_command(
            command,
            model_pool=model_pool,
            transcription_logger=transcription_logger,
            upload_logger=upload_logger,
            model_logger=model_logger,
            validate_language=validate_language,
            get_system_metrics=get_system_metrics,
            build_progress_metrics=build_progress_metrics,
        )

    for line in sys.stdin:
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
            emit_error(f"JSON validation error: {str(e)}")
        except Exception as e:
            logger.error("Server error", exc=e)
            emit_error(f"Server error: {str(e)}\n{traceback.format_exc()}")

    return 0


def main():
    """Main entry point."""
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

    if args.download_model:
        if not args.cache_dir:
            emit_error("--cache-dir is required for --download-model")
            return 1

        print(
            json.dumps({"type": "debug", "message": "About to call download_model"}),
            flush=True,
        )
        download_model(args.download_model, args.cache_dir, args.model_type, args.token_file)
        print(
            json.dumps({"type": "debug", "message": "download_model returned, exiting main()"}),
            flush=True,
        )
        sys.stdout.flush()
        return 0

    if args.list_models:
        if not args.cache_dir:
            emit_error("--cache-dir is required for --list-models")
            return 1

        list_models(args.cache_dir, logger)
        return 0

    if args.validate_models is not None:
        if not args.cache_dir:
            emit_error("--cache-dir is required for --validate-models")
            return 1

        validate_models(args.cache_dir, logger, args.validate_models if args.validate_models else None)
        return 0

    if args.delete_model:
        if not args.cache_dir:
            emit_error("--cache-dir is required for --delete-model")
            return 1

        delete_model(args.delete_model, args.cache_dir, logger, model_pool)
        return 0

    if args.cancel_download:
        cancel_model_download(args.cancel_download)
        return 0

    if args.command:
        if args.command == "check_python":
            print(json.dumps(check_python_environment()), flush=True)
            return 0
        if args.command == "check_ffmpeg":
            print(json.dumps(check_ffmpeg()), flush=True)
            return 0
        if args.command == "check_models":
            print(json.dumps(check_models(args.cache_dir)), flush=True)
            return 0
        if args.command == "check_environment":
            print(json.dumps(get_full_environment_status(args.cache_dir)), flush=True)
            return 0

    if args.test:
        print(
            json.dumps(
                {
                    "type": "hello",
                    "message": "Hello from AI Engine!",
                    "version": "0.1.0",
                    "python_version": sys.version,
                }
            ),
            flush=True,
        )
        return 0

    if args.server:
        return run_server_mode()

    if args.diarize_only:
        return run_diarization_only(args)

    if args.transcribe_only:
        if not args.audio:
            emit_error("--audio is required for --transcribe-only")
            return 1
        args.file = args.audio

    if not args.file:
        emit_error("--file argument is required")
        return 1

    file_path = Path(args.file)
    if not file_path.exists():
        emit_error(f"File not found: {args.file}")
        return 1

    huggingface_token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_ACCESS_TOKEN")
    if huggingface_token:
        os.environ["HF_TOKEN"] = huggingface_token
        os.environ["HUGGINGFACE_ACCESS_TOKEN"] = huggingface_token
        print(
            json.dumps({"type": "debug", "message": "HuggingFace token loaded from environment"}),
            flush=True,
        )

    if args.diarization and args.diarization_provider == "none":
        emit_error(
            "Diarization is enabled but diarization_provider is set to 'none'. Please specify 'pyannote' or 'sherpa-onnx'"
        )
        return 1

    try:
        emit_progress("loading", 0, f"Loading {args.model} model...")

        effective_device = normalize_inference_device(args.device)
        print(
            json.dumps(
                {
                    "type": "debug",
                    "message": f"Device requested={args.device}, effective={effective_device}",
                }
            ),
            flush=True,
            file=sys.stderr,
        )

        model = model_pool.get_model(
            model_name=args.model,
            device=effective_device,
            download_root=args.cache_dir,
            diarization_provider=args.diarization_provider if args.diarization else "none",
            num_speakers=args.num_speakers,
            vad_provider=args.diarization_provider if args.diarization else "none",
        )

        emit_progress("loading", 20, "Model loaded successfully")

        if args.diarization and hasattr(model, "enable_diarization_mode"):
            print(
                json.dumps(
                    {
                        "type": "debug",
                        "message": "Enabling interval-based transcription for diarization",
                    }
                ),
                flush=True,
                file=sys.stderr,
            )
            model.enable_diarization_mode()

        emit_progress("transcribing", 25, "Starting transcription...")

        segments = model.transcribe(
            file_path=str(file_path),
            language=args.language if args.language != "auto" else None,
        )

        emit_progress("transcribing", 80, "Transcription complete")

        speaker_turns = None
        speaker_segments = None

        if args.diarization:
            emit_progress("diarizing", 85, "Running speaker diarization...")

            segments, speaker_turns_raw = model.diarize(segments, str(file_path))

            if speaker_turns_raw:
                speaker_turns = [
                    {"speaker": turn.speaker, "start": turn.start, "end": turn.end}
                    for turn in speaker_turns_raw
                ]

                if hasattr(model, "split_by_speakers"):
                    speaker_segments = model.split_by_speakers(segments, speaker_turns)
                else:
                    speaker_segments = segments

            emit_progress("diarizing", 95, "Diarization complete")

        emit_progress("finalizing", 98, "Preparing output...")
        emit_result(
            segments,
            language=args.language,
            speaker_turns=speaker_turns,
            speaker_segments=speaker_segments,
        )
        emit_progress("finalizing", 100, "Done!")

        return 0

    except Exception as e:
        emit_error(str(e))
        return 1


if __name__ == "__main__":
    sys.exit(main())

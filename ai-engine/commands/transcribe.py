"""Handle main transcription command."""

import json
import os
import sys
from pathlib import Path

from device_utils import normalize_inference_device
from ipc_events import emit_error, emit_progress, emit_result
from logger import logger
from model_pool import model_pool


def handle_transcribe(args, validate_language) -> int:
    """Handle main transcription flow."""
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

    huggingface_token = os.environ.get("HF_TOKEN") or os.environ.get(
        "HUGGINGFACE_ACCESS_TOKEN"
    )
    if huggingface_token:
        os.environ["HF_TOKEN"] = huggingface_token
        os.environ["HUGGINGFACE_ACCESS_TOKEN"] = huggingface_token
        print(
            json.dumps(
                {
                    "type": "debug",
                    "message": "HuggingFace token loaded from environment",
                }
            ),
            flush=True,
        )

    if args.diarization and args.diarization_provider == "none":
        emit_error(
            "Diarization is enabled but diarization_provider is set to 'none'. "
            "Please specify 'pyannote' or 'sherpa-onnx'"
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
            diarization_provider=args.diarization_provider
            if args.diarization
            else "none",
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

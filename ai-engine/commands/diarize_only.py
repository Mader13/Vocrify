"""Handle --diarize-only command."""

import json
from pathlib import Path

from diarization import get_diarizer
from device_utils import normalize_inference_device
from ipc_events import emit_error


def handle_diarize_only(args) -> int:
    """Run diarization-only mode for Rust PythonBridge compatibility."""
    if not args.audio:
        emit_error("--audio is required for --diarize-only")
        return 1

    audio_path = Path(args.audio)
    if not audio_path.exists():
        emit_error(f"File not found: {args.audio}")
        return 1

    provider = (args.provider or args.diarization_provider or "none").lower()
    if provider == "none":
        emit_error("--provider sherpa-onnx is required for --diarize-only")
        return 1

    requested_device = normalize_inference_device(args.device)
    diarizer_device = "cuda" if requested_device == "cuda" else "cpu"
    num_speakers = args.num_speakers if args.num_speakers >= 0 else None

    try:
        from pydub import AudioSegment

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

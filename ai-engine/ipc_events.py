"""JSON IPC event emitters for AI engine.

All functions in this module print protocol-compatible JSON payloads to stdout.
Keep payload keys and event names backward compatible with existing Rust/Tauri consumers.
"""

from __future__ import annotations

import json
import sys
from typing import Optional


def emit_progress(
    stage: str, progress: int, message: str, metrics: Optional[dict] = None
) -> None:
    """Emit a progress update to stdout as JSON."""
    data = {
        "type": "progress",
        "stage": stage,
        "progress": progress,
        "message": message,
    }
    if metrics:
        data["metrics"] = metrics
    print(json.dumps(data), flush=True)


def emit_download_progress(current: float, total: float, speed_mb_s: float) -> None:
    """Emit download progress update in UI-compatible format."""
    percent = int((current / total * 100) if total > 0 else 0)
    current_mb = current / (1024 * 1024)
    total_mb = total / (1024 * 1024)

    data = {
        "type": "progress",
        "stage": "download",
        "progress": percent,
        "message": f"Downloading... {current_mb:.0f}MB / {total_mb:.0f}MB ({percent}%)",
        "data": {
            "current": current_mb,
            "total": total_mb,
            "percent": percent,
            "speed_mb_s": speed_mb_s,
        },
    }
    print(json.dumps(data), flush=True)


def emit_download_complete(model_name: str, size_mb: int, path: str) -> None:
    """Emit download complete event."""
    data = {
        "type": "DownloadComplete",
        "data": {
            "model_name": model_name,
            "size_mb": size_mb,
            "path": path,
        },
    }
    print(json.dumps(data), flush=True)


def emit_download_stage(
    model_name: str,
    stage: str,
    submodel_name: str,
    current: float,
    total: float,
    percent: int,
    speed_mb_s: float = 0,
) -> None:
    """Emit multi-stage download progress for diarization models."""
    data = {
        "type": "download_stage",
        "data": {
            "model_name": model_name,
            "stage": stage,
            "submodel_name": submodel_name,
            "current": current / (1024 * 1024),
            "total": total / (1024 * 1024),
            "percent": percent,
            "speed_mb_s": speed_mb_s,
        },
    }
    print(json.dumps(data), flush=True)


def emit_models_list(models: list) -> None:
    """Emit list of installed models."""
    data = {
        "type": "models_list",
        "data": models,
    }
    print(json.dumps(data), flush=True)


def emit_validation_results(results: list, cache_dir: str) -> None:
    """Emit model validation results."""
    data = {
        "type": "validation_results",
        "cache_dir": cache_dir,
        "data": results,
    }
    print(json.dumps(data, indent=2), flush=True)


def emit_delete_complete(model_name: str) -> None:
    """Emit delete complete event."""
    data = {
        "type": "delete_complete",
        "data": {
            "model_name": model_name,
        },
    }
    print(json.dumps(data), flush=True)


def emit_result(
    segments,
    language: str = "auto",
    duration: float = 0.0,
    speaker_turns: Optional[list] = None,
    speaker_segments: Optional[list] = None,
) -> None:
    """Emit the final result to stdout as JSON."""
    if duration == 0.0 and segments:
        duration = max(s.get("end", 0) for s in segments)

    data = {
        "type": "result",
        "segments": segments,
        "language": language,
        "duration": duration,
    }

    if speaker_turns is not None:
        data["speakerTurns"] = speaker_turns
        print(
            json.dumps(
                {
                    "type": "debug",
                    "message": f"Emitting {len(speaker_turns)} speaker turns: {speaker_turns[:3]}..."
                    if len(speaker_turns) > 3
                    else f"Emitting {len(speaker_turns)} speaker turns: {speaker_turns}",
                }
            ),
            flush=True,
            file=sys.stderr,
        )
    if speaker_segments is not None:
        data["speaker_segments"] = speaker_segments
        print(
            json.dumps(
                {
                    "type": "debug",
                    "message": f"Emitting {len(speaker_segments)} speaker segments (original had {len(segments)} segments)",
                }
            ),
            flush=True,
            file=sys.stderr,
        )
    else:
        print(
            json.dumps(
                {
                    "type": "debug",
                    "message": "speaker_segments is None - not sending split data",
                }
            ),
            flush=True,
            file=sys.stderr,
        )

    print(json.dumps(data), flush=True)


def emit_error(error: str) -> None:
    """Emit an error to stdout as JSON."""
    data = {
        "type": "error",
        "error": error,
    }
    print(json.dumps(data), flush=True)


def emit_segment(segment: dict, index: int, total: Optional[int] = None) -> None:
    """Emit a single transcription segment to stdout as JSON for streaming."""
    data = {
        "type": "segment",
        "segment": segment,
        "index": index,
        "total": total,
    }
    print(json.dumps(data), flush=True)

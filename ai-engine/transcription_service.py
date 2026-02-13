"""Transcription command handling extracted from main.py."""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Callable

from device_utils import normalize_inference_device
from ipc_events import emit_error, emit_progress, emit_result


def handle_transcribe_command(
    command: dict,
    *,
    model_pool,
    transcription_logger,
    upload_logger,
    model_logger,
    validate_language: Callable[[str], str],
    get_system_metrics: Callable[[], dict],
    build_progress_metrics: Callable,
) -> None:
    """Handle server-mode `transcribe` command while preserving IPC payloads."""
    file_path = command.get("file")
    model_name = command.get("model", "whisper-base")
    requested_device = command.get("device", "auto")
    device = normalize_inference_device(requested_device)
    language = command.get("language", "auto")
    enable_diarization = command.get("diarization", False)
    task_id = command.get("taskId")
    huggingface_token = command.get("huggingfaceToken")
    diarization_provider = command.get("diarization_provider", "none")
    num_speakers = command.get("num_speakers", -1)

    transcription_logger.set_context(
        task_id=task_id,
        file_name=os.path.basename(file_path) if file_path else None,
    )

    if not file_path:
        transcription_logger.error("Missing 'file' parameter")
        emit_error("Missing 'file' parameter")
        return

    print(
        json.dumps(
            {
                "type": "debug",
                "message": (
                    f"Diarization settings: enable={enable_diarization}, "
                    f"provider={diarization_provider}, "
                    f"device_requested={requested_device}, device_effective={device}"
                ),
            }
        ),
        flush=True,
        file=sys.stderr,
    )
    if enable_diarization and diarization_provider == "none":
        transcription_logger.error("Diarization enabled but provider is 'none'")
        emit_error(
            "Diarization is enabled but diarization_provider is set to 'none'. Please specify 'pyannote' or 'sherpa-onnx'"
        )
        return

    if huggingface_token:
        os.environ["HF_TOKEN"] = huggingface_token

    language = command.get("language", "auto")
    try:
        validate_language(language)
    except ValueError as e:
        transcription_logger.error(str(e))
        emit_error(str(e))
        return

    file_obj = Path(file_path)
    if not file_obj.exists():
        transcription_logger.error(f"File not found: {file_path}")
        emit_error(f"File not found: {file_path}")
        return

    upload_logger.file_received(os.path.basename(file_path), file_obj.stat().st_size)
    upload_logger.file_validating(os.path.basename(file_path))

    try:
        transcription_logger.model_loading(model_name, 0)
        emit_progress("loading", 0, f"Loading {model_name} model...")

        actual_provider = diarization_provider if enable_diarization else "none"
        print(
            json.dumps(
                {
                    "type": "debug",
                    "message": f"Calling model_pool.get_model with diarization_provider={actual_provider} (enable={enable_diarization})",
                }
            ),
            flush=True,
            file=sys.stderr,
        )

        model = model_pool.get_model(
            model_name=model_name,
            device=device,
            download_root=command.get("cache_dir"),
            diarization_provider=diarization_provider if enable_diarization else "none",
            num_speakers=num_speakers,
            vad_provider=command.get(
                "vad_provider", diarization_provider if enable_diarization else "none"
            ),
        )

        model_logger.model_loaded(model_name, device)
        emit_progress("loading", 20, "Model loaded successfully")
        transcription_logger.model_loading(model_name, 20)

        if enable_diarization and hasattr(model, "enable_diarization_mode"):
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

        transcription_logger.transcription_start(os.path.basename(file_path), language)
        start_time = time.time()
        emit_progress("transcribing", 25, "Starting transcription...", get_system_metrics())

        segments = model.transcribe(
            file_path=str(file_obj),
            language=language if language != "auto" else None,
        )

        transcription_logger.transcription_complete(0, len(segments))
        processed_duration = max((s.get("end", 0) for s in segments), default=0.0)
        progress_metrics = build_progress_metrics(
            processed_duration, processed_duration, start_time
        )
        emit_progress("transcribing", 80, "Transcription complete", progress_metrics)

        speaker_turns = None
        speaker_segments = None

        if enable_diarization:
            transcription_logger.diarization_start()
            emit_progress(
                "diarizing", 85, "Running speaker diarization...", progress_metrics
            )

            segments, speaker_turns_raw = model.diarize(segments, str(file_obj))

            print(
                json.dumps(
                    {
                        "type": "debug",
                        "message": f"speaker_turns_raw type: {type(speaker_turns_raw).__name__}, length: {len(speaker_turns_raw) if hasattr(speaker_turns_raw, '__len__') else 'N/A'}",
                    }
                ),
                flush=True,
                file=sys.stderr,
            )

            if speaker_turns_raw and hasattr(speaker_turns_raw, "__iter__"):
                first_turns = list(speaker_turns_raw)[:3]
                first_turns_info = []
                for turn in first_turns:
                    if (
                        hasattr(turn, "speaker")
                        and hasattr(turn, "start")
                        and hasattr(turn, "end")
                    ):
                        first_turns_info.append(
                            {
                                "speaker": turn.speaker,
                                "start": turn.start,
                                "end": turn.end,
                            }
                        )
                print(
                    json.dumps(
                        {
                            "type": "debug",
                            "message": f"First {len(first_turns_info)} speaker_turns_raw: {first_turns_info}",
                        }
                    ),
                    flush=True,
                    file=sys.stderr,
                )

            if speaker_turns_raw:
                speaker_turns = [
                    {"speaker": turn.speaker, "start": turn.start, "end": turn.end}
                    for turn in speaker_turns_raw
                ]
                print(
                    json.dumps(
                        {
                            "type": "debug",
                            "message": f"Converted {len(speaker_turns)} speaker turns to dict format",
                        }
                    ),
                    flush=True,
                    file=sys.stderr,
                )

                if hasattr(model, "split_by_speakers"):
                    speaker_segments = model.split_by_speakers(segments, speaker_turns)
                    print(
                        json.dumps(
                            {
                                "type": "debug",
                                "message": f"split_by_speakers returned {len(speaker_segments)} segments",
                            }
                        ),
                        flush=True,
                        file=sys.stderr,
                    )
                    print(
                        json.dumps(
                            {
                                "type": "debug",
                                "message": "Using split_by_speakers method",
                            }
                        ),
                        flush=True,
                        file=sys.stderr,
                    )
                else:
                    speaker_segments = segments
                    print(
                        json.dumps(
                            {
                                "type": "debug",
                                "message": f"Using {len(segments)} segments with speaker labels as speaker_segments",
                            }
                        ),
                        flush=True,
                        file=sys.stderr,
                    )
                    print(
                        json.dumps(
                            {
                                "type": "debug",
                                "message": "Using fallback method (segments with speaker labels)",
                            }
                        ),
                        flush=True,
                        file=sys.stderr,
                    )

            unique_speakers = set(s.get("speaker") for s in segments if s.get("speaker"))
            transcription_logger.diarization_complete(len(unique_speakers))
            emit_progress("diarizing", 95, "Diarization complete", progress_metrics)

        speaker_turns_count = len(speaker_turns) if speaker_turns is not None else 0
        speaker_segments_count = (
            len(speaker_segments) if speaker_segments is not None else 0
        )
        print(
            json.dumps(
                {
                    "type": "debug",
                    "message": f"Final counts - speaker_turns: {speaker_turns_count}, speaker_segments: {speaker_segments_count}",
                }
            ),
            flush=True,
            file=sys.stderr,
        )
        if speaker_segments and len(speaker_segments) > 0:
            first_3_segments = speaker_segments[:3]
            first_3_with_speaker = []
            for seg in first_3_segments:
                if isinstance(seg, dict):
                    text_val = seg.get("text", "")
                    if text_val and len(text_val) > 50:
                        text_val = text_val[:50] + "..."
                    first_3_with_speaker.append(
                        {
                            "speaker": seg.get("speaker"),
                            "start": seg.get("start"),
                            "end": seg.get("end"),
                            "text": text_val,
                        }
                    )
            print(
                json.dumps(
                    {
                        "type": "debug",
                        "message": f"First 3 speaker_segments with speaker field: {first_3_with_speaker}",
                    }
                ),
                flush=True,
                file=sys.stderr,
            )

        duration = max((s.get("end", 0) for s in segments), default=0.0)
        progress_metrics = build_progress_metrics(duration, duration, start_time)
        emit_progress("finalizing", 98, "Preparing output...", progress_metrics)
        emit_result(
            segments,
            language=language,
            duration=duration,
            speaker_turns=speaker_turns,
            speaker_segments=speaker_segments,
        )
        emit_progress("finalizing", 100, "Done!", progress_metrics)
        transcription_logger.info("Transcription completed successfully")

    except Exception as e:
        transcription_logger.error("Transcription failed", exc=e)
        emit_error(str(e))

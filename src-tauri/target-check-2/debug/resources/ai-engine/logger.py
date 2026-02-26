"""
Logging utility for AI engine
"""

import json
import logging
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Optional


class Logger:
    """Structured logger for AI engine with JSON output."""

    def __init__(self, name: str = "ai-engine", level: str = "INFO"):
        self.name = name
        self.logger = logging.getLogger(name)
        self.logger.setLevel(getattr(logging, level.upper(), logging.INFO))

        # Console handler with plain formatting for development
        console_handler = logging.StreamHandler(sys.stderr)
        console_handler.setLevel(logging.DEBUG)
        formatter = logging.Formatter(
            "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
        )
        console_handler.setFormatter(formatter)
        self.logger.addHandler(console_handler)

        # File handler for persistent logs
        log_dir = Path.home() / ".vocrify" / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        log_file = log_dir / f"{name}.log"

        file_handler = logging.FileHandler(log_file)
        file_handler.setLevel(logging.DEBUG)
        file_formatter = logging.Formatter(
            "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
        )
        file_handler.setFormatter(file_formatter)
        self.logger.addHandler(file_handler)

        self._task_id: Optional[str] = None
        self._file_name: Optional[str] = None

    def set_context(
        self, task_id: Optional[str] = None, file_name: Optional[str] = None
    ):
        """Set logging context for task and file."""
        self._task_id = task_id
        self._file_name = file_name

    def _format_message(self, message: str) -> str:
        """Format message with context."""
        parts = [message]
        if self._task_id:
            parts.insert(0, f"[task:{self._task_id}]")
        if self._file_name:
            parts.insert(0, f"[file:{self._file_name}]")
        return " ".join(parts)

    def debug(self, message: str, data: Optional[Any] = None):
        """Log debug message."""
        self.logger.debug(self._format_message(message), extra={"data": data})
        if data:
            self._emit_log("debug", message, data)

    def info(self, message: str, data: Optional[Any] = None):
        """Log info message."""
        self.logger.info(self._format_message(message), extra={"data": data})
        if data:
            self._emit_log("info", message, data)

    def warning(self, message: str, data: Optional[Any] = None):
        """Log warning message."""
        self.logger.warning(self._format_message(message), extra={"data": data})
        self._emit_log("warning", message, data)

    def error(
        self, message: str, data: Optional[Any] = None, exc: Optional[Exception] = None
    ):
        """Log error message."""
        self.logger.error(
            self._format_message(message), exc_info=exc, extra={"data": data}
        )
        self._emit_log("error", message, data, str(exc) if exc else None)

    def _emit_log(
        self,
        level: str,
        message: str,
        data: Optional[Any] = None,
        error: Optional[str] = None,
    ):
        """Emit log as JSON to stdout for frontend consumption."""
        log_data = {
            "type": "log",
            "level": level,
            "category": "system",
            "message": message,
        }

        if data:
            log_data["data"] = data
        if error:
            log_data["error"] = error
        if self._task_id:
            log_data["taskId"] = self._task_id
        if self._file_name:
            log_data["fileName"] = self._file_name
        log_data["timestamp"] = datetime.utcnow().isoformat()

        print(json.dumps(log_data), flush=True)


class TranscriptionLogger(Logger):
    """Logger for transcription-specific events."""

    def __init__(self):
        super().__init__("transcription", level="INFO")

    def _emit_log(
        self,
        level: str,
        message: str,
        data: Optional[Any] = None,
        error: Optional[str] = None,
    ):
        """Emit transcription log."""
        log_data = {
            "type": "log",
            "level": level,
            "category": "transcription",
            "message": message,
        }

        if data:
            log_data["data"] = data
        if error:
            log_data["error"] = error
        if self._task_id:
            log_data["taskId"] = self._task_id
        if self._file_name:
            log_data["fileName"] = self._file_name
        log_data["timestamp"] = datetime.utcnow().isoformat()

        print(json.dumps(log_data), flush=True)

    def model_loading(self, model_name: str, progress: int):
        """Log model loading progress."""
        self.info(f"Loading model {model_name}", {"progress": progress})

    def transcription_start(self, file_name: str, language: Optional[str]):
        """Log transcription started."""
        self.info(f"Starting transcription for {file_name}", {"language": language})

    def transcription_progress(self, progress: float, speed: Optional[float] = None):
        """Log transcription progress."""
        data = {"progress": progress}
        if speed:
            data["speed"] = f"{speed:.2f}x"
        self.info("Transcribing...", data)

    def transcription_complete(self, duration: float, segments_count: int):
        """Log transcription completion."""
        self.info(
            f"Transcription complete: {segments_count} segments",
            {"duration": duration, "segmentsCount": segments_count},
        )

    def diarization_start(self):
        """Log diarization started."""
        self.info("Starting speaker diarization")

    def diarization_complete(self, speakers_count: int):
        """Log diarization completion."""
        self.info(
            f"Diarization complete: {speakers_count} speakers detected",
            {"speakersCount": speakers_count},
        )


class UploadLogger(Logger):
    """Logger for upload/file operations."""

    def __init__(self):
        super().__init__("upload", level="INFO")

    def _emit_log(
        self,
        level: str,
        message: str,
        data: Optional[Any] = None,
        error: Optional[str] = None,
    ):
        """Emit upload log."""
        log_data = {
            "type": "log",
            "level": level,
            "category": "upload",
            "message": message,
        }

        if data:
            log_data["data"] = data
        if error:
            log_data["error"] = error
        if self._task_id:
            log_data["taskId"] = self._task_id
        if self._file_name:
            log_data["fileName"] = self._file_name
        log_data["timestamp"] = datetime.utcnow().isoformat()

        print(json.dumps(log_data), flush=True)

    def file_received(self, file_name: str, file_size: int):
        """Log file received."""
        self.info(f"File received: {file_name}", {"fileSize": file_size})

    def file_validating(self, file_name: str):
        """Log file validation."""
        self.debug(f"Validating file: {file_name}")

    def file_valid(self, file_name: str, duration: float):
        """Log valid file."""
        self.info(f"File valid: {file_name}", {"duration": duration})

    def file_invalid(self, file_name: str, reason: str):
        """Log invalid file."""
        self.error(f"File invalid: {file_name}", {"reason": reason})


class ModelLogger(Logger):
    """Logger for model-related operations."""

    def __init__(self):
        super().__init__("model", level="INFO")

    def _emit_log(
        self,
        level: str,
        message: str,
        data: Optional[Any] = None,
        error: Optional[str] = None,
    ):
        """Emit model log."""
        log_data = {
            "type": "log",
            "level": level,
            "category": "model",
            "message": message,
        }

        if data:
            log_data["data"] = data
        if error:
            log_data["error"] = error
        log_data["timestamp"] = datetime.utcnow().isoformat()

        print(json.dumps(log_data), flush=True)

    def download_start(self, model_name: str, repo: str):
        """Log model download started."""
        self.info(f"Starting download: {model_name}", {"repo": repo})

    def download_progress(
        self, model_name: str, progress: int, speed: Optional[float] = None
    ):
        """Log download progress."""
        data = {"progress": progress}
        if speed:
            data["speed"] = f"{speed:.2f} MB/s"
        self.debug(f"Downloading {model_name}", data)

    def download_complete(self, model_name: str, size_mb: int):
        """Log download complete."""
        self.info(f"Download complete: {model_name}", {"sizeMb": size_mb})

    def model_loaded(self, model_name: str, device: str):
        """Log model loaded."""
        self.info(f"Model loaded: {model_name}", {"device": device})

    def model_error(self, model_name: str, error: str):
        """Log model error."""
        self.error(f"Model error: {model_name}", {"error": error})


# Global logger instances
logger = Logger()
transcription_logger = TranscriptionLogger()
upload_logger = UploadLogger()
model_logger = ModelLogger()

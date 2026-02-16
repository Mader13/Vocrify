"""Command handlers for AI Engine CLI."""

from .check_commands import handle_check_command
from .cancel_download import handle_cancel_download
from .delete_model import handle_delete_model
from .diarize_only import handle_diarize_only
from .download_model import handle_download_model
from .list_models import handle_list_models
from .server_mode import handle_server_mode
from .test_mode import handle_test_mode
from .transcribe import handle_transcribe
from .validate_models import handle_validate_models

__all__ = [
    "handle_check_command",
    "handle_cancel_download",
    "handle_delete_model",
    "handle_diarize_only",
    "handle_download_model",
    "handle_list_models",
    "handle_server_mode",
    "handle_test_mode",
    "handle_transcribe",
    "handle_validate_models",
]

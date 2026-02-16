"""Handle --list-models command."""

from ipc_events import emit_error
from model_management_service import list_models


def handle_list_models(args, logger) -> int:
    """List all installed models in the cache directory."""
    if not args.cache_dir:
        emit_error("--cache-dir is required for --list-models")
        return 1

    list_models(args.cache_dir, logger)
    return 0

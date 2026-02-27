"""Handle --delete-model command."""

from ipc_events import emit_error
from model_management_service import delete_model


def handle_delete_model(args, logger) -> int:
    """Delete a specific model from the cache directory."""
    if not args.cache_dir:
        emit_error("--cache-dir is required for --delete-model")
        return 1

    success = delete_model(args.delete_model, args.cache_dir, logger)
    return 0 if success else 1

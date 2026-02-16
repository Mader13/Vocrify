"""Handle --validate-models command."""

from ipc_events import emit_error
from model_management_service import validate_models


def handle_validate_models(args, logger) -> int:
    """Validate model availability (optionally specify a specific model name)."""
    if not args.cache_dir:
        emit_error("--cache-dir is required for --validate-models")
        return 1

    validate_models(
        args.cache_dir, logger, args.validate_models if args.validate_models else None
    )
    return 0

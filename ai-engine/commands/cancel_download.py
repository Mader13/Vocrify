"""Handle --cancel-download command."""

from download_service import cancel_model_download


def handle_cancel_download(args) -> int:
    """Cancel an ongoing model download."""
    cancel_model_download(args.cancel_download)
    return 0

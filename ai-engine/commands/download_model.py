"""Handle --download-model command."""

import json
import sys
from download_service import download_model
from ipc_events import emit_error


def handle_download_model(args) -> int:
    """Download a model to the specified cache directory."""
    if not args.cache_dir:
        emit_error("--cache-dir is required for --download-model")
        return 1

    print(
        json.dumps({"type": "debug", "message": "About to call download_model"}),
        flush=True,
    )
    download_model(
        args.download_model, args.cache_dir, args.model_type, args.token_file
    )
    print(
        json.dumps(
            {"type": "debug", "message": "download_model returned, exiting main()"}
        ),
        flush=True,
    )
    sys.stdout.flush()
    return 0

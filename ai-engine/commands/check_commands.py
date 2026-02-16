"""Handle --command check commands."""

import json
from environment_checks import (
    check_ffmpeg,
    check_models,
    check_python_environment,
    get_full_environment_status,
)


def handle_check_command(args) -> int:
    """Execute a setup wizard command and output JSON result."""
    if args.command == "check_python":
        print(json.dumps(check_python_environment()), flush=True)
        return 0
    if args.command == "check_ffmpeg":
        print(json.dumps(check_ffmpeg()), flush=True)
        return 0
    if args.command == "check_models":
        print(json.dumps(check_models(args.cache_dir)), flush=True)
        return 0
    if args.command == "check_environment":
        print(json.dumps(get_full_environment_status(args.cache_dir)), flush=True)
        return 0
    return 1

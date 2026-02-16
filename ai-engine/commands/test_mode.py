"""Handle --test command."""

import json
import sys


def handle_test_mode() -> int:
    """Run in test mode (prints hello message and exits)."""
    print(
        json.dumps(
            {
                "type": "hello",
                "message": "Hello from AI Engine!",
                "version": "0.1.0",
                "python_version": sys.version,
            }
        ),
        flush=True,
    )
    return 0

#!/usr/bin/env python3
"""Fix emit_progress_wrapper bug in downloader.py"""

# Read the file
with open('downloader.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Old buggy code
old_code = '''def emit_progress_wrapper(progress: DownloadProgress):
    """Wrapper to emit progress in format expected by main.py/UI"""
    # Map downloader stages to UI-expected stages
    stage_mapping = {
        "initializing": "ready",
        "checking_disk": "download",
        "downloading": "download",
        "verifying": "download",
        "extract": "download",
        # "complete": "download",  # Will send 100% progress
    }

    # Map stage to UI-compatible value
    ui_stage = stage_mapping.get(progress.stage, progress.stage)'''

# New fixed code
new_code = '''def emit_progress_wrapper(progress: DownloadProgress):
    """Wrapper to emit progress in format expected by main.py/UI"""
    # Map downloader stages to UI-expected stages
    # NOTE: Only map intermediate stages, let final "complete" stage pass through
    if progress.stage == "complete":
        # For download completion, let the caller handle the special DownloadComplete event
        # Don't remap "complete" to "download" - this was causing the bug!
        ui_stage = progress.stage
    else:
        stage_mapping = {
            "initializing": "ready",
            "checking_disk": "download",
            "downloading": "download",
            "verifying": "download",
            "extract": "download",
        }
        # Map stage to UI-compatible value
        ui_stage = stage_mapping.get(progress.stage, progress.stage)'''

# Replace
if old_code in content:
    content = content.replace(old_code, new_code)
    with open('downloader.py', 'w', encoding='utf-8') as f:
        f.write(content)
    print('Successfully fixed emit_progress_wrapper!')
else:
    print('Pattern not found - may already be fixed or file changed')

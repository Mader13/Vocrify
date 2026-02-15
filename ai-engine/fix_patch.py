import re

with open("downloader.py", "r", encoding="utf-8") as f:
    content = f.read()

# Find the emit_progress_wrapper function
pattern = r"(def emit_progress_wrapper\(progress: DownloadProgress\):.*?\"\"\"Wrapper to emit progress in format expected by main\.py/UI\"\"\".*?stage_mapping = \{[^}]+\}.*?ui_stage = stage_mapping\.get\(progress\.stage, progress\.stage\))"

match = re.search(pattern, content, re.DOTALL)
if match:
    print("Found buggy code at position", match.start())
    # Replace with fixed version
    fixed = '''def emit_progress_wrapper(progress: DownloadProgress):
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
    
    new_content = content[:match.start()] + fixed + content[match.end():]
    with open("downloader.py", "w", encoding="utf-8") as f:
        f.write(new_content)
    print("Fixed!")
else:
    print("Pattern not found")

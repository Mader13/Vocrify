---
phase: quick-remove-faster-whisper
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - ai-engine/pyproject.toml
  - ai-engine/requirements.txt
autonomous: true

must_haves:
  truths:
    - 'faster-whisper removed from Python dependencies'
    - 'Documentation no longer references faster-whisper'
  artifacts:
    - path: 'ai-engine/pyproject.toml'
      provides: 'Python package dependencies'
      contains: 'faster-whisper'
    - path: 'ai-engine/requirements.txt'
      provides: 'pip install instructions'
      contains: 'faster-whisper'
---

<objective>
Remove faster-whisper from Python backend - keep only diarization

Purpose: Since transcription is now handled by Rust transcribe-rs, the Python backend should only contain diarization code. Remove all faster-whisper references.

Output: Clean Python dependencies focused only on diarization
</objective>

<context>
@ai-engine/pyproject.toml
@ai-engine/requirements.txt
</context>

<tasks>

<task type="auto">
  <name>Task 1: Remove faster-whisper from pyproject.toml</name>
  <files>ai-engine/pyproject.toml</files>
  <action>Remove "faster-whisper==1.2.1" from the dependencies list in pyproject.toml. Keep all other dependencies (torch, pyannote.audio, etc.) since they're needed for diarization.</action>
  <verify>grep -q "faster-whisper" ai-engine/pyproject.toml should return no results</verify>
  <done>faster-whisper no longer in pyproject.toml dependencies</done>
</task>

<task type="auto">
  <name>Task 2: Update requirements.txt comments</name>
  <files>ai-engine/requirements.txt</files>
  <action>Remove or update all comments mentioning faster-whisper:
- Line 42: "required by faster-whisper" -> remove mention
- Line 128: "faster-whisper and pyannote.audio" conflicts -> update to just pyannote.audio
- Line 156: "Python 3.13+: NOT supported (faster-whisper" -> update to just pyannote.audio
- Line 159: "faster-whisper 1.0.3: Stable, well-tested version" -> remove line</action>
  <verify>grep -i "faster.whisper" ai-engine/requirements.txt should return no results</verify>
  <done>All faster-whisper mentions removed from requirements.txt</done>
</task>

</tasks>

<verification>
- [ ] pyproject.toml no longer lists faster-whisper as dependency
- [ ] requirements.txt has no faster-whisper mentions in comments
- [ ] Dependencies still include diarization requirements (pyannote.audio, sherpa-onnx, torch)
</verification>

<success_criteria>
Python backend dependencies focused only on diarization - no faster-whisper references remain
</success_criteria>

<output>
After completion, create .planning/quick/1-remove-faster-whisper-from-python-backen/1-SUMMARY.md
</output>

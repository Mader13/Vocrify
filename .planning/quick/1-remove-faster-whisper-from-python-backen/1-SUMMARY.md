---
phase: quick-remove-faster-whisper
plan: '01'
type: execute
wave: 1
subsystem: ai-engine
tags: [python, dependencies, cleanup, diarization]
dependency_graph:
  requires: []
  provides: [python-diarization-only]
  affects: [ai-engine/pyproject.toml, ai-engine/requirements.txt]
tech_stack:
  added: []
  removed: [faster-whisper]
  patterns: [dependency-cleanup]
key_files:
  created: []
  modified:
    - ai-engine/pyproject.toml
    - ai-engine/requirements.txt
decisions:
  - 'Python backend now focused on diarization only - transcription handled by Rust transcribe-rs'
metrics:
  duration: ''
  completed: 2026-02-15
  tasks_completed: 2
  files_modified: 2
---

# Quick Task: Remove faster-whisper from Python Backend Summary

## Overview

Removed faster-whisper from Python backend dependencies. Since transcription is now handled by Rust transcribe-rs, the Python backend should only contain diarization code.

## Completed Tasks

| Task | Name                                      | Commit  | Files                      |
| ---- | ----------------------------------------- | ------- | -------------------------- |
| 1    | Remove faster-whisper from pyproject.toml | 7946f2c | ai-engine/pyproject.toml   |
| 2    | Update requirements.txt comments          | 7946f2c | ai-engine/requirements.txt |

## Changes Made

### ai-engine/pyproject.toml

- Removed `"faster-whisper==1.2.1"` from dependencies list
- Kept all diarization dependencies (torch, pyannote.audio, etc.)

### ai-engine/requirements.txt

- Updated line 42: Removed "required by faster-whisper" from PyTorch comment
- Updated line 128: Removed "faster-whisper and pyannote.audio" conflict warning
- Updated line 156: Removed "faster-whisper" from Python 3.13+ incompatibility note
- Removed line 159: Removed "faster-whisper 1.0.3: Stable, well-tested version"

## Verification

- [x] pyproject.toml no longer lists faster-whisper as dependency
- [x] requirements.txt has no faster-whisper mentions in comments
- [x] Dependencies still include diarization requirements (pyannote.audio, sherpa-onnx, torch)

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- [x] ai-engine/pyproject.toml modified - verified
- [x] ai-engine/requirements.txt modified - verified
- [x] Commit 7946f2c exists - verified

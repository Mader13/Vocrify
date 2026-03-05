# Changelog

All notable changes to Vocrify are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [v1.0.0] - 2026-03-05

### Added

- Rust-native transcription engine via `transcribe-rs` (Whisper, Parakeet, Moonshine)
- Native speaker diarization via Sherpa-ONNX (`sherpa-rs`)
- GPU acceleration with automatic device selection: CUDA > MPS > Vulkan > CPU
- Multi-file queue with concurrent transcription support
- Waveform visualization with speaker region highlighting (WaveSurfer.js)
- Export to TXT, SRT, VTT, JSON formats
- Archive mode with optional video deletion after transcription
- Setup Wizard for first-run configuration (FFmpeg, models)
- Portable build option (no installer)
- Cross-platform: Windows (x64), macOS (Apple Silicon), Linux (x64)

### Technical

- Tauri 2 + React 19 + TypeScript + Tailwind CSS 4 + Zustand
- Content Security Policy configured for production
- 110 frontend unit tests (Vitest)

# Changelog

All notable changes to Vocrify are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [v1.0.1] - 2026-03-12

### RU

#### Что нового

Vocrify 1.0.1 — это точечное обновление стабильности. Релиз улучшает надежность архивации, воспроизведение архивных медиафайлов и поведение drag-and-drop без изменений основного пользовательского сценария.

#### Исправления

- Архивные задачи теперь сохраняют корректные ссылки на медиафайлы после переноса в архив
- Для архивного аудио и видео улучшен fallback, если прямой доступ к asset-источнику недоступен
- Архивы в режиме `text_only` корректно показывают состояние без медиа вместо попытки запустить воспроизведение
- Drop zone больше не удерживает устаревшие native-listeners после повторного рендера
- Экран завершенной расшифровки получил небольшие улучшения редактирования заголовка и поведения layout

#### Проверка

- Для релиза успешно пройдены `bunx tsc --noEmit`, `bun run lint` и `bun run test` (`123/123`)
- Rust-проверки также пройдены: `cargo test --lib` (`67/67`)
- Установщики Windows пересобраны для версии `1.0.1` через `bun run tauri:build`
- Артефакты релиза: `Vocrify_1.0.1_x64-setup.exe`, `Vocrify_1.0.1_x64_en-US.msi`

### EN

#### What's New

Vocrify 1.0.1 is a focused stability patch. This release improves archive reliability, archived media playback, and drag-and-drop behavior without changing the core user workflow.

#### Fixes

- Archived tasks now keep consistent media pointers after content is moved into the archive
- Archived audio and video playback now falls back more reliably when direct asset loading is unavailable
- `text_only` archives now show the no-media state correctly instead of attempting playback
- The drop zone no longer keeps stale native listeners after re-render
- The completed transcription view received small UX polish around title editing and layout behavior

#### Verification

- Frontend validation passed with `bunx tsc --noEmit`, `bun run lint`, and `bun run test` (`123/123`)
- Rust library validation also passed with `cargo test --lib` (`67/67`)
- Windows installers were rebuilt for `1.0.1` with `bun run tauri:build`
- Release artifacts: `Vocrify_1.0.1_x64-setup.exe`, `Vocrify_1.0.1_x64_en-US.msi`

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

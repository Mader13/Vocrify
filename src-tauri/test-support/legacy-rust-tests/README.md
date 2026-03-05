# Legacy Rust Tests (archived)

В этой папке лежат исторические/черновые Rust-тесты, которые **не входят** в текущий `cargo test`.

## Почему архив

- часть файлов была написана под старый API;
- некоторые содержали невалидный Rust-синтаксис и создавали шум в редакторе;
- прямое подключение к текущему crate могло ломать CI.

## Что запускать сейчас

Актуальные unit-тесты:

- `src-tauri/src/audio/audio_tests.rs`
- `src-tauri/src/tests/*.rs` (подключаются из `src-tauri/src/lib.rs`)
- модульные `#[cfg(test)] mod tests` в стабильных модулях (например, `post_processing.rs`)

Тесты для `TranscriptionManager` вынесены в `src-tauri/src/tests/transcription_manager_tests.rs`.

## Примечание

`lib_tests.rs` был перемещён в markdown-архив (`lib_tests.legacy.md`), чтобы невалидный синтаксис не отображался как ошибка кода.

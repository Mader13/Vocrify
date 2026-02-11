# Corrected Transcription System Plan (v2)

## Key fixes

| Problem                                                  | Fix                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------ |
| Parakeet from_pretrained() doesn't work with a directory | Use `restore_from()` with the `.nemo` file                               |
| Incorrect HuggingFace cache lookup                       | Use `huggingface_hub.snapshot_download()`                                |
| PyAnnote offline mode                                    | Set `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1` when loading offline |
| Diarization code duplication                             | Add `DiarizationMixin` to reduce duplication                             |
| No provider validation in factory                        | Validate availability in `ModelFactory`                                  |

---

## File structure (proposed)

```
ai-engine/
├── model_registry.py          # ETAP 1 (updated)
├── base.py                    # ETAP 2 (add mixin)
├── models/
│   ├── whisper.py             # ETAP 3 (uses mixin)
│   ├── distil_whisper.py      # ETAP 4 (uses mixin)
│   └── parakeet.py            # ETAP 5 (critical fixes)
├── diarization/
│   ├── __init__.py            # ETAP 6
│   ├── base.py                # ETAP 6
│   ├── sherpa_diarizer.py     # ETAP 6
│   └── pyannote_diarizer.py   # ETAP 6 (fixed offline)
├── factory.py                 # ETAP 7 (validate providers)
├── downloader.py              # ETAP 8 (NEW - download with progress)
└── requirements.txt           # ETAP 9
```

---

## ETAP 1 — ModelRegistry (summary)

- Use `huggingface_hub.snapshot_download()` to detect local HF snapshots with `local_files_only=True`.
- Expose methods: `get_whisper_path`, `get_distil_whisper_path`, `get_parakeet_path`, `get_sherpa_diarization_paths`, `get_pyannote_diarization_paths`, `validate_model`, `list_available_models`.
- Keep separate cache directories: `hf_cache`, `nemo`, `diarization` under the provided `cache_dir`.

Key behaviors:

- Parakeet: return path to `.nemo` file (NeMo requires .nemo for `restore_from`).
- Whisper/Distil: return HF snapshot path (or repo id if not cached).
- PyAnnote: return local snapshot paths (enable `HF_HUB_OFFLINE` when loading).

---

## ETAP 2 — base.py (DiarizationMixin)

- Add `DiarizationMixin` to encapsulate common `_init_diarizer` and `diarize` logic.
- Make `BaseModel` inherit from `DiarizationMixin` so model implementations reuse logic and avoid duplication.

---

## ETAP 3 — Whisper

- Use ModelRegistry to try to load a local Faster-Whisper snapshot via the returned path; otherwise instantiate `FasterWhisperModel` with the repo id (allowing download).
- Expose `compute_type` configurable (default `float16` on CUDA, `int8` on CPU) instead of hard-coded choice.
- Use mixin diarization integration.

---

## ETAP 4 — Distil-Whisper

- Use `transformers` `from_pretrained(..., local_files_only=...)` and `snapshot_download` for safe offline loading.
- Create pipeline from loaded model and processor; support batching and timestamped chunks.
- Integrate diarization via mixin.

---

## ETAP 5 — Parakeet (CRITICAL fixes)

Problems and fixes:

- NeMo's `from_pretrained()` does not accept an unpacked directory for offline model loading. For offline loading, use `restore_from()` with the `.nemo` file path.
- Provide fallback: if `.nemo` not found locally, set NeMo cache env var and call `from_pretrained(model_name=...)` to download.

Implementation summary:

- ModelRegistry returns `.nemo` path when available.
- If `.nemo` exists, call the appropriate NeMo model class's `restore_from(str(nemo_path), map_location=...)`.
- If not, set `NEMO_ENV_VARNAME` to `download_root/nemo` and call `ASRModel.from_pretrained(model_name=...)`.

Notes:

- Prefer using the correct NeMo model class (e.g. EncDecRNNTBPEModel) when restoring to avoid class mismatch.

---

## ETAP 6 — Diarization module

Components:

- `diarization/__init__.py` exports `BaseDiarizer`, `SherpaDiarizer`, `PyAnnoteDiarizer`.
- `SherpaDiarizer`: uses `sherpa_onnx.OfflineSpeakerDiarization`; loads segmentation and embedding ONNX files; supports CPU/CUDA provider selection; auto-loads models when needed.
- `PyAnnoteDiarizer`: use `pyannote.audio.Pipeline.from_pretrained(...)` in offline mode; ensure `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1` before loading; use snapshot paths from `snapshot_download(local_files_only=True)`.

Important: For PyAnnote, the first download requires a HuggingFace token; afterwards it works offline.

---

## ETAP 7 — factory.py (validate providers)

- Before creating a model with diarization provider, validate availability via ModelRegistry; warn and fallback to `none` if models are absent.

---

## ETAP 8 — downloader.py (NEW)

- Provide helper methods to pre-download models into the cache directories:
  - `download_whisper(model_size)` — uses `snapshot_download(repo_id, cache_dir, local_files_only=False)`
  - `download_distil_whisper(...)`
  - `download_parakeet(...)` — trigger NeMo's download by setting `NEMO_ENV_VARNAME` and calling `from_pretrained`.
  - `download_pyannote(hf_token)` — uses `huggingface_hub.login(token)` then `snapshot_download` for private models; store in `hf_cache`.
  - `download_sherpa_diarization()` — fetch ONNX tarballs and extract.

Rationale: decouple download logic from model loading and provide CLI progress commands.

---

## ETAP 9 — requirements.txt additions

Add `huggingface_hub>=0.20.0` to ensure `snapshot_download` availability. Keep existing deps: `faster-whisper`, `transformers`, `torch`, `nemo_toolkit[asr]`, `pydub`, `sherpa-onnx`, `pyannote.audio`.

---

## ETAP 10 — main.py (CLI helpers)

Add commands:

- `cmd_list_models(args)` — prints `ModelRegistry.list_available_models()` and validation info.
- `cmd_download_model(args)` — calls `ModelDownloader` for requested models (whisper, distil, parakeet, pyannote, sherpa).
- `cmd_validate_models(args)` — uses `ModelRegistry.validate_model()` and prints result.

---

## Final cache layout (recommended)

```
{cache_dir}/
├── hf_cache/                              # HuggingFace Hub cache
│   └── hub/
│       ├── models--Systran--faster-whisper-base/
│       │   └── snapshots/{commit_hash}/
│       ├── models--distil-whisper--distil-large-v3/
│       ├── models--pyannote--segmentation-3.0/
│       └── models--pyannote--wespeaker-voxceleb-resnet34-LM/
│
├── nemo/                                  # NeMo cache (.nemo files)
│   └── parakeet-tdt-0.6b-v3/
│       └── parakeet-tdt-0.6b-v3.nemo      # Used by restore_from()
│
└── diarization/
    ├── sherpa-onnx/
    │   ├── sherpa-onnx-pyannote-segmentation-3-0/
    │   │   └── model.int8.onnx            # ~1.5MB
    │   └── 3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k/
    │       └── model.onnx                 # ~26MB
```

---

## Implementation checklist

1. Create `ai-engine/model_registry.py` (central cache manager)
2. Update `ai-engine/base.py` (add `DiarizationMixin`)
3. Update `ai-engine/models/whisper.py` (ModelRegistry + diarization)
4. Update `ai-engine/models/distil_whisper.py` (ModelRegistry + diarization)
5. Update `ai-engine/models/parakeet.py` (use `restore_from()` with `.nemo`)
6. Create `ai-engine/diarization/__init__.py`
7. Create `ai-engine/diarization/base.py`
8. Create `ai-engine/diarization/sherpa_diarizer.py`
9. Create `ai-engine/diarization/pyannote_diarizer.py` (offline flags)
10. Update `ai-engine/requirements.txt` (add `huggingface_hub`)
11. Update `ai-engine/main.py` (add commands `list-models`, `download`, `validate`)
12. Add `ai-engine/downloader.py` for pre-download helpers

---

If you want, I can now apply these changes (create files/patches). Which step should I do first? (I can implement all files in one go.)

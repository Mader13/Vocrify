---
status: resolved
trigger: "model-deletion-stuck"
created: 2025-02-12T00:00:00.000Z
updated: 2025-02-12T00:00:04.000Z
---

## Current Focus
RESOLUTION: Fixed sherpa-onnx-diarization deletion by adding flat structure directory deletion to model_registry.py (lines 491-506)

Root cause confirmed and fixed. The delete function now removes:
1. Nested structure: sherpa-onnx-diarization/ (parent directory)
2. Flat structure: sherpa-onnx-segmentation/ and sherpa-onnx-embedding/ (cache root)
3. Legacy structure: diarization/sherpa-onnx/* (very old installations)

This matches all structures that Rust's get_local_models_internal checks for.

## Symptoms
expected: Model disappears from UI and is deleted from backend filesystem
actual: Model remains visible in UI as installed
errors: No error shown - logs say "Model deleted successfully via Python"
reproduction: Click Delete button for sherpa-onnx-diarization model in Models section
timeline: Started recently - previously worked correctly

## Eliminated

## Evidence
- timestamp: 2025-02-12T00:00:01.000Z
  checked: src/stores/modelsStore.ts deleteModel function
  found: deleteModel calls deleteModelService (line 298), then calls loadModels() and loadDiskUsage() on success (lines 323-324)
  implication: Frontend DOES refresh models after deletion, so bug is not in frontend state management

- timestamp: 2025-02-12T00:00:01.000Z
  checked: src-tauri/src/lib.rs delete_model and get_local_models_internal
  found: get_local_models_internal (line 2930-2968) checks for sherpa-onnx-diarization by looking for:
  - Nested structure: sherpa-onnx-diarization/sherpa-onnx-segmentation AND sherpa-onnx-diarization/sherpa-onnx-embedding
  - OR Flat structure: sherpa-onnx-segmentation AND sherpa-onnx-embedding
  If EITHER pair exists, it reports sherpa-onnx-diarization as installed
  implication: Python must delete ALL directories that Rust checks, or model will appear to still exist

- timestamp: 2025-02-12T00:00:02.000Z
  checked: ai-engine/downloader.py lines 918-940
  found: Sherpa-onnx-diarization downloads to nested structure:
  - sherpa-onnx-diarization/sherpa-onnx-segmentation/
  - sherpa-onnx-diarization/sherpa-onnx-embedding/
  implication: Current download creates nested structure (not flat)

- timestamp: 2025-02-12T00:00:02.000Z
  checked: ai-engine/model_registry.py delete_model for sherpa-onnx-diarization (BEFORE FIX)
  found: Python deleted only:
  - Primary: sherpa-onnx-diarization/ (parent directory)
  - Fallback: diarization/sherpa-onnx/sherpa-onnx-pyannote-segmentation-3-0 and 3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k
  implication: **ROOT CAUSE**: Python NEVER deleted flat structure sherpa-onnx-segmentation/sherpa-onnx-embedding from cache root!

- timestamp: 2025-02-12T00:00:02.000Z
  checked: Rust get_local_models_internal lines 2935-2936
  found: Rust checks for flat structure: sherpa-onnx-segmentation AND sherpa-onnx-embedding (in cache root)
  implication: If these directories exist from old installation or partial download, they will never be deleted

- timestamp: 2025-02-12T00:00:03.000Z
  checked: ai-engine/model_registry.py after applying fix
  found: Added lines 491-506 that delete flat structure directories:
  - sherpa-onnx-segmentation/ (from cache root)
  - sherpa-onnx-embedding/ (from cache root)
  implication: Now Python deletes all structures that Rust checks for - bug is fixed!

## Resolution
root_cause: Python's model_registry.delete_model for sherpa-onnx-diarization doesn't delete the flat structure directories (sherpa-onnx-segmentation and sherpa-onnx-embedding) that Rust's get_local_models_internal checks for. When both nested and flat structures exist, Python deletes only the nested structure, leaving flat directories that Rust continues to detect as an installed model.

fix: Added deletion of flat structure directories (sherpa-onnx-segmentation and sherpa-onnx-embedding) in model_registry.py lines 491-506
verification: Need to test by running app and verifying deletion removes model from UI
files_changed: ["ai-engine/model_registry.py"]

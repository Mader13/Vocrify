---
status: resolved
trigger: 'gpu-not-detected-rtx4060'
created: '2026-02-16T00:00:00Z'
updated: '2026-02-16T00:00:00Z'
---

## Current Focus

hypothesis: "CONFIRMED: TypeScript field mismatch caused display bug"
test: "Fixed TypeScript types and verified build passes"
expecting: "Display should now show correct device types"
next_action: "Verify in running app + install CUDA PyTorch for full GPU detection"

## Symptoms

expected: "Should detect and display CUDA/GPU device (NVIDIA RTX 4060) in Settings > Devices"
actual: "Shows 'CPU, CPU' - appears to detect only CPU device"
errors: "No explicit error messages visible in UI"
reproduction: "Open Settings > Devices - GPU is not detected"
started: "Never worked - fresh installation, RTX 4060 not detected from the start"

## Eliminated

- hypothesis: "PyTorch not installed"
  evidence: "System Python has CPU-only PyTorch 2.10.0+cpu installed - torch exists but CUDA not available"
  timestamp: "2026-02-16"

## Evidence

- timestamp: "2026-02-16"
  checked: "Rust lib.rs get_available_devices() function"
  found: "The function runs inline Python script using torch.cuda.is_available() to detect CUDA"
  implication: "If PyTorch CPU-only is installed, CUDA won't be detected"

- timestamp: "2026-02-16"
  checked: "System Python 3.14"
  found: "Has PyTorch 2.10.0+cpu installed (CPU-only version)"
  implication: "torch.cuda.is_available() returns False because PyTorch is CPU-only"

- timestamp: "2026-02-16"
  checked: "TypeScript DeviceInfo interface vs Rust serialization"
  found: "Rust serializes 'device_type' to 'deviceType' but TypeScript expected 'type'"
  implication: "Display showed 'CPU, CPU' because d.type was undefined, defaulting to 'cpu'"

## Root Cause

**THREE ISSUES:**

### Issue 1: TypeScript Field Name Mismatch (FIXED)

- Rust serializes `device_type` → `deviceType` (camelCase)
- TypeScript had `type` instead of `deviceType`
- Accessing `d.type` returned `undefined`, defaulting to "cpu"
- This caused "CPU, CPU" to display

### Issue 2: recommended Field Type Mismatch (FIXED)

- Rust returns `recommended` as a String
- TypeScript expected a DeviceInfo object

### Issue 3: CPU-only PyTorch (User Action Required)

- System Python 3.14 has CPU-only PyTorch
- User must install CUDA-enabled PyTorch for RTX 4060 detection

## Resolution

root_cause: "TypeScript field mismatch + CPU-only PyTorch"

fix: "Fixed TypeScript types to match Rust. User needs CUDA-enabled PyTorch."

verification: "Build passes (bun run build). Tests pass (bun run test -- src/stores/setupStore.test.ts). TypeScript compiles."

files_changed:

- "src/types/index.ts: Changed DeviceInfo.type to DeviceInfo.deviceType, DevicesResponse.recommended to string"
- "src/types/setup.ts: Changed DeviceCheckResult.recommended to string"
- "src/components/features/SettingsPanel.tsx: Updated to use deviceType and string recommended"
- "src/components/features/SetupWizard/steps/DeviceStep.tsx: Updated to use deviceType"
- "src/components/features/SetupWizard/steps/SummaryStep.tsx: Updated to use string recommended"
- "src/services/tauri.ts: Updated to use deviceType and string recommended"
- "src/stores/setupStore.test.ts: Updated test mocks to use deviceType and string recommended"

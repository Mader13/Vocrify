/**
 * Setup Wizard Types
 * Types for First-Launch Setup Wizard that checks system requirements
 */

import type { DeviceInfo, LocalModel } from "./index";

/**
 * Steps in the setup wizard
 * - python: Check Python environment and PyTorch
 * - ffmpeg: Check FFmpeg installation
 * - device: Check available compute devices (GPU/CPU)
 * - optional: Optional components (HuggingFace token)
 */
export type SetupStep =
  | "python"
  | "ffmpeg"
  | "device"
  | "optional";

/**
 * Status of a setup check
 * - pending: Not yet checked
 * - checking: Currently checking
 * - ok: Check passed successfully
 * - warning: Check passed with warnings
 * - error: Check failed
 * - installing: Installation in progress
 */
export type CheckStatus =
  | "pending"
  | "checking"
  | "ok"
  | "warning"
  | "error"
  | "installing";

/**
 * Result of Python environment check
 */
export interface PythonCheckResult {
  /** Current status of the check */
  status: CheckStatus;
  /** Python version string (e.g., "3.10.12") */
  version: string | null;
  /** Path to Python executable */
  executable: string | null;
  /** Whether Python is running in a virtual environment */
  inVenv: boolean;
  /** Whether PyTorch is installed */
  pytorchInstalled: boolean;
  /** PyTorch version string (e.g., "2.5.1") */
  pytorchVersion: string | null;
  /** Whether CUDA is available in PyTorch */
  cudaAvailable: boolean;
  /** Whether MPS (Apple Silicon) is available in PyTorch */
  mpsAvailable: boolean;
  /** Human-readable message about the check result */
  message: string;
}

/**
 * Result of FFmpeg installation check
 */
export interface FFmpegCheckResult {
  /** Current status of the check */
  status: CheckStatus;
  /** Whether FFmpeg is installed and accessible */
  installed: boolean;
  /** Path to FFmpeg executable */
  path: string | null;
  /** FFmpeg version string */
  version: string | null;
  /** Human-readable message about the check result */
  message: string;
}

/**
 * Result of compute device check
 */
export interface DeviceCheckResult {
  /** Current status of the check */
  status: CheckStatus;
  /** List of available compute devices */
  devices: DeviceInfo[];
  /** Recommended device type for transcription (e.g., "cuda", "cpu") */
  recommended: string | null;
  /** Human-readable message about the check result */
  message: string;
}

/**
 * Result of AI models check
 */
export interface ModelCheckResult {
  /** Current status of the check */
  status: CheckStatus;
  /** List of locally installed models */
  installedModels: LocalModel[];
  /** Whether at least one required model is installed */
  hasRequiredModel: boolean;
  /** Human-readable message about the check result */
  message: string;
}

/**
 * Complete state of the setup wizard
 */
export interface SetupWizardState {
  /** Current step in the wizard */
  currentStep: SetupStep;
  /** Whether all required steps are complete */
  isComplete: boolean;
  /** Python environment check result */
  python: PythonCheckResult | null;
  /** FFmpeg check result */
  ffmpeg: FFmpegCheckResult | null;
  /** Device check result */
  device: DeviceCheckResult | null;
  /** Model check result */
  model: ModelCheckResult | null;
  /** HuggingFace API token (optional) */
  huggingFaceToken: string | null;
}

/**
 * Complete environment status returned by get_environment_status
 * Combines all check results in a single response
 */
export interface EnvironmentStatus {
  /** Python environment check result */
  python: PythonCheckResult;
  /** FFmpeg check result */
  ffmpeg: FFmpegCheckResult;
  /** Device check result */
  device: DeviceCheckResult;
  /** Model check result */
  model: ModelCheckResult;
  /** Whether all required components are ready */
  isReady: boolean;
  /** Overall message about environment status */
  message: string;
}

/**
 * Runtime readiness status (models are intentionally excluded)
 */
export interface RuntimeReadinessStatus {
  /** True only when required runtime dependencies are available */
  ready: boolean;
  /** Python + PyTorch readiness */
  pythonReady: boolean;
  /** FFmpeg readiness */
  ffmpegReady: boolean;
  /** Human-readable Python check message */
  pythonMessage: string;
  /** Human-readable FFmpeg check message */
  ffmpegMessage: string;
  /** Combined readiness message */
  message: string;
  /** RFC3339 timestamp for latest check */
  checkedAt: string;
}

/**
 * Setup Wizard Types
 * Types for First-Launch Setup Wizard that checks system requirements
 */

import type { DeviceInfo, LocalModel } from "./index";

/**
 * Steps in the setup wizard
 * - language: Select application language
 * - ffmpeg: Check FFmpeg installation
 * - device: Check available compute devices (GPU/CPU)
 * - model: Check AI models
 * - summary: Final getting-started instructions before first transcription
 */
export type SetupStep =
  | "language"
  | "ffmpeg"
  | "device"
  | "model"
  | "summary";

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
  /** FFmpeg check result */
  ffmpeg: FFmpegCheckResult | null;
  /** Device check result */
  device: DeviceCheckResult | null;
  /** Model check result */
  model: ModelCheckResult | null;
}

/**
 * Complete environment status returned by get_environment_status
 * Combines all check results in a single response
 */
export interface EnvironmentStatus {
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
  /** FFmpeg readiness */
  ffmpegReady: boolean;
  /** Human-readable FFmpeg check message */
  ffmpegMessage: string;
  /** Combined readiness message */
  message: string;
  /** RFC3339 timestamp for latest check */
  checkedAt: string;
}

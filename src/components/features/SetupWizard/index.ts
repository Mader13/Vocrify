/**
 * Setup Wizard Components
 * First-launch setup wizard for checking system requirements
 */

// Main wizard component
export { SetupWizard, SetupWizardGuard } from "./SetupWizard";
export type { SetupWizardProps, SetupWizardGuardProps } from "./SetupWizard";

// Progress bar
export { ProgressBar } from "./ProgressBar";
export type { ProgressBarProps } from "./ProgressBar";

// Check card components
export { CheckCard, CheckItem } from "./CheckCard";
export type { CheckCardProps, CheckItemProps } from "./CheckCard";

// Step components
export { PythonStep, PythonStepFooter } from "./steps/PythonStep";
export type { PythonStepFooterProps } from "./steps/PythonStep";

export { FFmpegStep, FFmpegStepFooter } from "./steps/FFmpegStep";
export type { FFmpegStepFooterProps } from "./steps/FFmpegStep";

export { DeviceStep, DeviceStepFooter } from "./steps/DeviceStep";
export type { DeviceStepFooterProps } from "./steps/DeviceStep";

export { OptionalStep, OptionalStepFooter } from "./steps/OptionalStep";
export type { OptionalStepFooterProps } from "./steps/OptionalStep";

// Default export
export { SetupWizard as default } from "./SetupWizard";

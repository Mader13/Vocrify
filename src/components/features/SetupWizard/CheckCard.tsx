import * as React from "react";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { CheckStatus } from "@/types/setup";

/**
 * Props for CheckCard component
 */
export interface CheckCardProps {
  /** Title of the check */
  title: string;
  /** Current status of the check */
  status: CheckStatus;
  /** Human-readable message about the check result */
  message: string;
  /** Optional details to show below the message */
  details?: React.ReactNode;
  /** Optional retry callback for failed checks */
  onRetry?: () => void;
  /** Optional progress percentage for installing status (0-100) */
  progress?: number;
  /** Additional CSS classes */
  className?: string;
  /** Optional children to render inside the card */
  children?: React.ReactNode;
}

/**
 * Get icon component based on check status
 */
function getStatusIcon(status: CheckStatus, progress?: number): React.ReactNode {
  switch (status) {
    case "pending":
      return <Clock className="h-5 w-5" aria-hidden="true" />;
    case "checking":
      return <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />;
    case "ok":
      return <CheckCircle2 className="h-5 w-5" aria-hidden="true" />;
    case "warning":
      return <AlertTriangle className="h-5 w-5" aria-hidden="true" />;
    case "error":
      return <XCircle className="h-5 w-5" aria-hidden="true" />;
    case "installing":
      return (
        <div className="relative flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          {progress !== undefined && (
            <span className="absolute text-[10px] font-bold" aria-label={`Прогресс: ${progress}%`}>
              {progress}
            </span>
          )}
        </div>
      );
    default:
      return null;
  }
}

/**
 * Get status label in Russian
 */
function getStatusLabel(status: CheckStatus): string {
  switch (status) {
    case "pending":
      return "Ожидание";
    case "checking":
      return "Проверка...";
    case "ok":
      return "Готово";
    case "warning":
      return "Внимание";
    case "error":
      return "Ошибка";
    case "installing":
      return "Установка...";
    default:
      return "";
  }
}

/**
 * Get Tailwind classes for status colors
 */
function getStatusClasses(status: CheckStatus): string {
  switch (status) {
    case "pending":
      return "border-muted bg-muted/50 text-muted-foreground";
    case "checking":
      return "border-primary/50 bg-primary/5 text-primary";
    case "ok":
      return "border-green-500/50 bg-green-500/5 text-green-600 dark:text-green-400";
    case "warning":
      return "border-yellow-500/50 bg-yellow-500/5 text-yellow-600 dark:text-yellow-400";
    case "error":
      return "border-red-500/50 bg-red-500/5 text-red-600 dark:text-red-400";
    case "installing":
      return "border-primary/50 bg-primary/5 text-primary";
    default:
      return "border-muted bg-muted/50";
  }
}

/**
 * Universal card component for displaying check status in Setup Wizard
 */
export function CheckCard({
  title,
  status,
  message,
  details,
  onRetry,
  progress,
  className,
  children,
}: CheckCardProps) {
  const isLoading = status === "checking" || status === "installing";

  return (
    <div
      className={cn(
        "rounded-lg border-2 p-4 transition-colors",
        getStatusClasses(status),
        className
      )}
      role="status"
      aria-live="polite"
      aria-label={`${title}: ${getStatusLabel(status)}`}
    >
      {/* Header with icon and title */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          {getStatusIcon(status, progress)}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-foreground">{title}</h4>
          <p className="text-sm mt-1 opacity-90 break-words">{message}</p>

          {/* Details section */}
          {details && (
            <div className="mt-3 text-sm opacity-80 break-words">
              {details}
            </div>
          )}

          {/* Children section (CheckItems) */}
          {children && (
            <div className="mt-4 border-t border-current/10 pt-4">
              {children}
            </div>
          )}

          {/* Progress bar for installing status */}
          {status === "installing" && progress !== undefined && (
            <div className="mt-3">
              <div className="h-2 w-full rounded-full bg-primary/20 overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                  aria-label={`Прогресс установки: ${progress}%`}
                />
              </div>
            </div>
          )}

          {/* Retry button for errors */}
          {status === "error" && onRetry && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry}
              disabled={isLoading}
              className="mt-3"
              aria-label="Повторить проверку"
            >
              <RefreshCw className={cn("h-4 w-4 mr-2", isLoading && "animate-spin")} />
              Повторить
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Simple check item for displaying multiple checks in a list
 */
export interface CheckItemProps {
  /** Label for the check */
  label: string;
  /** Current status */
  status: CheckStatus;
  /** Optional sublabel/path */
  sublabel?: string;
}

export function CheckItem({ label, status, sublabel }: CheckItemProps) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <div className="flex-shrink-0">
        {getStatusIcon(status)}
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium block truncate">{label}</span>
        {sublabel && (
          <span className="text-xs text-muted-foreground block break-all mt-0.5">
            {sublabel}
          </span>
        )}
      </div>
    </div>
  );
}

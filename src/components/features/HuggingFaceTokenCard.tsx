import * as React from "react";
import { cn } from "@/lib/utils";
import { useTasks } from "@/stores";
import { isPyannoteModel, requiresHuggingFaceToken } from "@/types";

interface HuggingFaceTokenCardProps {
  className?: string;
  showForModel?: string;
  showForProvider?: "none" | "pyannote" | "sherpa-onnx";
}

export function HuggingFaceTokenCard({
  className,
  showForModel,
  showForProvider,
}: HuggingFaceTokenCardProps) {
  const { huggingFaceToken, diarizationProvider } = useTasks((s) => s.settings);
  const setHuggingFaceToken = useTasks((s) => s.setHuggingFaceToken);
  const [isEditing, setIsEditing] = React.useState(false);
  const [tempToken, setTempToken] = React.useState(huggingFaceToken || "");
  const [showHelp, setShowHelp] = React.useState(false);

  const isRequired = showForModel
    ? isPyannoteModel(showForModel)
    : showForProvider
      ? requiresHuggingFaceToken(showForProvider)
      : diarizationProvider === "pyannote";

  const isConfigured = !!huggingFaceToken;
  const isValidFormat =
    tempToken.startsWith("hf_") && tempToken.length >= 20;

  const handleSave = () => {
    if (tempToken.trim()) {
      setHuggingFaceToken(tempToken.trim());
    } else {
      setHuggingFaceToken(null);
    }
    setIsEditing(false);
  };

  const handleDelete = () => {
    setHuggingFaceToken(null);
    setTempToken("");
    setIsEditing(false);
  };

  const handleCancel = () => {
    setTempToken(huggingFaceToken || "");
    setIsEditing(false);
  };

  // Mask token for display (show first 4 and last 4 chars)
  const maskToken = (token: string): string => {
    if (token.length <= 12) return "•".repeat(token.length);
    return token.slice(0, 4) + "•".repeat(token.length - 8) + token.slice(-4);
  };

  return (
    <div
      className={cn(
        "rounded-xl border p-5 transition-all",
        isRequired && !isConfigured
          ? "border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20"
          : "border-border bg-card",
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🤗</span>
          <div>
            <h3 className="font-semibold text-sm">HuggingFace Token</h3>
            <p className="text-xs text-muted-foreground">
              {isConfigured ? (
                <span className="flex items-center gap-1">
                  <svg
                    className="w-3 h-3 text-green-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  Configured
                </span>
              ) : isRequired ? (
                <span className="flex items-center gap-1 text-amber-600">
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  Required for PyAnnote
                </span>
              ) : (
                "Required for PyAnnote models"
              )}
            </p>
          </div>
        </div>
        {!isEditing && (
          <div className="flex items-center gap-2">
            {isConfigured && (
              <button
                onClick={() => setIsEditing(true)}
                className="text-xs px-2 py-1 rounded bg-secondary hover:bg-secondary/80 transition-colors"
              >
                Edit
              </button>
            )}
            {isConfigured && (
              <button
                onClick={handleDelete}
                className="text-xs px-2 py-1 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>

      {isEditing ? (
        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-medium mb-1 block">
              Enter your HuggingFace token
            </label>
            <input
              type="password"
              value={tempToken}
              onChange={(e) => setTempToken(e.target.value)}
              placeholder="hf_..."
              className="w-full px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            {tempToken && !isValidFormat && (
              <p className="text-xs text-amber-600 mt-1">
                Token must start with "hf_" and be at least 20 characters
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!isValidFormat && tempToken.length > 0}
              className="flex-1 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Save
            </button>
            <button
              onClick={handleCancel}
              className="px-3 py-2 text-sm font-medium border rounded-lg hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {isConfigured ? (
            <div className="mt-3 p-3 rounded-lg bg-muted">
              <p className="text-sm font-mono">{maskToken(huggingFaceToken)}</p>
            </div>
          ) : (
            <div className="mt-4">
              <button
                onClick={() => setIsEditing(true)}
                className="w-full px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                {isRequired ? "Configure Token" : "Add Token"}
              </button>
            </div>
          )}
        </>
      )}

      <div className="mt-3">
        <button
          onClick={() => setShowHelp(!showHelp)}
          className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
        >
          <svg
            className="w-3 h-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          How to get a HuggingFace token?
        </button>

        {showHelp && (
          <div className="mt-2 p-3 rounded-lg bg-muted/50 text-xs space-y-2">
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>
                Go to{" "}
                <a
                  href="https://huggingface.co/settings/tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  huggingface.co/settings/tokens
                </a>
              </li>
              <li>Log in or create an account (free)</li>
              <li>Click "New token"</li>
              <li>Select type "Write"</li>
              <li>Copy the token (starts with hf_)</li>
            </ol>
            <p className="text-amber-600">
              The token is stored locally on your device.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

import * as React from "react";
import { Check, CircleHelp, KeyRound } from "lucide-react";

import { cn } from "@/lib/utils";
import { useTasks } from "@/stores";

interface HuggingFaceTokenCardProps {
  className?: string;
}

function maskToken(token: string): string {
  if (token.length <= 12) {
    return "•".repeat(token.length);
  }

  return `${token.slice(0, 4)}${"•".repeat(token.length - 8)}${token.slice(-4)}`;
}

export function HuggingFaceTokenCard({
  className,
}: HuggingFaceTokenCardProps): React.JSX.Element {
  const { huggingFaceToken } = useTasks((state) => state.settings);
  const setHuggingFaceToken = useTasks((state) => state.setHuggingFaceToken);

  const [isEditing, setIsEditing] = React.useState(false);
  const [tempToken, setTempToken] = React.useState(huggingFaceToken || "");
  const [showHelp, setShowHelp] = React.useState(false);

  const isConfigured = !!huggingFaceToken;
  const isValidFormat = tempToken.startsWith("hf_") && tempToken.length >= 20;

  const handleSave = () => {
    const nextValue = tempToken.trim();
    setHuggingFaceToken(nextValue || null);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setTempToken(huggingFaceToken || "");
    setIsEditing(false);
  };

  const handleDelete = () => {
    setHuggingFaceToken(null);
    setTempToken("");
    setIsEditing(false);
  };

  return (
    <div
      className={cn(
        "rounded-xl border p-4 sm:p-5",
        "border-border/70 bg-card/80",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold sm:text-base">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            HuggingFace Token
          </h3>
          <div className="mt-1 text-xs text-muted-foreground">
            {isConfigured ? (
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <Check className="h-3 w-3" />
                Configured
              </span>
            ) : (
              <span>Optional — not required for Sherpa-ONNX diarization.</span>
            )}
          </div>
        </div>

        {!isEditing && isConfigured && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsEditing(true)}
              className="rounded-md border border-border/70 bg-background/80 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted/60"
            >
              Edit
            </button>
            <button
              onClick={handleDelete}
              className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {isEditing ? (
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Enter your HuggingFace token</label>
            <input
              type="password"
              value={tempToken}
              onChange={(event) => setTempToken(event.target.value)}
              placeholder="hf_..."
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            />
            {tempToken && !isValidFormat && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                Token must start with "hf_" and be at least 20 characters.
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!isValidFormat && tempToken.length > 0}
              className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={handleCancel}
              className="rounded-lg border border-border/70 bg-background/80 px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/60"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {isConfigured ? (
            <div className="mt-4 rounded-lg border border-border/70 bg-background/85 px-3 py-2.5">
              <p className="text-sm font-mono tracking-wide">{maskToken(huggingFaceToken)}</p>
            </div>
          ) : (
            <button
              onClick={() => setIsEditing(true)}
              className="mt-4 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {"Add Token"}
            </button>
          )}
        </>
      )}

      <div className="mt-4">
        <button
          onClick={() => setShowHelp((prev) => !prev)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <CircleHelp className="h-3 w-3" />
          How to get a HuggingFace token?
        </button>

        {showHelp && (
          <div className="mt-2 rounded-lg border border-border/70 bg-background/80 p-3 text-xs">
            <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
              <li>
                Visit{" "}
                <a
                  href="https://huggingface.co/settings/tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  huggingface.co/settings/tokens
                </a>
              </li>
              <li>Sign in or create an account.</li>
              <li>Create a new token with Write permission.</li>
              <li>Copy token value and paste it here.</li>
            </ol>
            <p className="mt-2 text-amber-700 dark:text-amber-300">Token is stored locally on your device.</p>
          </div>
        )}
      </div>
    </div>
  );
}

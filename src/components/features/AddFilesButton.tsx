import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AddFilesButtonProps {
  onClick: () => void;
  variant?: "full" | "icon" | "mobile";
  className?: string;
}

export function AddFilesButton({ onClick, variant = "full", className }: AddFilesButtonProps) {
  if (variant === "icon") {
    return (
      <Button
        variant="default"
        size="icon"
        className={cn(
          "h-11 w-11 rounded-xl transition-all duration-200 hover:scale-[1.02]",
          className,
        )}
        onClick={onClick}
        title="Add files"
        aria-label="Add files"
      >
        <Plus className="h-5 w-5" />
      </Button>
    );
  }

  if (variant === "mobile") {
    return (
      <Button onClick={onClick} size="sm" className={cn("h-9 rounded-lg px-3", className)}>
        <Plus className="mr-1.5 h-4 w-4" />
        Add
      </Button>
    );
  }

  return (
    <Button
      onClick={onClick}
      className={cn(
        "h-10 w-full justify-start gap-2 rounded-xl text-sm font-medium transition-all duration-200 hover:-translate-y-px",
        className,
      )}
    >
      <Plus className="h-4 w-4" />
      Add media files
    </Button>
  );
}

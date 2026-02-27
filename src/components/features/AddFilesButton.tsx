import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import React from 'react';
import { useI18n } from "@/hooks";

// Forward ref to support Framer Motion layout animations on standard Button
const MotionButton = motion.create(React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof Button>>((props, ref) => (
  <Button ref={ref} {...props} />
)));

interface AddFilesButtonProps {
  onClick: () => void;
  variant?: "default" | "mobile";
  isCollapsed?: boolean;
  className?: string;
}

export function AddFilesButton({ onClick, variant = "default", isCollapsed = false, className }: AddFilesButtonProps) {
  const { t } = useI18n();

  if (variant === "mobile") {
    return (
      <Button onClick={onClick} size="sm" className={cn("h-9 rounded-lg px-3", className)}>
        <Plus className="mr-1.5 h-4 w-4" />
        {t("addFiles.add")}
      </Button>
    );
  }

  return (
    <MotionButton
      layout
      onClick={onClick}
      className={cn(
        "h-11 rounded-xl font-medium transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] shadow-md",
        isCollapsed ? "w-11 p-0 justify-center" : "w-full justify-start px-4",
        className,
      )}
      title={t("addFiles.addFiles")}
      aria-label={t("addFiles.addFiles")}
    >
      <motion.div layout className="flex items-center justify-center shrink-0">
        <Plus className="h-5 w-5" />
      </motion.div>
      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.span
            layout
            initial={{ opacity: 0, width: 0, marginLeft: 0 }}
            animate={{ opacity: 1, width: "auto", marginLeft: 8 }}
            exit={{ opacity: 0, width: 0, marginLeft: 0 }}
            transition={{ type: "spring", bounce: 0, duration: 0.3 }}
            className="overflow-hidden whitespace-nowrap text-sm"
          >
            {t("addFiles.addMediaFiles")}
          </motion.span>
        )}
      </AnimatePresence>
    </MotionButton>
  );
}

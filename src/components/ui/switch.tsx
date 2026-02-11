import React from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, checked, onCheckedChange, disabled, ...props }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      onCheckedChange?.(e.target.checked);
    };

    return (
      <label className={cn(
        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
        "cursor-pointer peer",
        checked ? "bg-primary" : "bg-input",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}>
        <input
          type="checkbox"
          ref={ref}
          checked={checked}
          onChange={handleChange}
          disabled={disabled}
          className="sr-only"
          {...props}
        />
        <span className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5"
        )} />
      </label>
    );
  }
);

Switch.displayName = "Switch";

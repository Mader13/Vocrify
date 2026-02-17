import React from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  switchSize?: 'default' | 'lg';
}

export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, checked, onCheckedChange, disabled, switchSize = 'default', ...props }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      onCheckedChange?.(e.target.checked);
    };

    const sizeClasses = switchSize === 'lg' 
      ? { container: 'h-7 w-12', thumb: 'h-6 w-6', translate: 'translate-x-6' }
      : { container: 'h-5 w-9', thumb: 'h-4 w-4', translate: 'translate-x-5' };

    return (
      <label className={cn(
        "relative inline-flex items-center rounded-full transition-colors",
        "cursor-pointer peer",
        sizeClasses.container,
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
          "inline-block transform rounded-full bg-white shadow-lg transition-transform",
          sizeClasses.thumb,
          checked ? sizeClasses.translate : "translate-x-0.5"
        )} />
      </label>
    );
  }
);

Switch.displayName = "Switch";

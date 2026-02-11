import * as React from "react";
import { cn } from "@/lib/utils";

export interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value?: number;
  onValueChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  showValue?: boolean;
  valueFormatter?: (value: number) => string;
}

const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  ({ className, value = 0, onValueChange, min = 0, max = 100, step = 1, showValue = false, valueFormatter, disabled, ...props }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = Number(e.target.value);
      onValueChange?.(newValue);
    };

    const percentage = ((value - min) / (max - min)) * 100;
    const displayValue = valueFormatter ? valueFormatter(value) : value.toString();

    return (
      <div className={cn("flex items-center gap-3", className)}>
        <div className="relative flex-1">
          <input
            ref={ref}
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={handleChange}
            disabled={disabled}
            className="w-full h-2 bg-input rounded-full appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: `linear-gradient(to right, var(--primary) 0%, var(--primary) ${percentage}%, var(--input) ${percentage}%, var(--input) 100%)`,
            }}
            {...props}
          />
        </div>
        {showValue && (
          <span className="text-sm text-muted-foreground min-w-[3rem] text-right tabular-nums">
            {displayValue}
          </span>
        )}
      </div>
    );
  }
);

Slider.displayName = "Slider";

export { Slider };

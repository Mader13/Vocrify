import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Tabs component variants using CVA pattern
 */
const tabsListVariants = cva(
  "inline-flex items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
  {
    variants: {
      variant: {
        default: "bg-muted",
        outline: "border border-border bg-transparent",
      },
      size: {
        default: "h-10",
        sm: "h-8 text-xs",
        lg: "h-12 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

const tabsTriggerVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        outline:
          "border border-transparent data-[state=active]:border-primary data-[state=active]:bg-background",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const tabsContentVariants = cva(
  "mt-4 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        default: "",
        card: "rounded-xl border bg-card p-4",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

/**
 * Tabs context for managing active tab state
 */
interface TabsContextValue {
  activeTab: string;
  setActiveTab: (value: string) => void;
}

const TabsContext = React.createContext<TabsContextValue | undefined>(undefined);

function useTabsContext() {
  const context = React.useContext(TabsContext);
  if (!context) {
    throw new Error("Tabs components must be used within a Tabs provider");
  }
  return context;
}

/**
 * Root Tabs component props
 */
export interface TabsProps extends VariantProps<typeof tabsListVariants> {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}

/**
 * Tabs root component that provides context
 */
export function Tabs({
  defaultValue,
  value,
  onValueChange,
  children,
  className,
}: Omit<TabsProps, 'variant' | 'size'>) {
  const [internalValue, setInternalValue] = React.useState(defaultValue || "");

  const activeTab = value ?? internalValue;
  const setActiveTab = React.useCallback(
    (newValue: string) => {
      if (!value) {
        setInternalValue(newValue);
      }
      onValueChange?.(newValue);
    },
    [value, onValueChange]
  );

  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      <div className={cn("w-full", className)}>{children}</div>
    </TabsContext.Provider>
  );
}

/**
 * TabsList component props
 */
export interface TabsListProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof tabsListVariants> {}

/**
 * TabsList - container for tab triggers
 */
export function TabsList({
  className,
  variant,
  size,
  children,
  ...props
}: TabsListProps) {
  return (
    <div
      role="tablist"
      className={cn(tabsListVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * TabsTrigger component props
 */
export interface TabsTriggerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof tabsTriggerVariants> {
  value: string;
}

/**
 * TabsTrigger - individual tab button
 */
export function TabsTrigger({
  value,
  className,
  variant,
  children,
  ...props
}: TabsTriggerProps) {
  const { activeTab, setActiveTab } = useTabsContext();
  const isActive = activeTab === value;

  return (
    <button
      role="tab"
      aria-selected={isActive}
      data-state={isActive ? "active" : "inactive"}
      onClick={() => setActiveTab(value)}
      className={cn(tabsTriggerVariants({ variant }), className)}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * TabsContent component props
 */
export interface TabsContentProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof tabsContentVariants> {
  value: string;
}

/**
 * TabsContent - content panel for each tab
 */
export function TabsContent({
  value,
  className,
  variant,
  children,
  ...props
}: TabsContentProps) {
  const { activeTab } = useTabsContext();
  const isActive = activeTab === value;

  if (!isActive) {
    return null;
  }

  return (
    <div
      role="tabpanel"
      data-state={isActive ? "active" : "inactive"}
      className={cn(tabsContentVariants({ variant }), className)}
      {...props}
    >
      {children}
    </div>
  );
}

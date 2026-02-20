import { useState, useCallback, useEffect, useRef } from "react";

interface UseResizableOptions {
  initialWidth: number;
  minWidth: number;
  maxWidth: number;
  storageKey?: string;
}

interface UseResizableReturn {
  width: number;
  isResizing: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  handleResizeStart: () => void;
  setWidth: (width: number) => void;
}

export function useResizable({
  initialWidth,
  minWidth,
  maxWidth,
  storageKey,
}: UseResizableOptions): UseResizableReturn {
  const [width, setWidthState] = useState(() => {
    if (storageKey) {
      const savedWidth = Number(window.localStorage.getItem(storageKey));
      if (!Number.isFinite(savedWidth)) {
        return initialWidth;
      }
      return Math.max(minWidth, Math.min(maxWidth, savedWidth));
    }
    return initialWidth;
  });

  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const setWidth = useCallback(
    (newWidth: number) => {
      const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
      setWidthState(clampedWidth);
      if (storageKey) {
        window.localStorage.setItem(storageKey, String(clampedWidth));
      }
    },
    [minWidth, maxWidth, storageKey],
  );

  const handleResizeStart = useCallback(() => {
    setIsResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  const handleResize = useCallback(
    (e: MouseEvent) => {
      if (!isResizing || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const newWidth = e.clientX - rect.left;
      setWidth(newWidth);
    },
    [isResizing, setWidth],
  );

  useEffect(() => {
    if (isResizing) {
      window.addEventListener("mousemove", handleResize);
      window.addEventListener("mouseup", handleResizeEnd);
      return () => {
        window.removeEventListener("mousemove", handleResize);
        window.removeEventListener("mouseup", handleResizeEnd);
      };
    }
  }, [isResizing, handleResize, handleResizeEnd]);

  useEffect(
    () => () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    },
    [],
  );

  return {
    width,
    isResizing,
    containerRef,
    handleResizeStart,
    setWidth,
  };
}

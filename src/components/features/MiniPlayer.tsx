import { useCallback, useState, memo, useEffect, useRef, useMemo } from 'react';
import { Play, Pause, X, GripVertical, FileAudio } from 'lucide-react';
import { cn, formatTime } from '@/lib/utils';
import { usePlaybackStore, type MiniPlayerPosition } from '@/stores/playbackStore';
import { useUIStore } from '@/stores';
import { getSmoothedPointerVelocity, getSnapDurationMs, getThrowTargetCorner } from '@/components/features/miniplayer-physics';

// Target positions for each corner (with smooth snapping)
const getTargetPosition = (position: MiniPlayerPosition, viewportWidth: number, viewportHeight: number, elementHeight: number) => {
  const gap = 16; // 1rem = 4 * 4 = 16px (matches tailwind's top-4/left-4)
  const headerHeight = 56; // h-14 = 14 * 4px = 56px

  switch (position) {
    case 'top-left':
      return { x: gap, y: headerHeight + gap };
    case 'top-right':
      return { x: viewportWidth - 288 - gap, y: headerHeight + gap };
    case 'bottom-left':
      return { x: gap, y: viewportHeight - elementHeight - gap };
    case 'bottom-right':
      return { x: viewportWidth - 288 - gap, y: viewportHeight - elementHeight - gap };
  }
};

const DRAG_THRESHOLD = 8; // Minimum pixels to move before considering it a drag

function MiniPlayerInner() {
  const setSelectedTask = useUIStore((s) => s.setSelectedTask);
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  const currentView = useUIStore((s) => s.currentView);
  // Hide MiniPlayer when the user is already viewing the playing task's page
  const selectedTaskId = useUIStore((s) => s.selectedTaskId);
  const playingTaskId = usePlaybackStore((s) => s.playingTaskId);
  const playingTaskFileName = usePlaybackStore((s) => s.playingTaskFileName);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const duration = usePlaybackStore((s) => s.duration);
  const currentTime = usePlaybackStore((s) => s.currentTime);
  const miniPlayerPosition = usePlaybackStore((s) => s.miniPlayerPosition);
  const stopPlayback = usePlaybackStore((s) => s.stop);
  const setPosition = usePlaybackStore((s) => s.setPosition);
  const elementRef = useRef<HTMLDivElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [isSnapping, setIsSnapping] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const dragVelocity = useRef({ x: 0, y: 0 });
  const previousPointer = useRef<{ x: number; y: number; time: number } | null>(null);
  const isDraggingRef = useRef(false);

  const handleClose = useCallback(() => {
    if (playingTaskId) {
      window.dispatchEvent(new CustomEvent('miniplayer-pause', {
        detail: { taskId: playingTaskId }
      }));
    }
    stopPlayback();
  }, [playingTaskId, stopPlayback]);

  const handleTogglePlayPause = useCallback(() => {
    if (!playingTaskId) return;

    if (isPlaying) {
      // Pause
      window.dispatchEvent(new CustomEvent('miniplayer-pause', {
        detail: { taskId: playingTaskId }
      }));
    } else {
      // Play
      window.dispatchEvent(new CustomEvent('miniplayer-play', {
        detail: { taskId: playingTaskId }
      }));
    }
  }, [isPlaying, playingTaskId]);

  const handleGoToTask = useCallback(() => {
    if (playingTaskId) {
      setSelectedTask(playingTaskId);
      setCurrentView('transcription');
    }
  }, [playingTaskId, setSelectedTask, setCurrentView]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    // Only prevent default for left mouse button
    if (e.button !== 0) return;
    
    e.preventDefault();

    // Store initial mouse position for drag threshold check
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    dragVelocity.current = { x: 0, y: 0 };
    previousPointer.current = { x: e.clientX, y: e.clientY, time: performance.now() };

    // Calculate offset from the top-left corner of the element
    const rect = elementRef.current?.getBoundingClientRect();
    if (rect) {
      dragOffset.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }

    // Reset any bottom/right positioning to use only top/left
    if (elementRef.current) {
      elementRef.current.style.bottom = 'auto';
      elementRef.current.style.right = 'auto';
    }
  }, []);

  // Set initial position based on store position
  useEffect(() => {
    // Don't override position during/just after drag
    if (isDraggingRef.current || isSnapping) return;

    // Wait for element to be mounted before setting position
    if (!elementRef.current) return;

    const applyPosition = () => {
      if (!elementRef.current) return;

      const elementHeight = elementRef.current.offsetHeight;

      // Wait until element has actual height (not 0)
      if (elementHeight === 0) {
        requestAnimationFrame(applyPosition);
        return;
      }

      const screenWidth = window.innerWidth;
      const screenHeight = window.innerHeight;
      const targetPos = getTargetPosition(miniPlayerPosition, screenWidth, screenHeight, elementHeight);

      elementRef.current.style.left = `${targetPos.x}px`;
      elementRef.current.style.top = `${targetPos.y}px`;
      elementRef.current.style.bottom = 'auto';
      elementRef.current.style.right = 'auto';
    };

    // Use requestAnimationFrame to ensure element is rendered
    requestAnimationFrame(applyPosition);

    // Update position on window resize
    const handleResize = () => {
      if (isDraggingRef.current || isSnapping) return;
      applyPosition();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [miniPlayerPosition, isSnapping]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartPos.current || !elementRef.current) return;
      
      // Check if mouse has moved enough to start dragging (threshold)
      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < DRAG_THRESHOLD) return;

      // Only start dragging if not already
      if (!isDraggingRef.current) {
        isDraggingRef.current = true;
        setIsDragging(true);
      }

      const now = performance.now();
      const previous = previousPointer.current;
      if (previous) {
        dragVelocity.current = getSmoothedPointerVelocity(
          previous,
          { x: e.clientX, y: e.clientY, time: now },
          dragVelocity.current
        );
      }
      previousPointer.current = { x: e.clientX, y: e.clientY, time: now };

      e.preventDefault();
      // Directly update element position without re-render
      elementRef.current.style.left = `${e.clientX - dragOffset.current.x}px`;
      elementRef.current.style.top = `${e.clientY - dragOffset.current.y}px`;
      elementRef.current.style.transition = 'none';
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!dragStartPos.current) return;

      // If we were dragging, snap to position
      if (isDraggingRef.current && elementRef.current) {
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;
        const elementHeight = elementRef.current.offsetHeight;
        const speed = Math.hypot(dragVelocity.current.x, dragVelocity.current.y);
        const snapDuration = getSnapDurationMs(speed);

        const newPosition: MiniPlayerPosition = getThrowTargetCorner({
          releaseX: e.clientX,
          releaseY: e.clientY,
          velocityX: dragVelocity.current.x,
          velocityY: dragVelocity.current.y,
          viewportWidth: screenWidth,
          viewportHeight: screenHeight,
        });

        // Calculate target position using actual element dimensions
        const targetPos = getTargetPosition(newPosition, screenWidth, screenHeight, elementHeight);

        setPosition(newPosition);

        // Animate to target position using only top/left
        elementRef.current.style.transition = `all ${snapDuration}ms cubic-bezier(0.22, 1, 0.36, 1)`;
        elementRef.current.style.left = `${targetPos.x}px`;
        elementRef.current.style.top = `${targetPos.y}px`;
        elementRef.current.style.bottom = 'auto';
        elementRef.current.style.right = 'auto';

        setIsSnapping(true);
        isDraggingRef.current = false;
        setIsDragging(false);
        dragVelocity.current = { x: 0, y: 0 };

        // After animation completes, keep inline top/left styles to maintain position
        setTimeout(() => {
          if (elementRef.current) {
            elementRef.current.style.transition = '';
          }
          setIsSnapping(false);
        }, snapDuration);
      }

      // Reset drag state
      dragStartPos.current = null;
      previousPointer.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [setPosition]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Calculate initial position for first render (must be before conditional return)
  const initialPosition = useMemo(() => {
    // Default to bottom-left with estimated height for first render
    const estimatedHeight = 80;
    return getTargetPosition(miniPlayerPosition, window.innerWidth, window.innerHeight, estimatedHeight);
  }, [miniPlayerPosition]);

  const isViewingPlayingTask = currentView === 'transcription' && selectedTaskId === playingTaskId;

  // Don't render if there's no task loaded (but show even when paused)
  // Also hide when the user is currently viewing the playing task's page —
  // the VideoPlayer controls are already visible, showing MiniPlayer simultaneously
  // creates a second play button that can trigger audio duplication.
  if (!playingTaskId || isViewingPlayingTask) {
    return null;
  }

  return (
    <div
      ref={elementRef}
      className={cn(
        'fixed z-50 flex items-center gap-3 px-4 py-3 rounded-xl',
        'bg-card border shadow-lg backdrop-blur-sm',
        'w-72 select-none h-fit',
        // Don't use positionClasses - we use inline styles for dynamic positioning
        isDragging ? 'opacity-80 scale-105' : '',
        isSnapping ? '' : 'transition-all duration-200'
      )}
      style={{
        cursor: isDragging ? 'grabbing' : 'grab',
        // Initial position to prevent appearing at (0,0)
        left: `${initialPosition.x}px`,
        top: `${initialPosition.y}px`,
      }}
      onMouseDown={handleDragStart}
      draggable={false}
    >
      {/* Drag handle */}
      <div 
        className="text-muted-foreground/50 cursor-grab flex items-center justify-center"
        draggable={false}
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        <GripVertical className="h-4 w-4" />
      </div>

      {/* Play/Pause button */}
      <button
        onClick={handleTogglePlayPause}
        className={cn(
          'flex items-center justify-center w-10 h-10 rounded-full',
          'bg-primary text-primary-foreground hover:bg-primary/90',
          'transition-colors shrink-0'
        )}
      >
        {isPlaying ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4 ml-0.5" />
        )}
      </button>

      {/* File info and progress */}
      <div
        className="flex-1 min-w-0 cursor-pointer"
        onClick={handleGoToTask}
        draggable={false}
      >
        <div className="flex items-center gap-2 mb-1">
          <FileAudio className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <p className="text-sm font-medium truncate">
              {playingTaskFileName || 'Unknown'}
            </p>
          </div>

        {/* Progress bar */}
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Time display */}
          <div className="flex justify-between mt-1 text-xs text-muted-foreground">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

      {/* Close button */}
      <button
        onClick={handleClose}
        className={cn(
          'p-1 rounded-md hover:bg-muted transition-colors',
          'text-muted-foreground hover:text-foreground',
          'shrink-0'
        )}
        title="Stop and close"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// Memo wrapper to prevent hook ordering issues
export const MiniPlayer = memo(MiniPlayerInner);

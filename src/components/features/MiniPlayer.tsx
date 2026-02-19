import React, { useCallback, useState, memo } from 'react';
import { Play, Pause, X, GripVertical, FileAudio } from 'lucide-react';
import { cn, formatTime } from '@/lib/utils';
import { usePlaybackStore, type MiniPlayerPosition } from '@/stores/playbackStore';
import { useUIStore } from '@/stores';

const positionClasses: Record<MiniPlayerPosition, string> = {
  'top-left': 'top-4 left-4',
  'top-right': 'top-4 right-4',
  'bottom-left': 'bottom-4 left-4',
  'bottom-right': 'bottom-4 right-4',
};

function MiniPlayerInner() {
  const store = usePlaybackStore();
  const setSelectedTask = useUIStore((s) => s.setSelectedTask);

  const [isDragging, setIsDragging] = useState(false);

  // Don't render if nothing is playing
  if (!store.playingTaskId || !store.isPlaying) {
    return null;
  }

  const handleClose = useCallback(() => {
    store.stop();
  }, [store]);

  const handleTogglePlayPause = useCallback(() => {
    store.togglePlayPause();
  }, [store]);

  const handleGoToTask = useCallback(() => {
    if (store.playingTaskId) {
      setSelectedTask(store.playingTaskId);
    }
  }, [store.playingTaskId, setSelectedTask]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragEnd = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;

    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;

    // Determine which quadrant of mouse is in
    const isLeft = e.clientX < screenWidth / 2;
    const isTop = e.clientY < screenHeight / 2;

    let newPosition: MiniPlayerPosition;
    if (isTop && isLeft) newPosition = 'top-left';
    else if (isTop && !isLeft) newPosition = 'top-right';
    else if (!isTop && isLeft) newPosition = 'bottom-left';
    else newPosition = 'bottom-right';

    store.setPosition(newPosition);
    setIsDragging(false);
  }, [isDragging, store]);

  const progress = store.duration > 0 ? (store.currentTime / store.duration) * 100 : 0;

  // Don't render if nothing is playing
  if (!store.playingTaskId || !store.isPlaying) {
    return null;
  }

  return (
    <div
      className={cn(
        'fixed z-50 flex items-center gap-3 px-4 py-3 rounded-xl',
        'bg-card border shadow-lg backdrop-blur-sm',
        'transition-all duration-200',
        'w-72 select-none',
        positionClasses[store.miniPlayerPosition],
        isDragging ? 'opacity-80 scale-105' : ''
      )}
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      onMouseDown={handleDragStart}
      onMouseUp={handleDragEnd}
    >
      {/* Drag handle */}
      <div className="text-muted-foreground/50 cursor-grab">
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
        {store.isPlaying ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4 ml-0.5" />
        )}
      </button>

      {/* File info and progress */}
      <div
        className="flex-1 min-w-0 cursor-pointer"
        onClick={handleGoToTask}
      >
        <div className="flex items-center gap-2 mb-1">
          <FileAudio className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <p className="text-sm font-medium truncate">
            {store.playingTaskFileName || 'Unknown'}
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
          <span>{formatTime(store.currentTime)}</span>
          <span>{formatTime(store.duration)}</span>
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

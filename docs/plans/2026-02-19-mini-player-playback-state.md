# MiniPlayer Playback State Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Реализовать синхронизацию состояния воспроизведения между VideoPlayer и floating MiniPlayer. При уходе со страницы транскрипции аудио продолжает играть, при возврате - UI синхронизируется с текущим состоянием. MiniPlayer отображаетPlayingTask и позволяет вернуться к ней.

**Architecture:** Zustand store (playbackStore) для хранения состояния воспроизведения. VideoPlayer подписывается на store и синхронизирует реальный плеер. MiniPlayer отображается когда пользователь не на странице играющей задачи. Drag-and-drop для позиционирования MiniPlayer по 4 углам экрана.

**Tech Stack:** Zustand, React, TypeScript, Tailwind CSS 4

---

## Task 1: Create playbackStore

**Files:**

- Create: `src/stores/playbackStore.ts`

**Step 1: Create playbackStore.ts**

```typescript
import { create } from 'zustand';

export type MiniPlayerPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

interface PlaybackState {
  // Какая задача сейчас играет
  playingTaskId: string | null;
  playingTaskFileName: string | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;

  // Позиция mini-player на экране
  miniPlayerPosition: MiniPlayerPosition;

  // Actions
  setPlaying: (taskId: string | null, fileName: string | null, isPlaying: boolean) => void;
  updateTime: (time: number) => void;
  setDuration: (duration: number) => void;
  togglePlayPause: () => void;
  stop: () => void;
  setPosition: (position: MiniPlayerPosition) => void;
}

export const usePlaybackStore = create<PlaybackState>((set, get) => ({
  playingTaskId: null,
  playingTaskFileName: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  miniPlayerPosition: 'bottom-left',

  setPlaying: (taskId, fileName, isPlaying) => {
    set({
      playingTaskId: taskId,
      playingTaskFileName: fileName,
      isPlaying,
      // При смене задачи сбрасываем время
      currentTime: 0
    });
  },

  updateTime: (time) => set({ currentTime: time }),

  setDuration: (duration) => set({ duration }),

  togglePlayPause: () => {
    const { isPlaying, playingTaskId } = get();
    if (!playingTaskId) return;
    set({ isPlaying: !isPlaying });
  },

  stop: () => set({
    playingTaskId: null,
    playingTaskFileName: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0
  }),

  setPosition: (position) => set({ miniPlayerPosition: position }),
}));
```

**Step 2: Export from stores/index.ts**

Modify: `src/stores/index.ts` - add export at bottom:

```typescript
export { usePlaybackStore } from './playbackStore';
```

**Step 3: Commit**

```bash
git add src/stores/playbackStore.ts src/stores/index.ts
git commit -m "feat: add playbackStore for playback state management"
```

---

## Task 2: Create usePlaybackSync hook

**Files:**

- Create: `src/hooks/usePlaybackSync.ts`

**Step 1: Write the hook**

```typescript
import { useEffect, useRef, useCallback } from 'react';
import { usePlaybackStore } from '@/stores/playbackStore';

interface UsePlaybackSyncOptions {
  taskId: string;
  fileName: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  wavesurferRef: React.RefObject<any>;
  isWaveformReady: boolean;
}

/**
 * Hook for synchronizing VideoPlayer state with playbackStore.
 * Handles:
 * - Publishing play/pause state to store
 * - Subscribing to store for external control
 * - Syncing currentTime on mount
 */
export function usePlaybackSync({
  taskId,
  fileName,
  videoRef,
  wavesurferRef,
  isWaveformReady,
}: UsePlaybackSyncOptions) {
  const store = usePlaybackStore();

  // Track if we're the active player (the one shown on screen)
  const isActivePlayer = store.playingTaskId === taskId;

  // Subscribe to store for play/pause (when another task started playing)
  useEffect(() => {
    if (!isActivePlayer) {
      // We're not the active player - apply store state to our player
      const videoEl = videoRef.current;
      const ws = wavesurferRef.current;

      if (!videoEl && !ws) return;

      if (store.isPlaying) {
        videoEl?.play().catch(() => {});
        ws?.play();
      } else {
        videoEl?.pause();
        ws?.pause();
      }
    }
  }, [store.isPlaying, store.playingTaskId, isActivePlayer, videoRef, wavesurferRef]);

  // Publish our play state to store when user interacts
  const handlePlay = useCallback(() => {
    store.setPlaying(taskId, fileName, true);
  }, [taskId, fileName, store]);

  const handlePause = useCallback(() => {
    // Only update store if we're the active player
    if (store.playingTaskId === taskId) {
      store.setPlaying(taskId, fileName, false);
    }
  }, [taskId, fileName, store, store.playingTaskId]);

  // Sync current time to store
  const handleTimeUpdate = useCallback((time: number) => {
    if (store.playingTaskId === taskId) {
      store.updateTime(time);
    }
  }, [taskId, store]);

  // Sync duration to store when ready
  const handleDurationChange = useCallback((duration: number) => {
    if (store.playingTaskId === taskId) {
      store.setDuration(duration);
    }
  }, [taskId, store]);

  // Restore position on mount if we were playing
  useEffect(() => {
    if (isActivePlayer && (store.currentTime > 0 || store.isPlaying)) {
      const videoEl = videoRef.current;
      const ws = wavesurferRef.current;

      if (store.currentTime > 0) {
        if (videoEl) {
          videoEl.currentTime = store.currentTime;
        }
        if (ws) {
          const duration = ws.getDuration();
          if (duration > 0) {
            ws.seekTo(store.currentTime / duration);
          }
        }
      }

      if (store.isPlaying) {
        videoEl?.play().catch(() => {});
        ws?.play();
      }
    }
  }, [isWaveformReady]); // Run once when waveform is ready

  return {
    handlePlay,
    handlePause,
    handleTimeUpdate,
    handleDurationChange,
    isActivePlayer,
  };
}
```

**Step 2: Commit**

```bash
git add src/hooks/usePlaybackSync.ts
git commit -m "feat: add usePlaybackSync hook for player-store synchronization"
```

---

## Task 3: Integrate usePlaybackSync into VideoPlayer

**Files:**

- Modify: `src/components/features/VideoPlayer.tsx`

**Step 1: Import usePlaybackSync**

Add import at top of file:

```typescript
import { usePlaybackSync } from '@/hooks/usePlaybackSync';
```

**Step 2: Add hook inside VideoPlayer component**

After `const [isPlaying, setIsPlaying] = React.useState(false);` add:

```typescript
const {
  handlePlay: syncHandlePlay,
  handlePause: syncHandlePause,
  handleTimeUpdate: syncHandleTimeUpdate,
  handleDurationChange: syncHandleDurationChange,
  isActivePlayer,
} = usePlaybackSync({
  taskId: task.id,
  fileName: task.fileName,
  videoRef: internalVideoRef,
  wavesurferRef: wavesurferRef,
  isWaveformReady,
});
```

**Step 3: Update existing useEffect for play/pause events**

Find the useEffect that handles play/pause events (around line 760-796). Add store sync calls:

For audio-only (WaveSurfer) case:

```typescript
ws.on("play", () => {
  setIsPlaying(true);
  syncHandlePlay();  // Add this
});
ws.on("pause", () => {
  setIsPlaying(false);
  syncHandlePause();  // Add this
});
```

For video case:

```typescript
videoElement.addEventListener("play", () => {
  setIsPlaying(true);
  syncHandlePlay();  // Add this
});
videoElement.addEventListener("pause", () => {
  setIsPlaying(false);
  syncHandlePause();  // Add this
});
```

**Step 4: Update time update handlers**

Find where time is updated (around line 665-695) and add:

```typescript
ws.on("timeupdate", (time: number) => {
  setCurrentTime(time);
  onTimeUpdate?.(time);
  syncHandleTimeUpdate(time);  // Add this
});

// And in handleTimeUpdate:
const handleTimeUpdate = () => {
  // ... existing code ...
  setCurrentTime(videoEl.currentTime);
  onTimeUpdate?.(videoEl.currentTime);
  syncHandleTimeUpdate(videoEl.currentTime);  // Add this
};
```

**Step 5: Update duration sync**

In "ready" event handler, add duration sync:

```typescript
ws.on("ready", () => {
  // ... existing code ...

  // Set duration for audio-only tasks
  const videoEl = internalVideoRef.current;
  if (!videoEl) {
    const wsDuration = ws.getDuration();
    if (Number.isFinite(wsDuration) && wsDuration > 0) {
      setDuration(wsDuration);
      syncHandleDurationChange(wsDuration);  // Add this
    }
  }
});
```

And in video timeupdate handler:

```typescript
setDuration(videoDuration);
syncHandleDurationChange(videoDuration);  // Add this
```

**Step 6: Commit**

```bash
git add src/components/features/VideoPlayer.tsx
git commit -m "feat: integrate usePlaybackSync into VideoPlayer"
```

---

## Task 4: Create MiniPlayer component

**Files:**

- Create: `src/components/features/MiniPlayer.tsx`

**Step 1: Create MiniPlayer component**

```typescript
import React, { useCallback, useState } from 'react';
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

export function MiniPlayer() {
  const store = usePlaybackStore();
  const setSelectedTask = useUIStore((s) => s.setSelectedTask);

  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

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
    setDragOffset({
      x: e.clientX,
      y: e.clientY,
    });
  }, []);

  const handleDragEnd = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;

    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;

    // Determine which quadrant the mouse is in
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

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    // Could implement smooth drag here if needed
  }, [isDragging]);

  const progress = store.duration > 0 ? (store.currentTime / store.duration) * 100 : 0;

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
      onMouseMove={handleMouseMove}
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
```

**Step 2: Commit**

```bash
git add src/components/features/MiniPlayer.tsx
git commit -m "feat: add MiniPlayer floating player component"
```

---

## Task 5: Integrate MiniPlayer into app layout

**Files:**

- Find: Root app component (likely `src/App.tsx` or `src/components/layout/`)

**Step 1: Find where to add MiniPlayer**

Search for the main layout component:

```bash
grep -r "TranscriptionView\|TranscriptionView" src/ --include="*.tsx" | head -20
```

Common locations: `src/App.tsx`, `src/pages/`, `src/components/layout/`

**Step 2: Add MiniPlayer to root layout**

Add import and render `<MiniPlayer />` in the root component. It should be placed outside of conditional rendering so it's always visible when needed.

For example, in App.tsx:

```typescript
import { MiniPlayer } from '@/components/features/MiniPlayer';

// In the JSX, render MiniPlayer at root level (outside main content):
<MainContent>
  {/* existing content */}
</MainContent>
<MiniPlayer />
```

**Step 3: Commit**

```bash
git add src/App.tsx  # or whatever file you found
git commit -m "feat: integrate MiniPlayer into app layout"
```

---

## Task 6: Add MiniPlayer visibility logic in TranscriptionView

**Files:**

- Modify: `src/components/features/TranscriptionView.tsx`

**Step 1: Add store imports**

```typescript
import { usePlaybackStore } from '@/stores/playbackStore';
```

**Step 2: Add visibility logic**

After `const task = tasks.find((t) => t.id === selectedTaskId);` add:

```typescript
const playingTaskId = usePlaybackStore((s) => s.playingTaskId);
const isPlayingTaskVisible = playingTaskId === selectedTaskId;
```

The MiniPlayer will automatically show when `isPlayingTaskVisible` is false because it checks `store.playingTaskId && store.isPlaying` - if we're on a different task, MiniPlayer stays visible.

**Step 3: Commit**

```bash
git add src/components/features/TranscriptionView.tsx
git commit -m "feat: add playback state visibility check in TranscriptionView"
```

---

## Task 7: Test all scenarios

**Step 1: Test scenario 1 - Play and leave page**

1. Open a completed transcription
2. Click play in VideoPlayer
3. Click on a different task in the list
4. Verify: MiniPlayer appears in bottom-left with correct file name and timer
5. Verify: Audio continues playing

**Step 2: Test scenario 2 - Return to playing task**

1. From scenario 1, click on the playing task in the list (or click the task name in MiniPlayer)
2. Verify: MiniPlayer disappears
3. Verify: VideoPlayer shows correct current time and play/pause state

**Step 3: Test scenario 3 - Play on different task replaces MiniPlayer**

1. MiniPlayer is showing for Task A
2. Open Task B and click play
3. Verify: MiniPlayer updates to show Task B
4. Verify: Task A stops playing, Task B plays

**Step 4: Test scenario 4 - Close MiniPlayer**

1. Click X on MiniPlayer
2. Verify: Audio stops
3. Verify: MiniPlayer disappears

**Step 5: Test scenario 5 - Drag to corners**

1. Start dragging MiniPlayer
2. Move to different quadrants
3. Release
4. Verify: MiniPlayer snaps to that corner

**Step 6: Commit**

```bash
git commit -m "test: verify MiniPlayer playback scenarios"
```

---

## Plan Complete

**All tasks completed. Summary:**

1. Created `playbackStore.ts` - Zustand store for playback state
2. Created `usePlaybackSync.ts` - Hook for VideoPlayer ↔ store sync
3. Updated `VideoPlayer.tsx` - Integrated sync hook
4. Created `MiniPlayer.tsx` - Floating player UI with drag-to-corner
5. Integrated MiniPlayer into app layout
6. Added visibility logic in TranscriptionView
7. Tested all playback scenarios

---

**For next steps:** Run `bun run build` to verify no TypeScript errors, then test manually in dev mode.

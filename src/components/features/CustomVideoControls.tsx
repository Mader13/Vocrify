import * as React from "react";
import { useEffect, useRef } from "react";
import { Play, Pause, Volume2, VolumeX } from "lucide-react";
import { cn, formatTime } from "@/lib/utils";

/**
 * Props for CustomVideoControls component
 */
interface CustomVideoControlsProps {
  /** Whether the video is currently playing */
  isPlaying: boolean;
  /** Current playback time in seconds */
  currentTime: number;
  /** Total video duration in seconds */
  duration: number;
  /** Current volume level (0-1) */
  volume: number;
  /** Callback for play/pause toggle */
  onPlayPause: () => void;
  /** Callback for seeking to a specific time */
  onSeek: (time: number) => void;
  /** Callback for changing volume */
  onVolumeChange: (volume: number) => void;
  /** Optional additional CSS classes */
  className?: string;
}

/**
 * CustomVideoControls component
 * Provides play/pause, progress seeking, volume control, and keyboard hotkeys
 * for video playback
 */
export function CustomVideoControls({
  isPlaying,
  currentTime,
  duration,
  volume,
  onPlayPause,
  onSeek,
  onVolumeChange,
  className,
}: CustomVideoControlsProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * Handle keyboard hotkeys for video control
   * Space: toggle play/pause
   * Arrow Left: seek -5s
   * Arrow Right: seek +5s
   * Arrow Up: volume +10%
   * Arrow Down: volume -10%
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore hotkeys when target is an input element
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      switch (e.key) {
        case " ":
          e.preventDefault();
          onPlayPause();
          break;
        case "ArrowLeft":
          e.preventDefault();
          onSeek(Math.max(0, currentTime - 5));
          break;
        case "ArrowRight":
          e.preventDefault();
          onSeek(Math.min(duration, currentTime + 5));
          break;
        case "ArrowUp":
          e.preventDefault();
          onVolumeChange(Math.min(1, volume + 0.1));
          break;
        case "ArrowDown":
          e.preventDefault();
          onVolumeChange(Math.max(0, volume - 0.1));
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentTime, duration, volume, onPlayPause, onSeek, onVolumeChange]);

  /**
   * Handle progress bar change
   */
  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = Number.parseFloat(e.target.value);
    onSeek(time);
  };

  /**
   * Handle volume change
   */
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = Number.parseFloat(e.target.value);
    onVolumeChange(newVolume);
  };

  /**
   * Toggle mute/unmute
   */
  const toggleMute = () => {
    onVolumeChange(volume === 0 ? 0.5 : 0);
  };

  return (
    <div
      ref={containerRef}
      className={cn("flex flex-col gap-2 p-4 bg-card rounded-lg border", className)}
    >
      {/* Progress Bar */}
      <div className="space-y-1">
        <input
          type="range"
          min="0"
          max={duration}
          step="0.1"
          value={currentTime}
          onChange={handleProgressChange}
          className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
          aria-label="Seek"
        />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Controls Row */}
      <div className="flex items-center gap-3">
        {/* Play/Pause Button */}
        <button
          onClick={onPlayPause}
          className="p-2 rounded-full hover:bg-muted transition-colors"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <Pause className="h-5 w-5" />
          ) : (
            <Play className="h-5 w-5" />
          )}
        </button>

        {/* Volume Control */}
        <div className="flex items-center gap-2 flex-1">
          <button
            onClick={toggleMute}
            className="p-2 rounded-full hover:bg-muted transition-colors"
            aria-label={volume === 0 ? "Unmute" : "Mute"}
          >
            {volume === 0 ? (
              <VolumeX className="h-5 w-5" />
            ) : (
              <Volume2 className="h-5 w-5" />
            )}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={handleVolumeChange}
            className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
            aria-label="Volume"
          />
        </div>
      </div>
    </div>
  );
}

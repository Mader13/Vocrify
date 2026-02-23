import { Play, Pause, Volume2, VolumeX, FastForward } from "lucide-react";
import { cn, formatTime } from "@/lib/utils";

interface WaveformControlsProps {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackRate: number;
  onTogglePlayPause: () => void;
  onVolumeChange: (volume: number) => void;
  onPlaybackRateChange: (rate: number) => void;
  className?: string;
}

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export function WaveformControls({
  isPlaying,
  currentTime,
  duration,
  volume,
  playbackRate,
  onTogglePlayPause,
  onVolumeChange,
  onPlaybackRateChange,
  className,
}: WaveformControlsProps) {
  const isMuted = volume === 0;
  const volumePercent = Math.round(volume * 100);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    onVolumeChange(newVolume);
  };

  const toggleMute = () => {
    if (isMuted) {
      onVolumeChange(1); // Restore to full volume
    } else {
      onVolumeChange(0); // Mute
    }
  };

  const cyclePlaybackRate = () => {
    const currentIndex = PLAYBACK_RATES.indexOf(playbackRate);
    const nextIndex = (currentIndex + 1) % PLAYBACK_RATES.length;
    onPlaybackRateChange(PLAYBACK_RATES[nextIndex]);
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-border/60 bg-muted/25 px-2.5 py-2 sm:px-4 sm:py-2.5",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <button
          onClick={onTogglePlayPause}
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-150 sm:h-9 sm:w-9",
            "hover:bg-background/80 active:scale-95",
            isPlaying
              ? "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400"
              : "bg-primary text-primary-foreground hover:bg-primary/90",
          )}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>

        <div className="flex min-w-[96px] items-center justify-center gap-1.5 rounded-md bg-background/60 px-2.5 py-1 text-[12px] font-mono text-muted-foreground sm:min-w-[108px] sm:px-3 sm:text-sm">
          <span className="font-medium text-foreground">{formatTime(currentTime)}</span>
          <span className="text-muted-foreground/60">/</span>
          <span>{formatTime(duration)}</span>
        </div>

        <button
          onClick={cyclePlaybackRate}
          className="ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-background/80 sm:ml-0 sm:h-8 sm:text-sm"
          title={`Playback speed: ${playbackRate}x (click to change)`}
        >
          <FastForward className="h-3.5 w-3.5" />
          <span className="min-w-[32px] text-center">{playbackRate}x</span>
        </button>

        <div className="hidden h-6 w-px bg-border sm:block" />

        <div className="flex w-full items-center gap-2 sm:w-auto">
          <button
            onClick={toggleMute}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-background/80"
            title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? (
              <VolumeX className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Volume2 className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={handleVolumeChange}
            className="volume-slider h-1.5 w-full cursor-pointer sm:w-24"
            title={`Volume: ${volumePercent}%`}
          />
          <span className="min-w-[38px] text-right text-xs font-medium text-muted-foreground sm:text-sm">
            {volumePercent}%
          </span>
        </div>
      </div>
    </div>
  );
}

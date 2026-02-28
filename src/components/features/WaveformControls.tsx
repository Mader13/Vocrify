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
        "rounded-lg border border-border/40 bg-transparent px-2.5 py-2 sm:px-4 sm:py-2",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <button
          onClick={onTogglePlayPause}
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-150 sm:h-9 sm:w-9",
            "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:scale-95",
          )}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current ml-0.5" />}
        </button>

        <div className="flex min-w-[96px] items-center justify-center gap-1.5 rounded-md border border-border/20 bg-background/40 px-2.5 py-1 text-[11px] font-mono text-muted-foreground sm:min-w-[108px] sm:px-3 sm:text-xs">
          <span className="font-semibold text-foreground">{formatTime(currentTime)}</span>
          <span className="text-muted-foreground/40">/</span>
          <span>{formatTime(duration)}</span>
        </div>

        <button
          onClick={cyclePlaybackRate}
          className="ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-background/80 sm:ml-0 sm:h-8 sm:text-sm"
          title={`Playback speed: ${playbackRate}x (click to change)`}
        >
          <FastForward className="h-3.5 w-3.5" />
          <span className="w-[40px] text-center">{playbackRate}x</span>
        </button>

        <div className="hidden h-6 w-px bg-border sm:block" />

        <div className="flex w-full items-center gap-2 sm:w-auto">
          <button
            onClick={toggleMute}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
            title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </button>
          <div className="group flex h-6 w-full items-center sm:w-24">
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={handleVolumeChange}
              onWheel={(e) => {
                e.preventDefault();
                const delta = -Math.sign(e.deltaY) * 0.05;
                const newVolume = Math.max(0, Math.min(1, volume + delta));
                onVolumeChange(newVolume);
              }}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:transition-transform hover:[&::-webkit-slider-thumb]:scale-125 focus-visible:[&::-webkit-slider-thumb]:ring-2 focus-visible:[&::-webkit-slider-thumb]:ring-ring [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:shadow-sm [&::-moz-range-thumb]:transition-transform hover:[&::-moz-range-thumb]:scale-125 focus-visible:[&::-moz-range-thumb]:ring-2 focus-visible:[&::-moz-range-thumb]:ring-ring"
              style={{
                background: `linear-gradient(to right, var(--primary) ${volume * 100}%, var(--border) ${volume * 100}%)`,
              }}
              title={`Volume: ${volumePercent}%`}
            />
          </div>
          <span className="min-w-[38px] text-right text-xs font-medium text-muted-foreground sm:text-sm">
            {volumePercent}%
          </span>
        </div>
      </div>
    </div>
  );
}

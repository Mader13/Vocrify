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
    <div className={cn("flex items-center gap-3 px-4 py-2 bg-muted/30 rounded-lg", className)}>
      {/* Play/Pause Button */}
      <button
        onClick={onTogglePlayPause}
        className={cn(
          "h-9 w-9 flex items-center justify-center rounded-lg transition-all duration-150 shrink-0",
          "hover:bg-background/80 active:scale-95",
          isPlaying
            ? "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400"
            : "bg-primary text-primary-foreground hover:bg-primary/90"
        )}
        title={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>

      {/* Time Display */}
      <div className="flex items-center gap-1.5 text-sm font-mono text-muted-foreground bg-background/50 px-3 py-1.5 rounded-md min-w-[100px] justify-center">
        <span className="text-foreground font-medium">{formatTime(currentTime)}</span>
        <span className="text-muted-foreground/60">/</span>
        <span>{formatTime(duration)}</span>
      </div>

      <div className="w-px h-6 bg-border" />

      {/* Volume Control */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleMute}
          className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-background/80 transition-colors shrink-0"
          title={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? <VolumeX className="h-4 w-4 text-muted-foreground" /> : <Volume2 className="h-4 w-4 text-muted-foreground" />}
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={handleVolumeChange}
          className="volume-slider w-20 cursor-pointer"
          title={`Volume: ${Math.round(volume * 100)}%`}
        />
      </div>

      <div className="w-px h-6 bg-border" />

      {/* Playback Speed Control */}
      <button
        onClick={cyclePlaybackRate}
        className="flex items-center gap-1.5 h-7 px-2.5 text-sm font-medium rounded-md hover:bg-background/80 transition-colors shrink-0 text-muted-foreground"
        title={`Playback speed: ${playbackRate}x (click to change)`}
      >
        <FastForward className="h-3.5 w-3.5" />
        <span className="min-w-[32px] text-center">{playbackRate}x</span>
      </button>
    </div>
  );
}

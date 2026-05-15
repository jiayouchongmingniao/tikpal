import { Settings } from "lucide-react";
import { FlameScene } from "./FlameScene";
import { formatDuration, formatSampleRate, playback, systemState } from "../mockState";

interface AmbientScreenProps {
  boosted: boolean;
  timeLabel: string;
  dateLabel: string;
  onOpenSettings: () => void;
}

export function AmbientScreen({ boosted, timeLabel, dateLabel, onOpenSettings }: AmbientScreenProps) {
  const progress = playback.elapsedSeconds / playback.durationSeconds;

  return (
    <section className={`ambient-screen ${boosted ? "is-boosted" : ""}`} aria-label="Ambient flame screen">
      <FlameScene />
      <div className="ambient-vignette" />

      <button className="icon-button ambient-settings" type="button" onClick={onOpenSettings} aria-label="Open settings" title="Settings">
        <Settings size={26} strokeWidth={1.8} />
      </button>

      <div className="ambient-clock" aria-label="Current time">
        <div className="ambient-time">{timeLabel}</div>
        <div className="ambient-date">{dateLabel}</div>
      </div>

      <div className="ambient-hud" aria-label="Current playback">
        <div className="ambient-cover" aria-hidden="true">
          <span>RAM</span>
        </div>
        <div className="ambient-track">
          <strong>{playback.title}</strong>
          <span>{playback.artist} - {playback.album}</span>
        </div>
        <div className="ambient-status">
          <span>{formatDuration(playback.elapsedSeconds)}</span>
          <span>{systemState.audioFormat.codec} {systemState.bitDepth}bit / {formatSampleRate(systemState.sampleRate)}</span>
          <span>{systemState.outputDevice.label}</span>
          <span>{systemState.volume.db.toFixed(1)} dB</span>
        </div>
        <div className="ambient-progress" aria-hidden="true">
          <span style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
    </section>
  );
}

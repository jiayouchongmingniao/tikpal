import { Settings } from "lucide-react";
import { FlameScene } from "./FlameScene";
import { formatDuration, formatSampleRate } from "../mockState";
import type { TikpalDataStatus } from "../hooks/useTikpalState";
import type { PlaybackSummary, SystemState } from "../types";

interface AmbientScreenProps {
  hudVisible: boolean;
  timeLabel: string;
  dateLabel: string;
  playback: PlaybackSummary;
  system: SystemState;
  status: TikpalDataStatus;
  onOpenSettings: () => void;
}

export function AmbientScreen({ hudVisible, timeLabel, dateLabel, playback, system, status, onOpenSettings }: AmbientScreenProps) {
  const title = playback.title ?? "Not Playing";
  const artist = playback.artist ?? "Unknown Artist";
  const album = playback.album ?? "No Album";
  const elapsedSeconds = playback.elapsedSeconds ?? 0;
  const durationSeconds = playback.durationSeconds ?? 0;
  const progress = durationSeconds > 0 ? Math.min(1, elapsedSeconds / durationSeconds) : 0;
  const coverLabel = album
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();

  return (
    <section className={`ambient-screen ${hudVisible ? "is-hud-visible" : "is-hud-hidden"}`} aria-label="Ambient flame screen">
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
          {playback.albumArtUrl ? <img src={playback.albumArtUrl} alt="" /> : <span>{coverLabel}</span>}
        </div>
        <div className="ambient-track">
          <strong>{title}</strong>
          <span>{artist} - {album}</span>
        </div>
        <div className="ambient-status">
          <span className={`data-pill ${status.source === "api" ? "is-live" : "is-fallback"}`}>{status.pending ? "Syncing" : status.source === "api" ? "API" : "Fallback"}</span>
          <span>{formatDuration(playback.elapsedSeconds)}</span>
          <span>{system.audioFormat.codec} {system.bitDepth}bit / {formatSampleRate(system.sampleRate)}</span>
          <span>{system.outputDevice.label}</span>
          <span>{system.volume.db.toFixed(1)} dB</span>
        </div>
        <div className="ambient-progress" aria-hidden="true">
          <span style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
    </section>
  );
}

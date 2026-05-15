import { Heart, ListMusic, Minus, Pause, Play, Plus, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { formatDuration, formatSampleRate } from "../mockState";
import type { TikpalDataStatus } from "../hooks/useTikpalState";
import type { PlaybackActionType, PlaybackSummary, SystemState } from "../types";

interface PlayerOverlayProps {
  active: boolean;
  playback: PlaybackSummary;
  system: SystemState;
  status: TikpalDataStatus;
  onPlaybackAction: (type: PlaybackActionType, value?: number) => Promise<void>;
  onReturnAmbient: () => void;
}

export function PlayerOverlay({ active, playback, system, status, onPlaybackAction, onReturnAmbient }: PlayerOverlayProps) {
  const title = playback.title ?? "Not Playing";
  const artist = playback.artist ?? "Unknown Artist";
  const album = playback.album ?? "No Album";
  const elapsedSeconds = playback.elapsedSeconds ?? 0;
  const durationSeconds = playback.durationSeconds ?? 0;
  const progress = durationSeconds > 0 ? Math.min(1, elapsedSeconds / durationSeconds) : 0;
  const sourceLabel = playback.source.toUpperCase();
  const isPlaying = playback.state === "playing";
  const coverLabel = album
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
  const statusCards = [
    {
      label: "AUDIO",
      value: `${system.audioFormat.codec} ${system.bitDepth}bit / ${formatSampleRate(system.sampleRate)}`,
      meta: system.audioFormat.container
    },
    {
      label: "OUTPUT",
      value: system.outputDevice.label,
      meta: system.outputDevice.detail
    },
    {
      label: "VOLUME",
      value: `${system.volume.db.toFixed(1)} dB`,
      meta: `${system.volume.percent}%`
    },
    {
      label: "NETWORK",
      value: `${system.network.label} - ${system.network.speed}`,
      meta: system.network.ip
    }
  ];

  return (
    <section className={`overlay player-overlay ${active ? "is-active" : ""}`} aria-label="Player controls" aria-hidden={!active}>
      <button className="overlay-backdrop" type="button" tabIndex={active ? 0 : -1} aria-label="Return to ambient" onClick={onReturnAmbient} />
      <div className="player-shell" role="dialog" aria-modal="true" data-gesture-protected>
        <div className="cover-zone">
          <div className="cover-art">
            {playback.albumArtUrl ? (
              <img src={playback.albumArtUrl} alt="" />
            ) : (
              <>
                <div className="helmet-shine" />
                <span>{coverLabel}</span>
              </>
            )}
          </div>
        </div>

        <div className="playback-zone">
          <div className="source-line">
            <span>{sourceLabel} {playback.state}</span>
            <span>{system.library.source}</span>
            <span>{status.pending ? "Syncing" : status.source === "api" ? "API Confirmed" : "Fallback Data"}</span>
          </div>

          <div className="track-stack">
            <h1>{title}</h1>
            <p className="artist">{artist}</p>
            <p>{album}</p>
            <p>{playback.currentTrackIndex} of {playback.queueLength}</p>
          </div>

          <div className="progress-row">
            <span>{formatDuration(playback.elapsedSeconds)}</span>
            <div className="progress-bar" aria-hidden="true">
              <span style={{ width: `${progress * 100}%` }} />
            </div>
            <span>{formatDuration(playback.durationSeconds)}</span>
          </div>

          <div className="transport-row" aria-label="Playback controls">
            <button className="icon-button" type="button" aria-label="Queue" title="Queue">
              <ListMusic size={30} />
            </button>
            <button className="icon-button" type="button" aria-label="Previous" title="Previous" disabled={status.pending} onClick={() => void onPlaybackAction("previous")}>
              <SkipBack size={34} fill="currentColor" />
            </button>
            <button className="play-button" type="button" aria-label={isPlaying ? "Pause" : "Play"} title={isPlaying ? "Pause" : "Play"} disabled={status.pending} onClick={() => void onPlaybackAction("play_pause")}>
              {isPlaying ? <Pause size={40} fill="currentColor" /> : <Play size={40} fill="currentColor" />}
            </button>
            <button className="icon-button" type="button" aria-label="Next" title="Next" disabled={status.pending} onClick={() => void onPlaybackAction("next")}>
              <SkipForward size={34} fill="currentColor" />
            </button>
            <button className="icon-button" type="button" aria-label="Favorite" title="Favorite" disabled={status.pending} onClick={() => void onPlaybackAction("favorite_toggle")}>
              <Heart size={30} fill={playback.favorite ? "currentColor" : "none"} />
            </button>
          </div>
        </div>

        <div className="status-zone">
          {statusCards.map((card) => (
            <article className="status-card" key={card.label}>
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <p>{card.meta}</p>
            </article>
          ))}
          <article className="status-card volume-card">
            <span>LEVEL</span>
            <strong>{system.volume.db.toFixed(1)} dB</strong>
            <div className="mini-slider" aria-hidden="true">
              <span style={{ width: `${system.volume.percent}%` }} />
            </div>
            <div className="volume-actions">
              <button type="button" aria-label="Volume down" title="Volume down" disabled={status.pending} onClick={() => void onPlaybackAction("volume_set", Math.max(0, system.volume.percent - 5))}>
                <Minus size={18} />
              </button>
              <button type="button" aria-label="Volume up" title="Volume up" disabled={status.pending} onClick={() => void onPlaybackAction("volume_set", Math.min(100, system.volume.percent + 5))}>
                <Plus size={18} />
              </button>
            </div>
            <Volume2 size={24} />
          </article>
        </div>
      </div>
    </section>
  );
}

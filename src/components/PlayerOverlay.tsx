import { Heart, ListMusic, Pause, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { formatDuration, formatSampleRate, playback, systemState } from "../mockState";

interface PlayerOverlayProps {
  active: boolean;
  onReturnAmbient: () => void;
}

const statusCards = [
  {
    label: "AUDIO",
    value: `${systemState.audioFormat.codec} ${systemState.bitDepth}bit / ${formatSampleRate(systemState.sampleRate)}`,
    meta: systemState.audioFormat.container
  },
  {
    label: "OUTPUT",
    value: systemState.outputDevice.label,
    meta: systemState.outputDevice.detail
  },
  {
    label: "VOLUME",
    value: `${systemState.volume.db.toFixed(1)} dB`,
    meta: `${systemState.volume.percent}%`
  },
  {
    label: "NETWORK",
    value: `${systemState.network.label} - ${systemState.network.speed}`,
    meta: systemState.network.ip
  }
];

export function PlayerOverlay({ active, onReturnAmbient }: PlayerOverlayProps) {
  const progress = playback.elapsedSeconds / playback.durationSeconds;

  return (
    <section className={`overlay player-overlay ${active ? "is-active" : ""}`} aria-label="Player controls" aria-hidden={!active}>
      <button className="overlay-backdrop" type="button" tabIndex={active ? 0 : -1} aria-label="Return to ambient" onClick={onReturnAmbient} />
      <div className="player-shell" role="dialog" aria-modal="true">
        <div className="cover-zone">
          <div className="cover-art">
            <div className="helmet-shine" />
            <span>RAM</span>
          </div>
        </div>

        <div className="playback-zone">
          <div className="source-line">
            <span>MPD Ready</span>
            <span>NAS</span>
            <span>Music Library</span>
          </div>

          <div className="track-stack">
            <h1>{playback.title}</h1>
            <p className="artist">{playback.artist}</p>
            <p>{playback.album}</p>
            <p>2013 - 1 of 13</p>
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
            <button className="icon-button" type="button" aria-label="Previous" title="Previous">
              <SkipBack size={34} fill="currentColor" />
            </button>
            <button className="play-button" type="button" aria-label="Pause" title="Pause">
              <Pause size={40} fill="currentColor" />
            </button>
            <button className="icon-button" type="button" aria-label="Next" title="Next">
              <SkipForward size={34} fill="currentColor" />
            </button>
            <button className="icon-button" type="button" aria-label="Favorite" title="Favorite">
              <Heart size={30} />
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
            <strong>{systemState.volume.db.toFixed(1)} dB</strong>
            <div className="mini-slider" aria-hidden="true">
              <span style={{ width: `${systemState.volume.percent}%` }} />
            </div>
            <Volume2 size={24} />
          </article>
        </div>
      </div>
    </section>
  );
}

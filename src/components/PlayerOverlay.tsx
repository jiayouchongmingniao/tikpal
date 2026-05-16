import { useEffect, useState } from "react";
import { Check, Disc3, Heart, ListMusic, LoaderCircle, Minus, Pause, Play, Plus, Radio, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { formatDuration, formatSampleRate } from "../mockState";
import { buildGeneratedCoverArtUrl } from "../coverArt";
import type { TikpalDataStatus } from "../hooks/useTikpalState";
import { useOverlayReturnGesture } from "../hooks/useOverlayReturnGesture";
import type { AudioState, PlaybackActionType, PlaybackSummary, RadioStationSummary, SourceSummary, SourceSwitchTarget, SystemState, TikpalState } from "../types";

interface PlayerOverlayProps {
  active: boolean;
  playback: PlaybackSummary;
  audio: AudioState;
  system: SystemState;
  status: TikpalDataStatus;
  onPlaybackAction: (type: PlaybackActionType, value?: number) => Promise<TikpalState>;
  onSourceSwitch: (target: SourceSwitchTarget, radioStationId?: string) => Promise<TikpalState>;
  onReturnAmbient: () => void;
}

const sourceTargets: SourceSwitchTarget[] = ["mpd", "spotify", "radio"];

function sourceActionLabel(source: SourceSummary) {
  if (source.active) return "Active";
  if (source.availability === "unavailable") return "Unavailable";
  if (source.controllability === "handoff") return "Connect";
  return "Switch";
}

function sourceIcon(source: SourceSummary) {
  switch (source.id) {
    case "spotify":
      return Disc3;
    case "radio":
      return Radio;
    default:
      return ListMusic;
  }
}

function findSource(audio: AudioState, target: SourceSwitchTarget) {
  return audio.sources.find((source): source is SourceSummary & { id: SourceSwitchTarget } => source.id === target);
}

function activeRadio(audio: AudioState) {
  return audio.radios.find((radio) => radio.active) ?? null;
}

export function PlayerOverlay({
  active,
  playback,
  audio,
  system,
  status,
  onPlaybackAction,
  onSourceSwitch,
  onReturnAmbient
}: PlayerOverlayProps) {
  const overlayReturnGesture = useOverlayReturnGesture(onReturnAmbient);
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const [queuePanelOpen, setQueuePanelOpen] = useState(false);
  const [pendingSource, setPendingSource] = useState<SourceSwitchTarget | null>(null);
  const [pendingRadioStationId, setPendingRadioStationId] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceHint, setSourceHint] = useState<string | null>(null);
  const [seekDraftSeconds, setSeekDraftSeconds] = useState<number | null>(null);
  const [seekPendingSeconds, setSeekPendingSeconds] = useState<number | null>(null);
  const [seekError, setSeekError] = useState<string | null>(null);
  const title = playback.title ?? "Not Playing";
  const artist = playback.artist ?? "Unknown Artist";
  const album = playback.album ?? "No Album";
  const elapsedSeconds = playback.elapsedSeconds ?? 0;
  const durationSeconds = playback.durationSeconds ?? 0;
  const seekSupported = playback.source === "mpd" && durationSeconds > 0;
  const displayedElapsedSeconds = seekDraftSeconds ?? seekPendingSeconds ?? elapsedSeconds;
  const progress = durationSeconds > 0 ? Math.min(1, displayedElapsedSeconds / durationSeconds) : 0;
  const isPlaying = playback.state === "playing";
  const currentSource = audio.currentSource;
  const coverLabel = album
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
  const coverArtUrl = playback.albumArtUrl ?? buildGeneratedCoverArtUrl(title, artist, album);
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

  useEffect(() => {
    if (!active) {
      setSourcePanelOpen(false);
      setQueuePanelOpen(false);
      setPendingSource(null);
      setPendingRadioStationId(null);
      setSourceError(null);
      setSourceHint(null);
      setSeekDraftSeconds(null);
      setSeekPendingSeconds(null);
      setSeekError(null);
    }
  }, [active]);

  useEffect(() => {
    if (!seekSupported) {
      setSeekDraftSeconds(null);
      setSeekPendingSeconds(null);
      setSeekError(null);
    }
  }, [seekSupported]);

  async function handleSourceSwitch(target: SourceSwitchTarget, radioStation?: RadioStationSummary) {
    if (status.pending || pendingSource) return;
    setPendingSource(target);
    setPendingRadioStationId(radioStation?.id ?? null);
    setSourceError(null);
    setSourceHint(null);
    try {
      const nextState = await onSourceSwitch(target, radioStation?.id);
      const nextSource = findSource(nextState.audio, target);

      if (target === "spotify" && nextSource?.availability === "waiting" && !nextSource.active) {
        setSourceHint("Spotify Connect is ready on this device. Start playback from the Spotify app to hand off audio.");
      } else if (target === "spotify" && nextSource?.active) {
        setSourceHint("Spotify is now the active source on this device.");
      } else if (target === "radio" && nextSource?.active) {
        const nextRadio = activeRadio(nextState.audio);
        setSourceHint(`Radio switched to ${nextRadio?.label ?? nextSource.label}.`);
      } else if (target === "mpd" && nextSource?.active) {
        setSourceHint("Returned to the local library playback path.");
      }
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : "Source switch failed");
    } finally {
      setPendingSource(null);
      setPendingRadioStationId(null);
    }
  }

  async function commitSeek(nextSeconds: number | null) {
    if (!seekSupported || nextSeconds === null || status.pending) {
      setSeekDraftSeconds(null);
      return;
    }

    const clampedSeconds = Math.max(0, Math.min(durationSeconds, Math.round(nextSeconds)));
    setSeekDraftSeconds(null);
    setSeekPendingSeconds(clampedSeconds);
    setSeekError(null);

    try {
      await onPlaybackAction("seek", clampedSeconds);
    } catch (error) {
      setSeekError(error instanceof Error ? error.message : "Seek failed");
    } finally {
      setSeekPendingSeconds(null);
    }
  }

  function handleSeekDraft(value: string) {
    setSeekDraftSeconds(Number(value));
    setSeekError(null);
  }

  return (
    <section className={`overlay player-overlay ${active ? "is-active" : ""}`} aria-label="Player controls" aria-hidden={!active}>
      <button className="overlay-backdrop" type="button" tabIndex={active ? 0 : -1} aria-label="Return to ambient" onClick={onReturnAmbient} />
      <div className="player-shell" role="dialog" aria-modal="true" data-gesture-protected {...overlayReturnGesture}>
        <div className="cover-zone">
          <div className="cover-art">
            <img src={coverArtUrl} alt="" />
            {!playback.albumArtUrl ? (
              <>
                <div className="helmet-shine" />
                <span>{coverLabel}</span>
              </>
            ) : null}
          </div>
        </div>

        <div className="playback-zone">
          <div className="source-line">
            <span>{currentSource.label} {playback.state}</span>
            <span>{currentSource.secondaryStatus}</span>
            <span>{status.pending ? "Syncing" : status.source === "api" ? "API Confirmed" : "Fallback Data"}</span>
          </div>

          <div className="track-stack">
            <h1>{title}</h1>
            <p className="artist">{artist}</p>
            <p>{album}</p>
            <p>{playback.currentTrackIndex} of {playback.queueLength}</p>
          </div>

          <div className={`source-panel ${sourcePanelOpen ? "is-open" : ""}`}>
            <div className="source-panel-header">
              <div>
                <span className="source-panel-kicker">Source</span>
                <strong>{currentSource.label}</strong>
                <p>{currentSource.secondaryStatus}</p>
              </div>
              <button
                className="source-panel-toggle"
                type="button"
                aria-expanded={sourcePanelOpen}
                data-source-panel-toggle
                onClick={() => setSourcePanelOpen((current) => !current)}
              >
                {sourcePanelOpen ? "Hide" : "Show"} Sources
              </button>
            </div>

            {sourcePanelOpen ? (
              <div className="source-options" data-source-panel>
                {audio.sources
                  .filter((source): source is SourceSummary & { id: SourceSwitchTarget } => sourceTargets.includes(source.id as SourceSwitchTarget))
                  .map((source) => {
                    const Icon = sourceIcon(source);
                    const isPending = pendingSource === source.id;
                    const disabled = status.pending || pendingSource !== null || source.availability === "unavailable";
                    const sourceRadios = source.id === "radio" ? audio.radios : [];

                    return (
                      <div className={`source-item-wrap ${source.id === "radio" ? "has-radio-list" : ""}`} key={source.id}>
                        <button
                          className={`source-item ${source.active ? "is-active" : ""} source-${source.availability}`}
                          type="button"
                          data-source-item={source.id}
                          disabled={disabled}
                          onClick={() => void handleSourceSwitch(source.id)}
                        >
                          <div className="source-item-icon">
                            <Icon size={20} />
                          </div>
                          <div className="source-item-copy">
                            <div className="source-item-title-row">
                              <strong>{source.label}</strong>
                              <span>{sourceActionLabel(source)}</span>
                            </div>
                            <p>{isPending ? "Switching source..." : source.secondaryStatus}</p>
                          </div>
                          <div className="source-item-state" aria-hidden="true">
                            {isPending ? <LoaderCircle size={18} className="is-spinning" /> : source.active ? <Check size={18} /> : null}
                          </div>
                        </button>

                        {source.id === "radio" && sourceRadios.length > 0 ? (
                          <div className="radio-station-list">
                            {sourceRadios.map((station) => {
                              const stationPending = pendingRadioStationId === station.id;
                              return (
                                <button
                                  className={`radio-station-item ${station.active ? "is-active" : ""}`}
                                  key={station.id}
                                  type="button"
                                  disabled={status.pending || pendingSource !== null}
                                  onClick={() => void handleSourceSwitch("radio", station)}
                                >
                                  <div className="radio-station-copy">
                                    <strong>{station.label}</strong>
                                    <p>{stationPending ? "Switching station..." : station.secondaryStatus}</p>
                                  </div>
                                  <div className="radio-station-state" aria-hidden="true">
                                    {stationPending ? <LoaderCircle size={16} className="is-spinning" /> : station.active ? <Check size={16} /> : null}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
              </div>
            ) : null}

            {sourceError ? <p className="source-panel-error">{sourceError}</p> : null}
            {!sourceError && sourceHint ? <p className="source-panel-hint">{sourceHint}</p> : null}
          </div>

          <div className="progress-row">
            <span>{formatDuration(displayedElapsedSeconds)}</span>
            <div className={`progress-control ${seekSupported ? "is-interactive" : "is-readonly"}`}>
              <div className="progress-bar" aria-hidden="true">
                <span style={{ width: `${progress * 100}%` }} />
              </div>
              {seekSupported ? (
                <input
                  className="progress-slider"
                  type="range"
                  min={0}
                  max={durationSeconds}
                  step={1}
                  value={seekDraftSeconds ?? seekPendingSeconds ?? elapsedSeconds}
                  aria-label="Seek position"
                  disabled={status.pending}
                  onChange={(event) => handleSeekDraft(event.currentTarget.value)}
                  onPointerUp={() => void commitSeek(seekDraftSeconds)}
                  onPointerCancel={() => setSeekDraftSeconds(null)}
                  onBlur={() => void commitSeek(seekDraftSeconds)}
                  onKeyUp={(event) => {
                    if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End" || event.key === "PageUp" || event.key === "PageDown") {
                      void commitSeek(seekDraftSeconds);
                    }
                  }}
                />
              ) : null}
            </div>
            <span>{formatDuration(playback.durationSeconds)}</span>
          </div>
          {seekError ? <p className="player-inline-message is-error">{seekError}</p> : null}
          {!seekError && seekPendingSeconds !== null ? <p className="player-inline-message">Seeking to {formatDuration(seekPendingSeconds)}...</p> : null}

          <div className="transport-row" aria-label="Playback controls">
            <button
              className={`icon-button ${queuePanelOpen ? "is-active" : ""}`}
              type="button"
              aria-label="Queue"
              title="Queue"
              aria-expanded={queuePanelOpen}
              onClick={() => setQueuePanelOpen((current) => !current)}
            >
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
          {queuePanelOpen ? (
            <section className="queue-panel" aria-label="Playback queue" data-queue-panel>
              <div className="queue-panel-header">
                <div>
                  <span className="source-panel-kicker">Queue</span>
                  <strong>{playback.queueLength > 0 ? `${playback.currentTrackIndex} / ${playback.queueLength}` : "No active queue"}</strong>
                  <p>{playback.source === "mpd" ? "Current and upcoming library entries" : "Queue preview is only available for local library playback"}</p>
                </div>
              </div>
              {playback.queuePreview.length > 0 ? (
                <div className="queue-list">
                  {playback.queuePreview.map((entry) => (
                    <article className={`queue-entry ${entry.active ? "is-active" : ""}`} key={entry.id}>
                      <span className="queue-entry-position">{String(entry.position).padStart(2, "0")}</span>
                      <div className="queue-entry-copy">
                        <strong>{entry.title}</strong>
                        <p>{entry.artist} · {entry.album}</p>
                      </div>
                      <span className="queue-entry-duration">{formatDuration(entry.durationSeconds)}</span>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="queue-panel-empty">
                  {playback.source === "mpd"
                    ? "Queue preview is temporarily unavailable."
                    : "Switch back to Library to inspect the active queue."}
                </p>
              )}
            </section>
          ) : null}
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

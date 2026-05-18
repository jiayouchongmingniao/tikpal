import { useDeferredValue, useEffect, useState } from "react";
import {
  Bluetooth,
  Cast,
  Check,
  Heart,
  LibraryBig,
  ListMusic,
  LoaderCircle,
  Minus,
  Pause,
  Play,
  Plus,
  Radio,
  Search,
  SkipBack,
  SkipForward,
  Volume2
} from "lucide-react";
import { fetchRadioCatalog } from "../api/tikpalClient";
import { buildGeneratedCoverArtUrl } from "../coverArt";
import type { TikpalDataStatus } from "../hooks/useTikpalState";
import { formatDuration, formatSampleRate } from "../mockState";
import { useOverlayReturnGesture } from "../hooks/useOverlayReturnGesture";
import type {
  AudioState,
  PlaybackActionType,
  PlaybackSummary,
  RadioCatalogResponse,
  RadioStationSummary,
  SourceSummary,
  SourceSwitchTarget,
  SystemState,
  TikpalState
} from "../types";

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

const primarySourceTargets: SourceSwitchTarget[] = ["mpd", "radio", "bluetooth", "airplay"];

const EMPTY_RADIO_CATALOG: RadioCatalogResponse = {
  stations: [],
  total: 0,
  genres: [],
  bitrates: [],
  filters: {
    q: "",
    genre: "",
    bitrate: "",
    limit: 120,
    offset: 0
  },
  updatedAt: ""
};

function sourceActionLabel(source: SourceSummary) {
  if (source.active) return "Active";
  if (source.id === "radio") return "Browse";
  if (source.connectionState === "armed") return "Armed";
  if (source.connectionState === "connected") return "Connected";
  if (source.controllability === "status-only") return "Locked";
  return "Select";
}

function sourceActionCopy(source: SourceSummary) {
  switch (source.id) {
    case "bluetooth":
      return source.active ? "Pairing Open" : "Open Pairing";
    case "airplay":
      return source.active ? "AirPlay Open" : "Open AirPlay";
    case "radio":
      return source.active ? "Live Radio" : "Browse Radios";
    case "mpd":
    default:
      return source.active ? "In Library" : "Return to Library";
  }
}

function sourceIcon(source: SourceSummary) {
  switch (source.id) {
    case "radio":
      return Radio;
    case "bluetooth":
      return Bluetooth;
    case "airplay":
      return Cast;
    case "mpd":
    default:
      return LibraryBig;
  }
}

function findSource(audio: AudioState, target: SourceSwitchTarget) {
  return audio.sources.find((source): source is SourceSummary & { id: SourceSwitchTarget } => source.id === target);
}

function sourceDiscoveryCopy(source: SourceSummary) {
  if (!source.advertisedLabel) return null;
  return source.id === "bluetooth"
    ? `Look for ${source.advertisedLabel} in your phone's Bluetooth list.`
    : `Look for ${source.advertisedLabel} in your AirPlay target list.`;
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
  const [queuePanelOpen, setQueuePanelOpen] = useState(false);
  const [selectedSource, setSelectedSource] = useState<SourceSwitchTarget>("mpd");
  const [pendingSource, setPendingSource] = useState<SourceSwitchTarget | null>(null);
  const [pendingRadioStationId, setPendingRadioStationId] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceHint, setSourceHint] = useState<string | null>(null);
  const [seekDraftSeconds, setSeekDraftSeconds] = useState<number | null>(null);
  const [seekPendingSeconds, setSeekPendingSeconds] = useState<number | null>(null);
  const [seekError, setSeekError] = useState<string | null>(null);
  const [radioQuery, setRadioQuery] = useState("");
  const [radioGenre, setRadioGenre] = useState("");
  const [radioBitrate, setRadioBitrate] = useState("");
  const [radioCatalog, setRadioCatalog] = useState<RadioCatalogResponse>(EMPTY_RADIO_CATALOG);
  const [radioLoading, setRadioLoading] = useState(false);
  const [radioError, setRadioError] = useState<string | null>(null);
  const deferredRadioQuery = useDeferredValue(radioQuery);
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
  const selectedSourceSummary = findSource(audio, selectedSource) ?? audio.currentSource;
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
      setQueuePanelOpen(false);
      setPendingSource(null);
      setPendingRadioStationId(null);
      setSourceError(null);
      setSourceHint(null);
      setSeekDraftSeconds(null);
      setSeekPendingSeconds(null);
      setSeekError(null);
      setRadioError(null);
      setRadioLoading(false);
    }
  }, [active]);

  useEffect(() => {
    if (primarySourceTargets.includes(currentSource.id as SourceSwitchTarget)) {
      setSelectedSource(currentSource.id as SourceSwitchTarget);
    }
  }, [currentSource.id]);

  useEffect(() => {
    if (!seekSupported) {
      setSeekDraftSeconds(null);
      setSeekPendingSeconds(null);
      setSeekError(null);
    }
  }, [seekSupported]);

  useEffect(() => {
    if (!active || selectedSource !== "radio") return;

    const controller = new AbortController();
    setRadioLoading(true);
    setRadioError(null);

    void fetchRadioCatalog(
      {
        q: deferredRadioQuery,
        genre: radioGenre,
        bitrate: radioBitrate,
        limit: 120
      },
      controller.signal
    )
      .then((catalog) => {
        setRadioCatalog(catalog);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setRadioError(error instanceof Error ? error.message : "Radio catalog unavailable");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setRadioLoading(false);
        }
      });

    return () => controller.abort();
  }, [active, deferredRadioQuery, radioBitrate, radioGenre, selectedSource]);

  async function handleSourceSwitch(target: SourceSwitchTarget, radioStation?: RadioStationSummary) {
    if (status.pending || pendingSource) return;
    setPendingSource(target);
    setPendingRadioStationId(radioStation?.id ?? null);
    setSourceError(null);
    setSourceHint(null);
    try {
      const nextState = await onSourceSwitch(target, radioStation?.id);
      const nextSource = findSource(nextState.audio, target);

      if (target === "radio" && nextSource?.active) {
        setSourceHint(`${radioStation?.label ?? nextSource.label} live.`);
      } else if (target === "bluetooth" && nextSource) {
        setSourceHint(
          nextSource.connectedLabel
            ? `Bluetooth: ${nextSource.connectedLabel}.`
            : nextSource.advertisedLabel
              ? `Bluetooth ready as ${nextSource.advertisedLabel}.`
              : "Bluetooth ready."
        );
      } else if (target === "airplay" && nextSource) {
        setSourceHint(
          nextSource.connectedLabel
            ? `AirPlay: ${nextSource.connectedLabel}.`
            : nextSource.advertisedLabel
              ? `AirPlay ready as ${nextSource.advertisedLabel}.`
              : "AirPlay ready."
        );
      } else if (target === "mpd" && nextSource?.active) {
        setSourceHint("Library ready.");
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

  async function handleSourceRailPress(source: SourceSummary & { id: SourceSwitchTarget }) {
    setSelectedSource(source.id);
    if (source.id === "radio") {
      if (!source.active) {
        await handleSourceSwitch("radio");
      }
      return;
    }

    await handleSourceSwitch(source.id);
  }

  function renderSourceWorkspaceContent() {
    if (selectedSource === "radio") {
      return (
        <section className="source-workspace-content" aria-label="Radio catalog">
          <div className="radio-filter-row">
            <label className="source-search-field" data-radio-search>
              <Search size={18} />
              <input
                type="search"
                value={radioQuery}
                placeholder="Search station name or genre"
                onChange={(event) => setRadioQuery(event.currentTarget.value)}
              />
            </label>
            <label className="source-filter-field">
              <span>Genre</span>
              <select value={radioGenre} onChange={(event) => setRadioGenre(event.currentTarget.value)}>
                <option value="">All</option>
                {radioCatalog.genres.map((genre) => (
                  <option key={genre} value={genre}>{genre}</option>
                ))}
              </select>
            </label>
            <label className="source-filter-field">
              <span>Bitrate</span>
              <select value={radioBitrate} onChange={(event) => setRadioBitrate(event.currentTarget.value)}>
                <option value="">All</option>
                {radioCatalog.bitrates.map((bitrate) => (
                  <option key={bitrate} value={bitrate}>{bitrate}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="source-result-meta">
            <span>{radioLoading ? "Refreshing stations..." : `${radioCatalog.total} stations`}</span>
            <span>{radioCatalog.filters.genre || "All genres"}</span>
          </div>

          {radioError ? <p className="source-panel-error">{radioError}</p> : null}

          <div className="radio-catalog-list">
            {radioCatalog.stations.map((station) => {
              const stationPending = pendingRadioStationId === station.id;
              return (
                <button
                  className={`radio-catalog-item ${station.active ? "is-active" : ""}`}
                  key={station.id}
                  type="button"
                  disabled={status.pending || pendingSource !== null}
                  data-radio-station={station.id}
                  data-gesture-control
                  onClick={() => void handleSourceSwitch("radio", station)}
                >
                  <div className="radio-catalog-copy">
                    <strong>{station.label}</strong>
                    <p>{stationPending ? "Switching station..." : station.secondaryStatus}</p>
                  </div>
                  <div className="radio-catalog-meta">
                    <span>{station.genre || "Radio"}</span>
                  </div>
                  <div className="radio-station-state" aria-hidden="true">
                    {stationPending ? <LoaderCircle size={16} className="is-spinning" /> : station.active ? <Check size={16} /> : null}
                  </div>
                </button>
              );
            })}
            {!radioLoading && radioCatalog.stations.length === 0 ? (
              <p className="queue-panel-empty">No stations matched the current filters.</p>
            ) : null}
          </div>
        </section>
      );
    }

    const selectedIcon = sourceIcon(selectedSourceSummary);
    const SourceIcon = selectedIcon;
    const canSwitch = selectedSourceSummary.controllability !== "status-only" && selectedSourceSummary.availability !== "unavailable";
    const isPending = pendingSource === selectedSource;

    return (
      <section className="source-workspace-content" aria-label={`${selectedSourceSummary.label} source`}>
        <div className="source-hero-card">
          <div className="source-hero-icon">
            <SourceIcon size={28} />
          </div>
          <div className="source-hero-copy">
            <span className="source-panel-kicker">{selectedSourceSummary.label}</span>
            <strong>{selectedSourceSummary.secondaryStatus}</strong>
            <p>
              {selectedSourceSummary.id === "bluetooth" || selectedSourceSummary.id === "airplay"
                ? sourceDiscoveryCopy(selectedSourceSummary) ?? selectedSourceSummary.secondaryStatus
                : selectedSourceSummary.secondaryStatus}
            </p>
          </div>
          <button
            className={`source-hero-action ${selectedSourceSummary.active ? "is-active" : ""}`}
            type="button"
            disabled={status.pending || pendingSource !== null || !canSwitch}
            data-gesture-control
            onClick={() => void handleSourceSwitch(selectedSource)}
          >
            {isPending ? <LoaderCircle size={18} className="is-spinning" /> : null}
            <span>{sourceActionCopy(selectedSourceSummary)}</span>
          </button>
        </div>
      </section>
    );
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

          <div className="source-panel source-workspace">
            <div className="source-panel-header">
              <div>
                <span className="source-panel-kicker">Sources</span>
                <strong>{currentSource.label}</strong>
                <p>Tap once to switch.</p>
              </div>
            </div>

              <div className="source-workspace-shell" data-source-workspace data-source-panel>
                <nav className="source-rail" aria-label="Source categories">
                  {audio.sources
                    .filter((source): source is SourceSummary & { id: SourceSwitchTarget } => primarySourceTargets.includes(source.id as SourceSwitchTarget))
                    .map((source) => {
                      const Icon = sourceIcon(source);
                      const isSelected = selectedSource === source.id;
                      return (
                        <button
                          className={`source-rail-item ${isSelected ? "is-selected" : ""} ${source.active ? "is-active" : ""}`}
                          key={source.id}
                          type="button"
                          data-source-item={source.id}
                          data-gesture-control
                          onClick={() => void handleSourceRailPress(source)}
                        >
                          <div className="source-item-icon">
                            <Icon size={20} />
                          </div>
                          <div className="source-item-copy">
                            <div className="source-item-title-row">
                              <strong>{source.label}</strong>
                              <span>{sourceActionLabel(source)}</span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                </nav>

                {renderSourceWorkspaceContent()}
              </div>

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

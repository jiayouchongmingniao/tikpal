import { Airplay, Bluetooth, Globe2, Music, PanelRightClose, Pause, Play, Radio, RefreshCw, SkipBack, SkipForward, SlidersHorizontal, Sun, Volume2, Wifi } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchRemoteCatalog, fetchRemoteState, readStoredRemoteKey, sendRemoteAction, storeRemoteKey } from "../api/remoteClient";
import { friendlyUiError, playbackFallbackCopy } from "../uiCopy";
import type { RemoteActionRequest, RemoteCatalogResponse, RemoteStateResponse, RoomMode, SourceState } from "../types";

const REFRESH_MS = 2500;
const REMOTE_SLIDER_COMMIT_MS = 300;

function sourceIcon(source: SourceState) {
  switch (source) {
    case "radio":
      return <Radio aria-hidden="true" />;
    case "bluetooth":
      return <Bluetooth aria-hidden="true" />;
    case "airplay":
      return <Airplay aria-hidden="true" />;
    case "spotify":
    case "upnp":
      return <Wifi aria-hidden="true" />;
    default:
      return <Music aria-hidden="true" />;
  }
}

function roomLabel(mode: RoomMode) {
  return mode === "hifi" ? "Hi-Fi" : `${mode.slice(0, 1).toUpperCase()}${mode.slice(1)}`;
}

function formatTrack(state: RemoteStateResponse | null) {
  if (!state) return { title: "Connecting", artist: "Tikpal Remote" };
  return {
    title: state.playback.title || playbackFallbackCopy.title,
    artist: [state.playback.artist, state.playback.album].filter(Boolean).join(" / ") || state.source.current.label
  };
}

function remotePlaybackStateLabel(state: RemoteStateResponse | null) {
  if (!state) return "Updating";
  if (state.playback.state === "playing") return "Playing";
  if (state.playback.state === "paused") return "Paused";
  if (state.playback.state === "stopped") return "Stopped";
  return "Ready";
}

export function RemoteControlApp() {
  const [remoteState, setRemoteState] = useState<RemoteStateResponse | null>(null);
  const [catalog, setCatalog] = useState<RemoteCatalogResponse | null>(null);
  const [remoteKey, setRemoteKey] = useState(readStoredRemoteKey);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [volumeDraft, setVolumeDraft] = useState(0);
  const [brightnessDraft, setBrightnessDraft] = useState(0);
  const volumeDraftRef = useRef(volumeDraft);
  const brightnessDraftRef = useRef(brightnessDraft);
  const volumeCommitTimerRef = useRef<number | null>(null);
  const brightnessCommitTimerRef = useRef<number | null>(null);
  const track = useMemo(() => formatTrack(remoteState), [remoteState]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const [nextState, nextCatalog] = await Promise.all([
        fetchRemoteState(signal),
        fetchRemoteCatalog(signal)
      ]);
      setRemoteState(nextState);
      setCatalog(nextCatalog);
      setRefreshError(null);
    } catch (caught) {
      if (signal?.aborted) return;
      setRefreshError(caught instanceof Error ? caught.message : "Tikpal Remote unavailable");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const interval = window.setInterval(() => {
      void refresh();
    }, REFRESH_MS);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [refresh]);

  useEffect(() => {
    if (!remoteState) return;
    setVolumeDraft(remoteState.volume.percent);
    volumeDraftRef.current = remoteState.volume.percent;
    setBrightnessDraft(remoteState.display.brightnessPercent);
    brightnessDraftRef.current = remoteState.display.brightnessPercent;
  }, [remoteState]);

  useEffect(() => () => {
    if (volumeCommitTimerRef.current !== null) window.clearTimeout(volumeCommitTimerRef.current);
    if (brightnessCommitTimerRef.current !== null) window.clearTimeout(brightnessCommitTimerRef.current);
  }, []);

  const applyAction = useCallback(async (action: RemoteActionRequest) => {
    const actionKey = remoteKey.trim();
    storeRemoteKey(actionKey);
    setPendingAction(action.type);
    setActionError(null);
    try {
      const nextState = await sendRemoteAction(action, actionKey || undefined);
      setRemoteState(nextState);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Remote action failed");
    } finally {
      setPendingAction(null);
    }
  }, [remoteKey]);

  const handleKeySave = useCallback(() => {
    storeRemoteKey(remoteKey);
  }, [remoteKey]);

  const commitVolume = useCallback(() => {
    if (volumeCommitTimerRef.current !== null) {
      window.clearTimeout(volumeCommitTimerRef.current);
      volumeCommitTimerRef.current = null;
    }
    void applyAction({ type: "volume_set", value: volumeDraftRef.current });
  }, [applyAction]);

  const commitBrightness = useCallback(() => {
    if (brightnessCommitTimerRef.current !== null) {
      window.clearTimeout(brightnessCommitTimerRef.current);
      brightnessCommitTimerRef.current = null;
    }
    void applyAction({ type: "display.brightness_set", value: brightnessDraftRef.current });
  }, [applyAction]);

  const handleVolumeDraftChange = useCallback((value: number) => {
    volumeDraftRef.current = value;
    setVolumeDraft(value);
    if (volumeCommitTimerRef.current !== null) window.clearTimeout(volumeCommitTimerRef.current);
    volumeCommitTimerRef.current = window.setTimeout(() => {
      volumeCommitTimerRef.current = null;
      void applyAction({ type: "volume_set", value: volumeDraftRef.current });
    }, REMOTE_SLIDER_COMMIT_MS);
  }, [applyAction]);

  const handleBrightnessDraftChange = useCallback((value: number) => {
    brightnessDraftRef.current = value;
    setBrightnessDraft(value);
    if (brightnessCommitTimerRef.current !== null) window.clearTimeout(brightnessCommitTimerRef.current);
    brightnessCommitTimerRef.current = window.setTimeout(() => {
      brightnessCommitTimerRef.current = null;
      void applyAction({ type: "display.brightness_set", value: brightnessDraftRef.current });
    }, REMOTE_SLIDER_COMMIT_MS);
  }, [applyAction]);

  const isPlaying = remoteState?.playback.state === "playing";
  const busy = pendingAction !== null;
  const rawError = actionError ?? refreshError;
  const visibleError = friendlyUiError(rawError, "Remote needs attention. Try again.");
  const visibleExploreError = friendlyUiError(remoteState?.explore.lastError, "Explore needs attention. Try again.");
  const transportCapabilities = remoteState?.playback.transportCapabilities;
  const transportUnavailableTitle = transportCapabilities?.reason ?? "Playback control unavailable";
  const previousDisabled = busy || transportCapabilities?.previous === false;
  const playPauseDisabled = busy || transportCapabilities?.playPause === false;
  const nextDisabled = busy || transportCapabilities?.next === false;
  const previousTitle = transportCapabilities?.previous === false ? transportUnavailableTitle : "Previous";
  const playPauseTitle = transportCapabilities?.playPause === false ? transportUnavailableTitle : isPlaying ? "Pause" : "Play";
  const nextTitle = transportCapabilities?.next === false ? transportUnavailableTitle : "Next";

  return (
    <main className="remote-root">
      <section className="remote-shell">
        <header className="remote-header">
          <div>
            <p>Tikpal Remote</p>
            <h1>{track.title}</h1>
            <span>{track.artist}</span>
          </div>
          <button className="remote-icon-button" type="button" title="Refresh" aria-label="Refresh" onClick={() => void refresh()}>
            <RefreshCw aria-hidden="true" />
          </button>
        </header>

        <section className="remote-status-band" aria-live="polite">
          <span>{remotePlaybackStateLabel(remoteState)}</span>
          <span>{remoteState?.source.current.label ?? "Source"}</span>
          <span>{remoteState ? roomLabel(remoteState.room.mode) : "Room"}</span>
        </section>

        <section className="remote-key-panel">
          <label>
            <span>Access key</span>
            <input
              data-remote-key
              type="password"
              autoComplete="current-password"
              value={remoteKey}
              onChange={(event) => setRemoteKey(event.currentTarget.value)}
              onBlur={handleKeySave}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleKeySave();
              }}
              placeholder="Optional access key"
            />
          </label>
          <strong>{remoteKey.trim() ? "Ready" : "No key"}</strong>
        </section>

        {visibleError ? (
          <section className="remote-error" role="alert">
            <p title={rawError ?? undefined}>{visibleError}</p>
          </section>
        ) : null}

        <section className="remote-transport" aria-label="Playback controls">
          <button className="remote-icon-button" type="button" title={previousTitle} aria-label="Previous" disabled={previousDisabled} onClick={() => void applyAction({ type: "playback.previous" })}>
            <SkipBack aria-hidden="true" />
          </button>
          <button
            className="remote-play-button"
            type="button"
            title={playPauseTitle}
            aria-label={isPlaying ? "Pause" : "Play"}
            disabled={playPauseDisabled}
            onClick={() => void applyAction({ type: "playback.play_pause" })}
          >
            {isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          </button>
          <button className="remote-icon-button" type="button" title={nextTitle} aria-label="Next" disabled={nextDisabled} onClick={() => void applyAction({ type: "playback.next" })}>
            <SkipForward aria-hidden="true" />
          </button>
        </section>

        <section className="remote-slider-panel">
          <label>
            <span><Volume2 aria-hidden="true" /> Volume</span>
            <strong>{volumeDraft}%</strong>
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value={volumeDraft}
            data-remote-volume-slider
            onChange={(event) => handleVolumeDraftChange(Number(event.currentTarget.value))}
            onPointerUp={commitVolume}
            onTouchEnd={commitVolume}
            onMouseUp={commitVolume}
            onBlur={commitVolume}
            onKeyUp={(event) => {
              if (event.key === "Enter" || event.key.startsWith("Arrow")) commitVolume();
            }}
          />
        </section>

        <section className="remote-grid-panel" data-remote-explore>
          <h2>Explore</h2>
          <div className="remote-button-grid">
            <button
              type="button"
              className={remoteState?.explore.activeProvider ? "is-active" : ""}
              disabled={busy || Boolean(remoteState?.explore.activeProvider)}
              data-remote-explore-open
              onClick={() => void applyAction({ type: "explore.open" })}
            >
              <Globe2 aria-hidden="true" />
              <span>{pendingAction === "explore.open" ? "Opening" : remoteState?.explore.activeProviderLabel ?? "Start Explore"}</span>
            </button>
            <button
              type="button"
              disabled={busy}
              data-remote-explore-close
              onClick={() => void applyAction({ type: "explore.close" })}
            >
              <PanelRightClose aria-hidden="true" />
              <span>{pendingAction === "explore.close" ? "Closing" : "Back"}</span>
            </button>
            <button
              type="button"
              className={`remote-proxy-toggle ${remoteState?.explore.proxyEnabled ? "is-active" : ""}`}
              aria-pressed={Boolean(remoteState?.explore.proxyEnabled)}
              disabled={busy}
              data-remote-explore-proxy
              onClick={() => void applyAction({ type: "explore.proxy_set", enabled: !remoteState?.explore.proxyEnabled })}
            >
              <Wifi aria-hidden="true" />
              <span>{pendingAction === "explore.proxy_set" ? "Saving" : remoteState?.explore.proxyEnabled ? "Proxy On" : "Proxy Off"}</span>
            </button>
          </div>
          {visibleExploreError ? <p className="remote-explore-error" role="alert" title={remoteState?.explore.lastError ?? undefined}>{visibleExploreError}</p> : null}
        </section>

        <section className="remote-grid-panel">
          <h2>Sources</h2>
          <div className="remote-button-grid">
            {(catalog?.sources ?? []).map((source) => (
              <button
                key={source.id}
                type="button"
                className={source.active ? "is-active" : ""}
                disabled={busy || source.availability === "unavailable"}
                onClick={() => void applyAction({ type: "source.set", target: source.id as RemoteActionRequest["target"] })}
              >
                {sourceIcon(source.id)}
                <span>{source.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="remote-grid-panel">
          <h2>Room</h2>
          <div className="remote-button-grid">
            {(catalog?.roomModes ?? []).map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={remoteState?.room.mode === mode.id ? "is-active" : ""}
                disabled={busy}
                onClick={() => void applyAction({ type: "room.set_mode", mode: mode.id })}
              >
                <SlidersHorizontal aria-hidden="true" />
                <span>{mode.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="remote-grid-panel">
          <h2>Hi-Fi EQ</h2>
          <div className="remote-button-grid">
            {(catalog?.hifiEqPresets ?? []).map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={remoteState?.hifi.eqPresetId === preset.id ? "is-active" : ""}
                disabled={busy || remoteState?.hifi.controllable === false}
                onClick={() => void applyAction({ type: "hifi.eq_set", hifiEqPresetId: preset.id })}
              >
                <SlidersHorizontal aria-hidden="true" />
                <span>{preset.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="remote-slider-panel">
          <label>
            <span><Sun aria-hidden="true" /> Display</span>
            <strong>{brightnessDraft}%</strong>
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value={brightnessDraft}
            onChange={(event) => handleBrightnessDraftChange(Number(event.currentTarget.value))}
            onPointerUp={commitBrightness}
            onTouchEnd={commitBrightness}
            onMouseUp={commitBrightness}
            onBlur={commitBrightness}
            onKeyUp={(event) => {
              if (event.key === "Enter" || event.key.startsWith("Arrow")) commitBrightness();
            }}
          />
        </section>

        <section className="remote-grid-panel">
          <h2>Scene</h2>
          <div className="remote-button-grid">
            <button
              type="button"
              className={remoteState?.scene.sceneSoundEnabled ? "is-active" : ""}
              disabled={busy}
              onClick={() => void applyAction({ type: "scene.sound_set", enabled: !remoteState?.scene.sceneSoundEnabled })}
            >
              <Music aria-hidden="true" />
              <span>{remoteState?.scene.sceneSoundEnabled ? "Sound On" : "Sound Off"}</span>
            </button>
            <button type="button" disabled={busy} onClick={() => void applyAction({ type: "lyrics.refresh" })}>
              <RefreshCw aria-hidden="true" />
              <span>Lyrics</span>
            </button>
          </div>
        </section>

      </section>
    </main>
  );
}

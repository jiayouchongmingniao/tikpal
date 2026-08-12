import { Airplay, Bluetooth, Globe2, Music, PanelRightClose, Pause, Play, Radio, RefreshCw, SkipBack, SkipForward, SlidersHorizontal, Sun, Volume2, Wifi } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchRemoteCatalog, fetchRemoteState, readStoredRemoteKey, sendRemoteAction, storeRemoteKey } from "../api/remoteClient";
import { useI18n } from "../i18n";
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

function formatTrack(state: RemoteStateResponse | null, fallbackTitle: string, fallbackArtist: string) {
  if (!state) return { title: fallbackTitle, artist: fallbackArtist };
  return {
    title: state.playback.title || fallbackTitle,
    artist: [state.playback.artist, state.playback.album].filter(Boolean).join(" / ") || state.source.current.label
  };
}

export function RemoteControlApp() {
  const { t, roomLabel, sourceLabel, playbackStateLabel, friendlyError } = useI18n();
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
  const track = useMemo(() => formatTrack(remoteState, remoteState ? t("playback.nothingPlaying") : t("common.connecting"), t("remote.title")), [remoteState, t]);

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
  const visibleError = friendlyError(rawError, "error.generic");
  const visibleExploreError = friendlyError(remoteState?.explore.lastError, "error.explore");
  const transportCapabilities = remoteState?.playback.transportCapabilities;
  const transportUnavailableTitle = transportCapabilities?.reason ?? "Playback control unavailable";
  const previousDisabled = busy || transportCapabilities?.previous === false;
  const playPauseDisabled = busy || transportCapabilities?.playPause === false;
  const nextDisabled = busy || transportCapabilities?.next === false;
  const previousTitle = transportCapabilities?.previous === false ? transportUnavailableTitle : t("playback.previous");
  const playPauseTitle = transportCapabilities?.playPause === false ? transportUnavailableTitle : isPlaying ? t("playback.pause") : t("playback.play");
  const nextTitle = transportCapabilities?.next === false ? transportUnavailableTitle : t("playback.next");

  return (
    <main className="remote-root">
      <section className="remote-shell">
        <header className="remote-header">
          <div>
            <p>{t("remote.title")}</p>
            <h1>{track.title}</h1>
            <span>{track.artist}</span>
          </div>
          <button className="remote-icon-button" type="button" title={t("remote.refresh")} aria-label={t("remote.refresh")} onClick={() => void refresh()}>
            <RefreshCw aria-hidden="true" />
          </button>
        </header>

        <section className="remote-status-band" aria-live="polite">
          <span>{remoteState ? playbackStateLabel(remoteState.playback.state) : t("status.updating")}</span>
          <span>{remoteState ? sourceLabel(remoteState.source.current.id, remoteState.source.current.label) : t("library.source")}</span>
          <span>{remoteState ? roomLabel(remoteState.room.mode) : t("remote.room")}</span>
        </section>

        <section className="remote-key-panel">
          <label>
            <span>{t("remote.accessKey")}</span>
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
              placeholder={t("remote.optionalAccessKey")}
            />
          </label>
          <strong>{remoteKey.trim() ? t("common.ready") : t("remote.noKey")}</strong>
        </section>

        {visibleError ? (
          <section className="remote-error" role="alert">
            <p title={rawError ?? undefined}>{visibleError}</p>
          </section>
        ) : null}

        <section className="remote-transport" aria-label="Playback controls">
          <button className="remote-icon-button" type="button" title={previousTitle} aria-label={t("playback.previous")} disabled={previousDisabled} onClick={() => void applyAction({ type: "playback.previous" })}>
            <SkipBack aria-hidden="true" />
          </button>
          <button
            className="remote-play-button"
            type="button"
            title={playPauseTitle}
            aria-label={isPlaying ? t("playback.pause") : t("playback.play")}
            disabled={playPauseDisabled}
            onClick={() => void applyAction({ type: "playback.play_pause" })}
          >
            {isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          </button>
          <button className="remote-icon-button" type="button" title={nextTitle} aria-label={t("playback.next")} disabled={nextDisabled} onClick={() => void applyAction({ type: "playback.next" })}>
            <SkipForward aria-hidden="true" />
          </button>
          <button
            className="remote-icon-button"
            type="button"
            title="Refresh lyrics"
            aria-label="Refresh lyrics"
            disabled={busy}
            data-remote-lyrics-refresh
            onClick={() => void applyAction({ type: "lyrics.refresh" })}
          >
            <RefreshCw aria-hidden="true" />
          </button>
        </section>

        <section className="remote-slider-panel">
          <label>
            <span><Volume2 aria-hidden="true" /> {t("quickMenu.volume")}</span>
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
              <span>{pendingAction === "explore.open" ? t("common.opening") : remoteState?.explore.activeProviderLabel ?? t("remote.startExplore")}</span>
            </button>
            <button
              type="button"
              disabled={busy}
              data-remote-explore-close
              onClick={() => void applyAction({ type: "explore.close" })}
            >
              <PanelRightClose aria-hidden="true" />
              <span>{pendingAction === "explore.close" ? t("common.closing") : t("common.close")}</span>
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
              <span>{pendingAction === "explore.proxy_set" ? t("common.saving") : remoteState?.explore.proxyEnabled ? t("remote.proxyOn") : t("remote.proxyOff")}</span>
            </button>
          </div>
          {visibleExploreError ? <p className="remote-explore-error" role="alert" title={remoteState?.explore.lastError ?? undefined}>{visibleExploreError}</p> : null}
        </section>

        <section className="remote-grid-panel">
          <h2>{t("remote.sources")}</h2>
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
                <span>{sourceLabel(source.id, source.label)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="remote-grid-panel">
          <h2>{t("remote.room")}</h2>
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
                <span>{roomLabel(mode.id)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="remote-grid-panel">
          <h2>{t("remote.hifiEq")}</h2>
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
            <span><Sun aria-hidden="true" /> {t("remote.display")}</span>
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

      </section>
    </main>
  );
}

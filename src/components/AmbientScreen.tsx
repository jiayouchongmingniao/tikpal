import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Settings, SunMedium, Volume2 } from "lucide-react";
import { FlameScene } from "./FlameScene";
import { buildGeneratedCoverArtUrl } from "../coverArt";
import { formatDuration, formatSampleRate } from "../mockState";
import type { TikpalDataStatus } from "../hooks/useTikpalState";
import type { AudioState, LyricsState, PlaybackActionType, PlaybackSummary, SystemActionType, SystemState, TikpalState } from "../types";

interface AmbientScreenProps {
  hudVisible: boolean;
  timeLabel: string;
  dateLabel: string;
  playback: PlaybackSummary;
  lyrics: LyricsState;
  audio: AudioState;
  system: SystemState;
  status: TikpalDataStatus;
  onPlaybackAction: (type: PlaybackActionType, value?: number) => Promise<TikpalState>;
  onSystemAction: (type: SystemActionType, value?: number) => Promise<TikpalState>;
  onOpenSettings: () => void;
}

type AmbientAdjustChannel = "volume" | "brightness";

interface DragState {
  channel: AmbientAdjustChannel;
  pointerId: number;
  startY: number;
  startPercent: number;
}

interface AdjustOverlayState {
  channel: AmbientAdjustChannel;
  percent: number;
  error: string | null;
}

const DRAG_PIXELS_PER_PERCENT = 4;

function findActiveLyricsLineIndex(lyrics: LyricsState, elapsedSeconds: number | null) {
  if (!lyrics.synced || lyrics.lines.length === 0 || !Number.isFinite(elapsedSeconds)) {
    return null;
  }

  const elapsedMs = Math.max(0, Math.round((elapsedSeconds ?? 0) * 1000));
  for (let index = lyrics.lines.length - 1; index >= 0; index -= 1) {
    const line = lyrics.lines[index];
    if (line.startMs === null) continue;
    if (elapsedMs >= line.startMs) {
      if (line.endMs === null || elapsedMs < line.endMs) {
        return index;
      }
      if (elapsedMs >= line.endMs) {
        return Math.min(index + 1, lyrics.lines.length - 1);
      }
    }
  }

  return 0;
}

export function AmbientScreen({
  hudVisible,
  timeLabel,
  dateLabel,
  playback,
  lyrics,
  audio,
  system,
  status,
  onPlaybackAction,
  onSystemAction,
  onOpenSettings
}: AmbientScreenProps) {
  const dragStateRef = useRef<DragState | null>(null);
  const requestStateRef = useRef<Record<AmbientAdjustChannel, { inFlight: boolean; queued: number | null; lastSent: number | null }>>({
    volume: { inFlight: false, queued: null, lastSent: null },
    brightness: { inFlight: false, queued: null, lastSent: null }
  });
  const [adjustOverlay, setAdjustOverlay] = useState<AdjustOverlayState | null>(null);
  const [frozenLyricsLineIndex, setFrozenLyricsLineIndex] = useState<number | null>(null);
  const [staticLyricsLineIndex, setStaticLyricsLineIndex] = useState(0);
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
  const coverArtUrl = playback.albumArtUrl ?? buildGeneratedCoverArtUrl(title, artist, album);
  const brightnessPercent = system.display.brightnessPercent;
  const canAdvanceLyrics = lyrics.synced
    && (playback.source === "mpd" || playback.source === "radio" || playback.source === "bluetooth")
    && playback.state === "playing";
  const computedLyricsLineIndex = canAdvanceLyrics ? findActiveLyricsLineIndex(lyrics, playback.elapsedSeconds) : null;
  const activeLyricsLineIndex = canAdvanceLyrics ? computedLyricsLineIndex : frozenLyricsLineIndex;
  const activeLyricsLine = activeLyricsLineIndex !== null ? lyrics.lines[activeLyricsLineIndex] ?? null : null;
  const staticLyricsLines = lyrics.lines.map((line) => line.text.trim()).filter(Boolean);
  const staticLyricsText = staticLyricsLines.length > 0
    ? staticLyricsLines[staticLyricsLineIndex % staticLyricsLines.length] ?? ""
    : "";
  const showSyncedLyrics = lyrics.status === "ready" && lyrics.synced && canAdvanceLyrics && Boolean(activeLyricsLine);
  const showStaticLyrics = lyrics.status === "ready" && Boolean(staticLyricsText) && (!lyrics.synced || !canAdvanceLyrics);
  const showIdentifiedTrack = (lyrics.status === "not_found" || lyrics.status === "error") && Boolean(lyrics.title || lyrics.artist);
  const recognizingMessage = lyrics.sourceScope === "bluetooth_input"
    ? "Listening to Bluetooth audio..."
    : "Identifying track...";
  const tickerText = showSyncedLyrics
    ? activeLyricsLine?.text ?? ""
    : showStaticLyrics
      ? staticLyricsText
      : showIdentifiedTrack
        ? [lyrics.title, lyrics.artist].filter(Boolean).join(" - ")
        : lyrics.status === "recognizing"
          ? recognizingMessage
          : (lyrics.status === "idle" || lyrics.status === "not_found" || lyrics.status === "error")
            ? lyrics.message ?? ""
            : "";
  const shouldScrollTicker = tickerText.length > 56;
  const marqueeDurationSeconds = shouldScrollTicker
    ? Math.max(34, Math.min(96, Math.ceil(tickerText.length * 0.45)))
    : 0;
  const tickerStyle = shouldScrollTicker
    ? ({ "--ambient-lyrics-marquee-duration": `${marqueeDurationSeconds}s` } as CSSProperties)
    : undefined;

  useEffect(() => {
    if (computedLyricsLineIndex !== null) {
      setFrozenLyricsLineIndex(computedLyricsLineIndex);
      return;
    }

    if (!lyrics.synced) {
      setFrozenLyricsLineIndex(null);
    }
  }, [computedLyricsLineIndex, lyrics.synced, lyrics.trackKey]);

  useEffect(() => {
    setStaticLyricsLineIndex(0);
  }, [lyrics.status, lyrics.sourceScope, lyrics.trackKey]);

  useEffect(() => {
    if (lyrics.status !== "ready" || staticLyricsLines.length <= 1 || (lyrics.synced && canAdvanceLyrics)) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setStaticLyricsLineIndex((current) => (current + 1) % staticLyricsLines.length);
    }, lyrics.sourceScope === "bluetooth_input" ? 8500 : 7000);

    return () => window.clearInterval(interval);
  }, [canAdvanceLyrics, lyrics.sourceScope, lyrics.status, lyrics.synced, lyrics.trackKey, staticLyricsLines.length]);

  useEffect(() => {
    requestStateRef.current.volume.lastSent = system.volume.percent;
  }, [system.volume.percent]);

  useEffect(() => {
    requestStateRef.current.brightness.lastSent = system.display.brightnessPercent;
  }, [system.display.brightnessPercent]);

  const dispatchAdjust = useCallback(
    (channel: AmbientAdjustChannel, percent: number) => {
      const nextPercent = Math.max(0, Math.min(100, Math.round(percent)));
      const requestState = requestStateRef.current[channel];
      requestState.queued = nextPercent;

      if (requestState.inFlight) {
        return;
      }

      requestState.inFlight = true;

      const sendNext = async () => {
        const target = requestState.queued;
        requestState.queued = null;

        if (target === null || target === requestState.lastSent) {
          requestState.inFlight = false;
          return;
        }

        try {
          requestState.lastSent = target;
          if (channel === "volume") {
            await onPlaybackAction("volume_set", target);
          } else {
            await onSystemAction("brightness_set", target);
          }

          setAdjustOverlay((current) => (
            current && current.channel === channel
              ? { ...current, percent: target, error: null }
              : current
          ));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Adjustment failed";
          setAdjustOverlay((current) => (
            current && current.channel === channel
              ? { ...current, error: message }
              : current
          ));
        }

        if (requestState.queued !== null && requestState.queued !== requestState.lastSent) {
          await sendNext();
          return;
        }

        requestState.inFlight = false;
      };

      void sendNext();
    },
    [onPlaybackAction, onSystemAction]
  );

  function startAdjust(channel: AmbientAdjustChannel, pointerId: number, startY: number) {
    const startPercent = channel === "volume" ? system.volume.percent : brightnessPercent;
    dragStateRef.current = {
      channel,
      pointerId,
      startY,
      startPercent
    };
    setAdjustOverlay({
      channel,
      percent: startPercent,
      error: null
    });
  }

  function updateAdjust(clientY: number) {
    const dragState = dragStateRef.current;
    if (!dragState) return;
    const deltaPercent = Math.round((dragState.startY - clientY) / DRAG_PIXELS_PER_PERCENT);
    const nextPercent = Math.max(0, Math.min(100, dragState.startPercent + deltaPercent));
    setAdjustOverlay((current) => (
      current
        ? { ...current, percent: nextPercent, error: null }
        : { channel: dragState.channel, percent: nextPercent, error: null }
    ));
    dispatchAdjust(dragState.channel, nextPercent);
  }

  function finishAdjust() {
    dragStateRef.current = null;
    window.setTimeout(() => {
      setAdjustOverlay((current) => (dragStateRef.current ? current : null));
    }, 800);
  }

  function handleZonePointerDown(channel: AmbientAdjustChannel): React.PointerEventHandler<HTMLDivElement> {
    return (event) => {
      if (channel === "brightness" && !system.display.controllable) {
        event.preventDefault();
        event.stopPropagation();
        setAdjustOverlay({
          channel,
          percent: brightnessPercent,
          error: "DDC/CI brightness unavailable"
        });
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      startAdjust(channel, event.pointerId, event.clientY);
    };
  }

  const handleZonePointerMove = useCallback<React.PointerEventHandler<HTMLDivElement>>((event) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    updateAdjust(event.clientY);
  }, [dispatchAdjust]);

  const handleZonePointerUp = useCallback<React.PointerEventHandler<HTMLDivElement>>((event) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    updateAdjust(event.clientY);
    finishAdjust();
  }, [dispatchAdjust]);

  const handleZonePointerCancel = useCallback<React.PointerEventHandler<HTMLDivElement>>((event) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    finishAdjust();
  }, []);

  return (
    <section className={`ambient-screen ${hudVisible ? "is-hud-visible" : "is-hud-hidden"}`} aria-label="Ambient flame screen">
      <FlameScene />
      <div className="ambient-vignette" />
      <div
        className="ambient-adjust-zone ambient-adjust-zone-left"
        data-gesture-protected
        aria-label="Swipe to change volume"
        onPointerDown={handleZonePointerDown("volume")}
        onPointerMove={handleZonePointerMove}
        onPointerUp={handleZonePointerUp}
        onPointerCancel={handleZonePointerCancel}
      />
      <div
        className={`ambient-adjust-zone ambient-adjust-zone-right ${system.display.controllable ? "" : "is-disabled"}`}
        data-gesture-protected
        aria-label="Swipe to change brightness"
        onPointerDown={handleZonePointerDown("brightness")}
        onPointerMove={handleZonePointerMove}
        onPointerUp={handleZonePointerUp}
        onPointerCancel={handleZonePointerCancel}
      />

      <button className="icon-button ambient-settings" type="button" onClick={onOpenSettings} aria-label="Open settings" title="Settings">
        <Settings size={26} strokeWidth={1.8} />
      </button>

      <div className="ambient-clock" aria-label="Current time">
        <div className="ambient-time">{timeLabel}</div>
        <div className="ambient-date">{dateLabel}</div>
      </div>

      <div className="ambient-lyrics-layer" aria-live="polite" data-ambient-lyrics>
        {tickerText ? (
          <div
            className={`ambient-lyrics-ticker ${shouldScrollTicker ? "is-scrolling" : "is-static"} ${lyrics.status === "error" ? "is-error" : ""}`}
            data-lyrics-state={lyrics.status}
            style={tickerStyle}
          >
            <div className="ambient-lyrics-marquee">
              <div className="ambient-lyrics-marquee-track">
                <span className="ambient-lyrics-text">{tickerText}</span>
                {shouldScrollTicker ? <span className="ambient-lyrics-text" aria-hidden="true">{tickerText}</span> : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="ambient-hud" aria-label="Current playback">
        <div className="ambient-cover" aria-hidden="true">
          <img src={coverArtUrl} alt="" />
          {!playback.albumArtUrl ? <span>{coverLabel}</span> : null}
        </div>
        <div className="ambient-track">
          <strong>{title}</strong>
          <span>{artist} - {album}</span>
        </div>
        <div className="ambient-status">
          <span className={`data-pill ${status.source === "api" ? "is-live" : "is-fallback"}`}>{status.pending ? "Syncing" : status.source === "api" ? "API" : "Fallback"}</span>
          <span>{audio.currentSource.label}</span>
          <span>{formatDuration(playback.elapsedSeconds)}</span>
          <span>{system.audioFormat.codec} {system.bitDepth}bit / {formatSampleRate(system.sampleRate)}</span>
          <span>{system.outputDevice.label}</span>
          <span>{system.volume.db.toFixed(1)} dB</span>
          <span>{brightnessPercent}% Brightness</span>
        </div>
        <div className="ambient-progress" aria-hidden="true">
          <span style={{ width: `${progress * 100}%` }} />
        </div>
      </div>

      {adjustOverlay ? (
        <div className={`ambient-adjust-indicator ambient-adjust-${adjustOverlay.channel}`} aria-live="polite">
          <div className="ambient-adjust-indicator-icon">
            {adjustOverlay.channel === "volume" ? <Volume2 size={22} /> : <SunMedium size={22} />}
          </div>
          <div className="ambient-adjust-indicator-copy">
            <strong>{adjustOverlay.channel === "volume" ? "Volume" : "Brightness"}</strong>
            <span>{adjustOverlay.percent}%</span>
            <p>{adjustOverlay.error ?? (adjustOverlay.channel === "volume" ? "moOde live level" : "DDC/CI display level")}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

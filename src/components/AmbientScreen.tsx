import { useCallback, useEffect, useRef, useState } from "react";
import { Settings, SunMedium, Volume2 } from "lucide-react";
import { FlameScene } from "./FlameScene";
import { buildGeneratedCoverArtUrl } from "../coverArt";
import { formatDuration, formatSampleRate } from "../mockState";
import type { TikpalDataStatus } from "../hooks/useTikpalState";
import type { AudioState, PlaybackActionType, PlaybackSummary, SystemActionType, SystemState, TikpalState } from "../types";

interface AmbientScreenProps {
  hudVisible: boolean;
  timeLabel: string;
  dateLabel: string;
  playback: PlaybackSummary;
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

export function AmbientScreen({
  hudVisible,
  timeLabel,
  dateLabel,
  playback,
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

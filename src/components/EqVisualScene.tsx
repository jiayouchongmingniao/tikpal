import { useEffect, useMemo, useState } from "react";
import { fetchAudioSpectrum } from "../api/tikpalClient";
import { getHifiEqPreset } from "../hifiVisualPresets";
import { formatDuration, formatSampleRate } from "../mockState";
import { getPlaybackDisplayTruth } from "../playbackTruth";
import type { CSSProperties } from "react";
import type { AudioSpectrumFrame, AudioState, FontTheme, HifiEqPresetId, PlaybackSummary, SystemState } from "../types";

const BAND_COUNT = 32;
const SPECTRUM_REFRESH_MS = 420;

interface EqVisualSceneProps {
  presetId: HifiEqPresetId;
  playback: PlaybackSummary;
  audio: AudioState;
  system: SystemState;
  fontTheme: FontTheme;
}

function clampUnit(value: unknown, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function buildFallbackSpectrum(volumePercent: number): AudioSpectrumFrame {
  const volumeGain = 0.35 + clampUnit(volumePercent / 100, 0.58) * 0.45;
  const bands = Array.from({ length: BAND_COUNT }, (_, index) => {
    const taper = 1 - Math.abs(index - (BAND_COUNT - 1) / 2) / BAND_COUNT;
    return clampUnit((0.18 + taper * 0.42) * volumeGain);
  });

  return {
    bands,
    peaks: {
      left: clampUnit(bands[8] ?? 0.35),
      right: clampUnit(bands[23] ?? 0.35)
    },
    source: "fallback",
    bandCount: BAND_COUNT,
    updatedAt: new Date().toISOString()
  };
}

function normalizeSpectrumFrame(frame: AudioSpectrumFrame, fallback: AudioSpectrumFrame): AudioSpectrumFrame {
  const bands = Array.isArray(frame.bands)
    ? frame.bands.slice(0, BAND_COUNT).map((band) => clampUnit(band))
    : [];
  while (bands.length < BAND_COUNT) {
    bands.push(fallback.bands[bands.length] ?? 0);
  }

  return {
    bands,
    peaks: {
      left: clampUnit(frame.peaks?.left, fallback.peaks.left),
      right: clampUnit(frame.peaks?.right, fallback.peaks.right)
    },
    source: frame.source === "command" || frame.source === "mock" ? frame.source : fallback.source,
    bandCount: BAND_COUNT,
    updatedAt: frame.updatedAt || fallback.updatedAt
  };
}

function bandToLevel(band: number, isPlaying: boolean) {
  const level = isPlaying ? 8 + band * 92 : 6 + band * 24;
  return `${Math.round(level)}%`;
}

export function EqVisualScene({ presetId, playback, audio, system, fontTheme }: EqVisualSceneProps) {
  const fallbackSpectrum = useMemo(() => buildFallbackSpectrum(system.volume.percent), [system.volume.percent]);
  const [spectrum, setSpectrum] = useState<AudioSpectrumFrame>(fallbackSpectrum);
  const isPlaying = playback.state === "playing";
  const preset = getHifiEqPreset(presetId);
  const visualPresetId = preset.hifiVisualPresetId;
  const playbackTruth = getPlaybackDisplayTruth(playback, audio, fontTheme);
  const coverLabel = playbackTruth.album
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();

  useEffect(() => {
    let active = true;
    let controller = new AbortController();

    async function refreshSpectrum() {
      controller.abort();
      controller = new AbortController();
      try {
        const frame = await fetchAudioSpectrum(controller.signal);
        if (active) {
          setSpectrum(normalizeSpectrumFrame(frame, fallbackSpectrum));
        }
      } catch {
        if (active) {
          setSpectrum(fallbackSpectrum);
        }
      }
    }

    void refreshSpectrum();
    const timer = window.setInterval(refreshSpectrum, SPECTRUM_REFRESH_MS);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [fallbackSpectrum]);

  const bars = spectrum.bands;

  return (
    <section
      className={`eq-visual-scene eq-visual-${visualPresetId} ${isPlaying ? "is-playing" : "is-paused"} is-eq-visible`}
      data-hifi-now-playing
      data-hifi-eq-visual
      data-hifi-eq-preset={presetId}
      data-hifi-preset={visualPresetId}
      data-hifi-eq-visible="true"
      data-spectrum-source={spectrum.source}
      data-spectrum-band-count={bars.length}
      data-spectrum-left-peak={spectrum.peaks.left.toFixed(3)}
      data-spectrum-right-peak={spectrum.peaks.right.toFixed(3)}
      aria-label={`Hi-Fi EQ: ${preset.label}`}
    >
      <div className="eq-visual-backdrop" aria-hidden="true" />
      <div className="hifi-now-playing-surface">
        <div className="hifi-cover-art" aria-hidden="true">
          <img src={playbackTruth.albumArtUrl} alt="" />
          {!playbackTruth.hasPlaybackArtwork ? <span>{coverLabel}</span> : null}
        </div>
        <div className="hifi-now-playing-copy">
          <span>Now Playing</span>
          <strong>{playbackTruth.title}</strong>
          <em>{playbackTruth.artist} - {playbackTruth.album}</em>
          <div className="hifi-now-playing-meta" aria-label="Hi-Fi playback details">
            <span>{playbackTruth.sourceLabel}</span>
            <span>{playback.state}</span>
            <span>{formatDuration(playbackTruth.elapsedSeconds)}</span>
            <span>{system.audioFormat.codec} {system.bitDepth}bit / {formatSampleRate(system.sampleRate)}</span>
            <span>{system.volume.percent}%</span>
          </div>
        </div>
      </div>

      {visualPresetId === "waveform" ? (
        <div className="eq-waveform hifi-eq-meter" aria-hidden="true">
          {bars.slice(0, 24).map((band, index) => (
            <span
              data-spectrum-band={band.toFixed(3)}
              key={index}
              style={{
                "--eq-level": bandToLevel(band, isPlaying),
                "--eq-delay": `${index * -0.08}s`
              } as CSSProperties}
            />
          ))}
        </div>
      ) : visualPresetId === "dual-vu" ? (
        <div className="eq-vu-stack hifi-eq-meter" aria-hidden="true">
          {[
            { label: "L", value: spectrum.peaks.left },
            { label: "R", value: spectrum.peaks.right }
          ].map((channel) => (
            <div className="eq-vu-meter" key={channel.label}>
              <span data-spectrum-band={channel.value.toFixed(3)} style={{ width: bandToLevel(channel.value, isPlaying) }} />
              <i>{channel.label}</i>
            </div>
            ))}
          </div>
        ) : (
        <div className="eq-spectrum hifi-eq-meter" aria-hidden="true">
          {bars.map((band, index) => (
            <span
              data-spectrum-band={band.toFixed(3)}
              key={index}
              style={{
                "--eq-level": bandToLevel(band, isPlaying),
                "--eq-delay": `${index * -0.055}s`
              } as CSSProperties}
            />
            ))}
          </div>
      )}
      <div className="eq-visual-label">
        <span>Hi-Fi EQ</span>
        <strong>{preset.label}</strong>
      </div>
    </section>
  );
}

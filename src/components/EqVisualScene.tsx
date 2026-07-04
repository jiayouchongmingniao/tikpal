import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from "react";
import { buildHifiCoverTheme, buildHifiSeedTheme, hifiThemeToCssVariables } from "../hifiLyricsVisual";
import { formatDuration, formatSampleRate } from "../mockState";
import { getPlaybackDisplayTruth } from "../playbackTruth";
import type { AudioState, FontTheme, HifiEqPresetId, PlaybackSummary, SystemState } from "../types";

export interface HifiLyricsPanelLine {
  id: string;
  text: string;
  active: boolean;
  distance: number;
}

export interface HifiLyricsPanel {
  activeIndex: number;
  synced: boolean;
  lines: HifiLyricsPanelLine[];
}

interface EqVisualSceneProps {
  presetId: HifiEqPresetId;
  playback: PlaybackSummary;
  audio: AudioState;
  system: SystemState;
  fontTheme: FontTheme;
  lyricsPanel?: HifiLyricsPanel | null;
  lyricsControls?: ReactNode;
}

interface WaveLane {
  x: number;
  y: number;
  width: number;
  amplitude: number;
  variance: number;
  tone: "warm" | "cool" | "green";
}

interface WaveVisual {
  id: string;
  path: string;
  tone: WaveLane["tone"];
  duration: number;
  delay: number;
  driftX: number;
  driftY: number;
}

interface ParticleVisual {
  id: string;
  x: number;
  y: number;
  size: number;
  opacity: number;
  duration: number;
  delay: number;
  driftX: number;
  driftY: number;
  tone: WaveLane["tone"];
}

const WAVE_LANES: WaveLane[] = [
  { x: -13, y: 18, width: 55, amplitude: 4.8, variance: 7, tone: "warm" },
  { x: 60, y: 18, width: 54, amplitude: 4.4, variance: 7, tone: "cool" },
  { x: -18, y: 43, width: 42, amplitude: 5.2, variance: 6, tone: "green" },
  { x: 78, y: 42, width: 40, amplitude: 5, variance: 6, tone: "warm" },
  { x: -12, y: 72, width: 68, amplitude: 5.8, variance: 7, tone: "cool" },
  { x: 54, y: 75, width: 62, amplitude: 5.5, variance: 7, tone: "green" },
  { x: 2, y: 91, width: 96, amplitude: 4.2, variance: 4, tone: "warm" },
  { x: 12, y: 84, width: 76, amplitude: 3.8, variance: 5, tone: "cool" }
];

const MINI_EQ_BARS = [
  0.18, 0.24, 0.31, 0.42, 0.58, 0.72, 0.86, 0.7,
  0.52, 0.46, 0.61, 0.78, 0.9, 0.82, 0.68, 0.55,
  0.44, 0.5, 0.64, 0.73, 0.66, 0.49, 0.36, 0.28,
  0.22, 0.2, 0.18, 0.16
];

function hashSeed(parts: string[]) {
  let hash = 2166136261;
  for (const part of parts) {
    for (let index = 0; index < part.length; index += 1) {
      hash ^= part.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return hash >>> 0;
}

function seededRandom(seed: number) {
  let state = seed || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function formatCoord(value: number) {
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function buildWavePath(random: () => number, lane: WaveLane) {
  const segment = lane.width / 4;
  const y = lane.y + (random() - 0.5) * lane.variance;
  const amplitude = lane.amplitude * (0.78 + random() * 0.5);
  let path = `M ${formatCoord(lane.x)} ${formatCoord(y)}`;

  for (let index = 0; index < 4; index += 1) {
    const startX = lane.x + segment * index;
    const endX = startX + segment;
    const controlY = y + (index % 2 === 0 ? -amplitude : amplitude);
    path += ` C ${formatCoord(startX + segment * 0.35)} ${formatCoord(controlY)} ${formatCoord(startX + segment * 0.65)} ${formatCoord(controlY)} ${formatCoord(endX)} ${formatCoord(y)}`;
  }

  return path;
}

function createHifiAmbientVisuals(seed: number) {
  const random = seededRandom(seed);
  const waves: WaveVisual[] = WAVE_LANES.map((lane, index) => ({
    id: `wave-${index}`,
    path: buildWavePath(random, lane),
    tone: lane.tone,
    duration: 16 + random() * 10,
    delay: -random() * 12,
    driftX: (random() - 0.5) * 16,
    driftY: (random() - 0.5) * 8
  }));

  const particles: ParticleVisual[] = Array.from({ length: 32 }, (_, index) => {
    const edgeBias = random();
    const x = edgeBias < 0.42
      ? 3 + random() * 24
      : edgeBias < 0.84
        ? 73 + random() * 24
        : 12 + random() * 76;
    const y = edgeBias < 0.84 ? 10 + random() * 78 : 76 + random() * 18;
    const tone = random() < 0.36 ? "warm" : random() < 0.7 ? "cool" : "green";

    return {
      id: `particle-${index}`,
      x,
      y,
      size: 2.8 + random() * 5.8,
      opacity: 0.32 + random() * 0.34,
      duration: 16 + random() * 14,
      delay: -random() * 18,
      driftX: (random() - 0.5) * 28,
      driftY: -8 - random() * 18,
      tone
    };
  });

  return { waves, particles };
}

export function EqVisualScene({ playback, audio, system, fontTheme, lyricsPanel, lyricsControls }: EqVisualSceneProps) {
  const isPlaying = playback.state === "playing";
  const visibleLyricsPanel = useMemo(() => {
    if (!lyricsPanel?.lines.length) return null;
    const visibleLineCount = 6;
    const activeIndex = Math.max(0, Math.min(lyricsPanel.activeIndex, lyricsPanel.lines.length - 1));
    const start = Math.max(0, activeIndex - 2);
    return {
      ...lyricsPanel,
      activeIndex: activeIndex - start,
      lines: lyricsPanel.lines.slice(start, start + visibleLineCount)
    };
  }, [lyricsPanel]);
  const playbackTruth = getPlaybackDisplayTruth(playback, audio, fontTheme);
  const [failedAlbumArtUrl, setFailedAlbumArtUrl] = useState<string | null>(null);
  const displayedAlbumArtUrl = playbackTruth.hasPlaybackArtwork && failedAlbumArtUrl === playbackTruth.albumArtUrl
    ? playbackTruth.fallbackAlbumArtUrl
    : playbackTruth.albumArtUrl;
  const usingGeneratedCoverFallback = !playbackTruth.hasPlaybackArtwork || displayedAlbumArtUrl === playbackTruth.fallbackAlbumArtUrl;
  const hasLyricsPanel = Boolean(visibleLyricsPanel?.lines.length);
  const themeSeedParts = useMemo(
    () => [
      playbackTruth.title,
      playbackTruth.artist,
      playbackTruth.album,
      playbackTruth.sourceLabel,
      playback.source
    ],
    [playback.source, playbackTruth.album, playbackTruth.artist, playbackTruth.sourceLabel, playbackTruth.title]
  );
  const [themePalette, setThemePalette] = useState(() => buildHifiSeedTheme(themeSeedParts));
  const ambientVisuals = useMemo(
    () => createHifiAmbientVisuals(hashSeed([
      playbackTruth.title,
      playbackTruth.artist,
      playbackTruth.album,
      playbackTruth.sourceLabel
    ])),
    [playbackTruth.album, playbackTruth.artist, playbackTruth.sourceLabel, playbackTruth.title]
  );
  const themeStyle = useMemo(
    () => hifiThemeToCssVariables(themePalette) as CSSProperties,
    [themePalette]
  );
  const coverLabel = playbackTruth.album
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
  const trackHeading = [playbackTruth.title, playbackTruth.artist].filter(Boolean).join(" - ");
  const lyricsProgressPercent = `${Math.round(playbackTruth.progress * 1000) / 10}%`;
  const lyricsTimeLabel = `${formatDuration(playbackTruth.elapsedSeconds)}/${formatDuration(playbackTruth.durationSeconds)}`;

  useEffect(() => {
    let cancelled = false;
    const fallbackTheme = buildHifiSeedTheme(themeSeedParts);
    setThemePalette(fallbackTheme);

    void buildHifiCoverTheme(displayedAlbumArtUrl, themeSeedParts).then((nextTheme) => {
      if (!cancelled) setThemePalette(nextTheme);
    });

    return () => {
      cancelled = true;
    };
  }, [displayedAlbumArtUrl, themeSeedParts]);

  return (
    <section
      className={`eq-visual-scene hifi-now-playing-scene ${isPlaying ? "is-playing" : "is-paused"} ${hasLyricsPanel ? "has-lyrics-panel" : ""}`}
      data-hifi-now-playing
      data-hifi-centered-now-playing={hasLyricsPanel ? undefined : true}
      aria-label="Hi-Fi now playing"
      style={themeStyle}
    >
      <div className="eq-visual-backdrop" aria-hidden="true" />
      <div className="hifi-ambient-visuals" aria-hidden="true" data-hifi-ambient-visuals>
        <svg className="hifi-wave-field" viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
          {ambientVisuals.waves.map((wave) => (
            <path
              className={`hifi-wave-line is-${wave.tone}`}
              d={wave.path}
              data-hifi-wave-line
              key={wave.id}
              style={{
                "--hifi-wave-delay": `${wave.delay}s`,
                "--hifi-wave-duration": `${wave.duration}s`,
                "--hifi-wave-drift-x": `${wave.driftX}px`,
                "--hifi-wave-drift-y": `${wave.driftY}px`
              } as CSSProperties}
            />
          ))}
        </svg>
        <div className="hifi-particle-field">
          {ambientVisuals.particles.map((particle) => (
            <span
              className={`hifi-particle is-${particle.tone}`}
              data-hifi-particle
              key={particle.id}
              style={{
                "--hifi-particle-delay": `${particle.delay}s`,
                "--hifi-particle-duration": `${particle.duration}s`,
                "--hifi-particle-drift-x": `${particle.driftX}px`,
                "--hifi-particle-drift-y": `${particle.driftY}px`,
                "--hifi-particle-opacity": particle.opacity,
                "--hifi-particle-size": `${particle.size}px`,
                left: `${particle.x}%`,
                top: `${particle.y}%`
              } as CSSProperties}
            />
          ))}
        </div>
      </div>
      <div className="hifi-now-playing-surface">
        {!hasLyricsPanel ? (
          <span
            aria-hidden="true"
            className="hifi-playback-presence"
            data-hifi-playback-presence
            data-hifi-playback-state={playback.state}
          />
        ) : null}
        <div
          className="hifi-cover-art"
          aria-hidden="true"
          data-bluetooth-generated-cover={playbackTruth.isGeneratedBluetoothCover ? true : undefined}
          data-generated-cover-fallback={usingGeneratedCoverFallback ? true : undefined}
          data-hifi-cover-art
        >
          <img
            src={displayedAlbumArtUrl}
            alt=""
            data-generated-cover-fallback={usingGeneratedCoverFallback ? true : undefined}
            onError={() => {
              if (playbackTruth.hasPlaybackArtwork) {
                setFailedAlbumArtUrl(playbackTruth.albumArtUrl);
              }
            }}
          />
          {usingGeneratedCoverFallback ? <span>{coverLabel}</span> : null}
        </div>
        {!hasLyricsPanel ? (
          <div className="hifi-now-playing-copy" data-hifi-track-info>
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
        ) : null}
      </div>
      {hasLyricsPanel && visibleLyricsPanel ? (
        <aside className={`hifi-lyrics-panel ${visibleLyricsPanel.synced ? "is-synced" : "is-static"}`} aria-label="Lyrics" data-hifi-lyrics-panel>
          <header className="hifi-lyrics-heading" data-hifi-track-info>
            <strong>{trackHeading}</strong>
          </header>
          <div
            className="hifi-lyrics-wall"
            style={{ "--hifi-lyrics-active-index": visibleLyricsPanel.activeIndex } as CSSProperties}
          >
            {visibleLyricsPanel.lines.map((line) => (
              <p
                className={`hifi-lyrics-line ${line.active ? "is-active" : ""}`}
                data-hifi-lyrics-line
                data-hifi-lyrics-active={line.active ? true : undefined}
                key={line.id}
                style={{
                  "--hifi-lyrics-distance": line.distance,
                  "--hifi-lyrics-opacity": line.active ? 1 : Math.max(0.18, 0.62 - line.distance * 0.08)
                } as CSSProperties}
              >
                {line.text}
              </p>
            ))}
          </div>
        </aside>
      ) : null}
      {hasLyricsPanel ? (
        <div className="hifi-lyrics-footer" data-hifi-lyrics-footer>
          <div className="hifi-lyrics-progress-eq" data-hifi-lyrics-progress-eq aria-hidden="true">
            <div className="hifi-mini-eq" data-hifi-mini-eq>
              {MINI_EQ_BARS.map((height, index) => (
                <span
                  key={`${height}-${index}`}
                  data-hifi-mini-eq-bar
                  style={{
                    "--hifi-mini-eq-height": height,
                    "--hifi-mini-eq-delay": `${index * -0.07}s`
                  } as CSSProperties}
                />
              ))}
            </div>
            <div className="hifi-lyrics-progress-row">
              <div className="hifi-lyrics-progress-track">
                <span style={{ width: lyricsProgressPercent }} />
              </div>
              <span className="hifi-lyrics-time" data-hifi-lyrics-time>{lyricsTimeLabel}</span>
            </div>
          </div>
          {lyricsControls ? (
            <div className="hifi-lyrics-controls" aria-label="Playback controls" data-hifi-lyrics-controls>
              {lyricsControls}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

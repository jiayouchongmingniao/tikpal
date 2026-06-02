import { formatDuration, formatSampleRate } from "../mockState";
import { getPlaybackDisplayTruth } from "../playbackTruth";
import type { AudioState, FontTheme, HifiEqPresetId, PlaybackSummary, SystemState } from "../types";

interface EqVisualSceneProps {
  presetId: HifiEqPresetId;
  playback: PlaybackSummary;
  audio: AudioState;
  system: SystemState;
  fontTheme: FontTheme;
}

export function EqVisualScene({ playback, audio, system, fontTheme }: EqVisualSceneProps) {
  const isPlaying = playback.state === "playing";
  const playbackTruth = getPlaybackDisplayTruth(playback, audio, fontTheme);
  const coverLabel = playbackTruth.album
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();

  return (
    <section
      className={`eq-visual-scene hifi-now-playing-scene ${isPlaying ? "is-playing" : "is-paused"}`}
      data-hifi-now-playing
      data-hifi-centered-now-playing
      aria-label="Hi-Fi now playing"
    >
      <div className="eq-visual-backdrop" aria-hidden="true" />
      <div className="hifi-now-playing-surface">
        <div className="hifi-cover-art" aria-hidden="true" data-hifi-cover-art>
          <img src={playbackTruth.albumArtUrl} alt="" />
          {!playbackTruth.hasPlaybackArtwork ? <span>{coverLabel}</span> : null}
        </div>
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
      </div>
    </section>
  );
}

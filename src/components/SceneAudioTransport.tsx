import { useEffect, useRef } from "react";

interface SceneAudioTransportProps {
  audioSrc?: string;
  enabled: boolean;
  playing: boolean;
  volumePercent: number;
  audioGainDb?: number;
}

function toVolume(volumePercent: number, audioGainDb: number) {
  const base = Math.max(0, Math.min(100, volumePercent)) / 100;
  const gain = Math.pow(10, audioGainDb / 20);
  return Math.max(0, Math.min(1, base * gain));
}

// Scene MP4 files are intentionally silent. This is the only browser-owned
// scene audio transport, so a long Ogg asset cannot overlap a video loop.
export function SceneAudioTransport({ audioSrc, enabled, playing, volumePercent, audioGainDb = 0 }: SceneAudioTransportProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const loadedSrcRef = useRef<string | null>(null);
  const volume = toVolume(volumePercent, audioGainDb);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!enabled || !audioSrc) {
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute("src");
      audio.load();
      loadedSrcRef.current = null;
      return;
    }

    if (loadedSrcRef.current !== audioSrc) {
      audio.pause();
      audio.muted = true;
      audio.volume = 0;
      audio.src = audioSrc;
      audio.load();
      loadedSrcRef.current = audioSrc;
    }
  }, [audioSrc, enabled]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!enabled || !playing || !audioSrc) {
      audio.pause();
      return;
    }

    // Start muted so Chromium's autoplay policy sees one user-initiated scene
    // transport. Restore the requested output level only after play succeeds.
    audio.muted = true;
    audio.volume = 0;
    void audio.play().then(() => {
      if (!audioRef.current || audioRef.current !== audio || !enabled || !playing) return;
      audio.volume = volume;
      audio.muted = volume === 0;
    }).catch(() => {
      // The next explicit scene play action retries; never fall back to MP4 audio.
    });
  }, [audioSrc, enabled, playing, volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !enabled || !playing) return;
    audio.volume = volume;
    audio.muted = volume === 0;
  }, [enabled, playing, volume]);

  useEffect(() => () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }, []);

  return <audio ref={audioRef} aria-hidden="true" loop preload="auto" data-scene-audio-transport />;
}

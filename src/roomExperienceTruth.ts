import { getPlaybackSourceSummary } from "./playbackTruth";
import { getHifiEqPresetLabel } from "./hifiVisualPresets";
import type { AudioState, PlaybackSummary, RoomExperienceState, RoomMode, SystemState } from "./types";

export const roomModeOptions: Array<{
  mode: RoomMode;
  label: string;
  intent: string;
  description: string;
  timerLabel: string;
}> = [
  {
    mode: "focus",
    label: "Focus",
    intent: "Deep work & reading",
    description: "Deep work & reading",
    timerLabel: "50 min"
  },
  {
    mode: "calm",
    label: "Calm",
    intent: "Unwind & relax",
    description: "Unwind & relax",
    timerLabel: "45 min"
  },
  {
    mode: "sleep",
    label: "Sleep",
    intent: "Dim, timer, fade-out",
    description: "Dim, timer, fade-out",
    timerLabel: "90 min"
  },
  {
    mode: "hifi",
    label: "Hi-Fi",
    intent: "Pure music listening",
    description: "Pure music listening",
    timerLabel: "No timer"
  }
];

const phaseLabels: Record<RoomExperienceState["phase"], string> = {
  idle: "Ready",
  preparing: "Preparing",
  active: "In session",
  windDown: "Winding down"
};

export interface RoomExperienceTruth {
  modeLabel: string;
  intentLabel: string;
  phaseLabel: string;
  sceneLabel: string;
  soundLabel: string;
  levelsLabel: string;
  timerLabel: string;
  nightLabel: string;
}

export function getRoomModeLabel(mode: RoomMode) {
  return roomModeOptions.find((option) => option.mode === mode)?.label ?? "Calm";
}

export function getRoomModeIntent(mode: RoomMode) {
  return roomModeOptions.find((option) => option.mode === mode)?.intent ?? "Unwind & relax";
}

export function getRoomExperienceTruth(
  experience: RoomExperienceState,
  playback: PlaybackSummary,
  audio: AudioState,
  system: SystemState,
  activeSceneLabel: string
): RoomExperienceTruth {
  const sourceLabel = getPlaybackSourceSummary(playback, audio)?.label ?? playback.source;
  const modeLabel = getRoomModeLabel(experience.mode);
  const intentLabel = getRoomModeIntent(experience.mode);
  const phaseLabel = phaseLabels[experience.phase] ?? "Ready";
  const sceneLabel = experience.mode === "hifi"
    ? getHifiEqPresetLabel(experience.hifiEqPresetId)
    : activeSceneLabel || experience.sceneVideoId || "Scene";
  const soundLabel = playback.source === "scene"
    ? `${sceneLabel} sound`
    : `${sourceLabel} audio`;
  const levelsLabel = `${system.volume.percent}% volume / ${system.display.brightnessPercent}% light`;
  const timerLabel = experience.timerEndsAt
    ? `Until ${new Date(experience.timerEndsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : typeof experience.timerMinutes === "number"
    ? `${experience.timerMinutes} min`
    : "No timer";
  const nightLabel = experience.nightSchedule.active ? "Night" : "Day";

  return {
    modeLabel,
    intentLabel,
    phaseLabel,
    sceneLabel,
    soundLabel,
    levelsLabel,
    timerLabel,
    nightLabel
  };
}

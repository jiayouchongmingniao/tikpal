import type { HifiEqPresetId, HifiVisualPresetId } from "./types";

export const hifiVisualPresets: Array<{
  id: HifiVisualPresetId;
  label: string;
  intent: string;
}> = [
  { id: "spectrum-bars", label: "Spectrum Bars", intent: "Wide dynamic meter" },
  { id: "waveform", label: "Waveform", intent: "Smooth signal sweep" },
  { id: "dual-vu", label: "Dual VU", intent: "Classic stereo meters" }
];

export const hifiEqPresets: Array<{
  id: HifiEqPresetId;
  label: string;
  intent: string;
  hifiVisualPresetId: HifiVisualPresetId;
}> = [
  { id: "flat", label: "Flat", intent: "Reference response", hifiVisualPresetId: "spectrum-bars" },
  { id: "warm", label: "Warm", intent: "Gentle low-mid lift", hifiVisualPresetId: "waveform" },
  { id: "vocal", label: "Vocal", intent: "Clearer midrange presence", hifiVisualPresetId: "dual-vu" }
];

export function getHifiVisualPresetLabel(id: HifiVisualPresetId) {
  return hifiVisualPresets.find((preset) => preset.id === id)?.label ?? "Spectrum Bars";
}

export function normalizeHifiVisualPresetId(value: string | null | undefined): HifiVisualPresetId {
  return hifiVisualPresets.some((preset) => preset.id === value) ? value as HifiVisualPresetId : "spectrum-bars";
}

export function getHifiEqPreset(id: HifiEqPresetId) {
  return hifiEqPresets.find((preset) => preset.id === id) ?? hifiEqPresets[0];
}

export function getHifiEqPresetLabel(id: HifiEqPresetId) {
  return getHifiEqPreset(id).label;
}

export function normalizeHifiEqPresetId(value: string | null | undefined, fallback: HifiEqPresetId = "flat"): HifiEqPresetId {
  return hifiEqPresets.some((preset) => preset.id === value) ? value as HifiEqPresetId : fallback;
}

export function getHifiEqPresetIdForVisualPresetId(value: HifiVisualPresetId): HifiEqPresetId {
  return hifiEqPresets.find((preset) => preset.hifiVisualPresetId === value)?.id ?? "flat";
}

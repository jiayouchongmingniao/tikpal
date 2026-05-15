import type { PlaybackActionRequest, PlaybackActionType, TikpalState } from "../types";

const API_ROOT = "/api/v1";

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Tikpal API ${response.status}: ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchTikpalState(signal?: AbortSignal): Promise<TikpalState> {
  const response = await fetch(`${API_ROOT}/system/state`, {
    headers: { Accept: "application/json" },
    signal
  });
  return readJson<TikpalState>(response);
}

export async function sendPlaybackAction(type: PlaybackActionType, value?: number): Promise<TikpalState> {
  const body: PlaybackActionRequest = { type, value };
  const response = await fetch(`${API_ROOT}/playback/actions`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return readJson<TikpalState>(response);
}

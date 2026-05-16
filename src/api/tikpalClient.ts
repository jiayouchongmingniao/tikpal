import type {
  PlaybackActionRequest,
  PlaybackActionType,
  SourceSwitchRequest,
  SourceSwitchTarget,
  SystemActionRequest,
  SystemActionType,
  TikpalState
} from "../types";

const API_ROOT = "/api/v1";

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Tikpal API ${response.status}: ${response.statusText}`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) {
        message = body.message;
      }
    } catch {
      // Ignore non-JSON error bodies.
    }
    throw new Error(message);
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

export async function sendSystemAction(type: SystemActionType): Promise<TikpalState> {
  const body: SystemActionRequest = { type };
  const response = await fetch(`${API_ROOT}/system/actions`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return readJson<TikpalState>(response);
}

export async function sendSourceSwitch(target: SourceSwitchTarget, radioStationId?: string): Promise<TikpalState> {
  const body: SourceSwitchRequest = { target, radioStationId };
  const response = await fetch(`${API_ROOT}/audio/source`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return readJson<TikpalState>(response);
}

import type {
  AudioLibraryFilters,
  AudioLibraryResponse,
  PlaybackActionRequest,
  PlaybackActionType,
  RadioCatalogFilters,
  RadioCatalogResponse,
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

export async function fetchRadioCatalog(filters: RadioCatalogFilters = {}, signal?: AbortSignal): Promise<RadioCatalogResponse> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.genre) params.set("genre", filters.genre);
  if (filters.bitrate) params.set("bitrate", filters.bitrate);
  if (typeof filters.limit === "number") params.set("limit", String(filters.limit));
  if (typeof filters.offset === "number") params.set("offset", String(filters.offset));

  const search = params.toString();
  const response = await fetch(`${API_ROOT}/audio/radios${search ? `?${search}` : ""}`, {
    headers: { Accept: "application/json" },
    signal
  });
  return readJson<RadioCatalogResponse>(response);
}

export async function fetchAudioLibrary(filters: AudioLibraryFilters = {}, signal?: AbortSignal): Promise<AudioLibraryResponse> {
  const params = new URLSearchParams();
  if (filters.storage) params.set("storage", filters.storage);
  if (filters.category) params.set("category", filters.category);
  if (filters.subCategory) params.set("subCategory", filters.subCategory);
  if (typeof filters.limit === "number") params.set("limit", String(filters.limit));
  if (typeof filters.offset === "number") params.set("offset", String(filters.offset));

  const search = params.toString();
  const response = await fetch(`${API_ROOT}/audio/library${search ? `?${search}` : ""}`, {
    headers: { Accept: "application/json" },
    signal
  });
  return readJson<AudioLibraryResponse>(response);
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

export async function sendSystemAction(type: SystemActionType, value?: number): Promise<TikpalState> {
  const body: SystemActionRequest = { type, value };
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

export async function sendSourceSwitch(target: SourceSwitchTarget, radioStationId?: string, localTrackPath?: string): Promise<TikpalState> {
  const body: SourceSwitchRequest = { target, radioStationId, localTrackPath };
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

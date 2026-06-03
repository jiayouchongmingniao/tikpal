import type {
  AudioLibraryFilters,
  AudioLibraryResponse,
  AudioPlaylistActionRequest,
  AudioPlaylistCreateRequest,
  AudioPlaylistResponse,
  AudioSpectrumFrame,
  BackgroundVideoCatalogResponse,
  PlaybackMode,
  PlaybackActionRequest,
  PlaybackActionType,
  RadioCatalogFilters,
  RadioCatalogResponse,
  BackgroundVideoSummary,
  RoomExperienceActionRequest,
  RoomExperienceState,
  SceneContextSummary,
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

export async function fetchAudioPlaylists(signal?: AbortSignal): Promise<AudioPlaylistResponse> {
  const response = await fetch(`${API_ROOT}/audio/playlists`, {
    headers: { Accept: "application/json" },
    signal
  });
  return readJson<AudioPlaylistResponse>(response);
}

export async function fetchAudioSpectrum(signal?: AbortSignal): Promise<AudioSpectrumFrame> {
  const response = await fetch(`${API_ROOT}/audio/spectrum`, {
    headers: { Accept: "application/json" },
    signal
  });
  return readJson<AudioSpectrumFrame>(response);
}

export async function createAudioPlaylist(playlist: string | AudioPlaylistCreateRequest): Promise<AudioPlaylistResponse> {
  const response = await fetch(`${API_ROOT}/audio/playlists`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(typeof playlist === "string" ? { name: playlist } : playlist)
  });
  return readJson<AudioPlaylistResponse>(response);
}

export async function sendAudioPlaylistAction(action: AudioPlaylistActionRequest): Promise<AudioPlaylistResponse> {
  const response = await fetch(`${API_ROOT}/audio/playlist-actions`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(action)
  });
  return readJson<AudioPlaylistResponse>(response);
}

export async function fetchBackgroundVideos(signal?: AbortSignal): Promise<BackgroundVideoCatalogResponse> {
  const response = await fetch(`${API_ROOT}/media/background-videos`, {
    headers: { Accept: "application/json" },
    signal
  });
  return readJson<BackgroundVideoCatalogResponse>(response);
}

export async function fetchRoomExperienceState(signal?: AbortSignal): Promise<RoomExperienceState> {
  const response = await fetch(`${API_ROOT}/experience/state`, {
    headers: { Accept: "application/json" },
    signal
  });
  return readJson<RoomExperienceState>(response);
}

export async function fetchSceneContext(timeZone: string, signal?: AbortSignal): Promise<SceneContextSummary> {
  const params = new URLSearchParams();
  if (timeZone) params.set("timeZone", timeZone);
  const search = params.toString();
  const response = await fetch(`${API_ROOT}/scene/context${search ? `?${search}` : ""}`, {
    headers: { Accept: "application/json" },
    signal
  });
  return readJson<SceneContextSummary>(response);
}

export async function sendRoomExperienceAction(action: RoomExperienceActionRequest): Promise<RoomExperienceState> {
  const response = await fetch(`${API_ROOT}/experience/actions`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(action)
  });
  return readJson<RoomExperienceState>(response);
}

export async function sendPlaybackAction(type: PlaybackActionType, value?: number, mode?: PlaybackMode): Promise<TikpalState> {
  const body: PlaybackActionRequest = { type };
  if (typeof value === "number") body.value = value;
  if (mode) body.mode = mode;
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

export async function sendFavoriteTrack(trackPath: string, favorite: boolean): Promise<TikpalState> {
  const response = await fetch(`${API_ROOT}/audio/favorites`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ trackPath, favorite })
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

export async function sendSourceSwitch(
  target: SourceSwitchTarget,
  radioStationId?: string,
  localTrackPath?: string,
  sceneVideo?: BackgroundVideoSummary
): Promise<TikpalState> {
  const body: SourceSwitchRequest = { target, radioStationId, localTrackPath };
  if (sceneVideo) {
    body.sceneVideoId = sceneVideo.id;
    body.sceneVideoLabel = sceneVideo.label;
    body.sceneVideoSrc = sceneVideo.src;
  }
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

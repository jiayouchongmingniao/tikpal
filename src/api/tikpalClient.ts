import type {
  AudioLibraryFilters,
  AudioLibraryResponse,
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
  TikpalState,
  WebModeActionRequest,
  WebModeSettingsPatch,
  WebModeState
} from "../types";

const API_ROOT = "/api/v1";
const DEFAULT_GET_TIMEOUT_MS = 4500;
const DEFAULT_POST_TIMEOUT_MS = 15000;
const HEARTBEAT_TIMEOUT_MS = 2500;

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = DEFAULT_GET_TIMEOUT_MS) {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  let timedOut = false;

  const abortFromUpstream = () => controller.abort();
  if (upstreamSignal?.aborted) {
    controller.abort();
  } else if (upstreamSignal) {
    upstreamSignal.addEventListener("abort", abortFromUpstream, { once: true });
  }

  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (timedOut) {
      throw new Error("Tikpal API request timed out");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}

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
  const response = await fetchWithTimeout(`${API_ROOT}/system/state`, {
    headers: { Accept: "application/json" },
    signal
  }, DEFAULT_GET_TIMEOUT_MS);
  return readJson<TikpalState>(response);
}

export async function fetchRadioCatalog(filters: RadioCatalogFilters = {}, signal?: AbortSignal): Promise<RadioCatalogResponse> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.genre) params.set("genre", filters.genre);
  if (filters.bitrate) params.set("bitrate", filters.bitrate);
  if (filters.category) params.set("category", filters.category);
  if (filters.scope) params.set("scope", filters.scope);
  if (typeof filters.limit === "number") params.set("limit", String(filters.limit));
  if (typeof filters.offset === "number") params.set("offset", String(filters.offset));

  const search = params.toString();
  const response = await fetchWithTimeout(`${API_ROOT}/audio/radios${search ? `?${search}` : ""}`, {
    headers: { Accept: "application/json" },
    signal
  }, DEFAULT_GET_TIMEOUT_MS);
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
  const response = await fetchWithTimeout(`${API_ROOT}/audio/library${search ? `?${search}` : ""}`, {
    headers: { Accept: "application/json" },
    signal
  }, DEFAULT_GET_TIMEOUT_MS);
  return readJson<AudioLibraryResponse>(response);
}

export async function fetchAudioSpectrum(signal?: AbortSignal): Promise<AudioSpectrumFrame> {
  const response = await fetchWithTimeout(`${API_ROOT}/audio/spectrum`, {
    headers: { Accept: "application/json" },
    signal
  }, DEFAULT_GET_TIMEOUT_MS);
  return readJson<AudioSpectrumFrame>(response);
}

export async function fetchBackgroundVideos(signal?: AbortSignal): Promise<BackgroundVideoCatalogResponse> {
  const response = await fetchWithTimeout(`${API_ROOT}/media/background-videos`, {
    headers: { Accept: "application/json" },
    signal
  }, DEFAULT_GET_TIMEOUT_MS);
  return readJson<BackgroundVideoCatalogResponse>(response);
}

export async function fetchRoomExperienceState(signal?: AbortSignal): Promise<RoomExperienceState> {
  const response = await fetchWithTimeout(`${API_ROOT}/experience/state`, {
    headers: { Accept: "application/json" },
    signal
  }, DEFAULT_GET_TIMEOUT_MS);
  return readJson<RoomExperienceState>(response);
}

export async function fetchSceneContext(timeZone: string, signal?: AbortSignal): Promise<SceneContextSummary> {
  const params = new URLSearchParams();
  if (timeZone) params.set("timeZone", timeZone);
  const search = params.toString();
  const response = await fetchWithTimeout(`${API_ROOT}/scene/context${search ? `?${search}` : ""}`, {
    headers: { Accept: "application/json" },
    signal
  }, DEFAULT_GET_TIMEOUT_MS);
  return readJson<SceneContextSummary>(response);
}

export async function sendRoomExperienceAction(action: RoomExperienceActionRequest): Promise<RoomExperienceState> {
  const response = await fetchWithTimeout(`${API_ROOT}/experience/actions`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(action)
  }, DEFAULT_POST_TIMEOUT_MS);
  return readJson<RoomExperienceState>(response);
}

export async function sendPlaybackAction(type: PlaybackActionType, value?: number, mode?: PlaybackMode): Promise<TikpalState> {
  const body: PlaybackActionRequest = { type };
  if (typeof value === "number") body.value = value;
  if (mode) body.mode = mode;
  const response = await fetchWithTimeout(`${API_ROOT}/playback/actions`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  }, DEFAULT_POST_TIMEOUT_MS);
  return readJson<TikpalState>(response);
}

export async function sendFavoriteTrack(trackPath: string, favorite: boolean): Promise<TikpalState> {
  const response = await fetchWithTimeout(`${API_ROOT}/audio/favorites`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ trackPath, favorite })
  }, DEFAULT_POST_TIMEOUT_MS);
  return readJson<TikpalState>(response);
}

export async function sendSystemAction(type: SystemActionType, value?: number): Promise<TikpalState> {
  const body: SystemActionRequest = { type, value };
  const response = await fetchWithTimeout(`${API_ROOT}/system/actions`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  }, DEFAULT_POST_TIMEOUT_MS);
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
  const response = await fetchWithTimeout(`${API_ROOT}/audio/source`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  }, DEFAULT_POST_TIMEOUT_MS);
  return readJson<TikpalState>(response);
}

export async function fetchWebModeState(signal?: AbortSignal): Promise<WebModeState> {
  const response = await fetchWithTimeout(`${API_ROOT}/web-mode/state`, {
    headers: { Accept: "application/json" },
    signal
  }, DEFAULT_GET_TIMEOUT_MS);
  return readJson<WebModeState>(response);
}

export async function sendWebModeAction(action: WebModeActionRequest): Promise<WebModeState> {
  const response = await fetchWithTimeout(`${API_ROOT}/web-mode/actions`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(action)
  }, DEFAULT_POST_TIMEOUT_MS);
  return readJson<WebModeState>(response);
}

export async function updateWebModeSettings(patch: WebModeSettingsPatch): Promise<WebModeState> {
  const response = await fetchWithTimeout(`${API_ROOT}/web-mode/settings`, {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(patch)
  }, DEFAULT_POST_TIMEOUT_MS);
  return readJson<WebModeState>(response);
}

export async function testWebModeProxy(): Promise<{ ok: boolean; message: string; proxyUrl: string }> {
  const response = await fetchWithTimeout(`${API_ROOT}/web-mode/proxy-test`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  }, DEFAULT_POST_TIMEOUT_MS);
  return readJson<{ ok: boolean; message: string; proxyUrl: string }>(response);
}

export async function sendKioskHeartbeat(payload: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
  const response = await fetchWithTimeout(`${API_ROOT}/kiosk/heartbeat`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    signal
  }, HEARTBEAT_TIMEOUT_MS);
  await readJson(response);
}

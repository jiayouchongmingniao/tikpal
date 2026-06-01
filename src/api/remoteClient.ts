import type { RemoteActionRequest, RemoteCatalogResponse, RemoteStateResponse } from "../types";

const API_ROOT = "/api/v1/remote";
const REMOTE_KEY_STORAGE_KEY = "tikpal.remoteKey";

export function readStoredRemoteKey() {
  return window.localStorage.getItem(REMOTE_KEY_STORAGE_KEY) ?? "";
}

export function storeRemoteKey(key: string) {
  const trimmed = key.trim();
  if (trimmed) {
    window.localStorage.setItem(REMOTE_KEY_STORAGE_KEY, trimmed);
    return;
  }
  window.localStorage.removeItem(REMOTE_KEY_STORAGE_KEY);
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Tikpal Remote ${response.status}: ${response.statusText}`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // Keep the status text when the response body is not JSON.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function remoteHeaders(remoteKey?: string) {
  const headers: Record<string, string> = {
    Accept: "application/json"
  };
  const key = remoteKey?.trim();
  if (key) headers["X-Tikpal-Key"] = key;
  return headers;
}

export async function fetchRemoteState(signal?: AbortSignal): Promise<RemoteStateResponse> {
  const response = await fetch(`${API_ROOT}/state`, {
    headers: remoteHeaders(),
    signal
  });
  return readJson<RemoteStateResponse>(response);
}

export async function fetchRemoteCatalog(signal?: AbortSignal): Promise<RemoteCatalogResponse> {
  const response = await fetch(`${API_ROOT}/catalog`, {
    headers: remoteHeaders(),
    signal
  });
  return readJson<RemoteCatalogResponse>(response);
}

export async function sendRemoteAction(
  action: RemoteActionRequest,
  remoteKey?: string,
  signal?: AbortSignal
): Promise<RemoteStateResponse> {
  const response = await fetch(`${API_ROOT}/actions`, {
    method: "POST",
    headers: {
      ...remoteHeaders(remoteKey),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(action),
    signal
  });
  return readJson<RemoteStateResponse>(response);
}

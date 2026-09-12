import type { RemoteActionRequest, RemoteCatalogResponse, RemoteStateResponse } from "../types";

const API_ROOT = "/api/v1/remote";

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

function remoteHeaders() {
  return {
    Accept: "application/json"
  };
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
  signal?: AbortSignal
): Promise<RemoteStateResponse> {
  const response = await fetch(`${API_ROOT}/actions`, {
    method: "POST",
    headers: {
      ...remoteHeaders(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(action),
    signal
  });
  return readJson<RemoteStateResponse>(response);
}

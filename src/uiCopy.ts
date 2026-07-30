export const playbackFallbackCopy = {
  title: "Nothing playing",
  artist: "Unknown artist",
  album: "No album",
  source: "Source unknown"
} as const;

export function dataSyncLabel(status: { pending?: boolean; source?: string }) {
  if (status.pending) return "Updating";
  return status.source === "api" ? "Live" : "Offline view";
}

export function friendlyUiError(message: string | null | undefined, fallback = "Needs attention. Try again.") {
  if (!message) return null;

  const normalized = message.toLowerCase();
  if (normalized.includes("unauthorized") || normalized.includes("forbidden") || normalized.includes("remote key")) {
    return "Check the access key.";
  }
  if (normalized.includes("no ") && normalized.includes(" connection detected")) {
    return "No connection yet. Reopen the source and try again.";
  }
  if (normalized.includes("proxy")) return "Check Web Proxy and retry.";
  if (normalized.includes("brightness") || normalized.includes("ddc")) return "Brightness did not change. Try a lower level.";
  if (normalized.includes("copy")) return "Could not save to Local. Try again.";
  if (normalized.includes("delete") || normalized.includes("remove")) return "Could not remove this track. Try again.";
  if (normalized.includes("favorite")) return "Could not update Favorites. Try again.";
  if (normalized.includes("radio")) return "Radio is not ready. Try another station.";
  if (normalized.includes("library") || normalized.includes("manifest")) return "Library is not ready. Scan or retry.";
  if (normalized.includes("explore") || normalized.includes("provider")) return "Explore did not open. Check Web Proxy and retry.";
  if (normalized.includes("volume")) return "Volume did not change. Try again.";
  if (normalized.includes("timeout") || normalized.includes("timed out")) return "This took too long. Try again.";
  if (normalized.includes("api") || normalized.includes("http") || normalized.includes("fetch")) return "Connection is slow. Try again.";
  if (message.length > 72 || normalized.includes("error") || normalized.includes("failed")) return fallback;
  return message;
}

export function friendlyUiErrorOrFallback(message: string | null | undefined, fallback = "Needs attention. Try again.") {
  return friendlyUiError(message, fallback) ?? fallback;
}

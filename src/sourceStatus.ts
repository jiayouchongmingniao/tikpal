import type { SourceSummary, WebModeState } from "./types";

export type SourceDisplayStatusKind = "active" | "connected" | "connecting" | "ready" | "unavailable";

interface SourceDisplayStatusOptions {
  pending?: boolean;
}

interface SourceDisplayStatus {
  kind: SourceDisplayStatusKind;
  label: string;
}

const sourceDisplayStatusLabels = {
  active: "Active",
  connected: "Connected",
  connecting: "Connecting",
  ready: "Ready",
  unavailable: "Unavailable"
} satisfies Record<SourceDisplayStatusKind, string>;

export function getSourceDisplayStatus(
  source: SourceSummary | undefined,
  options: SourceDisplayStatusOptions = {}
): SourceDisplayStatus {
  if (options.pending) return { kind: "connecting", label: sourceDisplayStatusLabels.connecting };
  if (!source) return { kind: "unavailable", label: sourceDisplayStatusLabels.unavailable };
  if (source.active) return { kind: "active", label: sourceDisplayStatusLabels.active };
  if (source.connectionState === "connected") return { kind: "connected", label: sourceDisplayStatusLabels.connected };
  if (source.connectionState === "armed") return { kind: "ready", label: sourceDisplayStatusLabels.ready };
  if (source.availability === "unavailable" || source.controllability === "status-only") {
    return { kind: "unavailable", label: sourceDisplayStatusLabels.unavailable };
  }
  return { kind: "ready", label: sourceDisplayStatusLabels.ready };
}

export function getSourceDisplayStatusLabel(
  source: SourceSummary | undefined,
  options: SourceDisplayStatusOptions = {}
) {
  return getSourceDisplayStatus(source, options).label;
}

export function isExplorePrewarmComplete(webModeState: WebModeState | null) {
  if (!webModeState?.prewarmComplete || !webModeState.providers.length) return false;
  return webModeState.providers.every((provider) => {
    const status = webModeState.residentProviders[provider.id]?.status;
    return status === "ready"
      || status === "active"
      || status === "check_proxy"
      || status === "check_setup"
      || status === "region_unavailable";
  });
}

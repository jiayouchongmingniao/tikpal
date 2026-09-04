import type { WebModeState } from "./types";

export const EXPLORE_CLOSE_CHANNEL = "tikpal-explore-close";
export const EXPLORE_CLOSE_COVER_FALLBACK_MS = 1_100;
export const EXPLORE_CLOSE_RELEASE_DELAY_MS = 250;

export type ExploreCloseMessage =
  | { type: "cover-requested"; requestId: string }
  | { type: "cover-ready"; requestId: string }
  | { type: "closed"; requestId: string; state: WebModeState }
  | { type: "failed"; requestId: string };

export function createExploreCloseRequestId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `close-${uuid ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

export function isExploreCloseMessage(value: unknown): value is ExploreCloseMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<ExploreCloseMessage>;
  if (typeof message.requestId !== "string" || !message.requestId.trim()) return false;
  if (message.type === "cover-requested" || message.type === "cover-ready" || message.type === "failed") return true;
  return message.type === "closed" && Boolean(message.state && typeof message.state === "object");
}

import { useCallback, useEffect, useState } from "react";
import {
  fetchTikpalState,
  sendPlaybackAction as postPlaybackAction,
  sendSourceSwitch as postSourceSwitch,
  sendSystemAction as postSystemAction
} from "../api/tikpalClient";
import { fallbackTikpalState } from "../mockState";
import type { BackgroundVideoSummary, PlaybackActionType, PlaybackMode, SourceSwitchTarget, SystemActionType, TikpalState } from "../types";

export interface TikpalDataStatus {
  source: "api" | "fallback";
  pending: boolean;
  error: string | null;
  lastSuccessAtMs: number | null;
  pendingAction: string | null;
  pendingSinceMs: number | null;
}

const REFRESH_MS = 3000;
const AIRPLAY_REFRESH_MS = 2500;
const RADIO_PENDING_REFRESH_MS = 700;

export function useTikpalState() {
  const [state, setState] = useState<TikpalState>(fallbackTikpalState);
  const [status, setStatus] = useState<TikpalDataStatus>({
    source: "fallback",
    pending: false,
    error: null,
    lastSuccessAtMs: null,
    pendingAction: null,
    pendingSinceMs: null
  });

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const nextState = await fetchTikpalState(signal);
      const lastSuccessAtMs = Date.now();
      setState(nextState);
      setStatus((current) => ({
        ...current,
        source: "api",
        error: null,
        lastSuccessAtMs
      }));
      return nextState;
    } catch (error) {
      if (signal?.aborted) return null;
      setStatus((current) => ({
        ...current,
        source: "fallback",
        error: error instanceof Error ? error.message : "Tikpal API unavailable"
      }));
      return null;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const isRadioPendingRefresh = status.pendingAction === "source:radio"
      || (state.playback.source === "radio" && (status.pendingAction === "playback:next" || status.pendingAction === "playback:previous"));
    const refreshMs = isRadioPendingRefresh
      ? RADIO_PENDING_REFRESH_MS
      : state.playback.source === "airplay" && state.playback.state === "playing"
        ? AIRPLAY_REFRESH_MS
        : REFRESH_MS;
    void refresh(controller.signal);
    const interval = window.setInterval(() => {
      void refresh();
    }, refreshMs);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [refresh, state.playback.source, state.playback.state, status.pendingAction]);

  const sendPlaybackAction = useCallback(async (type: PlaybackActionType, value?: number, mode?: PlaybackMode) => {
    const pendingSinceMs = Date.now();
    setStatus((current) => ({ ...current, pending: true, pendingAction: `playback:${type}`, pendingSinceMs, error: null }));
    try {
      const nextState = await postPlaybackAction(type, value, mode);
      const lastSuccessAtMs = Date.now();
      setState(nextState);
      setStatus({ source: "api", pending: false, error: null, lastSuccessAtMs, pendingAction: null, pendingSinceMs: null });
      return nextState;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Playback action failed";
      setStatus((current) => ({
        ...current,
        pending: false,
        pendingAction: null,
        pendingSinceMs: null,
        error: message
      }));
      throw error;
    }
  }, []);

  const sendSystemAction = useCallback(async (type: SystemActionType, value?: number) => {
    const pendingSinceMs = Date.now();
    setStatus((current) => ({ ...current, pending: true, pendingAction: `system:${type}`, pendingSinceMs, error: null }));
    try {
      const nextState = await postSystemAction(type, value);
      const lastSuccessAtMs = Date.now();
      setState(nextState);
      setStatus({ source: "api", pending: false, error: null, lastSuccessAtMs, pendingAction: null, pendingSinceMs: null });
      return nextState;
    } catch (error) {
      const message = error instanceof Error ? error.message : "System action failed";
      setStatus((current) => ({
        ...current,
        pending: false,
        pendingAction: null,
        pendingSinceMs: null,
        error: message
      }));
      throw new Error(message);
    }
  }, []);

  const sendSourceSwitch = useCallback(async (target: SourceSwitchTarget, radioStationId?: string, localTrackPath?: string, sceneVideo?: BackgroundVideoSummary) => {
    const pendingSinceMs = Date.now();
    setStatus((current) => ({ ...current, pending: true, pendingAction: `source:${target}`, pendingSinceMs, error: null }));
    try {
      const nextState = await postSourceSwitch(target, radioStationId, localTrackPath, sceneVideo);
      const lastSuccessAtMs = Date.now();
      setState(nextState);
      setStatus({ source: "api", pending: false, error: null, lastSuccessAtMs, pendingAction: null, pendingSinceMs: null });
      return nextState;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Source switch failed";
      setStatus((current) => ({
        ...current,
        pending: false,
        pendingAction: null,
        pendingSinceMs: null,
        error: message
      }));
      throw new Error(message);
    }
  }, []);

  return {
    state,
    status,
    refresh,
    sendPlaybackAction,
    sendSystemAction,
    sendSourceSwitch
  };
}

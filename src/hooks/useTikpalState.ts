import { useCallback, useEffect, useState } from "react";
import {
  fetchTikpalState,
  sendPlaybackAction as postPlaybackAction,
  sendSourceSwitch as postSourceSwitch,
  sendSystemAction as postSystemAction
} from "../api/tikpalClient";
import { fallbackTikpalState } from "../mockState";
import type { PlaybackActionType, SourceSwitchTarget, SystemActionType, TikpalState } from "../types";

export interface TikpalDataStatus {
  source: "api" | "fallback";
  pending: boolean;
  error: string | null;
}

const REFRESH_MS = 3000;
const AUDIO_PROTECTION_REFRESH_MS = 6000;

export function useTikpalState() {
  const [state, setState] = useState<TikpalState>(fallbackTikpalState);
  const [status, setStatus] = useState<TikpalDataStatus>({
    source: "fallback",
    pending: false,
    error: null
  });

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const nextState = await fetchTikpalState(signal);
      setState(nextState);
      setStatus({ source: "api", pending: false, error: null });
    } catch (error) {
      if (signal?.aborted) return;
      setStatus({
        source: "fallback",
        pending: false,
        error: error instanceof Error ? error.message : "Tikpal API unavailable"
      });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const refreshMs = state.playback.source === "airplay" && state.playback.state === "playing"
      ? AUDIO_PROTECTION_REFRESH_MS
      : REFRESH_MS;
    void refresh(controller.signal);
    const interval = window.setInterval(() => {
      void refresh();
    }, refreshMs);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [refresh, state.playback.source, state.playback.state]);

  const sendPlaybackAction = useCallback(async (type: PlaybackActionType, value?: number) => {
    setStatus((current) => ({ ...current, pending: true, error: null }));
    try {
      const nextState = await postPlaybackAction(type, value);
      setState(nextState);
      setStatus({ source: "api", pending: false, error: null });
      return nextState;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Playback action failed";
      setStatus((current) => ({
        ...current,
        pending: false,
        error: message
      }));
      throw error;
    }
  }, []);

  const sendSystemAction = useCallback(async (type: SystemActionType, value?: number) => {
    setStatus((current) => ({ ...current, pending: true, error: null }));
    try {
      const nextState = await postSystemAction(type, value);
      setState(nextState);
      setStatus({ source: "api", pending: false, error: null });
      return nextState;
    } catch (error) {
      const message = error instanceof Error ? error.message : "System action failed";
      setStatus((current) => ({
        ...current,
        pending: false,
        error: message
      }));
      throw new Error(message);
    }
  }, []);

  const sendSourceSwitch = useCallback(async (target: SourceSwitchTarget, radioStationId?: string, localTrackPath?: string) => {
    setStatus((current) => ({ ...current, pending: true, error: null }));
    try {
      const nextState = await postSourceSwitch(target, radioStationId, localTrackPath);
      setState(nextState);
      setStatus({ source: "api", pending: false, error: null });
      return nextState;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Source switch failed";
      setStatus((current) => ({
        ...current,
        pending: false,
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

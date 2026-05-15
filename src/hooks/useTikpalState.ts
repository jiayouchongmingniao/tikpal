import { useCallback, useEffect, useState } from "react";
import { fetchTikpalState, sendPlaybackAction as postPlaybackAction } from "../api/tikpalClient";
import { fallbackTikpalState } from "../mockState";
import type { PlaybackActionType, TikpalState } from "../types";

export interface TikpalDataStatus {
  source: "api" | "fallback";
  pending: boolean;
  error: string | null;
}

const REFRESH_MS = 3000;

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
    void refresh(controller.signal);
    const interval = window.setInterval(() => {
      void refresh();
    }, REFRESH_MS);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [refresh]);

  const sendPlaybackAction = useCallback(async (type: PlaybackActionType, value?: number) => {
    setStatus((current) => ({ ...current, pending: true }));
    try {
      const nextState = await postPlaybackAction(type, value);
      setState(nextState);
      setStatus({ source: "api", pending: false, error: null });
    } catch (error) {
      setStatus({
        source: "fallback",
        pending: false,
        error: error instanceof Error ? error.message : "Playback action failed"
      });
    }
  }, []);

  return {
    state,
    status,
    refresh,
    sendPlaybackAction
  };
}

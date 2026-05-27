import { useCallback, useRef, useState } from "react";
import type { AppMode } from "../types";

interface GestureHandlers {
  onPointerDown: React.PointerEventHandler<HTMLElement>;
  onPointerMove: React.PointerEventHandler<HTMLElement>;
  onPointerUp: React.PointerEventHandler<HTMLElement>;
  onPointerCancel: React.PointerEventHandler<HTMLElement>;
  onWheel: React.WheelEventHandler<HTMLElement>;
}

interface GestureOptions {
  mode: AppMode;
  onOpenPlayer: () => void;
  onOpenPlaylist: () => void;
  onOpenMenu: () => void;
  onReturnAmbient: () => void;
  onToggleHud: () => void;
  onActivity: () => void;
}

interface PointerSnapshot {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startedAt: number;
  protectedStart: boolean;
}

export interface GesturePreview {
  kind: "player" | "playlist" | "return" | "menu";
  label: string;
  progress: number;
}

const TAP_MAX_DISTANCE = 10;
const ONE_FINGER_DOWN_THRESHOLD = 92;
const TWO_FINGER_HINT_THRESHOLD = 40;
const TWO_FINGER_DOWN_THRESHOLD = 130;
const SWIPE_UP_THRESHOLD = -80;
const LONG_PRESS_MS = 850;
const WHEEL_THRESHOLD = 180;
const GESTURE_PROGRESS_STEP = 0.05;

function clampProgress(value: number, threshold: number): number {
  return Math.max(0, Math.min(1, value / threshold));
}

function isProtectedTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("[data-gesture-protected]"));
}

function isPlaylistPageTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("[data-playlist-page]"));
}

export function useKioskGestures(options: GestureOptions): GestureHandlers & { gesturePreview: GesturePreview | null } {
  const pointersRef = useRef(new Map<number, PointerSnapshot>());
  const longPressTimerRef = useRef<number | null>(null);
  const wheelAccumulatorRef = useRef(0);
  const wheelResetTimerRef = useRef<number | null>(null);
  const gesturePreviewRef = useRef<GesturePreview | null>(null);
  const gesturePreviewFrameRef = useRef<number | null>(null);
  const [gesturePreview, setGesturePreview] = useState<GesturePreview | null>(null);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const resetPointers = useCallback(() => {
    pointersRef.current.clear();
    gesturePreviewRef.current = null;
    if (gesturePreviewFrameRef.current !== null) {
      window.cancelAnimationFrame(gesturePreviewFrameRef.current);
      gesturePreviewFrameRef.current = null;
    }
    setGesturePreview(null);
    clearLongPress();
  }, [clearLongPress]);

  const updateGesturePreview = useCallback((preview: GesturePreview | null) => {
    const nextPreview = preview
      ? {
          ...preview,
          progress: Math.round(preview.progress / GESTURE_PROGRESS_STEP) * GESTURE_PROGRESS_STEP
        }
      : null;
    const currentPreview = gesturePreviewRef.current;
    if (
      currentPreview?.kind === nextPreview?.kind
      && currentPreview?.label === nextPreview?.label
      && currentPreview?.progress === nextPreview?.progress
    ) {
      return;
    }

    gesturePreviewRef.current = nextPreview;
    if (gesturePreviewFrameRef.current !== null) return;

    gesturePreviewFrameRef.current = window.requestAnimationFrame(() => {
      gesturePreviewFrameRef.current = null;
      setGesturePreview(gesturePreviewRef.current);
    });
  }, []);

  const onPointerDown = useCallback<React.PointerEventHandler<HTMLElement>>(
    (event) => {
      options.onActivity();
      const protectedStart = isProtectedTarget(event.target);
      if (protectedStart) {
        resetPointers();
        return;
      }

      pointersRef.current.set(event.pointerId, {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        startedAt: performance.now(),
        protectedStart: false
      });

      event.currentTarget.setPointerCapture(event.pointerId);

      if (pointersRef.current.size === 1 && options.mode === "ambient") {
        clearLongPress();
        updateGesturePreview({ kind: "menu", label: "Quick Menu", progress: 0 });
        longPressTimerRef.current = window.setTimeout(() => {
          options.onOpenMenu();
          resetPointers();
        }, LONG_PRESS_MS);
      } else {
        clearLongPress();
      }
    },
    [clearLongPress, options, resetPointers, updateGesturePreview]
  );

  const onPointerMove = useCallback<React.PointerEventHandler<HTMLElement>>(
    (event) => {
      const pointer = pointersRef.current.get(event.pointerId);
      if (!pointer) return;
      if (pointer.protectedStart) return;
      pointer.x = event.clientX;
      pointer.y = event.clientY;

      const pointers = [...pointersRef.current.values()];
      const movedTooFar = pointers.some((item) => Math.hypot(item.x - item.startX, item.y - item.startY) > TAP_MAX_DISTANCE);
      if (movedTooFar) {
        clearLongPress();
      }

      if (options.mode === "ambient" && pointers.length >= 2) {
        const averageDeltaY = pointers.reduce((sum, item) => sum + item.y - item.startY, 0) / pointers.length;
        if (averageDeltaY > TWO_FINGER_HINT_THRESHOLD) {
          updateGesturePreview({
            kind: "playlist",
            label: "Playlist",
            progress: clampProgress(averageDeltaY, TWO_FINGER_DOWN_THRESHOLD)
          });
        }
      } else if (options.mode === "ambient" && pointers.length === 1 && pointer.y - pointer.startY > 16) {
        updateGesturePreview({
          kind: "player",
          label: "Player",
          progress: clampProgress(pointer.y - pointer.startY, ONE_FINGER_DOWN_THRESHOLD)
        });
      } else if (options.mode !== "ambient" && pointers.length === 1 && pointer.y - pointer.startY < -12) {
        updateGesturePreview({
          kind: "return",
          label: "Ambient",
          progress: clampProgress(Math.abs(pointer.y - pointer.startY), Math.abs(SWIPE_UP_THRESHOLD))
        });
      }
    },
    [clearLongPress, options.mode, updateGesturePreview]
  );

  const onPointerUp = useCallback<React.PointerEventHandler<HTMLElement>>(
    (event) => {
      const pointer = pointersRef.current.get(event.pointerId);
      if (!pointer) return;

      pointer.x = event.clientX;
      pointer.y = event.clientY;
      clearLongPress();

      const pointers = [...pointersRef.current.values()];
      const averageDeltaY = pointers.reduce((sum, item) => sum + item.y - item.startY, 0) / pointers.length;
      const primaryDeltaX = pointer.x - pointer.startX;
      const primaryDeltaY = pointer.y - pointer.startY;
      const distance = Math.hypot(primaryDeltaX, primaryDeltaY);

      if (pointer.protectedStart) {
        resetPointers();
        return;
      }

      if (options.mode === "ambient") {
        if (pointers.length >= 2 && averageDeltaY > TWO_FINGER_DOWN_THRESHOLD) {
          options.onOpenPlaylist();
        } else if (pointers.length === 1 && primaryDeltaY > ONE_FINGER_DOWN_THRESHOLD) {
          options.onOpenPlayer();
        } else if (pointers.length === 1 && distance <= TAP_MAX_DISTANCE) {
          options.onToggleHud();
        }
      } else if (primaryDeltaY < SWIPE_UP_THRESHOLD || (!pointer.protectedStart && distance <= TAP_MAX_DISTANCE)) {
        options.onReturnAmbient();
      }

      resetPointers();
    },
    [clearLongPress, options, resetPointers]
  );

  const onWheel = useCallback<React.WheelEventHandler<HTMLElement>>(
    (event) => {
      const verticalWheel = Math.abs(event.deltaY) >= Math.abs(event.deltaX);
      if (options.mode === "playlist" && verticalWheel && isPlaylistPageTarget(event.target)) {
        options.onActivity();
        return;
      }

      if (isProtectedTarget(event.target)) {
        options.onActivity();
        if (options.mode === "ambient" || event.deltaY >= 0) {
          return;
        }
      }

      event.preventDefault();
      options.onActivity();

      wheelAccumulatorRef.current += event.deltaY;
      if (wheelResetTimerRef.current !== null) {
        window.clearTimeout(wheelResetTimerRef.current);
      }
      wheelResetTimerRef.current = window.setTimeout(() => {
        wheelAccumulatorRef.current = 0;
        updateGesturePreview(null);
      }, 320);

      const absDelta = Math.abs(wheelAccumulatorRef.current);
      if (options.mode === "ambient") {
        const isPlaylistGesture = wheelAccumulatorRef.current > 0;
        updateGesturePreview({
          kind: isPlaylistGesture ? "playlist" : "player",
          label: isPlaylistGesture ? "Playlist" : "Player",
          progress: clampProgress(absDelta, WHEEL_THRESHOLD)
        });

        if (absDelta > WHEEL_THRESHOLD) {
          if (isPlaylistGesture) {
            options.onOpenPlaylist();
          } else {
            options.onOpenPlayer();
          }
          wheelAccumulatorRef.current = 0;
          updateGesturePreview(null);
        }
      } else if (wheelAccumulatorRef.current < -WHEEL_THRESHOLD) {
        updateGesturePreview({
          kind: "return",
          label: "Ambient",
          progress: 1
        });
        options.onReturnAmbient();
        wheelAccumulatorRef.current = 0;
        updateGesturePreview(null);
      }
    },
    [options, updateGesturePreview]
  );

  return {
    gesturePreview,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: resetPointers,
    onWheel
  };
}

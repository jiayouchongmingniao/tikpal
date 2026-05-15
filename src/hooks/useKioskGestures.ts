import { useCallback, useRef, useState } from "react";
import type { AppMode } from "../types";

interface GestureHandlers {
  onPointerDown: React.PointerEventHandler<HTMLElement>;
  onPointerMove: React.PointerEventHandler<HTMLElement>;
  onPointerUp: React.PointerEventHandler<HTMLElement>;
  onPointerCancel: React.PointerEventHandler<HTMLElement>;
}

interface GestureOptions {
  mode: AppMode;
  onOpenPlayer: () => void;
  onOpenSettings: () => void;
  onOpenMenu: () => void;
  onReturnAmbient: () => void;
  onBoostHud: () => void;
  onActivity: () => void;
}

interface PointerSnapshot {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startedAt: number;
}

const TAP_MAX_DISTANCE = 10;
const ONE_FINGER_DOWN_THRESHOLD = 92;
const TWO_FINGER_HINT_THRESHOLD = 40;
const TWO_FINGER_DOWN_THRESHOLD = 130;
const SWIPE_UP_THRESHOLD = -80;
const LONG_PRESS_MS = 850;

export function useKioskGestures(options: GestureOptions): GestureHandlers & { settingsHintVisible: boolean } {
  const pointersRef = useRef(new Map<number, PointerSnapshot>());
  const longPressTimerRef = useRef<number | null>(null);
  const [settingsHintVisible, setSettingsHintVisible] = useState(false);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const resetPointers = useCallback(() => {
    pointersRef.current.clear();
    setSettingsHintVisible(false);
    clearLongPress();
  }, [clearLongPress]);

  const onPointerDown = useCallback<React.PointerEventHandler<HTMLElement>>(
    (event) => {
      options.onActivity();
      event.currentTarget.setPointerCapture(event.pointerId);
      pointersRef.current.set(event.pointerId, {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        startedAt: performance.now()
      });

      if (pointersRef.current.size === 1 && options.mode === "ambient") {
        clearLongPress();
        longPressTimerRef.current = window.setTimeout(() => {
          options.onOpenMenu();
          resetPointers();
        }, LONG_PRESS_MS);
      } else {
        clearLongPress();
      }
    },
    [clearLongPress, options, resetPointers]
  );

  const onPointerMove = useCallback<React.PointerEventHandler<HTMLElement>>(
    (event) => {
      const pointer = pointersRef.current.get(event.pointerId);
      if (!pointer) return;
      pointer.x = event.clientX;
      pointer.y = event.clientY;

      const pointers = [...pointersRef.current.values()];
      const movedTooFar = pointers.some((item) => Math.hypot(item.x - item.startX, item.y - item.startY) > TAP_MAX_DISTANCE);
      if (movedTooFar) {
        clearLongPress();
      }

      if (options.mode === "ambient" && pointers.length >= 2) {
        const averageDeltaY = pointers.reduce((sum, item) => sum + item.y - item.startY, 0) / pointers.length;
        setSettingsHintVisible(averageDeltaY > TWO_FINGER_HINT_THRESHOLD && averageDeltaY < TWO_FINGER_DOWN_THRESHOLD);
      }
    },
    [clearLongPress, options.mode]
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

      if (options.mode === "ambient") {
        if (pointers.length >= 2 && averageDeltaY > TWO_FINGER_DOWN_THRESHOLD) {
          options.onOpenSettings();
        } else if (pointers.length === 1 && primaryDeltaY > ONE_FINGER_DOWN_THRESHOLD) {
          options.onOpenPlayer();
        } else if (pointers.length === 1 && distance <= TAP_MAX_DISTANCE) {
          options.onBoostHud();
        }
      } else if (primaryDeltaY < SWIPE_UP_THRESHOLD || distance <= TAP_MAX_DISTANCE) {
        options.onReturnAmbient();
      }

      resetPointers();
    },
    [clearLongPress, options, resetPointers]
  );

  return {
    settingsHintVisible,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: resetPointers
  };
}

import { useCallback, useRef } from "react";

const TAP_MAX_DISTANCE = 10;
const SWIPE_UP_THRESHOLD = -80;
const HORIZONTAL_DRIFT_LIMIT = 72;
const INTERACTIVE_SELECTOR = "button, input, select, textarea, a, [role='button'], [data-gesture-control]";

interface GestureState {
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export function useOverlayReturnGesture(onReturnAmbient: () => void) {
  const gestureRef = useRef<GestureState | null>(null);
  const suppressClickRef = useRef(false);

  const isInteractiveTarget = useCallback((target: EventTarget | null) => {
    return target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null;
  }, []);

  const clearSuppressClick = useCallback(() => {
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }, []);

  const resetGesture = useCallback(() => {
    gestureRef.current = null;
  }, []);

  const onPointerDown = useCallback<React.PointerEventHandler<HTMLElement>>((event) => {
    if (isInteractiveTarget(event.target)) {
      gestureRef.current = null;
      return;
    }
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [isInteractiveTarget]);

  const onPointerMove = useCallback<React.PointerEventHandler<HTMLElement>>((event) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gesture.currentX = event.clientX;
    gesture.currentY = event.clientY;
  }, []);

  const onPointerUp = useCallback<React.PointerEventHandler<HTMLElement>>(
    (event) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;

      gesture.currentX = event.clientX;
      gesture.currentY = event.clientY;

      const deltaX = gesture.currentX - gesture.startX;
      const deltaY = gesture.currentY - gesture.startY;
      const distance = Math.hypot(deltaX, deltaY);
      const isIntentionalSwipeUp = deltaY < SWIPE_UP_THRESHOLD && Math.abs(deltaX) < HORIZONTAL_DRIFT_LIMIT;

      if (isIntentionalSwipeUp) {
        suppressClickRef.current = true;
        event.preventDefault();
        event.stopPropagation();
        onReturnAmbient();
        clearSuppressClick();
      } else if (distance > TAP_MAX_DISTANCE) {
        suppressClickRef.current = true;
        clearSuppressClick();
      }

      resetGesture();
    },
    [clearSuppressClick, onReturnAmbient, resetGesture]
  );

  const onPointerCancel = useCallback<React.PointerEventHandler<HTMLElement>>(() => {
    resetGesture();
  }, [resetGesture]);

  const onClickCapture = useCallback<React.MouseEventHandler<HTMLElement>>((event) => {
    if (!suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = false;
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onClickCapture
  };
}

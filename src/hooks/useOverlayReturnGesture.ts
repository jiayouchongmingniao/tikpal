import { useCallback, useRef } from "react";

const TAP_MAX_DISTANCE = 10;
const SWIPE_UP_THRESHOLD = -80;
const MIN_HORIZONTAL_DRIFT_LIMIT = 72;
const HORIZONTAL_DRIFT_RATIO = 0.65;
const FORM_CONTROL_SELECTOR = "input, select, textarea";
const CLICK_CONTROL_SELECTOR = "button, a, [role='button'], [data-gesture-control]";

interface GestureState {
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  startedOnClickControl: boolean;
}

export function useOverlayReturnGesture(onReturnAmbient: () => void) {
  const gestureRef = useRef<GestureState | null>(null);
  const suppressClickRef = useRef(false);

  const isFormControlTarget = useCallback((target: EventTarget | null) => {
    return target instanceof Element && target.closest(FORM_CONTROL_SELECTOR) !== null;
  }, []);

  const isClickControlTarget = useCallback((target: EventTarget | null) => {
    return target instanceof Element && target.closest(CLICK_CONTROL_SELECTOR) !== null;
  }, []);

  const clearSuppressClick = useCallback(() => {
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }, []);

  const resetGesture = useCallback(() => {
    gestureRef.current = null;
  }, []);

  const isIntentionalSwipeUp = useCallback((deltaX: number, deltaY: number) => {
    if (deltaY >= SWIPE_UP_THRESHOLD) return false;
    const upwardDistance = Math.abs(deltaY);
    const horizontalDriftLimit = Math.max(MIN_HORIZONTAL_DRIFT_LIMIT, upwardDistance * HORIZONTAL_DRIFT_RATIO);
    return Math.abs(deltaX) <= horizontalDriftLimit;
  }, []);

  const onPointerDown = useCallback<React.PointerEventHandler<HTMLElement>>((event) => {
    if (isFormControlTarget(event.target)) {
      gestureRef.current = null;
      return;
    }
    const startedOnClickControl = isClickControlTarget(event.target);
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      startedOnClickControl
    };
    if (!startedOnClickControl) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }, [isClickControlTarget, isFormControlTarget]);

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

      if (isIntentionalSwipeUp(deltaX, deltaY)) {
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
    [clearSuppressClick, isIntentionalSwipeUp, onReturnAmbient, resetGesture]
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

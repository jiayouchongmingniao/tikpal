import { useEffect } from "react";

type WebKitGestureEvent = Event & {
  preventDefault: () => void;
};

const blockedKeys = new Set(["+", "-", "=", "0", "r"]);

export function useBrowserKioskGuard() {
  useEffect(() => {
    const prevent = (event: Event) => event.preventDefault();
    const preventTouchDefaults = (event: TouchEvent) => {
      if (event.touches.length > 1) {
        event.preventDefault();
      }
    };
    const preventZoomWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
      }
    };
    const preventBrowserShortcut = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && blockedKeys.has(key)) {
        event.preventDefault();
      }
    };

    window.addEventListener("contextmenu", prevent);
    window.addEventListener("dragstart", prevent);
    window.addEventListener("selectstart", prevent);
    window.addEventListener("gesturestart", prevent as (event: WebKitGestureEvent) => void);
    window.addEventListener("gesturechange", prevent as (event: WebKitGestureEvent) => void);
    window.addEventListener("gestureend", prevent as (event: WebKitGestureEvent) => void);
    window.addEventListener("touchmove", preventTouchDefaults, { passive: false });
    window.addEventListener("wheel", preventZoomWheel, { passive: false });
    window.addEventListener("keydown", preventBrowserShortcut);

    return () => {
      window.removeEventListener("contextmenu", prevent);
      window.removeEventListener("dragstart", prevent);
      window.removeEventListener("selectstart", prevent);
      window.removeEventListener("gesturestart", prevent as (event: WebKitGestureEvent) => void);
      window.removeEventListener("gesturechange", prevent as (event: WebKitGestureEvent) => void);
      window.removeEventListener("gestureend", prevent as (event: WebKitGestureEvent) => void);
      window.removeEventListener("touchmove", preventTouchDefaults);
      window.removeEventListener("wheel", preventZoomWheel);
      window.removeEventListener("keydown", preventBrowserShortcut);
    };
  }, []);
}

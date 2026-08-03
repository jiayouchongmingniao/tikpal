import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { sendWebModeAction } from "./api/tikpalClient";
import { RemoteControlApp } from "./components/RemoteControlApp";
import { WebModeSidePanel } from "./components/WebModeSidePanel";
import { I18nProvider } from "./i18n";
import "./styles.css";

declare global {
  interface Window {
    __TIKPAL_REMOTE_MODE__?: boolean;
  }
}

const isWebModeSidePanel = window.location.pathname === "/side-panel";
const RootApp = window.__TIKPAL_REMOTE_MODE__ ? RemoteControlApp : isWebModeSidePanel ? WebModeSidePanel : App;
const localKioskHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const onboardInputSelector = [
  "textarea",
  "[contenteditable='true']",
  "[role='textbox']",
  "input:not([type])",
  "input[type='text']",
  "input[type='search']",
  "input[type='url']",
  "input[type='email']",
  "input[type='password']",
  "input[type='tel']",
  "input[type='number']"
].join(",");
const onboardStickyInputSelector = "[data-onboard-sticky='true']";
const onboardKeyboardWindow = { width: 900, height: 280 };
const onboardKeyboardDefaultPosition = { x: 500, y: 420 };
const onboardKeyboardMargin = 24;
const stickyKeyboardKeepaliveIdleMs = 2500;

type KeyboardPlacement = {
  keyboardPosition: string;
  keyboardWindow: string;
  bounds: RectLike;
};

type RectLike = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type OnboardVisibleOptions = {
  keepAlive?: boolean;
  dismissSticky?: boolean;
};

const clampKeyboardCoordinate = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const keyboardRect = (x: number, y: number): RectLike => ({
  left: x,
  top: y,
  right: x + onboardKeyboardWindow.width,
  bottom: y + onboardKeyboardWindow.height
});

const rectsOverlap = (a: RectLike, b: RectLike) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

const keyboardPlacementForTarget = (target: HTMLElement): KeyboardPlacement => {
  const viewportWidth = Math.max(window.innerWidth || 0, onboardKeyboardWindow.width);
  const viewportHeight = Math.max(window.innerHeight || 0, onboardKeyboardWindow.height);
  const maxX = Math.max(0, viewportWidth - onboardKeyboardWindow.width);
  const maxY = Math.max(0, viewportHeight - onboardKeyboardWindow.height);
  const targetRect = target.getBoundingClientRect();
  const safeTarget = {
    left: targetRect.left - onboardKeyboardMargin,
    top: targetRect.top - onboardKeyboardMargin,
    right: targetRect.right + onboardKeyboardMargin,
    bottom: targetRect.bottom + onboardKeyboardMargin
  };
  const fit = (x: number, y: number) => ({
    x: Math.round(clampKeyboardCoordinate(x, 0, maxX)),
    y: Math.round(clampKeyboardCoordinate(y, 0, maxY))
  });
  const centeredX = targetRect.left + targetRect.width / 2 - onboardKeyboardWindow.width / 2;
  const topY = onboardKeyboardMargin;
  const bottomY = viewportHeight - onboardKeyboardWindow.height - onboardKeyboardMargin;
  const aboveY = targetRect.top - onboardKeyboardWindow.height - onboardKeyboardMargin;
  const belowY = targetRect.bottom + onboardKeyboardMargin;
  const leftX = onboardKeyboardMargin;
  const rightX = viewportWidth - onboardKeyboardWindow.width - onboardKeyboardMargin;
  const candidates = [
    fit(onboardKeyboardDefaultPosition.x, onboardKeyboardDefaultPosition.y),
    fit(centeredX, aboveY),
    fit(centeredX, belowY),
    fit(centeredX, topY),
    fit(centeredX, bottomY),
    fit(leftX, topY),
    fit(rightX, topY),
    fit(leftX, bottomY),
    fit(rightX, bottomY)
  ];
  const chosen = candidates.find((candidate) => !rectsOverlap(keyboardRect(candidate.x, candidate.y), safeTarget))
    ?? (targetRect.top > viewportHeight / 2 ? fit(centeredX, topY) : fit(centeredX, bottomY));

  return {
    keyboardPosition: `${chosen.x},${chosen.y}`,
    keyboardWindow: `${onboardKeyboardWindow.width}x${onboardKeyboardWindow.height}`,
    bounds: keyboardRect(chosen.x, chosen.y)
  };
};

if (!window.__TIKPAL_REMOTE_MODE__ && localKioskHosts.has(window.location.hostname)) {
  let lastTextInput: HTMLElement | null = null;
  let onboardVisibleRequested = false;
  let inputSessionActive = false;
  let outsidePointerDown = false;
  let lastKeyboardEnabled: boolean | null = null;
  let lastKeyboardRequestMs = 0;
  let lastKeyboardBounds: RectLike | null = null;
  let lastKeyboardTarget: HTMLElement | null = null;
  let stickyKeyboardKeepaliveTimer: number | null = null;
  let lastInputActivityMs = 0;
  const setOnboardVisible = (enabled: boolean, target: HTMLElement | null = null, options: OnboardVisibleOptions = {}) => {
    if (!enabled && !onboardVisibleRequested) return;
    const now = Date.now();
    const isStickyRepeat = Boolean(
      enabled
      && onboardVisibleRequested
      && target
      && target === lastKeyboardTarget
      && target.matches(onboardStickyInputSelector)
    );
    const keepAlive = options.keepAlive === true || isStickyRepeat;
    if (isStickyRepeat && now - lastKeyboardRequestMs < 150) {
      return;
    }
    const throttleMs = enabled ? 1000 : 250;
    if (!keepAlive && lastKeyboardEnabled === enabled && now - lastKeyboardRequestMs < throttleMs) return;
    lastKeyboardEnabled = enabled;
    lastKeyboardRequestMs = now;
    onboardVisibleRequested = enabled;
    const placement = enabled && target && !keepAlive ? keyboardPlacementForTarget(target) : null;
    if (placement) {
      lastKeyboardBounds = placement.bounds;
    } else if (!enabled) {
      lastKeyboardBounds = null;
    }
    const placementPayload = placement
      ? { keyboardPosition: placement.keyboardPosition, keyboardWindow: placement.keyboardWindow }
      : {};
    lastKeyboardTarget = enabled ? target : null;
    void sendWebModeAction({
      type: "keyboard",
      enabled,
      keyboardTarget: "kiosk",
      ...(enabled ? (keepAlive ? { keepAlive: true } : { force: true }) : {}),
      ...(enabled && target?.matches(onboardStickyInputSelector) ? { sticky: true } : {}),
      ...(!enabled && options.dismissSticky === true ? { dismissSticky: true } : {}),
      ...placementPayload
    })
      .catch(() => { lastKeyboardEnabled = null; });
  };
  const activeTextInput = () => document.activeElement instanceof HTMLElement
    ? document.activeElement.closest<HTMLElement>(onboardInputSelector)
    : null;
  const refocusTextInput = (target: HTMLElement | null) => {
    if (!target?.isConnected) return;
    target.focus({ preventScroll: true });
  };
  const stickyInputSessionActive = () => Boolean(
    inputSessionActive
      && lastTextInput?.isConnected
      && lastTextInput.matches(onboardStickyInputSelector)
  );
  const stickyTextInputTarget = () => {
    if (lastTextInput?.isConnected && lastTextInput.matches(onboardStickyInputSelector)) return lastTextInput;
    return document.querySelector<HTMLElement>(onboardStickyInputSelector);
  };
  const stopStickyKeyboardKeepalive = () => {
    if (stickyKeyboardKeepaliveTimer === null) return;
    window.clearInterval(stickyKeyboardKeepaliveTimer);
    stickyKeyboardKeepaliveTimer = null;
  };
  const startStickyKeyboardKeepalive = () => {
    if (stickyKeyboardKeepaliveTimer !== null) return;
    stickyKeyboardKeepaliveTimer = window.setInterval(() => {
      if (!stickyInputSessionActive() || outsidePointerDown || !lastTextInput?.isConnected) {
        stopStickyKeyboardKeepalive();
        return;
      }
      if (Date.now() - lastInputActivityMs > stickyKeyboardKeepaliveIdleMs) {
        stopStickyKeyboardKeepalive();
        return;
      }
      setOnboardVisible(true, lastTextInput, { keepAlive: true });
    }, 900);
  };
  const recentInputActivity = () => Date.now() - lastInputActivityMs < 1800;
  const markTextInputActivity = (target: HTMLElement) => {
    lastTextInput = target;
    inputSessionActive = true;
    outsidePointerDown = false;
    lastInputActivityMs = Date.now();
    if (target.matches(onboardStickyInputSelector)) {
      startStickyKeyboardKeepalive();
    } else {
      stopStickyKeyboardKeepalive();
    }
  };
  const endInputSession = () => {
    lastTextInput = null;
    inputSessionActive = false;
    lastInputActivityMs = 0;
    lastKeyboardTarget = null;
    stopStickyKeyboardKeepalive();
  };
  const keepTextInputFocus = (target: HTMLElement) => {
    for (const delay of [80, 260, 620, 1200, 1800]) {
      window.setTimeout(() => {
        if (lastTextInput === target && inputSessionActive && !outsidePointerDown) {
          refocusTextInput(target);
        }
      }, delay);
    }
  };
  const keepStickyKeyboardVisible = () => {
    const target = stickyTextInputTarget();
    if (!target) return false;
    lastTextInput = target;
    inputSessionActive = true;
    outsidePointerDown = false;
    lastInputActivityMs = Date.now();
    startStickyKeyboardKeepalive();
    setOnboardVisible(true, target, { keepAlive: true });
    refocusTextInput(target);
    keepTextInputFocus(target);
    return true;
  };
  const pointerInsideOnboardKeyboard = (event: PointerEvent) => {
    if (!onboardVisibleRequested || !lastKeyboardBounds) return false;
    const margin = 18;
    return event.clientX >= lastKeyboardBounds.left - margin
      && event.clientX <= lastKeyboardBounds.right + margin
      && event.clientY >= lastKeyboardBounds.top - margin
      && event.clientY <= lastKeyboardBounds.bottom + margin;
  };
  const pointerInsideStickyKeyboardZone = (event: PointerEvent) => {
    if (!onboardVisibleRequested || !stickyInputSessionActive()) return false;
    const viewportHeight = window.innerHeight || 0;
    const lowerKeyboardTop = Math.max(0, viewportHeight - onboardKeyboardWindow.height - onboardKeyboardMargin * 2);
    const expandedBounds = lastKeyboardBounds
      ? {
          left: lastKeyboardBounds.left - onboardKeyboardMargin * 4,
          top: lastKeyboardBounds.top - onboardKeyboardMargin * 4,
          right: lastKeyboardBounds.right + onboardKeyboardMargin * 4,
          bottom: lastKeyboardBounds.bottom + onboardKeyboardMargin * 4
        }
      : null;

    return Boolean(
      (expandedBounds
        && event.clientX >= expandedBounds.left
        && event.clientX <= expandedBounds.right
        && event.clientY >= expandedBounds.top
        && event.clientY <= expandedBounds.bottom)
        || (viewportHeight > 0 && event.clientY >= lowerKeyboardTop)
    );
  };
  const isMultilineInput = (target: HTMLElement) => target.matches("textarea,[contenteditable='true']")
    || target.getAttribute("aria-multiline") === "true";

  document.addEventListener("pointerdown", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(onboardInputSelector) : null;
    if (!target && (
      pointerInsideOnboardKeyboard(event)
      || pointerInsideStickyKeyboardZone(event)
      || (stickyInputSessionActive() && onboardVisibleRequested && recentInputActivity())
    )) {
      event.preventDefault();
      event.stopImmediatePropagation();
      outsidePointerDown = false;
      if (lastTextInput?.isConnected) {
        markTextInputActivity(lastTextInput);
        refocusTextInput(lastTextInput);
        keepTextInputFocus(lastTextInput);
      }
      return;
    }
    outsidePointerDown = !target;
    if (target) {
      markTextInputActivity(target);
      setOnboardVisible(true, target);
      keepTextInputFocus(target);
    }
    if (!target) {
      endInputSession();
      setOnboardVisible(false, null, { dismissSticky: true });
    }
  }, true);
  window.addEventListener("tikpal:keyboard-context-clear", () => {
    endInputSession();
    outsidePointerDown = true;
    setOnboardVisible(false, null, { dismissSticky: true });
  });
  document.addEventListener("focusin", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(onboardInputSelector) : null;
    if (target) {
      markTextInputActivity(target);
      setOnboardVisible(true, target);
      keepTextInputFocus(target);
    }
  }, true);
  document.addEventListener("focusout", () => {
    window.setTimeout(() => {
      const active = activeTextInput();
      if (active) {
        lastTextInput = active;
        inputSessionActive = true;
        return;
      }
      if (inputSessionActive && (!outsidePointerDown || stickyInputSessionActive() || recentInputActivity())) {
        if (keepStickyKeyboardVisible()) return;
        if (lastTextInput?.isConnected) {
          outsidePointerDown = false;
          refocusTextInput(lastTextInput);
          keepTextInputFocus(lastTextInput);
          return;
        }
      }
      if (inputSessionActive && stickyTextInputTarget() && keepStickyKeyboardVisible()) {
        return;
      }
      endInputSession();
      setOnboardVisible(false);
    }, 80);
  }, true);
  const refreshTextInputSession = (event: Event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(onboardInputSelector) : null;
    if (!target) return;
    markTextInputActivity(target);
    setOnboardVisible(true, target);
    keepTextInputFocus(target);
  };
  document.addEventListener("beforeinput", refreshTextInputSession, true);
  document.addEventListener("input", refreshTextInputSession, true);
  document.addEventListener("compositionstart", refreshTextInputSession, true);
  document.addEventListener("compositionupdate", refreshTextInputSession, true);
  document.addEventListener("submit", (event) => {
    if (stickyInputSessionActive() || (inputSessionActive && stickyTextInputTarget())) {
      event.preventDefault();
      keepStickyKeyboardVisible();
      return;
    }
    endInputSession();
    setOnboardVisible(false);
  }, true);
  document.addEventListener("keydown", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(onboardInputSelector) : null;
    if (target) {
      markTextInputActivity(target);
      if (!(event.key === "Enter" && !isMultilineInput(target))) {
        setOnboardVisible(true, target);
        keepTextInputFocus(target);
      }
    }
    if (event.key === "Enter" && target && !isMultilineInput(target) && !target.matches(onboardStickyInputSelector)) {
      endInputSession();
      setOnboardVisible(false);
    }
  }, true);
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <I18nProvider>
      <RootApp />
    </I18nProvider>
  </StrictMode>
);

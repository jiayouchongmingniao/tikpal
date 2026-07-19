import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { sendWebModeAction } from "./api/tikpalClient";
import { RemoteControlApp } from "./components/RemoteControlApp";
import { WebModeSidePanel } from "./components/WebModeSidePanel";
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
const onboardKeyboardWindow = { width: 900, height: 280 };
const onboardKeyboardDefaultPosition = { x: 500, y: 420 };
const onboardKeyboardMargin = 24;

type KeyboardPlacement = {
  keyboardPosition: string;
  keyboardWindow: string;
};

type RectLike = {
  left: number;
  top: number;
  right: number;
  bottom: number;
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
    keyboardWindow: `${onboardKeyboardWindow.width}x${onboardKeyboardWindow.height}`
  };
};

if (!window.__TIKPAL_REMOTE_MODE__ && localKioskHosts.has(window.location.hostname)) {
  let lastTextInput: HTMLElement | null = null;
  let outsidePointerDown = false;
  const setOnboardVisible = (enabled: boolean, target: HTMLElement | null = null) => {
    const placement = enabled && target ? keyboardPlacementForTarget(target) : null;
    void sendWebModeAction({ type: "keyboard", enabled, ...(enabled ? { force: true } : {}), ...(placement ?? {}) }).catch(() => undefined);
  };
  const activeTextInput = () => document.activeElement instanceof HTMLElement
    && Boolean(document.activeElement.closest(onboardInputSelector));
  const refocusTextInput = (target: HTMLElement | null) => {
    if (!target?.isConnected) return;
    target.focus({ preventScroll: true });
  };
  const keepTextInputFocus = (target: HTMLElement) => {
    for (const delay of [80, 260, 620, 1200, 1800]) {
      window.setTimeout(() => {
        if (lastTextInput === target && !outsidePointerDown) {
          refocusTextInput(target);
        }
      }, delay);
    }
  };
  const isMultilineInput = (target: HTMLElement) => target.matches("textarea,[contenteditable='true']")
    || target.getAttribute("aria-multiline") === "true";

  document.addEventListener("pointerdown", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(onboardInputSelector) : null;
    outsidePointerDown = !target;
    if (target && target === document.activeElement) {
      lastTextInput = target;
      setOnboardVisible(true, target);
      keepTextInputFocus(target);
    }
    if (!target) {
      lastTextInput = null;
      setOnboardVisible(false);
    }
  }, true);
  window.addEventListener("tikpal:keyboard-context-clear", () => {
    lastTextInput = null;
    outsidePointerDown = true;
    setOnboardVisible(false);
  });
  document.addEventListener("focusin", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(onboardInputSelector) : null;
    if (target) {
      outsidePointerDown = false;
      lastTextInput = target;
      setOnboardVisible(true, target);
      keepTextInputFocus(target);
    }
  }, true);
  document.addEventListener("focusout", () => {
    window.setTimeout(() => {
      if (activeTextInput()) return;
      if (lastTextInput && !outsidePointerDown) {
        refocusTextInput(lastTextInput);
        return;
      }
      setOnboardVisible(false);
    }, 80);
  }, true);
  document.addEventListener("submit", () => {
    lastTextInput = null;
    setOnboardVisible(false);
  }, true);
  document.addEventListener("keydown", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(onboardInputSelector) : null;
    if (event.key === "Enter" && target && !isMultilineInput(target)) {
      lastTextInput = null;
      setOnboardVisible(false);
    }
  }, true);
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <RootApp />
  </StrictMode>
);

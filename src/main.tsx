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

if (!window.__TIKPAL_REMOTE_MODE__ && localKioskHosts.has(window.location.hostname)) {
  let lastTextInput: HTMLElement | null = null;
  let outsidePointerDown = false;
  const setOnboardVisible = (enabled: boolean) => {
    void sendWebModeAction({ type: "keyboard", enabled }).catch(() => undefined);
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
      setOnboardVisible(true);
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

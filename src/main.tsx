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
  const setOnboardVisible = (enabled: boolean) => {
    void sendWebModeAction({ type: "keyboard", enabled }).catch(() => undefined);
  };
  const activeTextInput = () => document.activeElement instanceof HTMLElement
    && Boolean(document.activeElement.closest(onboardInputSelector));
  const isMultilineInput = (target: HTMLElement) => target.matches("textarea,[contenteditable='true']")
    || target.getAttribute("aria-multiline") === "true";

  document.addEventListener("focusin", (event) => {
    if (event.target instanceof HTMLElement && event.target.closest(onboardInputSelector)) {
      setOnboardVisible(true);
    }
  }, true);
  document.addEventListener("focusout", () => {
    window.setTimeout(() => {
      if (!activeTextInput()) setOnboardVisible(false);
    }, 0);
  }, true);
  document.addEventListener("submit", () => setOnboardVisible(false), true);
  document.addEventListener("keydown", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(onboardInputSelector) : null;
    if (event.key === "Enter" && target && !isMultilineInput(target)) setOnboardVisible(false);
  }, true);
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <RootApp />
  </StrictMode>
);

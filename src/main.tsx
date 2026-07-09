import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
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

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <RootApp />
  </StrictMode>
);

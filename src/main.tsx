import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { RemoteControlApp } from "./components/RemoteControlApp";
import "./styles.css";

declare global {
  interface Window {
    __TIKPAL_REMOTE_MODE__?: boolean;
  }
}

const RootApp = window.__TIKPAL_REMOTE_MODE__ ? RemoteControlApp : App;

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <RootApp />
  </StrictMode>
);

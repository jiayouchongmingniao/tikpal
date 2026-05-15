import { useEffect, useMemo, useState } from "react";
import { AmbientScreen } from "./components/AmbientScreen";
import { PlayerOverlay } from "./components/PlayerOverlay";
import { QuickMenu } from "./components/QuickMenu";
import { QuickSettingsOverlay } from "./components/QuickSettingsOverlay";
import { useAppMode } from "./hooks/useAppMode";
import { useKioskGestures } from "./hooks/useKioskGestures";
import type { AppMode } from "./types";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "2-digit",
  day: "2-digit",
  weekday: "long"
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

function readInitialMode(): AppMode {
  const mode = new URLSearchParams(window.location.search).get("mode");
  if (mode === "player" || mode === "quickSettings" || mode === "quickMenu") return mode;
  return "ambient";
}

export default function App() {
  const [now, setNow] = useState(() => new Date());
  const { mode, hudBoosted, boostHud, changeMode, returnAmbient, resetIdleTimer } = useAppMode(readInitialMode());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const timeLabel = useMemo(() => timeFormatter.format(now), [now]);
  const dateLabel = useMemo(() => dateFormatter.format(now), [now]);

  const { settingsHintVisible, ...gestureHandlers } = useKioskGestures({
    mode,
    onOpenPlayer: () => changeMode("player"),
    onOpenSettings: () => changeMode("quickSettings"),
    onOpenMenu: () => changeMode("quickMenu"),
    onReturnAmbient: returnAmbient,
    onBoostHud: boostHud,
    onActivity: () => resetIdleTimer(mode)
  });

  return (
    <main className="app-root" {...gestureHandlers}>
      <AmbientScreen boosted={hudBoosted} timeLabel={timeLabel} dateLabel={dateLabel} onOpenSettings={() => changeMode("quickSettings")} />

      <PlayerOverlay active={mode === "player"} onReturnAmbient={returnAmbient} />
      <QuickSettingsOverlay active={mode === "quickSettings"} onReturnAmbient={returnAmbient} />
      <QuickMenu active={mode === "quickMenu"} onChoose={changeMode} onClose={returnAmbient} />

      <div className={`settings-hint ${settingsHintVisible ? "is-visible" : ""}`} aria-hidden={!settingsHintVisible}>
        Quick Settings
      </div>
    </main>
  );
}

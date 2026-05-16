import { useEffect, useMemo, useState } from "react";
import { AmbientScreen } from "./components/AmbientScreen";
import { PlayerOverlay } from "./components/PlayerOverlay";
import { QuickMenu } from "./components/QuickMenu";
import { QuickSettingsOverlay } from "./components/QuickSettingsOverlay";
import { useAppMode } from "./hooks/useAppMode";
import { useBrowserKioskGuard } from "./hooks/useBrowserKioskGuard";
import { useKioskGestures } from "./hooks/useKioskGestures";
import { useTikpalState } from "./hooks/useTikpalState";
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
  const { mode, hudVisible, idleTotalMs, idleRemainingMs, toggleHud, changeMode, returnAmbient, resetIdleTimer } = useAppMode(readInitialMode());
  const { state: tikpalState, status: tikpalStatus, sendPlaybackAction } = useTikpalState();

  useBrowserKioskGuard();

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const timeLabel = useMemo(() => timeFormatter.format(now), [now]);
  const dateLabel = useMemo(() => dateFormatter.format(now), [now]);

  const { gesturePreview, ...gestureHandlers } = useKioskGestures({
    mode,
    onOpenPlayer: () => changeMode("player"),
    onOpenSettings: () => changeMode("quickSettings"),
    onOpenMenu: () => changeMode("quickMenu"),
    onReturnAmbient: returnAmbient,
    onToggleHud: toggleHud,
    onActivity: () => resetIdleTimer(mode)
  });

  return (
    <main className="app-root" {...gestureHandlers}>
      <AmbientScreen
        hudVisible={hudVisible}
        timeLabel={timeLabel}
        dateLabel={dateLabel}
        playback={tikpalState.playback}
        system={tikpalState.system}
        status={tikpalStatus}
        onOpenSettings={() => changeMode("quickSettings")}
      />

      <PlayerOverlay
        active={mode === "player"}
        playback={tikpalState.playback}
        system={tikpalState.system}
        status={tikpalStatus}
        onPlaybackAction={sendPlaybackAction}
        onReturnAmbient={returnAmbient}
      />
      <QuickSettingsOverlay
        active={mode === "quickSettings"}
        system={tikpalState.system}
        runtime={tikpalState.runtime}
        status={tikpalStatus}
        onReturnAmbient={returnAmbient}
      />
      <QuickMenu active={mode === "quickMenu"} onChoose={changeMode} onClose={returnAmbient} />

      <div className={`gesture-cue ${gesturePreview ? "is-visible" : ""}`} aria-hidden={!gesturePreview}>
        <span>{gesturePreview?.label ?? ""}</span>
        <div className="gesture-cue-track">
          <i style={{ width: `${(gesturePreview?.progress ?? 0) * 100}%` }} />
        </div>
      </div>

      <div className={`idle-meter ${idleTotalMs && mode !== "ambient" ? "is-visible" : ""}`} aria-hidden={mode === "ambient"}>
        <span>{Math.ceil((idleRemainingMs ?? 0) / 1000)}s</span>
        <div className="idle-meter-track">
          <i style={{ width: `${idleTotalMs ? 100 - ((idleRemainingMs ?? 0) / idleTotalMs) * 100 : 0}%` }} />
        </div>
      </div>
    </main>
  );
}

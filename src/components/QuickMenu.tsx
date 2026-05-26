import { Clock, Video, Volume2, VolumeX } from "lucide-react";
import type { RoomMode } from "../types";

interface QuickMenuProps {
  active: boolean;
  sceneVideoEnabled: boolean;
  clockVisible: boolean;
  sceneSoundEnabled: boolean;
  sceneSoundPending: boolean;
  roomMode: RoomMode;
  onSceneVideoEnabledChange: (enabled: boolean) => void;
  onClockVisibleChange: (visible: boolean) => void;
  onSceneSoundEnabledChange: (enabled: boolean) => void;
  onClose: () => void;
}

export function QuickMenu({
  active,
  sceneVideoEnabled,
  clockVisible,
  sceneSoundEnabled,
  sceneSoundPending,
  roomMode,
  onSceneVideoEnabledChange,
  onClockVisibleChange,
  onSceneSoundEnabledChange,
  onClose
}: QuickMenuProps) {
  const hifiMode = roomMode === "hifi";

  return (
    <section className={`quick-menu ${active ? "is-active" : ""}`} aria-label="Quick menu" aria-hidden={!active}>
      <button className="overlay-backdrop" type="button" tabIndex={active ? 0 : -1} aria-label="Close quick menu" onClick={onClose} />
      <div className="quick-menu-panel" role="dialog" aria-modal="true" data-gesture-protected>
        <button
          className={`quick-menu-toggle ${sceneVideoEnabled ? "is-on" : "is-off"}`}
          type="button"
          aria-pressed={sceneVideoEnabled}
          data-quick-menu-toggle="scene-video"
          disabled={hifiMode}
          onClick={() => onSceneVideoEnabledChange(!sceneVideoEnabled)}
        >
          <Video size={26} />
          <strong>Scene Video</strong>
          <span>{hifiMode ? "EQ" : sceneVideoEnabled ? "On" : "Off"}</span>
        </button>
        <button
          className={`quick-menu-toggle ${clockVisible ? "is-on" : "is-off"}`}
          type="button"
          aria-pressed={clockVisible}
          data-quick-menu-toggle="clock"
          onClick={() => onClockVisibleChange(!clockVisible)}
        >
          <Clock size={26} />
          <strong>Clock</strong>
          <span>{clockVisible ? "Show" : "Hide"}</span>
        </button>
        <button
          className={`quick-menu-toggle ${sceneSoundEnabled ? "is-on" : "is-off"}`}
          type="button"
          aria-pressed={sceneSoundEnabled}
          data-quick-menu-toggle="scene-sound"
          disabled={sceneSoundPending || hifiMode}
          onClick={() => onSceneSoundEnabledChange(!sceneSoundEnabled)}
        >
          {sceneSoundEnabled ? <Volume2 size={26} /> : <VolumeX size={26} />}
          <strong>Scene Sound</strong>
          <span>{hifiMode ? "Hi-Fi" : sceneSoundPending ? "Syncing" : sceneSoundEnabled ? "On" : "Off"}</span>
        </button>
      </div>
    </section>
  );
}

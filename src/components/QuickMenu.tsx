import { Clock, Monitor, Moon, Volume2, VolumeX } from "lucide-react";

interface QuickMenuProps {
  active: boolean;
  screenEnabled: boolean;
  clockVisible: boolean;
  volumeEnabled: boolean;
  volumePending: boolean;
  sleepPending: boolean;
  onScreenEnabledChange: (enabled: boolean) => void;
  onClockVisibleChange: (visible: boolean) => void;
  onVolumeEnabledChange: (enabled: boolean) => void;
  onSleep: () => void;
  onClose: () => void;
}

export function QuickMenu({
  active,
  screenEnabled,
  clockVisible,
  volumeEnabled,
  volumePending,
  sleepPending,
  onScreenEnabledChange,
  onClockVisibleChange,
  onVolumeEnabledChange,
  onSleep,
  onClose
}: QuickMenuProps) {
  return (
    <section className={`quick-menu ${active ? "is-active" : ""}`} aria-label="Quick menu" aria-hidden={!active}>
      <button className="overlay-backdrop" type="button" tabIndex={active ? 0 : -1} aria-label="Close quick menu" onClick={onClose} />
      <div className="quick-menu-panel" role="dialog" aria-modal="true" data-gesture-protected>
        <button
          className={`quick-menu-toggle ${screenEnabled ? "is-on" : "is-off"}`}
          type="button"
          aria-label={screenEnabled ? "Turn screen off" : "Turn screen on"}
          aria-pressed={screenEnabled}
          data-quick-menu-toggle="screen"
          onClick={() => onScreenEnabledChange(!screenEnabled)}
        >
          <Monitor size={26} />
          <strong>Screen</strong>
          <span>{screenEnabled ? "On" : "Off"}</span>
        </button>
        <button
          className={`quick-menu-toggle ${volumeEnabled ? "is-on" : "is-off"}`}
          type="button"
          aria-label={volumeEnabled ? "Mute volume" : "Restore volume"}
          aria-pressed={volumeEnabled}
          data-quick-menu-toggle="volume"
          disabled={volumePending}
          onClick={() => onVolumeEnabledChange(!volumeEnabled)}
        >
          {volumeEnabled ? <Volume2 size={26} /> : <VolumeX size={26} />}
          <strong>Volume</strong>
          <span>{volumePending ? "Syncing" : volumeEnabled ? "On" : "Muted"}</span>
        </button>
        <button
          className={`quick-menu-toggle ${clockVisible ? "is-on" : "is-off"}`}
          type="button"
          aria-label={clockVisible ? "Hide time display" : "Show time display"}
          aria-pressed={clockVisible}
          data-quick-menu-toggle="time"
          onClick={() => onClockVisibleChange(!clockVisible)}
        >
          <Clock size={26} />
          <strong>Time</strong>
          <span>{clockVisible ? "Show" : "Hide"}</span>
        </button>
        <button
          className="quick-menu-toggle is-sleep"
          type="button"
          aria-label="Sleep Tikpal"
          data-quick-menu-toggle="sleep"
          disabled={sleepPending}
          onClick={onSleep}
        >
          <Moon size={26} />
          <strong>Sleep</strong>
          <span>{sleepPending ? "Syncing" : "Tap wake"}</span>
        </button>
      </div>
    </section>
  );
}

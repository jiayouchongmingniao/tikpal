import { Clock, Monitor, Moon, Volume2, VolumeX } from "lucide-react";
import { useI18n } from "../i18n";

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
  const { t } = useI18n();
  return (
    <section className={`quick-menu ${active ? "is-active" : ""}`} aria-label={t("quickMenu.title")} aria-hidden={!active}>
      <button className="overlay-backdrop" type="button" tabIndex={active ? 0 : -1} aria-label={t("quickMenu.close")} onClick={onClose} />
      <div className="quick-menu-panel" role="dialog" aria-modal="true" data-gesture-protected>
        <button
          className={`quick-menu-toggle ${screenEnabled ? "is-on" : "is-off"}`}
          type="button"
          aria-label={screenEnabled ? t("quickMenu.turnScreenOff") : t("quickMenu.turnScreenOn")}
          aria-pressed={screenEnabled}
          data-quick-menu-toggle="screen"
          onClick={() => onScreenEnabledChange(!screenEnabled)}
        >
          <Monitor size={26} />
          <strong>{t("quickMenu.screen")}</strong>
          <span>{screenEnabled ? t("common.on") : t("common.off")}</span>
        </button>
        <button
          className={`quick-menu-toggle ${volumeEnabled ? "is-on" : "is-off"}`}
          type="button"
          aria-label={volumeEnabled ? t("quickMenu.mute") : t("quickMenu.restoreVolume")}
          aria-pressed={volumeEnabled}
          data-quick-menu-toggle="volume"
          disabled={volumePending}
          onClick={() => onVolumeEnabledChange(!volumeEnabled)}
        >
          {volumeEnabled ? <Volume2 size={26} /> : <VolumeX size={26} />}
          <strong>{t("quickMenu.volume")}</strong>
          <span>{volumePending ? t("common.syncing") : volumeEnabled ? t("common.on") : t("common.muted")}</span>
        </button>
        <button
          className={`quick-menu-toggle ${clockVisible ? "is-on" : "is-off"}`}
          type="button"
          aria-label={clockVisible ? t("quickMenu.hideTime") : t("quickMenu.showTime")}
          aria-pressed={clockVisible}
          data-quick-menu-toggle="time"
          onClick={() => onClockVisibleChange(!clockVisible)}
        >
          <Clock size={26} />
          <strong>{t("quickMenu.time")}</strong>
          <span>{clockVisible ? t("common.visible") : t("common.hidden")}</span>
        </button>
        <button
          className="quick-menu-toggle is-sleep"
          type="button"
          aria-label={t("quickMenu.sleepTikpal")}
          data-quick-menu-toggle="sleep"
          disabled={sleepPending}
          onClick={onSleep}
        >
          <Moon size={26} />
          <strong>{t("quickMenu.sleep")}</strong>
          <span>{sleepPending ? t("common.syncing") : t("quickMenu.tapToSleep")}</span>
        </button>
      </div>
    </section>
  );
}

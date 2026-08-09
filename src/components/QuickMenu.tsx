import { Clock, Globe2, Monitor, Moon, Volume2, VolumeX } from "lucide-react";
import { useI18n } from "../i18n";

interface QuickMenuProps {
  active: boolean;
  screenEnabled: boolean;
  clockVisible: boolean;
  proxyEnabled: boolean | null;
  volumeEnabled: boolean;
  proxyPending: boolean;
  volumePending: boolean;
  sleepPending: boolean;
  onScreenEnabledChange: (enabled: boolean) => void;
  onClockVisibleChange: (visible: boolean) => void;
  onProxyEnabledChange: (enabled: boolean) => void;
  onVolumeEnabledChange: (enabled: boolean) => void;
  onSleep: () => void;
  onClose: () => void;
}

export function QuickMenu({
  active,
  screenEnabled,
  clockVisible,
  proxyEnabled,
  volumeEnabled,
  proxyPending,
  volumePending,
  sleepPending,
  onScreenEnabledChange,
  onClockVisibleChange,
  onProxyEnabledChange,
  onVolumeEnabledChange,
  onSleep,
  onClose
}: QuickMenuProps) {
  const { t } = useI18n();
  const proxyKnown = proxyEnabled !== null;
  const renderSwitch = () => (
    <i className="quick-menu-switch" aria-hidden="true">
      <b />
    </i>
  );

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
          {renderSwitch()}
        </button>
        <button
          className={`quick-menu-toggle ${volumeEnabled ? "is-on" : "is-off"} ${volumePending ? "is-pending" : ""}`}
          type="button"
          aria-label={volumeEnabled ? t("quickMenu.mute") : t("quickMenu.restoreVolume")}
          aria-pressed={volumeEnabled}
          data-quick-menu-toggle="volume"
          disabled={volumePending}
          onClick={() => onVolumeEnabledChange(!volumeEnabled)}
        >
          {volumeEnabled ? <Volume2 size={26} /> : <VolumeX size={26} />}
          <strong>{t("quickMenu.volume")}</strong>
          {renderSwitch()}
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
          {renderSwitch()}
        </button>
        <button
          className={`quick-menu-toggle is-proxy ${proxyEnabled ? "is-on" : "is-off"} ${proxyPending || !proxyKnown ? "is-pending" : ""}`}
          type="button"
          aria-label={proxyEnabled ? t("common.proxyOff") : t("common.proxyOn")}
          aria-pressed={Boolean(proxyEnabled)}
          data-quick-menu-toggle="proxy"
          disabled={proxyPending || !proxyKnown}
          onClick={() => onProxyEnabledChange(!proxyEnabled)}
        >
          <Globe2 size={26} />
          <strong>{t("common.proxy")}</strong>
          {renderSwitch()}
        </button>
        <button
          className={`quick-menu-toggle is-sleep ${sleepPending ? "is-on is-pending" : "is-off"}`}
          type="button"
          aria-label={t("quickMenu.sleepTikpal")}
          data-quick-menu-toggle="sleep"
          aria-busy={sleepPending}
          disabled={sleepPending}
          onClick={onSleep}
        >
          <Moon size={26} />
          <strong>{t("quickMenu.sleep")}</strong>
          {renderSwitch()}
        </button>
      </div>
    </section>
  );
}

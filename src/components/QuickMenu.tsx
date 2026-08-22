import { Globe2, Monitor, Moon, RotateCw, Volume2, VolumeX } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useI18n } from "../i18n";

interface QuickMenuProps {
  active: boolean;
  screenOffActive: boolean;
  proxyEnabled: boolean | null;
  volumeEnabled: boolean;
  proxyPending: boolean;
  volumePending: boolean;
  sleepPending: boolean;
  onScreenSaverToggle: () => void;
  onProxyEnabledChange: (enabled: boolean) => void;
  onVolumeEnabledChange: (enabled: boolean) => void;
  onSleep: () => void;
  onClose: () => void;
  onReboot: () => void;
  onNavigateSettings: (detail: "display" | "webMode") => void;
}

const LONG_PRESS_MS = 400;

export function QuickMenu({
  active,
  screenOffActive,
  proxyEnabled,
  volumeEnabled,
  proxyPending,
  volumePending,
  sleepPending,
  onScreenSaverToggle,
  onProxyEnabledChange,
  onVolumeEnabledChange,
  onSleep,
  onClose,
  onReboot,
  onNavigateSettings
}: QuickMenuProps) {
  const { t } = useI18n();
  const proxyKnown = proxyEnabled !== null;

  const [proxyConfirm, setProxyConfirm] = useState(false);
  const [rebootConfirm, setRebootConfirm] = useState(false);

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);

  const startLongPress = useCallback((onLongPress: () => void) => {
    longPressFiredRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      longPressFiredRef.current = true;
      onLongPress();
    }, LONG_PRESS_MS);
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    return longPressFiredRef.current;
  }, []);

  return (
    <section className={`quick-menu ${active ? "is-active" : ""}`} aria-label={t("quickMenu.title")} aria-hidden={!active}>
      <button className="overlay-backdrop" type="button" tabIndex={active ? 0 : -1} aria-label={t("quickMenu.close")} onClick={onClose} />
      <div className="quick-menu-panel" role="dialog" aria-modal="true" data-gesture-protected>
        <button
          className={`quick-menu-toggle ${screenOffActive ? "is-on" : "is-off"}`}
          type="button"
          aria-label={screenOffActive ? t("settings.screenSleepOff") : t("settings.screenSleepOn")}
          aria-pressed={screenOffActive}
          data-quick-menu-toggle="screen"
          onPointerDown={() => startLongPress(() => onNavigateSettings("display"))}
          onClick={() => { if (!cancelLongPress()) onScreenSaverToggle(); }}
        >
          <Monitor size={26} />
          <strong>{t("settings.screenSleep")}</strong>
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
        </button>
        <button
          className={`quick-menu-toggle is-proxy ${proxyEnabled ? "is-on" : "is-off"} ${proxyPending || !proxyKnown ? "is-pending" : ""}`}
          type="button"
          aria-label={proxyEnabled ? t("common.proxyOff") : t("common.proxyOn")}
          aria-pressed={Boolean(proxyEnabled)}
          data-quick-menu-toggle="proxy"
          disabled={proxyPending || !proxyKnown}
          onPointerDown={() => startLongPress(() => onNavigateSettings("webMode"))}
          onClick={() => { if (!cancelLongPress()) setProxyConfirm(true); }}
        >
          <Globe2 size={26} />
          <strong>{t("common.proxy")}</strong>
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
        </button>
        <button
          className="quick-menu-toggle is-reboot"
          type="button"
          aria-label={t("settings.systemReboot")}
          data-quick-menu-toggle="reboot"
          onClick={() => setRebootConfirm(true)}
        >
          <RotateCw size={26} />
          <strong>{t("settings.systemReboot")}</strong>
        </button>
        {rebootConfirm && (
          <div className="quick-menu-overlay">
            <p>{t("settings.restartSystem")}</p>
            <div className="quick-menu-overlay-actions">
              <button type="button" className="quick-menu-overlay-confirm" onClick={() => { setRebootConfirm(false); onReboot(); }}>
                {t("settings.systemReboot")}
              </button>
              <button type="button" className="quick-menu-overlay-cancel" onClick={() => setRebootConfirm(false)}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        )}
        {proxyConfirm && (
          <div className="quick-menu-overlay">
            <p>{t("settings.proxyRestartConfirmBody", { state: proxyEnabled ? t("common.proxyOff") : t("common.proxyOn") })}</p>
            <div className="quick-menu-overlay-actions">
              <button type="button" className="quick-menu-overlay-confirm" onClick={() => { setProxyConfirm(false); onProxyEnabledChange(!proxyEnabled); onReboot(); }}>
                {t("settings.proxyRestartConfirmAction")}
              </button>
              <button type="button" className="quick-menu-overlay-cancel" onClick={() => setProxyConfirm(false)}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

import { useEffect } from "react";
import { Moon, SlidersHorizontal, Target, Waves } from "lucide-react";
import { useI18n } from "../i18n";
import { roomModeOptions } from "../roomExperienceTruth";
import type { RoomMode } from "../types";

interface StartupModeChooserProps {
  active: boolean;
  context: "startup" | "explore-return";
  videoReady: boolean;
  pending: boolean;
  selectedMode: RoomMode;
  onAutoDismiss: () => void;
  onSelectMode: (mode: RoomMode) => void;
}

const startupModeIcons = {
  focus: Target,
  calm: Waves,
  sleep: Moon,
  hifi: SlidersHorizontal
} satisfies Record<RoomMode, typeof Target>;

export function StartupModeChooser({ active, context, videoReady, pending, selectedMode, onAutoDismiss, onSelectMode }: StartupModeChooserProps) {
  const { t, roomLabel, roomIntent } = useI18n();
  useEffect(() => {
    if (!active || pending || !videoReady) return undefined;

    const timer = window.setTimeout(() => {
      onAutoDismiss();
    }, 8_000);

    return () => window.clearTimeout(timer);
  }, [active, onAutoDismiss, pending, videoReady]);

  if (!active) return null;

  return (
    <section
      className={`startup-mode-chooser ${context === "explore-return" ? "is-explore-return" : ""}`}
      aria-label={t("ambient.chooseRoomMode")}
      data-gesture-protected
      data-room-mode-chooser-context={context}
    >
      <div className="startup-mode-panel">
        <div className="startup-mode-heading">
          <span>Tikpal</span>
          <strong>{t("startup.setRoomMood")}</strong>
        </div>
        <div className="startup-mode-grid" role="group" aria-label={t("startup.roomModes")}>
          {roomModeOptions.map((option) => {
            const Icon = startupModeIcons[option.mode];
            return (
              <button
                key={option.mode}
                className={selectedMode === option.mode ? "is-active" : ""}
                type="button"
                disabled={pending}
                aria-pressed={selectedMode === option.mode}
                data-startup-mode={option.mode}
                onClick={() => onSelectMode(option.mode)}
              >
                <Icon size={34} strokeWidth={1.7} />
                <strong>{roomLabel(option.mode)}</strong>
                <span>{roomIntent(option.mode)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

import { useEffect } from "react";
import { Moon, SlidersHorizontal, Target, Waves } from "lucide-react";
import { roomModeOptions } from "../roomExperienceTruth";
import type { RoomMode } from "../types";

interface StartupModeChooserProps {
  active: boolean;
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

export function StartupModeChooser({ active, pending, selectedMode, onAutoDismiss, onSelectMode }: StartupModeChooserProps) {
  useEffect(() => {
    if (!active || pending) return undefined;

    const timer = window.setTimeout(() => {
      onAutoDismiss();
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [active, onAutoDismiss, pending]);

  if (!active) return null;

  return (
    <section className="startup-mode-chooser" aria-label="Choose room mode" data-gesture-protected>
      <div className="startup-mode-panel">
        <div className="startup-mode-heading">
          <span>Tikpal</span>
          <strong>Set Your Room Mood</strong>
        </div>
        <div className="startup-mode-grid" role="group" aria-label="Startup room modes">
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
                <strong>{option.label}</strong>
                <span>{option.intent}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

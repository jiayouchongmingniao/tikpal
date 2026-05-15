import { MonitorOff, Music2, Palette, Settings, X } from "lucide-react";
import type { AppMode } from "../types";

interface QuickMenuProps {
  active: boolean;
  onChoose: (mode: AppMode) => void;
  onClose: () => void;
}

export function QuickMenu({ active, onChoose, onClose }: QuickMenuProps) {
  return (
    <section className={`quick-menu ${active ? "is-active" : ""}`} aria-label="Quick menu" aria-hidden={!active}>
      <button className="overlay-backdrop" type="button" tabIndex={active ? 0 : -1} aria-label="Close quick menu" onClick={onClose} />
      <div className="quick-menu-panel" role="dialog" aria-modal="true" data-gesture-protected>
        <button type="button" onClick={() => onChoose("player")}>
          <Music2 size={26} />
          <span>Player</span>
        </button>
        <button type="button" onClick={() => onChoose("quickSettings")}>
          <Settings size={26} />
          <span>Settings</span>
        </button>
        <button type="button">
          <Palette size={26} />
          <span>Flame</span>
        </button>
        <button type="button">
          <MonitorOff size={26} />
          <span>Screen Off</span>
        </button>
        <button type="button" onClick={onClose}>
          <X size={26} />
          <span>Close</span>
        </button>
      </div>
    </section>
  );
}

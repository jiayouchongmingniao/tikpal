import { Cpu, Database, EthernetPort, Info, Monitor, Music2, Power, RotateCcw, SlidersHorizontal, Volume2 } from "lucide-react";
import type { TikpalDataStatus } from "../hooks/useTikpalState";
import type { RuntimeState, SystemState } from "../types";

interface QuickSettingsOverlayProps {
  active: boolean;
  system: SystemState;
  runtime: RuntimeState;
  status: TikpalDataStatus;
  onReturnAmbient: () => void;
}

export function QuickSettingsOverlay({ active, system, runtime, status, onReturnAmbient }: QuickSettingsOverlayProps) {
  const settingsCards = [
    {
      icon: EthernetPort,
      title: "Network",
      value: system.network.label,
      meta: `${system.network.ip} - ${system.network.speed}`,
      tone: "cyan"
    },
    {
      icon: Volume2,
      title: "Audio Output",
      value: system.outputDevice.label,
      meta: system.outputDevice.detail,
      tone: "gold"
    },
    {
      icon: SlidersHorizontal,
      title: "DSP",
      value: system.dspState.enabled ? "Enabled" : "Disabled",
      meta: `Preset: ${system.dspState.preset}`,
      tone: "cyan"
    },
    {
      icon: Database,
      title: "Library",
      value: system.library.source,
      meta: `${system.library.trackCount.toLocaleString()} tracks`,
      tone: "gold"
    },
    {
      icon: Monitor,
      title: "Display",
      value: runtime.kioskWindow,
      meta: `Renderer: ${runtime.requestedRenderer}`,
      tone: "neutral"
    },
    {
      icon: Info,
      title: "System",
      value: status.source === "api" ? "Tikpal API" : "Fallback",
      meta: status.error ?? `CPU ${system.cpuTemp}C - ${system.uptime}`,
      tone: status.source === "api" ? "neutral" : "warn"
    },
    {
      icon: RotateCcw,
      title: "Restart",
      value: "Confirm Needed",
      meta: "System reboot",
      tone: "warn"
    },
    {
      icon: Power,
      title: "Shutdown",
      value: "Confirm Needed",
      meta: "Power off",
      tone: "danger"
    }
  ];

  return (
    <section className={`overlay quick-settings ${active ? "is-active" : ""}`} aria-label="Quick settings" aria-hidden={!active}>
      <button className="overlay-backdrop" type="button" tabIndex={active ? 0 : -1} aria-label="Return to ambient" onClick={onReturnAmbient} />
      <div className="settings-shell" role="dialog" aria-modal="true" data-gesture-protected>
        <aside className="settings-nav" aria-label="Settings sections">
          <button className="settings-nav-item is-active" type="button">
            <Music2 size={24} />
            <span>Home</span>
          </button>
          <button className="settings-nav-item" type="button">
            <EthernetPort size={24} />
            <span>Network</span>
          </button>
          <button className="settings-nav-item" type="button">
            <Volume2 size={24} />
            <span>Output</span>
          </button>
          <button className="settings-nav-item" type="button">
            <Cpu size={24} />
            <span>System</span>
          </button>
        </aside>

        <div className="settings-grid">
          {settingsCards.map((card) => {
            const Icon = card.icon;
            return (
              <article className={`settings-card tone-${card.tone}`} key={card.title}>
                <div className="settings-icon">
                  <Icon size={32} />
                </div>
                <div>
                  <span>{card.title}</span>
                  <strong>{card.value}</strong>
                  <p>{card.meta}</p>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

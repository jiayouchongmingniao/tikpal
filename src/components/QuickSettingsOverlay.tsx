import { useEffect, useMemo, useState } from "react";
import { Cpu, Database, EthernetPort, Info, Monitor, Music2, Palette, Power, RotateCcw, SlidersHorizontal, Type, Volume2 } from "lucide-react";
import type { TikpalDataStatus } from "../hooks/useTikpalState";
import type { FontTheme, RuntimeState, SystemActionType, SystemState } from "../types";

interface QuickSettingsOverlayProps {
  active: boolean;
  system: SystemState;
  runtime: RuntimeState;
  status: TikpalDataStatus;
  fontTheme: FontTheme;
  onFontThemeChange: (theme: FontTheme) => void;
  onSystemAction: (type: SystemActionType) => Promise<unknown>;
  onReturnAmbient: () => void;
}

type CardTone = "cyan" | "gold" | "neutral" | "warn" | "danger";
type ActionableCardKey = "library_scan" | "reboot" | "shutdown";

interface BaseCard {
  key: string;
  icon: typeof Database;
  title: string;
  value: string;
  meta: string;
  tone: CardTone;
}

interface ReadOnlyCard extends BaseCard {
  kind: "readonly";
}

interface ActionCard extends BaseCard {
  kind: "action";
  actionType: ActionableCardKey;
  buttonLabel: string;
  confirmLabel?: string;
}

interface FontCard extends BaseCard {
  kind: "font";
}

type SettingsCard = ReadOnlyCard | ActionCard | FontCard;

const fontChoices: Array<{ id: FontTheme; label: string; sample: string }> = [
  { id: "sans", label: "Modern Sans", sample: "Balanced UI default" },
  { id: "serif", label: "Editorial Serif", sample: "Warmer reading tone" },
  { id: "mono", label: "Mono Grid", sample: "Sharper technical look" }
];

export function QuickSettingsOverlay({
  active,
  system,
  runtime,
  status,
  fontTheme,
  onFontThemeChange,
  onSystemAction,
  onReturnAmbient
}: QuickSettingsOverlayProps) {
  const [confirmAction, setConfirmAction] = useState<ActionableCardKey | null>(null);
  const [pendingAction, setPendingAction] = useState<ActionableCardKey | null>(null);
  const [actionError, setActionError] = useState<Record<ActionableCardKey, string | null>>({
    library_scan: null,
    reboot: null,
    shutdown: null
  });

  useEffect(() => {
    if (!active) {
      setConfirmAction(null);
      setPendingAction(null);
      setActionError({
        library_scan: null,
        reboot: null,
        shutdown: null
      });
    }
  }, [active]);

  const settingsCards = useMemo<SettingsCard[]>(
    () => [
      {
        kind: "readonly",
        key: "network",
        icon: EthernetPort,
        title: "Network",
        value: system.network.label,
        meta: `${system.network.ip} - ${system.network.speed}`,
        tone: "cyan"
      },
      {
        kind: "readonly",
        key: "output",
        icon: Volume2,
        title: "Audio Output",
        value: system.outputDevice.label,
        meta: system.outputDevice.detail,
        tone: "gold"
      },
      {
        kind: "readonly",
        key: "dsp",
        icon: SlidersHorizontal,
        title: "DSP",
        value: system.dspState.enabled ? "Enabled" : "Disabled",
        meta: `Preset: ${system.dspState.preset}`,
        tone: "cyan"
      },
      {
        kind: "action",
        key: "library",
        icon: Database,
        title: "Library",
        value: system.library.source,
        meta: system.library.scanning ? "Scan in progress" : `${system.library.trackCount.toLocaleString()} tracks`,
        tone: "gold",
        actionType: "library_scan",
        buttonLabel: system.library.scanning ? "Scanning..." : "Scan library"
      },
      {
        kind: "font",
        key: "font",
        icon: Type,
        title: "Font",
        value: fontChoices.find((choice) => choice.id === fontTheme)?.label ?? "Modern Sans",
        meta: "Choose the kiosk typography",
        tone: "cyan"
      },
      {
        kind: "readonly",
        key: "display",
        icon: Monitor,
        title: "Display",
        value: runtime.kioskWindow,
        meta: system.display.controllable
          ? `Renderer: ${runtime.requestedRenderer} · Brightness ${system.display.brightnessPercent}%`
          : `Renderer: ${runtime.requestedRenderer} · Brightness unavailable`,
        tone: "neutral"
      },
      {
        kind: "readonly",
        key: "system",
        icon: Info,
        title: "System",
        value: status.source === "api" ? "Tikpal API" : "Fallback",
        meta: status.error ?? `CPU ${system.cpuTemp}C - ${system.uptime}`,
        tone: status.source === "api" ? "neutral" : "warn"
      },
      {
        kind: "action",
        key: "restart",
        icon: RotateCcw,
        title: "Restart",
        value: "Confirm Needed",
        meta: "System reboot",
        tone: "warn",
        actionType: "reboot",
        buttonLabel: "Restart system",
        confirmLabel: "Tap again to restart"
      },
      {
        kind: "action",
        key: "shutdown",
        icon: Power,
        title: "Shutdown",
        value: "Confirm Needed",
        meta: "Power off",
        tone: "danger",
        actionType: "shutdown",
        buttonLabel: "Shutdown system",
        confirmLabel: "Tap again to power off"
      }
    ],
    [fontTheme, runtime.kioskWindow, runtime.requestedRenderer, status.error, status.source, system.cpuTemp, system.display.brightnessPercent, system.display.controllable, system.dspState.enabled, system.dspState.preset, system.library.scanning, system.library.source, system.library.trackCount, system.network.ip, system.network.label, system.network.speed, system.outputDevice.detail, system.outputDevice.label, system.uptime]
  );

  async function handleAction(card: ActionCard) {
    if (pendingAction) return;

    setActionError((current) => ({
      ...current,
      [card.actionType]: null
    }));

    if (card.actionType === "reboot" || card.actionType === "shutdown") {
      if (confirmAction !== card.actionType) {
        setConfirmAction(card.actionType);
        return;
      }
    }

    setConfirmAction(null);
    setPendingAction(card.actionType);

    try {
      await onSystemAction(card.actionType);
      setActionError((current) => ({
        ...current,
        [card.actionType]: null
      }));
    } catch (error) {
      setActionError((current) => ({
        ...current,
        [card.actionType]: error instanceof Error ? error.message : "System action failed"
      }));
    } finally {
      setPendingAction(null);
    }
  }

  function handleReturnAmbient() {
    setConfirmAction(null);
    onReturnAmbient();
  }

  return (
    <section className={`overlay quick-settings ${active ? "is-active" : ""}`} aria-label="Quick settings" aria-hidden={!active}>
      <button className="overlay-backdrop" type="button" tabIndex={active ? 0 : -1} aria-label="Return to ambient" onClick={handleReturnAmbient} />
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

            if (card.kind === "readonly") {
              return (
                <article className={`settings-card tone-${card.tone}`} key={card.key}>
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
            }

            if (card.kind === "font") {
              return (
                <article className={`settings-card settings-card-font tone-${card.tone}`} key={card.key}>
                  <div className="settings-icon">
                    <Palette size={32} />
                  </div>
                  <div>
                    <span>{card.title}</span>
                    <strong>{card.value}</strong>
                    <p>{card.meta}</p>
                    <div className="font-theme-options" role="group" aria-label="Font theme">
                      {fontChoices.map((choice) => (
                        <button
                          key={choice.id}
                          className={`font-theme-option ${fontTheme === choice.id ? "is-active" : ""}`}
                          type="button"
                          onClick={() => onFontThemeChange(choice.id)}
                        >
                          <strong>{choice.label}</strong>
                          <span>{choice.sample}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </article>
              );
            }

            const isConfirming = confirmAction === card.actionType;
            const isPending = pendingAction === card.actionType;
            const error = actionError[card.actionType];
            const disabled = status.pending || pendingAction !== null;

            return (
              <button
                className={`settings-card settings-card-button tone-${card.tone} ${isConfirming ? "is-confirming" : ""} ${isPending ? "is-pending" : ""}`}
                key={card.key}
                type="button"
                disabled={disabled}
                onClick={() => void handleAction(card)}
              >
                <div className="settings-icon">
                  <Icon size={32} />
                </div>
                <div>
                  <span>{card.title}</span>
                  <strong>{card.value}</strong>
                  <p>{error ?? (isConfirming ? card.confirmLabel : card.meta)}</p>
                  <em className="settings-card-action">{isPending ? "Working..." : card.buttonLabel}</em>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

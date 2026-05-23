import { useEffect, useMemo, useState } from "react";
import { Captions, Cpu, Database, EthernetPort, Eye, EyeOff, Info, Monitor, Music2, Palette, Power, RotateCcw, SlidersHorizontal, Type, Volume2 } from "lucide-react";
import type { TikpalDataStatus } from "../hooks/useTikpalState";
import { useOverlayReturnGesture } from "../hooks/useOverlayReturnGesture";
import type { FontTheme, LyricsFontSize, RuntimeState, SurfaceTheme, SystemActionType, SystemState } from "../types";

interface QuickSettingsOverlayProps {
  active: boolean;
  system: SystemState;
  runtime: RuntimeState;
  status: TikpalDataStatus;
  fontTheme: FontTheme;
  surfaceTheme: SurfaceTheme;
  lyricsVisible: boolean;
  lyricsFontSize: LyricsFontSize;
  onFontThemeChange: (theme: FontTheme) => void;
  onSurfaceThemeChange: (theme: SurfaceTheme) => void;
  onLyricsVisibleChange: (visible: boolean) => void;
  onLyricsFontSizeChange: (size: LyricsFontSize) => void;
  onSystemAction: (type: SystemActionType, value?: number) => Promise<unknown>;
  onReturnAmbient: () => void;
}

type CardTone = "cyan" | "gold" | "neutral" | "warn" | "danger";
type ActionableCardKey = "library_scan" | "reboot" | "shutdown";
type SettingsSectionKey = "home" | "network" | "output" | "system";
type SettingsDetailView = "appearance" | "display" | "font" | "lyrics" | null;

interface BaseCard {
  key: string;
  section: SettingsSectionKey;
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

interface AppearanceCard extends BaseCard {
  kind: "appearance";
}

interface LyricsCard extends BaseCard {
  kind: "lyrics";
}

interface DisplayCard extends BaseCard {
  kind: "display";
}

type SettingsCard = ReadOnlyCard | ActionCard | FontCard | AppearanceCard | LyricsCard | DisplayCard;

const fontChoices: Array<{ id: FontTheme; label: string; sample: string }> = [
  { id: "sans", label: "Modern Sans", sample: "Balanced UI default" },
  { id: "serif", label: "Editorial Serif", sample: "Warmer reading tone" },
  { id: "mono", label: "Mono Grid", sample: "Sharper technical look" }
];

const lyricsSizeChoices: Array<{ id: LyricsFontSize; label: string; sample: string }> = [
  { id: "small", label: "Small", sample: "Low profile" },
  { id: "medium", label: "Medium", sample: "Balanced" },
  { id: "large", label: "Large", sample: "Readable distance" }
];

const surfaceThemeChoices: Array<{ id: SurfaceTheme; label: string; sample: string }> = [
  { id: "warm-gold", label: "Warm Gold", sample: "Amber glass" },
  { id: "graphite-silver", label: "Graphite Silver", sample: "Hi-Fi graphite" },
  { id: "ivory-studio", label: "Ivory Studio", sample: "Soft studio" }
];

const sectionCopy: Record<SettingsSectionKey, { label: string; description: string }> = {
  home: {
    label: "Home",
    description: "Overview-first controls across playback, display, and system status."
  },
  network: {
    label: "Network",
    description: "Connectivity, API sync state, and kiosk runtime reachability."
  },
  output: {
    label: "Output",
    description: "Playback output, DSP, display brightness, and local typography."
  },
  system: {
    label: "System",
    description: "Library maintenance plus guarded restart and shutdown actions."
  }
};

export function QuickSettingsOverlay({
  active,
  system,
  runtime,
  status,
  fontTheme,
  surfaceTheme,
  lyricsVisible,
  lyricsFontSize,
  onFontThemeChange,
  onSurfaceThemeChange,
  onLyricsVisibleChange,
  onLyricsFontSizeChange,
  onSystemAction,
  onReturnAmbient
}: QuickSettingsOverlayProps) {
  const overlayReturnGesture = useOverlayReturnGesture(onReturnAmbient);
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>("home");
  const [detailView, setDetailView] = useState<SettingsDetailView>(null);
  const [confirmAction, setConfirmAction] = useState<ActionableCardKey | null>(null);
  const [pendingAction, setPendingAction] = useState<ActionableCardKey | null>(null);
  const [pendingBrightness, setPendingBrightness] = useState<number | null>(null);
  const [actionError, setActionError] = useState<Record<ActionableCardKey, string | null>>({
    library_scan: null,
    reboot: null,
    shutdown: null
  });
  const [brightnessError, setBrightnessError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      setActiveSection("home");
      setDetailView(null);
      setConfirmAction(null);
      setPendingAction(null);
      setPendingBrightness(null);
      setActionError({
        library_scan: null,
        reboot: null,
        shutdown: null
      });
      setBrightnessError(null);
    }
  }, [active]);

  useEffect(() => {
    setConfirmAction(null);
    setDetailView(null);
  }, [activeSection]);

  const settingsCards = useMemo<SettingsCard[]>(
    () => [
      {
        kind: "readonly",
        key: "network",
        section: "network",
        icon: EthernetPort,
        title: "Network",
        value: system.network.label,
        meta: `${system.network.ip} - ${system.network.speed}`,
        tone: "cyan"
      },
      {
        kind: "readonly",
        key: "output",
        section: "output",
        icon: Volume2,
        title: "Audio Output",
        value: system.outputDevice.label,
        meta: system.outputDevice.detail,
        tone: "gold"
      },
      {
        kind: "readonly",
        key: "dsp",
        section: "output",
        icon: SlidersHorizontal,
        title: "DSP",
        value: system.dspState.enabled ? "Enabled" : "Disabled",
        meta: `Preset: ${system.dspState.preset}`,
        tone: "cyan"
      },
      {
        kind: "action",
        key: "library",
        section: "system",
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
        section: "output",
        icon: Type,
        title: "Font",
        value: fontChoices.find((choice) => choice.id === fontTheme)?.label ?? "Modern Sans",
        meta: "Choose the kiosk typography",
        tone: "cyan"
      },
      {
        kind: "appearance",
        key: "appearance",
        section: "output",
        icon: Palette,
        title: "Skin",
        value: surfaceThemeChoices.find((choice) => choice.id === surfaceTheme)?.label ?? "Warm Gold",
        meta: surfaceThemeChoices.find((choice) => choice.id === surfaceTheme)?.sample ?? "Amber glass",
        tone: "gold"
      },
      {
        kind: "lyrics",
        key: "lyrics",
        section: "output",
        icon: Captions,
        title: "Lyrics",
        value: lyricsVisible ? "Shown" : "Hidden",
        meta: `Font: ${lyricsSizeChoices.find((choice) => choice.id === lyricsFontSize)?.label ?? "Medium"}`,
        tone: lyricsVisible ? "gold" : "neutral"
      },
      {
        kind: "display",
        key: "display",
        section: "output",
        icon: Monitor,
        title: "Display",
        value: runtime.kioskWindow,
        meta: system.display.controllable
          ? `Renderer: ${runtime.requestedRenderer} · Live brightness ready`
          : `Renderer: ${runtime.requestedRenderer} · DDC/CI unavailable`,
        tone: "neutral"
      },
      {
        kind: "readonly",
        key: "system",
        section: "network",
        icon: Info,
        title: "System",
        value: status.source === "api" ? "Tikpal API" : "Fallback",
        meta: status.error ?? `CPU ${system.cpuTemp}C - ${system.uptime}`,
        tone: status.source === "api" ? "neutral" : "warn"
      },
      {
        kind: "action",
        key: "restart",
        section: "system",
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
        section: "system",
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
    [fontTheme, lyricsFontSize, lyricsVisible, runtime.kioskWindow, runtime.requestedRenderer, status.error, status.source, surfaceTheme, system.cpuTemp, system.display.brightnessPercent, system.display.controllable, system.dspState.enabled, system.dspState.preset, system.library.scanning, system.library.source, system.library.trackCount, system.network.ip, system.network.label, system.network.speed, system.outputDevice.detail, system.outputDevice.label, system.uptime]
  );

  const visibleCards = useMemo(() => {
    if (activeSection === "home") {
      return settingsCards.filter((card) => ["network", "output", "display", "lyrics", "library", "system", "font", "appearance"].includes(card.key));
    }
    return settingsCards.filter((card) => card.section === activeSection);
  }, [activeSection, settingsCards]);

  async function handleBrightnessAdjust(nextPercent: number) {
    if (pendingAction || pendingBrightness !== null || !system.display.controllable) return;
    const clampedPercent = Math.max(0, Math.min(100, Math.round(nextPercent)));
    if (clampedPercent === system.display.brightnessPercent) return;

    setBrightnessError(null);
    setPendingBrightness(clampedPercent);

    try {
      await onSystemAction("brightness_set", clampedPercent);
      setBrightnessError(null);
    } catch (error) {
      setBrightnessError(error instanceof Error ? error.message : "Brightness update failed");
    } finally {
      setPendingBrightness(null);
    }
  }

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
    setDetailView(null);
    onReturnAmbient();
  }

  function openDetail(nextDetail: Exclude<SettingsDetailView, null>) {
    setDetailView(nextDetail);
    setConfirmAction(null);
  }

  function renderAppearanceDetail() {
    return (
      <section className="settings-detail-panel" aria-label="Skin detail" data-settings-detail="appearance">
        <div className="settings-detail-header">
          <button className="settings-detail-back" type="button" onClick={() => setDetailView(null)}>
            Back
          </button>
          <div>
            <span>Output</span>
            <strong>Skin Presets</strong>
            <p>Switch the glass shell, cards, and controls as one surface.</p>
          </div>
        </div>

        <div className="surface-theme-options" role="group" aria-label="Surface skin">
          {surfaceThemeChoices.map((choice) => (
            <button
              key={choice.id}
              className={`surface-theme-option surface-theme-option-${choice.id} ${surfaceTheme === choice.id ? "is-active" : ""}`}
              type="button"
              onClick={() => onSurfaceThemeChange(choice.id)}
            >
              <span className="surface-theme-swatch" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <strong>{choice.label}</strong>
              <span>{choice.sample}</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  function renderFontDetail() {
    return (
      <section className="settings-detail-panel" aria-label="Font detail" data-settings-detail="font">
        <div className="settings-detail-header">
          <button className="settings-detail-back" type="button" onClick={() => setDetailView(null)}>
            Back
          </button>
          <div>
            <span>Output</span>
            <strong>Font Presets</strong>
            <p>Choose the kiosk typography without expanding the overview dashboard.</p>
          </div>
        </div>

        <div className="font-theme-options font-theme-options-detail" role="group" aria-label="Font theme">
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
      </section>
    );
  }

  function renderLyricsDetail() {
    return (
      <section className="settings-detail-panel" aria-label="Lyrics detail" data-settings-detail="lyrics">
        <div className="settings-detail-header">
          <button className="settings-detail-back" type="button" onClick={() => setDetailView(null)}>
            Back
          </button>
          <div>
            <span>Output</span>
            <strong>Lyrics</strong>
            <p>{lyricsVisible ? "Ambient lyrics visible" : "Ambient lyrics hidden"}</p>
          </div>
        </div>

        <div className="lyrics-settings-panel lyrics-settings-panel-detail">
          <button
            className={`lyrics-visibility-toggle ${lyricsVisible ? "is-active" : ""}`}
            type="button"
            aria-pressed={lyricsVisible}
            onClick={() => onLyricsVisibleChange(!lyricsVisible)}
          >
            <span className="lyrics-visibility-icon">
              {lyricsVisible ? <Eye size={28} /> : <EyeOff size={28} />}
            </span>
            <span>
              <strong>{lyricsVisible ? "Show Lyrics" : "Hide Lyrics"}</strong>
              <em>{lyricsVisible ? "Visible on Ambient" : "Hidden on Ambient"}</em>
            </span>
            <i>{lyricsVisible ? "On" : "Off"}</i>
          </button>

          <div className="lyrics-size-options" role="group" aria-label="Lyrics font size">
            {lyricsSizeChoices.map((choice) => (
              <button
                key={choice.id}
                className={`lyrics-size-option lyrics-size-option-${choice.id} ${lyricsFontSize === choice.id ? "is-active" : ""}`}
                type="button"
                aria-pressed={lyricsFontSize === choice.id}
                onClick={() => onLyricsFontSizeChange(choice.id)}
              >
                <strong>{choice.label}</strong>
                <span>{choice.sample}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    );
  }

  function renderDisplayDetail() {
    const brightnessPercent = pendingBrightness ?? system.display.brightnessPercent;
    const brightnessBusy = pendingBrightness !== null;
    const brightnessDisabled = !system.display.controllable || pendingAction !== null || brightnessBusy;
    const quickLevels = [25, 50, 75, 100];

    return (
      <section className="settings-detail-panel" aria-label="Display detail" data-settings-detail="display">
        <div className="settings-detail-header">
          <button className="settings-detail-back" type="button" onClick={() => setDetailView(null)}>
            Back
          </button>
          <div>
            <span>Output</span>
            <strong>Display Brightness</strong>
            <p>{brightnessError ?? (system.display.controllable ? "Live display brightness control" : "Brightness control unavailable on this display")}</p>
          </div>
        </div>

        <div className="display-brightness-panel display-brightness-panel-detail">
          <div className="display-brightness-header">
            <strong>{brightnessPercent}% Brightness</strong>
            <em>{system.display.transport === "ddcci" ? "DDC/CI" : system.display.transport}</em>
          </div>
          <div className="display-brightness-bar" aria-hidden="true">
            <span style={{ width: `${brightnessPercent}%` }} />
          </div>
          <div className="display-brightness-controls" role="group" aria-label="Display brightness controls">
            <button
              className="display-brightness-step"
              type="button"
              disabled={brightnessDisabled || brightnessPercent <= 0}
              onClick={() => void handleBrightnessAdjust(brightnessPercent - 10)}
            >
              Dim -10
            </button>
            <button
              className="display-brightness-step"
              type="button"
              disabled={brightnessDisabled || brightnessPercent >= 100}
              onClick={() => void handleBrightnessAdjust(brightnessPercent + 10)}
            >
              Boost +10
            </button>
          </div>
          <div className="display-brightness-presets" role="group" aria-label="Display brightness presets">
            {quickLevels.map((level) => (
              <button
                key={level}
                className={`display-brightness-preset ${brightnessPercent === level ? "is-active" : ""}`}
                type="button"
                disabled={brightnessDisabled}
                onClick={() => void handleBrightnessAdjust(level)}
              >
                {level}%
              </button>
            ))}
          </div>
          <em className="settings-card-action">
            {system.display.controllable
              ? brightnessBusy
                ? `Applying ${brightnessPercent}%...`
                : "Dedicated display control panel"
              : "This display does not expose DDC/CI brightness control"}
          </em>
        </div>
      </section>
    );
  }

  return (
    <section className={`overlay quick-settings ${active ? "is-active" : ""}`} aria-label="Quick settings" aria-hidden={!active}>
      <button className="overlay-backdrop" type="button" tabIndex={active ? 0 : -1} aria-label="Return to ambient" onClick={handleReturnAmbient} />
      <div className="settings-shell" role="dialog" aria-modal="true" data-gesture-protected {...overlayReturnGesture}>
        <aside className="settings-nav" aria-label="Settings sections">
          <button className={`settings-nav-item ${activeSection === "home" ? "is-active" : ""}`} type="button" onClick={() => setActiveSection("home")}>
            <Music2 size={24} />
            <span>Home</span>
          </button>
          <button className={`settings-nav-item ${activeSection === "network" ? "is-active" : ""}`} type="button" onClick={() => setActiveSection("network")}>
            <EthernetPort size={24} />
            <span>Network</span>
          </button>
          <button className={`settings-nav-item ${activeSection === "output" ? "is-active" : ""}`} type="button" onClick={() => setActiveSection("output")}>
            <Volume2 size={24} />
            <span>Output</span>
          </button>
          <button className={`settings-nav-item ${activeSection === "system" ? "is-active" : ""}`} type="button" onClick={() => setActiveSection("system")}>
            <Cpu size={24} />
            <span>System</span>
          </button>
        </aside>

        <div className="settings-content">
          <header className="settings-section-header">
            <span>{sectionCopy[activeSection].label}</span>
            <strong>{sectionCopy[activeSection].description}</strong>
          </header>

          {detailView === "appearance"
            ? renderAppearanceDetail()
            : detailView === "display"
            ? renderDisplayDetail()
            : detailView === "font"
              ? renderFontDetail()
              : detailView === "lyrics"
                ? renderLyricsDetail()
              : (
          <div className="settings-grid" data-settings-section={activeSection}>
            {visibleCards.map((card) => {
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
                  <button
                    className={`settings-card settings-card-button settings-card-summary settings-card-font tone-${card.tone}`}
                    key={card.key}
                    type="button"
                    onClick={() => openDetail("font")}
                  >
                    <div className="settings-icon">
                      <Type size={32} />
                    </div>
                    <div>
                      <span>{card.title}</span>
                      <strong>{card.value}</strong>
                      <p>{card.meta}</p>
                      <em className="settings-card-action">Open font presets</em>
                    </div>
                  </button>
                );
              }

              if (card.kind === "appearance") {
                return (
                  <button
                    className={`settings-card settings-card-button settings-card-summary settings-card-appearance tone-${card.tone}`}
                    key={card.key}
                    type="button"
                    onClick={() => openDetail("appearance")}
                  >
                    <div className="settings-icon">
                      <Palette size={32} />
                    </div>
                    <div>
                      <span>{card.title}</span>
                      <strong>{card.value}</strong>
                      <p>{card.meta}</p>
                      <em className="settings-card-action">Open skin presets</em>
                    </div>
                  </button>
                );
              }

              if (card.kind === "lyrics") {
                return (
                  <button
                    className={`settings-card settings-card-button settings-card-summary settings-card-lyrics tone-${card.tone}`}
                    key={card.key}
                    type="button"
                    onClick={() => openDetail("lyrics")}
                  >
                    <div className="settings-icon">
                      <Captions size={32} />
                    </div>
                    <div>
                      <span>{card.title}</span>
                      <strong>{card.value}</strong>
                      <p>{card.meta}</p>
                      <em className="settings-card-action">Open lyric settings</em>
                    </div>
                  </button>
                );
              }

              if (card.kind === "display") {
                return (
                  <button
                    className={`settings-card settings-card-button settings-card-summary settings-card-display tone-${card.tone}`}
                    key={card.key}
                    type="button"
                    onClick={() => openDetail("display")}
                  >
                    <div className="settings-icon">
                      <Icon size={32} />
                    </div>
                    <div>
                      <span>{card.title}</span>
                      <strong>{card.value}</strong>
                      <p>{card.meta}</p>
                      <em className="settings-card-action">
                        {system.display.controllable
                          ? `${system.display.brightnessPercent}% brightness`
                          : "Open display status"}
                      </em>
                    </div>
                  </button>
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
              )}
        </div>
      </div>
    </section>
  );
}

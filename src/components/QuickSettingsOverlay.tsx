import { useEffect, useMemo, useState } from "react";
import { Airplay, Bluetooth, Captions, Cast, Clock3, Cpu, Database, EthernetPort, Eye, EyeOff, Globe2, HardDrive, Info, Monitor, Moon, Music2, Palette, Power, Radio as RadioIcon, RotateCcw, Server, SlidersHorizontal, Target, Type, Usb, Volume2, Waves } from "lucide-react";
import { fetchWebModeState, sendWebModeAction, updateWebModeSettings } from "../api/tikpalClient";
import type { TikpalDataStatus } from "../hooks/useTikpalState";
import { useOverlayReturnGesture } from "../hooks/useOverlayReturnGesture";
import type { AudioState, FontTheme, LyricsFontSize, NightScheduleState, PlaybackSummary, RoomExperienceActionRequest, RoomExperienceState, RoomMode, RuntimeState, SurfaceTheme, SystemActionType, SystemState, WebModeState } from "../types";

interface QuickSettingsOverlayProps {
  active: boolean;
  audio: AudioState;
  playback: PlaybackSummary;
  system: SystemState;
  runtime: RuntimeState;
  status: TikpalDataStatus;
  fontTheme: FontTheme;
  surfaceTheme: SurfaceTheme;
  lyricsVisible: boolean;
  lyricsFontSize: LyricsFontSize;
  roomExperience: RoomExperienceState;
  onFontThemeChange: (theme: FontTheme) => void;
  onSurfaceThemeChange: (theme: SurfaceTheme) => void;
  onLyricsVisibleChange: (visible: boolean) => void;
  onLyricsFontSizeChange: (size: LyricsFontSize) => void;
  onExperienceAction: (action: RoomExperienceActionRequest) => Promise<RoomExperienceState>;
  onOpenWebMode: () => Promise<void>;
  onSystemAction: (type: SystemActionType, value?: number) => Promise<unknown>;
  onReturnAmbient: () => void;
}

type CardTone = "cyan" | "gold" | "neutral" | "warn" | "danger";
type ActionableCardKey = "library_scan" | "reboot" | "shutdown";
type SettingsSectionKey = "output" | "library" | "network" | "system";
type SettingsDetailView = "appearance" | "display" | "font" | "lyrics" | "nas" | "night" | "webMode" | null;

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

interface NightCard extends BaseCard {
  kind: "night";
}

interface NasCard extends BaseCard {
  kind: "nas";
}

interface WebModeCard extends BaseCard {
  kind: "webMode";
}

type SettingsCard = ReadOnlyCard | ActionCard | FontCard | AppearanceCard | LyricsCard | DisplayCard | NightCard | NasCard | WebModeCard;

const fontChoices: Array<{ id: FontTheme; label: string; sample: string }> = [
  { id: "system", label: "System Neo", sample: "Clean device UI" },
  { id: "hardware", label: "Hardware UI", sample: "Modern equipment feel" },
  { id: "precision", label: "Precision Mono", sample: "Technical but quiet" },
  { id: "sans", label: "Modern Sans", sample: "Balanced UI default" },
  { id: "mono", label: "Mono Grid", sample: "Sharper technical look" },
  { id: "serif", label: "Editorial Serif", sample: "Warmer reading tone" }
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

const timeZoneChoices = [
  "Asia/Shanghai",
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC"
];

const sectionCopy: Record<SettingsSectionKey, { label: string; description: string }> = {
  output: {
    label: "Preferences",
    description: "Output path, DSP, display, typography, and listening overlays."
  },
  library: {
    label: "Library",
    description: "Storage health, NAS status, USB readiness, and library scanning."
  },
  network: {
    label: "Link",
    description: "Connectivity, API sync state, and kiosk runtime reachability."
  },
  system: {
    label: "Care",
    description: "Guarded restart and shutdown actions."
  }
};

const settingsTabs: Array<{ id: SettingsSectionKey; label: string; Icon: typeof Database }> = [
  { id: "output", label: "Preferences", Icon: Volume2 },
  { id: "library", label: "Library", Icon: Database },
  { id: "network", label: "Link", Icon: EthernetPort },
  { id: "system", label: "Care", Icon: Cpu }
];
const roomShortcuts: Array<{ id: RoomMode | "explore"; label: string; Icon: typeof Target }> = [
  { id: "focus", label: "Focus", Icon: Target },
  { id: "calm", label: "Calm", Icon: Waves },
  { id: "sleep", label: "Sleep", Icon: Moon },
  { id: "hifi", label: "Hi-Fi", Icon: SlidersHorizontal },
  { id: "explore", label: "Explore", Icon: Globe2 }
];
const localKioskHosts = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeProxyUrl(value: string) {
  try {
    const parsed = new URL(value.trim());
    if (!["http:", "https:", "socks5:"].includes(parsed.protocol) || !parsed.hostname || !parsed.port) return null;
    parsed.username = "";
    parsed.password = "";
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function hideLocalKeyboard() {
  if (!localKioskHosts.has(window.location.hostname) || window.__TIKPAL_REMOTE_MODE__) return;
  window.dispatchEvent(new Event("tikpal:keyboard-context-clear"));
  void sendWebModeAction({ type: "keyboard", enabled: false }).catch(() => undefined);
}

function getConsoleSourceIcon(sourceId: AudioState["currentSource"]["id"]) {
  if (sourceId === "airplay") return Airplay;
  if (sourceId === "bluetooth") return Bluetooth;
  if (sourceId === "radio") return RadioIcon;
  if (sourceId === "spotify" || sourceId === "upnp") return Cast;
  return Music2;
}

function getConsoleStateLabel(playback: PlaybackSummary, source: AudioState["currentSource"]) {
  if (playback.state === "playing") return "Playing";
  if (playback.state === "paused") return "Paused";
  if (source.connectionState === "connected") return "Connected";
  if (source.connectionState === "armed") return "Ready";
  if (source.connectionState === "blocked") return "Blocked";
  return "Stopped";
}

function getConsoleStateClass(playback: PlaybackSummary, source: AudioState["currentSource"]) {
  if (playback.state === "playing") return "is-playing";
  if (playback.state === "paused") return "is-paused";
  if (source.connectionState === "armed" || source.connectionState === "connected") return "is-ready";
  return "is-stopped";
}

export function QuickSettingsOverlay({
  active,
  audio,
  playback,
  system,
  runtime,
  status,
  fontTheme,
  surfaceTheme,
  lyricsVisible,
  lyricsFontSize,
  roomExperience,
  onFontThemeChange,
  onSurfaceThemeChange,
  onLyricsVisibleChange,
  onLyricsFontSizeChange,
  onExperienceAction,
  onOpenWebMode,
  onSystemAction,
  onReturnAmbient
}: QuickSettingsOverlayProps) {
  const overlayReturnGesture = useOverlayReturnGesture(onReturnAmbient);
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>("output");
  const [detailView, setDetailView] = useState<SettingsDetailView>(null);
  const [confirmAction, setConfirmAction] = useState<ActionableCardKey | null>(null);
  const [pendingAction, setPendingAction] = useState<ActionableCardKey | null>(null);
  const [pendingBrightness, setPendingBrightness] = useState<number | null>(null);
  const [pendingNight, setPendingNight] = useState(false);
  const [webModeState, setWebModeState] = useState<WebModeState | null>(null);
  const [webModeProxyEnabled, setWebModeProxyEnabled] = useState(true);
  const [webModeProxyUrl, setWebModeProxyUrl] = useState("");
  const [webModeError, setWebModeError] = useState<string | null>(null);
  const [pendingRoomShortcut, setPendingRoomShortcut] = useState<RoomMode | "explore" | null>(null);
  const [roomShortcutError, setRoomShortcutError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Record<ActionableCardKey, string | null>>({
    library_scan: null,
    reboot: null,
    shutdown: null
  });
  const [brightnessError, setBrightnessError] = useState<string | null>(null);
  const [nightError, setNightError] = useState<string | null>(null);
  const currentSource = audio.currentSource;
  const ConsoleSourceIcon = getConsoleSourceIcon(currentSource.id);
  const consoleStateLabel = getConsoleStateLabel(playback, currentSource);
  const consoleStateClass = getConsoleStateClass(playback, currentSource);
  const consoleTitle = playback.title?.trim()
    || currentSource.connectedLabel
    || currentSource.advertisedLabel
    || currentSource.secondaryStatus
    || currentSource.label;
  const consoleSubtitle = [
    playback.artist?.trim() || playback.album?.trim() || currentSource.secondaryStatus || currentSource.label,
    `${currentSource.label} ${consoleStateLabel}`
  ].filter(Boolean).join(" · ");
  useEffect(() => {
    if (!active) {
      hideLocalKeyboard();
      setActiveSection("output");
      setDetailView(null);
      setConfirmAction(null);
      setPendingAction(null);
      setPendingBrightness(null);
      setPendingNight(false);
      setActionError({
        library_scan: null,
        reboot: null,
        shutdown: null
      });
      setBrightnessError(null);
      setNightError(null);
      setWebModeError(null);
      setPendingRoomShortcut(null);
      setRoomShortcutError(null);
    }
  }, [active]);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    void fetchWebModeState()
      .then((nextState) => {
        if (cancelled) return;
        setWebModeState(nextState);
        setWebModeProxyEnabled(nextState.settings.proxyEnabled);
        setWebModeProxyUrl(nextState.settings.proxyUrl);
      })
      .catch((error) => {
        if (!cancelled) setWebModeError(error instanceof Error ? error.message : "Explore settings unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  useEffect(() => {
    if (!active || !webModeState) return undefined;

    const normalizedProxyUrl = normalizeProxyUrl(webModeProxyUrl);
    const enabledChanged = webModeProxyEnabled !== webModeState.settings.proxyEnabled;
    const proxyUrlChanged = normalizedProxyUrl !== null && normalizedProxyUrl !== webModeState.settings.proxyUrl;

    if (webModeProxyEnabled && normalizedProxyUrl === null) {
      setWebModeError("Enter a complete proxy URL");
      return undefined;
    }
    if (!enabledChanged && !proxyUrlChanged) {
      setWebModeError((current) => current === "Enter a complete proxy URL" || current === "Saving..." ? null : current);
      return undefined;
    }

    let cancelled = false;
    setWebModeError("Saving...");
    const timer = window.setTimeout(() => {
      void updateWebModeSettings({
        proxyEnabled: webModeProxyEnabled,
        ...(normalizedProxyUrl === null ? {} : { proxyUrl: normalizedProxyUrl })
      })
        .then((nextState) => {
          if (cancelled) return;
          setWebModeState(nextState);
          setWebModeError("Saved automatically");
        })
        .catch((error) => {
          if (!cancelled) setWebModeError(error instanceof Error ? error.message : "Explore settings save failed");
        });
    }, 700);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, webModeProxyEnabled, webModeProxyUrl, webModeState]);

  const librarySourceKind = system.library.source.trim().toLowerCase();
  const libraryTrackCount = Math.max(0, system.library.trackCount);
  const localTrackCount = librarySourceKind === "nas" || librarySourceKind === "usb" ? 0 : libraryTrackCount;
  const nasTrackCount = librarySourceKind === "nas" ? libraryTrackCount : 0;
  const usbTrackCount = librarySourceKind === "usb" ? libraryTrackCount : 0;
  const nasCardTone: CardTone = nasTrackCount > 0 ? "cyan" : "neutral";
  const nasCardValue = nasTrackCount > 0 ? "Mounted" : "Remote Admin";
  const nasCardMeta = nasTrackCount > 0
    ? `${nasTrackCount.toLocaleString()} tracks · ${system.library.lastScan}`
    : "SMB/NFS setup stays outside kiosk";

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
        value: system.dspState.controllable ? "EQ Ready" : system.dspState.enabled ? "Enabled" : "Disabled",
        meta: `${system.dspState.presetLabel} · ${system.dspState.controlTransport}`,
        tone: "cyan"
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
        kind: "night",
        key: "night",
        section: "output",
        icon: Clock3,
        title: "Time & Night",
        value: roomExperience.nightSchedule.active ? "Night" : roomExperience.nightSchedule.enabled ? "Auto" : "Manual",
        meta: `${roomExperience.nightSchedule.timeZone} · ${roomExperience.nightSchedule.start}-${roomExperience.nightSchedule.end}`,
        tone: roomExperience.nightSchedule.active ? "cyan" : "neutral"
      },
      {
        kind: "readonly",
        key: "local-library",
        section: "library",
        icon: HardDrive,
        title: "Local Library",
        value: `${localTrackCount.toLocaleString()} tracks`,
        meta: "Manifest-backed music",
        tone: "gold"
      },
      {
        kind: "nas",
        key: "nas-sources",
        section: "library",
        icon: Server,
        title: "NAS Sources",
        value: nasCardValue,
        meta: nasCardMeta,
        tone: nasCardTone
      },
      {
        kind: "readonly",
        key: "usb-library",
        section: "library",
        icon: Usb,
        title: "USB",
        value: usbTrackCount > 0 ? `${usbTrackCount.toLocaleString()} tracks` : "Not mounted",
        meta: "Portable storage",
        tone: "neutral"
      },
      {
        kind: "action",
        key: "library",
        section: "library",
        icon: Database,
        title: "Library Scan",
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
        value: fontChoices.find((choice) => choice.id === fontTheme)?.label ?? "System Neo",
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
        kind: "webMode",
        key: "web-mode",
        section: "network",
        icon: Globe2,
        title: "Explore",
        value: webModeProxyEnabled ? "HTTP Proxy" : "Direct",
        meta: webModeProxyEnabled ? webModeProxyUrl : "Official web players",
        tone: webModeProxyEnabled ? "cyan" : "neutral"
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
    [fontTheme, localTrackCount, lyricsFontSize, lyricsVisible, nasCardMeta, nasCardTone, nasCardValue, roomExperience.nightSchedule.active, roomExperience.nightSchedule.enabled, roomExperience.nightSchedule.end, roomExperience.nightSchedule.start, roomExperience.nightSchedule.timeZone, runtime.kioskWindow, runtime.requestedRenderer, status.error, status.source, surfaceTheme, system.cpuTemp, system.display.brightnessPercent, system.display.controllable, system.dspState.controllable, system.dspState.controlTransport, system.dspState.enabled, system.dspState.presetLabel, system.library.scanning, system.library.source, system.library.trackCount, system.network.ip, system.network.label, system.network.speed, system.outputDevice.detail, system.outputDevice.label, system.uptime, usbTrackCount, webModeProxyEnabled, webModeProxyUrl]
  );

  const visibleCards = useMemo(() => {
    return settingsCards.filter((card) => card.section === activeSection);
  }, [activeSection, settingsCards]);

  function handleSectionSelect(section: SettingsSectionKey) {
    setConfirmAction(null);
    setDetailView(null);
    setActiveSection(section);
  }

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

  async function handleNightScheduleChange(patch: Partial<NightScheduleState>) {
    if (pendingNight) return;
    setPendingNight(true);
    setNightError(null);

    try {
      await onExperienceAction({
        type: "update_night_schedule",
        nightSchedule: {
          ...roomExperience.nightSchedule,
          ...patch
        }
      });
    } catch (error) {
      setNightError(error instanceof Error ? error.message : "Night schedule update failed");
    } finally {
      setPendingNight(false);
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

  async function handleRoomShortcut(destination: RoomMode | "explore") {
    if (pendingRoomShortcut) return;
    setRoomShortcutError(null);

    if (destination !== "explore" && destination === roomExperience.mode) {
      handleReturnAmbient();
      return;
    }

    setPendingRoomShortcut(destination);
    try {
      if (destination === "explore") {
        await onOpenWebMode();
      } else {
        await onExperienceAction({ type: "set_mode", mode: destination });
        handleReturnAmbient();
      }
    } catch (error) {
      setRoomShortcutError(error instanceof Error ? error.message : "Room switch failed");
    } finally {
      setPendingRoomShortcut(null);
    }
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
            <span>Preferences</span>
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
            <span>Preferences</span>
            <strong>Font Presets</strong>
            <p>Choose the kiosk typography for this surface.</p>
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
            <span>Preferences</span>
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

  function renderNasDetail() {
    const hasNas = nasTrackCount > 0;
    const sourceStatus = hasNas
      ? `${nasTrackCount.toLocaleString()} tracks · Last scan ${system.library.lastScan}`
      : "Add or edit SMB/NFS shares from remote admin";

    return (
      <section className="settings-detail-panel" aria-label="NAS sources detail" data-settings-detail="nas">
        <div className="settings-detail-header">
          <button className="settings-detail-back" type="button" onClick={() => setDetailView(null)}>
            Back
          </button>
          <div>
            <span>Library</span>
            <strong>NAS Sources</strong>
            <p>{sourceStatus}</p>
          </div>
        </div>

        <div className="nas-source-detail">
          <article className={`nas-source-card tone-${hasNas ? "cyan" : "neutral"}`}>
            <div className="settings-icon">
              <Server size={32} />
            </div>
            <div className="nas-source-copy">
              <span>{hasNas ? "Detected NAS" : "Remote Admin"}</span>
              <strong>{hasNas ? system.library.source : "No NAS configured"}</strong>
              <p>{hasNas ? "Current MPD library source" : "Kiosk shows health only; credentials and mounts belong in remote/admin."}</p>
              <dl>
                <div>
                  <dt>Status</dt>
                  <dd>{hasNas ? "mounted" : "not configured"}</dd>
                </div>
                <div>
                  <dt>Tracks</dt>
                  <dd>{nasTrackCount.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Last Scan</dt>
                  <dd>{system.library.lastScan}</dd>
                </div>
              </dl>
            </div>
          </article>

          <article className="nas-source-card tone-neutral">
            <div className="settings-icon">
              <Info size={32} />
            </div>
            <div className="nas-source-copy">
              <span>Boundary</span>
              <strong>Console stays lightweight</strong>
              <p>Use Library Scan here for maintenance. Add, edit, credentials, SMB/NFS options, and logs stay out of this kiosk surface.</p>
            </div>
          </article>
        </div>
      </section>
    );
  }

  function renderWebModeDetail() {
    const statusText = webModeError
      ?? (webModeState?.settings.proxyEnabled ? webModeState.settings.proxyUrl : "Direct browser access");

    return (
      <section className="settings-detail-panel" aria-label="Explore detail" data-settings-detail="web-mode">
        <div className="settings-detail-header">
          <button className="settings-detail-back" type="button" onClick={() => setDetailView(null)}>
            Back
          </button>
          <div>
            <span>Link</span>
            <strong>Explore</strong>
            <p>{statusText}</p>
          </div>
        </div>

        <div className="web-mode-settings-panel">
          <button
            className={`night-toggle ${webModeProxyEnabled ? "is-active" : ""}`}
            type="button"
            aria-pressed={webModeProxyEnabled}
            onClick={() => setWebModeProxyEnabled((enabled) => !enabled)}
          >
            <Globe2 size={26} />
            <span>
              <strong>Web Proxy</strong>
              <em>{webModeProxyEnabled ? "HTTP proxy enabled" : "Direct"}</em>
            </span>
          </button>

          <label className="night-field web-mode-proxy-field">
            <span>Proxy URL</span>
            <input
              type="url"
              value={webModeProxyUrl}
              inputMode="url"
              spellCheck={false}
              onChange={(event) => setWebModeProxyUrl(event.currentTarget.value)}
            />
          </label>

          <p className="web-mode-settings-help">Saves automatically. If a provider won’t open, toggle Web Proxy and retry.</p>
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
            <span>Preferences</span>
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

  function renderNightDetail() {
    const schedule = roomExperience.nightSchedule;
    const zones = timeZoneChoices.includes(schedule.timeZone)
      ? timeZoneChoices
      : [schedule.timeZone, ...timeZoneChoices];
    const brightnessLevels = [5, 10, 20, 35];

    return (
      <section className="settings-detail-panel" aria-label="Time and Night detail" data-settings-detail="night">
        <div className="settings-detail-header">
          <button className="settings-detail-back" type="button" onClick={() => setDetailView(null)}>
            Back
          </button>
          <div>
            <span>Preferences</span>
            <strong>Time & Night</strong>
            <p>{nightError ?? `${schedule.timeZone} · ${schedule.active ? "Night active" : "Day mode"}`}</p>
          </div>
        </div>

        <div className="night-settings-panel">
          <button
            className={`night-toggle ${schedule.enabled ? "is-active" : ""}`}
            type="button"
            aria-pressed={schedule.enabled}
            disabled={pendingNight}
            onClick={() => void handleNightScheduleChange({ enabled: !schedule.enabled })}
          >
            <Clock3 size={26} />
            <span>
              <strong>Auto Night</strong>
              <em>{schedule.enabled ? "On" : "Off"}</em>
            </span>
          </button>

          <label className="night-field">
            <span>Time Zone</span>
            <select
              value={schedule.timeZone}
              disabled={pendingNight}
              onChange={(event) => void handleNightScheduleChange({ timeZone: event.currentTarget.value })}
            >
              {zones.map((zone) => (
                <option key={zone} value={zone}>{zone}</option>
              ))}
            </select>
          </label>

          <div className="night-time-fields">
            <label className="night-field">
              <span>Start</span>
              <input
                type="time"
                value={schedule.start}
                disabled={pendingNight}
                onChange={(event) => void handleNightScheduleChange({ start: event.currentTarget.value })}
              />
            </label>
            <label className="night-field">
              <span>End</span>
              <input
                type="time"
                value={schedule.end}
                disabled={pendingNight}
                onChange={(event) => void handleNightScheduleChange({ end: event.currentTarget.value })}
              />
            </label>
          </div>

          <div className="display-brightness-presets night-brightness-presets" role="group" aria-label="Night brightness presets">
            {brightnessLevels.map((level) => (
              <button
                key={level}
                className={`display-brightness-preset ${schedule.brightnessPercent === level ? "is-active" : ""}`}
                type="button"
                disabled={pendingNight}
                onClick={() => void handleNightScheduleChange({ brightnessPercent: level })}
              >
                {level}%
              </button>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`overlay quick-settings ${active ? "is-active" : ""}`} aria-label="Console" aria-hidden={!active}>
      <button className="overlay-backdrop" type="button" tabIndex={active ? 0 : -1} aria-label="Return to ambient" onClick={handleReturnAmbient} />
      <div className="settings-shell" role="dialog" aria-modal="true" data-gesture-protected {...overlayReturnGesture}>
        <header
          className="console-hero"
          data-console-source={currentSource.id}
          data-console-playback={playback.state}
          data-console-connection={currentSource.connectionState}
        >
          <div className="console-title-block">
            <i className={`console-status-dot ${consoleStateClass}`} aria-hidden="true" />
            <div>
              <span>Console</span>
              <strong>{sectionCopy[activeSection].label}</strong>
            </div>
          </div>

          <div className="console-now-playing" data-console-now-playing>
            <div className="console-source-art">
              {playback.albumArtUrl ? <img src={playback.albumArtUrl} alt="" /> : <ConsoleSourceIcon size={30} strokeWidth={1.8} />}
            </div>
            <div>
              <span>{currentSource.label} · {consoleStateLabel}</span>
              <strong>{consoleTitle}</strong>
              <p>{consoleSubtitle}</p>
            </div>
          </div>

          <div className="console-room-switcher" aria-label="Room shortcuts">
            <div className="console-room-switcher-buttons" role="group" aria-label="Choose room state">
              {roomShortcuts.map((shortcut) => {
                const Icon = shortcut.Icon;
                const activeShortcut = shortcut.id === "explore"
                  ? Boolean(webModeState?.activeProvider)
                  : roomExperience.mode === shortcut.id;
                const pendingShortcut = pendingRoomShortcut === shortcut.id;
                return (
                  <button
                    className={`console-room-shortcut ${activeShortcut ? "is-active" : ""}`}
                    data-room-shortcut={shortcut.id}
                    key={shortcut.id}
                    type="button"
                    aria-pressed={activeShortcut}
                    disabled={pendingRoomShortcut !== null}
                    onClick={() => void handleRoomShortcut(shortcut.id)}
                  >
                    <Icon size={18} strokeWidth={1.8} />
                    <span>{pendingShortcut ? shortcut.id === "explore" ? "Opening" : "Switching" : shortcut.label}</span>
                  </button>
                );
              })}
            </div>
            <span className="console-room-switcher-error" role="alert">{roomShortcutError ?? ""}</span>
          </div>
        </header>

        <nav className="settings-top-tabs" aria-label="Console sections">
          {settingsTabs.map((tab) => {
            const Icon = tab.Icon;
            const selected = activeSection === tab.id;
            return (
              <button
                key={tab.id}
                className={`settings-top-tab ${selected ? "is-active" : ""}`}
                type="button"
                aria-pressed={selected}
                data-settings-tab={tab.id}
                onPointerDown={() => handleSectionSelect(tab.id)}
                onClick={() => handleSectionSelect(tab.id)}
              >
                <Icon size={21} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

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
              : detailView === "nas"
                  ? renderNasDetail()
                : detailView === "night"
                  ? renderNightDetail()
                  : detailView === "webMode"
                    ? renderWebModeDetail()
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
                      <em className="settings-card-action">Adjust type</em>
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
                      <em className="settings-card-action">Switch skin</em>
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
                      <em className="settings-card-action">Tune lyrics</em>
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
                          : "Display status"}
                      </em>
                    </div>
                  </button>
                );
              }

              if (card.kind === "night") {
                return (
                  <button
                    className={`settings-card settings-card-button settings-card-summary settings-card-night tone-${card.tone}`}
                    key={card.key}
                    type="button"
                    onClick={() => openDetail("night")}
                  >
                    <div className="settings-icon">
                      <Clock3 size={32} />
                    </div>
                    <div>
                      <span>{card.title}</span>
                      <strong>{card.value}</strong>
                      <p>{card.meta}</p>
                      <em className="settings-card-action">{roomExperience.nightSchedule.brightnessPercent}% night brightness</em>
                    </div>
                  </button>
                );
              }

              if (card.kind === "nas") {
                return (
                  <button
                    className={`settings-card settings-card-button settings-card-summary settings-card-nas tone-${card.tone}`}
                    key={card.key}
                    type="button"
                    onClick={() => openDetail("nas")}
                  >
                    <div className="settings-icon">
                      <Server size={32} />
                    </div>
                    <div>
                      <span>{card.title}</span>
                      <strong>{card.value}</strong>
                      <p>{card.meta}</p>
                      <em className="settings-card-action">NAS status</em>
                    </div>
                  </button>
                );
              }

              if (card.kind === "webMode") {
                return (
                  <button
                    className={`settings-card settings-card-button settings-card-summary settings-card-web-mode tone-${card.tone}`}
                    key={card.key}
                    type="button"
                    onClick={() => openDetail("webMode")}
                  >
                    <div className="settings-icon">
                      <Globe2 size={32} />
                    </div>
                    <div>
                      <span>{card.title}</span>
                      <strong>{card.value}</strong>
                      <p>{card.meta}</p>
                      <em className="settings-card-action">Proxy & keyboard</em>
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

import { useCallback, useEffect, useMemo, useState } from "react";
import { Airplay, Bluetooth, Captions, Cast, CheckCircle2, Clock3, Cpu, Database, EthernetPort, Eye, EyeOff, Globe2, HardDrive, Info, Monitor, Moon, Music2, Palette, PanelRightClose, Plus, Power, Radio as RadioIcon, RotateCcw, Search, Server, SlidersHorizontal, Target, Trash2, Type, Usb, Volume2, Waves } from "lucide-react";
import { deleteNasSource, discoverNasSources, fetchAudioLibrary, fetchNasSources, fetchWebModeState, mountNasSource, saveNasSource, sendWebModeAction, testNasSource, unmountNasSource, updateWebModeSettings } from "../api/tikpalClient";
import { getSourceDisplayStatus, getSourceDisplayStatusLabel } from "../sourceStatus";
import { friendlyUiErrorOrFallback } from "../uiCopy";
import type { TikpalDataStatus } from "../hooks/useTikpalState";
import { useOverlayReturnGesture } from "../hooks/useOverlayReturnGesture";
import type { AudioState, FontTheme, LyricsFontSize, NasDiscoverCandidate, NasSourceInput, NasSourcesResponse, NightScheduleState, PlaybackSummary, RoomExperienceActionRequest, RoomExperienceState, RoomMode, RuntimeState, SurfaceTheme, SystemActionType, SystemState, WebModeState } from "../types";

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
type LibraryStorageCounts = {
  local: number | null;
  nas: number | null;
  usb: number | null;
};

const webModeTextScaleChoices = [
  { value: 1, label: "Small" },
  { value: 1.1, label: "Medium" },
  { value: 1.2, label: "Large" }
];

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

const blankNasForm: NasSourceInput = {
  name: "",
  host: "",
  port: 445,
  share: "",
  path: "",
  authMode: "guest",
  username: "",
  password: "",
  enabled: true,
  mountName: ""
};

function buildNasFormFromCandidate(candidate: NasDiscoverCandidate): NasSourceInput {
  return {
    name: candidate.name,
    host: candidate.host,
    port: candidate.port,
    share: candidate.share,
    path: candidate.path,
    authMode: candidate.authMode,
    username: "",
    password: "",
    enabled: true,
    mountName: candidate.mountName
  };
}

function nasStatusLabel(status: string) {
  switch (status) {
    case "ready":
      return "Ready";
    case "manual":
      return "Manual";
    case "checking":
      return "Checking";
    case "check_setup":
      return "Check setup";
    default:
      return "Offline";
  }
}

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
    description: "Audio, display, type, and listening overlays."
  },
  library: {
    label: "Library",
    description: "Local music, USB, NAS, and scan status."
  },
  network: {
    label: "Link",
    description: "Connectivity and remote reachability."
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
  const trimmed = value.trim();
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(candidate);
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
  return getSourceDisplayStatusLabel(source);
}

function getConsoleStateClass(playback: PlaybackSummary, source: AudioState["currentSource"]) {
  if (playback.state === "playing") return "is-playing";
  if (playback.state === "paused") return "is-paused";
  const status = getSourceDisplayStatus(source);
  if (status.kind === "active" || status.kind === "ready" || status.kind === "connected") return "is-ready";
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
  const [webModeProviderTextScale, setWebModeProviderTextScale] = useState(1.1);
  const [webModeError, setWebModeError] = useState<string | null>(null);
  const [libraryStorageCounts, setLibraryStorageCounts] = useState<LibraryStorageCounts>({
    local: null,
    nas: null,
    usb: null
  });
  const [nasSourcesState, setNasSourcesState] = useState<NasSourcesResponse | null>(null);
  const [nasFormVisible, setNasFormVisible] = useState(false);
  const [nasForm, setNasForm] = useState<NasSourceInput>(blankNasForm);
  const [nasPasswordVisible, setNasPasswordVisible] = useState(false);
  const [nasPendingAction, setNasPendingAction] = useState<"test" | "save" | "scan" | "mount" | "unmount" | "delete" | null>(null);
  const [nasMessage, setNasMessage] = useState<string | null>(null);
  const [nasError, setNasError] = useState<string | null>(null);
  const [nasCandidates, setNasCandidates] = useState<NasDiscoverCandidate[]>([]);
  const [nasTestReady, setNasTestReady] = useState(false);
  const [nasDeleteConfirmId, setNasDeleteConfirmId] = useState<string | null>(null);
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
      setNasFormVisible(false);
      setNasForm(blankNasForm);
      setNasPasswordVisible(false);
      setNasPendingAction(null);
      setNasMessage(null);
      setNasError(null);
      setNasCandidates([]);
      setNasTestReady(false);
      setNasDeleteConfirmId(null);
      setPendingRoomShortcut(null);
      setRoomShortcutError(null);
    }
  }, [active]);

  const refreshLibraryStorageCounts = useCallback(
    async (signal?: AbortSignal) => {
      const library = await fetchAudioLibrary({ storage: "all", limit: 1 }, signal);
      const storageCount = (storageId: keyof LibraryStorageCounts) => {
        const count = library.storages.find((storage) => storage.id === storageId)?.trackCount;
        return Number.isFinite(count) ? Math.max(0, Number(count)) : 0;
      };
      setLibraryStorageCounts({
        local: storageCount("local"),
        nas: storageCount("nas"),
        usb: storageCount("usb")
      });
    },
    []
  );

  const refreshNasSources = useCallback(
    async (signal?: AbortSignal) => {
      const nextSources = await fetchNasSources(signal);
      setNasSourcesState(nextSources);
      return nextSources;
    },
    []
  );

  useEffect(() => {
    if (!active) return undefined;
    const controller = new AbortController();
    void refreshLibraryStorageCounts(controller.signal).catch(() => undefined);
    void refreshNasSources(controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [active, refreshLibraryStorageCounts, refreshNasSources]);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    void fetchWebModeState()
      .then((nextState) => {
        if (cancelled) return;
        setWebModeState(nextState);
        setWebModeProxyEnabled(nextState.settings.proxyEnabled);
        setWebModeProxyUrl(nextState.settings.proxyUrl);
        setWebModeProviderTextScale(nextState.settings.providerTextScale ?? 1.1);
      })
      .catch((error) => {
        if (!cancelled) setWebModeError(friendlyUiErrorOrFallback(error instanceof Error ? error.message : null, "Explore settings unavailable"));
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  useEffect(() => {
    if (!active || detailView !== "webMode" || window.__TIKPAL_REMOTE_MODE__ || !localKioskHosts.has(window.location.hostname)) return undefined;
    let inputSessionStarted = false;
    const isWebModeInputTarget = (target: EventTarget | null) => target instanceof HTMLElement
      && Boolean(target.closest("[data-settings-detail=\"web-mode\"] input, [data-settings-detail=\"web-mode\"] textarea, [data-settings-detail=\"web-mode\"] [contenteditable='true'], [data-settings-detail=\"web-mode\"] [role='textbox']"));
    const markInputSessionStarted = (event: Event) => {
      if (isWebModeInputTarget(event.target)) inputSessionStarted = true;
    };
    document.addEventListener("pointerdown", markInputSessionStarted, true);
    document.addEventListener("focusin", markInputSessionStarted, true);
    const timer = window.setTimeout(() => {
      if (inputSessionStarted || isWebModeInputTarget(document.activeElement)) return;
      void sendWebModeAction({ type: "keyboard", preload: true }).catch(() => undefined);
    }, 120);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", markInputSessionStarted, true);
      document.removeEventListener("focusin", markInputSessionStarted, true);
    };
  }, [active, detailView]);

  useEffect(() => {
    if (!active || !webModeState) return undefined;

    const normalizedProxyUrl = normalizeProxyUrl(webModeProxyUrl);
    const enabledChanged = webModeProxyEnabled !== webModeState.settings.proxyEnabled;
    const proxyUrlChanged = normalizedProxyUrl !== null && normalizedProxyUrl !== webModeState.settings.proxyUrl;
    const textScaleChanged = Math.abs(webModeProviderTextScale - (webModeState.settings.providerTextScale ?? 1.1)) > 0.001;

    if (webModeProxyEnabled && normalizedProxyUrl === null) {
      setWebModeError("Enter a complete proxy URL");
      return undefined;
    }
    if (!enabledChanged && !proxyUrlChanged && !textScaleChanged) {
      setWebModeError((current) => current === "Enter a complete proxy URL" || current === "Saving..." ? null : current);
      return undefined;
    }

    let cancelled = false;
    setWebModeError("Saving...");
    const timer = window.setTimeout(() => {
      void updateWebModeSettings({
        proxyEnabled: webModeProxyEnabled,
        ...(normalizedProxyUrl === null ? {} : { proxyUrl: normalizedProxyUrl }),
        providerTextScale: webModeProviderTextScale
      })
        .then((nextState) => {
          if (cancelled) return;
          setWebModeState(nextState);
          setWebModeError("Saved automatically");
        })
        .catch((error) => {
          if (!cancelled) setWebModeError(friendlyUiErrorOrFallback(error instanceof Error ? error.message : null, "Explore settings save failed"));
        });
    }, 700);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, webModeProviderTextScale, webModeProxyEnabled, webModeProxyUrl, webModeState]);

  const librarySourceKind = system.library.source.trim().toLowerCase();
  const libraryTrackCount = Math.max(0, system.library.trackCount);
  const localTrackCount = libraryStorageCounts.local ?? (librarySourceKind === "local" ? libraryTrackCount : 0);
  const nasTrackCount = libraryStorageCounts.nas ?? 0;
  const usbTrackCount = libraryStorageCounts.usb ?? (librarySourceKind === "usb" ? libraryTrackCount : 0);
  const scannedLibraryTrackCount = localTrackCount + usbTrackCount;
  const configuredNasSources = nasSourcesState?.sources.filter((source) => source.sourceKind !== "manual") ?? [];
  const readyNasSources = configuredNasSources.filter((source) => source.status === "ready");
  const nasCardTone: CardTone = nasTrackCount > 0 ? "cyan" : "neutral";
  const nasCardValue = readyNasSources.length > 0 ? "Ready" : configuredNasSources.length > 0 ? "Check setup" : "Add NAS";
  const nasCardMeta = nasTrackCount > 0
    ? `${nasTrackCount.toLocaleString()} tracks · ${system.library.lastScan}`
    : configuredNasSources.length > 0
      ? `${configuredNasSources.length.toLocaleString()} saved`
      : "Add NAS in Settings";
  const usbCardValue = usbTrackCount > 0 ? `${usbTrackCount.toLocaleString()} tracks` : "Not mounted";
  const usbCardMeta = usbTrackCount > 0 ? "Portable storage mounted" : "Portable storage";
  const libraryScanValue = scannedLibraryTrackCount > 0 ? "Local + USB" : system.library.source;
  const libraryScanMeta = system.library.scanning
    ? "Scan in progress"
    : scannedLibraryTrackCount > 0
      ? `${scannedLibraryTrackCount.toLocaleString()} tracks`
      : `${system.library.trackCount.toLocaleString()} tracks`;

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
        meta: `${system.dspState.presetLabel} · ${system.dspState.controllable ? "Adjustable" : "Read-only"}`,
        tone: "cyan"
      },
      {
        kind: "display",
        key: "display",
        section: "output",
        icon: Monitor,
        title: "Display",
        value: runtime.kioskWindow,
        meta: system.display.controllable ? "Screen ready · Brightness ready" : "Screen ready · Unavailable",
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
        meta: "Music saved on this device",
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
        value: usbCardValue,
        meta: usbCardMeta,
        tone: usbTrackCount > 0 ? "gold" : "neutral"
      },
      {
        kind: "action",
        key: "library",
        section: "library",
        icon: Database,
        title: "Library Scan",
        value: libraryScanValue,
        meta: libraryScanMeta,
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
        section: "system",
        icon: Info,
        title: "System",
        value: status.source === "api" ? "Online" : "Limited",
        meta: status.error ? "Needs attention" : `CPU ${system.cpuTemp}C - ${system.uptime}`,
        tone: status.source === "api" ? "neutral" : "warn"
      },
      {
        kind: "webMode",
        key: "web-mode",
        section: "network",
        icon: Globe2,
        title: "Explore",
        value: webModeProxyEnabled ? "Proxy" : "Direct",
        meta: webModeProxyEnabled ? "Proxy ready" : "Official web players",
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
    [fontTheme, libraryScanMeta, libraryScanValue, localTrackCount, lyricsFontSize, lyricsVisible, nasCardMeta, nasCardTone, nasCardValue, roomExperience.nightSchedule.active, roomExperience.nightSchedule.enabled, roomExperience.nightSchedule.end, roomExperience.nightSchedule.start, roomExperience.nightSchedule.timeZone, runtime.kioskWindow, runtime.requestedRenderer, status.error, status.source, surfaceTheme, system.cpuTemp, system.display.brightnessPercent, system.display.controllable, system.dspState.controllable, system.dspState.controlTransport, system.dspState.enabled, system.dspState.presetLabel, system.library.scanning, system.network.ip, system.network.label, system.network.speed, system.outputDevice.detail, system.outputDevice.label, system.uptime, usbCardMeta, usbCardValue, usbTrackCount, webModeProxyEnabled, webModeProxyUrl]
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
      setBrightnessError(friendlyUiErrorOrFallback(error instanceof Error ? error.message : null, "Brightness did not change. Try a lower level."));
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
      setNightError(friendlyUiErrorOrFallback(error instanceof Error ? error.message : null, "Night schedule did not save. Try again."));
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
      if (card.actionType === "library_scan") {
        void refreshLibraryStorageCounts().catch(() => undefined);
      }
      setActionError((current) => ({
        ...current,
        [card.actionType]: null
      }));
    } catch (error) {
      setActionError((current) => ({
        ...current,
        [card.actionType]: friendlyUiErrorOrFallback(error instanceof Error ? error.message : null, "System action did not start. Try again.")
      }));
    } finally {
      setPendingAction(null);
    }
  }

  function handleNasFormPatch(patch: Partial<NasSourceInput>) {
    setNasForm((current) => ({ ...current, ...patch }));
    setNasTestReady(false);
    setNasError(null);
    setNasMessage(null);
  }

  function openNasAddForm(candidate?: NasDiscoverCandidate) {
    setNasForm(candidate ? buildNasFormFromCandidate(candidate) : blankNasForm);
    setNasFormVisible(true);
    setNasPasswordVisible(false);
    setNasTestReady(false);
    setNasDeleteConfirmId(null);
    setNasError(null);
    setNasMessage(candidate ? "Review, then test." : null);
  }

  function openNasEditForm(source: NasSourcesResponse["sources"][number]) {
    if (source.readOnly) return;
    setNasForm({
      id: source.id,
      name: source.name,
      host: source.host,
      port: source.port || 445,
      share: source.share,
      path: source.path,
      authMode: source.authMode === "password" ? "password" : "guest",
      username: source.username,
      password: "",
      enabled: source.enabled,
      mountName: source.mountName
    });
    setNasFormVisible(true);
    setNasPasswordVisible(false);
    setNasTestReady(false);
    setNasDeleteConfirmId(null);
    setNasError(null);
    setNasMessage("Edit, then test.");
  }

  function buildNasSavePayload() {
    const payload: NasSourceInput = {
      ...nasForm,
      port: Number.isFinite(Number(nasForm.port)) ? Number(nasForm.port) : 445,
      path: nasForm.path ?? "",
      mountName: nasForm.mountName?.trim() || nasForm.name.trim() || nasForm.share.trim(),
      username: nasForm.authMode === "password" ? nasForm.username ?? "" : "",
      password: nasForm.authMode === "password" ? nasForm.password ?? "" : "",
      enabled: nasForm.enabled !== false
    };
    if (payload.authMode === "guest" || !payload.password) {
      delete payload.password;
    }
    return payload;
  }

  function findSavedNasSource(sources: NasSourcesResponse["sources"], payload: NasSourceInput) {
    return sources.find((source) => payload.id && source.id === payload.id)
      ?? sources.find((source) => (
        !source.readOnly
        && source.host === payload.host.trim()
        && source.share === payload.share.trim()
        && source.mountName === (payload.mountName?.trim() || payload.name.trim() || payload.share.trim())
      ))
      ?? sources.find((source) => !source.readOnly && source.host === payload.host.trim() && source.share === payload.share.trim());
  }

  async function handleNasTest() {
    if (nasPendingAction) return;
    setNasPendingAction("test");
    setNasError(null);
    setNasMessage("Testing...");
    try {
      const payload = buildNasSavePayload();
      const result = await testNasSource(payload, payload.id || "_draft");
      setNasTestReady(result.ok);
      setNasMessage(result.ok ? `Ready${result.trackCount !== undefined ? ` · ${result.trackCount.toLocaleString()} tracks` : ""}` : null);
      setNasError(result.ok ? null : result.lastError || "Check setup");
      if (result.ok) {
        void refreshLibraryStorageCounts().catch(() => undefined);
        void refreshNasSources().catch(() => undefined);
      }
    } catch (error) {
      setNasTestReady(false);
      setNasError(friendlyUiErrorOrFallback(error instanceof Error ? error.message : null, "Check setup"));
      setNasMessage(null);
    } finally {
      setNasPendingAction(null);
    }
  }

  async function handleNasSaveAndScan() {
    if (nasPendingAction) return;
    setNasPendingAction("save");
    setNasError(null);
    setNasMessage("Saving...");
    try {
      const payload = buildNasSavePayload();
      const saved = await saveNasSource(payload);
      setNasSourcesState(saved);
      const savedSource = findSavedNasSource(saved.sources, payload);
      if (savedSource && !savedSource.readOnly) {
        setNasMessage("Scanning...");
        const mounted = await mountNasSource(savedSource.id);
        setNasSourcesState(mounted);
      }
      await refreshLibraryStorageCounts();
      setNasFormVisible(false);
      setNasForm(blankNasForm);
      setNasPasswordVisible(false);
      setNasTestReady(false);
      setNasMessage("Saved to NAS.");
    } catch (error) {
      setNasError(friendlyUiErrorOrFallback(error instanceof Error ? error.message : null, "NAS did not save. Check setup."));
      setNasMessage(null);
    } finally {
      setNasPendingAction(null);
    }
  }

  async function handleNasScanNetwork() {
    if (nasPendingAction) return;
    setNasPendingAction("scan");
    setNasError(null);
    setNasMessage("Scanning...");
    try {
      const result = await discoverNasSources();
      setNasCandidates(result.candidates);
      setNasMessage(result.candidates.length > 0 ? `${result.candidates.length} found. Choose one to add.` : "No shares found.");
    } catch (error) {
      setNasError(friendlyUiErrorOrFallback(error instanceof Error ? error.message : null, "Scan did not find shares."));
      setNasMessage(null);
    } finally {
      setNasPendingAction(null);
    }
  }

  async function handleNasMount(sourceId: string) {
    if (nasPendingAction) return;
    setNasPendingAction("mount");
    setNasError(null);
    setNasMessage("Scanning...");
    try {
      setNasSourcesState(await mountNasSource(sourceId));
      await refreshLibraryStorageCounts();
      setNasMessage("NAS ready.");
    } catch (error) {
      setNasError(friendlyUiErrorOrFallback(error instanceof Error ? error.message : null, "Check setup"));
      setNasMessage(null);
    } finally {
      setNasPendingAction(null);
    }
  }

  async function handleNasUnmount(sourceId: string) {
    if (nasPendingAction) return;
    setNasPendingAction("unmount");
    setNasError(null);
    try {
      setNasSourcesState(await unmountNasSource(sourceId));
      await refreshLibraryStorageCounts();
      setNasMessage("NAS offline.");
    } catch (error) {
      setNasError(friendlyUiErrorOrFallback(error instanceof Error ? error.message : null, "Could not unmount."));
    } finally {
      setNasPendingAction(null);
    }
  }

  async function handleNasDelete(sourceId: string) {
    if (nasPendingAction) return;
    if (nasDeleteConfirmId !== sourceId) {
      setNasDeleteConfirmId(sourceId);
      setNasMessage("Delete NAS?");
      setNasError(null);
      return;
    }
    setNasPendingAction("delete");
    setNasError(null);
    try {
      setNasSourcesState(await deleteNasSource(sourceId));
      await refreshLibraryStorageCounts();
      setNasDeleteConfirmId(null);
      setNasMessage("NAS removed.");
    } catch (error) {
      setNasError(friendlyUiErrorOrFallback(error instanceof Error ? error.message : null, "Could not delete NAS."));
    } finally {
      setNasPendingAction(null);
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
      setRoomShortcutError(friendlyUiErrorOrFallback(error instanceof Error ? error.message : null, "Room did not change. Try again."));
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
            <p>Choose the look for this screen.</p>
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
            <p>Choose the type style.</p>
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
            <p>{lyricsVisible ? "Lyrics are visible." : "Lyrics are hidden."}</p>
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
              <strong>{lyricsVisible ? "Hide Lyrics" : "Show Lyrics"}</strong>
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
    const sources = nasSourcesState?.sources ?? [];
    const configuredSources = sources.filter((source) => source.sourceKind !== "manual");
    const manualSources = sources.filter((source) => source.sourceKind === "manual");
    const sourceStatus = nasError
      ?? nasMessage
      ?? (nasTrackCount > 0
        ? `${nasTrackCount.toLocaleString()} tracks · Last scan ${system.library.lastScan}`
        : configuredSources.length > 0
          ? "Check setup, then scan."
          : "Add NAS in Settings.");
    const busy = nasPendingAction !== null;

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
          <div className="nas-source-toolbar">
            <button type="button" onClick={() => openNasAddForm()} disabled={busy}>
              <Plus size={18} />
              <span>Add NAS</span>
            </button>
            <button type="button" onClick={() => void handleNasScanNetwork()} disabled={busy}>
              <Search size={18} />
              <span>{nasPendingAction === "scan" ? "Scanning..." : "Scan Network"}</span>
            </button>
          </div>

          {nasFormVisible ? (
            <form
              className="nas-source-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleNasSaveAndScan();
              }}
            >
              <div className="nas-form-grid">
                <label className="night-field">
                  <span>Name</span>
                  <input
                    value={nasForm.name}
                    autoComplete="off"
                    onChange={(event) => handleNasFormPatch({ name: event.currentTarget.value, mountName: nasForm.mountName || event.currentTarget.value })}
                  />
                </label>
                <label className="night-field">
                  <span>Server/IP</span>
                  <input
                    value={nasForm.host}
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => handleNasFormPatch({ host: event.currentTarget.value })}
                  />
                </label>
                <label className="night-field">
                  <span>Port</span>
                  <input
                    value={nasForm.port ?? 445}
                    inputMode="numeric"
                    onChange={(event) => handleNasFormPatch({ port: Number(event.currentTarget.value) || 445 })}
                  />
                </label>
                <label className="night-field">
                  <span>Share</span>
                  <input
                    value={nasForm.share}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => handleNasFormPatch({ share: event.currentTarget.value, mountName: nasForm.mountName || event.currentTarget.value })}
                  />
                </label>
                <label className="night-field">
                  <span>Folder</span>
                  <input
                    value={nasForm.path ?? ""}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Optional"
                    onChange={(event) => handleNasFormPatch({ path: event.currentTarget.value })}
                  />
                </label>
                <label className="night-field">
                  <span>Local Name</span>
                  <input
                    value={nasForm.mountName ?? ""}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => handleNasFormPatch({ mountName: event.currentTarget.value })}
                  />
                </label>
              </div>

              <div className="nas-auth-row">
                <button
                  className={`night-toggle ${nasForm.authMode === "guest" ? "is-active" : ""}`}
                  type="button"
                  aria-pressed={nasForm.authMode === "guest"}
                  onClick={() => handleNasFormPatch({ authMode: "guest", username: "", password: "" })}
                >
                  <CheckCircle2 size={24} />
                  <span>
                    <strong>Guest</strong>
                    <em>No password</em>
                  </span>
                </button>
                <button
                  className={`night-toggle ${nasForm.authMode === "password" ? "is-active" : ""}`}
                  type="button"
                  aria-pressed={nasForm.authMode === "password"}
                  onClick={() => handleNasFormPatch({ authMode: "password" })}
                >
                  <Server size={24} />
                  <span>
                    <strong>Account</strong>
                    <em>Username + password</em>
                  </span>
                </button>
              </div>

              {nasForm.authMode === "password" ? (
                <div className="nas-form-grid nas-form-grid-auth">
                  <label className="night-field">
                    <span>Username</span>
                    <input
                      value={nasForm.username ?? ""}
                      autoComplete="username"
                      spellCheck={false}
                      onChange={(event) => handleNasFormPatch({ username: event.currentTarget.value })}
                    />
                  </label>
                  <label className="night-field nas-password-field">
                    <span>Password</span>
                    <span className="nas-password-input-wrap">
                      <input
                        value={nasForm.password ?? ""}
                        type={nasPasswordVisible ? "text" : "password"}
                        autoComplete="current-password"
                        spellCheck={false}
                        onChange={(event) => handleNasFormPatch({ password: event.currentTarget.value })}
                      />
                      <button
                        type="button"
                        aria-label={nasPasswordVisible ? "Hide password" : "Show password"}
                        title={nasPasswordVisible ? "Hide password" : "Show password"}
                        onClick={() => setNasPasswordVisible((visible) => !visible)}
                      >
                        {nasPasswordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </span>
                  </label>
                </div>
              ) : null}

              <div className="nas-form-actions">
                <button type="button" onClick={() => void handleNasTest()} disabled={busy}>
                  {nasPendingAction === "test" ? "Testing..." : "Test"}
                </button>
                <button type="submit" disabled={busy}>
                  {nasPendingAction === "save" ? "Saving..." : nasTestReady ? "Save & Scan" : "Save & Scan"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNasFormVisible(false);
                    setNasForm(blankNasForm);
                    setNasTestReady(false);
                    setNasError(null);
                    setNasMessage(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}

          {configuredSources.length === 0 && manualSources.length === 0 && !nasFormVisible ? (
            <article className="nas-source-card tone-neutral">
              <div className="settings-icon">
                <Server size={32} />
              </div>
              <div className="nas-source-copy">
                <span>No NAS yet</span>
                <strong>Add NAS</strong>
                <p>Scan Network can find candidates. Save only after Test.</p>
              </div>
            </article>
          ) : null}

          {configuredSources.map((source) => (
            <article key={source.id} className={`nas-source-card tone-${source.status === "ready" ? "cyan" : "neutral"}`}>
              <div className="settings-icon">
                <Server size={32} />
              </div>
              <div className="nas-source-copy">
                <span>{nasStatusLabel(source.status)}</span>
                <strong>{source.name}</strong>
                <p>{source.host ? `//${source.host}:${source.port}/${source.share}` : source.mountName}</p>
                <dl>
                  <div>
                    <dt>Tracks</dt>
                    <dd>{source.trackCount.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Path</dt>
                    <dd>{source.mpdPath ?? "NAS"}</dd>
                  </div>
                  <div>
                    <dt>Version</dt>
                    <dd>{source.smbVersion ?? "Auto"}</dd>
                  </div>
                </dl>
                {source.lastError ? <em className="nas-source-error" title={source.lastError}>Check setup</em> : null}
              </div>
              <div className="nas-source-actions">
                <button type="button" onClick={() => openNasEditForm(source)} disabled={busy}>Edit</button>
                <button type="button" onClick={() => void handleNasMount(source.id)} disabled={busy}>
                  {source.status === "ready" ? "Scan" : "Mount"}
                </button>
                <button type="button" onClick={() => void handleNasUnmount(source.id)} disabled={busy}>Unmount</button>
                {nasDeleteConfirmId === source.id ? (
                  <span className="nas-delete-confirm">
                    <button type="button" onClick={() => void handleNasDelete(source.id)} disabled={busy}>Yes</button>
                    <button type="button" onClick={() => setNasDeleteConfirmId(null)} disabled={busy}>No</button>
                  </span>
                ) : (
                  <button type="button" aria-label={`Delete ${source.name}`} title={`Delete ${source.name}`} onClick={() => void handleNasDelete(source.id)} disabled={busy}>
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </article>
          ))}

          {manualSources.map((source) => (
            <article key={source.id} className="nas-source-card tone-neutral">
              <div className="settings-icon">
                <Info size={32} />
              </div>
              <div className="nas-source-copy">
                <span>Manual</span>
                <strong>{source.name}</strong>
                <p>Loaded from environment.</p>
                <dl>
                  <div>
                    <dt>Tracks</dt>
                    <dd>{source.trackCount.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Path</dt>
                    <dd>{source.mpdPath ?? "NAS"}</dd>
                  </div>
                </dl>
              </div>
            </article>
          ))}

          {nasCandidates.length > 0 ? (
            <div className="nas-candidate-list">
              {nasCandidates.map((candidate) => (
                <button key={`${candidate.host}:${candidate.port}/${candidate.share}/${candidate.path}`} type="button" onClick={() => openNasAddForm(candidate)} disabled={busy}>
                  <Server size={18} />
                  <span>
                    <strong>{candidate.name}</strong>
                    <em>{`//${candidate.host}:${candidate.port}/${candidate.share}`}</em>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  function renderWebModeDetail() {
    const statusText = webModeError
      ?? (webModeState?.settings.proxyEnabled ? "Proxy ready" : "Direct connection");

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
              <strong>Proxy</strong>
              <em>{webModeProxyEnabled ? "On" : "Direct"}</em>
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

          <div className="night-field web-mode-scale-field" data-web-mode-settings-scale>
            <span><Type size={16} /> Font</span>
            <div className="web-mode-settings-scale-options" role="group" aria-label="Provider font size">
              {webModeTextScaleChoices.map((choice) => (
                <button
                  key={choice.label}
                  className={`web-mode-settings-scale-option ${Math.abs(webModeProviderTextScale - choice.value) < 0.001 ? "is-active" : ""}`}
                  type="button"
                  aria-pressed={Math.abs(webModeProviderTextScale - choice.value) < 0.001}
                  onClick={() => setWebModeProviderTextScale(choice.value)}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </div>

          <p className="web-mode-settings-help">Saves automatically. If a player won’t open, switch Proxy and retry.</p>
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
            <p>{brightnessError ?? (system.display.controllable ? "Brightness ready" : "Unavailable")}</p>
          </div>
        </div>

        <div className="display-brightness-panel display-brightness-panel-detail">
          <div className="display-brightness-header">
            <strong>{brightnessPercent}% Brightness</strong>
            <em title={system.display.transport}>{system.display.controllable ? "Hardware" : "Unavailable"}</em>
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
                : "Display brightness panel"
              : "Unavailable"}
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
              <button
                className="console-room-shortcut console-room-back"
                data-room-shortcut="back"
                data-console-back-button
                type="button"
                aria-label="Back to main screen"
                onClick={handleReturnAmbient}
              >
                <PanelRightClose size={17} />
                <span>Back</span>
              </button>
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
                    <p title={error ?? undefined}>{error ?? (isConfirming ? card.confirmLabel : card.meta)}</p>
                    <em className="settings-card-action">{isPending ? "Applying..." : card.buttonLabel}</em>
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

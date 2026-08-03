import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Airplay, Bluetooth, Captions, Cast, CheckCircle2, Clock3, Cpu, Database, EthernetPort, Eye, EyeOff, Globe2, HardDrive, Info, Monitor, Moon, Music2, Palette, PanelRightClose, Plus, Power, Radio as RadioIcon, RotateCcw, Search, Server, SlidersHorizontal, Target, Trash2, Type, Usb, Volume2, Waves } from "lucide-react";
import { deleteNasSource, discoverNasSources, fetchAudioLibrary, fetchAudioOutputDiagnostics, fetchMultiroom, fetchNasSources, fetchWebModeState, mountNasSource, saveNasSource, sendWebModeAction, testNasSource, unmountNasSource, updateMultiroomEcosystem, updateWebModeSettings } from "../api/tikpalClient";
import { languageOptions, useI18n } from "../i18n";
import { getSourceDisplayStatus, getSourceDisplayStatusLabel } from "../sourceStatus";
import type { TikpalDataStatus } from "../hooks/useTikpalState";
import { useOverlayReturnGesture } from "../hooks/useOverlayReturnGesture";
import type { AudioOutputCustomSettingId, AudioOutputDiagnostics, AudioOutputProfile, AudioState, DisplaySleepStyle, FontTheme, LyricsFontSize, MultiroomAudioState, MultiroomEcosystemId, NasDiscoverCandidate, NasSourceInput, NasSourcesResponse, NightScheduleState, PlaybackSummary, RoomExperienceActionRequest, RoomExperienceState, RoomMode, RuntimeState, SurfaceTheme, SystemActionType, SystemState, UiLocale, WebModeState } from "../types";

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
  onPreviewScreenSaver: () => void;
  onReturnAmbient: () => void;
}

type CardTone = "cyan" | "gold" | "neutral" | "warn" | "danger";
type ActionableCardKey = "library_scan" | "reboot" | "shutdown";
type SettingsSectionKey = "output" | "library" | "network" | "system";
type SettingsDetailView = "appearance" | "audioDiagnostics" | "audioOutput" | "display" | "font" | "language" | "lyrics" | "multiroom" | "nas" | "night" | "webMode" | null;
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

const NAS_PANEL_PAGE_SIZE = 3;
const displaySleepMinuteChoices = [5, 10, 15, 30, 60] as const;
const displaySleepStyleChoices: DisplaySleepStyle[] = ["meteor_shower", "clock", "now_playing", "starfield", "signal"];
const multiroomEcosystemChoices: MultiroomEcosystemId[] = ["roon", "lyrion", "tikpal", "music_assistant"];

interface ParsedAudioHwParams {
  path: string;
  label: string;
  format: string | null;
  rate: string | null;
  channels: string | null;
}

interface ParsedAudioDiagnostics {
  parsed: boolean;
  outputName: string | null;
  outputDevice: string | null;
  replayGain: string | null;
  crossfade: string | null;
  activeHwParams: ParsedAudioHwParams[];
  ownerPids: string[];
}

function extractMpdSetting(block: string | undefined, name: string) {
  if (!block) return null;
  const match = block.match(new RegExp(`^\\s*${name}\\s+"([^"]*)"`, "m"));
  return match?.[1]?.trim() || null;
}

function normalizeMpcSetting(value: string | undefined, prefix: string) {
  if (!value) return null;
  return value.replace(new RegExp(`^${prefix}\\s*:\\s*`, "i"), "").trim() || null;
}

function parseAudioHwParams(rawBlock: string | undefined): ParsedAudioHwParams[] {
  if (!rawBlock) return [];
  const entries: ParsedAudioHwParams[] = [];
  let currentPath: string | null = null;
  let currentLines: string[] = [];

  const commit = () => {
    if (!currentPath) return;
    const closed = currentLines.some((line) => line.trim() === "closed");
    if (!closed) {
      const fields = new Map<string, string>();
      currentLines.forEach((line) => {
        const match = line.match(/^\s*([^:]+):\s*(.+)$/);
        if (match) fields.set(match[1].trim().toLowerCase(), match[2].trim());
      });
      const deviceMatch = currentPath.match(/\/asound\/card(\d+)\/pcm(\d+)([cp])\/sub(\d+)\/hw_params$/);
      entries.push({
        path: currentPath,
        label: deviceMatch ? `card${deviceMatch[1]} pcm${deviceMatch[2]}${deviceMatch[3]}` : currentPath.replace(/^.*\/asound\//, ""),
        format: fields.get("format") ?? null,
        rate: fields.get("rate")?.replace(/\s+\(.+\)$/, "") ?? null,
        channels: fields.get("channels") ?? null
      });
    }
  };

  rawBlock.split(/\r?\n/).forEach((line) => {
    if (line.startsWith("/proc/asound/") && line.endsWith("/hw_params")) {
      commit();
      currentPath = line.trim();
      currentLines = [];
      return;
    }
    if (currentPath) currentLines.push(line);
  });
  commit();
  return entries;
}

function parseAudioDiagnosticsText(rawText: string): ParsedAudioDiagnostics {
  const sections: Record<string, string> = {};
  const values: Record<string, string> = {};
  const lines = rawText.trim().split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const sectionMatch = line.match(/^([A-Za-z0-9_.-]+)<<EOF$/);
    if (sectionMatch) {
      const sectionLines: string[] = [];
      index += 1;
      while (index < lines.length && lines[index] !== "EOF") {
        sectionLines.push(lines[index]);
        index += 1;
      }
      sections[sectionMatch[1]] = sectionLines.join("\n");
      continue;
    }
    const valueMatch = line.match(/^([A-Za-z0-9_.-]+)=(.*)$/);
    if (valueMatch) values[valueMatch[1]] = valueMatch[2].trim();
  }

  const ownerPids = Array.from(new Set((values.snd_owners ?? "").split(/\s+/).filter((pid) => /^\d+$/.test(pid))));
  return {
    parsed: Object.keys(sections).length > 0 || Object.keys(values).length > 0,
    outputName: extractMpdSetting(sections.output_block, "name"),
    outputDevice: extractMpdSetting(sections.output_block, "device"),
    replayGain: normalizeMpcSetting(values.mpc_replaygain, "replay_gain_mode"),
    crossfade: normalizeMpcSetting(values.mpc_crossfade, "crossfade"),
    activeHwParams: parseAudioHwParams(sections.hw_params),
    ownerPids
  };
}

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

interface AudioOutputCard extends BaseCard {
  kind: "audioOutput";
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

interface MultiroomCard extends BaseCard {
  kind: "multiroom";
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

interface LanguageCard extends BaseCard {
  kind: "language";
}

type SettingsCard = ReadOnlyCard | AudioOutputCard | ActionCard | FontCard | AppearanceCard | LanguageCard | LyricsCard | DisplayCard | MultiroomCard | NightCard | NasCard | WebModeCard;

const fontChoices: Array<{ id: FontTheme; label: string; sample: string }> = [
  { id: "system", label: "System Neo", sample: "Inter + Noto CJK" },
  { id: "hardware", label: "CJK Sans", sample: "中文 / 日本語 / 한국어" },
  { id: "precision", label: "Source Han", sample: "思源黑体 CN" },
  { id: "serif", label: "Editorial CJK", sample: "Noto Serif CJK" },
  { id: "sans", label: "Modern Sans", sample: "Latin UI + CJK fallback" },
  { id: "mono", label: "Mono Grid", sample: "Noto Mono CJK" }
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

type Translate = (key: string, params?: Record<string, string | number | null | undefined>) => string;

function nasStatusLabel(status: string, t: Translate) {
  switch (status) {
    case "ready":
      return t("nas.status.ready");
    case "manual":
      return t("nas.status.manual");
    case "checking":
      return t("nas.status.checking");
    case "check_setup":
      return t("nas.status.checkSetup");
    default:
      return t("nas.status.offline");
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
    label: "Connect",
    description: "Connectivity and remote reachability."
  },
  system: {
    label: "Device",
    description: "Guarded restart and shutdown actions."
  }
};

const settingsTabs: Array<{ id: SettingsSectionKey; label: string; Icon: typeof Database }> = [
  { id: "output", label: "Preferences", Icon: Volume2 },
  { id: "library", label: "Library", Icon: Database },
  { id: "network", label: "Connect", Icon: EthernetPort },
  { id: "system", label: "Device", Icon: Cpu }
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
  onPreviewScreenSaver,
  onReturnAmbient
}: QuickSettingsOverlayProps) {
  const {
    t,
    preferences,
    pending: preferencesPending,
    error: preferencesError,
    setLocale,
    setDisplaySleepPreferences,
    setAudioOutputProfile,
    setAudioOutputCustomSettings,
    friendlyError
  } = useI18n();
  const localePending = preferencesPending;
  const localeError = preferencesError;
  const overlayReturnGesture = useOverlayReturnGesture(onReturnAmbient);
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>("output");
  const [detailView, setDetailView] = useState<SettingsDetailView>(null);
  const [confirmAction, setConfirmAction] = useState<ActionableCardKey | null>(null);
  const [pendingAction, setPendingAction] = useState<ActionableCardKey | null>(null);
  const [pendingBrightness, setPendingBrightness] = useState<number | null>(null);
  const [pendingNight, setPendingNight] = useState(false);
  const [webModeState, setWebModeState] = useState<WebModeState | null>(null);
  const [multiroomState, setMultiroomState] = useState<MultiroomAudioState | null>(system.multiroom ?? null);
  const [multiroomPendingId, setMultiroomPendingId] = useState<MultiroomEcosystemId | null>(null);
  const [multiroomError, setMultiroomError] = useState<string | null>(null);
  const [audioOutputPendingProfile, setAudioOutputPendingProfile] = useState<AudioOutputProfile | null>(null);
  const [audioOutputPendingCustomSettings, setAudioOutputPendingCustomSettings] = useState<Partial<Record<AudioOutputCustomSettingId, boolean>> | null>(null);
  const [mpdQualityError, setMpdQualityError] = useState<string | null>(null);
  const [audioDiagnostics, setAudioDiagnostics] = useState<AudioOutputDiagnostics | null>(null);
  const [audioDiagnosticsPending, setAudioDiagnosticsPending] = useState(false);
  const [audioDiagnosticsError, setAudioDiagnosticsError] = useState<string | null>(null);
  const audioDiagnosticsTimerRef = useRef<number | null>(null);
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
  const [nasErrorRaw, setNasErrorRaw] = useState<string | null>(null);
  const [nasCandidates, setNasCandidates] = useState<NasDiscoverCandidate[]>([]);
  const [nasTestReady, setNasTestReady] = useState(false);
  const [nasDeleteConfirmId, setNasDeleteConfirmId] = useState<string | null>(null);
  const [selectedNasId, setSelectedNasId] = useState<string | null>(null);
  const [nasSourcePage, setNasSourcePage] = useState(0);
  const [nasCandidatePage, setNasCandidatePage] = useState(0);
  const [pendingRoomShortcut, setPendingRoomShortcut] = useState<RoomMode | "explore" | null>(null);
  const [roomShortcutError, setRoomShortcutError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Record<ActionableCardKey, string | null>>({
    library_scan: null,
    reboot: null,
    shutdown: null
  });
  const [brightnessError, setBrightnessError] = useState<string | null>(null);
  const [displaySleepError, setDisplaySleepError] = useState<string | null>(null);
  const [nightError, setNightError] = useState<string | null>(null);
  const [localeMessage, setLocaleMessage] = useState<string | null>(null);
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
  const sectionLabel = useCallback(
    (section: SettingsSectionKey) => t(`settings.${section === "output" ? "preferences" : section === "network" ? "link" : section === "system" ? "care" : "library"}`),
    [t]
  );
  const sectionDescription = useCallback(
    (section: SettingsSectionKey) => t(`settings.${section === "output" ? "preferencesDesc" : section === "network" ? "linkDesc" : section === "system" ? "careDesc" : "libraryDesc"}`),
    [t]
  );
  const localizedErrorMessage = useCallback(
    (error: unknown, fallbackKey = "error.generic") => friendlyError(error instanceof Error ? error.message : typeof error === "string" ? error : null, fallbackKey) ?? t(fallbackKey),
    [friendlyError, t]
  );
  const readableNasErrorMessage = useCallback(
    (error: unknown) => {
      const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
      if (message && message.length <= 96 && !message.includes("\n") && !/^Tikpal\s+API/i.test(message)) {
        return message;
      }
      return localizedErrorMessage(error, "error.nas");
    },
    [localizedErrorMessage]
  );
  useEffect(() => {
    if (!active) {
      hideLocalKeyboard();
      setActiveSection("output");
      setDetailView(null);
      setConfirmAction(null);
      setPendingAction(null);
      setPendingBrightness(null);
      setPendingNight(false);
      setDisplaySleepError(null);
      setActionError({
        library_scan: null,
        reboot: null,
        shutdown: null
      });
      setBrightnessError(null);
      setNightError(null);
      setLocaleMessage(null);
      setMultiroomError(null);
      setAudioOutputPendingProfile(null);
      setAudioOutputPendingCustomSettings(null);
      setMpdQualityError(null);
      setWebModeError(null);
      setNasFormVisible(false);
      setNasForm(blankNasForm);
      setNasPasswordVisible(false);
      setNasPendingAction(null);
      setNasMessage(null);
      setNasError(null);
      setNasErrorRaw(null);
      setNasCandidates([]);
      setNasTestReady(false);
      setNasDeleteConfirmId(null);
      setPendingRoomShortcut(null);
      setRoomShortcutError(null);
    }
  }, [active, localizedErrorMessage]);

  useEffect(() => {
    setMultiroomState(system.multiroom ?? null);
  }, [system.multiroom]);

  useEffect(() => {
    if (preferencesPending) return;
    setAudioOutputPendingProfile(null);
    setAudioOutputPendingCustomSettings(null);
  }, [preferencesPending]);

  useEffect(() => () => {
    if (audioDiagnosticsTimerRef.current !== null) {
      window.clearTimeout(audioDiagnosticsTimerRef.current);
      audioDiagnosticsTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    const controller = new AbortController();
    void fetchMultiroom(controller.signal)
      .then((nextState) => {
        setMultiroomState(nextState);
        setMultiroomError(null);
      })
      .catch((error) => {
        setMultiroomError(localizedErrorMessage(error, "error.generic"));
      });
    return () => controller.abort();
  }, [active, localizedErrorMessage]);

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
        if (!cancelled) setWebModeError(localizedErrorMessage(error, "error.explore"));
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
      setWebModeError(t("settings.enterProxyUrl"));
      return undefined;
    }
    if (!enabledChanged && !proxyUrlChanged && !textScaleChanged) {
      setWebModeError((current) => current === t("settings.enterProxyUrl") || current === t("common.saving") ? null : current);
      return undefined;
    }

    let cancelled = false;
    setWebModeError(t("common.saving"));
    const timer = window.setTimeout(() => {
      void updateWebModeSettings({
        proxyEnabled: webModeProxyEnabled,
        ...(normalizedProxyUrl === null ? {} : { proxyUrl: normalizedProxyUrl }),
        providerTextScale: webModeProviderTextScale
      })
        .then((nextState) => {
          if (cancelled) return;
          setWebModeState(nextState);
          setWebModeError(t("common.savedAutomatically"));
        })
        .catch((error) => {
          if (!cancelled) setWebModeError(localizedErrorMessage(error, "error.explore"));
        });
    }, 700);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, localizedErrorMessage, t, webModeProviderTextScale, webModeProxyEnabled, webModeProxyUrl, webModeState]);

  const librarySourceKind = system.library.source.trim().toLowerCase();
  const displayedAudioOutputProfile = audioOutputPendingProfile ?? preferences.audioOutputProfile;
  const displayedAudioOutputCustomSettings = {
    ...preferences.audioOutputCustomSettings,
    ...(audioOutputPendingCustomSettings ?? {})
  };
  const effectiveMultiroom = multiroomState ?? system.multiroom;
  const multiroomEcosystems = effectiveMultiroom?.ecosystems;
  const activeMultiroom = multiroomEcosystemChoices
    .map((id) => multiroomEcosystems?.[id])
    .find((entry) => entry?.active);
  const enabledMultiroomCount = multiroomEcosystemChoices
    .filter((id) => id !== "music_assistant" && multiroomEcosystems?.[id]?.enabled)
    .length;
  const multiroomNeedsSetup = multiroomEcosystemChoices
    .some((id) => id !== "music_assistant" && multiroomEcosystems?.[id]?.enabled && Boolean(multiroomEcosystems?.[id]?.lastError));
  const multiroomValue = activeMultiroom
    ? t("settings.multiroomPlaying")
    : enabledMultiroomCount > 0
      ? t("settings.multiroomReadyCount", { count: enabledMultiroomCount })
      : multiroomNeedsSetup
        ? t("settings.multiroomCheckSetup")
        : t("common.off");
  const multiroomMeta = activeMultiroom
    ? t("playback.playingFromMultiroom", { label: activeMultiroom.label.replace(/\s*Bridge$/i, "") })
    : enabledMultiroomCount > 0
      ? t("settings.multiroomReadyMeta")
      : multiroomNeedsSetup
        ? t("settings.multiroomCheckSetup")
        : t("settings.multiroomOffMeta");
  const libraryTrackCount = Math.max(0, system.library.trackCount);
  const localTrackCount = libraryStorageCounts.local ?? (librarySourceKind === "local" ? libraryTrackCount : 0);
  const nasTrackCount = libraryStorageCounts.nas ?? 0;
  const usbTrackCount = libraryStorageCounts.usb ?? (librarySourceKind === "usb" ? libraryTrackCount : 0);
  const scannedLibraryTrackCount = localTrackCount + usbTrackCount;
  const configuredNasSources = nasSourcesState?.sources.filter((source) => source.sourceKind !== "manual") ?? [];
  const readyNasSources = configuredNasSources.filter((source) => source.status === "ready");
  const nasCardTone: CardTone = nasTrackCount > 0 ? "cyan" : "neutral";
  const nasCardValue = nasTrackCount > 0
    ? t("nas.trackCountReady", { count: nasTrackCount.toLocaleString() })
    : readyNasSources.length > 0
      ? t("nas.status.ready")
      : configuredNasSources.length > 0
        ? t("nas.status.checkSetup")
        : t("nas.addNas");
  const nasCardMeta = nasTrackCount > 0
    ? t("nas.readyHint")
    : configuredNasSources.length > 0
      ? t("settings.savedCount", { count: configuredNasSources.length.toLocaleString() })
      : t("settings.addNasInSettings");
  const usbCardValue = usbTrackCount > 0 ? t("settings.tracks", { count: usbTrackCount.toLocaleString() }) : t("settings.notMounted");
  const usbCardMeta = usbTrackCount > 0 ? t("settings.portableStorageMounted") : t("settings.portableStorage");
  const libraryScanValue = scannedLibraryTrackCount > 0 ? `${t("library.local")} + ${t("library.usb")}` : system.library.source;
  const libraryScanMeta = system.library.scanning
    ? t("settings.scanInProgress")
    : scannedLibraryTrackCount > 0
      ? t("settings.tracks", { count: scannedLibraryTrackCount.toLocaleString() })
      : t("settings.tracks", { count: system.library.trackCount.toLocaleString() });

  const settingsCards = useMemo<SettingsCard[]>(
    () => [
      {
        kind: "language",
        key: "language",
        section: "output",
        icon: Globe2,
        title: t("settings.language"),
        value: languageOptions.find((option) => option.locale === preferences.locale)?.label ?? "English",
        meta: t("settings.languageMeta"),
        tone: "cyan"
      },
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
        kind: "audioOutput",
        key: "output",
        section: "output",
        icon: Volume2,
        title: t("settings.audioOutput"),
        value: t(`settings.audioProfile.${displayedAudioOutputProfile}`),
        meta: t("settings.chooseAudioProfile"),
        tone: "gold"
      },
      {
        kind: "multiroom",
        key: "multiroom",
        section: "output",
        icon: Waves,
        title: t("settings.multiroomAudio"),
        value: multiroomValue,
        meta: multiroomMeta,
        tone: activeMultiroom ? "gold" : enabledMultiroomCount > 0 ? "cyan" : "neutral"
      },
      {
        kind: "display",
        key: "display",
        section: "output",
        icon: Monitor,
        title: t("settings.display"),
        value: preferences.displaySleepEnabled ? t("settings.screenSleepOn") : t("settings.screenSleepOff"),
        meta: preferences.displaySleepEnabled
          ? t("settings.sleepSummary", {
            style: t(`settings.sleepStyle.${preferences.displaySleepStyle}`),
            minutes: preferences.displaySleepMinutes
          })
          : t("settings.screenStaysAwake"),
        tone: "neutral"
      },
      {
        kind: "night",
        key: "night",
        section: "output",
        icon: Clock3,
        title: t("settings.timeNight"),
        value: roomExperience.nightSchedule.active ? t("settings.night") : roomExperience.nightSchedule.enabled ? t("settings.auto") : t("common.manual"),
        meta: `${roomExperience.nightSchedule.timeZone} · ${roomExperience.nightSchedule.start}-${roomExperience.nightSchedule.end}`,
        tone: roomExperience.nightSchedule.active ? "cyan" : "neutral"
      },
      {
        kind: "readonly",
        key: "local-library",
        section: "library",
        icon: HardDrive,
        title: t("settings.localLibrary"),
        value: t("settings.tracks", { count: localTrackCount.toLocaleString() }),
        meta: t("settings.savedOnDevice"),
        tone: "gold"
      },
      {
        kind: "nas",
        key: "nas-sources",
        section: "library",
        icon: Server,
        title: t("settings.nasSources"),
        value: nasCardValue,
        meta: nasCardMeta,
        tone: nasCardTone
      },
      {
        kind: "readonly",
        key: "usb-library",
        section: "library",
        icon: Usb,
        title: t("settings.usb"),
        value: usbCardValue,
        meta: usbCardMeta,
        tone: usbTrackCount > 0 ? "gold" : "neutral"
      },
      {
        kind: "action",
        key: "library",
        section: "library",
        icon: Database,
        title: t("settings.libraryScan"),
        value: libraryScanValue,
        meta: libraryScanMeta,
        tone: "gold",
        actionType: "library_scan",
        buttonLabel: system.library.scanning ? t("common.scanning") : t("settings.scanLibrary")
      },
      {
        kind: "font",
        key: "font",
        section: "output",
        icon: Type,
        title: t("settings.font"),
        value: fontChoices.find((choice) => choice.id === fontTheme)?.label ?? "System Neo",
        meta: t("settings.chooseFont"),
        tone: "cyan"
      },
      {
        kind: "appearance",
        key: "appearance",
        section: "output",
        icon: Palette,
        title: t("settings.skin"),
        value: surfaceThemeChoices.find((choice) => choice.id === surfaceTheme)?.label ?? "Warm Gold",
        meta: t("settings.chooseSkin"),
        tone: "gold"
      },
      {
        kind: "lyrics",
        key: "lyrics",
        section: "output",
        icon: Captions,
        title: t("settings.lyrics"),
        value: lyricsVisible ? t("common.visible") : t("common.hidden"),
        meta: t("settings.chooseLyrics"),
        tone: lyricsVisible ? "gold" : "neutral"
      },
      {
        kind: "readonly",
        key: "system",
        section: "system",
        icon: Info,
        title: t("settings.system"),
        value: status.source === "api" ? t("common.online") : t("settings.limited"),
        meta: status.error ? t("settings.needsAttention") : `CPU ${system.cpuTemp}C - ${system.uptime}`,
        tone: status.source === "api" ? "neutral" : "warn"
      },
      {
        kind: "webMode",
        key: "web-mode",
        section: "network",
        icon: Globe2,
        title: "Explore",
        value: webModeProxyEnabled ? t("common.proxy") : t("common.direct"),
        meta: webModeProxyEnabled ? t("settings.proxyReady") : t("settings.officialWebPlayers"),
        tone: webModeProxyEnabled ? "cyan" : "neutral"
      },
      {
        kind: "action",
        key: "restart",
        section: "system",
        icon: RotateCcw,
        title: t("settings.restart"),
        value: t("settings.confirmNeeded"),
        meta: t("settings.systemReboot"),
        tone: "warn",
        actionType: "reboot",
        buttonLabel: t("settings.restartSystem"),
        confirmLabel: t("settings.tapAgainRestart")
      },
      {
        kind: "action",
        key: "shutdown",
        section: "system",
        icon: Power,
        title: t("settings.shutdown"),
        value: t("settings.confirmNeeded"),
        meta: t("settings.powerOff"),
        tone: "danger",
        actionType: "shutdown",
        buttonLabel: t("settings.shutdownSystem"),
        confirmLabel: t("settings.tapAgainPowerOff")
      }
    ],
    [activeMultiroom, displayedAudioOutputProfile, enabledMultiroomCount, fontTheme, libraryScanMeta, libraryScanValue, localTrackCount, lyricsFontSize, lyricsVisible, multiroomMeta, multiroomNeedsSetup, multiroomValue, nasCardMeta, nasCardTone, nasCardValue, preferences.displaySleepEnabled, preferences.displaySleepMinutes, preferences.displaySleepStyle, preferences.locale, roomExperience.nightSchedule.active, roomExperience.nightSchedule.enabled, roomExperience.nightSchedule.end, roomExperience.nightSchedule.start, roomExperience.nightSchedule.timeZone, status.error, status.source, surfaceTheme, system.cpuTemp, system.display.brightnessPercent, system.display.controllable, system.library.scanning, system.network.ip, system.network.label, system.network.speed, system.uptime, t, usbCardMeta, usbCardValue, usbTrackCount, webModeProxyEnabled, webModeProxyUrl]
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
      setBrightnessError(localizedErrorMessage(error, "error.brightness"));
    } finally {
      setPendingBrightness(null);
    }
  }

  async function handleDisplaySleepEnabledChange(enabled: boolean) {
    if (preferencesPending) return;
    setDisplaySleepError(null);
    try {
      await setDisplaySleepPreferences({ displaySleepEnabled: enabled });
    } catch (error) {
      setDisplaySleepError(localizedErrorMessage(error, "error.generic"));
    }
  }

  async function handleDisplaySleepMinutesChange(minutes: typeof displaySleepMinuteChoices[number]) {
    if (preferencesPending || preferences.displaySleepMinutes === minutes) return;
    setDisplaySleepError(null);
    try {
      await setDisplaySleepPreferences({ displaySleepMinutes: minutes });
    } catch (error) {
      setDisplaySleepError(localizedErrorMessage(error, "error.generic"));
    }
  }

  async function handleDisplaySleepStyleChange(style: DisplaySleepStyle) {
    if (preferencesPending || preferences.displaySleepStyle === style) return;
    setDisplaySleepError(null);
    try {
      await setDisplaySleepPreferences({ displaySleepStyle: style });
    } catch (error) {
      setDisplaySleepError(localizedErrorMessage(error, "error.generic"));
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
      setNightError(localizedErrorMessage(error, "error.generic"));
    } finally {
      setPendingNight(false);
    }
  }

  async function handleLocaleSelect(locale: UiLocale) {
    if (localePending || preferences.locale === locale) return;
    setLocaleMessage(null);
    try {
      const nextPreferences = await setLocale(locale);
      setLocaleMessage(nextPreferences.warning ? t("settings.languageSavedWithWarning") : t("settings.languageSaved"));
    } catch (error) {
      setLocaleMessage(localizedErrorMessage(error, "error.generic"));
    }
  }

  async function handleMultiroomToggle(id: MultiroomEcosystemId, enabled: boolean) {
    if (multiroomPendingId) return;
    setMultiroomPendingId(id);
    setMultiroomError(null);
    try {
      setMultiroomState(await updateMultiroomEcosystem(id, { enabled }));
    } catch (error) {
      setMultiroomError(localizedErrorMessage(error, "error.generic"));
    } finally {
      setMultiroomPendingId(null);
    }
  }

  async function handleAudioOutputProfileChange(profile: AudioOutputProfile) {
    if (preferencesPending || displayedAudioOutputProfile === profile) return;
    setMpdQualityError(null);
    setAudioOutputPendingProfile(profile);
    setAudioOutputPendingCustomSettings(null);
    try {
      await setAudioOutputProfile(profile);
      setAudioDiagnostics(null);
    } catch (error) {
      setAudioOutputPendingProfile(null);
      setAudioOutputPendingCustomSettings(null);
      setMpdQualityError(localizedErrorMessage(error, "error.generic"));
    }
  }

  async function handleAudioOutputCustomSettingChange(setting: AudioOutputCustomSettingId, enabled: boolean) {
    if (preferencesPending) return;
    setMpdQualityError(null);
    const nextCustomSettings = {
      ...displayedAudioOutputCustomSettings,
      [setting]: enabled
    };
    setAudioOutputPendingProfile("custom");
    setAudioOutputPendingCustomSettings(nextCustomSettings);
    try {
      await setAudioOutputCustomSettings(nextCustomSettings);
      setAudioDiagnostics(null);
    } catch (error) {
      setAudioOutputPendingProfile(null);
      setAudioOutputPendingCustomSettings(null);
      setMpdQualityError(localizedErrorMessage(error, "error.generic"));
    }
  }

  async function loadAudioDiagnostics() {
    setAudioDiagnosticsPending(true);
    setAudioDiagnosticsError(null);
    try {
      setAudioDiagnostics(await fetchAudioOutputDiagnostics());
    } catch (error) {
      setAudioDiagnosticsError(localizedErrorMessage(error, "error.generic"));
    } finally {
      setAudioDiagnosticsPending(false);
    }
  }

  function openAudioDiagnostics() {
    clearAudioDiagnosticsPressTimer();
    setDetailView("audioDiagnostics");
    void loadAudioDiagnostics();
  }

  function clearAudioDiagnosticsPressTimer() {
    if (audioDiagnosticsTimerRef.current !== null) {
      window.clearTimeout(audioDiagnosticsTimerRef.current);
      audioDiagnosticsTimerRef.current = null;
    }
  }

  function armAudioDiagnosticsPress() {
    clearAudioDiagnosticsPressTimer();
    audioDiagnosticsTimerRef.current = window.setTimeout(() => {
      audioDiagnosticsTimerRef.current = null;
      openAudioDiagnostics();
    }, 850);
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
        [card.actionType]: localizedErrorMessage(error, "error.generic")
      }));
    } finally {
      setPendingAction(null);
    }
  }

  function handleNasFormPatch(patch: Partial<NasSourceInput>) {
    setNasForm((current) => ({ ...current, ...patch }));
    setNasTestReady(false);
    setNasError(null);
    setNasErrorRaw(null);
    setNasMessage(null);
  }

  function openNasAddForm(candidate?: NasDiscoverCandidate) {
    setNasForm(candidate ? buildNasFormFromCandidate(candidate) : blankNasForm);
    setNasFormVisible(true);
    setSelectedNasId(null);
    setNasPasswordVisible(false);
    setNasTestReady(false);
    setNasDeleteConfirmId(null);
    setNasError(null);
    setNasErrorRaw(null);
    setNasMessage(candidate ? t("nas.reviewThenTest") : t("nas.addShareHint"));
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
    setSelectedNasId(source.id);
    setNasPasswordVisible(false);
    setNasTestReady(false);
    setNasDeleteConfirmId(null);
    setNasError(null);
    setNasErrorRaw(null);
    setNasMessage(t("nas.editThenTest"));
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
    setNasErrorRaw(null);
    setNasMessage(t("nas.testing"));
    try {
      const payload = buildNasSavePayload();
      const result = await testNasSource(payload, payload.id || "_draft");
      setNasTestReady(result.ok);
      setNasMessage(result.ok ? (result.trackCount !== undefined ? t("nas.readyTrackCount", { count: result.trackCount.toLocaleString() }) : t("nas.status.ready")) : null);
      setNasError(result.ok ? null : result.lastError || t("nas.status.checkSetup"));
      setNasErrorRaw(result.ok ? null : result.lastRawError ?? result.source?.lastRawError ?? null);
      if (result.ok) {
        void refreshLibraryStorageCounts().catch(() => undefined);
        void refreshNasSources().catch(() => undefined);
      }
    } catch (error) {
      setNasTestReady(false);
      setNasError(readableNasErrorMessage(error));
      setNasErrorRaw(error instanceof Error ? error.message : null);
      setNasMessage(null);
    } finally {
      setNasPendingAction(null);
    }
  }

  async function handleNasSaveAndScan() {
    if (nasPendingAction) return;
    setNasPendingAction("save");
    setNasError(null);
    setNasErrorRaw(null);
    setNasMessage(t("common.saving"));
    try {
      const payload = buildNasSavePayload();
      const saved = await saveNasSource(payload);
      setNasSourcesState(saved);
      const savedSource = findSavedNasSource(saved.sources, payload);
      if (savedSource && !savedSource.readOnly) {
        setNasMessage(t("nas.scanning"));
        const mounted = await mountNasSource(savedSource.id);
        setNasSourcesState(mounted);
        setSelectedNasId(savedSource.id);
      }
      await refreshLibraryStorageCounts();
      setNasFormVisible(false);
      setNasForm(blankNasForm);
      setNasPasswordVisible(false);
      setNasTestReady(false);
      setNasMessage(t("nas.status.ready"));
      setNasErrorRaw(null);
    } catch (error) {
      setNasError(readableNasErrorMessage(error));
      setNasErrorRaw(error instanceof Error ? error.message : null);
      setNasMessage(null);
    } finally {
      setNasPendingAction(null);
    }
  }

  async function handleNasScanNetwork() {
    if (nasPendingAction) return;
    setNasPendingAction("scan");
    setNasError(null);
    setNasErrorRaw(null);
    setNasMessage(t("nas.scanning"));
    try {
      const result = await discoverNasSources();
      setNasCandidates(result.candidates);
      setNasCandidatePage(0);
      setNasMessage(result.candidates.length > 0 ? t("nas.foundShares", { count: result.candidates.length }) : t("nas.noSharesFound"));
    } catch (error) {
      setNasError(readableNasErrorMessage(error));
      setNasErrorRaw(error instanceof Error ? error.message : null);
      setNasMessage(null);
    } finally {
      setNasPendingAction(null);
    }
  }

  async function handleNasMount(sourceId: string) {
    if (nasPendingAction) return;
    setNasPendingAction("mount");
    setNasError(null);
    setNasErrorRaw(null);
    setNasMessage(t("nas.scanning"));
    try {
      setNasSourcesState(await mountNasSource(sourceId));
      setSelectedNasId(sourceId);
      await refreshLibraryStorageCounts();
      setNasMessage(t("nas.status.ready"));
      setNasErrorRaw(null);
    } catch (error) {
      setNasError(readableNasErrorMessage(error));
      setNasErrorRaw(error instanceof Error ? error.message : null);
      setNasMessage(null);
    } finally {
      setNasPendingAction(null);
    }
  }

  async function handleNasUnmount(sourceId: string) {
    if (nasPendingAction) return;
    setNasPendingAction("unmount");
    setNasError(null);
    setNasErrorRaw(null);
    try {
      setNasSourcesState(await unmountNasSource(sourceId));
      setSelectedNasId(sourceId);
      await refreshLibraryStorageCounts();
      setNasMessage(t("nas.status.offline"));
      setNasErrorRaw(null);
    } catch (error) {
      setNasError(readableNasErrorMessage(error));
      setNasErrorRaw(error instanceof Error ? error.message : null);
    } finally {
      setNasPendingAction(null);
    }
  }

  async function handleNasDelete(sourceId: string) {
    if (nasPendingAction) return;
    if (nasDeleteConfirmId !== sourceId) {
      setSelectedNasId(sourceId);
      setNasDeleteConfirmId(sourceId);
      setNasMessage(t("nas.deleteQuestion"));
      setNasError(null);
      setNasErrorRaw(null);
      return;
    }
    setNasPendingAction("delete");
    setNasError(null);
    setNasErrorRaw(null);
    try {
      setNasSourcesState(await deleteNasSource(sourceId));
      await refreshLibraryStorageCounts();
      setNasDeleteConfirmId(null);
      setSelectedNasId(null);
      setNasMessage(t("nas.removed"));
      setNasErrorRaw(null);
    } catch (error) {
      setNasError(readableNasErrorMessage(error));
      setNasErrorRaw(error instanceof Error ? error.message : null);
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
      setRoomShortcutError(localizedErrorMessage(error, "error.generic"));
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
      <section className="settings-detail-panel" aria-label={t("settings.skin")} data-settings-detail="appearance">
        <div className="settings-detail-header">
          <button className="settings-detail-back" type="button" onClick={() => setDetailView(null)}>
            {t("common.close")}
          </button>
          <div>
            <span>{t("settings.preferences")}</span>
            <strong>{t("settings.skin")}</strong>
            <p>{t("settings.switchSkin")}</p>
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
      <section className="settings-detail-panel" aria-label={t("settings.font")} data-settings-detail="font">
        <div className="settings-detail-header">
          <button className="settings-detail-back" type="button" onClick={() => setDetailView(null)}>
            {t("common.close")}
          </button>
          <div>
            <span>{t("settings.preferences")}</span>
            <strong>{t("settings.font")}</strong>
            <p>{t("settings.chooseTypography")}</p>
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

  function renderLanguageDetail() {
    const selectedLanguage = languageOptions.find((option) => option.locale === preferences.locale) ?? languageOptions[0];
    const languageStatus = localeMessage ?? (localeError ? t("error.generic") : t("settings.languageDetail"));

    return (
      <section className="settings-detail-panel" aria-label={t("settings.language")} data-settings-detail="language">
        <div className="settings-detail-header">
          <button className="settings-detail-back" type="button" onClick={() => setDetailView(null)}>
            {t("common.close")}
          </button>
          <div>
            <span>{t("settings.preferences")}</span>
            <strong>{t("settings.language")}</strong>
            <p>{languageStatus}</p>
          </div>
        </div>

        <div className="font-theme-options language-options-detail" role="group" aria-label={t("settings.language")}>
          {languageOptions.map((option) => (
            <button
              key={option.locale}
              className={`font-theme-option ${preferences.locale === option.locale ? "is-active" : ""}`}
              type="button"
              aria-pressed={preferences.locale === option.locale}
              disabled={localePending}
              onClick={() => void handleLocaleSelect(option.locale)}
            >
              <strong>{option.label}</strong>
              <span>{preferences.locale === option.locale ? t("common.current") : t("settings.tapToUse")}</span>
            </button>
          ))}
        </div>

        <p className={`settings-card-action language-input-status ${localePending ? "is-applying" : ""}`} title={preferences.inputMethodId}>
          {localePending ? t("common.applying") : `${selectedLanguage.label} · ${t("settings.keyboardDefault")}`}
        </p>
      </section>
    );
  }

  function renderAudioOutputDetail() {
    const profileChoices: Array<{ id: AudioOutputProfile; icon: typeof Waves; label: string; sample: string; traits: string }> = [
      {
        id: "pure",
        icon: Target,
        label: t("settings.audioProfile.pure"),
        sample: t("settings.audioProfile.pureHint"),
        traits: t("settings.audioProfile.pureTraits")
      },
      {
        id: "everyday",
        icon: Volume2,
        label: t("settings.audioProfile.everyday"),
        sample: t("settings.audioProfile.everydayHint"),
        traits: t("settings.audioProfile.everydayTraits")
      },
      {
        id: "sleep",
        icon: Moon,
        label: t("settings.audioProfile.sleep"),
        sample: t("settings.audioProfile.sleepHint"),
        traits: t("settings.audioProfile.sleepTraits")
      },
      {
        id: "custom",
        icon: SlidersHorizontal,
        label: t("settings.audioProfile.custom"),
        sample: t("settings.audioProfile.customHint"),
        traits: t("settings.audioProfile.customTraits")
      }
    ];
    const customSettingChoices: Array<{ id: AudioOutputCustomSettingId; label: string; hint: string }> = [
      {
        id: "pureDirect",
        label: t("settings.audioCustom.pureDirect"),
        hint: t("settings.audioCustom.pureDirectHint")
      },
      {
        id: "volumeNormalization",
        label: t("settings.audioCustom.volumeNormalization"),
        hint: t("settings.audioCustom.volumeNormalizationHint")
      },
      {
        id: "smoothTransition",
        label: t("settings.audioCustom.smoothTransition"),
        hint: t("settings.audioCustom.smoothTransitionHint")
      },
      {
        id: "automaticSampleRate",
        label: t("settings.audioCustom.automaticSampleRate"),
        hint: t("settings.audioCustom.automaticSampleRateHint")
      },
      {
        id: "dsdMode",
        label: t("settings.audioCustom.dsdMode"),
        hint: t("settings.audioCustom.dsdModeHint")
      },
      {
        id: "playbackStability",
        label: t("settings.audioCustom.playbackStability"),
        hint: t("settings.audioCustom.playbackStabilityHint")
      }
    ];

    return (
      <section className={`settings-detail-panel ${displayedAudioOutputProfile === "custom" ? "is-custom-active" : ""}`} aria-label={t("settings.audioOutput")} data-settings-detail="audio-output">
        <div className="settings-detail-header">
          <button className="settings-detail-back" type="button" onClick={() => setDetailView(null)}>
            {t("common.close")}
          </button>
          <div>
            <span>{t("settings.preferences")}</span>
            <div className="audio-output-title-row">
              <strong
                onPointerDown={armAudioDiagnosticsPress}
                onPointerUp={clearAudioDiagnosticsPressTimer}
                onPointerCancel={clearAudioDiagnosticsPressTimer}
                onPointerLeave={clearAudioDiagnosticsPressTimer}
                title={t("settings.audioDiagnosticsHint")}
              >
                {t("settings.audioOutput")}
              </strong>
              <button
                className="audio-output-diagnostics-chip"
                type="button"
                title={t("settings.audioDiagnosticsHint")}
                onClick={openAudioDiagnostics}
                onPointerDown={armAudioDiagnosticsPress}
                onPointerUp={clearAudioDiagnosticsPressTimer}
                onPointerCancel={clearAudioDiagnosticsPressTimer}
                onPointerLeave={clearAudioDiagnosticsPressTimer}
              >
                <Info size={14} />
                <span>{t("settings.audioDiagnosticsChip")}</span>
              </button>
              <p className="audio-output-header-dac">
                <span>DAC:</span>
                <em>{system.outputDevice.label} · {system.outputDevice.detail}</em>
              </p>
            </div>
            <p className="audio-output-header-hint">{t("settings.audioDiagnosticsTitleHint")}</p>
          </div>
        </div>

        <div className={`audio-output-detail-body ${displayedAudioOutputProfile === "custom" ? "is-custom-active" : ""}`}>
          <div className="font-theme-options audio-profile-options-detail" role="group" aria-label={t("settings.mpdQuality")}>
            {profileChoices.map((choice) => {
              const Icon = choice.icon;
              return (
              <button
                key={choice.id}
                className={`font-theme-option audio-profile-option ${displayedAudioOutputProfile === choice.id ? "is-active" : ""} ${choice.id === "custom" ? "is-custom-profile" : ""}`}
                type="button"
                aria-pressed={displayedAudioOutputProfile === choice.id}
                data-audio-output-profile={choice.id}
                disabled={preferencesPending}
                onClick={() => void handleAudioOutputProfileChange(choice.id)}
              >
                <Icon size={22} />
                <strong>{choice.label}</strong>
                <span>{choice.sample}</span>
                <em>{choice.traits}</em>
              </button>
              );
            })}
          </div>
          {displayedAudioOutputProfile === "custom" ? (
            <div className="custom-audio-settings-panel" role="group" aria-label={t("settings.audioProfile.custom")} data-custom-audio-settings>
              <p className="custom-audio-warning" data-custom-audio-warning>{t("settings.audioCustom.warning")}</p>
              {customSettingChoices.map((choice) => {
                const enabled = displayedAudioOutputCustomSettings[choice.id];
                return (
                  <button
                    key={choice.id}
                    className={`custom-audio-toggle ${enabled ? "is-active" : ""}`}
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    title={choice.hint}
                    data-custom-audio-toggle={choice.id}
                    data-custom-audio-toggle-state={enabled ? "on" : "off"}
                    disabled={preferencesPending}
                    onClick={() => void handleAudioOutputCustomSettingChange(choice.id, !enabled)}
                  >
                    <span className="custom-audio-switch" aria-hidden="true">
                      <i />
                      <b>{enabled ? t("common.on") : t("common.off")}</b>
                    </span>
                    <strong>{choice.label}</strong>
                    <em>{choice.hint}</em>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        {mpdQualityError || preferencesPending ? (
          <p className={`settings-card-action ${mpdQualityError ? "is-error" : preferencesPending ? "is-applying" : ""}`}>
            {mpdQualityError ?? t("common.applying")}
          </p>
        ) : null}
      </section>
    );
  }

  function renderAudioDiagnosticsDetail() {
    const rawDiagnosticsText = audioDiagnostics?.text?.trim() ?? "";
    const diagnosticsText = rawDiagnosticsText
      || (audioDiagnosticsPending ? t("settings.audioDiagnosticsLoading") : t("settings.audioDiagnosticsUnavailable"));
    const diagnostics = parseAudioDiagnosticsText(rawDiagnosticsText);
    const profileKey = audioDiagnostics?.profile ?? displayedAudioOutputProfile;
    const updatedAtLabel = audioDiagnostics?.updatedAt
      ? new Date(audioDiagnostics.updatedAt).toLocaleTimeString(preferences.locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : t("common.unavailable");
    const activeStream = diagnostics.activeHwParams[0] ?? null;
    const ownerLabel = diagnostics.ownerPids.length > 0
      ? diagnostics.ownerPids.map((pid) => `PID ${pid}`).join(" · ")
      : t("settings.audioDiagnosticsNoDacOwner");

    return (
      <section className="settings-detail-panel" aria-label={t("settings.audioDiagnostics")} data-settings-detail="audio-diagnostics">
        <div className="settings-detail-header">
          <button className="settings-detail-back" type="button" onClick={() => setDetailView("audioOutput")}>
            {t("common.close")}
          </button>
          <div>
            <span>{t("settings.preferences")}</span>
            <strong>{t("settings.audioDiagnostics")}</strong>
          </div>
        </div>

        <div className="settings-diagnostics-panel">
          {rawDiagnosticsText ? (
            <>
              <div className="settings-diagnostics-grid" data-audio-diagnostics-grid>
                <article className="settings-diagnostics-card">
                  <span>{t("settings.audioDiagnosticsProfile")}</span>
                  <dl>
                    <div>
                      <dt>{t("settings.audioDiagnosticsProfile")}</dt>
                      <dd>{t(`settings.audioProfile.${profileKey}`)}</dd>
                    </div>
                    <div>
                      <dt>{t("settings.audioDiagnosticsUpdated")}</dt>
                      <dd>{updatedAtLabel}</dd>
                    </div>
                  </dl>
                </article>
                <article className="settings-diagnostics-card">
                  <span>{t("settings.audioDiagnosticsMpd")}</span>
                  <dl>
                    <div>
                      <dt>{t("settings.audioDiagnosticsOutput")}</dt>
                      <dd>{diagnostics.outputName ?? t("common.unavailable")}</dd>
                    </div>
                    <div>
                      <dt>{t("settings.audioDiagnosticsDevice")}</dt>
                      <dd>{diagnostics.outputDevice ?? t("common.unavailable")}</dd>
                    </div>
                    <div>
                      <dt>{t("settings.audioDiagnosticsReplayGain")}</dt>
                      <dd>{diagnostics.replayGain ?? t("common.unavailable")}</dd>
                    </div>
                    <div>
                      <dt>{t("settings.audioDiagnosticsCrossfade")}</dt>
                      <dd>{diagnostics.crossfade ?? t("common.unavailable")}</dd>
                    </div>
                  </dl>
                </article>
                <article className="settings-diagnostics-card">
                  <span>{t("settings.audioDiagnosticsAlsa")}</span>
                  {activeStream ? (
                    <dl>
                      <div>
                        <dt>{t("settings.audioDiagnosticsDevice")}</dt>
                        <dd>{activeStream.label}</dd>
                      </div>
                      <div>
                        <dt>{t("settings.audioDiagnosticsRate")}</dt>
                        <dd>{activeStream.rate ?? t("common.unavailable")}</dd>
                      </div>
                      <div>
                        <dt>{t("settings.audioDiagnosticsFormat")}</dt>
                        <dd>{activeStream.format ?? t("common.unavailable")}</dd>
                      </div>
                      <div>
                        <dt>{t("settings.audioDiagnosticsChannels")}</dt>
                        <dd>{activeStream.channels ?? t("common.unavailable")}</dd>
                      </div>
                    </dl>
                  ) : (
                    <p>{t("settings.audioDiagnosticsNoActiveStream")}</p>
                  )}
                </article>
                <article className="settings-diagnostics-card">
                  <span>{t("settings.audioDiagnosticsOwner")}</span>
                  <dl>
                    <div>
                      <dt>{t("settings.audioDiagnosticsOwner")}</dt>
                      <dd>{ownerLabel}</dd>
                    </div>
                    <div>
                      <dt>{t("settings.audioDiagnosticsState")}</dt>
                      <dd>{diagnostics.ownerPids.length > 0 ? t("settings.audioDiagnosticsOwnerHint") : t("settings.audioDiagnosticsNoDacOwner")}</dd>
                    </div>
                  </dl>
                </article>
              </div>

              <details className="settings-diagnostics-raw" open={!diagnostics.parsed}>
                <summary>{t("settings.audioDiagnosticsRaw")}</summary>
                <pre>{diagnosticsText}</pre>
              </details>
            </>
          ) : (
            <div className="settings-diagnostics-empty">{diagnosticsText}</div>
          )}
        </div>

        <div className={`settings-card-action ${audioDiagnosticsError ? "is-error" : ""}`}>
          {audioDiagnosticsError ?? (
            <button className="settings-inline-action" type="button" disabled={audioDiagnosticsPending} onClick={() => void loadAudioDiagnostics()}>
              {audioDiagnosticsPending ? t("common.loading") : t("remote.refresh")}
            </button>
          )}
        </div>
      </section>
    );
  }

  function getMultiroomEcosystemStatus(id: MultiroomEcosystemId) {
    const state = multiroomEcosystems?.[id];
    if (id === "music_assistant" || state?.comingSoon) return t("settings.multiroomComingSoon");
    if (state?.active) return t("settings.multiroomPlaying");
    if (state?.enabled && state?.ready) return t("settings.multiroomReady");
    if (state?.enabled && state?.lastError) return t("settings.multiroomCheckSetup");
    if (state?.enabled) return t("settings.multiroomStarting");
    if (state?.ready) return t("common.off");
    if (state?.lastError) return t("settings.multiroomCheckSetup");
    return t("common.off");
  }

  function renderMultiroomDetail() {
    const statusText = multiroomError ?? t("settings.multiroomReleaseBody");

    return (
      <section className="settings-detail-panel" aria-label={t("settings.multiroomAudio")} data-settings-detail="multiroom">
        <div className="settings-detail-header">
          <button className="settings-detail-back" type="button" onClick={() => setDetailView(null)}>
            {t("common.close")}
          </button>
          <div>
            <span>{t("settings.preferences")}</span>
            <strong>{t("settings.multiroomAudio")}</strong>
            <p className={multiroomError ? "is-error" : undefined}>{statusText}</p>
          </div>
        </div>

        <div className="multiroom-ecosystem-grid">
          {multiroomEcosystemChoices.map((id) => {
            const state = multiroomEcosystems?.[id];
            const pending = multiroomPendingId === id;
            const comingSoon = id === "music_assistant" || state?.comingSoon;
            const Icon = id === "roon"
              ? Waves
              : id === "lyrion"
                ? RadioIcon
                : id === "tikpal"
                  ? Server
                  : Info;
            const title = t(`settings.multiroom.ecosystem.${id}`);
            const stack = t(`settings.multiroom.stack.${id}`);
            const enabled = state?.enabled === true;
            const status = pending ? t("common.applying") : getMultiroomEcosystemStatus(id);
            const hint = comingSoon
              ? t("settings.multiroomComingSoonHint")
              : state?.active
                ? t("settings.multiroomActiveHint", { label: title })
                : enabled
                  ? t("settings.multiroomWaitingHint")
                  : t("settings.multiroomReadyToStartHint");

            return (
              <article className={`multiroom-ecosystem-card ${enabled ? "is-enabled" : ""} ${state?.active ? "is-active" : ""} ${comingSoon ? "is-disabled" : ""}`} key={id}>
                <div className="multiroom-ecosystem-head">
                  <span className="multiroom-ecosystem-icon">
                    <Icon size={24} />
                  </span>
                  <span>
                    <strong>{title}</strong>
                    <em className={pending ? "is-applying" : state?.lastError ? "is-error" : undefined} title={state?.lastError ?? undefined}>{status}</em>
                  </span>
                </div>
                <p className="multiroom-ecosystem-stack" title={stack}>{stack}</p>
                <p>{hint}</p>
                <button
                  className={`settings-inline-action multiroom-ecosystem-toggle ${enabled ? "is-active" : ""}`}
                  type="button"
                  disabled={comingSoon || pending || Boolean(multiroomPendingId && multiroomPendingId !== id)}
                  aria-pressed={enabled}
                  onClick={() => void handleMultiroomToggle(id, !enabled)}
                >
                  {comingSoon ? t("settings.multiroomComingSoon") : enabled ? t("settings.multiroomStop", { label: title }) : t("settings.multiroomStart", { label: title })}
                </button>
              </article>
            );
          })}
        </div>
      </section>
    );
  }

  function renderLyricsDetail() {
    return (
      <section className="settings-detail-panel" aria-label={t("settings.lyrics")} data-settings-detail="lyrics">
        <div className="settings-detail-header">
          <button className="settings-detail-back" type="button" onClick={() => setDetailView(null)}>
            {t("common.close")}
          </button>
          <div>
            <span>{t("settings.preferences")}</span>
            <strong>{t("settings.lyrics")}</strong>
            <p>{lyricsVisible ? t("settings.lyricsVisible") : t("settings.lyricsHidden")}</p>
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
              <strong>{lyricsVisible ? t("lyrics.hide") : t("lyrics.show")}</strong>
              <em>{lyricsVisible ? t("settings.lyricsVisible") : t("settings.lyricsHidden")}</em>
            </span>
            <i>{lyricsVisible ? t("common.on") : t("common.off")}</i>
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
                <strong>{t(`settings.lyricsSize.${choice.id}`)}</strong>
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
    const savedSources = [...configuredSources, ...manualSources];
    const selectedSource = sources.find((source) => source.id === selectedNasId) ?? configuredSources[0] ?? manualSources[0] ?? null;
    const sourcePageCount = Math.max(1, Math.ceil(savedSources.length / NAS_PANEL_PAGE_SIZE));
    const candidatePageCount = Math.max(1, Math.ceil(nasCandidates.length / NAS_PANEL_PAGE_SIZE));
    const safeSourcePage = Math.min(nasSourcePage, sourcePageCount - 1);
    const safeCandidatePage = Math.min(nasCandidatePage, candidatePageCount - 1);
    const visibleSources = savedSources.slice(safeSourcePage * NAS_PANEL_PAGE_SIZE, safeSourcePage * NAS_PANEL_PAGE_SIZE + NAS_PANEL_PAGE_SIZE);
    const visibleCandidates = nasCandidates.slice(safeCandidatePage * NAS_PANEL_PAGE_SIZE, safeCandidatePage * NAS_PANEL_PAGE_SIZE + NAS_PANEL_PAGE_SIZE);
    const busy = nasPendingAction !== null;
    const showNasForm = nasFormVisible || !selectedSource;
    const requiredNasFieldsReady = nasForm.host.trim().length > 0 && nasForm.share.trim().length > 0;
    const selectedSourceNeedsSetup = Boolean(selectedSource && selectedSource.status !== "ready" && selectedSource.sourceKind !== "manual");
    const nasFormGuidance = !requiredNasFieldsReady
      ? t("nas.requiredHint")
      : nasTestReady
        ? t("nas.readySaveScan")
        : t("nas.testFirst");
    const sourceStatus = nasError
      ?? nasMessage
      ?? (showNasForm
        ? t("nas.addShareHint")
        : nasTrackCount > 0
          ? t("nas.trackCountReady", { count: nasTrackCount.toLocaleString() })
          : selectedSourceNeedsSetup
            ? t("nas.checkSetupNext")
            : configuredSources.length > 0
              ? t("nas.testFirst")
            : t("settings.addNasInSettings"));
    const sourceStatusTitle = nasError ? nasErrorRaw ?? nasError : undefined;

    return (
      <section className="settings-detail-panel" aria-label="NAS sources detail" data-settings-detail="nas">
        <div className="settings-detail-header">
            <button className="settings-detail-back" type="button" onClick={() => setDetailView(null)}>
              {t("common.close")}
            </button>
            <div>
              <span>{t("settings.library")}</span>
              <strong>{t("settings.nasSources")}</strong>
              <p title={sourceStatusTitle}>{sourceStatus}</p>
            </div>
        </div>

        <div className="nas-source-detail">
          <div className="nas-detail-left" data-nas-detail-left>
            <div className="nas-source-toolbar">
              <button type="button" onClick={() => openNasAddForm()} disabled={busy}>
                <Plus size={18} />
                  <span>{t("nas.addNas")}</span>
                </button>
                <button type="button" onClick={() => void handleNasScanNetwork()} disabled={busy}>
                  <Search size={18} />
                  <span>{nasPendingAction === "scan" ? t("nas.scanning") : t("nas.scanNetwork")}</span>
                </button>
              </div>

              <section className="nas-list-section" aria-label={t("nas.savedNas")}>
                <div className="nas-list-heading">
                  <strong>{t("nas.savedNas")}</strong>
                  <span>{savedSources.length}</span>
                </div>
                <div className="nas-list-cards">
                  {visibleSources.length > 0 ? visibleSources.map((source) => {
                    const badge = source.sourceKind === "manual" ? t("nas.status.manual") : source.status === "ready" ? null : nasStatusLabel(source.status, t);
                  return (
                    <button
                      key={source.id}
                      className={`nas-list-card ${selectedSource?.id === source.id && !nasFormVisible ? "is-active" : ""}`}
                      type="button"
                      onClick={() => {
                        setSelectedNasId(source.id);
                        setNasFormVisible(false);
                        setNasDeleteConfirmId(null);
                        setNasError(null);
                        setNasErrorRaw(null);
                      }}
                      >
                        {badge ? <span>{badge}</span> : null}
                        <strong>{source.name}</strong>
                      <em title={source.host ? `//${source.host}:${source.port}/${source.share}` : source.mpdPath ?? "NAS"}>
                        {source.trackCount > 0 ? t("nas.readyTrackCount", { count: source.trackCount.toLocaleString() }) : source.share || source.mpdPath || "NAS"}
                      </em>
                      </button>
                    );
                  }) : (
                    <article className="nas-empty-card">
                      <strong>{t("nas.noNasYet")}</strong>
                      <span>{t("nas.scanOrAdd")}</span>
                    </article>
                  )}
                </div>
                {savedSources.length > NAS_PANEL_PAGE_SIZE ? (
                  <div className="nas-pager">
                    <button type="button" disabled={safeSourcePage === 0} onClick={() => setNasSourcePage((page) => Math.max(0, page - 1))}>{t("playback.previous")}</button>
                    <span>{safeSourcePage + 1} / {sourcePageCount}</span>
                    <button type="button" disabled={safeSourcePage >= sourcePageCount - 1} onClick={() => setNasSourcePage((page) => Math.min(sourcePageCount - 1, page + 1))}>{t("playback.next")}</button>
                  </div>
                ) : null}
              </section>

              <section className="nas-list-section" aria-label={t("nas.scanResults")}>
                <div className="nas-list-heading">
                  <strong>{t("nas.scanResults")}</strong>
                  <span>{nasCandidates.length}</span>
                </div>
              <div className="nas-candidate-list">
                {visibleCandidates.length > 0 ? visibleCandidates.map((candidate) => (
                  <button key={`${candidate.host}:${candidate.port}/${candidate.share}/${candidate.path}`} type="button" onClick={() => openNasAddForm(candidate)} disabled={busy}>
                    <Server size={18} />
                    <span>
                      <strong>{candidate.name}</strong>
                      <em>{`//${candidate.host}:${candidate.port}/${candidate.share}`}</em>
                    </span>
                  </button>
                  )) : (
                    <article className="nas-empty-card">
                      <strong>{t("nas.noResults")}</strong>
                      <span>{t("nas.noResultsHint")}</span>
                    </article>
                  )}
                </div>
                {nasCandidates.length > NAS_PANEL_PAGE_SIZE ? (
                  <div className="nas-pager">
                    <button type="button" disabled={safeCandidatePage === 0} onClick={() => setNasCandidatePage((page) => Math.max(0, page - 1))}>{t("playback.previous")}</button>
                    <span>{safeCandidatePage + 1} / {candidatePageCount}</span>
                    <button type="button" disabled={safeCandidatePage >= candidatePageCount - 1} onClick={() => setNasCandidatePage((page) => Math.min(candidatePageCount - 1, page + 1))}>{t("playback.next")}</button>
                  </div>
                ) : null}
            </section>
          </div>

          <div className="nas-detail-right" data-nas-detail-right>
            {showNasForm ? (
              <form
                className="nas-source-form"
                data-auth-mode={nasForm.authMode}
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleNasSaveAndScan();
                }}
              >
                  <div className="nas-panel-header">
                    <span>{nasForm.id ? t("nas.editNas") : t("nas.addNas")}</span>
                    <strong>{nasForm.name || nasForm.share || t("nas.newNas")}</strong>
                    <p>{nasFormGuidance}</p>
                  </div>

                <div className="nas-form-actions nas-primary-actions">
                  <button
                    type="button"
                    onClick={() => void handleNasTest()}
                    disabled={busy || !requiredNasFieldsReady}
                    title={requiredNasFieldsReady ? t("nas.testFirst") : t("nas.requiredHint")}
                  >
                      {nasPendingAction === "test" ? t("nas.testing") : t("nas.test")}
                    </button>
                    <button
                      type="submit"
                      disabled={busy || !nasTestReady}
                      title={nasTestReady ? t("nas.readySaveScan") : t("nas.testFirst")}
                    >
                      {nasPendingAction === "save" ? t("common.saving") : t("nas.saveScan")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNasFormVisible(false);
                      setNasForm(blankNasForm);
                      setNasTestReady(false);
                      setNasError(null);
                      setNasErrorRaw(null);
                      setNasMessage(null);
                    }}
                  >
                      {t("common.cancel")}
                  </button>
                </div>

                  <div className="nas-form-grid">
                    <label className="night-field">
                      <span>{t("nas.name")}</span>
                    <input
                      value={nasForm.name}
                      autoComplete="off"
                      onChange={(event) => handleNasFormPatch({ name: event.currentTarget.value, mountName: nasForm.mountName || event.currentTarget.value })}
                    />
                  </label>
                    <label className="night-field">
                      <span>{t("nas.serverIp")}</span>
                    <input
                      value={nasForm.host}
                      inputMode="url"
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => handleNasFormPatch({ host: event.currentTarget.value })}
                    />
                  </label>
                    <label className="night-field">
                      <span>{t("nas.share")}</span>
                    <input
                      value={nasForm.share}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => handleNasFormPatch({ share: event.currentTarget.value, mountName: nasForm.mountName || event.currentTarget.value })}
                    />
                  </label>
                    <label className="night-field">
                      <span>{t("nas.folder")}</span>
                    <input
                      value={nasForm.path ?? ""}
                      autoComplete="off"
                      spellCheck={false}
                        placeholder={t("nas.optional")}
                      onChange={(event) => handleNasFormPatch({ path: event.currentTarget.value })}
                    />
                  </label>
                    <label className="night-field">
                      <span>{t("nas.port")}</span>
                    <input
                      value={nasForm.port ?? 445}
                      inputMode="numeric"
                      onChange={(event) => handleNasFormPatch({ port: Number(event.currentTarget.value) || 445 })}
                    />
                  </label>
                    <label className="night-field">
                      <span>{t("nas.localName")}</span>
                    <input
                      value={nasForm.mountName ?? ""}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => handleNasFormPatch({ mountName: event.currentTarget.value })}
                    />
                  </label>
                  {nasForm.authMode === "password" ? (
                    <>
                        <label className="night-field">
                          <span>{t("nas.username")}</span>
                        <input
                          value={nasForm.username ?? ""}
                          autoComplete="username"
                          spellCheck={false}
                          onChange={(event) => handleNasFormPatch({ username: event.currentTarget.value })}
                        />
                      </label>
                        <label className="night-field nas-password-field">
                          <span>{t("nas.password")}</span>
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
                              aria-label={nasPasswordVisible ? t("nas.hidePassword") : t("nas.showPassword")}
                              title={nasPasswordVisible ? t("nas.hidePassword") : t("nas.showPassword")}
                            onClick={() => setNasPasswordVisible((visible) => !visible)}
                          >
                            {nasPasswordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                          </button>
                        </span>
                      </label>
                    </>
                  ) : null}
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
                        <strong>{t("nas.guest")}</strong>
                        <em>{t("nas.noPassword")}</em>
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
                        <strong>{t("nas.account")}</strong>
                        <em>{t("nas.accountPassword")}</em>
                    </span>
                  </button>
                </div>
              </form>
            ) : selectedSource ? (
              <article className={`nas-source-card nas-panel-card tone-${selectedSource.status === "ready" ? "cyan" : "neutral"}`}>
                <div className="nas-panel-header">
                    {selectedSource.sourceKind === "manual" || selectedSource.status !== "ready" ? (
                      <span>{selectedSource.sourceKind === "manual" ? t("nas.status.manual") : nasStatusLabel(selectedSource.status, t)}</span>
                    ) : null}
                    <strong>{selectedSource.name}</strong>
                    <p>{selectedSource.host ? `//${selectedSource.host}:${selectedSource.port}/${selectedSource.share}` : t("nas.loadedFromEnvironment")}</p>
                  </div>
                  <dl>
                    <div>
                      <dt>{t("nas.tracks")}</dt>
                      <dd>{selectedSource.trackCount.toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>{t("nas.share")}</dt>
                      <dd title={selectedSource.host ? `//${selectedSource.host}:${selectedSource.port}/${selectedSource.share}` : selectedSource.mpdPath ?? undefined}>
                        {selectedSource.share || selectedSource.mpdPath || "NAS"}
                      </dd>
                    </div>
                  </dl>
                  {selectedSource.lastError ? (
                    <em className="nas-source-error" title={selectedSource.lastRawError ?? selectedSource.lastError}>
                      {selectedSource.lastError}
                    </em>
                  ) : null}
                  {selectedSource.status !== "ready" && selectedSource.sourceKind !== "manual" ? (
                    <p className="nas-source-next-step">{t("nas.checkSetupNext")}</p>
                  ) : null}
                  {selectedSource.readOnly ? (
                    <p className="nas-readonly-note">{t("nas.readOnlyEnvironment")}</p>
                  ) : (
                    <div className="nas-source-actions nas-panel-actions">
                      <button type="button" onClick={() => void handleNasMount(selectedSource.id)} disabled={busy}>
                        {selectedSource.status === "ready" ? t("nas.scan") : t("nas.mount")}
                      </button>
                      <button type="button" onClick={() => void handleNasUnmount(selectedSource.id)} disabled={busy}>{t("nas.unmount")}</button>
                      <button type="button" onClick={() => openNasEditForm(selectedSource)} disabled={busy}>{t("nas.edit")}</button>
                      {nasDeleteConfirmId === selectedSource.id ? (
                        <span className="nas-delete-confirm">
                          <em>{t("common.deleteQuestion")}</em>
                          <button type="button" onClick={() => void handleNasDelete(selectedSource.id)} disabled={busy}>{t("common.yes")}</button>
                          <button type="button" onClick={() => setNasDeleteConfirmId(null)} disabled={busy}>{t("common.no")}</button>
                        </span>
                      ) : (
                        <button type="button" className="nas-danger-action" onClick={() => void handleNasDelete(selectedSource.id)} disabled={busy}>{t("nas.delete")}</button>
                      )}
                  </div>
                )}
              </article>
            ) : (
                <article className="nas-source-card nas-panel-card tone-neutral">
                  <div className="nas-panel-header">
                    <span>{t("nas.noNasYet")}</span>
                    <strong>{t("nas.addOrScan")}</strong>
                    <p>{t("nas.manageHere")}</p>
                  </div>
              </article>
            )}
          </div>
        </div>
      </section>
    );
  }

    function renderWebModeDetail() {
      const statusText = webModeError
        ?? (webModeState?.settings.proxyEnabled ? t("settings.proxyReady") : t("explore.directConnection"));

    return (
      <section className="settings-detail-panel" aria-label="Explore detail" data-settings-detail="web-mode">
        <div className="settings-detail-header">
            <button className="settings-detail-back" type="button" onClick={() => setDetailView(null)}>
              {t("common.close")}
            </button>
            <div>
              <span>{t("settings.link")}</span>
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
                <strong>{t("common.proxy")}</strong>
                <em>{webModeProxyEnabled ? t("common.on") : t("common.direct")}</em>
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
              <span><Type size={16} /> {t("explore.font")}</span>
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

            <p className="web-mode-settings-help">{t("settings.exploreHelp")}</p>
        </div>
      </section>
    );
  }

  function renderDisplayDetail() {
    const brightnessPercent = pendingBrightness ?? system.display.brightnessPercent;
    const brightnessBusy = pendingBrightness !== null;
    const brightnessDisabled = !system.display.controllable || pendingAction !== null || brightnessBusy;
    const sleepEnabled = preferences.displaySleepEnabled;

    return (
      <section className="settings-detail-panel" aria-label="Display detail" data-settings-detail="display">
        <div className="settings-detail-header">
          <button className="settings-detail-back" type="button" onClick={() => setDetailView(null)}>
            {t("common.close")}
          </button>
          <div>
            <span>{t("settings.preferences")}</span>
            <strong>{t("settings.display")}</strong>
            <p>{displaySleepError ?? brightnessError ?? t("settings.screenSleepMeta")}</p>
          </div>
        </div>

        <div className="display-brightness-panel display-brightness-panel-detail">
          <div className="display-brightness-header">
            <strong>{brightnessPercent}% {t("settings.displayBrightness")}</strong>
            <em title={system.display.transport}>{system.display.controllable ? t("settings.hardware") : t("common.unavailable")}</em>
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
              {t("settings.dimStep")}
            </button>
            <button
              className="display-brightness-step"
              type="button"
              disabled={brightnessDisabled || brightnessPercent >= 100}
              onClick={() => void handleBrightnessAdjust(brightnessPercent + 10)}
            >
              {t("settings.boostStep")}
            </button>
          </div>
          <em className={`settings-card-action ${brightnessBusy ? "is-applying" : ""}`}>
            {system.display.controllable
              ? brightnessBusy
                ? t("settings.applyingPercent", { percent: brightnessPercent })
                : t("settings.brightnessPanel")
              : t("common.unavailable")}
          </em>
        </div>

        <div className="display-sleep-panel" data-settings-display-sleep>
          <button
            className={`night-toggle display-sleep-toggle ${sleepEnabled ? "is-active" : ""}`}
            type="button"
            aria-pressed={sleepEnabled}
            disabled={preferencesPending}
            onClick={() => void handleDisplaySleepEnabledChange(!sleepEnabled)}
          >
            <Moon size={26} />
            <span>
              <strong>{t("settings.screenSleep")}</strong>
              <em>{sleepEnabled ? t("common.on") : t("common.off")}</em>
            </span>
          </button>

          <div className="night-field display-sleep-field display-sleep-style-field">
            <span className="display-sleep-field-heading">
              <span>{t("settings.sleepStyle")}</span>
              <button
                className="display-sleep-preview-button"
                type="button"
                disabled={preferencesPending}
                onClick={onPreviewScreenSaver}
              >
                {t("settings.previewSleepStyle")}
              </button>
            </span>
            <div className="display-sleep-presets display-sleep-style-presets" role="group" aria-label="Screen sleep style">
              {displaySleepStyleChoices.map((style) => (
                <button
                  key={style}
                  className={`display-brightness-preset ${preferences.displaySleepStyle === style ? "is-active" : ""}`}
                  type="button"
                  aria-pressed={preferences.displaySleepStyle === style}
                  disabled={preferencesPending}
                  onClick={() => void handleDisplaySleepStyleChange(style)}
                >
                  {t(`settings.sleepStyle.${style}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="night-field display-sleep-field">
            <span className="display-sleep-field-heading">
              <span>{t("settings.turnOffAfter")}</span>
            </span>
            <div className="display-sleep-presets" role="group" aria-label="Screen sleep time">
              {displaySleepMinuteChoices.map((minutes) => (
                <button
                  key={minutes}
                  className={`display-brightness-preset ${preferences.displaySleepMinutes === minutes ? "is-active" : ""}`}
                  type="button"
                  aria-pressed={preferences.displaySleepMinutes === minutes}
                  disabled={preferencesPending}
                  onClick={() => void handleDisplaySleepMinutesChange(minutes)}
                >
                  {t("settings.sleepAfterMinutes", { minutes })}
                </button>
              ))}
            </div>
          </div>
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
      <section className="settings-detail-panel" aria-label={t("settings.timeNight")} data-settings-detail="night">
        <div className="settings-detail-header">
          <button className="settings-detail-back" type="button" onClick={() => setDetailView(null)}>
            {t("common.close")}
          </button>
          <div>
            <span>{t("settings.preferences")}</span>
            <strong>{t("settings.timeNight")}</strong>
            <p>{nightError ?? `${schedule.timeZone} · ${schedule.active ? t("settings.nightActive") : t("settings.dayMode")}`}</p>
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
              <span>{t("settings.console")}</span>
              <strong>{sectionLabel(activeSection)}</strong>
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
                    <span className={pendingShortcut ? "is-applying" : undefined}>{pendingShortcut ? shortcut.id === "explore" ? t("common.opening") : t("common.applying") : shortcut.id === "explore" ? t("source.explore") : t(`room.${shortcut.id}`)}</span>
                  </button>
                );
              })}
              <button
                className="console-room-shortcut console-room-back"
                data-room-shortcut="back"
                data-console-back-button
                type="button"
                aria-label={t("common.close")}
                onClick={handleReturnAmbient}
              >
                <PanelRightClose size={17} />
                <span>{t("common.close")}</span>
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
                <span>{sectionLabel(tab.id)}</span>
              </button>
            );
          })}
        </nav>

        <div className="settings-content">
          <header className="settings-section-header">
            <span>{sectionLabel(activeSection)}</span>
            <strong>{sectionDescription(activeSection)}</strong>
          </header>

          {detailView === "appearance"
            ? renderAppearanceDetail()
            : detailView === "audioDiagnostics"
              ? renderAudioDiagnosticsDetail()
            : detailView === "audioOutput"
              ? renderAudioOutputDetail()
            : detailView === "display"
            ? renderDisplayDetail()
              : detailView === "language"
                ? renderLanguageDetail()
                : detailView === "font"
                  ? renderFontDetail()
                  : detailView === "lyrics"
                    ? renderLyricsDetail()
                    : detailView === "nas"
                      ? renderNasDetail()
                      : detailView === "night"
                        ? renderNightDetail()
                        : detailView === "multiroom"
                          ? renderMultiroomDetail()
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

              if (card.kind === "audioOutput") {
                return (
                  <button
                    className={`settings-card settings-card-button settings-card-summary settings-card-audio-output tone-${card.tone}`}
                    key={card.key}
                    type="button"
                    onClick={() => openDetail("audioOutput")}
                  >
                    <div className="settings-icon">
                      <Volume2 size={32} />
                    </div>
                    <div>
                      <span>{card.title}</span>
                      <strong>{card.value}</strong>
                      <p>{card.meta}</p>
                      <em className="settings-card-action">{t("settings.openAudioOutput")}</em>
                    </div>
                  </button>
                );
              }

              if (card.kind === "multiroom") {
                return (
                  <button
                    className={`settings-card settings-card-button settings-card-summary settings-card-multiroom tone-${card.tone}`}
                    key={card.key}
                    type="button"
                    onClick={() => openDetail("multiroom")}
                  >
                    <div className="settings-icon">
                      <Waves size={32} />
                    </div>
                    <div>
                      <span>{card.title}</span>
                      <strong>{card.value}</strong>
                      <p>{card.meta}</p>
                      <em className={`settings-card-action ${multiroomPendingId ? "is-applying" : ""}`}>{multiroomPendingId ? t("common.applying") : t("settings.manageRooms")}</em>
                    </div>
                  </button>
                );
              }

              if (card.kind === "language") {
                return (
                  <button
                    className={`settings-card settings-card-button settings-card-summary settings-card-language tone-${card.tone}`}
                    key={card.key}
                    type="button"
                    onClick={() => openDetail("language")}
                  >
                    <div className="settings-icon">
                      <Globe2 size={32} />
                    </div>
                    <div>
                      <span>{card.title}</span>
                      <strong>{card.value}</strong>
                      <p>{card.meta}</p>
                      <em className={`settings-card-action ${localePending ? "is-applying" : ""}`}>{localePending ? t("common.applying") : t("settings.language")}</em>
                    </div>
                  </button>
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
                      <em className="settings-card-action">{t("settings.openFont")}</em>
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
                      <em className="settings-card-action">{t("settings.openSkin")}</em>
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
                      <em className="settings-card-action">{t("settings.openLyrics")}</em>
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
                          : t("settings.display")}
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
                      <em className="settings-card-action">{t("settings.nightBrightness", { percent: roomExperience.nightSchedule.brightnessPercent })}</em>
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
                      <em className="settings-card-action">{t("nas.manage")}</em>
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
                      <em className="settings-card-action">{t("settings.proxyKeyboard")}</em>
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
                    <em className={`settings-card-action ${isPending ? "is-applying" : ""}`}>{isPending ? t("common.applying") : card.buttonLabel}</em>
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

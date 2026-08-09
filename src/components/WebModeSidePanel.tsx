import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Apple, Cloud, Gem, Globe2, Music2, PanelRightClose, ShoppingBag, SquarePlay, Type, Volume2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { fetchTikpalState, fetchWebModeState, sendPlaybackAction, sendWebModeAction } from "../api/tikpalClient";
import { useI18n } from "../i18n";
import type { TikpalState, WebModeProviderId, WebModeProviderSummary, WebModeState } from "../types";

const providerOrder: WebModeProviderId[] = [
  "suno",
  "spotify",
  "youtube_music",
  "apple_music",
  "tidal",
  "qobuz",
  "deezer",
  "amazon_music",
  "qq_music",
  "netease_music"
];

const providerLabels: Record<WebModeProviderId, string> = {
  suno: "Suno",
  spotify: "Spotify",
  youtube_music: "YouTube Music",
  apple_music: "Apple Music",
  tidal: "TIDAL",
  qobuz: "Qobuz",
  deezer: "Deezer",
  amazon_music: "Amazon Music",
  qq_music: "QQ Music",
  netease_music: "NetEase Cloud Music"
};

const providerIcons: Record<WebModeProviderId, LucideIcon> = {
  suno: Music2,
  spotify: Music2,
  youtube_music: SquarePlay,
  apple_music: Apple,
  tidal: Gem,
  qobuz: Music2,
  deezer: Music2,
  amazon_music: ShoppingBag,
  qq_music: Music2,
  netease_music: Cloud
};

const providerTones: Record<WebModeProviderId, string> = {
  suno: "#ff7a59",
  spotify: "#1ed760",
  youtube_music: "#ff0033",
  apple_music: "#f5f5f7",
  tidal: "#ffffff",
  qobuz: "#c7a45d",
  deezer: "#b77cff",
  amazon_music: "#46c4ff",
  qq_music: "#20d070",
  netease_music: "#e64040"
};

const textScaleChoices = [
  { value: 1, label: "Small" },
  { value: 1.1, label: "Medium" },
  { value: 1.2, label: "Large" }
];

function readInitialOpeningProvider(): WebModeProviderId | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("opening") as WebModeProviderId | null;
  return value && providerOrder.includes(value) ? value : null;
}

function inferFailedProviderFromError(error: string | null): WebModeProviderId | null {
  if (!error) return null;
  const normalizedError = error.trim().toLowerCase();
  if (!/\bneeds proxy(?: on)?\b|\bdid not open\b|\bdid not enter\b|\bdid not become ready\b/.test(normalizedError)) return null;
  return providerOrder.find((id) => normalizedError.startsWith(providerLabels[id].toLowerCase())) ?? null;
}

function isProxyNeededError(error: string | null, providerId: WebModeProviderId | null) {
  if (!error || !providerId) return false;
  const normalizedError = error.trim().toLowerCase();
  return normalizedError.startsWith(providerLabels[providerId].toLowerCase()) && /\bneeds proxy(?: on)?\b/.test(normalizedError);
}

export function WebModeSidePanel() {
  const { t, friendlyError } = useI18n();
  const [webMode, setWebMode] = useState<WebModeState | null>(null);
  const [tikpalState, setTikpalState] = useState<TikpalState | null>(null);
  const [pendingProvider, setPendingProvider] = useState<WebModeProviderId | null>(readInitialOpeningProvider);
  const [pendingAction, setPendingAction] = useState<"close" | "scale" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actionLockRef = useRef(false);
  const activeProvider = webMode?.activeProvider ?? null;
  const volumePercent = tikpalState?.system.volume.percent ?? 0;
  const providerTextScale = webMode?.settings.providerTextScale ?? 1.1;
  const proxyEnabled = webMode?.settings.proxyEnabled ?? true;
  const failedProvider = useMemo(() => inferFailedProviderFromError(error), [error]);
  const failedProviderNeedsProxy = isProxyNeededError(error, failedProvider);
  const effectiveActiveProvider = activeProvider && activeProvider !== failedProvider ? activeProvider : null;

  const providers = useMemo<WebModeProviderSummary[]>(() => {
    const byId = new Map(webMode?.providers.map((provider) => [provider.id, provider]) ?? []);
    return providerOrder.map((id) => {
      const provider = byId.get(id);
      return {
        id,
        label: providerLabels[id],
        url: provider?.url ?? "",
        experimental: provider?.experimental ?? false
      };
    });
  }, [webMode?.providers]);

  const activeProviderLabel = useMemo(() => {
    if (!effectiveActiveProvider) return t("explore.noWebPlayer");
    return providerLabels[effectiveActiveProvider] ?? "Web player";
  }, [effectiveActiveProvider, t]);

  const displayProviderLabel = pendingProvider ? providerLabels[pendingProvider] : failedProvider ? providerLabels[failedProvider] : activeProviderLabel;
  const panelState = pendingAction === "close" ? "closing" : pendingProvider ? "switching" : "ready";
  const panelTone = pendingProvider
    ? providerTones[pendingProvider]
    : effectiveActiveProvider
      ? providerTones[effectiveActiveProvider]
      : "#81d7ff";

  function providerStatusLabel(providerId: WebModeProviderId, flags: {
    active: boolean;
    connecting: boolean;
    current: boolean;
    failed: boolean;
    experimental: boolean;
  }) {
    if (flags.connecting) return t("common.connecting");
    if (flags.current) return t("common.current");
    if (flags.active) return t("common.active");
    if (flags.failed) return failedProviderNeedsProxy && providerId === failedProvider ? t("common.needProxyOn") : t("common.failed");
    const residentStatus = webMode?.residentProviders?.[providerId]?.status;
    if (residentStatus === "opening") return t("common.opening");
    if (residentStatus === "prewarming") return t("common.prewarming");
    if (residentStatus === "check_setup") return t("common.checkSetup");
    if (residentStatus === "check_proxy") return t("common.needProxyOn");
    if (residentStatus === "ready") return t("common.ready");
    if (flags.experimental) return t("common.experimental");
    return t("common.waiting");
  }

  function applyWebModeState(next: WebModeState) {
    setWebMode(next);
    setError(next.lastError);
    setPendingProvider((current) => (
      current && (next.activeProvider === current || next.lastError) ? null : current
    ));
  }

  async function refresh() {
    const [nextWebMode, nextTikpalState] = await Promise.all([
      fetchWebModeState(),
      fetchTikpalState()
    ]);
    applyWebModeState(nextWebMode);
    setTikpalState(nextTikpalState);
  }

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const [nextWebMode, nextTikpalState] = await Promise.all([
          fetchWebModeState(),
          fetchTikpalState()
        ]);
        if (cancelled) return;
        applyWebModeState(nextWebMode);
        setTikpalState(nextTikpalState);
      } catch (nextError) {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : "Explore unavailable");
      }
    }
    void tick();
    const timer = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  async function openProvider(providerId: WebModeProviderId) {
    if (actionLockRef.current || pendingProvider || pendingAction) return;
    if (activeProvider === providerId) return;
    actionLockRef.current = true;
    setPendingProvider(providerId);
    setError(null);
    try {
      const next = await sendWebModeAction({ type: "open", provider: providerId });
      applyWebModeState(next);
    } catch (nextError) {
      setPendingProvider(null);
      setError(nextError instanceof Error ? nextError.message : "Provider switch failed");
    } finally {
      setPendingProvider(null);
      await refresh().catch(() => undefined);
      actionLockRef.current = false;
    }
  }

  async function closeWebMode() {
    if (actionLockRef.current || pendingAction || pendingProvider) return;
    actionLockRef.current = true;
    setPendingAction("close");
    setError(null);
    try {
      const next = await sendWebModeAction({ type: "close" });
      setWebMode(next);
      await refresh().catch(() => undefined);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Close failed");
    } finally {
      setPendingAction(null);
      actionLockRef.current = false;
    }
  }

  async function setProviderTextScale(nextScale: number) {
    if (!webMode || actionLockRef.current || pendingAction || pendingProvider) return;
    if (Math.abs(providerTextScale - nextScale) < 0.001) return;
    actionLockRef.current = true;
    setPendingAction("scale");
    setError(null);
    try {
      const next = await sendWebModeAction({ type: "provider_text_scale", providerTextScale: nextScale });
      setWebMode(next);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Text scale update failed");
    } finally {
      setPendingAction(null);
      actionLockRef.current = false;
    }
  }

  async function updateVolume(nextValue: number) {
    const percent = Math.max(0, Math.min(100, Math.round(nextValue)));
    setTikpalState((current) => current ? {
      ...current,
      system: {
        ...current.system,
        volume: {
          ...current.system.volume,
          percent
        }
      }
    } : current);
    try {
      const next = await sendPlaybackAction("volume_set", percent);
      setTikpalState(next);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Volume update failed");
    }
  }

  return (
    <main
      className={`web-mode-panel ${panelState === "closing" ? "is-closing" : ""} ${panelState === "switching" ? "is-switching" : ""}`}
      style={{ "--panel-tone": panelTone } as CSSProperties}
      data-web-mode-panel
      data-web-mode-state={panelState}
      aria-busy={panelState !== "ready"}
    >
      <header className="web-mode-panel-header">
        <div>
          <span>Explore</span>
          <strong>{displayProviderLabel}</strong>
        </div>
        <div className="web-mode-header-actions">
          <div
            className={`web-mode-proxy-chip web-mode-proxy-status ${proxyEnabled ? "is-proxy" : "is-off"}`}
            role="status"
            aria-label={`${proxyEnabled ? t("common.proxyOn") : t("common.proxyOff")}. ${t("explore.proxyChangeInSettings")}`}
            title={t("explore.proxyChangeInSettings")}
            data-web-mode-proxy-status
          >
            <Globe2 size={17} />
            <span>{proxyEnabled ? t("common.proxyOn") : t("common.proxyOff")}</span>
          </div>
          <button
            className="web-mode-top-back"
            type="button"
            disabled={Boolean(pendingAction || pendingProvider)}
            data-web-mode-top-back
            aria-label={t("common.close")}
            onClick={() => void closeWebMode()}
          >
            <PanelRightClose size={17} />
            <span>{pendingAction === "close" ? t("common.closing") : t("common.close")}</span>
          </button>
        </div>
      </header>

      <section className="web-mode-active-card" aria-label={t("explore.tikpalControls")}>
        <Globe2 size={30} />
        <div>
          <span>{t("explore.pickLeft")}</span>
          <strong>{displayProviderLabel}</strong>
          <p>{pendingProvider ? t("explore.openLeft") : failedProvider ? t("explore.couldNotOpen") : effectiveActiveProvider ? (webMode?.residentProviders?.[effectiveActiveProvider]?.status === "check_proxy" ? t("explore.proxyRequired") : proxyEnabled ? t("explore.proxyActive") : t("explore.directConnection")) : t("explore.chooseBelow")}</p>
        </div>
      </section>

      <section className="web-mode-provider-grid" aria-label={t("explore.webPlayers")}>
        {providers.map((provider) => {
          const Icon = providerIcons[provider.id] ?? Music2;
          const failed = failedProvider === provider.id && pendingProvider !== provider.id;
          const selected = effectiveActiveProvider === provider.id;
          const connecting = pendingProvider === provider.id;
          const current = selected && Boolean(pendingProvider) && !connecting;
          const active = selected && !pendingProvider;
          const residentStatus = webMode?.residentProviders?.[provider.id]?.status;
          const warming = residentStatus === "opening" || residentStatus === "prewarming";
          const proxyUnavailable = residentStatus === "check_proxy";
          return (
            <button
              key={provider.id}
              className={`web-mode-provider ${active && !proxyUnavailable ? "is-active" : ""} ${current ? "is-current" : ""} ${connecting || warming ? "is-connecting" : ""} ${failed || proxyUnavailable || residentStatus === "check_setup" ? "is-failed" : ""} ${proxyUnavailable ? "is-proxy-unavailable" : ""}`}
              type="button"
              disabled={Boolean(pendingAction || pendingProvider)}
              style={{ "--provider-tone": providerTones[provider.id] } as CSSProperties}
              aria-busy={connecting || warming}
              data-web-mode-provider={provider.id}
              onClick={() => void openProvider(provider.id)}
            >
              <span>
                <Icon size={24} />
              </span>
              <strong>{provider.label}</strong>
              <em>{providerStatusLabel(provider.id, { active, connecting, current, failed, experimental: provider.experimental })}</em>
            </button>
          );
        })}
      </section>

      <section className="web-mode-control-stack" aria-label={t("explore.tikpalControls")}>
        <div className="web-mode-text-scale" data-web-mode-text-scale>
          <span><Type size={18} /> {t("explore.font")}</span>
          <div className="web-mode-scale-options" role="group" aria-label={t("explore.leftFont")}>
            {textScaleChoices.map((choice) => (
              <button
                key={choice.label}
                className={`web-mode-scale-option ${Math.abs(providerTextScale - choice.value) < 0.001 ? "is-active" : ""}`}
                type="button"
                aria-pressed={Math.abs(providerTextScale - choice.value) < 0.001}
                disabled={!webMode || Boolean(pendingAction || pendingProvider)}
                data-web-mode-text-scale-option={choice.value}
                onClick={() => void setProviderTextScale(choice.value)}
              >
                {t(`explore.${choice.label.toLowerCase()}`)}
              </button>
            ))}
          </div>
        </div>
        <label className="web-mode-volume">
          <span><Volume2 size={18} /> {t("quickMenu.volume")}</span>
          <strong>{volumePercent}%</strong>
          <input
            type="range"
            min="0"
            max="100"
            value={volumePercent}
            onChange={(event) => void updateVolume(Number(event.currentTarget.value))}
          />
        </label>
      </section>

      <footer className="web-mode-panel-footer" role="status" title={error ?? undefined}>
        {friendlyError(error, "error.explore") ?? (pendingProvider ? `${t("common.connecting")} ${providerLabels[pendingProvider]}` : t("explore.footer"))}
      </footer>
    </main>
  );
}

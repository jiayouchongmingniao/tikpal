import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Apple, Cloud, Gem, Globe2, Music2, PanelRightClose, ShoppingBag, SquarePlay, Type, Volume2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { fetchTikpalState, fetchWebModeState, sendPlaybackAction, sendWebModeAction } from "../api/tikpalClient";
import { createExploreCloseRequestId, EXPLORE_CLOSE_CHANNEL, EXPLORE_CLOSE_COVER_FALLBACK_MS, isExploreCloseMessage, type ExploreCloseMessage } from "../exploreCloseVeil";
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

function postExploreCloseMessage(message: ExploreCloseMessage) {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(EXPLORE_CLOSE_CHANNEL);
    channel.postMessage(message);
    channel.close();
  } catch {}
}

function waitForExploreCloseCover(requestId: string) {
  if (typeof BroadcastChannel === "undefined") return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    let channel: BroadcastChannel | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      channel?.close();
      resolve();
    };
    try {
      channel = new BroadcastChannel(EXPLORE_CLOSE_CHANNEL);
      channel.onmessage = (event) => {
        if (!isExploreCloseMessage(event.data)) return;
        const message = event.data;
        if (message.type === "cover-ready" && message.requestId === requestId) finish();
      };
      timer = setTimeout(finish, EXPLORE_CLOSE_COVER_FALLBACK_MS + 100);
      channel.postMessage({ type: "cover-requested", requestId });
    } catch {
      finish();
    }
  });
}

export function WebModeSidePanel() {
  const { t, friendlyError } = useI18n();
  const [webMode, setWebMode] = useState<WebModeState | null>(null);
  const [tikpalState, setTikpalState] = useState<TikpalState | null>(null);
  const initialOpeningProviderRef = useRef<WebModeProviderId | null>(readInitialOpeningProvider());
  const [pendingProvider, setPendingProvider] = useState<WebModeProviderId | null>(initialOpeningProviderRef.current);
  const [pendingAction, setPendingAction] = useState<"close" | "scale" | null>(null);
  const pendingActionRef = useRef<"close" | "scale" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actionLockRef = useRef(false);
  const optimisticProviderRef = useRef<WebModeProviderId | null>(null);
  const [exploreOpening, setExploreOpening] = useState(false);
  const activeProvider = webMode?.activeProvider ?? null;
  const openingProvider = webMode?.openingProvider ?? null;
  const activationPhase = webMode?.activationPhase ?? null;
  const activationPending = activationPhase === "pending";
  const displayedOpeningProvider = activationPending
    ? (pendingProvider ?? openingProvider)
    : (pendingProvider ?? openingProvider);
  const volumePercent = tikpalState?.system.volume.percent ?? 0;
  const providerTextScale = webMode?.settings.providerTextScale ?? 1.1;
  const proxyEnabled = webMode?.settings.proxyEnabled ?? true;
  const [lastNonPendingActiveProvider, setLastNonPendingActiveProvider] = useState<WebModeProviderId | null>(activeProvider);
  const [activationEnterProvider, setActivationEnterProvider] = useState<WebModeProviderId | null>(null);
  const activationEnterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevActivationPhaseRef = useRef<typeof activationPhase>(activationPhase);
  const failedProvider = useMemo(() => inferFailedProviderFromError(error), [error]);
  const failedProviderNeedsProxy = isProxyNeededError(error, failedProvider);
  const effectiveActiveProvider = activationPending
    ? (lastNonPendingActiveProvider ?? null)
    : (activeProvider && activeProvider !== failedProvider ? activeProvider : null);
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

  const resolvedActiveLabel = activationEnterProvider
    ? (providerLabels[activationEnterProvider] ?? "Web player")
    : activeProviderLabel;
  const displayProviderLabel = displayedOpeningProvider ? providerLabels[displayedOpeningProvider] : failedProvider ? providerLabels[failedProvider] : resolvedActiveLabel;
  const [displayedActiveLabel, setDisplayedActiveLabel] = useState(displayProviderLabel);
  const [activeLabelVisible, setActiveLabelVisible] = useState(true);
  const activeLabelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (displayedActiveLabel === displayProviderLabel) return;
    setActiveLabelVisible(false);
    if (activeLabelTimerRef.current) clearTimeout(activeLabelTimerRef.current);
    activeLabelTimerRef.current = setTimeout(() => {
      setDisplayedActiveLabel(displayProviderLabel);
      setActiveLabelVisible(true);
      activeLabelTimerRef.current = null;
    }, 120);
    return () => {
      if (activeLabelTimerRef.current) {
        clearTimeout(activeLabelTimerRef.current);
        activeLabelTimerRef.current = null;
      }
    };
  }, [displayProviderLabel, displayedActiveLabel]);
  const panelState = pendingAction === "close" ? "closing" : displayedOpeningProvider ? "switching" : "ready";
  const panelTone = displayedOpeningProvider
    ? providerTones[displayedOpeningProvider]
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
    if (flags.connecting) return t("common.opening");
    if (flags.current) return t("common.current");
    if (flags.active) return t("common.active");
    if (flags.failed) return failedProviderNeedsProxy && providerId === failedProvider ? t("common.needProxyOn") : t("common.failed");
    const resident = webMode?.residentProviders?.[providerId];
    const residentStatus = resident?.status;
    if (resident?.activity === "frozen") return t("common.frozen");
    if (residentStatus === "opening") return t("common.opening");
    if (residentStatus === "prewarming") return t("common.prewarming");
    if (residentStatus === "check_setup") return t("common.checkSetup");
    if (residentStatus === "check_proxy") return t("common.needProxyOn");
    if (residentStatus === "region_unavailable") return t("common.regionUnavailable");
    if (residentStatus === "ready") return t("common.ready");
    if (flags.experimental) return t("common.experimental");
    return t("common.waiting");
  }

  function applyWebModeState(next: WebModeState) {
    const nextPhase = next.activationPhase ?? null;
    setWebMode(next);
    setError(next.lastError);
    setPendingProvider((current) => {
      // The panel is reused across resident switches. Its startup URL can
      // still contain the provider from a much older initial entry, so that
      // hint must never keep every card disabled once the API says otherwise.
      const initialOpeningProvider = initialOpeningProviderRef.current;
      if (current && current === initialOpeningProvider && next.openingProvider !== initialOpeningProvider) {
        initialOpeningProviderRef.current = null;
        return null;
      }
      if (next.openingProvider === initialOpeningProvider) initialOpeningProviderRef.current = null;
      return current && (nextPhase !== "pending" && next.activeProvider === current || next.lastError) ? null : current;
    });
    if (optimisticProviderRef.current && (next.activeProvider === optimisticProviderRef.current || next.lastError)) {
      optimisticProviderRef.current = null;
    }
    if (nextPhase !== "pending") {
      setLastNonPendingActiveProvider(next.activeProvider);
    }
    if (nextPhase === "pending") {
      if (activationEnterTimerRef.current) {
        clearTimeout(activationEnterTimerRef.current);
        activationEnterTimerRef.current = null;
      }
      setActivationEnterProvider(next.openingProvider ?? pendingProvider ?? openingProvider);
    } else if (prevActivationPhaseRef.current === "pending") {
      if (activationEnterTimerRef.current) {
        clearTimeout(activationEnterTimerRef.current);
      }
      activationEnterTimerRef.current = setTimeout(() => {
        activationEnterTimerRef.current = null;
        setActivationEnterProvider(null);
      }, 160);
    }
    prevActivationPhaseRef.current = nextPhase;
    // Reset close state when web mode becomes active again (reopen after close),
    // but only if no close action is in flight — polling may return activeProvider
    // while the background close is still running, which would abort the fade.
    if (next.activeProvider && pendingActionRef.current === "close" && !actionLockRef.current) {
      pendingActionRef.current = null;
      setPendingAction(null);
    }
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
    const timer = window.setInterval(() => void tick(), displayedOpeningProvider ? 100 : 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [displayedOpeningProvider]);


  // Listen for explore opening signal from main window
  useEffect(() => {
    const bc = new BroadcastChannel("tikpal-explore-open");
    bc.onmessage = (e) => {
      if (e.data === "opening") setExploreOpening(true);
    };
    return () => { bc.close(); };
  }, []);

  // Clear exploreOpening once the panel is ready
  useEffect(() => {
    if (!exploreOpening) return;
    const t = setTimeout(() => setExploreOpening(false), 200);
    return () => clearTimeout(t);
  }, [exploreOpening]);

  function findNextAvailableProvider(failedId: WebModeProviderId): WebModeProviderId | null {
    const statuses = webMode?.residentProviders;
    // Prefer providers that are already ready/active.
    const ready = providerOrder.find((id) => {
      if (id === failedId) return false;
      const s = statuses?.[id]?.status;
      return s === "ready" || s === "active";
    });
    if (ready) return ready;
    // Fall back to any provider not stuck in check_proxy/region_unavailable.
    return providerOrder.find((id) => {
      if (id === failedId) return false;
      const s = statuses?.[id]?.status;
      return s && s !== "check_proxy" && s !== "region_unavailable" && s !== "check_setup";
    }) ?? null;
  }

  async function openProvider(providerId: WebModeProviderId) {
    if (actionLockRef.current || pendingProvider || pendingAction) return;
    if (activeProvider === providerId) return;
    actionLockRef.current = true;
    setPendingProvider(providerId);
    optimisticProviderRef.current = providerId;
    setError(null);
    try {
      const next = await sendWebModeAction({ type: "open", provider: providerId });
      applyWebModeState(next);
    } catch (nextError) {
      const fallback = findNextAvailableProvider(providerId);
      if (fallback) {
        try {
         setPendingProvider(fallback);
          optimisticProviderRef.current = fallback;
         const next = await sendWebModeAction({ type: "open", provider: fallback });
          applyWebModeState(next);
          setError(null);
       } catch (fallbackError) {
         setPendingProvider(null);
          optimisticProviderRef.current = null;
         setError(fallbackError instanceof Error ? fallbackError.message : "Provider switch failed");
       }
     } else {
       setPendingProvider(null);
        optimisticProviderRef.current = null;
       setError(nextError instanceof Error ? nextError.message : "Provider switch failed");
     }
    } finally {
      await refresh().catch(() => undefined);
      actionLockRef.current = false;
    }
  }

  async function closeWebMode() {
    if (actionLockRef.current || pendingAction || pendingProvider) return;
    actionLockRef.current = true;
    setPendingAction("close");
    pendingActionRef.current = "close";
    const closeRequestId = createExploreCloseRequestId();
    setError(null);
    optimisticProviderRef.current = null;
    await waitForExploreCloseCover(closeRequestId);
    try {
      const next = await sendWebModeAction({ type: "close" });
      postExploreCloseMessage({ type: "closed", requestId: closeRequestId, state: next });
    } catch (nextError) {
      postExploreCloseMessage({ type: "failed", requestId: closeRequestId });
      setError(nextError instanceof Error ? nextError.message : "Close failed");
    } finally {
      // Release the action lock so other actions are not blocked, but keep
      // pendingAction = "close" so the fade animation continues until polling
      // confirms the close completed (webModeActive becomes false). The
      // applyWebModeState handler or the component unmount will clear it.
      actionLockRef.current = false;
      // Safety: if polling never clears the close state (e.g. API error), reset
      // after the full fade-out duration so reopening is not permanently blocked.
      setTimeout(() => {
        if (pendingActionRef.current === "close") {
          pendingActionRef.current = null;
          setPendingAction(null);
        }
      }, 3500);
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
      className={`web-mode-panel ${panelState === "switching" ? "is-switching" : ""}`}
      style={{ "--panel-tone": panelTone } as CSSProperties}
      data-web-mode-panel
      data-web-mode-state={panelState}
      aria-busy={panelState !== "ready"}
      onContextMenu={(e) => e.preventDefault()}
    >
      <header className="web-mode-panel-header">
        <div>
          <span>Explore</span>
          <strong style={{ opacity: activeLabelVisible ? 1 : 0, transition: "opacity 120ms ease" }}>{displayedActiveLabel}</strong>
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
          <p>{displayedOpeningProvider ? t("explore.openLeft") : failedProvider ? t("explore.couldNotOpen") : effectiveActiveProvider ? (webMode?.residentProviders?.[effectiveActiveProvider]?.status === "check_proxy" ? t("explore.proxyRequired") : proxyEnabled ? t("explore.proxyActive") : t("explore.directConnection")) : t("explore.chooseBelow")}</p>
        </div>
      </section>

      <section className="web-mode-provider-grid" aria-label={t("explore.webPlayers")}>
        {providers.map((provider) => {
          const Icon = providerIcons[provider.id] ?? Music2;
          const failed = failedProvider === provider.id && displayedOpeningProvider !== provider.id;
          const selected = effectiveActiveProvider === provider.id;
          const connecting = displayedOpeningProvider === provider.id && optimisticProviderRef.current !== provider.id;
          const current = selected && Boolean(displayedOpeningProvider) && !connecting;
          const active = (selected && !displayedOpeningProvider) || optimisticProviderRef.current === provider.id;
          const residentStatus = webMode?.residentProviders?.[provider.id]?.status;
          const residentActivity = webMode?.residentProviders?.[provider.id]?.activity;
          const warming = residentStatus === "opening" || residentStatus === "prewarming";
          const proxyUnavailable = residentStatus === "check_proxy";
          return (
            <button
              key={provider.id}
              className={`web-mode-provider ${active && !proxyUnavailable ? "is-active" : ""} ${current ? "is-current" : ""} ${connecting || warming ? "is-connecting" : ""} ${failed || proxyUnavailable || residentStatus === "check_setup" ? "is-failed" : ""} ${proxyUnavailable ? "is-proxy-unavailable" : ""}`}
              type="button"
              disabled={Boolean(pendingAction || pendingProvider || (proxyUnavailable && !proxyEnabled))}
              style={{ "--provider-tone": providerTones[provider.id] } as CSSProperties}
              aria-busy={connecting || warming}
              data-web-mode-provider={provider.id}
              data-web-mode-provider-activity={residentActivity ?? "unknown"}
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
        {friendlyError(error, "error.explore") ?? (displayedOpeningProvider ? `${t("common.opening")} ${providerLabels[displayedOpeningProvider]}` : t("explore.footer"))}
      </footer>
      <div className={"web-mode-open-overlay" + (exploreOpening ? " active" : "")} />
    </main>
  );
}

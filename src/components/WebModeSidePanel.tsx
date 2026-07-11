import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Apple, Cloud, Gem, Globe2, Keyboard, LogOut, Music2, ShoppingBag, SquarePlay, Volume2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { fetchTikpalState, fetchWebModeState, sendPlaybackAction, sendWebModeAction } from "../api/tikpalClient";
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

function readInitialOpeningProvider(): WebModeProviderId | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("opening") as WebModeProviderId | null;
  return value && providerOrder.includes(value) ? value : null;
}

export function WebModeSidePanel() {
  const [webMode, setWebMode] = useState<WebModeState | null>(null);
  const [tikpalState, setTikpalState] = useState<TikpalState | null>(null);
  const [pendingProvider, setPendingProvider] = useState<WebModeProviderId | null>(readInitialOpeningProvider);
  const [pendingAction, setPendingAction] = useState<"close" | "keyboard" | "proxy" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actionLockRef = useRef(false);
  const activeProvider = webMode?.activeProvider ?? null;
  const volumePercent = tikpalState?.system.volume.percent ?? 0;

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
    if (!activeProvider) return "No web player";
    return providerLabels[activeProvider] ?? "Web player";
  }, [activeProvider]);

  const displayProviderLabel = pendingProvider ? providerLabels[pendingProvider] : activeProviderLabel;

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
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Close failed");
    } finally {
      setPendingAction(null);
      actionLockRef.current = false;
    }
  }

  async function toggleProxy() {
    if (!webMode || actionLockRef.current || pendingAction || pendingProvider) return;
    actionLockRef.current = true;
    setPendingAction("proxy");
    setError(null);
    try {
      const next = await sendWebModeAction({ type: "proxy", enabled: !webMode.settings.proxyEnabled });
      setWebMode(next);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Proxy update failed");
    } finally {
      setPendingAction(null);
      await refresh().catch(() => undefined);
      actionLockRef.current = false;
    }
  }

  async function toggleKeyboard() {
    if (actionLockRef.current || pendingAction || pendingProvider) return;
    actionLockRef.current = true;
    setPendingAction("keyboard");
    setError(null);
    try {
      const next = await sendWebModeAction({ type: "keyboard" });
      setWebMode(next);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Keyboard unavailable");
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
    <main className="web-mode-panel" data-web-mode-panel>
      <header className="web-mode-panel-header">
        <div>
          <span>Explore</span>
          <strong>{displayProviderLabel}</strong>
        </div>
        <div className="web-mode-header-actions">
          <button
            className={`web-mode-proxy-chip ${webMode?.settings.proxyEnabled ? "is-proxy" : ""}`}
            type="button"
            aria-pressed={Boolean(webMode?.settings.proxyEnabled)}
            disabled={!webMode || Boolean(pendingAction || pendingProvider)}
            data-web-mode-proxy-toggle
            onClick={() => void toggleProxy()}
          >
            <Globe2 size={17} />
            <span>{pendingAction === "proxy" ? "Saving" : webMode?.settings.proxyEnabled ? "Proxy" : "Direct"}</span>
          </button>
          <button
            className="web-mode-top-back"
            type="button"
            disabled={Boolean(pendingAction || pendingProvider)}
            data-web-mode-top-back
            onClick={() => void closeWebMode()}
          >
            <LogOut size={17} />
            <span>{pendingAction === "close" ? "Closing" : "Back"}</span>
          </button>
        </div>
      </header>

      <section className="web-mode-active-card" aria-label="Active web player">
        <Globe2 size={30} />
        <div>
          <span>Left display</span>
          <strong>{displayProviderLabel}</strong>
          <p>{pendingProvider ? "Connecting on the left display" : activeProvider ? (webMode?.settings.proxyEnabled ? webMode.settings.proxyUrl : "Direct browser access") : "Choose a web player below"}</p>
        </div>
      </section>

      <section className="web-mode-provider-grid" aria-label="Music web players">
        {providers.map((provider) => {
          const Icon = providerIcons[provider.id] ?? Music2;
          const selected = activeProvider === provider.id;
          const connecting = pendingProvider === provider.id;
          const current = selected && Boolean(pendingProvider) && !connecting;
          const active = selected && !pendingProvider;
          return (
            <button
              key={provider.id}
              className={`web-mode-provider ${active ? "is-active" : ""} ${current ? "is-current" : ""} ${connecting ? "is-connecting" : ""}`}
              type="button"
              style={{ "--provider-tone": providerTones[provider.id] } as CSSProperties}
              aria-busy={connecting}
              data-web-mode-provider={provider.id}
              onClick={() => void openProvider(provider.id)}
            >
              <span>
                <Icon size={24} />
              </span>
              <strong>{provider.label}</strong>
              <em>{connecting ? "Connecting" : current ? "Current" : active ? "Active" : provider.experimental ? "Experimental" : "Ready"}</em>
            </button>
          );
        })}
      </section>

      <section className="web-mode-control-stack" aria-label="Tikpal web controls">
        <label className="web-mode-volume">
          <span><Volume2 size={18} /> Volume</span>
          <strong>{volumePercent}%</strong>
          <input
            type="range"
            min="0"
            max="100"
            value={volumePercent}
            onChange={(event) => void updateVolume(Number(event.currentTarget.value))}
          />
        </label>
        <div className="web-mode-actions">
          <button
            className="web-mode-keyboard-toggle"
            type="button"
            aria-label="Show or hide keyboard"
            title="Show or hide keyboard"
            data-web-mode-keyboard-toggle
            onClick={() => void toggleKeyboard()}
            disabled={Boolean(pendingAction || pendingProvider)}
          >
            <Keyboard size={16} />
            <span>{pendingAction === "keyboard" ? "Opening" : "Keyboard"}</span>
          </button>
          <button type="button" onClick={() => void closeWebMode()} disabled={Boolean(pendingAction || pendingProvider)}>
            <LogOut size={19} />
            <span>{pendingAction === "close" ? "Closing" : "Back"}</span>
          </button>
        </div>
      </section>

      <footer className="web-mode-panel-footer" role="status">
        {error ?? (pendingProvider ? `Connecting to ${providerLabels[pendingProvider]}` : "Use the official player on the left. Tikpal controls stay here.")}
      </footer>
    </main>
  );
}

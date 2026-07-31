const API_ROOT = "http://127.0.0.1:8787/api/v1";
const BYPASS_LIST = ["localhost", "127.0.0.1", "[::1]", "<local>"];
const PROVIDER_TEXT_SCALE_VALUES = [1, 1.1, 1.2];
const FONT_THEME_VALUES = new Set(["system", "hardware", "precision", "sans", "serif", "mono"]);

export function normalizeProviderTextScale(value, fallback = 1.1) {
  const numeric = typeof value === "number" ? value : Number(String(value ?? "").trim());
  const rounded = Math.round(numeric * 100) / 100;
  const allowed = PROVIDER_TEXT_SCALE_VALUES.find((candidate) => Math.abs(candidate - rounded) < 0.001);
  return allowed ?? fallback;
}

export function normalizeFontTheme(value, fallback = "system") {
  const normalized = String(value ?? "").trim().toLowerCase().replaceAll("-", "_");
  return FONT_THEME_VALUES.has(normalized) ? normalized : fallback;
}

export function buildProxyConfig(settings = {}) {
  if (settings.proxyEnabled === false) return { mode: "direct" };

  let proxyUrl;
  try {
    const rawProxyUrl = String(settings.proxyUrl || "").trim();
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawProxyUrl) ? rawProxyUrl : `http://${rawProxyUrl}`;
    proxyUrl = new URL(candidate);
  } catch {
    throw new Error("Invalid Explore proxy URL");
  }

  const scheme = proxyUrl.protocol.replace(":", "");
  const port = Number(proxyUrl.port);
  if (!["http", "https", "socks5"].includes(scheme) || !proxyUrl.hostname || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Explore proxy must use HTTP, HTTPS, or SOCKS5 with an explicit port");
  }

  return {
    mode: "fixed_servers",
    rules: {
      singleProxy: { scheme, host: proxyUrl.hostname, port },
      bypassList: [...BYPASS_LIST]
    }
  };
}

export function buildProxyKey(settings = {}) {
  return JSON.stringify(buildProxyConfig(settings));
}

let appliedSettingsRevision = null;
let appliedProxyKey = null;
let syncPromise = null;

async function readState() {
  const response = await fetch(`${API_ROOT}/web-mode/state`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Explore state returned ${response.status}`);
  return response.json();
}

async function setProxy(value) {
  await chrome.proxy.settings.set({ value, scope: "regular" });
}

async function confirmApplied(settingsUpdatedAt) {
  const response = await fetch(`${API_ROOT}/web-mode/proxy-applied`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settingsUpdatedAt })
  });
  if (!response.ok) throw new Error(`Explore proxy confirmation returned ${response.status}`);
}

async function syncProxy() {
  const state = await readState();
  const revision = state.settings?.updatedAt;
  if (!revision) throw new Error("Explore proxy settings have no revision");
  const settings = state.settings || {};
  const proxyKey = buildProxyKey(settings);

  if (proxyKey !== appliedProxyKey) {
    await setProxy(buildProxyConfig(settings));
    appliedProxyKey = proxyKey;
  }
  if (revision !== appliedSettingsRevision) {
    await confirmApplied(revision);
    appliedSettingsRevision = revision;
  }

  return {
    ok: true,
    revision,
    proxyKey,
    providerTextScale: normalizeProviderTextScale(settings.providerTextScale),
    fontTheme: normalizeFontTheme(state.preferences?.fontTheme),
    providers: state.providers || []
  };
}

async function setKeyboardVisible(enabled, force = false) {
  const response = await fetch(`${API_ROOT}/web-mode/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "keyboard", enabled, force })
  });
  if (!response.ok) throw new Error(`Explore keyboard action returned ${response.status}`);
  return { ok: true };
}

function isAllowedNeteaseAudioUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return /(^|\.)music\.126\.net$/i.test(url.hostname) || /(^|\.)music\.163\.com$/i.test(url.hostname);
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function sendNeteaseAudioChunk(sender, payload) {
  if (!sender.tab?.id || !chrome.tabs?.sendMessage) throw new Error("No Explore tab for NetEase audio fetch");
  await new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(sender.tab.id, payload, { frameId: sender.frameId }, () => {
      const message = chrome.runtime.lastError?.message || "";
      if (message && !message.includes("message port closed before a response")) {
        reject(new Error(message));
        return;
      }
      resolve();
    });
  });
}

async function fetchNeteaseAudio(url, sender, id) {
  if (!isAllowedNeteaseAudioUrl(url)) throw new Error("Unsupported NetEase audio URL");
  const response = await fetch(url, {
    credentials: "include",
    cache: "force-cache"
  });
  if (!response.ok) throw new Error(`NetEase audio fetch returned ${response.status}`);
  const buffer = await response.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);
  const chunkSize = 512 * 1024;
  const total = Math.max(1, Math.ceil(base64.length / chunkSize));
  const metadata = {
    type: "fetch-audio-result",
    id,
    contentType: response.headers.get("content-type") || "",
    byteLength: buffer.byteLength,
    total
  };
  for (let index = 0; index < total; index += 1) {
    await sendNeteaseAudioChunk(sender, {
      ...metadata,
      ok: true,
      index,
      chunk: base64.slice(index * chunkSize, (index + 1) * chunkSize)
    });
  }
  return { ok: true, streamed: true, byteLength: buffer.byteLength, total };
}

function queueSync() {
  if (!syncPromise) syncPromise = syncProxy().finally(() => { syncPromise = null; });
  return syncPromise;
}

if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "keyboard") {
      setKeyboardVisible(message.enabled === true, message.force === true)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (message?.type === "fetch-audio") {
      fetchNeteaseAudio(message.url, sender, message.id)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (message?.type === "provider-text-scale") {
      sendResponse({ ok: true, providerTextScale: normalizeProviderTextScale(message.scale) });
      return false;
    }
    if (message?.type !== "sync-proxy") return false;
    queueSync()
      .then(async (result) => {
        const provider = message.providerId && result.providers.find((item) => item.id === message.providerId);
        sendResponse({ ...result, providerTextScaleApplied: result.providerTextScale });
        if (provider?.url && sender.tab?.id && chrome.tabs?.update) {
          void chrome.tabs.update(sender.tab.id, { url: provider.url });
        }
      })
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  });
}

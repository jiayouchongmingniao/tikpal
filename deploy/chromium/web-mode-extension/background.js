const API_ROOT = "http://127.0.0.1:8787/api/v1";
const BYPASS_LIST = ["localhost", "127.0.0.1", "[::1]", "<local>"];
const PROVIDER_TEXT_SCALE_VALUES = [1, 1.1, 1.2];
const PROVIDER_TEXT_SCALE_FALLBACK_VALUES = [1.2, 1.1, 1.05, 1];

export function normalizeProviderTextScale(value, fallback = 1.1) {
  const numeric = typeof value === "number" ? value : Number(String(value ?? "").trim());
  const rounded = Math.round(numeric * 100) / 100;
  const allowed = PROVIDER_TEXT_SCALE_VALUES.find((candidate) => Math.abs(candidate - rounded) < 0.001);
  return allowed ?? fallback;
}

export function nextLowerProviderTextScale(value) {
  const numeric = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return PROVIDER_TEXT_SCALE_FALLBACK_VALUES.find((candidate) => candidate < numeric - 0.001) ?? 1;
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
const tabZoomState = new Map();

async function readState() {
  const response = await fetch(`${API_ROOT}/web-mode/state`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Explore state returned ${response.status}`);
  return response.json();
}

async function setProxy(value) {
  await chrome.proxy.settings.set({ value, scope: "regular" });
}

function callChrome(callbackStarter) {
  return new Promise((resolve, reject) => {
    try {
      callbackStarter(() => {
        const message = chrome.runtime.lastError?.message;
        if (message) {
          reject(new Error(message));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function setTabZoom(tabId, scale) {
  if (!chrome.tabs?.setZoom || !chrome.tabs?.setZoomSettings) return scale;
  await callChrome((done) => chrome.tabs.setZoomSettings(tabId, {
    mode: "automatic",
    scope: "per-tab"
  }, done));
  await callChrome((done) => chrome.tabs.setZoom(tabId, scale, done));
  return scale;
}

async function getTabZoom(tabId) {
  if (!chrome.tabs?.getZoom) return null;
  return new Promise((resolve, reject) => {
    try {
      chrome.tabs.getZoom(tabId, (zoom) => {
        const message = chrome.runtime.lastError?.message;
        if (message) {
          reject(new Error(message));
          return;
        }
        resolve(typeof zoom === "number" ? zoom : null);
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function applyProviderZoom(tabId, value) {
  const desired = normalizeProviderTextScale(value);
  if (!Number.isInteger(tabId)) return desired;
  const current = tabZoomState.get(tabId);
  const applied = current?.desired === desired ? Math.min(desired, current.applied ?? desired) : desired;
  const actual = await getTabZoom(tabId).catch(() => null);
  if (current?.desired === desired && Math.abs((current.applied ?? desired) - applied) < 0.001 && actual !== null && Math.abs(actual - applied) < 0.001) return applied;
  await setTabZoom(tabId, applied);
  tabZoomState.set(tabId, { desired, applied });
  return applied;
}

async function applyProviderZoomFallback(tabId, value) {
  const desired = normalizeProviderTextScale(value);
  if (!Number.isInteger(tabId)) return nextLowerProviderTextScale(desired);
  const current = tabZoomState.get(tabId);
  const actual = await getTabZoom(tabId).catch(() => null);
  const currentApplied = actual ?? current?.applied ?? desired;
  const nextScale = nextLowerProviderTextScale(currentApplied);
  if (Math.abs(currentApplied - nextScale) < 0.001) return currentApplied;
  await setTabZoom(tabId, nextScale);
  tabZoomState.set(tabId, { desired: current?.desired ?? desired, applied: nextScale });
  return nextScale;
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
    if (message?.type === "provider-zoom-overflow") {
      const tabId = sender.tab?.id;
      applyProviderZoomFallback(tabId, message.scale)
        .then((appliedProviderTextScale) => sendResponse({ ok: true, appliedProviderTextScale }))
        .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (message?.type !== "sync-proxy") return false;
    queueSync()
      .then(async (result) => {
        const provider = message.providerId && result.providers.find((item) => item.id === message.providerId);
        let appliedProviderTextScale = null;
        let zoomError = null;
        if ((message.providerPage === true || Boolean(provider)) && Number.isInteger(sender.tab?.id)) {
          try {
            appliedProviderTextScale = await applyProviderZoom(sender.tab.id, result.providerTextScale);
          } catch (error) {
            zoomError = error instanceof Error ? error.message : String(error);
          }
        }
        sendResponse({ ...result, appliedProviderTextScale, zoomError });
        if (provider?.url && sender.tab?.id && chrome.tabs?.update) {
          void chrome.tabs.update(sender.tab.id, { url: provider.url });
        }
      })
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  });
}

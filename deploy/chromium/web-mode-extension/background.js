const API_ROOT = "http://127.0.0.1:8787/api/v1";
const BYPASS_LIST = ["localhost", "127.0.0.1", "[::1]", "<local>"];

export function buildProxyConfig(settings = {}) {
  if (settings.proxyEnabled === false) return { mode: "direct" };

  let proxyUrl;
  try {
    proxyUrl = new URL(String(settings.proxyUrl || ""));
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

let appliedRevision = null;
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

  if (revision !== appliedRevision) {
    await setProxy(buildProxyConfig(state.settings));
    await confirmApplied(revision);
    appliedRevision = revision;
  }

  return { ok: true, revision, providers: state.providers || [] };
}

function queueSync() {
  if (!syncPromise) syncPromise = syncProxy().finally(() => { syncPromise = null; });
  return syncPromise;
}

if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "sync-proxy") return false;
    queueSync()
      .then((result) => {
        const provider = message.providerId && result.providers.find((item) => item.id === message.providerId);
        sendResponse(result);
        if (provider?.url && sender.tab?.id && chrome.tabs?.update) {
          void chrome.tabs.update(sender.tab.id, { url: provider.url });
        }
      })
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  });
}

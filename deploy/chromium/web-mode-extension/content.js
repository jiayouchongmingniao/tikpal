(() => {
  const inputSelector = [
    "textarea",
    "[contenteditable='true']",
    "[role='textbox']",
    "input:not([type])",
    "input[type='text']",
    "input[type='search']",
    "input[type='url']",
    "input[type='email']",
    "input[type='password']",
    "input[type='tel']",
    "input[type='number']"
  ].join(",");
  const allowProgrammaticInputFocus = !/(^|\.)suno\.com$/i.test(window.location.hostname);
  let lastKeyboardEnabled = null;
  let lastKeyboardRequestMs = 0;
  let lastEditable = null;
  let outsidePointerDown = false;
  const editableTarget = (target) => target?.closest?.(inputSelector) || null;
  const isEditable = (target) => Boolean(editableTarget(target));
  const activeEditable = () => editableTarget(document.activeElement);
  const requestKeyboard = (enabled, force = false) => {
    const now = Date.now();
    const throttleMs = force ? 1000 : 250;
    if (lastKeyboardEnabled === enabled && now - lastKeyboardRequestMs < throttleMs) return;
    lastKeyboardEnabled = enabled;
    lastKeyboardRequestMs = now;
    chrome.runtime.sendMessage({ type: "keyboard", enabled, force }, () => undefined);
  };
  const requestShow = (event) => {
    if (!document.hasFocus()) return;
    if (event.type === "focusin" && !allowProgrammaticInputFocus) return;
    const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
    const target = path.map(editableTarget).find(Boolean);
    if (!target) return;
    outsidePointerDown = false;
    lastEditable = target;
    requestKeyboard(true, true);
  };
  const isMultiline = (target) => Boolean(target && (target.matches("textarea,[contenteditable='true']") || target.getAttribute("aria-multiline") === "true"));

  document.addEventListener("pointerdown", (event) => {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
    outsidePointerDown = !path.some(isEditable);
    if (outsidePointerDown) lastEditable = null;
  }, true);
  document.addEventListener("pointerdown", requestShow, true);
  document.addEventListener("focusin", requestShow, true);
  document.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!document.hasFocus()) {
        const active = activeEditable();
        if (active || lastEditable?.isConnected || !outsidePointerDown) {
          lastEditable = active || lastEditable;
          return;
        }
        lastEditable = null;
        requestKeyboard(false);
        return;
      }
      if (activeEditable() || document.activeElement?.tagName === "IFRAME") return;
      if (lastEditable && !outsidePointerDown) return;
      lastEditable = null;
      requestKeyboard(false);
    }, 80);
  }, true);
  document.addEventListener("submit", () => {
    lastEditable = null;
    requestKeyboard(false);
  }, true);
  document.addEventListener("keydown", (event) => {
    const target = editableTarget(event.target);
    if (event.key === "Enter" && target && !isMultiline(target)) {
      lastEditable = null;
      requestKeyboard(false);
    }
  }, true);

  const retarget = (root = document) => {
    root.querySelectorAll?.('a[target="_blank"]').forEach((link) => {
      link.target = "_self";
    });
  };

  document.addEventListener(
    "click",
    (event) => {
      const link = event.target?.closest?.('a[href][target="_blank"]');
      if (!link) return;
      event.preventDefault();
      event.stopPropagation();
      window.location.assign(link.href);
    },
    true
  );

  if (document.documentElement) retarget();
  document.addEventListener("DOMContentLoaded", () => {
    retarget();
    new MutationObserver(() => retarget()).observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  });

  if (window.top !== window) return;

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const message = event.data;
    if (message?.type !== "tikpal-netease-fetch-audio" || typeof message.id !== "string") return;
    chrome.runtime.sendMessage({ type: "fetch-audio", id: message.id, url: message.url }, (response) => {
      const runtimeError = chrome.runtime.lastError?.message;
      if (!runtimeError && response?.ok) return;
      window.postMessage({
        type: "tikpal-netease-fetch-audio-result",
        id: message.id,
        ok: false,
        error: runtimeError || response?.error || "NetEase extension audio fetch failed"
      }, window.location.origin);
    });
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "fetch-audio-result" || typeof message.id !== "string") return false;
    window.postMessage({
      type: "tikpal-netease-fetch-audio-result",
      ...message
    }, window.location.origin);
    return false;
  });

  const injectNeteaseAudioMirror = () => {
    if (!/(^|\.)music\.163\.com$/i.test(window.location.hostname)) return;
    const root = document.documentElement || document.head;
    if (!root || root.dataset.tikpalNeteaseAudioMirror === "1") return;
    root.dataset.tikpalNeteaseAudioMirror = "1";
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("netease-audio-mirror.js");
    script.async = false;
    script.onload = () => script.remove();
    (document.head || root).appendChild(script);
  };

  injectNeteaseAudioMirror();
  document.addEventListener("DOMContentLoaded", injectNeteaseAudioMirror, { once: true });

  const bootstrapUrl = "http://127.0.0.1:4173/web-mode-transition.html";
  let initialRevision = null;
  let syncing = false;

  const syncProxy = async () => {
    if (syncing) return;
    syncing = true;
    try {
      const isBootstrap = window.location.href.startsWith(bootstrapUrl);
      const providerId = isBootstrap ? new URL(window.location.href).searchParams.get("provider") : null;
      const result = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "sync-proxy", providerId }, resolve);
      });
      if (!result?.ok) return;

      if (isBootstrap) {
        const provider = result.providers?.find((item) => item.id === providerId);
        if (provider?.url) window.location.replace(provider.url);
        return;
      }

      if (initialRevision === null) {
        initialRevision = result.revision;
      } else if (result.revision !== initialRevision) {
        initialRevision = result.revision;
        window.location.reload();
      }
    } catch {
      // The launcher reports a bounded error if the extension cannot confirm the change.
    } finally {
      syncing = false;
    }
  };

  void syncProxy();
  window.setInterval(() => void syncProxy(), 750);
})();

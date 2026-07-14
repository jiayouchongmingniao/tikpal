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
  const editableTarget = (target) => target?.closest?.(inputSelector) || null;
  const requestKeyboard = (enabled, force = false) => {
    const now = Date.now();
    if (!force && lastKeyboardEnabled === enabled && now - lastKeyboardRequestMs < 250) return;
    lastKeyboardEnabled = enabled;
    lastKeyboardRequestMs = now;
    chrome.runtime.sendMessage({ type: "keyboard", enabled, force }, () => undefined);
  };
  const requestShow = (event) => {
    if (!document.hasFocus()) return;
    if (event.type === "focusin" && !allowProgrammaticInputFocus) return;
    const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
    if (path.some(editableTarget)) requestKeyboard(true, true);
  };
  const isMultiline = (target) => Boolean(target && (target.matches("textarea,[contenteditable='true']") || target.getAttribute("aria-multiline") === "true"));

  document.addEventListener("pointerdown", requestShow, true);
  document.addEventListener("focusin", requestShow, true);
  document.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!document.hasFocus() || (!editableTarget(document.activeElement) && document.activeElement?.tagName !== "IFRAME")) requestKeyboard(false);
    }, 80);
  }, true);
  document.addEventListener("submit", () => requestKeyboard(false), true);
  document.addEventListener("keydown", (event) => {
    const target = editableTarget(event.target);
    if (event.key === "Enter" && target && !isMultiline(target)) requestKeyboard(false);
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

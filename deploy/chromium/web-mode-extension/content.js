(() => {
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

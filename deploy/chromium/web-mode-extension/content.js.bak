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
  let inputSessionActive = false;
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
    chrome.runtime.sendMessage({ type: "keyboard", enabled, force }, (response) => {
      if (chrome.runtime.lastError || response?.ok === false) {
        lastKeyboardEnabled = null;
      }
    });
  };
  const requestShow = (event) => {
    if (event.type !== "pointerdown" && !document.hasFocus()) return;
    if (event.type === "focusin" && !allowProgrammaticInputFocus) return;
    const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
    const target = path.map(editableTarget).find(Boolean);
    if (!target) return;
    outsidePointerDown = false;
    lastEditable = target;
    inputSessionActive = true;
    requestKeyboard(true, true);
  };
  const endInputSession = () => {
    lastEditable = null;
    inputSessionActive = false;
  };
  const isMultiline = (target) => Boolean(target && (target.matches("textarea,[contenteditable='true']") || target.getAttribute("aria-multiline") === "true"));

  document.addEventListener("pointerdown", (event) => {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
    outsidePointerDown = !path.some(isEditable);
    if (outsidePointerDown) {
      endInputSession();
      requestKeyboard(false);
    }
  }, true);
  document.addEventListener("pointerdown", requestShow, true);
  document.addEventListener("focusin", requestShow, true);
  document.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!document.hasFocus()) {
        const active = activeEditable();
        if (active || (inputSessionActive && lastEditable?.isConnected) || !outsidePointerDown) {
          lastEditable = active || lastEditable;
          inputSessionActive = Boolean(lastEditable);
          return;
        }
        endInputSession();
        requestKeyboard(false);
        return;
      }
      if (activeEditable() || document.activeElement?.tagName === "IFRAME") return;
      if (inputSessionActive && lastEditable && !outsidePointerDown) return;
      endInputSession();
      requestKeyboard(false);
    }, 80);
  }, true);
  document.addEventListener("submit", () => {
    endInputSession();
    requestKeyboard(false);
  }, true);
  document.addEventListener("keydown", (event) => {
    const target = editableTarget(event.target);
    if (event.key === "Enter" && target && !isMultiline(target)) {
      endInputSession();
      requestKeyboard(false);
    }
  }, true);

  const isBrowserZoomKey = (event) => {
    if (!event.ctrlKey && !event.metaKey) return false;
    const key = String(event.key || "").toLowerCase();
    const code = String(event.code || "").toLowerCase();
    return [
      "+", "=", "-", "_", "0", "numpadadd", "numpadsubtract", "numpad0", "minus", "equal", "digit0"
    ].includes(key) || [
      "numpadadd", "numpadsubtract", "numpad0", "minus", "equal", "digit0"
    ].includes(code);
  };

  const preventBrowserZoom = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  document.addEventListener("keydown", (event) => {
    if (isBrowserZoomKey(event)) preventBrowserZoom(event);
  }, true);
  document.addEventListener("wheel", (event) => {
    if (event.ctrlKey || event.metaKey) preventBrowserZoom(event);
  }, { capture: true, passive: false });
  document.addEventListener("touchstart", (event) => {
    if (event.touches?.length > 1) preventBrowserZoom(event);
  }, { capture: true, passive: false });
  document.addEventListener("touchmove", (event) => {
    if (event.touches?.length > 1) preventBrowserZoom(event);
  }, { capture: true, passive: false });
  ["gesturestart", "gesturechange", "gestureend"].forEach((type) => {
    document.addEventListener(type, preventBrowserZoom, { capture: true, passive: false });
  });

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
    if (message?.type === "tikpal-provider-audio-muted") {
      chrome.runtime.sendMessage({ type: "provider-audio-muted", muted: message.muted === true }, () => {});
      return;
    }
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
  const providerHostIds = [
    { id: "suno", pattern: /(^|\.)suno\.com$/i },
    { id: "spotify", pattern: /(^|\.)open\.spotify\.com$/i },
    { id: "youtube_music", pattern: /(^|\.)music\.youtube\.com$/i },
    { id: "apple_music", pattern: /(^|\.)music\.apple\.com$/i },
    { id: "tidal", pattern: /(^|\.)listen\.tidal\.com$|(^|\.)tidal\.com$/i },
    { id: "qobuz", pattern: /(^|\.)play\.qobuz\.com$/i },
    { id: "deezer", pattern: /(^|\.)deezer\.com$/i },
    { id: "amazon_music", pattern: /(^|\.)music\.amazon\.com$/i },
    { id: "qq_music", pattern: /(^|\.)y\.qq\.com$/i },
    { id: "netease_music", pattern: /(^|\.)music\.163\.com$/i }
  ];
  const providerTextScaleValues = [1, 1.1, 1.2];
  const providerFontThemeValues = new Set(["system", "hardware", "precision", "sans", "serif", "mono"]);
  const providerFontThemeFamilies = {
    system: 'Inter, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Noto Sans CJK SC", "Noto Sans CJK JP", "Noto Sans CJK KR", "Source Han Sans CN", "PingFang SC", "WenQuanYi Zen Hei", sans-serif',
    hardware: '"Noto Sans CJK SC", "Noto Sans CJK JP", "Noto Sans CJK KR", "Source Han Sans CN", "WenQuanYi Zen Hei", Inter, sans-serif',
    precision: '"Source Han Sans CN", "Noto Sans CJK SC", "Noto Sans CJK JP", "Noto Sans CJK KR", "PingFang SC", Inter, sans-serif',
    sans: 'Inter, Roboto, "Fira Sans", "SF Pro Display", "Helvetica Neue", "Noto Sans CJK SC", "Noto Sans CJK JP", "Noto Sans CJK KR", "Source Han Sans CN", sans-serif',
    serif: '"Noto Serif CJK SC", "Noto Serif CJK JP", "Noto Serif CJK KR", "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, "Times New Roman", "Songti SC", serif',
    mono: '"Noto Sans Mono CJK SC", "Noto Sans Mono CJK JP", "Noto Sans Mono CJK KR", "SF Mono", "IBM Plex Mono", "JetBrains Mono", "Cascadia Mono", "Fira Code", "Source Han Mono SC", monospace'
  };
  let initialProxyKey = null;
  let desiredProviderTextScale = null;
  let activeProviderTextScale = 1;
  let desiredProviderFontTheme = null;
  let activeProviderFontTheme = "system";
  let lastProviderTextScaleScanMs = 0;
  let lastProviderFontThemeScanMs = 0;
  let lastProviderTextScaleElementCount = 0;
  let lastProviderFontThemeElementCount = 0;
  let syncing = false;
  const providerTextScaleStyleId = "tikpal-provider-text-scale-style";
  const providerFontThemeStyleId = "tikpal-provider-font-theme-style";
  const providerIconFontPattern = /icon|symbol|fontawesome|glyphicons|material icons|material symbols|icomoon|ionicons/i;
  const providerTextScaleSelector = [
    "a", "button", "div", "em", "h1", "h2", "h3", "h4", "h5", "h6",
    "input", "label", "li", "p", "select", "small", "span", "strong",
    "td", "textarea", "th"
  ].join(",");
  const providerTextScaleSkipSelector = [
    "audio", "canvas", "iframe", "img", "noscript", "picture", "script",
    "source", "style", "svg", "video"
  ].join(",");

  const isLoopbackHost = (host) => /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(host);
  const isProviderPage = () => /^https?:$/i.test(window.location.protocol) && !isLoopbackHost(window.location.hostname);
  const normalizeProviderTextScale = (value, fallback = 1.1) => {
    const numeric = typeof value === "number" ? value : Number(String(value ?? "").trim());
    const rounded = Math.round(numeric * 100) / 100;
    return providerTextScaleValues.find((candidate) => Math.abs(candidate - rounded) < 0.001) ?? fallback;
  };
  const normalizeProviderFontTheme = (value, fallback = "system") => {
    const normalized = String(value ?? "").trim().toLowerCase().replaceAll("-", "_");
    return providerFontThemeValues.has(normalized) ? normalized : fallback;
  };
  const inferProviderId = () => {
    const host = window.location.hostname;
    return providerHostIds.find((provider) => provider.pattern.test(host))?.id || null;
  };
  const providerTextDensity = (scale) => scale;
  const providerFontFamily = (theme) => providerFontThemeFamilies[normalizeProviderFontTheme(theme)] || providerFontThemeFamilies.system;
  const ensureProviderTextScaleStyle = (scale) => {
    const root = document.documentElement;
    if (!root || !document.head) return;
    const density = providerTextDensity(scale);
    let style = document.getElementById(providerTextScaleStyleId);
    if (!style) {
      style = document.createElement("style");
      style.id = providerTextScaleStyleId;
      document.head.appendChild(style);
    }
    style.textContent = `
html[data-tikpal-provider-text-scale] {
  -webkit-text-size-adjust: 100% !important;
  text-size-adjust: 100% !important;
}
`;
    root.style.setProperty("--tikpal-provider-text-density", density.toFixed(3));
  };
  const ensureProviderFontThemeStyle = (theme) => {
    const root = document.documentElement;
    if (!root || !document.head) return;
    let style = document.getElementById(providerFontThemeStyleId);
    if (!style) {
      style = document.createElement("style");
      style.id = providerFontThemeStyleId;
      document.head.appendChild(style);
    }
    style.textContent = `
html[data-tikpal-provider-font-theme] {
  --tikpal-provider-font-family: ${providerFontFamily(theme)};
}
html[data-tikpal-provider-font-theme] body,
html[data-tikpal-provider-font-theme] button,
html[data-tikpal-provider-font-theme] input,
html[data-tikpal-provider-font-theme] select,
html[data-tikpal-provider-font-theme] textarea {
  font-family: var(--tikpal-provider-font-family) !important;
}
`;
    root.dataset.tikpalProviderFontTheme = normalizeProviderFontTheme(theme);
  };
  const hasDirectText = (element) => {
    for (const node of element.childNodes || []) {
      if (node.nodeType === Node.TEXT_NODE && String(node.nodeValue || "").trim()) return true;
    }
    return false;
  };
  const shouldScaleProviderTextElement = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    if (element.matches(providerTextScaleSkipSelector) || element.closest(providerTextScaleSkipSelector)) return false;
    const tagName = element.tagName.toLowerCase();
    const isTextControl = ["button", "input", "select", "textarea"].includes(tagName);
    if (!isTextControl && !hasDirectText(element)) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || 1) <= 0) return false;
    const fontSize = Number.parseFloat(style.fontSize);
    return Number.isFinite(fontSize) && fontSize >= 8 && fontSize <= 48;
  };
  const shouldApplyProviderFontElement = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    if (element.matches(providerTextScaleSkipSelector) || element.closest(providerTextScaleSkipSelector)) return false;
    if (element.getAttribute("aria-hidden") === "true") return false;
    const tagName = element.tagName.toLowerCase();
    const isTextControl = ["button", "input", "select", "textarea"].includes(tagName);
    if (!isTextControl && !hasDirectText(element)) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || 1) <= 0) return false;
    if (providerIconFontPattern.test(style.fontFamily) || providerIconFontPattern.test(String(element.className || ""))) return false;
    const fontSize = Number.parseFloat(style.fontSize);
    return Number.isFinite(fontSize) && fontSize >= 8 && fontSize <= 72;
  };
  const restoreProviderTextElement = (element) => {
    const originalInline = element.dataset.tikpalTextScaleInlineFontSize || "";
    if (originalInline) {
      element.style.fontSize = originalInline;
    } else {
      element.style.removeProperty("font-size");
    }
    delete element.dataset.tikpalTextScaleInlineFontSize;
    delete element.dataset.tikpalTextScaleBaseFontSize;
  };
  const scaleProviderTextElements = (scale, force = false) => {
    const now = Date.now();
    if (!force && now - lastProviderTextScaleScanMs < 1200) return;
    lastProviderTextScaleScanMs = now;
    const density = providerTextDensity(scale);
    const active = Math.abs(density - 1) > 0.001;
    let elementCount = 0;
    document.querySelectorAll(providerTextScaleSelector).forEach((element) => {
      const tracked = element instanceof HTMLElement && element.dataset.tikpalTextScaleBaseFontSize;
      if (!tracked && !shouldScaleProviderTextElement(element)) return;
      if (!(element instanceof HTMLElement)) return;
      if (!active) {
        if (tracked) restoreProviderTextElement(element);
        return;
      }
      if (!tracked) {
        const fontSize = Number.parseFloat(getComputedStyle(element).fontSize);
        if (!Number.isFinite(fontSize)) return;
        element.dataset.tikpalTextScaleBaseFontSize = fontSize.toFixed(3);
        element.dataset.tikpalTextScaleInlineFontSize = element.style.fontSize || "";
      }
      const baseFontSize = Number.parseFloat(element.dataset.tikpalTextScaleBaseFontSize || "");
      if (!Number.isFinite(baseFontSize)) return;
      element.style.fontSize = `${Math.max(8, Math.min(58, baseFontSize * density)).toFixed(2)}px`;
      elementCount += 1;
    });
    lastProviderTextScaleElementCount = elementCount;
  };
  const recordProviderTextScale = (scale, source = "extension") => {
    const root = document.documentElement;
    if (root) {
      root.dataset.tikpalProviderTextScale = scale.toFixed(2);
      root.dataset.tikpalProviderHost = window.location.hostname;
      root.style.setProperty("--tikpal-provider-text-scale", scale.toFixed(2));
    }
    window.__tikpalProviderTextScale = {
      desired: desiredProviderTextScale ?? scale,
      applied: activeProviderTextScale,
      density: providerTextDensity(activeProviderTextScale),
      elementCount: lastProviderTextScaleElementCount,
      source
    };
  };
  const recordProviderFontTheme = (theme, source = "extension-font-theme") => {
    window.__tikpalProviderFontTheme = {
      desired: desiredProviderFontTheme ?? theme,
      applied: activeProviderFontTheme,
      family: providerFontFamily(activeProviderFontTheme),
      elementCount: lastProviderFontThemeElementCount,
      source
    };
  };
  const applyProviderFontTheme = (theme, force = false) => {
    if (!isProviderPage() || !document.documentElement) return activeProviderFontTheme;
    activeProviderFontTheme = normalizeProviderFontTheme(theme, activeProviderFontTheme);
    ensureProviderFontThemeStyle(activeProviderFontTheme);
    const now = Date.now();
    if (force || now - lastProviderFontThemeScanMs >= 1200) {
      lastProviderFontThemeScanMs = now;
      let elementCount = 0;
      document.querySelectorAll(providerTextScaleSelector).forEach((element) => {
        const tracked = element instanceof HTMLElement && element.dataset.tikpalFontThemeApplied === "1";
        if (!tracked && !shouldApplyProviderFontElement(element)) return;
        if (!(element instanceof HTMLElement)) return;
        if (!tracked) {
          element.dataset.tikpalFontThemeInlineFontFamily = element.style.fontFamily || "";
          element.dataset.tikpalFontThemeApplied = "1";
        }
        element.style.setProperty("font-family", "var(--tikpal-provider-font-family)", "important");
        elementCount += 1;
      });
      lastProviderFontThemeElementCount = elementCount;
    }
    recordProviderFontTheme(activeProviderFontTheme, "content-font-theme");
    return activeProviderFontTheme;
  };
  const applyProviderTextScale = (scale, force = false) => {
    if (!isProviderPage() || !document.documentElement) return activeProviderTextScale;
    activeProviderTextScale = normalizeProviderTextScale(scale, scale);
    document.documentElement.style.zoom = "";
    ensureProviderTextScaleStyle(activeProviderTextScale);
    scaleProviderTextElements(activeProviderTextScale, force);
    recordProviderTextScale(activeProviderTextScale, "content-text-density");
    return activeProviderTextScale;
  };
  const setDesiredProviderTextScale = (value) => {
    const nextDesired = normalizeProviderTextScale(value);
    const changed = desiredProviderTextScale === null || Math.abs(nextDesired - desiredProviderTextScale) > 0.001;
    desiredProviderTextScale = nextDesired;
    activeProviderTextScale = nextDesired;
    applyProviderTextScale(activeProviderTextScale, changed);
  };
  const setDesiredProviderFontTheme = (value) => {
    const nextDesired = normalizeProviderFontTheme(value);
    const changed = desiredProviderFontTheme === null || nextDesired !== desiredProviderFontTheme;
    desiredProviderFontTheme = nextDesired;
    activeProviderFontTheme = nextDesired;
    applyProviderFontTheme(activeProviderFontTheme, changed);
  };

  const syncProxy = async () => {
    if (syncing) return;
    syncing = true;
    try {
      const isBootstrap = window.location.href.startsWith(bootstrapUrl);
      const providerId = isBootstrap ? new URL(window.location.href).searchParams.get("provider") : inferProviderId();
      const result = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "sync-proxy", providerId, providerPage: !isBootstrap && isProviderPage() }, resolve);
      });
      if (!result?.ok) return;

      if (isBootstrap) {
        const provider = result.providers?.find((item) => item.id === providerId);
        if (provider?.url) window.location.replace(provider.url);
        return;
      }

      if (typeof result.providerTextScale === "number") {
        setDesiredProviderTextScale(result.providerTextScale);
      }
      if (typeof result.fontTheme === "string") {
        setDesiredProviderFontTheme(result.fontTheme);
      }

      if (initialProxyKey === null) {
        initialProxyKey = result.proxyKey || result.revision;
      } else if ((result.proxyKey || result.revision) !== initialProxyKey) {
        initialProxyKey = result.proxyKey || result.revision;
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

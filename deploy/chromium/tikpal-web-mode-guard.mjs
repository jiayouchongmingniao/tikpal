#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const port = Number.parseInt(process.env.TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT || "9234", 10);
const profile = process.env.TIKPAL_WEB_MODE_PROVIDER_PROFILE || "";
const providerId = process.env.TIKPAL_WEB_MODE_PROVIDER_ID || "";
const providerLabel = process.env.TIKPAL_WEB_MODE_PROVIDER_LABEL || providerId || "Web player";
const proxyMode = process.env.TIKPAL_WEB_MODE_PROXY_MODE === "proxy" ? "proxy" : "direct";
const errorPageBaseUrl = process.env.TIKPAL_WEB_MODE_ERROR_PAGE_URL || "http://127.0.0.1:4173/web-mode-error.html";
const qqAutoConfirm = /^(1|true|yes|on|enabled)$/i.test(process.env.TIKPAL_WEB_MODE_QQ_AUTO_CONFIRM || "1");
const onboardAutoFocus = /^(1|true|yes|on|enabled)$/i.test(process.env.TIKPAL_WEB_MODE_ONBOARD_AUTO_FOCUS || "1");
const allowProgrammaticInputFocus = providerId !== "suno";
const launcherPath = fileURLToPath(new URL("./tikpal-web-mode.sh", import.meta.url));
const keyboardActionUrl = `http://127.0.0.1:${process.env.TIKPAL_API_PORT || "8787"}/api/v1/web-mode/actions`;
const emptyPageTimeoutMs = Math.max(5, Number.parseInt(process.env.TIKPAL_WEB_MODE_EMPTY_PAGE_ERROR_SECONDS || "18", 10) || 18) * 1000;
const pollMs = 250;
const onboardInputSelector = [
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
const safeLabels = ["确定", "确认", "取消", "关闭", "知道了", "我知道了", "好的", "好", "开始播放", "继续播放", "不用了，谢谢", "不了，谢谢", "no, thanks", "no thanks"];
const dismissLabels = ["取消", "关闭", "知道了", "我知道了", "好的", "好", "不用了，谢谢", "不了，谢谢", "no, thanks", "no thanks"];
const consentAcceptAllLabels = [
  "accept all",
  "accept all cookies",
  "allow all",
  "allow all cookies",
  "allow optional cookies",
  "agree to all",
  "enable all",
  "yes, accept all",
  "accept all and continue",
  "agree and continue",
  "accept and continue",
  "全部接受",
  "接受全部",
  "同意全部",
  "全部同意",
  "允许全部",
  "允許全部",
  "すべて同意",
  "全て同意",
  "すべて許可",
  "すべて受け入れる",
  "모두 수락",
  "모두 허용",
  "alle akzeptieren",
  "tout accepter",
  "aceptar todo",
  "aceptar todas"
];
const consentFallbackLabels = [
  "accept",
  "accept cookies",
  "allow cookies",
  "agree",
  "i agree",
  "ok",
  "got it",
  "continue",
  "同意",
  "我同意",
  "接受",
  "允许",
  "允許",
  "确定",
  "好的",
  "知道了",
  "同意する",
  "許可",
  "受け入れる",
  "확인",
  "동의",
  "수락"
];
const consentRejectLabels = [
  "reject",
  "reject all",
  "decline",
  "deny",
  "manage",
  "manage options",
  "settings",
  "preferences",
  "customize",
  "customise",
  "learn more",
  "more options",
  "necessary only",
  "only necessary",
  "save preferences",
  "拒绝",
  "拒絕",
  "全部拒绝",
  "全部拒絕",
  "管理",
  "设置",
  "設定",
  "偏好",
  "更多选项",
  "更多選項",
  "仅必要",
  "僅必要",
  "只接受必要",
  "拒否",
  "管理する",
  "カスタマイズ",
  "必要なものだけ",
  "거부",
  "관리",
  "설정",
  "필수만",
  "ablehnen",
  "verwalten",
  "einstellungen",
  "refuser",
  "parametres",
  "paramètres",
  "personnaliser",
  "rechazar",
  "configurar"
];
const consentLabels = [...consentAcceptAllLabels, ...consentFallbackLabels];
const kioskInjectedTargets = new Set();
const qqInjectedTargets = new Set();
const earlyRedirectTargets = new Set();
const redirectedTargets = new Set();
const targetProgressState = new Map();
const inputFocusRequests = new Map();
let lastOnboardVisible = null;
let lastOnboardActionMs = 0;
const providerNativeFailureIds = new Set(["amazon_music", "qobuz", "deezer"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function profileProcessExists() {
  if (!profile) return true;
  const result = spawnSync("pgrep", ["-f", "--", `--user-data-dir=${profile}`], {
    stdio: "ignore"
  });
  return result.status === 0;
}

async function readTargets() {
  const response = await fetch(`http://127.0.0.1:${port}/json`, {
    signal: AbortSignal.timeout(800)
  });
  if (!response.ok) return [];
  return response.json();
}

function isPageTarget(target) {
  return target?.type === "page" && Boolean(target.webSocketDebuggerUrl);
}

function isFriendlyErrorPage(target) {
  try {
    const url = new URL(target.url || "");
    return url.pathname.endsWith("/web-mode-error.html");
  } catch {
    return false;
  }
}

function isProviderWebPage(target) {
  try {
    const url = new URL(target.url || "");
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isQqMusicPage(target) {
  if (!isPageTarget(target)) return false;
  try {
    const url = new URL(target.url || "");
    return url.hostname === "y.qq.com" || url.hostname.endsWith(".y.qq.com");
  } catch {
    return false;
  }
}

function isQqMusicPlayerPage(target) {
  if (!isQqMusicPage(target)) return false;
  try {
    const url = new URL(target.url || "");
    return url.pathname.startsWith("/n/ryqq");
  } catch {
    return false;
  }
}

function cdpCommand(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error("CDP command timed out"));
    }, 1200);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({
        id: 1,
        method,
        params
      }));
    });
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      ws.close();
      if (message.error) {
        reject(new Error(message.error.message || "CDP command failed"));
        return;
      }
      resolve(message.result || null);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("CDP websocket failed"));
    });
  });
}

function evaluate(wsUrl, expression) {
  return cdpCommand(wsUrl, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  }).then((result) => result?.result?.value ?? null);
}

const kioskGuardScript = `(() => {
  if (window.__tikpalProviderGuardInstalled) return;
  window.__tikpalProviderGuardInstalled = true;
  const interactiveSelector = "input, textarea, select, [contenteditable='true'], [role='textbox']";
  const isEditable = (target) => Boolean(target && target.closest && target.closest(interactiveSelector));
  const block = (event) => {
    if (isEditable(event.target) && event.type !== "contextmenu" && event.type !== "dragstart") return;
    event.preventDefault();
  };
  document.addEventListener("contextmenu", block, true);
  document.addEventListener("dragstart", block, true);
  document.addEventListener("selectstart", block, true);
  document.addEventListener("gesturestart", block, true);
  document.addEventListener("gesturechange", block, true);
  document.addEventListener("gestureend", block, true);
  document.addEventListener("keydown", (event) => {
    const key = String(event.key || "").toLowerCase();
    if ((event.ctrlKey || event.metaKey) && ["+", "-", "=", "0", "r"].includes(key)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
  const style = document.createElement("style");
  style.textContent = "html,body{-webkit-touch-callout:none;} body,body *{-webkit-user-drag:none;} input,textarea,[contenteditable='true']{-webkit-user-select:text!important;user-select:text!important;}";
  document.documentElement.appendChild(style);
})()`;

const inputFocusGuardScript = `(() => {
  if (window.__tikpalInputFocusGuardInstalled) return;
  window.__tikpalInputFocusGuardInstalled = true;
  window.__tikpalInputFocusShowRequest = 0;
  window.__tikpalInputFocusHideRequest = 0;
  const selector = ${JSON.stringify(onboardInputSelector)};
  const keyboardActionUrl = ${JSON.stringify(keyboardActionUrl)};
  const allowProgrammaticInputFocus = ${JSON.stringify(allowProgrammaticInputFocus)};
  let lastEditable = null;
  let lastKeyboardEnabled = null;
  let lastKeyboardRequestMs = 0;
  let outsidePointerDown = false;
  const editableTarget = (target) => target?.closest?.(selector) || null;
  const isEditable = (target) => Boolean(editableTarget(target));
  const activeEditable = () => document.hasFocus() ? editableTarget(document.activeElement) : null;
  const refocusEditable = (target) => {
    if (!target?.isConnected) return;
    target.focus({ preventScroll: true });
  };
  const keepEditableFocus = (target) => {
    for (const delay of [80, 260, 620, 1200, 1800]) {
      setTimeout(() => {
        if (document.hasFocus() && lastEditable === target && !outsidePointerDown) refocusEditable(target);
      }, delay);
    }
  };
  const requestKeyboard = (enabled, force = false) => {
    const now = Date.now();
    if (!force && lastKeyboardEnabled === enabled && now - lastKeyboardRequestMs < 250) return;
    lastKeyboardEnabled = enabled;
    lastKeyboardRequestMs = now;
    fetch(keyboardActionUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ type: "keyboard", enabled, force })
    }).catch(() => {});
  };
  const isMultiline = (target) => Boolean(target && (target.matches("textarea,[contenteditable='true']") || target.getAttribute("aria-multiline") === "true"));
  const requestShow = (event) => {
    if (!document.hasFocus()) return;
    if (event.type === "focusin" && !allowProgrammaticInputFocus) return;
    const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
    const target = path.map(editableTarget).find(Boolean);
    if (!target) return;
    outsidePointerDown = false;
    lastEditable = target;
    window.__tikpalInputFocusShowRequest += 1;
    requestKeyboard(true, true);
    keepEditableFocus(target);
  };
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
        lastEditable = null;
        window.__tikpalInputFocusHideRequest += 1;
        requestKeyboard(false);
        return;
      }
      if (activeEditable() || document.activeElement?.tagName === "IFRAME") return;
      if (lastEditable && !outsidePointerDown) {
        refocusEditable(lastEditable);
        return;
      }
      window.__tikpalInputFocusHideRequest += 1;
      requestKeyboard(false);
    }, 80);
  }, true);
  document.addEventListener("submit", () => {
    lastEditable = null;
    window.__tikpalInputFocusHideRequest += 1;
    requestKeyboard(false);
  }, true);
  document.addEventListener("keydown", (event) => {
    const target = event.target?.closest?.(selector);
    if (event.key === "Enter" && target && !isMultiline(target)) {
      lastEditable = null;
      window.__tikpalInputFocusHideRequest += 1;
      requestKeyboard(false);
    }
  }, true);
})()`;

const inputFocusExpression = `(() => {
  const selector = ${JSON.stringify(onboardInputSelector)};
  const activeEditable = (doc) => {
    if (!doc?.hasFocus?.()) return false;
    let active = doc?.activeElement || null;
    for (let depth = 0; active && depth < 8; depth += 1) {
      if (active.matches?.(selector)) return true;
      if (active.shadowRoot?.activeElement) {
        active = active.shadowRoot.activeElement;
        continue;
      }
      if (active.tagName === "IFRAME") {
        try {
          active = active.contentDocument?.activeElement || null;
          continue;
        } catch {}
      }
      break;
    }
    try {
      return Array.from(doc?.querySelectorAll?.("iframe") || []).some((frame) => activeEditable(frame.contentDocument));
    } catch {
      return false;
    }
  };
  return {
    showRequest: Number(window.__tikpalInputFocusShowRequest || 0),
    hideRequest: Number(window.__tikpalInputFocusHideRequest || 0),
    focused: activeEditable(document)
  };
})()`;

function setOnboardVisible(enabled, force = false) {
  const now = Date.now();
  if (!force && lastOnboardVisible === enabled && now - lastOnboardActionMs < 250) return;
  lastOnboardVisible = enabled;
  lastOnboardActionMs = now;
  const child = spawn("bash", [launcherPath, "keyboard", enabled ? force ? "show-force" : "show" : "hide"], {
    detached: true,
    stdio: "ignore",
    env: process.env
  });
  child.unref();
}

async function runInputFocusKeyboard(targets) {
  if (!onboardAutoFocus) return;
  const currentTargetIds = new Set();
  let anyFocused = false;
  let wasFocused = false;
  let shouldShow = false;
  let shouldHide = false;
  for (const target of targets.filter(isProviderWebPage)) {
    currentTargetIds.add(target.id);
    const state = await evaluate(target.webSocketDebuggerUrl, inputFocusExpression).catch(() => null);
    if (!state) continue;
    const previous = inputFocusRequests.get(target.id) || { showRequest: 0, hideRequest: 0, focused: false, url: target.url };
    anyFocused ||= state.focused;
    wasFocused ||= previous.focused;
    shouldShow ||= state.showRequest > previous.showRequest || (allowProgrammaticInputFocus && state.focused && !previous.focused);
    shouldHide ||= state.hideRequest > previous.hideRequest || (previous.url !== target.url && !state.focused);
    inputFocusRequests.set(target.id, { ...state, url: target.url });
  }
  for (const [targetId, previous] of inputFocusRequests) {
    if (currentTargetIds.has(targetId)) continue;
    wasFocused ||= previous.focused;
    inputFocusRequests.delete(targetId);
  }
  if (shouldShow) setOnboardVisible(true, true);
  else if (shouldHide || (wasFocused && !anyFocused)) setOnboardVisible(false);
}

async function installKioskGuard(target) {
  if (!isPageTarget(target)) return;
  if (!kioskInjectedTargets.has(target.id)) {
    await cdpCommand(target.webSocketDebuggerUrl, "Page.addScriptToEvaluateOnNewDocument", {
      source: kioskGuardScript
    }).catch(() => {});
    await cdpCommand(target.webSocketDebuggerUrl, "Page.addScriptToEvaluateOnNewDocument", {
      source: inputFocusGuardScript
    }).catch(() => {});
    kioskInjectedTargets.add(target.id);
  }
  await evaluate(target.webSocketDebuggerUrl, kioskGuardScript).catch(() => {});
  await evaluate(target.webSocketDebuggerUrl, inputFocusGuardScript).catch(() => {});
}

function errorPageUrl(reason) {
  const url = new URL(errorPageBaseUrl);
  url.searchParams.set("provider", providerId || "web");
  url.searchParams.set("label", providerLabel);
  url.searchParams.set("reason", reason || "load_failed");
  url.searchParams.set("proxy", proxyMode);
  return url.href;
}

function providerNativeFailureReason(text, title, href) {
  if (!providerNativeFailureIds.has(providerId)) return "";
  const value = String(`${href || ""} ${title || ""} ${text || ""}`);
  if (/unsupported browser|browser (?:is )?not supported|update your browser/i.test(value)) {
    return "unsupported_browser";
  }
  if (/not available in (?:your|this) (?:country|region|location)|not available in your area|unavailable in (?:your|this) (?:country|region)/i.test(value)) {
    return "region_unavailable";
  }
  if (/access denied|403 forbidden|request blocked|blocked by|permission denied/i.test(value)) {
    return "provider_blocked";
  }
  if (/something went wrong|oops[,.! ]+(?:something went wrong|an error occurred)|unable to load|failed to load|temporarily unavailable|try again later|the page you requested cannot be found/i.test(value)) {
    return "provider_unavailable";
  }
  return "";
}

function parseErrorReason(text, title, href) {
  if (String(`${title || ""} ${text || ""}`).includes("empty_page_timeout")) return "empty_page_timeout";
  const nativeReason = providerNativeFailureReason(text, title, href);
  if (nativeReason) return nativeReason;
  const match = String(`${title || ""} ${text || ""}`).match(/\b(?:ERR|DNS)_[A-Z0-9_]+\b/);
  if (match) return match[0];
  if (/no healthy upstream|upstream connect error|bad gateway|service unavailable|gateway timeout/i.test(`${title || ""} ${text || ""}`)) {
    return "upstream_unavailable";
  }
  if (/can't be reached|cannot be reached|无法访问|closed the connection/i.test(`${title || ""} ${text || ""}`)) {
    return "site_unreachable";
  }
  return "load_failed";
}

function attachEarlyErrorRedirect(target) {
  if (!isPageTarget(target) || isFriendlyErrorPage(target) || earlyRedirectTargets.has(target.id)) return;
  earlyRedirectTargets.add(target.id);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let messageId = 1;
  const send = (method, params = {}) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ id: messageId++, method, params }));
  };
  const redirect = (reason) => {
    if (redirectedTargets.has(target.id)) return;
    redirectedTargets.add(target.id);
    send("Page.navigate", { url: errorPageUrl(reason) });
  };

  ws.addEventListener("open", () => {
    send("Page.enable");
  });
  ws.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message.method === "Page.loadingFailed" && message.params?.type === "Document") {
      const errorText = String(message.params?.errorText || "");
      if (/ERR_ABORTED|NS_BINDING_ABORTED/i.test(errorText)) return;
      redirect(parseErrorReason(errorText, message.params?.blockedReason));
      return;
    }
    if (message.method === "Page.frameNavigated") {
      const nextUrl = String(message.params?.frame?.url || "");
      if (nextUrl.startsWith("chrome-error://")) redirect("load_failed");
    }
  });
  ws.addEventListener("close", () => {
    earlyRedirectTargets.delete(target.id);
  });
  ws.addEventListener("error", () => {
    earlyRedirectTargets.delete(target.id);
  });
}

async function maybeRedirectErrorPage(target) {
  if (!isPageTarget(target) || isFriendlyErrorPage(target) || redirectedTargets.has(target.id)) return;
  const targetUrl = String(target.url || "");
  let looksLikeError = targetUrl.startsWith("chrome-error://");
  let diagnostics = null;

  if (!looksLikeError) {
    diagnostics = await evaluate(target.webSocketDebuggerUrl, `(() => ({
      href: location.href,
      title: document.title || "",
      readyState: document.readyState,
      text: document.body ? document.body.innerText.slice(0, 1600) : "",
      htmlLength: document.documentElement ? document.documentElement.innerHTML.length : 0,
      resourceCount: performance.getEntriesByType("resource").length,
      visibleCount: Array.from(document.body ? document.body.querySelectorAll("*") : []).slice(0, 200).filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 16 &&
          rect.height > 16 &&
          rect.right > 0 &&
          rect.bottom > 0 &&
          rect.left < innerWidth &&
          rect.top < innerHeight &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || "1") > 0.05;
      }).length
    }))()`).catch(() => null);
    const diagnosticText = `${diagnostics?.href || ""} ${diagnostics?.title || ""} ${diagnostics?.text || ""}`;
    looksLikeError = /chrome-error:\/\/chromewebdata|This site can.?t be reached|ERR_[A-Z0-9_]+|DNS_[A-Z0-9_]+|unexpectedly closed the connection|no healthy upstream|upstream connect error|bad gateway|service unavailable|gateway timeout|无法访问/i.test(diagnosticText);
    looksLikeError = looksLikeError || Boolean(providerNativeFailureReason(diagnostics?.text, diagnostics?.title, diagnostics?.href));
    const visibleText = String(diagnostics?.text || "").trim();
    const progressSignature = [
      diagnostics?.href || targetUrl,
      diagnostics?.htmlLength || 0,
      diagnostics?.resourceCount || 0,
      diagnostics?.visibleCount || 0,
      visibleText.length
    ].join(":");
    const previousProgress = targetProgressState.get(target.id);
    if (!previousProgress || previousProgress.signature !== progressSignature) {
      targetProgressState.set(target.id, { signature: progressSignature, at: Date.now() });
    }
    const waitedLongEnough = Date.now() - (targetProgressState.get(target.id)?.at || Date.now()) >= emptyPageTimeoutMs;
    const providerBlankPage =
      providerNativeFailureIds.has(providerId) &&
      String(diagnostics?.readyState || "") === "complete" &&
      visibleText.length < 24 &&
      Number(diagnostics?.visibleCount || 0) <= 3;
    if (
      !looksLikeError &&
      waitedLongEnough &&
      isProviderWebPage(target) &&
      providerBlankPage
    ) {
      looksLikeError = true;
      diagnostics = { ...(diagnostics || {}), title: "empty_page_timeout", text: "empty_page_timeout" };
    }
  }

  if (!looksLikeError) return;
  if (!diagnostics) {
    diagnostics = await evaluate(target.webSocketDebuggerUrl, `(() => ({
      title: document.title || "",
      text: document.body ? document.body.innerText.slice(0, 1600) : ""
    }))()`).catch(() => null);
  }
  const reason = parseErrorReason(diagnostics?.text, diagnostics?.title || target.title, diagnostics?.href || target.url);
  redirectedTargets.add(target.id);
  await cdpCommand(target.webSocketDebuggerUrl, "Page.navigate", {
    url: errorPageUrl(reason)
  }).catch(() => {});
}

const singlePaneScript = `(() => {
  if (window.__tikpalSinglePaneInstalled) {
    document.querySelectorAll("a[target]").forEach((link) => {
      if (link instanceof HTMLAnchorElement) link.target = "_self";
    });
    return;
  }
  window.__tikpalSinglePaneInstalled = true;
  const isQqMusicUrl = (value) => {
    try {
      const url = new URL(value, location.href);
      return url.hostname === "y.qq.com" || url.hostname.endsWith(".y.qq.com");
    } catch {
      return false;
    }
  };
  const openInPlace = (value) => {
    if (!value || !isQqMusicUrl(value)) return null;
    location.href = new URL(value, location.href).href;
    return window;
  };
  const nativeOpen = window.open.bind(window);
  window.open = (url, target, features) => openInPlace(url) || nativeOpen(url, target, features);
  document.addEventListener("click", (event) => {
    const link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!(link instanceof HTMLAnchorElement) || !isQqMusicUrl(link.href)) return;
    link.target = "_self";
    if (event.defaultPrevented) return;
    if (link.target && link.target !== "_self") {
      event.preventDefault();
      location.href = link.href;
    }
  }, true);
  document.querySelectorAll("a[target]").forEach((link) => {
    if (link instanceof HTMLAnchorElement) link.target = "_self";
  });
})()`;

const qqClientPromptGuardScript = `(() => {
  if (window.__tikpalQqClientPromptGuardInstalled) return;
  window.__tikpalQqClientPromptGuardInstalled = true;
  window.__tikpalQqClientPromptRetried = false;
  const textOf = (element) => String(element?.innerText || element?.textContent || "").replace(/\\s+/g, "").trim();
  const playAction = (target) => {
    const action = target?.closest?.("a,button,[role='button']");
    if (!action) return null;
    const label = textOf(action);
    return action.matches(".list_menu__play,[title='播放']") || label === "播放" || label === "播放全部"
      ? action
      : null;
  };
  document.addEventListener("click", (event) => {
    if (!event.isTrusted) return;
    const action = playAction(event.target);
    if (!action) return;
    window.__tikpalLastQqPlayTarget = action;
    window.__tikpalQqClientPromptRetried = false;
  }, true);
})()`;

const qqClientPromptExpression = `(() => {
  const textOf = (element) => String(element?.innerText || element?.textContent || "").replace(/\\s+/g, "").trim();
  const visible = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width >= 8 &&
      rect.height >= 8 &&
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < innerWidth &&
      rect.top < innerHeight &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || "1") > 0.05;
  };
  const dialog = Array.from(document.querySelectorAll(".yqq-dialog,[role='dialog'],.mod_popup"))
    .find((element) => {
      const text = textOf(element);
      return visible(element) &&
        !text.includes("下载客户端体验更多内容") &&
        text.includes("打开客户端") &&
        text.includes("下载客户端");
    });
  if (!dialog) return { handled: false };

  const close = Array.from(dialog.querySelectorAll(".yqq-dialog-close,[aria-label='Close'],[class*='close']")).find(visible);
  if (!close) return { handled: false };

  const remembered = window.__tikpalLastQqPlayTarget;
  const fallback = Array.from(document.querySelectorAll("a.mod_btn,button.mod_btn,.list_menu__play,[title='播放']"))
    .find((element) => visible(element) && ["播放", "播放全部"].includes(textOf(element)));
  const play = remembered?.isConnected && visible(remembered) ? remembered : fallback;
  const retried = Boolean(play) && window.__tikpalQqClientPromptRetried !== true;
  close.click();
  if (retried) {
    window.__tikpalQqClientPromptRetried = true;
    setTimeout(() => play.click(), 150);
  }
  return { handled: true, closed: true, retried };
})()`;

async function installSinglePaneNavigation(target) {
  if (!isQqMusicPage(target)) return;
  if (!qqInjectedTargets.has(target.id)) {
    await cdpCommand(target.webSocketDebuggerUrl, "Page.addScriptToEvaluateOnNewDocument", {
      source: singlePaneScript
    }).catch(() => {});
    await cdpCommand(target.webSocketDebuggerUrl, "Page.addScriptToEvaluateOnNewDocument", {
      source: qqClientPromptGuardScript
    }).catch(() => {});
    qqInjectedTargets.add(target.id);
  }
  await evaluate(target.webSocketDebuggerUrl, singlePaneScript).catch(() => {});
  await evaluate(target.webSocketDebuggerUrl, qqClientPromptGuardScript).catch(() => {});
}

async function closeTarget(target) {
  if (!target?.id) return;
  await fetch(`http://127.0.0.1:${port}/json/close/${encodeURIComponent(target.id)}`, {
    signal: AbortSignal.timeout(800)
  }).catch(() => {});
}

async function pruneDuplicatePlayerPages(targets) {
  const pages = targets.filter(isQqMusicPlayerPage);
  if (pages.length <= 1) return;

  const pageStateExpression = "({visibility:document.visibilityState,focus:document.hasFocus()})";
  const states = await Promise.all(pages.map(async (target, index) => ({
    target,
    index,
    state: await evaluate(target.webSocketDebuggerUrl, pageStateExpression).catch(() => null)
  })));
  const keep =
    states.find((entry) => entry.state?.focus === true) ||
    states.find((entry) => entry.state?.visibility === "visible") ||
    states[0];

  for (const entry of states) {
    if (entry === keep) continue;
    await closeTarget(entry.target);
    console.log(`[tikpal-web-mode-guard] closed duplicate QQ player page ${entry.target.id}`);
  }
}

const autoConfirmExpression = `(() => {
  const safeLabels = new Set(${JSON.stringify(safeLabels)});
  const dismissLabels = new Set(${JSON.stringify(dismissLabels)});
  const dangerText = /(登录|支付|购买|开通|授权|绑定|隐私|协议|会员|VIP|充值|订阅)/i;
  const buttonSelectors = [
    "button",
    "a",
    "[role='button']",
    "input[type='button']",
    "input[type='submit']",
    ".btn",
    ".button",
    ".qui_btn",
    ".popup__btn",
    ".mod_btn",
    "[class*='btn']",
    "[class*='button']"
  ].join(",");
  const modalSelectors = [
    "[role='dialog']",
    ".popup",
    ".modal",
    ".dialog",
    ".qui_dialog",
    ".qui_pop",
    ".qui_popup",
    ".mod_popup",
    ".popup_box",
    "[class*='popup']",
    "[class*='dialog']",
    "[class*='modal']",
    "[class*='layer']",
    "[class*='confirm']"
  ].join(",");
  const textOf = (element) => String(
    element?.value || element?.innerText || element?.textContent || ""
  ).replace(/\\s+/g, "").trim();
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const view = element.ownerDocument?.defaultView || window;
    const style = view.getComputedStyle(element);
    return rect.width >= 12 &&
      rect.height >= 12 &&
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < innerWidth &&
      rect.top < innerHeight &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || "1") > 0.05;
  };
  const clickableElement = (element) => {
    if (!element) return null;
    if (element.matches?.(buttonSelectors)) return element;
    const parent = element.closest?.(buttonSelectors);
    if (parent) return parent;
    const view = element.ownerDocument?.defaultView || window;
    const style = view.getComputedStyle(element);
    if (style.cursor === "pointer" || element.onclick || element.tabIndex >= 0) return element;
    return null;
  };
  const compactContext = (element) => {
    let current = element;
    while (current && current !== current.ownerDocument.body) {
      const text = textOf(current);
      if (text && text.length <= 260) return { element: current, text };
      current = current.parentElement;
    }
    return { element: element.parentElement, text: textOf(element.parentElement || element).slice(0, 260) };
  };
  const isLikelyPopupAction = (element) => {
    const modal = element.closest?.(modalSelectors);
    if (modal && visible(modal)) return true;
    const rect = element.getBoundingClientRect();
    const view = element.ownerDocument?.defaultView || window;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const nearCenter = centerX > view.innerWidth * 0.25 &&
      centerX < view.innerWidth * 0.75 &&
      centerY > view.innerHeight * 0.25 &&
      centerY < view.innerHeight * 0.75;
    if (!nearCenter) return false;
    let current = element.parentElement;
    while (current && current !== document.body) {
      const style = view.getComputedStyle(current);
      if (["fixed", "absolute", "sticky"].includes(style.position) && Number(style.zIndex || "0") >= 1) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  };
  const docs = [document];
  for (const frame of Array.from(document.querySelectorAll("iframe"))) {
    try {
      if (frame.contentDocument) docs.push(frame.contentDocument);
    } catch {}
  }

  for (const doc of docs) {
    const elements = [
      ...Array.from(doc.querySelectorAll(buttonSelectors)),
      ...Array.from(doc.querySelectorAll("div,span,p"))
    ];
    const seen = new Set();
    for (const raw of elements) {
      const candidate = clickableElement(raw);
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      if (!visible(candidate)) continue;
      const label = textOf(raw);
      if (!safeLabels.has(label)) continue;
      if (!isLikelyPopupAction(candidate)) continue;
      const container = candidate.closest(modalSelectors) || compactContext(candidate).element;
      const context = (textOf(container) || compactContext(candidate).text).slice(0, 800);
      if (!context || (dangerText.test(context) && !dismissLabels.has(label))) continue;
      candidate.click();
      return { clicked: true, label };
    }
  }
  return { clicked: false };
})()`;

const consentConfirmExpression = `(() => {
  const acceptAllLabels = new Set(${JSON.stringify(consentAcceptAllLabels.map((label) => label.replace(/\s+/g, "").toLowerCase()))});
  const fallbackLabels = new Set(${JSON.stringify(consentFallbackLabels.map((label) => label.replace(/\s+/g, "").toLowerCase()))});
  const rejectLabels = new Set(${JSON.stringify(consentRejectLabels.map((label) => label.replace(/\s+/g, "").toLowerCase()))});
  const consentText = /(cookie|cookies|cookie policy|cookie settings|consent|privacy|gdpr|personal data|personal information|tracking|広告識別子|クッキー|プライバシー|個人情報|쿠키|개인정보|隐私|隱私|个人信息|個人資料|数据|資料|个人资料|個人資料)/i;
  const dangerText = /(log in|login|sign in|payment|purchase|subscribe|membership|premium|vip|authorization|authorize|terms of service|terms of use|user agreement|service agreement|登录|登入|支付|购买|購買|开通|開通|授权|授權|会员|會員|充值|订阅|訂閱|用户协议|用戶協議|服务协议|服務協議|服务条款|服務條款|使用条款|使用條款|ログイン|サインイン|支払い|購入|利用規約|ログイン|결제|구매|로그인|구독|약관)/i;
  const rejectActionText = /(reject|decline|deny|manage|settings|preferences|customi[sz]e|learn more|more options|necessary only|only necessary|save preferences|拒绝|拒絕|管理|设置|設定|偏好|更多选项|更多選項|仅必要|僅必要|只接受必要|拒否|カスタマイズ|必要なものだけ|거부|관리|설정|필수만|ablehnen|verwalten|einstellungen|refuser|param[èe]tres|personnaliser|rechazar|configurar)/i;
  const buttonSelectors = [
    "button",
    "a",
    "[role='button']",
    "input[type='button']",
    "input[type='submit']",
    "[class*='btn']",
    "[class*='button']"
  ].join(",");
  const modalSelectors = [
    "[role='dialog']",
    "[aria-modal='true']",
    "[id*='cookie' i]",
    "[class*='cookie' i]",
    "[id*='consent' i]",
    "[class*='consent' i]",
    "[id*='privacy' i]",
    "[class*='privacy' i]",
    "[class*='modal' i]",
    "[class*='dialog' i]",
    "[class*='popup' i]",
    "[class*='banner' i]"
  ].join(",");
  const textOf = (element) => String(element?.value || element?.innerText || element?.textContent || "").replace(/\\s+/g, " ").trim();
  const attr = (element, name) => String(element?.getAttribute?.(name) || "").replace(/\\s+/g, " ").trim();
  const keyOf = (value) => String(value || "").replace(/\\s+/g, "").toLowerCase();
  const labelsOf = (element) => Array.from(new Set([
    attr(element, "aria-label"),
    attr(element, "title"),
    attr(element, "alt"),
    String(element?.value || "").trim(),
    textOf(element)
  ].filter(Boolean)));
  const metadataOf = (element) => {
    const parts = [];
    let cursor = element;
    for (let depth = 0; cursor && depth < 3; depth += 1) {
      parts.push(attr(cursor, "id"));
      parts.push(String(cursor.className || ""));
      parts.push(attr(cursor, "aria-label"));
      parts.push(attr(cursor, "title"));
      cursor = cursor.parentElement;
    }
    return parts.filter(Boolean).join(" ");
  };
  const labelMatch = (element) => {
    const labels = labelsOf(element);
    if (!labels.length) return null;
    const keys = labels.map(keyOf);
    const labelBlob = labels.join(" ");
    if (keys.some((key) => rejectLabels.has(key)) || rejectActionText.test(labelBlob)) return null;
    for (let index = 0; index < labels.length; index += 1) {
      if (acceptAllLabels.has(keys[index])) return { label: labels[index], priority: 0 };
    }
    for (let index = 0; index < labels.length; index += 1) {
      if (fallbackLabels.has(keys[index])) return { label: labels[index], priority: 1 };
    }
    return null;
  };
  const visible = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const view = element.ownerDocument?.defaultView || window;
    const style = view.getComputedStyle(element);
    return rect.width >= 12 &&
      rect.height >= 12 &&
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < view.innerWidth &&
      rect.top < view.innerHeight &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || "1") > 0.05;
  };
  const docs = [document];
  for (const frame of Array.from(document.querySelectorAll("iframe"))) {
    try {
      if (frame.contentDocument) docs.push(frame.contentDocument);
    } catch {}
  }
  const candidates = [];
  for (const doc of docs) {
    let order = 0;
    for (const element of Array.from(doc.querySelectorAll(buttonSelectors))) {
      order += 1;
      if (!visible(element)) continue;
      const match = labelMatch(element);
      if (!match) continue;
      const container = element.closest(modalSelectors) || element.parentElement;
      const context = (textOf(container || element) + " " + metadataOf(container || element)).slice(0, 2000);
      if (!consentText.test(context)) continue;
      if (dangerText.test(context)) continue;
      candidates.push({ element, label: match.label, priority: match.priority, order });
    }
  }
  candidates.sort((left, right) => left.priority - right.priority || left.order - right.order);
  const candidate = candidates[0];
  if (candidate) {
    candidate.element.click();
    return { clicked: true, label: candidate.label, priority: candidate.priority };
  }
  return { clicked: false };
})()`;

async function runConsentFeatures(targets) {
  const providerTargets = targets.filter((target) => isProviderWebPage(target) && !isFriendlyErrorPage(target));
  for (const target of providerTargets) {
    const result = await evaluate(target.webSocketDebuggerUrl, consentConfirmExpression).catch(() => null);
    if (result?.clicked) {
      console.log(`[tikpal-web-mode-guard] clicked consent ${providerId} ${result.label}`);
      return;
    }
  }
}

async function runSafePromptFeatures(targets) {
  let providerTargets = targets.filter(isProviderWebPage);
  if (providerId === "qq_music" && qqAutoConfirm) {
    await pruneDuplicatePlayerPages(targets);
    providerTargets = targets.filter(isQqMusicPage);
    await Promise.all(providerTargets.map((target) => installSinglePaneNavigation(target).catch(() => {})));
  } else if (providerId !== "youtube_music") {
    return;
  }
  const target = providerTargets.find(Boolean);
  if (!target) return;
  if (providerId === "qq_music") {
    const clientPrompt = await evaluate(target.webSocketDebuggerUrl, qqClientPromptExpression).catch(() => null);
    if (clientPrompt?.handled) {
      console.log(`[tikpal-web-mode-guard] closed QQ client prompt retry=${clientPrompt.retried ? "1" : "0"}`);
      return;
    }
  }
  const result = await evaluate(target.webSocketDebuggerUrl, autoConfirmExpression).catch(() => null);
  if (result?.clicked) {
    console.log(`[tikpal-web-mode-guard] clicked prompt ${providerId} ${result.label}`);
  }
}

async function guardOnce() {
  if (typeof WebSocket !== "function") return;
  const targets = (await readTargets()).filter(isPageTarget);
  await Promise.all(targets.map(async (target) => {
    attachEarlyErrorRedirect(target);
    await installKioskGuard(target);
    await maybeRedirectErrorPage(target);
  }));
  await runInputFocusKeyboard(targets);
  await runConsentFeatures(targets);
  await runSafePromptFeatures(targets);
}

if (process.argv.includes("--check")) {
  console.log("[tikpal-web-mode-guard] check passed");
  console.log(`[tikpal-web-mode-guard] port: ${Number.isFinite(port) ? port : 9234}`);
  console.log("[tikpal-web-mode-guard] kiosk interaction blocking: 1");
  console.log("[tikpal-web-mode-guard] friendly error redirect: 1");
  console.log("[tikpal-web-mode-guard] provider native failure redirect: 1");
  console.log("[tikpal-web-mode-guard] early load-failure redirect: 1");
  console.log("[tikpal-web-mode-guard] oauth navigation abort ignored: 1");
  console.log("[tikpal-web-mode-guard] safe consent auto confirm: 1");
  console.log("[tikpal-web-mode-guard] cookie accept-all auto confirm: 1");
  console.log("[tikpal-web-mode-guard] all-provider consent polling: 1");
  console.log(`[tikpal-web-mode-guard] input focus keyboard: ${onboardAutoFocus ? "1" : "0"}`);
  console.log(`[tikpal-web-mode-guard] empty page timeout: ${Math.round(emptyPageTimeoutMs / 1000)}s`);
  console.log(`[tikpal-web-mode-guard] qq auto confirm: ${qqAutoConfirm ? "1" : "0"}`);
  console.log("[tikpal-web-mode-guard] youtube safe dismiss: 1");
  console.log(`[tikpal-web-mode-guard] accept-all labels: ${consentAcceptAllLabels.join(",")}`);
  console.log(`[tikpal-web-mode-guard] safe labels: ${safeLabels.join(",")}`);
  console.log(`[tikpal-web-mode-guard] dismiss labels: ${dismissLabels.join(",")}`);
  console.log("[tikpal-web-mode-guard] duplicate player pruning: 1");
  console.log("[tikpal-web-mode-guard] single pane navigation: 1");
  console.log("[tikpal-web-mode-guard] qq client prompt close/retry: 1");
  console.log("[tikpal-web-mode-guard] qq login prompt preserve: 1");
  process.exit(0);
}

while (profileProcessExists()) {
  try {
    await guardOnce();
  } catch {
    // Guard failures must never break Explore playback or login.
  }
  await sleep(pollMs);
}

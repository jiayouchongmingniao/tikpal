#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const port = Number.parseInt(process.env.TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT || "9234", 10);
const profile = process.env.TIKPAL_WEB_MODE_PROVIDER_PROFILE || "";
const providerId = process.env.TIKPAL_WEB_MODE_PROVIDER_ID || "";
const providerLabel = process.env.TIKPAL_WEB_MODE_PROVIDER_LABEL || providerId || "Web player";
const proxyMode = process.env.TIKPAL_WEB_MODE_PROXY_MODE === "proxy" ? "proxy" : "direct";
const errorPageBaseUrl = process.env.TIKPAL_WEB_MODE_ERROR_PAGE_URL || "http://127.0.0.1:4173/web-mode-error.html";
const qqAutoConfirm = /^(1|true|yes|on|enabled)$/i.test(process.env.TIKPAL_WEB_MODE_QQ_AUTO_CONFIRM || "1");
const emptyPageTimeoutMs = Math.max(5, Number.parseInt(process.env.TIKPAL_WEB_MODE_EMPTY_PAGE_ERROR_SECONDS || "18", 10) || 18) * 1000;
const pollMs = 250;
const safeLabels = ["确定", "确认", "取消", "关闭", "知道了", "我知道了", "好的", "好", "开始播放", "继续播放"];
const dismissLabels = ["取消", "关闭", "知道了", "我知道了", "好的", "好"];
const kioskInjectedTargets = new Set();
const qqInjectedTargets = new Set();
const earlyRedirectTargets = new Set();
const redirectedTargets = new Set();
const targetFirstSeenAt = new Map();

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

async function installKioskGuard(target) {
  if (!isPageTarget(target)) return;
  if (!kioskInjectedTargets.has(target.id)) {
    await cdpCommand(target.webSocketDebuggerUrl, "Page.addScriptToEvaluateOnNewDocument", {
      source: kioskGuardScript
    }).catch(() => {});
    kioskInjectedTargets.add(target.id);
  }
  await evaluate(target.webSocketDebuggerUrl, kioskGuardScript).catch(() => {});
}

function errorPageUrl(reason) {
  const url = new URL(errorPageBaseUrl);
  url.searchParams.set("provider", providerId || "web");
  url.searchParams.set("label", providerLabel);
  url.searchParams.set("reason", reason || "load_failed");
  url.searchParams.set("proxy", proxyMode);
  return url.href;
}

function parseErrorReason(text, title) {
  if (String(`${title || ""} ${text || ""}`).includes("empty_page_timeout")) return "empty_page_timeout";
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
      redirect(parseErrorReason(message.params?.errorText, message.params?.blockedReason));
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
  if (!targetFirstSeenAt.has(target.id)) targetFirstSeenAt.set(target.id, Date.now());
  const targetUrl = String(target.url || "");
  let looksLikeError = targetUrl.startsWith("chrome-error://");
  let diagnostics = null;

  if (!looksLikeError) {
    diagnostics = await evaluate(target.webSocketDebuggerUrl, `(() => ({
      href: location.href,
      title: document.title || "",
      readyState: document.readyState,
      text: document.body ? document.body.innerText.slice(0, 1600) : "",
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
    const waitedLongEnough = Date.now() - (targetFirstSeenAt.get(target.id) || Date.now()) >= emptyPageTimeoutMs;
    const visibleText = String(diagnostics?.text || "").trim();
    if (!looksLikeError && waitedLongEnough && isProviderWebPage(target) && visibleText.length < 12 && Number(diagnostics?.visibleCount || 0) <= 3) {
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
  const reason = parseErrorReason(diagnostics?.text, diagnostics?.title || target.title);
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

async function installSinglePaneNavigation(target) {
  if (!isQqMusicPage(target)) return;
  if (!qqInjectedTargets.has(target.id)) {
    await cdpCommand(target.webSocketDebuggerUrl, "Page.addScriptToEvaluateOnNewDocument", {
      source: singlePaneScript
    }).catch(() => {});
    qqInjectedTargets.add(target.id);
  }
  await evaluate(target.webSocketDebuggerUrl, singlePaneScript).catch(() => {});
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

async function runQqFeatures(targets) {
  if (providerId !== "qq_music" || !qqAutoConfirm) return;
  await pruneDuplicatePlayerPages(targets);
  const qqTargets = targets.filter(isQqMusicPage);
  await Promise.all(qqTargets.map((target) => installSinglePaneNavigation(target).catch(() => {})));
  const target = qqTargets.find(Boolean);
  if (!target) return;
  const result = await evaluate(target.webSocketDebuggerUrl, autoConfirmExpression).catch(() => null);
  if (result?.clicked) {
    console.log(`[tikpal-web-mode-guard] clicked QQ ${result.label}`);
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
  await runQqFeatures(targets);
}

if (process.argv.includes("--check")) {
  console.log("[tikpal-web-mode-guard] check passed");
  console.log(`[tikpal-web-mode-guard] port: ${Number.isFinite(port) ? port : 9234}`);
  console.log("[tikpal-web-mode-guard] kiosk interaction blocking: 1");
  console.log("[tikpal-web-mode-guard] friendly error redirect: 1");
  console.log("[tikpal-web-mode-guard] early load-failure redirect: 1");
  console.log(`[tikpal-web-mode-guard] empty page timeout: ${Math.round(emptyPageTimeoutMs / 1000)}s`);
  console.log(`[tikpal-web-mode-guard] qq auto confirm: ${qqAutoConfirm ? "1" : "0"}`);
  console.log(`[tikpal-web-mode-guard] safe labels: ${safeLabels.join(",")}`);
  console.log(`[tikpal-web-mode-guard] dismiss labels: ${dismissLabels.join(",")}`);
  console.log("[tikpal-web-mode-guard] duplicate player pruning: 1");
  console.log("[tikpal-web-mode-guard] single pane navigation: 1");
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

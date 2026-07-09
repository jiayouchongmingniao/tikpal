#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const port = Number.parseInt(process.env.TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT || "9234", 10);
const profile = process.env.TIKPAL_WEB_MODE_PROVIDER_PROFILE || "";
const pollMs = 250;
const safeLabels = ["确定", "确认", "取消", "知道了", "我知道了", "好的", "好", "开始播放", "继续播放"];
const injectedTargets = new Set();

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

function isQqMusicPage(target) {
  if (target?.type !== "page" || !target.webSocketDebuggerUrl) return false;
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

function evaluate(wsUrl, expression) {
  return cdpCommand(wsUrl, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  }).then((result) => result?.result?.value || null);
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
  if (!target?.webSocketDebuggerUrl) return;
  if (!injectedTargets.has(target.id)) {
    await cdpCommand(target.webSocketDebuggerUrl, "Page.addScriptToEvaluateOnNewDocument", {
      source: singlePaneScript
    }).catch(() => {});
    injectedTargets.add(target.id);
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
    console.log(`[tikpal-web-mode-qq-confirm] closed duplicate player page ${entry.target.id}`);
  }
}

const autoConfirmExpression = `(() => {
  const safeLabels = new Set(${JSON.stringify(safeLabels)});
  const dangerText = /(登录|支付|购买|开通|授权|绑定|隐私|协议|会员|VIP|充值|订阅)/i;
  const selectors = [
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
    ".popup_box"
  ].join(",");
  const textOf = (element) => String(
    element?.value || element?.innerText || element?.textContent || ""
  ).replace(/\\s+/g, "").trim();
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
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

  for (const candidate of Array.from(document.querySelectorAll(selectors))) {
    if (!visible(candidate)) continue;
    const label = textOf(candidate);
    if (!safeLabels.has(label)) continue;
    const container = candidate.closest(modalSelectors) || candidate.parentElement;
    const context = textOf(container || document.body).slice(0, 800);
    if (!context || dangerText.test(context)) continue;
    candidate.click();
    return { clicked: true, label };
  }
  return { clicked: false };
})()`;

async function confirmOnce() {
  if (typeof WebSocket !== "function") {
    return;
  }
  const targets = await readTargets();
  await pruneDuplicatePlayerPages(targets);
  const nextTargets = await readTargets();
  const target = nextTargets.find(isQqMusicPage);
  if (!target) return;
  await installSinglePaneNavigation(target);
  const result = await evaluate(target.webSocketDebuggerUrl, autoConfirmExpression);
  if (result?.clicked) {
    console.log(`[tikpal-web-mode-qq-confirm] clicked ${result.label}`);
  }
}

if (process.argv.includes("--check")) {
  console.log("[tikpal-web-mode-qq-confirm] check passed");
  console.log(`[tikpal-web-mode-qq-confirm] port: ${Number.isFinite(port) ? port : 9234}`);
  console.log(`[tikpal-web-mode-qq-confirm] safe labels: ${safeLabels.join(",")}`);
  console.log("[tikpal-web-mode-qq-confirm] duplicate player pruning: 1");
  console.log("[tikpal-web-mode-qq-confirm] single pane navigation: 1");
  process.exit(0);
}

while (profileProcessExists()) {
  try {
    await confirmOnce();
  } catch {
    // The helper is best-effort; QQ popups must never break Web Mode itself.
  }
  await sleep(pollMs);
}

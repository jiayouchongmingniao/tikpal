#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const port = Number.parseInt(process.env.TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT || "9234", 10);
const profile = process.env.TIKPAL_WEB_MODE_PROVIDER_PROFILE || "";
const pollMs = 1000;
const safeLabels = ["确定", "确认", "取消", "知道了", "我知道了", "好的", "好", "开始播放", "继续播放"];

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

function evaluate(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error("CDP evaluate timed out"));
    }, 1200);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
          expression,
          awaitPromise: true,
          returnByValue: true
        }
      }));
    });
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      ws.close();
      if (message.error) {
        reject(new Error(message.error.message || "CDP evaluate failed"));
        return;
      }
      resolve(message.result?.result?.value || null);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("CDP websocket failed"));
    });
  });
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
  const target = targets.find(isQqMusicPage);
  if (!target) return;
  const result = await evaluate(target.webSocketDebuggerUrl, autoConfirmExpression);
  if (result?.clicked) {
    console.log(`[tikpal-web-mode-qq-confirm] clicked ${result.label}`);
  }
}

if (process.argv.includes("--check")) {
  console.log("[tikpal-web-mode-qq-confirm] check passed");
  console.log(`[tikpal-web-mode-qq-confirm] port: ${Number.isFinite(port) ? port : 9234}`);
  console.log(`[tikpal-web-mode-qq-confirm] safe labels: ${safeLabels.join(",")}`);
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

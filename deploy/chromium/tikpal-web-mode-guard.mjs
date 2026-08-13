#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number.parseInt(process.env.TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT || "9234", 10);
const profile = process.env.TIKPAL_WEB_MODE_PROVIDER_PROFILE || "";
const statePath = process.env.TIKPAL_WEB_MODE_STATE_PATH || "";
const providerId = process.env.TIKPAL_WEB_MODE_PROVIDER_ID || "";
const providerLabel = process.env.TIKPAL_WEB_MODE_PROVIDER_LABEL || providerId || "Web player";
const proxyMode = process.env.TIKPAL_WEB_MODE_PROXY_MODE === "proxy" ? "proxy" : "direct";
const errorPageBaseUrl = process.env.TIKPAL_WEB_MODE_ERROR_PAGE_URL || "http://127.0.0.1:4173/web-mode-error.html";
const qqAutoConfirm = /^(1|true|yes|on|enabled)$/i.test(process.env.TIKPAL_WEB_MODE_QQ_AUTO_CONFIRM || "1");
const qqAutoUnmute = /^(1|true|yes|on|enabled)$/i.test(process.env.TIKPAL_WEB_MODE_QQ_AUTO_UNMUTE || "1");
const qqAudioPrime = /^(1|true|yes|on|enabled)$/i.test(process.env.TIKPAL_WEB_MODE_QQ_AUDIO_PRIME || "1");
const qqMusicAutoPlay = /^(1|true|yes|on|enabled)$/i.test(process.env.TIKPAL_WEB_MODE_QQ_MUSIC_AUTO_PLAY || "1");
const qqMvAutoFullscreen = /^(1|true|yes|on|enabled)$/i.test(process.env.TIKPAL_WEB_MODE_QQ_MV_AUTO_FULLSCREEN || "0");
const qqMvCinemaMode = /^(1|true|yes|on|enabled)$/i.test(process.env.TIKPAL_WEB_MODE_QQ_MV_CINEMA_MODE || "1");
const qqMvAutoPlay = /^(1|true|yes|on|enabled)$/i.test(process.env.TIKPAL_WEB_MODE_QQ_MV_AUTO_PLAY || "1");
const neteaseAutoPlay = /^(1|true|yes|on|enabled)$/i.test(process.env.TIKPAL_WEB_MODE_NETEASE_AUTO_PLAY || "1");
const onboardAutoFocus = /^(1|true|yes|on|enabled)$/i.test(process.env.TIKPAL_WEB_MODE_ONBOARD_AUTO_FOCUS || "1");
const allowProgrammaticInputFocus = providerId !== "suno";
const launcherPath = fileURLToPath(new URL("./tikpal-web-mode.sh", import.meta.url));
const keyboardActionUrl = `http://127.0.0.1:${process.env.TIKPAL_API_PORT || "8787"}/api/v1/web-mode/actions`;
const emptyPageTimeoutMs = Math.max(5, Number.parseInt(process.env.TIKPAL_WEB_MODE_EMPTY_PAGE_ERROR_SECONDS || "18", 10) || 18) * 1000;
const activePollMs = 250;
const idlePollMs = Math.max(activePollMs, Number.parseInt(process.env.TIKPAL_WEB_MODE_PROVIDER_GUARD_IDLE_POLL_MS || "2000", 10) || 2000);
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
const tidalOneTrustConsentExpression = `(() => {
  const button = document.querySelector("#onetrust-accept-btn-handler");
  if (!(button instanceof HTMLElement)) return { clicked: false };
  const rect = button.getBoundingClientRect();
  const style = getComputedStyle(button);
  const visible = rect.width >= 8 &&
    rect.height >= 8 &&
    rect.right > 0 &&
    rect.bottom > 0 &&
    rect.left < innerWidth &&
    rect.top < innerHeight &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity || "1") > 0.05;
  if (!visible) return { clicked: false };
  button.click();
  return { clicked: true, label: "Accept" };
})()`;
const kioskInjectedTargets = new Set();
const qqInjectedTargets = new Set();
const earlyRedirectTargets = new Set();
const redirectedTargets = new Set();
const targetProgressState = new Map();
const inputFocusRequests = new Map();
const qqAudioUnmuteAttempts = new Map();
const qqAudioPrimeAttempts = new Map();
const qqMusicAutoPlayStates = new Map();
const qqMvCinemaStates = new Map();
const qqMvAutoPlayStates = new Map();
const neteaseAutoPlayStates = new Map();
let lastOnboardVisible = null;
let lastOnboardActionMs = 0;
const providerNativeFailureIds = new Set(["amazon_music", "qobuz", "deezer"]);
const providerReadyHosts = {
  suno: ["suno.com", "www.suno.com"],
  spotify: ["open.spotify.com"],
  youtube_music: ["music.youtube.com", "www.youtube.com", "youtube.com"],
  apple_music: ["music.apple.com"],
  tidal: ["listen.tidal.com", "tidal.com"],
  qobuz: ["play.qobuz.com", "www.qobuz.com", "qobuz.com"],
  deezer: ["www.deezer.com", "deezer.com"],
  amazon_music: ["music.amazon.com", "music.amazon.co.jp", "music.amazon.co.uk", "music.amazon.de", "music.amazon.fr", "music.amazon.it", "music.amazon.es"],
  qq_music: ["y.qq.com"],
  netease_music: ["music.163.com"]
};
const qqAudioUnmuteCooldownMs = 5000;
const qqAudioPrimeCooldownMs = 12000;
const qqMusicAutoPlayDelayMs = 1800;
const qqMusicAutoPlayRetryMs = 4200;
const qqMusicAutoPlayMaxAttempts = 2;
const qqMvAutoPlayDelayMs = 1700;
const qqMvAutoPlayMaxStartSeconds = 1.5;
const qqMvAutoPlayProgressEpsilonSeconds = 0.2;
const neteaseAutoPlayDelayMs = 1800;
const neteaseAutoPlayMaxStartSeconds = 1.5;
const neteaseAutoPlayProgressEpsilonSeconds = 0.2;

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

function providerIsActive() {
  if (!statePath || !providerId) return true;
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    return String(state?.activeProvider || "") === providerId;
  } catch {
    return true;
  }
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

function hostMatches(host, expectedHost) {
  return host === expectedHost || host.endsWith(`.${expectedHost}`);
}

function isExpectedProviderPage(target) {
  if (!isPageTarget(target) || isFriendlyErrorPage(target) || redirectedTargets.has(target.id)) return false;
  const expectedHosts = providerReadyHosts[providerId] || [];
  if (expectedHosts.length === 0) return isProviderWebPage(target);
  try {
    const url = new URL(target.url || "");
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return expectedHosts.some((host) => hostMatches(url.hostname, host));
  } catch {
    return false;
  }
}

function writeResidentProviderStatus(status) {
  if (!statePath || !providerId) return;
  if (status !== "active") return;
  const normalizedStatus = status === "active" ? "active" : "ready";
  let state;
  try {
    state = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return;
  }
  if (state.activeProvider !== providerId) return;
  const residentProviders = state.residentProviders && typeof state.residentProviders === "object"
    ? state.residentProviders
    : {};
  const current = residentProviders[providerId] && typeof residentProviders[providerId] === "object"
    ? residentProviders[providerId]
    : {};
  if (current.status === normalizedStatus && !current.lastError) return;
  const now = new Date().toISOString();
  residentProviders[providerId] = {
    ...current,
    status: normalizedStatus,
    lastError: null,
    updatedAt: now
  };
  state.residentProviders = residentProviders;
  state.updatedAt = now;
  if (normalizedStatus === "active") state.lastError = null;
  try {
    mkdirSync(dirname(statePath), { recursive: true });
    const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`);
    renameSync(temporaryPath, statePath);
  } catch {}
}

function syncResidentProviderStatus(targets, active) {
  if (!targets.some(isExpectedProviderPage)) return;
  writeResidentProviderStatus(active ? "active" : "ready");
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

function isNeteaseMusicPage(target) {
  if (!isPageTarget(target)) return false;
  try {
    const url = new URL(target.url || "");
    return url.hostname === "music.163.com" || url.hostname.endsWith(".music.163.com");
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

const providerAudioGateScript = `(() => {
  if (window.__tikpalProviderAudioGate?.version >= 3) return;
  const state = {
    active: true,
    media: new WeakMap(),
    howlerSounds: [],
    audioContexts: new Set(),
    suspendedContexts: new Set()
  };
  const nativeAudioContext = window.AudioContext || window.webkitAudioContext;
  if (nativeAudioContext && !window.__tikpalNativeAudioContext) {
    window.__tikpalNativeAudioContext = nativeAudioContext;
    const PatchedAudioContext = function (...args) {
      const context = new nativeAudioContext(...args);
      state.audioContexts.add(context);
      return context;
    };
    PatchedAudioContext.prototype = nativeAudioContext.prototype;
    Object.setPrototypeOf(PatchedAudioContext, nativeAudioContext);
    window.AudioContext = PatchedAudioContext;
    if (window.webkitAudioContext) window.webkitAudioContext = PatchedAudioContext;
  }
  const mediaElements = () => Array.from(document.querySelectorAll("audio,video"));
  const setMediaActive = (active) => {
    for (const element of mediaElements()) {
      if (!(element instanceof HTMLMediaElement)) continue;
      const previous = state.media.get(element) || { wasPlaying: false };
      if (!active) {
        previous.wasPlaying = previous.wasPlaying || (!element.paused && !element.ended);
        state.media.set(element, previous);
        element.muted = true;
        try { element.pause(); } catch {}
      } else {
        element.muted = false;
        if (previous.wasPlaying && element.paused && !element.ended) {
          element.play().catch(() => {});
        }
        state.media.set(element, { ...previous, wasPlaying: false });
      }
    }
  };
  const setHowlerActive = (active) => {
    const howler = window.Howler;
    const howls = Array.isArray(howler?._howls) ? howler._howls : [];
    if (!howler || !howls.length) return;
    if (!active) {
      for (const howl of howls) {
        const sounds = Array.isArray(howl?._sounds) ? howl._sounds : [];
        for (const sound of sounds) {
          if (sound?._paused || sound?._id === undefined) continue;
          if (!state.howlerSounds.some(([knownHowl, knownId]) => knownHowl === howl && knownId === sound._id)) {
            state.howlerSounds.push([howl, sound._id]);
          }
        }
      }
      try { howler.mute(true); } catch {}
      for (const [howl, id] of state.howlerSounds) {
        try { howl.pause(id); } catch {}
      }
    } else {
      try { howler.mute(false); } catch {}
      for (const [howl, id] of state.howlerSounds.splice(0)) {
        try { howl.play(id); } catch {}
      }
    }
  };
  const setAudioContextsActive = (active) => {
    const contexts = Array.from(state.audioContexts);
    if (!active) {
      for (const context of contexts) {
        if (context?.state === "running") {
          state.suspendedContexts.add(context);
          context.suspend?.().catch?.(() => {});
        }
      }
    } else {
      for (const context of contexts) {
        if (context?.state === "suspended") context.resume?.().catch?.(() => {});
      }
      state.suspendedContexts.clear();
    }
  };
  const setActive = (active) => {
    const nextActive = active === true;
    try {
      window.postMessage({ type: "tikpal-provider-audio-muted", muted: !nextActive }, window.location.origin);
    } catch {}
    if (state.active === nextActive) {
      if (nextActive) {
        setMediaActive(true);
        setHowlerActive(true);
        setAudioContextsActive(true);
      } else {
        setMediaActive(false);
        setHowlerActive(false);
        setAudioContextsActive(false);
      }
      return status();
    }
    state.active = nextActive;
    setMediaActive(nextActive);
    setHowlerActive(nextActive);
    setAudioContextsActive(nextActive);
    return status();
  };
  const status = () => ({
    active: state.active,
    mediaCount: mediaElements().length,
    playingCount: mediaElements().filter((element) => !element.paused && !element.ended).length,
    contextCount: state.audioContexts.size,
    contextStates: Array.from(state.audioContexts).map((context) => context?.state || "unknown")
  });
  document.addEventListener("play", (event) => {
    if (state.active) return;
    const element = event.target;
    if (!(element instanceof HTMLMediaElement)) return;
    element.muted = true;
    setTimeout(() => {
      try { element.pause(); } catch {}
    }, 0);
  }, true);
  window.__tikpalProviderAudioGate = { version: 3, setActive, status };
})()`;

function providerAudioGateExpression(active) {
  return `(() => {
    ${providerAudioGateScript}
    return window.__tikpalProviderAudioGate?.setActive(${active ? "true" : "false"}) || { active: ${active ? "true" : "false"}, mediaCount: 0 };
  })()`;
}

const inputFocusGuardScript = `(() => {
  if (window.__tikpalInputFocusGuardInstalled) return;
  window.__tikpalInputFocusGuardInstalled = true;
  window.__tikpalInputFocusShowRequest = 0;
  window.__tikpalInputFocusHideRequest = 0;
  window.__tikpalInputFocusSessionActive = false;
  const selector = ${JSON.stringify(onboardInputSelector)};
  const keyboardActionUrl = ${JSON.stringify(keyboardActionUrl)};
  const allowProgrammaticInputFocus = ${JSON.stringify(allowProgrammaticInputFocus)};
  let lastEditable = null;
  let lastKeyboardEnabled = null;
  let lastKeyboardRequestMs = 0;
  let outsidePointerDown = false;
  const editableTarget = (target) => target?.closest?.(selector) || null;
  const isEditable = (target) => Boolean(editableTarget(target));
  const activeEditable = () => editableTarget(document.activeElement);
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
    const throttleMs = force ? 1000 : 250;
    if (lastKeyboardEnabled === enabled && now - lastKeyboardRequestMs < throttleMs) return;
    lastKeyboardEnabled = enabled;
    lastKeyboardRequestMs = now;
    fetch(keyboardActionUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ type: "keyboard", enabled, force })
    }).catch(() => {});
  };
  const endInputSession = () => {
    lastEditable = null;
    window.__tikpalInputFocusSessionActive = false;
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
    window.__tikpalInputFocusSessionActive = true;
    window.__tikpalInputFocusShowRequest += 1;
    requestKeyboard(true, true);
    keepEditableFocus(target);
  };
  document.addEventListener("pointerdown", (event) => {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
    outsidePointerDown = !path.some(isEditable);
    if (outsidePointerDown) {
      endInputSession();
      window.__tikpalInputFocusHideRequest += 1;
      requestKeyboard(false);
    }
  }, true);
  document.addEventListener("pointerdown", requestShow, true);
  document.addEventListener("focusin", requestShow, true);
  document.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!document.hasFocus()) {
        const active = activeEditable();
        if (active || (window.__tikpalInputFocusSessionActive && lastEditable?.isConnected) || !outsidePointerDown) {
          lastEditable = active || lastEditable;
          window.__tikpalInputFocusSessionActive = Boolean(lastEditable);
          if (lastEditable) keepEditableFocus(lastEditable);
          return;
        }
        endInputSession();
        window.__tikpalInputFocusHideRequest += 1;
        requestKeyboard(false);
        return;
      }
      if (activeEditable() || document.activeElement?.tagName === "IFRAME") return;
      if (window.__tikpalInputFocusSessionActive && lastEditable && !outsidePointerDown) {
        refocusEditable(lastEditable);
        return;
      }
      endInputSession();
      window.__tikpalInputFocusHideRequest += 1;
      requestKeyboard(false);
    }, 80);
  }, true);
  document.addEventListener("submit", () => {
    endInputSession();
    window.__tikpalInputFocusHideRequest += 1;
    requestKeyboard(false);
  }, true);
  document.addEventListener("keydown", (event) => {
    const target = event.target?.closest?.(selector);
    if (event.key === "Enter" && target && !isMultiline(target)) {
      endInputSession();
      window.__tikpalInputFocusHideRequest += 1;
      requestKeyboard(false);
    }
  }, true);
})()`;

const inputFocusExpression = `(() => {
  const selector = ${JSON.stringify(onboardInputSelector)};
  const activeEditable = (doc) => {
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
    sessionActive: Boolean(window.__tikpalInputFocusSessionActive),
    focused: activeEditable(document)
  };
})()`;

function setOnboardVisible(enabled, force = false) {
  const now = Date.now();
  const throttleMs = force ? 1000 : 250;
  if (lastOnboardVisible === enabled && now - lastOnboardActionMs < throttleMs) return;
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
  let shouldShow = false;
  let shouldHide = false;
  for (const target of targets.filter(isProviderWebPage)) {
    currentTargetIds.add(target.id);
    const state = await evaluate(target.webSocketDebuggerUrl, inputFocusExpression).catch(() => null);
    if (!state) continue;
    const previous = inputFocusRequests.get(target.id) || { showRequest: 0, hideRequest: 0, focused: false, url: target.url };
    shouldShow ||= state.showRequest > previous.showRequest || (allowProgrammaticInputFocus && state.focused && !previous.focused);
    shouldHide ||= state.hideRequest > previous.hideRequest && !state.sessionActive;
    inputFocusRequests.set(target.id, { ...state, url: target.url });
  }
  for (const [targetId] of inputFocusRequests) {
    if (currentTargetIds.has(targetId)) continue;
    inputFocusRequests.delete(targetId);
  }
  if (shouldShow) setOnboardVisible(true, true);
  else if (shouldHide) setOnboardVisible(false);
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
    await cdpCommand(target.webSocketDebuggerUrl, "Page.addScriptToEvaluateOnNewDocument", {
      source: providerAudioGateScript
    }).catch(() => {});
    kioskInjectedTargets.add(target.id);
  }
  await evaluate(target.webSocketDebuggerUrl, kioskGuardScript).catch(() => {});
  await evaluate(target.webSocketDebuggerUrl, inputFocusGuardScript).catch(() => {});
  await evaluate(target.webSocketDebuggerUrl, providerAudioGateScript).catch(() => {});
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
  if (!isExpectedProviderPage(target) || earlyRedirectTargets.has(target.id)) return;
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
  if (!isExpectedProviderPage(target)) return;
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

const qqReminderCancelExpression = `(() => {
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
  const dialog = Array.from(document.querySelectorAll(".yqq-dialog-wrap,[role='dialog'],.yqq-dialog,.mod_popup"))
    .find((element) => {
      const text = textOf(element);
      return visible(element) &&
        text.includes("QQ音乐提醒您") &&
        !text.includes("下载客户端体验更多内容");
    });
  if (!dialog) return { handled: false };

  const cancel = Array.from(dialog.querySelectorAll("button,a,[role='button'],input[type='button'],input[type='submit']"))
    .find((element) => visible(element) && textOf(element) === "取消");
  if (!cancel) return { handled: false };
  cancel.click();
  return { handled: true, cancelled: true };
})()`;

const qqAudioStateExpression = `(() => {
  const icon = document.querySelector(".btn_big_voice");
  const play = document.querySelector(".btn_big_play,.btn_big_pause");
  if (!icon || !play) return { ready: false };
  const rect = icon.getBoundingClientRect();
  const iconText = String(icon.innerText || icon.title || "");
  const iconClass = String(icon.className || "");
  const playClass = String(play.className || "");
  const scaleX = window.outerWidth && window.innerWidth ? window.outerWidth / window.innerWidth : window.devicePixelRatio || 1;
  const scaleY = window.outerHeight && window.innerHeight ? window.outerHeight / window.innerHeight : window.devicePixelRatio || scaleX || 1;
  return {
    ready: true,
    muted: iconClass.includes("btn_big_voice--no") || iconText.includes("打开声音"),
    playing: playClass.includes("btn_big_play--pause"),
    iconX: rect.x + rect.width / 2,
    iconY: rect.y + rect.height / 2,
    scaleX,
    scaleY
  };
})()`;

const qqAudioPrimeExpression = `(async () => {
  const stopPrime = async (reason) => {
    const prime = window.__tikpalQqAudioPrime;
    window.__tikpalQqAudioPrime = null;
    if (prime?.oscillator) {
      try { prime.oscillator.stop(); } catch {}
      try { prime.oscillator.disconnect(); } catch {}
    }
    if (prime?.gain) {
      try { prime.gain.disconnect(); } catch {}
    }
    if (prime?.context && prime.context.state !== "closed") {
      await prime.context.close?.().catch(() => {});
    }
    return { primed: false, stopped: Boolean(prime), reason };
  };
  const icon = document.querySelector(".btn_big_voice");
  const play = document.querySelector(".btn_big_play,.btn_big_pause");
  if (!icon || !play) return stopPrime("not-player");
  const iconText = String(icon.innerText || icon.title || "");
  const iconClass = String(icon.className || "");
  const playClass = String(play.className || "");
  const muted = iconClass.includes("btn_big_voice--no") || iconText.includes("打开声音");
  const playing = playClass.includes("btn_big_play--pause");
  if (!playing || muted) return stopPrime(muted ? "muted" : "not-playing");
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return { primed: false, reason: "no-audio-context" };
  const existing = window.__tikpalQqAudioPrime;
  if (existing?.context && existing.context.state !== "closed") {
    await existing.context.resume?.().catch(() => {});
    return {
      primed: true,
      persistent: true,
      reused: true,
      state: existing.context.state
    };
  }
  const context = new Ctx();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  gain.gain.value = 0.000001;
  oscillator.frequency.value = 640;
  oscillator.connect(gain).connect(context.destination);
  await context.resume().catch(() => {});
  oscillator.start();
  window.__tikpalQqAudioPrime = { context, oscillator, gain };
  return {
    primed: true,
    persistent: true,
    reused: false,
    state: context.state
  };
})()`;

const qqMusicAutoPlayStateExpression = `(() => {
  if (!/(^|\\.)y\\.qq\\.com$/i.test(location.hostname)) return { ready: false, reason: "not-qq" };
  if (!/^\\/n\\/ryqq(?:_v\\d+)?\\/player\\b/i.test(location.pathname)) {
    return { ready: false, reason: "not-player", key: location.href };
  }

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
  const textOf = (element) => String(element?.innerText || element?.textContent || element?.title || element?.getAttribute?.("aria-label") || "").replace(/\\s+/g, " ").trim();
  const play = document.querySelector(".btn_big_play,.btn_big_pause");
  if (!play || !visible(play)) return { ready: false, reason: "no-global-play", key: location.href };
  const playClass = String(play.className || "");
  const playing = playClass.includes("btn_big_play--pause") || playClass.includes("btn_big_pause");
  const currentRow = Array.from(document.querySelectorAll(".songlist__item--playing,.songlist__item.current,.mod_songlist li.current,[class*='playing']"))
    .find(visible);
  const recentPlaybackResource = performance.getEntriesByType("resource")
    .slice(-80)
    .some((entry) => {
      const name = String(entry?.name || "");
      const recent = performance.now() - Number(entry?.startTime || 0) < 45000;
      return recent && /Fplay_time|cgi_music_webreport|musics\\.fcg|isure|vkey|audio|stream|music\\.tc\\.qq|u\\.y\\.qq/i.test(name);
    });
  const titles = Array.from(document.querySelectorAll(".songlist__songname_txt a,.songlist__songname a"))
    .filter(visible)
    .slice(0, 6)
    .map((item) => textOf(item))
    .filter(Boolean);
  const listPlayButtons = Array.from(document.querySelectorAll(".mod_songlist .list_menu__play,.songlist__list .list_menu__play,.list_menu__play"))
    .filter(visible);
  const queueReady = titles.length > 0 || listPlayButtons.length > 0;
  const media = Array.from(document.querySelectorAll("audio,video")).map((node) => ({
    paused: Boolean(node.paused),
    ended: Boolean(node.ended),
    currentTime: Number(node.currentTime || 0),
    readyState: Number(node.readyState || 0)
  }));
  const mediaPlaying = media.some((item) => !item.ended && !item.paused);
  const progressed = media.some((item) => !item.ended && Number(item.currentTime || 0) > 1.5);
  const realPlayback = mediaPlaying || progressed || (playing && (Boolean(currentRow) || recentPlaybackResource));
  const key = [
    location.origin,
    location.pathname,
    titles.join("|").slice(0, 240)
  ].join("|");

  if (realPlayback) {
    return {
      ready: true,
      reason: mediaPlaying ? "already-playing" : progressed ? "progressed" : "qq-playback-evidence",
      playing: true,
      key,
      mediaCount: media.length,
      currentRow: textOf(currentRow).slice(0, 120),
      recentPlaybackResource
    };
  }
  if (!queueReady) return { ready: false, reason: "queue-not-ready", key, mediaCount: media.length };
  const target = listPlayButtons[0] || play;
  const rect = target.getBoundingClientRect();
  const scaleX = window.outerWidth && window.innerWidth ? window.outerWidth / window.innerWidth : window.devicePixelRatio || 1;
  const scaleY = window.outerHeight && window.innerHeight ? window.outerHeight / window.innerHeight : window.devicePixelRatio || scaleX || 1;
  return {
    ready: true,
    reason: playing ? "stalled-global-play" : "ready",
    playing: false,
    key,
    label: textOf(target) || "play",
    buttonX: rect.x + rect.width / 2,
    buttonY: rect.y + rect.height / 2,
    scaleX,
    scaleY,
    mediaCount: media.length,
    queueSize: Math.max(titles.length, listPlayButtons.length)
  };
})()`;

const qqMvTouchTargetExpression = `(() => {
  const styleId = "tikpal-qq-mv-touch-target-style";
  const legacyLayerId = "tikpal-qq-mv-touch-target-layer";
  const hitWidth = 72;
  const hitHeight = 44;
  const hookSelector = "[data-tikpal-qq-mv-touch-target='1']";
  const cleanup = (reason) => {
    document.getElementById(legacyLayerId)?.remove();
    document.querySelectorAll(hookSelector).forEach((node) => {
      node.removeAttribute("data-tikpal-qq-mv-touch-target");
    });
    if (reason === "not-qq") document.getElementById(styleId)?.remove();
    return { active: false, reason, hitWidth, hitHeight };
  };
  document.getElementById(legacyLayerId)?.remove();
  if (!/(^|\\.)y\\.qq\\.com$/i.test(location.hostname)) return cleanup("not-qq");
  if (document.documentElement.dataset.tikpalQqMvCinema === "1") return cleanup("cinema");
  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement("style");
    style.id = styleId;
    document.head?.appendChild(style);
  }
  style.textContent = \`
a[data-tikpal-qq-mv-touch-target="1"] {
  position: relative !important;
  overflow: visible !important;
  z-index: 2147482600 !important;
  touch-action: manipulation !important;
  -webkit-tap-highlight-color: rgba(88, 220, 255, 0.16) !important;
}
a[data-tikpal-qq-mv-touch-target="1"]:active {
  filter: drop-shadow(0 0 10px rgba(88, 220, 255, 0.34)) !important;
}
\`;
  const isMvHref = (href) => /(?:\\/|%2F)(?:mv|mvdetail|mvplay)(?:\\/|\\b)|[?&#](?:mvid|mv_id|vid)=/i.test(href || "");
  const isVisibleMvLink = (link, seenLinks) => {
      if (!(link instanceof HTMLAnchorElement)) return false;
      const href = link.href || "";
      if (!isMvHref(href)) return false;
      if (seenLinks.has(link)) return false;
      seenLinks.add(link);
      const rect = link.getBoundingClientRect();
      const style = getComputedStyle(link);
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
  const collectLinks = () => {
    const seenLinks = new Set();
    return Array.from(document.querySelectorAll("a.songlist__icon_mv[href],a[href*='/mv/'],a[href*='/mvdetail/'],a[href*='/mvplay/']"))
      .filter((link) => isVisibleMvLink(link, seenLinks))
      .slice(0, 80);
  };
  const linkAtPoint = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const hits = collectLinks()
      .map((link) => {
        const rect = link.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const inHit = Math.abs(x - centerX) <= hitWidth / 2 && Math.abs(y - centerY) <= hitHeight / 2;
        return inHit ? { link, distance: Math.hypot(x - centerX, y - centerY) } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance);
    return hits[0]?.link || null;
  };
  window.__tikpalQqMvTouchTargetLinkAtPoint = linkAtPoint;
  if (!window.__tikpalQqMvTouchTargetInstalled) {
    document.addEventListener("click", (event) => {
      try {
        if (!/(^|\\.)y\\.qq\\.com$/i.test(location.hostname)) return;
        if (document.documentElement.dataset.tikpalQqMvCinema === "1") return;
        if (event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest?.(hookSelector)) return;
        const link = window.__tikpalQqMvTouchTargetLinkAtPoint?.(Number(event.clientX || 0), Number(event.clientY || 0));
        if (!link) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        link.target = "_self";
        window.location.assign(link.href);
      } catch {}
    }, true);
    window.__tikpalQqMvTouchTargetInstalled = true;
  }
  const links = collectLinks();
  const linkSet = new Set(links);
  document.querySelectorAll(hookSelector).forEach((node) => {
    if (!linkSet.has(node)) node.removeAttribute("data-tikpal-qq-mv-touch-target");
  });
  for (const link of links) {
    link.dataset.tikpalQqMvTouchTarget = "1";
    link.target = "_self";
    link.setAttribute("aria-label", link.getAttribute("aria-label") || link.title || "MV");
    link.title = link.title || "MV";
  }
  const first = links[0]?.getBoundingClientRect();
  return {
    active: links.length > 0,
    count: links.length,
    hitWidth,
    hitHeight,
    firstHit: first ? {
      x: Math.round(first.left + first.width / 2 - hitWidth / 2),
      y: Math.round(first.top + first.height / 2 - hitHeight / 2),
      width: hitWidth,
      height: hitHeight
    } : null
  };
})()`;

const qqMvCinemaExpression = `(() => {
  const styleId = "tikpal-qq-mv-cinema-style";
  const controlsId = "tikpal-qq-mv-cinema-controls";
  const playlistButtonId = "tikpal-qq-mv-cinema-playlist-button";
  const replayButtonId = "tikpal-qq-mv-cinema-replay-button";
  const frameId = "tikpal-qq-mv-cinema-frame";
  const cleanup = (reason = "inactive", extra = {}) => {
    document.getElementById(styleId)?.remove();
    document.getElementById(controlsId)?.remove();
    document.getElementById(playlistButtonId)?.remove();
    document.getElementById(replayButtonId)?.remove();
    document.getElementById(frameId)?.remove();
    document.documentElement?.removeAttribute("data-tikpal-qq-mv-cinema");
    document.documentElement?.removeAttribute("data-tikpal-qq-mv-letterbox");
    document.documentElement?.style?.removeProperty("--tikpal-qq-mv-letterbox-left");
    document.documentElement?.style?.removeProperty("--tikpal-qq-mv-letterbox-right");
    document.documentElement?.style?.removeProperty("--tikpal-qq-mv-letterbox-top");
    document.documentElement?.style?.removeProperty("--tikpal-qq-mv-letterbox-bottom");
    document.querySelectorAll("[data-tikpal-qq-mv-cinema-video]").forEach((node) => {
      node.removeAttribute("data-tikpal-qq-mv-cinema-video");
    });
    return { active: false, reason, ...extra };
  };
  if (!/(^|\\.)y\\.qq\\.com$/i.test(location.hostname)) return cleanup("not-qq");

  const href = String(location.href || "");
  const pageText = String(document.body?.innerText || "").replace(/\\s+/g, " ").trim();
  const mvUrl = /(?:\\/|%2F)(?:mv|mvdetail|mvplay)(?:\\/|\\b)|[?&#](?:mvid|mv_id|vid)=|\\bmv\\b/i.test(href);
  if (/播放失败|播放出错|加载失败|刷新页面重试|错误码\\s*undefined|error code\\s*undefined/i.test(pageText)) {
    return cleanup("playback-error", { playbackError: true, url: href });
  }

  const visible = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width >= 180 &&
      rect.height >= 100 &&
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < innerWidth &&
      rect.top < innerHeight &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || "1") > 0.02;
  };
  const videos = Array.from(document.querySelectorAll("video"))
    .filter(visible)
    .map((video) => {
      const rect = video.getBoundingClientRect();
      return { video, rect, area: rect.width * rect.height };
    })
    .sort((a, b) => b.area - a.area);
  const entry = videos[0];
  if (!entry) return cleanup("no-video");
  const largeVideo = entry.rect.width >= Math.min(960, innerWidth * 0.48) &&
    entry.rect.height >= Math.min(360, innerHeight * 0.5);
  if (!mvUrl && !largeVideo) return cleanup("not-mv");

  document.querySelectorAll("[data-tikpal-qq-mv-cinema-video]").forEach((node) => {
    if (node !== entry.video) node.removeAttribute("data-tikpal-qq-mv-cinema-video");
  });
  document.documentElement.dataset.tikpalQqMvCinema = "1";
  entry.video.dataset.tikpalQqMvCinemaVideo = "1";
  const duration = Number(entry.video.duration || 0);
  const currentTime = Number(entry.video.currentTime || 0);
  const videoWidth = Number(entry.video.videoWidth || 0);
  const videoHeight = Number(entry.video.videoHeight || 0);
  const viewportWidth = Math.max(1, Number(innerWidth || 0));
  const viewportHeight = Math.max(1, Number(innerHeight || 0));
  const letterbox = { left: 0, right: 0, top: 0, bottom: 0, orientation: "none" };
  if (videoWidth > 0 && videoHeight > 0) {
    const videoRatio = videoWidth / videoHeight;
    const viewportRatio = viewportWidth / viewportHeight;
    if (videoRatio > viewportRatio) {
      const renderedHeight = viewportWidth / videoRatio;
      letterbox.top = Math.max(0, Math.round((viewportHeight - renderedHeight) / 2));
      letterbox.bottom = letterbox.top;
      letterbox.orientation = letterbox.top > 0 ? "horizontal" : "none";
    } else if (videoRatio < viewportRatio) {
      const renderedWidth = viewportHeight * videoRatio;
      letterbox.left = Math.max(0, Math.round((viewportWidth - renderedWidth) / 2));
      letterbox.right = letterbox.left;
      letterbox.orientation = letterbox.left > 0 ? "vertical" : "none";
    }
  }
  document.documentElement.dataset.tikpalQqMvLetterbox = letterbox.orientation;
  document.documentElement.style.setProperty("--tikpal-qq-mv-letterbox-left", letterbox.left + "px");
  document.documentElement.style.setProperty("--tikpal-qq-mv-letterbox-right", letterbox.right + "px");
  document.documentElement.style.setProperty("--tikpal-qq-mv-letterbox-top", letterbox.top + "px");
  document.documentElement.style.setProperty("--tikpal-qq-mv-letterbox-bottom", letterbox.bottom + "px");

  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement("style");
    style.id = styleId;
    document.head?.appendChild(style);
  }
  style.textContent = \`
html[data-tikpal-qq-mv-cinema="1"],
html[data-tikpal-qq-mv-cinema="1"] body {
  background: #000 !important;
  overflow: hidden !important;
}
html[data-tikpal-qq-mv-cinema="1"] body * {
  visibility: hidden !important;
}
html[data-tikpal-qq-mv-cinema="1"] #\${frameId},
html[data-tikpal-qq-mv-cinema="1"] #\${frameId} *,
html[data-tikpal-qq-mv-cinema="1"] #\${controlsId},
html[data-tikpal-qq-mv-cinema="1"] #\${controlsId} * {
  visibility: visible !important;
}
html[data-tikpal-qq-mv-cinema="1"] video[data-tikpal-qq-mv-cinema-video="1"] {
  position: fixed !important;
  inset: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  min-width: 100vw !important;
  min-height: 100vh !important;
  max-width: none !important;
  max-height: none !important;
  object-fit: contain !important;
  background: #000 !important;
  opacity: 1 !important;
  visibility: visible !important;
  z-index: 2147483600 !important;
  transform: none !important;
  pointer-events: auto !important;
}
html[data-tikpal-qq-mv-cinema="1"] #\${frameId} {
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483610 !important;
  pointer-events: none !important;
  overflow: hidden !important;
  opacity: 1 !important;
}
html[data-tikpal-qq-mv-cinema="1"] #\${frameId} [data-tikpal-qq-mv-letterbox] {
  position: fixed !important;
  pointer-events: none !important;
  opacity: 1 !important;
  background:
    radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.045), rgba(10, 11, 15, 0.72) 54%, rgba(0, 0, 0, 0.98)),
    linear-gradient(135deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.008) 36%, rgba(0, 0, 0, 0.34)) !important;
  box-shadow:
    inset 0 0 86px rgba(255, 255, 255, 0.035),
    inset 0 0 160px rgba(0, 0, 0, 0.96) !important;
}
html[data-tikpal-qq-mv-cinema="1"] #\${frameId} [data-tikpal-qq-mv-letterbox="left"] {
  left: 0 !important;
  top: 0 !important;
  width: var(--tikpal-qq-mv-letterbox-left) !important;
  height: 100vh !important;
}
html[data-tikpal-qq-mv-cinema="1"] #\${frameId} [data-tikpal-qq-mv-letterbox="right"] {
  right: 0 !important;
  top: 0 !important;
  width: var(--tikpal-qq-mv-letterbox-right) !important;
  height: 100vh !important;
}
html[data-tikpal-qq-mv-cinema="1"] #\${frameId} [data-tikpal-qq-mv-letterbox="top"] {
  left: 0 !important;
  top: 0 !important;
  width: 100vw !important;
  height: var(--tikpal-qq-mv-letterbox-top) !important;
}
html[data-tikpal-qq-mv-cinema="1"] #\${frameId} [data-tikpal-qq-mv-letterbox="bottom"] {
  left: 0 !important;
  bottom: 0 !important;
  width: 100vw !important;
  height: var(--tikpal-qq-mv-letterbox-bottom) !important;
}
html[data-tikpal-qq-mv-cinema="1"] #\${controlsId} {
  position: fixed !important;
  right: 28px !important;
  bottom: 26px !important;
  z-index: 2147483640 !important;
  display: flex !important;
  gap: 12px !important;
  align-items: center !important;
}
html[data-tikpal-qq-mv-cinema="1"] #\${controlsId} button {
  all: unset !important;
  box-sizing: border-box !important;
  width: 56px !important;
  height: 56px !important;
  border: 1px solid rgba(255, 255, 255, 0.72) !important;
  border-radius: 999px !important;
  background: rgba(10, 18, 30, 0.72) !important;
  color: #fff !important;
  display: grid !important;
  place-items: center !important;
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.44), inset 0 0 18px rgba(96, 222, 255, 0.14) !important;
  backdrop-filter: blur(14px) !important;
  opacity: 1 !important;
  cursor: pointer !important;
}
html[data-tikpal-qq-mv-cinema="1"] #\${controlsId} button[hidden] {
  display: none !important;
}
html[data-tikpal-qq-mv-cinema="1"] #\${controlsId} button svg {
  width: 26px !important;
  height: 26px !important;
  stroke: currentColor !important;
  fill: none !important;
  stroke-width: 2.2 !important;
  stroke-linecap: round !important;
  stroke-linejoin: round !important;
}
\`;

  const playlistIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h11"/><path d="M8 12h11"/><path d="M8 18h7"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/></svg>';
  const replayIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9a7 7 0 1 1 1.7 7.3"/><path d="M5 4v5h5"/><path d="M10 9l4 3-4 3z"/></svg>';
  let frame = document.getElementById(frameId);
  if (!frame) {
    frame = document.createElement("div");
    frame.id = frameId;
    frame.dataset.tikpalQqMvCinemaFrame = "1";
    frame.innerHTML = '<span data-tikpal-qq-mv-letterbox="left"></span><span data-tikpal-qq-mv-letterbox="right"></span><span data-tikpal-qq-mv-letterbox="top"></span><span data-tikpal-qq-mv-letterbox="bottom"></span>';
    document.body?.appendChild(frame);
  }
  let controls = document.getElementById(controlsId);
  if (!controls) {
    controls = document.createElement("div");
    controls.id = controlsId;
    document.body?.appendChild(controls);
  }
  let playlistButton = document.getElementById(playlistButtonId);
  if (!playlistButton || playlistButton.dataset.tikpalQqMvIconButton !== "playlist") {
    playlistButton?.remove();
    playlistButton = document.createElement("button");
    playlistButton.id = playlistButtonId;
    playlistButton.type = "button";
    playlistButton.dataset.tikpalQqMvIconButton = "playlist";
    playlistButton.dataset.tikpalQqMvPlaylistButton = "1";
    controls.appendChild(playlistButton);
  }
  playlistButton.setAttribute("aria-label", "播放列表");
  playlistButton.setAttribute("title", "播放列表");
  playlistButton.innerHTML = playlistIcon;
  playlistButton.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (history.length > 1) {
      history.back();
    } else {
      location.assign("https://y.qq.com/n/ryqq/player");
    }
  };

  let replayButton = document.getElementById(replayButtonId);
  if (!replayButton || replayButton.dataset.tikpalQqMvIconButton !== "replay") {
    replayButton?.remove();
    replayButton = document.createElement("button");
    replayButton.id = replayButtonId;
    replayButton.type = "button";
    replayButton.dataset.tikpalQqMvIconButton = "replay";
    replayButton.dataset.tikpalQqMvReplayButton = "1";
    controls.insertBefore(replayButton, playlistButton);
  }
  replayButton.setAttribute("aria-label", "重播");
  replayButton.setAttribute("title", "重播");
  replayButton.innerHTML = replayIcon;
  const isReplayReady = () => {
    const latestDuration = Number(entry.video.duration || 0);
    const latestCurrentTime = Number(entry.video.currentTime || 0);
    return Boolean(entry.video.ended ||
      (Number.isFinite(latestDuration) && latestDuration > 0 &&
        Number.isFinite(latestCurrentTime) && latestDuration - latestCurrentTime <= 0.75));
  };
  const syncReplayState = () => {
    replayButton.hidden = !isReplayReady();
    return !replayButton.hidden;
  };
  const replayStateEvents = ["play", "playing", "timeupdate", "seeking", "seeked", "ended", "pause", "loadedmetadata"];
  if (entry.video.__tikpalQqMvReplaySync !== syncReplayState) {
    if (entry.video.__tikpalQqMvReplaySync) {
      replayStateEvents.forEach((eventName) => {
        entry.video.removeEventListener(eventName, entry.video.__tikpalQqMvReplaySync);
      });
    }
    replayStateEvents.forEach((eventName) => {
      entry.video.addEventListener(eventName, syncReplayState, { passive: true });
    });
    entry.video.__tikpalQqMvReplaySync = syncReplayState;
  }
  const replayVisible = syncReplayState();
  replayButton.onclick = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    replayButton.hidden = true;
    try {
      entry.video.currentTime = 0;
      await entry.video.play();
    } catch {
      syncReplayState();
      return;
    }
    syncReplayState();
  };

  const rect = entry.video.getBoundingClientRect();
  const scaleX = window.outerWidth && window.innerWidth ? window.outerWidth / window.innerWidth : window.devicePixelRatio || 1;
  const scaleY = window.outerHeight && window.innerHeight ? window.outerHeight / window.innerHeight : window.devicePixelRatio || scaleX || 1;
  const key = [
    new URL(location.href).pathname,
    new URL(location.href).search,
    entry.video.currentSrc || entry.video.src || entry.video.poster || "",
    Number.isFinite(duration) && duration > 0 ? Math.round(duration) : ""
  ].join("|");
  return {
    active: true,
    url: href,
    key,
    playbackError: false,
    paused: Boolean(entry.video.paused),
    ended: Boolean(entry.video.ended),
    nearEnded: replayVisible,
    readyState: Number(entry.video.readyState || 0),
    currentTime,
    duration,
    muted: Boolean(entry.video.muted),
    videoCenterX: rect.x + rect.width / 2,
    videoCenterY: rect.y + rect.height / 2,
    scaleX,
    scaleY,
    videoRect: {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      left: Math.round(rect.left),
      top: Math.round(rect.top)
    },
    viewport: { width: innerWidth, height: innerHeight },
    button: Boolean(playlistButton),
    replayButton: Boolean(replayVisible),
    frame: Boolean(frame),
    letterbox
  };
})()`;

const qqMvAutoPlayExpression = `(async () => {
  if (document.documentElement.dataset.tikpalQqMvCinema !== "1") return { played: false, reason: "not-cinema" };
  const entry = Array.from(document.querySelectorAll("video[data-tikpal-qq-mv-cinema-video='1'],video"))
    .map((video) => {
      const rect = video.getBoundingClientRect();
      return { video, rect, area: rect.width * rect.height };
    })
    .filter((item) => item.rect.width >= 180 && item.rect.height >= 100)
    .sort((a, b) => b.area - a.area)[0];
  if (!entry) return { played: false, reason: "no-video" };
  const currentTime = Number(entry.video.currentTime || 0);
  const readyState = Number(entry.video.readyState || 0);
  if (!entry.video.paused) return { played: false, reason: "already-playing", currentTime, readyState };
  if (entry.video.ended) return { played: false, reason: "ended", currentTime, readyState };
  if (readyState < 2) return { played: false, reason: "not-ready", currentTime, readyState };
  if (!Number.isFinite(currentTime) || currentTime > ${qqMvAutoPlayMaxStartSeconds}) {
    return { played: false, reason: "progressed", currentTime, readyState };
  }
  try {
    await entry.video.play();
    return {
      played: !entry.video.paused,
      reason: entry.video.paused ? "still-paused" : "started",
      currentTime: Number(entry.video.currentTime || 0),
      readyState: Number(entry.video.readyState || 0)
    };
  } catch (error) {
    return {
      played: false,
      reason: "play-rejected",
      name: error?.name || "",
      message: error?.message || String(error),
      currentTime,
      readyState
    };
  }
})()`;

const neteaseAutoPlayStateExpression = `(() => {
  if (!/(^|\\.)music\\.163\\.com$/i.test(location.hostname)) {
    return { ready: false, reason: "not-netease" };
  }

  const visible = (element) => {
    if (!element) return false;
    const view = element.ownerDocument?.defaultView || window;
    const rect = element.getBoundingClientRect();
    const style = view.getComputedStyle(element);
    return rect.width >= 8 &&
      rect.height >= 8 &&
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < view.innerWidth &&
      rect.top < view.innerHeight &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || "1") > 0.05;
  };
  const textOf = (element) => String(element?.innerText || element?.textContent || "").replace(/\\s+/g, " ").trim();
  const attr = (element, name) => String(element?.getAttribute?.(name) || "").replace(/\\s+/g, " ").trim();
  const actionTextOf = (element) => [
    attr(element, "aria-label"),
    attr(element, "title"),
    String(element?.value || "").trim(),
    textOf(element),
    attr(element, "class"),
    attr(element, "id")
  ].filter(Boolean).join(" ");
  const docs = [document];
  for (const frame of Array.from(document.querySelectorAll("iframe"))) {
    try {
      if (frame.contentDocument) docs.push(frame.contentDocument);
    } catch {}
  }

  const media = [];
  for (const doc of docs) {
    for (const node of Array.from(doc.querySelectorAll("audio,video"))) {
      const currentTime = Number(node.currentTime || 0);
      media.push({
        paused: Boolean(node.paused),
        ended: Boolean(node.ended),
        currentTime: Number.isFinite(currentTime) ? currentTime : 0,
        duration: Number(node.duration || 0),
        readyState: Number(node.readyState || 0),
        src: node.currentSrc || node.src || ""
      });
    }
  }
  const howls = Array.isArray(window.Howler?._howls) ? window.Howler._howls : [];
  for (const howl of howls) {
    const sounds = Array.isArray(howl?._sounds) ? howl._sounds : [];
    for (const sound of sounds) {
      const node = sound?._node;
      const currentTime = Number(node?.currentTime || sound?._seek || 0);
      media.push({
        paused: Boolean(sound?._paused || node?.paused),
        ended: Boolean(sound?._ended || node?.ended),
        currentTime: Number.isFinite(currentTime) ? currentTime : 0,
        duration: Number(node?.duration || sound?._duration || 0),
        readyState: Number(node?.readyState || 0),
        src: node?.currentSrc || node?.src || ""
      });
    }
  }

  const activeMedia = media.filter((item) => !item.ended);
  const playing = activeMedia.some((item) => !item.paused);
  const currentTime = activeMedia.reduce((max, item) => Math.max(max, Number(item.currentTime || 0)), 0);
  const readyState = activeMedia.reduce((max, item) => Math.max(max, Number(item.readyState || 0)), 0);
  const progressed = currentTime > ${neteaseAutoPlayMaxStartSeconds};
  if (playing || progressed) {
    return {
      ready: true,
      reason: playing ? "already-playing" : "progressed",
      playing,
      progressed,
      currentTime,
      readyState,
      key: location.href
    };
  }

  const includeAction = /(播放|^play$|\\bplay\\b|cmd-icon-play|icon-play|\\bbtnp\\b|\\bply\\b|u-icn-play)/i;
  const excludeAction = /(暂停|暫停|pause|上一|下一|previous|prev|next|voice|volume|sound|mute|unmute|静音|音量|下载|download|登录|login|会员|vip|收藏|like|heart|favorite)/i;
  const clickableSelectors = [
    "button",
    "a",
    "[role='button']",
    "[title]",
    "[aria-label]",
    ".cmd-button",
    ".cmd-icon-play",
    ".icon-play",
    ".btnp",
    ".ply",
    ".u-icn-play"
  ].join(",");
  const clickableElement = (element) => {
    if (!element) return null;
    if (element.matches?.("button,a,[role='button']")) return element;
    return element.closest?.("button,a,[role='button']") || element;
  };
  const candidates = [];
  let order = 0;
  for (const doc of docs) {
    const seen = new Set();
    for (const raw of Array.from(doc.querySelectorAll(clickableSelectors))) {
      const element = clickableElement(raw);
      if (!element || seen.has(element) || !visible(element)) continue;
      seen.add(element);
      const label = actionTextOf(element);
      if (!includeAction.test(label) || excludeAction.test(label)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width > 120 || rect.height > 120) continue;
      const score =
        (/(^|\\s)cmd-button(\\s|$)|播放/i.test(label) ? 0 : 8) +
        (rect.width >= 24 && rect.width <= 72 && rect.height >= 24 && rect.height <= 72 ? 0 : 4) +
        (rect.top < 64 ? 4 : 0);
      candidates.push({
        element,
        label: label.slice(0, 120),
        score,
        order,
        rect
      });
      order += 1;
    }
  }
  candidates.sort((left, right) => left.score - right.score || left.order - right.order);
  const candidate = candidates[0];
  if (!candidate) {
    return {
      ready: false,
      reason: "no-play-button",
      playing: false,
      progressed,
      currentTime,
      readyState,
      key: location.href
    };
  }

  const scaleX = window.outerWidth && window.innerWidth ? window.outerWidth / window.innerWidth : window.devicePixelRatio || 1;
  const scaleY = window.outerHeight && window.innerHeight ? window.outerHeight / window.innerHeight : window.devicePixelRatio || scaleX || 1;
  return {
    ready: true,
    reason: "ready",
    playing: false,
    progressed,
    currentTime,
    readyState,
    key: [
      location.href,
      String(document.body?.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 180)
    ].join("|"),
    buttonLabel: candidate.label,
    buttonX: candidate.rect.x + candidate.rect.width / 2,
    buttonY: candidate.rect.y + candidate.rect.height / 2,
    scaleX,
    scaleY
  };
})()`;

function qqWindowId() {
  const result = spawnSync("xdotool", ["search", "--onlyvisible", "--name", "QQ音乐"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  if (result.status !== 0) return "";
  return String(result.stdout || "").trim().split(/\s+/).filter(Boolean).at(-1) || "";
}

function interactQqWindowPoint(state, xKey, yKey, { click = true } = {}) {
  const windowId = qqWindowId();
  if (!windowId) return false;
  const x = Math.max(0, Math.round(Number(state[xKey] || 0) * Number(state.scaleX || 1)));
  const y = Math.max(0, Math.round(Number(state[yKey] || 0) * Number(state.scaleY || 1)));
  if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) return false;

  spawnSync("xdotool", ["windowfocus", windowId], { stdio: "ignore" });
  const args = [
    "mousemove",
    "--window",
    windowId,
    String(x),
    String(y)
  ];
  if (click) {
    args.push("click", "--window", windowId, "1");
  }
  const result = spawnSync("xdotool", args, { stdio: "ignore" });
  return result.status === 0;
}

function clickQqWindowPoint(state, xKey, yKey) {
  return interactQqWindowPoint(state, xKey, yKey, { click: true });
}

function clickQqAudioIcon(state) {
  return clickQqWindowPoint(state, "iconX", "iconY");
}

function clickQqMusicPlayButton(state) {
  return clickQqWindowPoint(state, "buttonX", "buttonY");
}

function claimQqMusicAutoPlayAttempt(target, result) {
  if (!qqMusicAutoPlay || !result?.ready || !result.key) return false;
  const now = Date.now();
  const key = `${target.id}:${result.key}`;
  let state = qqMusicAutoPlayStates.get(key);
  if (!state) {
    state = {
      firstSeenAt: now,
      lastAttemptAt: 0,
      attempts: 0,
      completed: false
    };
    qqMusicAutoPlayStates.set(key, state);
    if (qqMusicAutoPlayStates.size > 100) {
      qqMusicAutoPlayStates.delete(qqMusicAutoPlayStates.keys().next().value);
    }
  }
  if (result.playing) {
    state.completed = true;
    return false;
  }
  if (state.completed || state.attempts >= qqMusicAutoPlayMaxAttempts) return false;
  if (now - state.firstSeenAt < qqMusicAutoPlayDelayMs) return false;
  if (state.lastAttemptAt && now - state.lastAttemptAt < qqMusicAutoPlayRetryMs) return false;
  state.lastAttemptAt = now;
  state.attempts += 1;
  return true;
}

function x11Env() {
  const env = { ...process.env };
  if (!env.DISPLAY) env.DISPLAY = env.TIKPAL_KIOSK_DISPLAY || ":0";
  if (!env.XAUTHORITY && env.HOME) env.XAUTHORITY = `${env.HOME}/.Xauthority`;
  return env;
}

function visibleWindowIdByNames(names) {
  for (const name of names) {
    const result = spawnSync("xdotool", ["search", "--onlyvisible", "--name", name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: x11Env()
    });
    if (result.status !== 0) continue;
    const windowId = String(result.stdout || "").trim().split(/\s+/).filter(Boolean).at(-1) || "";
    if (windowId) return windowId;
  }
  return "";
}

function neteaseWindowId() {
  return visibleWindowIdByNames(["网易云音乐", "NetEase Cloud Music", "music.163.com"]);
}

function clickNeteasePlayButton(state) {
  const windowId = neteaseWindowId();
  if (!windowId) return false;
  const x = Math.max(0, Math.round(Number(state.buttonX || 0) * Number(state.scaleX || 1)));
  const y = Math.max(0, Math.round(Number(state.buttonY || 0) * Number(state.scaleY || 1)));
  if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) return false;

  spawnSync("xdotool", ["windowfocus", windowId], { stdio: "ignore", env: x11Env() });
  const result = spawnSync("xdotool", [
    "mousemove",
    "--window",
    windowId,
    String(x),
    String(y),
    "click",
    "--window",
    windowId,
    "1"
  ], { stdio: "ignore", env: x11Env() });
  return result.status === 0;
}

function claimQqMvAutoPlayAttempt(target, result) {
  if (!qqMvAutoPlay || !result?.active || result.playbackError || result.ended || !result.key) return false;
  const currentTime = Number(result.currentTime);
  const readyState = Number(result.readyState);
  const paused = Boolean(result.paused);
  if (!Number.isFinite(currentTime) || !Number.isFinite(readyState)) return false;

  const now = Date.now();
  const key = `${target.id}:${result.key}`;
  let state = qqMvAutoPlayStates.get(key);
  if (!state) {
    state = {
      firstSeenAt: now,
      lastProgressAt: now,
      lastTime: currentTime,
      clicked: false,
      progressed: false
    };
    qqMvAutoPlayStates.set(key, state);
    if (qqMvAutoPlayStates.size > 100) {
      qqMvAutoPlayStates.delete(qqMvAutoPlayStates.keys().next().value);
    }
  }

  if (currentTime > Number(state.lastTime || 0) + qqMvAutoPlayProgressEpsilonSeconds) {
    state.lastProgressAt = now;
    state.progressed = true;
  }
  state.lastTime = currentTime;

  if (!paused || currentTime > qqMvAutoPlayMaxStartSeconds) {
    state.progressed = true;
  }
  if (state.progressed || state.clicked || !paused || readyState < 2 || currentTime > qqMvAutoPlayMaxStartSeconds) {
    return false;
  }
  if (now - state.firstSeenAt < qqMvAutoPlayDelayMs || now - state.lastProgressAt < qqMvAutoPlayDelayMs) {
    return false;
  }

  state.clicked = true;
  state.clickedAt = now;
  return true;
}

function claimNeteaseAutoPlayAttempt(target, result) {
  if (providerId !== "netease_music" || !neteaseAutoPlay || !result?.ready || !result.buttonLabel || !result.key) return false;
  const currentTime = Number(result.currentTime || 0);
  if (!Number.isFinite(currentTime)) return false;

  const now = Date.now();
  const key = `${target.id}:${result.key}`;
  let state = neteaseAutoPlayStates.get(key);
  if (!state) {
    state = {
      firstSeenAt: now,
      lastProgressAt: now,
      lastTime: currentTime,
      clicked: false,
      progressed: false
    };
    neteaseAutoPlayStates.set(key, state);
    if (neteaseAutoPlayStates.size > 100) {
      neteaseAutoPlayStates.delete(neteaseAutoPlayStates.keys().next().value);
    }
  }

  if (currentTime > Number(state.lastTime || 0) + neteaseAutoPlayProgressEpsilonSeconds) {
    state.lastProgressAt = now;
    state.progressed = true;
  }
  state.lastTime = currentTime;

  if (result.playing || result.progressed || currentTime > neteaseAutoPlayMaxStartSeconds) {
    state.progressed = true;
  }
  if (state.progressed || state.clicked || result.playing || currentTime > neteaseAutoPlayMaxStartSeconds) {
    return false;
  }
  if (now - state.firstSeenAt < neteaseAutoPlayDelayMs || now - state.lastProgressAt < neteaseAutoPlayDelayMs) {
    return false;
  }

  state.clicked = true;
  state.clickedAt = now;
  return true;
}

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

const safeDismissPromptExpression = `(() => {
  const providerId = ${JSON.stringify(providerId)};
  const cookieContextText = /(cookie|cookies|cookie policy|privacy|gdpr|tracking|personal data|personal information|クッキー|プライバシー|쿠키|개인정보|隐私|隱私|个人信息|個人資料)/i;
  const trialContextText = /(free trial|trial|try free|premium|subscribe|subscription|upgrade|membership|vip|免费试用|免費試用|试用|試用|会员|會員|订阅|訂閱|开通|開通|ทดลองใช้ฟรี|無料体験|プレミアム|구독|프리미엄)/i;
  const localAccessContextText = /(other apps and services on this device|other applications and services on this device|apps and services on this device|local network|nearby devices|nearby services|访问此设备上的其他应用和服务|訪問此裝置上的其他應用程式和服務|访问本设备上的其他应用和服务|其他应用和服务|其他應用程式和服務)/i;
  const safeDismissActionText = /(close|dismiss|not now|no thanks|no, thanks|maybe later|skip|cancel|block|deny|don't allow|do not allow|×|关闭|關閉|取消|不用了|不了|稍后|稍後|阻止|拒绝|拒絕|不允许|不允許|나중에|닫기|거부|キャンセル|閉じる|あとで|許可しない|拒否)/i;
  const dangerousActionText = /(start|try|subscribe|get premium|go premium|continue|accept|agree|allow|login|log in|sign in|pay|purchase|buy|join|开始|開始|试用|試用|订阅|訂閱|购买|購買|支付|登录|登入|加入|开通|開通|允许|允許|同意|続行|許可|허용|동의)/i;
  const mediaControlText = /(play|pause|previous|next|mute|unmute|volume|sound|audio|播放|暂停|暫停|上一首|下一首|打开声音|打開聲音|关闭声音|關閉聲音|音量|音效)/i;
  const mediaControlSelectors = [
    "audio",
    "video",
    ".player__ft",
    ".player_voice",
    ".player_progress",
    ".btn_big_voice",
    ".btn_big_play",
    ".btn_big_prev",
    ".btn_big_next",
    ".btn_audio_sound",
    "[class*='volume' i]",
    "[class*='mute' i]",
    "[class*='voice' i]"
  ].join(",");
  const buttonSelectors = [
    "button",
    "a",
    "[role='button']",
    "input[type='button']",
    "input[type='submit']",
    "[aria-label]",
    "[title]",
    "[class*='close' i]",
    "[class*='dismiss' i]"
  ].join(",");
  const modalSelectors = [
    "[role='dialog']",
    "[aria-modal='true']",
    "[id*='cookie' i]",
    "[class*='cookie' i]",
    "[id*='trial' i]",
    "[class*='trial' i]",
    "[id*='premium' i]",
    "[class*='premium' i]",
    "[class*='modal' i]",
    "[class*='dialog' i]",
    "[class*='popup' i]",
    "[class*='banner' i]",
    "[class*='overlay' i]"
  ].join(",");
  const textOf = (element) => String(element?.value || element?.innerText || element?.textContent || "").replace(/\\s+/g, " ").trim();
  const attr = (element, name) => String(element?.getAttribute?.(name) || "").replace(/\\s+/g, " ").trim();
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
  const actionTextOf = (element) => [
    attr(element, "aria-label"),
    attr(element, "title"),
    String(element?.value || "").trim(),
    textOf(element),
    metadataOf(element)
  ].filter(Boolean).join(" ");
  const isMediaControl = (element, actionText) => Boolean(element.closest?.(mediaControlSelectors)) || mediaControlText.test(actionText);
  const visible = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const view = element.ownerDocument?.defaultView || window;
    const style = view.getComputedStyle(element);
    return rect.width >= 8 &&
      rect.height >= 8 &&
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < view.innerWidth &&
      rect.top < view.innerHeight &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || "1") > 0.05;
  };
  const clickableElement = (element) => {
    if (!element) return null;
    if (element.matches?.(buttonSelectors)) return element;
    return element.closest?.(buttonSelectors) || null;
  };
  const contextOf = (element) => {
    const modal = element.closest?.(modalSelectors);
    if (modal && visible(modal)) return textOf(modal) + " " + metadataOf(modal);
    let current = element.parentElement;
    while (current && current !== current.ownerDocument.body) {
      const text = textOf(current);
      if (text.length >= 12 && text.length <= 1200) return text + " " + metadataOf(current);
      current = current.parentElement;
    }
    return textOf(element.parentElement || element) + " " + metadataOf(element.parentElement || element);
  };
  const docs = [document];
  for (const frame of Array.from(document.querySelectorAll("iframe"))) {
    try {
      if (frame.contentDocument) docs.push(frame.contentDocument);
    } catch {}
  }
  for (const doc of docs) {
    const seen = new Set();
    for (const raw of Array.from(doc.querySelectorAll(buttonSelectors))) {
      const candidate = clickableElement(raw);
      if (!candidate || seen.has(candidate) || !visible(candidate)) continue;
      seen.add(candidate);
      const actionText = actionTextOf(candidate);
      if (isMediaControl(candidate, actionText)) continue;
      if (!safeDismissActionText.test(actionText)) continue;
      if (dangerousActionText.test(actionText) && !/no thanks|no, thanks|不用了|不了|关闭|關閉|close|dismiss|not now|maybe later|稍后|稍後|skip|cancel/i.test(actionText)) continue;
      const context = contextOf(candidate).slice(0, 2200);
      const isSpotifyCookieDismiss = providerId === "spotify" && cookieContextText.test(context);
      const isTrialDismiss = trialContextText.test(context);
      const isLocalAccessDismiss = localAccessContextText.test(context);
      if (!isSpotifyCookieDismiss && !isTrialDismiss && !isLocalAccessDismiss) continue;
      candidate.click();
      return {
        clicked: true,
        label: actionText.slice(0, 80),
        kind: isLocalAccessDismiss ? "local-access" : isTrialDismiss ? "trial" : "cookie"
      };
    }
  }
  return { clicked: false };
})()`;

async function runConsentFeatures(targets) {
  const providerTargets = targets.filter((target) => isProviderWebPage(target) && !isFriendlyErrorPage(target));
  for (const target of providerTargets) {
    if (providerId === "tidal") {
      const tidalResult = await evaluate(target.webSocketDebuggerUrl, tidalOneTrustConsentExpression).catch(() => null);
      if (tidalResult?.clicked) {
        console.log("[tikpal-web-mode-guard] clicked TIDAL OneTrust consent");
        return;
      }
    }
    const result = await evaluate(target.webSocketDebuggerUrl, consentConfirmExpression).catch(() => null);
    if (result?.clicked) {
      console.log(`[tikpal-web-mode-guard] clicked consent ${providerId} ${result.label}`);
      return;
    }
  }
}

async function runSafeDismissFeatures(targets) {
  const providerTargets = targets.filter((target) => isProviderWebPage(target) && !isFriendlyErrorPage(target));
  for (const target of providerTargets) {
    const result = await evaluate(target.webSocketDebuggerUrl, safeDismissPromptExpression).catch(() => null);
    if (result?.clicked) {
      console.log(`[tikpal-web-mode-guard] dismissed ${providerId} ${result.kind || "prompt"} ${result.label || ""}`.trim());
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
    const reminderPrompt = await evaluate(target.webSocketDebuggerUrl, qqReminderCancelExpression).catch(() => null);
    if (reminderPrompt?.handled) {
      console.log("[tikpal-web-mode-guard] dismissed QQ reminder cancel");
      return;
    }
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

async function runQqAudioFeatures(targets) {
  if (providerId !== "qq_music" || !qqAutoUnmute) return;
  for (const target of targets.filter(isQqMusicPlayerPage)) {
    const state = await evaluate(target.webSocketDebuggerUrl, qqAudioStateExpression).catch(() => null);
    if (!state?.ready || !state.playing || !state.muted) continue;
    const previousAttempt = qqAudioUnmuteAttempts.get(target.id) || 0;
    if (Date.now() - previousAttempt < qqAudioUnmuteCooldownMs) continue;
    qqAudioUnmuteAttempts.set(target.id, Date.now());
    if (clickQqAudioIcon(state)) {
      console.log("[tikpal-web-mode-guard] unmuted QQ player");
      return;
    }
  }
}

async function runQqMusicAutoPlayFeatures(targets) {
  if (providerId !== "qq_music" || !qqMusicAutoPlay) return;
  for (const target of targets.filter(isQqMusicPlayerPage)) {
    const state = await evaluate(target.webSocketDebuggerUrl, qqMusicAutoPlayStateExpression).catch(() => null);
    if (!claimQqMusicAutoPlayAttempt(target, state)) continue;
    if (clickQqMusicPlayButton(state)) {
      console.log(`[tikpal-web-mode-guard] clicked QQ music play ${state?.label || ""}`.trim());
      return;
    }
  }
}

async function runQqAudioPrimeFeatures(targets) {
  if (providerId !== "qq_music" || !qqAudioPrime) return;
  for (const target of targets.filter(isQqMusicPlayerPage)) {
    const state = await evaluate(target.webSocketDebuggerUrl, qqAudioStateExpression).catch(() => null);
    if (!state?.ready) continue;
    if (!state.playing || state.muted) {
      await evaluate(target.webSocketDebuggerUrl, qqAudioPrimeExpression).catch(() => null);
      continue;
    }
    const previousAttempt = qqAudioPrimeAttempts.get(target.id) || 0;
    if (Date.now() - previousAttempt < qqAudioPrimeCooldownMs) continue;
    qqAudioPrimeAttempts.set(target.id, Date.now());
    const result = await evaluate(target.webSocketDebuggerUrl, qqAudioPrimeExpression).catch((error) => ({
      primed: false,
      reason: error?.message || "failed"
    }));
    if (result?.primed) {
      console.log(`[tikpal-web-mode-guard] primed QQ audio ${result.state || ""}`.trim());
      return;
    }
  }
}

async function runQqMvTouchTargetFeatures(targets) {
  if (providerId !== "qq_music") return;
  for (const target of targets.filter(isQqMusicPage)) {
    await evaluate(target.webSocketDebuggerUrl, qqMvTouchTargetExpression).catch(() => null);
  }
}

async function runQqMvCinemaFeatures(targets) {
  if (providerId !== "qq_music" || !qqMvCinemaMode) return;
  for (const target of targets.filter(isQqMusicPage)) {
    const result = await evaluate(target.webSocketDebuggerUrl, qqMvCinemaExpression).catch(() => null);
    if (!result) continue;
    const previous = qqMvCinemaStates.get(target.id) || {};
    const nextKey = `${result.active ? "1" : "0"}:${result.reason || ""}:${result.url || ""}`;
    if (previous.key !== nextKey) {
      qqMvCinemaStates.set(target.id, { key: nextKey });
      if (result.active) {
        console.log("[tikpal-web-mode-guard] enabled QQ MV cinema mode");
      } else if (result.reason && result.reason !== "not-mv" && result.reason !== "not-qq") {
        console.log(`[tikpal-web-mode-guard] disabled QQ MV cinema mode ${result.reason}`.trim());
      }
    }
    if (claimQqMvAutoPlayAttempt(target, result)) {
      const playback = await evaluate(target.webSocketDebuggerUrl, qqMvAutoPlayExpression).catch((error) => ({
        played: false,
        reason: error?.message || "failed"
      }));
      console.log(`[tikpal-web-mode-guard] QQ MV auto play ${playback?.played ? "started" : "skipped"} ${playback?.reason || ""} ${result.url || ""}`.trim());
    }
  }
}

async function runNeteaseAudioFeatures(targets) {
  if (providerId !== "netease_music" || !neteaseAutoPlay) return;
  for (const target of targets.filter(isNeteaseMusicPage)) {
    const state = await evaluate(target.webSocketDebuggerUrl, neteaseAutoPlayStateExpression).catch(() => null);
    if (!state) continue;
    if (claimNeteaseAutoPlayAttempt(target, state)) {
      const clicked = clickNeteasePlayButton(state);
      console.log(`[tikpal-web-mode-guard] NetEase auto play ${clicked ? "clicked" : "skipped"} ${state.buttonLabel || ""}`.trim());
      if (clicked) return;
    }
  }
}

async function runProviderAudioGate(targets, active) {
  for (const target of targets.filter((item) => isProviderWebPage(item) && !isFriendlyErrorPage(item))) {
    await evaluate(target.webSocketDebuggerUrl, providerAudioGateExpression(active)).catch(() => null);
  }
}

async function guardOnce() {
  if (typeof WebSocket !== "function") return;
  const active = providerIsActive();
  const targets = (await readTargets()).filter(isPageTarget);
  await Promise.all(targets.map(async (target) => {
    attachEarlyErrorRedirect(target);
    await installKioskGuard(target);
    await maybeRedirectErrorPage(target);
  }));
  syncResidentProviderStatus(targets, active);
  await runProviderAudioGate(targets, active);
  if (active) await runInputFocusKeyboard(targets);
  await runConsentFeatures(targets);
  await runSafeDismissFeatures(targets);
  if (active) {
    await runSafePromptFeatures(targets);
    await runQqMusicAutoPlayFeatures(targets);
    await runQqAudioFeatures(targets);
    await runQqAudioPrimeFeatures(targets);
    await runQqMvTouchTargetFeatures(targets);
    await runQqMvCinemaFeatures(targets);
    await runNeteaseAudioFeatures(targets);
  }
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
  console.log("[tikpal-web-mode-guard] spotify cookie close dismiss: 1");
  console.log("[tikpal-web-mode-guard] trial upsell safe dismiss: 1");
  console.log("[tikpal-web-mode-guard] dangerous trial action blocked: 1");
  console.log(`[tikpal-web-mode-guard] input focus keyboard: ${onboardAutoFocus ? "1" : "0"}`);
  console.log(`[tikpal-web-mode-guard] provider audio gate: ${statePath ? "1" : "0"}`);
  console.log(`[tikpal-web-mode-guard] empty page timeout: ${Math.round(emptyPageTimeoutMs / 1000)}s`);
  console.log(`[tikpal-web-mode-guard] idle poll: ${idlePollMs}ms`);
  console.log(`[tikpal-web-mode-guard] qq auto confirm: ${qqAutoConfirm ? "1" : "0"}`);
  console.log(`[tikpal-web-mode-guard] qq auto unmute: ${qqAutoUnmute ? "1" : "0"}`);
  console.log(`[tikpal-web-mode-guard] qq audio prime: ${qqAudioPrime ? "1" : "0"}`);
  console.log(`[tikpal-web-mode-guard] qq music auto play: ${qqMusicAutoPlay ? "1" : "0"}`);
  console.log(`[tikpal-web-mode-guard] qq mv auto fullscreen: ${qqMvAutoFullscreen ? "1" : "0"}`);
  console.log(`[tikpal-web-mode-guard] qq mv cinema mode: ${qqMvCinemaMode ? "1" : "0"}`);
  console.log(`[tikpal-web-mode-guard] qq mv auto play: ${qqMvAutoPlay ? "1" : "0"}`);
  console.log(`[tikpal-web-mode-guard] netease auto play: ${neteaseAutoPlay ? "1" : "0"}`);
  console.log("[tikpal-web-mode-guard] qq mv native fullscreen path: 0");
  console.log("[tikpal-web-mode-guard] qq mv playlist button: 1");
  console.log("[tikpal-web-mode-guard] qq mv replay button: 1");
  console.log("[tikpal-web-mode-guard] qq mv cinema frame: 1");
  console.log("[tikpal-web-mode-guard] qq mv touch target: 1");
  console.log("[tikpal-web-mode-guard] youtube safe dismiss: 1");
  console.log(`[tikpal-web-mode-guard] accept-all labels: ${consentAcceptAllLabels.join(",")}`);
  console.log(`[tikpal-web-mode-guard] safe labels: ${safeLabels.join(",")}`);
  console.log(`[tikpal-web-mode-guard] dismiss labels: ${dismissLabels.join(",")}`);
  console.log("[tikpal-web-mode-guard] duplicate player pruning: 1");
  console.log("[tikpal-web-mode-guard] single pane navigation: 1");
  console.log("[tikpal-web-mode-guard] qq reminder cancel: 1");
  console.log("[tikpal-web-mode-guard] qq client prompt close/retry: 1");
  console.log("[tikpal-web-mode-guard] qq login prompt preserve: 1");
  process.exit(0);
}

// If CDP is unreachable for this many consecutive ticks the Chromium
// process has likely crashed or been killed.  Exit so reconcile can
// start a fresh guard instead of looping against a dead process.
let consecutiveCdpFailures = 0;
const MAX_CDP_FAILURES = 3;

while (profileProcessExists()) {
  let cdpOk = false;
  try {
    await guardOnce();
    cdpOk = true;
  } catch {
    // Guard failures must never break Explore playback or login.
  }
  if (cdpOk) {
    consecutiveCdpFailures = 0;
  } else {
    consecutiveCdpFailures += 1;
    if (consecutiveCdpFailures >= MAX_CDP_FAILURES) {
      console.error(`[tikpal-web-mode-guard] CDP unreachable for ${MAX_CDP_FAILURES} consecutive ticks; exiting`);
      process.exit(1);
    }
  }
  // Only the visible provider needs sub-second input and prompt handling.
  // The other resident pages still get safety/consent checks, but must not
  // compete with foreground X11 work on every 250ms tick.
  await sleep(providerIsActive() ? activePollMs : idlePollMs);
}

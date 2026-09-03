#!/usr/bin/env node
/*
 * One persistent browser-level CDP connection per resident provider.
 *
 * The launcher and Guard speak JSONL over a Unix socket.  They never need a
 * page WebSocket on the foreground path: this process owns discovery, target
 * attachment and the page session lifecycle.
 */
import { createConnection, createServer } from "node:net";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const socketPath = process.env.TIKPAL_WEB_MODE_CDP_SESSION_MANAGER_SOCKET || "/run/tikpal/cdp-session-manager.sock";
const statePath = process.env.TIKPAL_WEB_MODE_CDP_SESSION_MANAGER_STATE_PATH || "/run/tikpal/cdp-session-manager.json";
const basePort = Number.parseInt(process.env.TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT || "9234", 10) || 9234;
const commandTimeoutMs = Math.max(300, Number.parseInt(process.env.TIKPAL_WEB_MODE_CDP_SESSION_MANAGER_COMMAND_TIMEOUT_MS || "1800", 10) || 1800);
const browserTimeoutMs = Math.max(300, Number.parseInt(process.env.TIKPAL_WEB_MODE_CDP_SESSION_MANAGER_BROWSER_TIMEOUT_MS || "1200", 10) || 1200);
const discoveryRetryMs = Math.max(500, Number.parseInt(process.env.TIKPAL_WEB_MODE_CDP_SESSION_MANAGER_DISCOVERY_RETRY_MS || "2000", 10) || 2000);
// Guard maintenance is read-only or otherwise non-replayable.  It must not
// tear down a healthy browser-level session just because a background renderer
// takes longer than one scheduling slice to answer.
const maintenanceCommandTimeoutMs = Math.max(300, Number.parseInt(process.env.TIKPAL_WEB_MODE_CDP_SESSION_MANAGER_MAINTENANCE_COMMAND_TIMEOUT_MS || String(commandTimeoutMs), 10) || commandTimeoutMs);
const maintenanceCommandIntervalMs = Math.max(100, Number.parseInt(process.env.TIKPAL_WEB_MODE_CDP_SESSION_MANAGER_MAINTENANCE_COMMAND_INTERVAL_MS || "500", 10) || 500);
const providerOffsets = {
  suno: 9,
  spotify: 0,
  youtube_music: 1,
  apple_music: 2,
  tidal: 3,
  qobuz: 4,
  deezer: 5,
  amazon_music: 6,
  qq_music: 7,
  netease_music: 8
};

function nowMs() { return Date.now(); }
function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function errorCode(error) {
  const value = String(error?.message || error || "cdp_error");
  if (/timeout/i.test(value)) return "CDP_TIMEOUT";
  if (/socket|websocket|closed|connect|econn|network/i.test(value)) return "CDP_CONNECTION_LOST";
  if (/target|session|detached/i.test(value)) return "CDP_SESSION_INVALID";
  return "CDP_COMMAND_FAILED";
}
function isHttpsPage(info) {
  return info?.type === "page" && typeof info.url === "string" && info.url.startsWith("https://");
}
function canReplay(method, params) {
  if (method === "Page.bringToFront") return true;
  if (method !== "Runtime.evaluate") return false;
  const expression = String(params?.expression || "");
  return expression.includes("__tikpalProviderAudioGate?.setActive") ||
    expression.includes("dispatchEvent(new Event(\"resize\"))") ||
    expression.includes("dispatchEvent(new Event('resize'))") ||
    expression.includes("getBoundingClientRect()");
}

class ProviderSession {
  constructor(id, port) {
    this.id = id;
    this.port = port;
    this.state = "ABSENT";
    this.ws = null;
    this.wsUrl = "";
    this.connectionEpoch = 0;
    this.nextId = 1;
    this.pending = new Map();
    this.targetInfos = new Map();
    this.targetId = "";
    this.sessionId = "";
    this.browserGeneration = 0;
    this.sessionGeneration = 0;
    this.documentGeneration = 0;
    this.recoveryCount = 0;
    this.failedRecoveryCount = 0;
    this.lastError = "";
    this.lastCommandAt = 0;
    this.lastMaintenanceCommandAt = 0;
    this.activeCommandTimeoutMs = commandTimeoutMs;
    this.activeCommandIsMaintenance = false;
    this.lastReadyAt = 0;
    this.queue = [];
    this.running = false;
    this.connecting = null;
    this.errorPageUrl = "";
    this.redirectedDocumentGeneration = -1;
    this.lifecycleState = "active";
  }

  snapshot() {
    return {
      provider: this.id,
      port: this.port,
      state: this.state,
      targetId: this.targetId || null,
      sessionGeneration: this.sessionGeneration,
      documentGeneration: this.documentGeneration,
      browserGeneration: this.browserGeneration,
      recoveryCount: this.recoveryCount,
      failedRecoveryCount: this.failedRecoveryCount,
      lastError: this.lastError || null,
      lastReadyAt: this.lastReadyAt || null,
      lifecycleState: this.lifecycleState,
      url: this.targetId ? (this.targetInfos.get(this.targetId)?.url || null) : null,
      queued: this.queue.length + (this.running ? 1 : 0)
    };
  }

  setState(state, error = "") {
    this.state = state;
    this.lastError = error;
    publishState();
  }

  invalidateSession(reason = "session_invalid") {
    this.sessionId = "";
    this.targetId = "";
    this.errorPageUrl = "";
    this.redirectedDocumentGeneration = -1;
    this.lifecycleState = "active";
    if (this.ws) this.setState("RECOVERING", reason);
    else this.setState("ABSENT", reason);
  }

  async browserWsUrl() {
    const response = await fetch(`http://127.0.0.1:${this.port}/json/version`, {
      signal: AbortSignal.timeout(browserTimeoutMs)
    });
    if (!response.ok) throw new Error(`browser version HTTP ${response.status}`);
    const body = await response.json();
    if (!body?.webSocketDebuggerUrl) throw new Error("browser websocket missing");
    return String(body.webSocketDebuggerUrl);
  }

  connect() {
    if (this.connecting) return this.connecting;
    this.connecting = this.connectInternal().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async connectInternal() {
    this.setState(this.sessionGeneration > 0 ? "RECOVERING" : "DISCOVERING");
    const url = await this.browserWsUrl();
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const epoch = ++this.connectionEpoch;
      const timer = setTimeout(() => {
        try { ws.close(); } catch {}
        reject(new Error("browser websocket connect timeout"));
      }, browserTimeoutMs);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        this.ws = ws;
        this.wsUrl = url;
        this.browserGeneration += 1;
        ws.addEventListener("message", (event) => this.onMessage(event, ws, epoch));
        ws.addEventListener("close", () => this.onClose(ws, epoch));
        ws.addEventListener("error", () => {});
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("browser websocket connect failed"));
      });
    });
    await this.sendBrowser("Target.setDiscoverTargets", { discover: true });
    const result = await this.sendBrowser("Target.getTargets");
    this.replaceTargets(result?.targetInfos || []);
  }

  onClose(ws, epoch) {
    if (this.ws !== ws || this.connectionEpoch !== epoch) return;
    const pending = [...this.pending.values()];
    this.pending.clear();
    this.ws = null;
    this.wsUrl = "";
    for (const item of pending) item.reject(new Error("browser websocket closed"));
    this.invalidateSession("browser_socket_closed");
  }

  abandonBrowserConnection(reason) {
    const staleWs = this.ws;
    if (!staleWs) return;
    const pending = [...this.pending.values()];
    this.pending.clear();
    this.invalidateSession(reason);
    this.ws = null;
    this.wsUrl = "";
    for (const item of pending) {
      clearTimeout(item.timer);
      item.reject(new Error(reason));
    }
    try { staleWs.close(); } catch {}
  }

  onMessage(event, ws, epoch) {
    if (this.ws !== ws || this.connectionEpoch !== epoch) return;
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new Error(message.error.message || "CDP command failed"));
      } else {
        pending.resolve(message.result || {});
      }
      return;
    }
    this.onEvent(message.method, message.params || {}, message.sessionId || "");
  }

  onEvent(method, params, sessionId) {
    if (method === "Target.targetCreated") this.updateTargets([params.targetInfo]);
    if (method === "Target.targetInfoChanged") this.updateTargets([params.targetInfo]);
    if (method === "Target.targetDestroyed") {
      this.targetInfos.delete(params.targetId);
      if (params.targetId === this.targetId) this.invalidateSession("target_destroyed");
    }
    if (method === "Target.detachedFromTarget" && params.sessionId === this.sessionId) {
      this.invalidateSession("target_detached");
    }
    if (method === "Inspector.detached" && sessionId === this.sessionId) {
      this.invalidateSession("inspector_detached");
    }
    if (method === "Page.frameNavigated" && sessionId === this.sessionId && !params.frame?.parentId) {
      this.documentGeneration += 1;
      this.redirectedDocumentGeneration = -1;
      publishState();
    }
    if (method === "Page.loadingFailed" && sessionId === this.sessionId &&
        params.type === "Document" && this.errorPageUrl && this.redirectedDocumentGeneration !== this.documentGeneration) {
      const detail = String(params.errorText || "");
      if (!/ERR_ABORTED|NS_BINDING_ABORTED/i.test(detail)) {
        this.redirectedDocumentGeneration = this.documentGeneration;
        this.sendSession("Page.navigate", { url: this.errorPageUrl }).catch(() => {});
      }
    }
  }

  updateTargets(infos) {
    for (const info of infos) {
      if (info?.targetId) this.targetInfos.set(info.targetId, info);
    }
    publishState();
  }

  replaceTargets(infos) {
    this.targetInfos = new Map(
      infos
        .filter((info) => info?.targetId)
        .map((info) => [info.targetId, info])
    );
    if (this.targetId && !this.targetInfos.has(this.targetId)) {
      this.invalidateSession("target_absent_from_browser_snapshot");
      return;
    }
    publishState();
  }

  send(method, params = {}, sessionId = "") {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("browser websocket unavailable"));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // A timed-out foreground command must invalidate the channel before a
        // permitted transparent retry.  A maintenance probe is different: it
        // may still finish in Chromium after its caller has given up, so
        // closing the browser socket would manufacture session churn and make
        // the next foreground command pay discovery/attach cost.
        if (!this.activeCommandIsMaintenance) {
          this.abandonBrowserConnection(`CDP ${method} timeout`);
        }
        reject(new Error(`CDP ${method} timeout`));
      }, this.activeCommandTimeoutMs || commandTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        const message = { id, method, params };
        if (sessionId) message.sessionId = sessionId;
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  sendBrowser(method, params = {}) { return this.send(method, params); }
  sendSession(method, params = {}) {
    if (!this.sessionId) return Promise.reject(new Error("CDP session unavailable"));
    return this.send(method, params, this.sessionId);
  }

  currentHttpsTarget() {
    if (this.targetId) {
      const current = this.targetInfos.get(this.targetId);
      if (isHttpsPage(current)) return current;
    }
    return [...this.targetInfos.values()].find(isHttpsPage) || null;
  }

  async attach() {
    const target = this.currentHttpsTarget();
    if (!target) {
      this.setState("DISCOVERING", "no_real_https_page");
      throw new Error("no real HTTPS page target");
    }
    if (this.targetId === target.targetId && this.sessionId && this.state === "READY") return;
    this.setState("ATTACHING");
    if (this.targetId !== target.targetId || !this.sessionId) {
      const attached = await this.sendBrowser("Target.attachToTarget", {
        targetId: target.targetId,
        flatten: true
      });
      if (!attached?.sessionId) throw new Error("attach returned no session");
      this.targetId = target.targetId;
      this.sessionId = attached.sessionId;
      this.sessionGeneration += 1;
      this.documentGeneration += 1;
      this.redirectedDocumentGeneration = -1;
    }
    await this.sendSession("Runtime.enable");
    await this.sendSession("Page.enable");
    this.lastReadyAt = nowMs();
    this.setState("READY");
  }

  async ensureReady() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) await this.connect();
    if (!this.sessionId || !this.targetId || this.state !== "READY") await this.attach();
  }

  enqueue(request) {
    return new Promise((resolve) => {
      const item = { request, resolve };
      if (request.priority === "foreground") this.queue.unshift(item);
      else this.queue.push(item);
      this.drain();
    });
  }

  async drain() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const item = this.queue.shift();
      let response;
      this.activeCommandTimeoutMs = item.request.op === "command" && item.request.priority === "maintenance"
        ? maintenanceCommandTimeoutMs
        : commandTimeoutMs;
      this.activeCommandIsMaintenance = item.request.priority === "maintenance";
      try { response = await this.handle(item.request); }
      catch (error) { response = this.failure(error); }
      this.activeCommandTimeoutMs = commandTimeoutMs;
      this.activeCommandIsMaintenance = false;
      item.resolve(response);
    }
    this.running = false;
  }

  failure(error, timings = {}) {
    const code = errorCode(error);
    this.lastError = String(error?.message || error);
    publishState();
    return { ok: false, error: this.lastError, errorCode: code, provider: this.id, target: this.snapshot(), timings };
  }

  async recover() {
    const staleWs = this.ws;
    this.invalidateSession("transparent_recovery");
    this.ws = null;
    this.wsUrl = "";
    if (staleWs) {
      try { staleWs.close(); } catch {}
    }
    await this.ensureReady();
    this.recoveryCount += 1;
    publishState();
  }

  async handle(request) {
    const started = nowMs();
    const op = request.op || "command";
    if (op === "status") return { ok: true, provider: this.id, target: this.snapshot(), timings: { totalMs: nowMs() - started } };
    if (op === "browser-info") {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) await this.connect();
      const result = await this.sendBrowser("SystemInfo.getInfo");
      return { ok: true, result, provider: this.id, target: this.snapshot(), timings: { totalMs: nowMs() - started } };
    }
    if (op === "targets") {
      try { await this.ensureReady(); } catch (error) { return this.failure(error, { totalMs: nowMs() - started }); }
      return {
        ok: true,
        provider: this.id,
        targets: [...this.targetInfos.values()].map((info) => ({
          id: info.targetId,
          type: info.type,
          title: info.title,
          url: info.url,
          attached: info.attached,
          webSocketDebuggerUrl: `manager://${this.id}/${info.targetId}`,
          managerSessionGeneration: info.targetId === this.targetId ? this.sessionGeneration : 0,
          managerDocumentGeneration: info.targetId === this.targetId ? this.documentGeneration : 0
        })),
        target: this.snapshot(),
        timings: { totalMs: nowMs() - started }
      };
    }
    if (op === "watch-early-error") {
      await this.ensureReady();
      if (request.targetId && request.targetId !== this.targetId) throw new Error("early-error target is not attached target");
      this.errorPageUrl = String(request.errorPageUrl || "");
      this.redirectedDocumentGeneration = -1;
      return { ok: true, provider: this.id, target: this.snapshot(), timings: { totalMs: nowMs() - started } };
    }
    if (op === "lifecycle") {
      const state = String(request.state || "").toLowerCase();
      if (state !== "active" && state !== "frozen") throw new Error("invalid lifecycle state");
      await this.ensureReady();
      const result = await this.sendSession("Page.setWebLifecycleState", { state });
      this.lifecycleState = state;
      publishState();
      return { ok: true, result, provider: this.id, target: this.snapshot(), timings: { totalMs: nowMs() - started } };
    }
    if (op === "close-target") {
      await this.ensureReady();
      const targetId = String(request.targetId || this.targetId || "");
      if (!targetId) throw new Error("close target missing");
      const result = await this.sendBrowser("Target.closeTarget", { targetId });
      return { ok: Boolean(result?.success), result, provider: this.id, target: this.snapshot(), timings: { totalMs: nowMs() - started } };
    }
    if (op !== "command") throw new Error(`unsupported manager operation ${op}`);
    const method = String(request.method || "");
    if (!method) throw new Error("CDP method missing");
    const params = request.params && typeof request.params === "object" ? request.params : {};
    if (request.priority === "maintenance" && nowMs() - this.lastMaintenanceCommandAt < maintenanceCommandIntervalMs) {
      return {
        ok: false,
        error: "CDP maintenance throttled",
        errorCode: "CDP_MAINTENANCE_THROTTLED",
        provider: this.id,
        target: this.snapshot(),
        timings: { totalMs: nowMs() - started }
      };
    }
    if (request.priority === "maintenance") this.lastMaintenanceCommandAt = nowMs();
    const queuedAt = positiveInt(request.queuedAt, started);
    const timings = { queueMs: Math.max(0, started - queuedAt), sessionLookupMs: 0, cdpResponseMs: 0, recoveryMs: 0, totalMs: 0 };
    const priorSession = this.sessionGeneration;
    let recovered = false;
    try {
      const lookupStarted = nowMs();
      await this.ensureReady();
      timings.sessionLookupMs = nowMs() - lookupStarted;
      const commandStarted = nowMs();
      const result = await this.sendSession(method, params);
      timings.cdpResponseMs = nowMs() - commandStarted;
      timings.totalMs = nowMs() - started;
      this.lastCommandAt = nowMs();
      return { ok: true, result, provider: this.id, target: this.snapshot(), recovered, timings };
    } catch (firstError) {
      const replayAllowed = request.retryable === true && canReplay(method, params) && priorSession > 0;
      if (!replayAllowed) {
        timings.totalMs = nowMs() - started;
        return this.failure(firstError, timings);
      }
      const recoveryStarted = nowMs();
      try {
        await this.recover();
        timings.recoveryMs = nowMs() - recoveryStarted;
        const commandStarted = nowMs();
        const result = await this.sendSession(method, params);
        timings.cdpResponseMs += nowMs() - commandStarted;
        timings.totalMs = nowMs() - started;
        recovered = true;
        this.lastCommandAt = nowMs();
        return { ok: true, result, provider: this.id, target: this.snapshot(), recovered, timings };
      } catch (recoveryError) {
        this.failedRecoveryCount += 1;
        timings.recoveryMs = nowMs() - recoveryStarted;
        timings.totalMs = nowMs() - started;
        return this.failure(recoveryError, timings);
      }
    }
  }
}

const sessions = new Map(Object.entries(providerOffsets).map(([id, offset]) => [id, new ProviderSession(id, basePort + offset)]));

function publishState() {
  try {
    mkdirSync(dirname(statePath), { recursive: true, mode: 0o750 });
    const temporary = `${statePath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      socketPath,
      providers: Object.fromEntries([...sessions].map(([id, session]) => [id, session.snapshot()]))
    })}\n`, { mode: 0o640 });
    renameSync(temporary, statePath);
  } catch (error) {
    console.error(`[tikpal-cdp-manager] state publish failed: ${error.message}`);
  }
}

function responseForUnknownProvider(provider) {
  return { ok: false, provider, error: "unknown provider", errorCode: "CDP_PROVIDER_UNKNOWN" };
}

function sendJson(socket, body) {
  if (socket.destroyed) return;
  try { socket.write(`${JSON.stringify(body)}\n`); } catch {}
}

rmSync(socketPath, { force: true });
mkdirSync(dirname(socketPath), { recursive: true, mode: 0o750 });
const server = createServer((socket) => {
  let buffer = "";
  // IPC callers deliberately use bounded timeouts. A caller can therefore
  // disappear while a provider is still recovering; that must not take down
  // every persistent browser session with an unhandled EPIPE.
  socket.on("error", () => {});
  socket.setEncoding("utf8");
  socket.on("data", async (chunk) => {
    buffer += chunk;
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let request;
      try { request = JSON.parse(line); }
      catch { sendJson(socket, { ok: false, error: "invalid JSONL request", errorCode: "CDP_IPC_INVALID" }); continue; }
      if (request.op === "status" && !request.provider) {
        sendJson(socket, { ok: true, providers: Object.fromEntries([...sessions].map(([id, session]) => [id, session.snapshot()])) });
        continue;
      }
      const session = sessions.get(String(request.provider || ""));
      if (!session) { sendJson(socket, responseForUnknownProvider(request.provider)); continue; }
      request.queuedAt = nowMs();
      session.enqueue(request).then((response) => sendJson(socket, response));
    }
  });
});
server.on("error", (error) => {
  console.error(`[tikpal-cdp-manager] socket server failed: ${error.message}`);
  process.exitCode = 1;
});
server.listen(socketPath, () => {
  publishState();
  console.log(`[tikpal-cdp-manager] listening socket=${socketPath} providers=${sessions.size}`);
  // Warm every resident browser once at service start.  Failures remain in
  // DISCOVERING/ABSENT and are retried on the next queued provider request;
  // this never creates a discovery step on a healthy foreground hot path.
  for (const session of sessions.values()) {
    session.enqueue({ op: "targets", provider: session.id, priority: "maintenance", queuedAt: nowMs() })
      .catch(() => {});
  }
});

// A Chromium process can publish its DevTools port before its page target is
// visible. Keep discovery retries on this background control plane; foreground
// callers only use an already-attached session or wait behind this queue.
setInterval(() => {
  for (const session of sessions.values()) {
    if (session.state === "READY" || session.running || session.queue.length) continue;
    session.enqueue({ op: "targets", provider: session.id, priority: "maintenance", queuedAt: nowMs() })
      .catch(() => {});
  }
}, discoveryRetryMs);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

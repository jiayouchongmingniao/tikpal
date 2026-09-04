#!/usr/bin/env node
/* Minimal mock browser proving the Manager keeps one page session hot and
 * only retries the explicitly safe foreground command once. */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const temporary = mkdtempSync(path.join(tmpdir(), "tikpal-cdp-manager-smoke-"));
const socketPath = path.join(temporary, "manager.sock");
const statePath = path.join(temporary, "manager.json");
let targetId = "spotify-target";
let targetUrl = "https://open.spotify.com/";
let browserConnections = 0;
let getTargets = 0;
let sessionGeneration = 0;
let dropNextSafeCommand = false;
let dropInitialPageEnable = true;
let pageEnableAttempts = 0;
const mockSockets = new Set();
let browserSocket = null;
const friendlyErrorNavigations = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function frame(payload) {
  const body = Buffer.from(JSON.stringify(payload));
  if (body.length < 126) return Buffer.concat([Buffer.from([0x81, body.length]), body]);
  const header = Buffer.alloc(4);
  header[0] = 0x81;
  header[1] = 126;
  header.writeUInt16BE(body.length, 2);
  return Buffer.concat([header, body]);
}

function parseFrames(buffer, callback) {
  let offset = 0;
  while (buffer.length - offset >= 2) {
    let size = buffer[offset + 1] & 0x7f;
    const masked = Boolean(buffer[offset + 1] & 0x80);
    let extended = 0;
    if (size === 126) extended = 2;
    if (size === 127) throw new Error("unexpected oversized mock frame");
    const header = 2 + extended + (masked ? 4 : 0);
    if (buffer.length - offset < header + size) break;
    if (extended) size = buffer.readUInt16BE(offset + 2);
    if (buffer.length - offset < header + size) break;
    const mask = masked ? buffer.subarray(offset + 2 + extended, offset + 6 + extended) : null;
    const payload = Buffer.from(buffer.subarray(offset + header, offset + header + size));
    if (mask) for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
    callback(JSON.parse(payload.toString()));
    offset += header + size;
  }
  return buffer.subarray(offset);
}

const browser = createServer((request, response) => {
  if (request.url !== "/json/version") { response.writeHead(404).end(); return; }
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${browser.address().port}/devtools/browser/mock` }));
});
browser.on("upgrade", (request, socket) => {
  const key = String(request.headers["sec-websocket-key"] || "");
  const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  mockSockets.add(socket);
  browserSocket = socket;
  socket.once("close", () => mockSockets.delete(socket));
  browserConnections += 1;
  let input = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    input = parseFrames(Buffer.concat([input, chunk]), (message) => {
      const reply = (result = {}) => socket.write(frame({ id: message.id, result }));
      if (message.method === "Page.enable") {
        pageEnableAttempts += 1;
        if (dropInitialPageEnable) {
          dropInitialPageEnable = false;
          return;
        }
        return reply();
      }
      if (message.method === "Target.setDiscoverTargets" || message.method === "Runtime.enable") return reply();
      if (message.method === "Target.getTargets") {
        getTargets += 1;
        return reply({ targetInfos: [{ targetId, type: "page", title: "Spotify", url: targetUrl }] });
      }
      if (message.method === "Target.attachToTarget") {
        if (message.params?.targetId !== targetId) {
          return socket.write(frame({ id: message.id, error: { message: "No target with given id found" } }));
        }
        sessionGeneration += 1;
        return reply({ sessionId: `session-${sessionGeneration}` });
      }
      if (message.method === "Page.bringToFront" && dropNextSafeCommand) {
        dropNextSafeCommand = false;
        targetId = "spotify-target-restarted";
        targetUrl = "https://open.spotify.com/";
        socket.destroy();
        return;
      }
      if (message.method === "Page.navigate") {
        if (String(message.params?.url || "").includes("/web-mode-error.html")) {
          targetUrl = String(message.params.url);
          friendlyErrorNavigations.push(targetUrl);
          socket.write(frame({ method: "Target.targetInfoChanged", params: { targetInfo: { targetId, type: "page", title: "Tikpal Explore", url: targetUrl } } }));
          return reply();
        }
        socket.destroy();
        return;
      }
      reply({ result: { value: true } });
    });
  });
});

function emitPageEvent(method, params, sessionId) {
  if (!browserSocket) throw new Error("mock browser websocket unavailable");
  browserSocket.write(frame({ method, params, sessionId }));
}

function managerRequest(payload) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    let input = "";
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("manager IPC timeout")); }, 4000);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify(payload)}\n`));
    socket.on("data", (chunk) => {
      input += chunk;
      const newline = input.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timer);
      socket.end();
      resolve(JSON.parse(input.slice(0, newline)));
    });
    socket.on("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

async function waitForSocket() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (existsSync(socketPath)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("manager socket did not appear");
}

async function waitFor(check, message) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

await new Promise((resolve) => browser.listen(0, "127.0.0.1", resolve));
const manager = spawn(process.execPath, ["--experimental-websocket", "deploy/chromium/tikpal-web-mode-cdp-manager.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT: String(browser.address().port),
    TIKPAL_WEB_MODE_CDP_SESSION_MANAGER_SOCKET: socketPath,
    TIKPAL_WEB_MODE_CDP_SESSION_MANAGER_STATE_PATH: statePath,
    TIKPAL_WEB_MODE_CDP_SESSION_MANAGER_COMMAND_TIMEOUT_MS: "300"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

try {
  await waitForSocket();
  await waitFor(() => pageEnableAttempts === 1, "maintenance warm-up did not reach Page.enable");
  const targets = await managerRequest({ op: "targets", provider: "spotify", priority: "foreground" });
  assert(targets.ok && targets.target.state === "READY", `manager should attach a real HTTPS page session: ${JSON.stringify(targets)}`);
  assert(pageEnableAttempts === 2 && targets.target.sessionGeneration === 1, "an incomplete maintenance attach should reuse its session and finish enable");
  assert(browserConnections === 1 && getTargets === 1, "initial discovery should use one browser connection and target enumeration");
  const errorWatch = await managerRequest({
    op: "watch-early-error",
    provider: "spotify",
    targetId,
    errorPageUrl: "http://127.0.0.1:4173/web-mode-error.html?provider=spotify&proxy=proxy",
    failureStatus: "check_proxy",
    priority: "maintenance"
  });
  assert(errorWatch.ok, "manager should arm the friendly error redirect for the attached provider page");
  emitPageEvent("Page.loadingFailed", { type: "Document", errorText: "net::ERR_TIMED_OUT" }, "session-1");
  await waitFor(() => friendlyErrorNavigations.length === 1, "document timeout should navigate to the local friendly error page");
  assert(friendlyErrorNavigations[0].includes("reason=connection_timeout"), "timeout should be converted to a stable friendly reason");
  emitPageEvent("Page.loadingFailed", { type: "Document", errorText: "net::ERR_TIMED_OUT" }, "session-1");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert(friendlyErrorNavigations.length === 1, "one document generation should redirect only once");
  const failedTargets = await managerRequest({ op: "targets", provider: "spotify", priority: "foreground" });
  assert(
    failedTargets.target.friendlyError?.reason === "connection_timeout" && failedTargets.target.friendlyError?.status === "check_proxy",
    "manager should publish the friendly failure without exposing the Chromium error"
  );
  emitPageEvent("Target.detachedFromTarget", { sessionId: "session-1" });
  await new Promise((resolve) => setTimeout(resolve, 25));
  const reattachedFriendly = await managerRequest({ op: "targets", provider: "spotify", priority: "foreground" });
  assert(
    reattachedFriendly.ok && reattachedFriendly.target.state === "READY" && reattachedFriendly.target.friendlyError?.status === "check_proxy",
    "manager should reattach its own friendly error page after a target detach"
  );
  targetUrl = "https://open.spotify.com/";
  emitPageEvent("Target.targetInfoChanged", { targetInfo: { targetId, type: "page", title: "Spotify", url: targetUrl } });
  emitPageEvent("Page.frameNavigated", { frame: { id: "root", url: "https://open.spotify.com/" } }, "session-2");
  await new Promise((resolve) => setTimeout(resolve, 25));
  const recoveredTargets = await managerRequest({ op: "targets", provider: "spotify", priority: "foreground" });
  assert(recoveredTargets.target.friendlyError === null, "a real provider navigation should clear the prior friendly failure");
  emitPageEvent("Page.frameNavigated", {
    frame: { id: "root", url: "chrome-error://chromewebdata/", unreachableUrl: "https://open.spotify.com/" }
  }, "session-2");
  await waitFor(() => friendlyErrorNavigations.length === 2, "unreachable root frame should also navigate to the local friendly error page");
  assert(friendlyErrorNavigations[1].includes("reason=site_unreachable"), "unreachable root frame should use a stable site-unreachable reason");
  const browserInfo = await managerRequest({ op: "browser-info", provider: "spotify", priority: "maintenance" });
  assert(browserInfo.ok, "browser diagnostics should use the existing browser CDP connection");
  const frozen = await managerRequest({ op: "lifecycle", provider: "spotify", state: "frozen", priority: "maintenance" });
  assert(frozen.ok && frozen.target.lifecycleState === "frozen", "inactive provider lifecycle should freeze without closing its session");
  const active = await managerRequest({ op: "lifecycle", provider: "spotify", state: "active", priority: "foreground" });
  assert(active.ok && active.target.lifecycleState === "active", "foreground provider lifecycle should resume before switch work");
  assert(browserConnections === 1 && getTargets === 1, "lifecycle changes must keep the resident browser and target hot");
  const hot = await managerRequest({ op: "command", provider: "spotify", method: "Page.bringToFront", params: {}, retryable: true, priority: "foreground" });
  assert(hot.ok && !hot.recovered, "healthy foreground command should use the cached session");
  assert(browserConnections === 1 && getTargets === 1, "healthy foreground command must not rediscover or reconnect");
  dropNextSafeCommand = true;
  const recovered = await managerRequest({ op: "command", provider: "spotify", method: "Page.bringToFront", params: {}, retryable: true, priority: "foreground" });
  assert(recovered.ok && recovered.recovered, "safe foreground command should recover once");
  assert(browserConnections === 2 && getTargets === 2 && recovered.target.sessionGeneration === 3, "recovery should establish exactly one replacement session after the friendly-page reattach");
  assert(recovered.target.targetId === "spotify-target-restarted", "recovery should discard stale targets after the browser is replaced");
  const unsafe = await managerRequest({ op: "command", provider: "spotify", method: "Page.navigate", params: { url: "https://example.invalid/" }, retryable: false, priority: "foreground" });
  assert(!unsafe.ok && browserConnections === 2, "non-idempotent command must not be replayed after transport loss");
  console.log("[tikpal-cdp-session-manager-smoke] passed");
} finally {
  manager.kill("SIGTERM");
  await new Promise((resolve) => manager.once("exit", resolve));
  for (const socket of mockSockets) socket.destroy();
  browser.closeAllConnections?.();
  await new Promise((resolve) => browser.close(resolve));
  rmSync(temporary, { recursive: true, force: true });
}

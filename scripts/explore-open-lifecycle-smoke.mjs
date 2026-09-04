import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { createExploreCloseRequestId, isExploreCloseMessage } from "../src/exploreCloseVeil.ts";
import { ExploreOpenVeilController } from "../src/exploreOpenVeil.ts";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

async function getFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitFor(check, message, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const value = await check();
      if (value) return value;
    } catch {
      // The child or its state file is not ready yet.
    }
    await wait(25);
  }
  throw new Error(message);
}

async function postJson(port, pathname, body) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

const COMMAND_FIXTURE = `#!/usr/bin/env bash
set -euo pipefail
action="\${1:-}"
provider="\${2:-}"
printf '%s\\t%s\\t%s\\t%s\\n' "$action" "$provider" "\${TIKPAL_WEB_MODE_OPEN_REQUEST_ID:-}" "\${TIKPAL_WEB_MODE_OPEN_X_SESSION_GENERATION:-}" >> "$TEST_COMMAND_LOG"
if [[ "$action" == "prepare-entry" ]]; then
  cp "$TIKPAL_WEB_MODE_STATE_PATH" "$TEST_PREPARE_SNAPSHOT"
  [[ "\${TEST_PREPARE_SLEEP_SECONDS:-0}" == "0" ]] || sleep "$TEST_PREPARE_SLEEP_SECONDS"
  exit 0
fi
[[ "$action" == "open" ]] || exit 0
case "\${TEST_COMMAND_MODE:-success}" in
  fallback)
    [[ "$provider" != "spotify" ]] || exit 42
    ;;
  fallback-fail)
    exit 42
    ;;
  stale)
    temporary="\${TIKPAL_KIOSK_X_SESSION_GENERATION_PATH}.$$.$RANDOM.tmp"
    printf 'session-2\\n' > "$temporary"
    mv -f "$temporary" "$TIKPAL_KIOSK_X_SESSION_GENERATION_PATH"
    ;;
  supersede)
    if [[ "$provider" == "spotify" ]]; then sleep 0.45; else sleep 0.05; fi
    ;;
  generation-reuse)
    sleep 0.45
    ;;
  timeout)
    sleep 1
    ;;
esac
`;

async function startApi(commandMode, options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "tikpal-explore-lifecycle-"));
  const port = await getFreePort();
  const paths = {
    root,
    state: path.join(root, "web-mode-state.json"),
    settings: path.join(root, "web-mode-settings.json"),
    handoff: path.join(root, "web-mode-handoff.json"),
    generation: path.join(root, "kiosk-x-session-generation"),
    command: path.join(root, "web-mode-command.sh"),
    commandLog: path.join(root, "commands.tsv"),
    prepareSnapshot: path.join(root, "prepare-state.json")
  };
  writeFileSync(paths.generation, "session-1\n");
  writeFileSync(paths.command, COMMAND_FIXTURE);
  chmodSync(paths.command, 0o755);
  let stdout = "";
  let stderr = "";
  const child = spawn(process.execPath, [path.join(ROOT, "server/index.mjs")], {
    cwd: ROOT,
    env: {
      ...process.env,
      TIKPAL_PLAYER_BACKEND: "mock",
      TIKPAL_API_HOST: "127.0.0.1",
      TIKPAL_API_PORT: String(port),
      TIKPAL_WEB_MODE_COMMAND: paths.command,
      TIKPAL_WEB_MODE_COMMAND_TIMEOUT_MS: "2000",
      TIKPAL_WEB_MODE_OPEN_COMMAND_TIMEOUT_MS: String(options.openTimeoutMs ?? 2000),
      TIKPAL_WEB_MODE_STATE_PATH: paths.state,
      TIKPAL_WEB_MODE_SETTINGS_PATH: paths.settings,
      TIKPAL_WEB_MODE_HANDOFF_STATE_PATH: paths.handoff,
      TIKPAL_WEB_MODE_SWITCH_TRACE_CONTEXT_PATH: path.join(root, "trace-context.json"),
      TIKPAL_KIOSK_X_SESSION_GENERATION_PATH: paths.generation,
      TIKPAL_UI_PREFERENCES_STATE_PATH: path.join(root, "ui-preferences.json"),
      TIKPAL_ROOM_EXPERIENCE_STATE_PATH: path.join(root, "room-experience.json"),
      TIKPAL_AUDIO_SOURCE_MEMORY_STATE_PATH: path.join(root, "audio-source-memory.json"),
      TEST_COMMAND_MODE: commandMode,
      TEST_COMMAND_LOG: paths.commandLog,
      TEST_PREPARE_SNAPSHOT: paths.prepareSnapshot,
      TEST_PREPARE_SLEEP_SECONDS: String(options.prepareSleepSeconds ?? 0)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    return response.ok;
  }, `mock API did not start: ${stderr}`);
  return {
    port,
    paths,
    output: () => `${stdout}\n${stderr}`,
    async stop() {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await Promise.race([
          new Promise((resolve) => child.once("exit", resolve)),
          wait(2000)
        ]);
      }
      rmSync(root, { recursive: true, force: true });
    }
  };
}

function readState(paths) {
  return JSON.parse(readFileSync(paths.state, "utf8"));
}

function readCommands(paths) {
  return readFileSync(paths.commandLog, "utf8").trim().split("\n").filter(Boolean).map((line) => {
    const [action, provider, requestId, generation] = line.split("\t");
    return { action, provider, requestId, generation };
  });
}

async function testVeilOwnership() {
  const controller = new ExploreOpenVeilController();
  const timedOut = [];
  controller.begin("old-request", 10, (requestId) => timedOut.push(requestId));
  controller.begin("new-request", 80, (requestId) => timedOut.push(requestId));
  await wait(30);
  assert.deepEqual(timedOut, [], "replacing a veil should cancel the old timeout");
  assert.equal(controller.finish("old-request"), false, "an old callback must not remove the new veil");
  assert.equal(controller.currentRequestId, "new-request");
  assert.equal(controller.finish("new-request"), true, "the current request should remove its veil");
  controller.begin("timeout-request", 10, (requestId) => timedOut.push(requestId));
  await wait(30);
  assert.deepEqual(timedOut, ["timeout-request"], "the current veil should remove itself at its independent timeout");
  assert.equal(controller.currentRequestId, null);
  controller.dispose();
}

function testCloseVeilMessageContract() {
  assert.match(createExploreCloseRequestId(), /^close-/);
  assert.equal(isExploreCloseMessage({ type: "cover-requested", requestId: "close-request" }), true);
  assert.equal(isExploreCloseMessage({ type: "cover-ready", requestId: "close-request" }), true);
  assert.equal(isExploreCloseMessage({ type: "failed", requestId: "close-request" }), true);
  assert.equal(isExploreCloseMessage({ type: "closed", requestId: "close-request", state: { activeProvider: null } }), true);
  assert.equal(isExploreCloseMessage({ type: "closed", requestId: "" }), false);
  assert.equal(isExploreCloseMessage({ type: "cover-ready" }), false);
  assert.equal(isExploreCloseMessage("closing"), false);
}

async function testInitialOpeningAndWatchdogBypass() {
  const api = await startApi("success", { prepareSleepSeconds: 0.6 });
  try {
    await postJson(api.port, "/api/v1/kiosk/heartbeat", {
      visibility: "visible",
      pageMode: "ambient",
      room: { mode: "calm" },
      scene: { sceneVideoEnabled: true },
      activeSceneVideo: { present: true, health: "stalled", readyState: 1, currentTime: 12.5 }
    });
    const requestId = "initial-request";
    const openPromise = postJson(api.port, "/api/v1/web-mode/actions", { type: "open", provider: "spotify", openRequestId: requestId });
    const opening = await waitFor(() => {
      const state = readState(api.paths);
      return state.openingProvider === "spotify" ? state : null;
    }, "initial opening state was not persisted before preparation");
    assert.equal(opening.openRequestId, requestId);
    assert.equal(opening.openXSessionGeneration, "session-1");
    assert.match(opening.openStartedAt, /^\d{4}-\d{2}-\d{2}T/);
    await waitFor(() => readFileSync(api.paths.prepareSnapshot, "utf8"), "prepare-entry did not capture opening state");
    const preparedState = JSON.parse(readFileSync(api.paths.prepareSnapshot, "utf8"));
    assert.equal(preparedState.openRequestId, requestId, "prepare-entry should observe the persisted opening owner");

    const watchdog = spawnSync("bash", [path.join(ROOT, "deploy/chromium/tikpal-kiosk-healthcheck.sh")], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        TIKPAL_KIOSK_WATCHDOG_STATE_DIR: path.join(api.paths.root, "watchdog"),
        TIKPAL_KIOSK_WATCHDOG_DRY_RUN: "1",
        TIKPAL_KIOSK_WATCHDOG_X_DISPLAY_SCAN: "0",
        TIKPAL_KIOSK_WATCHDOG_CHROMIUM_PROCESS_SCAN: "0",
        TIKPAL_KIOSK_WATCHDOG_WEB_URL_SCAN: "0",
        TIKPAL_KIOSK_WATCHDOG_API_URL_SCAN: "0",
        TIKPAL_KIOSK_WATCHDOG_GPU_LOG_SCAN: "0",
        TIKPAL_WEB_MODE_STATE_PATH: api.paths.state,
        TIKPAL_KIOSK_X_SESSION_GENERATION_PATH: api.paths.generation,
        TIKPAL_KIOSK_WATCHDOG_PAGE_HEARTBEAT_URL: `http://127.0.0.1:${api.port}/api/v1/kiosk/heartbeat`
      }
    });
    assert.equal(watchdog.status, 0, watchdog.stderr || watchdog.stdout);
    assert.match(watchdog.stdout, /heartbeat decision=bypass/);
    assert.match(watchdog.stdout, /bypass_reason=opening-request/);
    assert.match(watchdog.stdout, /opening_provider=spotify/);
    assert.match(watchdog.stdout, /open_request_id=initial-request/);
    assert.match(watchdog.stdout, /x_session_generation=session-1/);
    assert.match(watchdog.stdout, /current_x_session_generation=session-1/);
    assert.match(watchdog.stdout, /scene_ready_state=1/);
    assert.match(watchdog.stdout, /scene_current_time=12\.5/);
    assert.match(watchdog.stdout, /scene_stalled=1/);
    assert.match(watchdog.stdout, /scene_not_ready=1/);
    assert.doesNotMatch(watchdog.stdout, /restart suppressed/);

    const response = await openPromise;
    assert.equal(response.status, 200);
    const finalState = readState(api.paths);
    assert.equal(finalState.activeProvider, "spotify");
    assert.equal(finalState.openingProvider, null);
    assert.equal(finalState.openRequestId, null);
    assert.equal(finalState.openStartedAt, null);
    assert.equal(finalState.openXSessionGeneration, null);
    assert.equal(finalState.lastOpenedRequestId, requestId);
    assert.equal(finalState.lastOpenedXSessionGeneration, "session-1");
    const commands = readCommands(api.paths).filter((entry) => entry.action === "prepare-entry" || entry.action === "open");
    assert(commands.every((entry) => entry.requestId === requestId && entry.generation === "session-1"));
    assert.match(api.output(), /\[tikpal-kiosk-heartbeat\].*"currentTime":12\.5/);
    assert.match(api.output(), /"stage":"initial_entry_timing_started"/);
    assert.match(api.output(), /"stage":"handoff_capture_completed".*"elapsedMs":/);
    assert.match(api.output(), /"stage":"audio_pause_completed".*"elapsedMs":/);
    assert.match(api.output(), /"stage":"entry_prepare_completed".*"elapsedMs":/);
    assert.match(api.output(), /"stage":"initial_entry_ready".*"audioPauseElapsedMs":/);
    assert.match(api.output(), /"stage":"provider_open_completed".*"commandElapsedMs":/);
  } finally {
    await api.stop();
  }
}

async function testStaleOpeningDoesNotBypassWatchdog() {
  const api = await startApi("success");
  try {
    await postJson(api.port, "/api/v1/kiosk/heartbeat", {
      visibility: "visible",
      pageMode: "ambient",
      room: { mode: "calm" },
      scene: { sceneVideoEnabled: true },
      activeSceneVideo: { present: true, health: "stalled", readyState: 1, currentTime: 18.25 }
    });
    writeFileSync(api.paths.state, `${JSON.stringify({
      activeProvider: null,
      openingProvider: "spotify",
      openRequestId: "stale-watchdog-request",
      openStartedAt: "2026-08-31T00:00:00.000Z",
      openXSessionGeneration: "session-1",
      lastProvider: null,
      residentProviders: {},
      prewarmComplete: false,
      lastError: null,
      closeRequestId: null
    })}\n`);
    writeFileSync(api.paths.generation, "session-2\n");

    const watchdog = spawnSync("bash", [path.join(ROOT, "deploy/chromium/tikpal-kiosk-healthcheck.sh")], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        TIKPAL_KIOSK_WATCHDOG_STATE_DIR: path.join(api.paths.root, "watchdog-stale"),
        TIKPAL_KIOSK_WATCHDOG_DRY_RUN: "1",
        TIKPAL_KIOSK_WATCHDOG_X_DISPLAY_SCAN: "0",
        TIKPAL_KIOSK_WATCHDOG_CHROMIUM_PROCESS_SCAN: "0",
        TIKPAL_KIOSK_WATCHDOG_WEB_URL_SCAN: "0",
        TIKPAL_KIOSK_WATCHDOG_API_URL_SCAN: "0",
        TIKPAL_KIOSK_WATCHDOG_GPU_LOG_SCAN: "0",
        TIKPAL_WEB_MODE_STATE_PATH: api.paths.state,
        TIKPAL_KIOSK_X_SESSION_GENERATION_PATH: api.paths.generation,
        TIKPAL_KIOSK_WATCHDOG_PAGE_HEARTBEAT_URL: `http://127.0.0.1:${api.port}/api/v1/kiosk/heartbeat`
      }
    });
    assert.equal(watchdog.status, 0, watchdog.stderr || watchdog.stdout);
    assert.match(watchdog.stdout, /heartbeat decision=restart/);
    assert.match(watchdog.stdout, /bypass_reason=stale-opening-request/);
    assert.match(watchdog.stdout, /x_session_generation=session-1/);
    assert.match(watchdog.stdout, /current_x_session_generation=session-2/);
    assert.match(watchdog.stdout, /dry-run restart suppressed for tikpal-kiosk\.service/);
    assert.deepEqual(readState(api.paths), {
      activeProvider: null,
      openingProvider: "spotify",
      openRequestId: "stale-watchdog-request",
      openStartedAt: "2026-08-31T00:00:00.000Z",
      openXSessionGeneration: "session-1",
      lastProvider: null,
      residentProviders: {},
      prewarmComplete: false,
      lastError: null,
      closeRequestId: null
    });
  } finally {
    await api.stop();
  }
}

async function testFallbackCorrelation() {
  const api = await startApi("fallback");
  try {
    const requestId = "fallback-request";
    const response = await postJson(api.port, "/api/v1/web-mode/actions", { type: "open", provider: "spotify", openRequestId: requestId });
    assert.equal(response.status, 200);
    const state = readState(api.paths);
    assert.equal(state.activeProvider, "qq_music");
    assert.equal(state.openRequestId, null);
    assert.equal(state.lastOpenedRequestId, requestId);
    const opens = readCommands(api.paths).filter((entry) => entry.action === "open");
    assert.deepEqual(opens.map((entry) => entry.provider), ["spotify", "qq_music"]);
    assert(opens.every((entry) => entry.requestId === requestId && entry.generation === "session-1"));
    assert.match(api.output(), /"stage":"fallback_open_started"/);
    assert.match(api.output(), /"stage":"fallback_open_completed"/);
  } finally {
    await api.stop();
  }
}

async function testPrimaryAndFallbackFailureClearOpeningState() {
  const api = await startApi("fallback-fail");
  try {
    const requestId = "fallback-fail-request";
    const response = await postJson(api.port, "/api/v1/web-mode/actions", { type: "open", provider: "spotify", openRequestId: requestId });
    assert.equal(response.status, 400);
    const state = readState(api.paths);
    assert.equal(state.activeProvider, null);
    assert.equal(state.openingProvider, null);
    assert.equal(state.openRequestId, null);
    assert.equal(state.openStartedAt, null);
    assert.equal(state.openXSessionGeneration, null);
    const opens = readCommands(api.paths).filter((entry) => entry.action === "open");
    assert.deepEqual(opens.map((entry) => entry.provider), ["spotify", "qq_music"]);
    assert(opens.every((entry) => entry.requestId === requestId && entry.generation === "session-1"));
    assert.match(api.output(), /"stage":"fallback_open_started"/);
    assert.match(api.output(), /"stage":"fallback_open_failed"/);
    assert.doesNotMatch(api.output(), /"stage":"fallback_open_completed"/);
  } finally {
    await api.stop();
  }
}

async function testStaleSessionStopsFallback() {
  const api = await startApi("stale");
  try {
    const response = await postJson(api.port, "/api/v1/web-mode/actions", { type: "open", provider: "spotify", openRequestId: "stale-request" });
    assert.equal(response.status, 400);
    assert.match(response.body.message, /stale X session/i);
    const state = readState(api.paths);
    assert.equal(state.activeProvider, null);
    assert.equal(state.openingProvider, null);
    assert.equal(state.openRequestId, null);
    assert.deepEqual(readCommands(api.paths).filter((entry) => entry.action === "open").map((entry) => entry.provider), ["spotify"]);
    assert.match(api.output(), /"stage":"request_invalidated"/);
    assert.match(api.output(), /"reason":"stale-session"/);
    assert.match(api.output(), /"stage":"fallback_blocked"/);
  } finally {
    await api.stop();
  }
}

async function testSupersededRequestCannotOverwriteNewRequest() {
  const api = await startApi("supersede");
  try {
    const oldPromise = postJson(api.port, "/api/v1/web-mode/actions", { type: "open", provider: "spotify", openRequestId: "old-request" });
    await waitFor(() => {
      const commands = readCommands(api.paths);
      return commands.some((entry) => entry.action === "open" && entry.requestId === "old-request");
    }, "old open command did not start");
    const newResponse = await postJson(api.port, "/api/v1/web-mode/actions", { type: "open", provider: "qq_music", openRequestId: "new-request" });
    const oldResponse = await oldPromise;
    assert.equal(newResponse.status, 200);
    assert.equal(oldResponse.status, 400);
    const state = readState(api.paths);
    assert.equal(state.activeProvider, "qq_music");
    assert.equal(state.lastOpenedRequestId, "new-request");
    assert.equal(state.openingProvider, null);
    assert.equal(state.openRequestId, null);
  } finally {
    await api.stop();
  }
}

async function testOldGenerationCannotClearReusedRequestIdentity() {
  const api = await startApi("generation-reuse");
  try {
    const requestId = "reused-request";
    const oldPromise = postJson(api.port, "/api/v1/web-mode/actions", { type: "open", provider: "spotify", openRequestId: requestId });
    await waitFor(() => {
      const commands = readCommands(api.paths);
      return commands.some((entry) => entry.action === "open" && entry.requestId === requestId);
    }, "old-generation open command did not start");

    writeFileSync(api.paths.generation, "session-2\n");
    const replacementState = {
      ...readState(api.paths),
      openingProvider: "spotify",
      openRequestId: requestId,
      openStartedAt: new Date().toISOString(),
      openXSessionGeneration: "session-2",
      lastError: null
    };
    const replacementPath = `${api.paths.state}.replacement`;
    writeFileSync(replacementPath, `${JSON.stringify(replacementState, null, 2)}\n`);
    renameSync(replacementPath, api.paths.state);

    const oldResponse = await oldPromise;
    assert.equal(oldResponse.status, 400);
    const state = readState(api.paths);
    assert.equal(state.openingProvider, "spotify");
    assert.equal(state.openRequestId, requestId);
    assert.equal(state.openXSessionGeneration, "session-2", "old-generation cleanup must preserve the new generation owner");
    assert.equal(state.lastError, null);
  } finally {
    await api.stop();
  }
}

async function testTimeoutClearsOpeningState() {
  const api = await startApi("timeout", { openTimeoutMs: 100 });
  try {
    const response = await postJson(api.port, "/api/v1/web-mode/actions", { type: "open", provider: "spotify", openRequestId: "timeout-request" });
    assert.equal(response.status, 400);
    const state = readState(api.paths);
    assert.equal(state.openingProvider, null);
    assert.equal(state.openRequestId, null);
    assert.equal(state.openStartedAt, null);
    assert.equal(state.openXSessionGeneration, null);
  } finally {
    await api.stop();
  }
}

await testVeilOwnership();
testCloseVeilMessageContract();
await testInitialOpeningAndWatchdogBypass();
await testStaleOpeningDoesNotBypassWatchdog();
await testFallbackCorrelation();
await testPrimaryAndFallbackFailureClearOpeningState();
await testStaleSessionStopsFallback();
await testSupersededRequestCannotOverwriteNewRequest();
await testOldGenerationCannotClearReusedRequestIdentity();
await testTimeoutClearsOpeningState();
console.log("Explore open lifecycle smoke passed");

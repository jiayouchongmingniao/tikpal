import { spawn } from "node:child_process";

const PORT = Number(process.env.TIKPAL_API_SMOKE_PORT ?? 18787);
const HOST = "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;
const SERVER_READY_TEXT = "tikpal-api mock listening";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  const body = await response.json();
  return { response, body };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const { response, body } = await request("/api/v1/health");
      if (response.ok && body.ok === true) return;
    } catch {
      // Server is still starting.
    }
    await wait(100);
  }
  throw new Error("API did not become healthy");
}

async function waitForOutput(text) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (outputBuffer.includes(text)) return;
    await wait(50);
  }
  throw new Error(`API did not print expected output: ${text}`);
}

let outputBuffer = "";

async function run() {
  const server = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      TIKPAL_API_HOST: HOST,
      TIKPAL_API_PORT: String(PORT)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  server.stdout.on("data", (chunk) => {
    outputBuffer += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    outputBuffer += chunk.toString();
  });

  try {
    await waitForHealth();
    await waitForOutput(SERVER_READY_TEXT);

    const initial = await request("/api/v1/system/state");
    assert(initial.response.ok, "system state should return 200");
    assert(initial.body.runtime.apiMode === "mock", "runtime should report mock API mode");
    assert(initial.body.playback.title, "playback title should be present");

    const next = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "next" })
    });
    assert(next.response.ok, "next action should return 200");
    assert(next.body.playback.currentTrackIndex === 2, "next action should advance the queue");

    const pause = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "play_pause" })
    });
    assert(pause.response.ok, "play_pause action should return 200");
    assert(pause.body.playback.state === "paused", "play_pause should pause active playback");

    const seek = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "seek", value: 123 })
    });
    assert(seek.response.ok, "seek action should return 200");
    assert(seek.body.playback.elapsedSeconds === 123, "seek action should set elapsed seconds");

    const volume = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "volume_set", value: 42 })
    });
    assert(volume.response.ok, "volume_set action should return 200");
    assert(volume.body.system.volume.percent === 42, "volume_set should update volume percent");

    const libraryScan = await request("/api/v1/system/actions", {
      method: "POST",
      body: JSON.stringify({ type: "library_scan" })
    });
    assert(libraryScan.response.ok, "library_scan action should return 200");
    assert(libraryScan.body.system.library.lastScan, "library_scan should return updated system state");

    const invalid = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "volume_set", value: 180 })
    });
    assert(invalid.response.status === 400, "invalid volume should return 400");
    assert(invalid.body.error === "BAD_REQUEST", "invalid action should return BAD_REQUEST");

    const invalidSystemAction = await request("/api/v1/system/actions", {
      method: "POST",
      body: JSON.stringify({ type: "factory_reset" })
    });
    assert(invalidSystemAction.response.status === 400, "invalid system action should return 400");
    assert(invalidSystemAction.body.error === "BAD_REQUEST", "invalid system action should return BAD_REQUEST");

    console.log("api smoke passed");
  } finally {
    server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

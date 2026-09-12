import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { resolve } from "node:path";

const HOST = "127.0.0.1";
const PORT = Number(process.env.TIKPAL_ROOM_SCENE_HANDOFF_SMOKE_PORT ?? 18804);
const BASE_URL = `http://${HOST}:${PORT}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function request(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {})
    }
  });
  return { response, body: await response.json() };
}

async function waitForHealth() {
  let lastError = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const health = await request("/api/v1/health");
      if (health.response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await wait(50);
  }
  throw lastError ?? new Error("Tikpal API did not become healthy");
}

async function handoffIsCleared(handoffPath) {
  return await readFile(handoffPath, "utf8").then(() => false).catch(() => true);
}

async function run() {
  const workspace = await mkdtemp(path.join(tmpdir(), "tikpal-room-scene-handoff-"));
  const roomStatePath = path.join(workspace, "room-experience.json");
  const handoffPath = path.join(workspace, "room-scene-audio-handoff.json");
  const musicStatePath = path.join(workspace, "music-library.json");
  const sourceMemoryPath = path.join(workspace, "audio-source-memory.json");
  const webModeStatePath = path.join(workspace, "web-mode-state.json");
  const webModeHandoffPath = path.join(workspace, "web-mode-handoff.json");
  await writeFile(roomStatePath, `${JSON.stringify({ mode: "calm", sceneVideoId: "rainy-window", sceneSoundEnabled: false }, null, 2)}\n`);

  const server = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      TIKPAL_API_HOST: HOST,
      TIKPAL_API_PORT: String(PORT),
      TIKPAL_PLAYER_BACKEND: "mock",
      TIKPAL_PUBLIC_ASSETS_ROOT: resolve(process.cwd(), "public", "assets"),
      TIKPAL_ROOM_EXPERIENCE_STATE_PATH: roomStatePath,
      TIKPAL_ROOM_SCENE_AUDIO_HANDOFF_STATE_PATH: handoffPath,
      TIKPAL_MUSIC_LIBRARY_STATE_PATH: musicStatePath,
      TIKPAL_AUDIO_SOURCE_MEMORY_STATE_PATH: sourceMemoryPath,
      TIKPAL_WEB_MODE_STATE_PATH: webModeStatePath,
      TIKPAL_WEB_MODE_HANDOFF_STATE_PATH: webModeHandoffPath
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let serverStderr = "";
  server.stderr.on("data", (chunk) => {
    serverStderr += chunk.toString();
  });

  try {
    await waitForHealth();
    const library = await request("/api/v1/audio/library?storage=local&limit=1");
    const localTrackPath = library.body.tracks?.[0]?.path;
    assert(library.response.ok && localTrackPath, "fixture must expose a local Library track");

    const libraryStart = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "mpd", localTrackPath })
    });
    assert(libraryStart.body.playback.state === "playing", "Library precondition must be playing");
    const libraryScene = await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_scene", sceneVideoId: "rainy-window", sceneSoundEnabled: true })
    });
    assert(libraryScene.response.ok && libraryScene.body.sceneSoundEnabled === true, `scene selection must enable environment audio: ${JSON.stringify(libraryScene.body)}`);
    const librarySceneState = await request("/api/v1/system/state");
    assert(librarySceneState.body.playback.source === "scene" && librarySceneState.body.playback.state === "playing", "scene selection must take exclusive playback ownership");
    const libraryHandoff = JSON.parse(await readFile(handoffPath, "utf8"));
    assert(libraryHandoff.target === "mpd" && libraryHandoff.localTrackPath === localTrackPath && libraryHandoff.wasPlaying === true, "scene must save the active Library track separately");

    const libraryHifi = await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_mode", mode: "hifi" })
    });
    assert(libraryHifi.response.ok, "Hi-Fi must accept a Library scene handoff");
    const restoredLibrary = await request("/api/v1/system/state");
    assert(restoredLibrary.body.playback.source === "mpd" && restoredLibrary.body.playback.state === "playing", "Hi-Fi must resume the saved Library track");
    assert(await handoffIsCleared(handoffPath), "Hi-Fi must consume the Library handoff");

    const radioStart = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "radio", radioStationId: "radio-510" })
    });
    assert(radioStart.response.ok && radioStart.body.playback.source === "radio", "Radio precondition must start");
    const pausedRadio = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "pause" })
    });
    assert(pausedRadio.body.playback.state === "paused", `Radio precondition must pause: ${JSON.stringify(pausedRadio.body.playback)}`);
    await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_mode", mode: "calm" })
    });
    const radioScene = await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_scene", sceneVideoId: "rainy-window", sceneSoundEnabled: true })
    });
    assert(radioScene.response.ok, "scene selection must accept a paused Radio handoff");
    const radioHandoff = JSON.parse(await readFile(handoffPath, "utf8"));
    assert(radioHandoff.target === "radio" && radioHandoff.radioStationId === "radio-510" && radioHandoff.wasPlaying === false, "scene must save the paused Radio state");
    await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_mode", mode: "hifi" })
    });
    const restoredRadio = await request("/api/v1/system/state");
    assert(restoredRadio.body.playback.source === "radio" && restoredRadio.body.audio.currentSource.radioStationId === "radio-510" && restoredRadio.body.playback.state === "paused", "Hi-Fi must restore a paused Radio without starting it");

    await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_mode", mode: "calm" })
    });
    await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_scene", sceneVideoId: "rainy-window", sceneSoundEnabled: true })
    });
    const stopScene = await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_scene_sound", sceneSoundEnabled: false })
    });
    assert(stopScene.response.ok && stopScene.body.sceneSoundEnabled === false, "manual Scene Sound stop must persist off");
    const stoppedSceneState = await request("/api/v1/system/state");
    assert(stoppedSceneState.body.playback.source === "scene" && stoppedSceneState.body.playback.state === "stopped", "manual Scene Sound stop must remain silent instead of restoring Radio");
    assert(await handoffIsCleared(handoffPath), "manual Scene Sound stop must clear its handoff");

    await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "airplay" })
    });
    const externalScene = await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_scene", sceneVideoId: "rainy-window", sceneSoundEnabled: true })
    });
    assert(externalScene.response.ok, "scene selection must replace an external source");
    assert(await handoffIsCleared(handoffPath), "scene must not save an external-source handoff");
    await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_mode", mode: "hifi" })
    });
    const externalHifiState = await request("/api/v1/system/state");
    assert(externalHifiState.body.playback.source === "scene" && externalHifiState.body.playback.state === "stopped", "Hi-Fi must not reconnect AirPlay after Scene Sound");

    console.log("Room scene audio handoff smoke passed");
  } catch (error) {
    const detail = serverStderr.trim();
    throw new Error(`${error instanceof Error ? error.message : error}${detail ? `\nServer stderr:\n${detail}` : ""}`);
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGTERM");
      await Promise.race([new Promise((resolveExit) => server.once("exit", resolveExit)), wait(1000)]);
    }
    await rm(workspace, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});

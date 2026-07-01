import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path, { resolve } from "node:path";
import { getTikpalApiAccessDecision, getTikpalWebProxyApiAccessDecision, hasValidTikpalKey } from "../server/accessControl.mjs";

const PORT = Number(process.env.TIKPAL_API_SMOKE_PORT ?? 18787);
const HOST = "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;
const PORTABLE_API_KEY = "api-smoke-portable-key";
const SERVER_READY_TEXT = "tikpal-api mock listening";
const PROVIDER_PORT = Number(process.env.TIKPAL_PROVIDER_SMOKE_PORT ?? 18788);
const PROVIDER_URL = `http://${HOST}:${PROVIDER_PORT}`;
const BLUETOOTH_SCENARIO_PATH = resolve(process.cwd(), ".tmp-api-smoke-bluetooth.txt");
const BLUETOOTH_METADATA_PATH = resolve(process.cwd(), ".tmp-api-smoke-bluetooth-metadata.txt");

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

async function requestFrom(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
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

async function requestBinary(path) {
  return await requestBinaryFrom(BASE_URL, path);
}

async function requestBinaryFrom(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  const body = Buffer.from(await response.arrayBuffer());
  return { response, body };
}

async function requestText(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Accept: "text/html,application/json",
      ...options.headers
    }
  });
  const body = await response.text();
  return { response, body };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function localTrackPathFromMpcFile(file) {
  return String(file ?? "").replace(/^Codex\//, "");
}

function formatMoodeEventTimestamp(epochSeconds) {
  const date = new Date(epochSeconds * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("") + ` ${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function parseKeyValueOutput(output) {
  const fields = new Map();
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    fields.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return fields;
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function runAccessControlHelperSmoke() {
  assert(
    getTikpalApiAccessDecision({
      method: "GET",
      pathname: "/api/v1/remote/state",
      remoteAddress: "192.168.10.44",
      portableApiKey: PORTABLE_API_KEY
    }).allowed === true,
    "external portable remote safe reads should be allowed"
  );
  assert(
    getTikpalApiAccessDecision({
      method: "POST",
      pathname: "/api/v1/playback/actions",
      remoteAddress: "192.168.10.44",
      portableApiKey: PORTABLE_API_KEY
    }).allowed === false,
    "external legacy writes should be blocked"
  );
  assert(
    getTikpalApiAccessDecision({
      method: "POST",
      pathname: "/api/v1/remote/actions",
      headers: { "x-tikpal-key": "wrong" },
      remoteAddress: "192.168.10.44",
      portableApiKey: PORTABLE_API_KEY
    }).allowed === false,
    "external remote writes should reject wrong keys"
  );
  assert(
    getTikpalApiAccessDecision({
      method: "POST",
      pathname: "/api/v1/remote/actions",
      headers: { "x-tikpal-key": PORTABLE_API_KEY },
      remoteAddress: "192.168.10.44",
      portableApiKey: PORTABLE_API_KEY
    }).allowed === true,
    "external keyed remote writes should be allowed"
  );
  assert(
    getTikpalApiAccessDecision({
      method: "POST",
      pathname: "/api/v1/system/actions",
      remoteAddress: "::ffff:127.0.0.1",
      portableApiKey: PORTABLE_API_KEY
    }).allowed === true,
    "loopback kiosk UI writes should stay allowed"
  );
  assert(
    getTikpalApiAccessDecision({
      method: "POST",
      pathname: "/api/v1/audio/source",
      remoteAddress: "192.168.10.44",
      portableApiKey: PORTABLE_API_KEY
    }).allowed === false,
    "direct 8787 remote access should keep blocking full kiosk writes"
  );
  assert(
    getTikpalApiAccessDecision({
      method: "GET",
      pathname: "/api/v1/kiosk/heartbeat",
      remoteAddress: "192.168.10.44",
      portableApiKey: PORTABLE_API_KEY
    }).allowed === false,
    "direct 8787 remote access should block kiosk heartbeat reads"
  );
  assert(
    getTikpalApiAccessDecision({
      method: "POST",
      pathname: "/api/v1/kiosk/heartbeat",
      remoteAddress: "192.168.10.44",
      portableApiKey: PORTABLE_API_KEY
    }).allowed === false,
    "direct 8787 remote access should block kiosk heartbeat writes"
  );
  assert(
    getTikpalApiAccessDecision({
      method: "POST",
      pathname: "/api/v1/kiosk/heartbeat",
      remoteAddress: "::ffff:127.0.0.1",
      portableApiKey: PORTABLE_API_KEY
    }).allowed === true,
    "loopback kiosk heartbeat writes should stay allowed"
  );
  assert(
    getTikpalWebProxyApiAccessDecision({
      method: "POST",
      pathname: "/api/v1/audio/source",
      remoteAddress: "192.168.10.44",
      portableApiKey: PORTABLE_API_KEY,
      allowRemoteUiApi: "0"
    }).allowed === false,
    "web proxy should reuse portable remote limits until remote UI API is enabled"
  );
  assert(
    getTikpalWebProxyApiAccessDecision({
      method: "GET",
      pathname: "/api/v1/kiosk/heartbeat",
      remoteAddress: "192.168.10.44",
      portableApiKey: PORTABLE_API_KEY,
      allowRemoteUiApi: "0"
    }).allowed === false,
    "web proxy should not expose kiosk heartbeat to portable clients"
  );
  assert(
    getTikpalWebProxyApiAccessDecision({
      method: "POST",
      pathname: "/api/v1/audio/source",
      remoteAddress: "192.168.10.44",
      portableApiKey: PORTABLE_API_KEY,
      allowRemoteUiApi: "1"
    }).reason === "web_remote_ui",
    "web proxy should allow full kiosk API when TIKPAL_WEB_ALLOW_REMOTE_UI_API=1"
  );
  assert(
    hasValidTikpalKey({ "x-tikpal-key": PORTABLE_API_KEY }, PORTABLE_API_KEY) === true,
    "X-Tikpal-Key helper should accept the configured key"
  );
  assert(
    hasValidTikpalKey({ "x-tikpal-key": PORTABLE_API_KEY }, "") === false,
    "X-Tikpal-Key helper should reject writes when no device key is configured"
  );
}

async function runAirplayMetadataHelperClockSmoke() {
  const workspace = await mkdtemp(path.join(tmpdir(), "tikpal-airplay-helper-"));
  const metadataJsonPath = path.join(workspace, "aplmeta.json");
  const metadataTxtPath = path.join(workspace, "missing-aplmeta.txt");
  const eventLogPath = path.join(workspace, "moode_spsevent.log");
  const clockStatePath = path.join(workspace, "clock-state");
  const eventSeconds = Math.floor(Date.now() / 1000) - 12;
  const metadataSeconds = eventSeconds + 6;
  const eventStamp = formatMoodeEventTimestamp(eventSeconds);

  try {
    await writeFile(
      eventLogPath,
      [
        `${eventStamp} Event: Run spspre.sh`,
        `${eventStamp} Event: Run spspost.sh`
      ].join("\n") + "\n"
    );
    await writeFile(
      metadataJsonPath,
      `${JSON.stringify({
        fecmd: "update_aplmeta",
        title: "Same Second Clock",
        artist: "AirPlay Tester",
        album: "Helper Smoke",
        duration: "188000",
        sformat: "AAC 24/48K 2ch"
      })}\n`
    );
    await utimes(metadataJsonPath, metadataSeconds, metadataSeconds);

    const result = await runProcess("sh", ["deploy/moode/tikpal-airplay-metadata.sh"], {
      env: {
        ...process.env,
        TIKPAL_AIRPLAY_EVENT_LOG: eventLogPath,
        TIKPAL_AIRPLAY_METADATA_FILE: metadataTxtPath,
        TIKPAL_AIRPLAY_METADATA_JSON_FILE: metadataJsonPath,
        TIKPAL_AIRPLAY_CLOCK_STATE_FILE: clockStatePath,
        TIKPAL_AIRPLAY_MPRIS_SERVICE: "org.invalid.ShairportSync",
        TIKPAL_AIRPLAY_METADATA_CLOCK_LEAD_MS: "1000"
      }
    });

    assert(result.code === 0, `AirPlay metadata helper should read fresh same-second metadata, stderr: ${result.stderr}`);
    const fields = parseKeyValueOutput(result.stdout);
    assert(fields.get("title") === "Same Second Clock", "AirPlay helper should output fresh metadata title");
    assert(fields.get("artist") === "AirPlay Tester", "AirPlay helper should output fresh metadata artist");
    assert(fields.get("metadataSource") === "json", "AirPlay helper should use json fallback in the smoke");
    assert(fields.get("clockStartReason") === "metadata_mtime", "AirPlay helper should use metadata mtime when events start/stop in the same second");
    assert(Number(fields.get("clockStartMs")) === metadataSeconds * 1000, "AirPlay helper should anchor the clock to metadata mtime");
    assert(Number(fields.get("positionMs")) > 0, "AirPlay helper should emit a positive inferred position");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function localMinutesForTimeZone(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function withinNightWindow(minutes, start = "22:30", end = "06:30") {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;
  return minutes >= startMinutes || minutes < endMinutes;
}

function findCurrentNightTimeZone() {
  const candidates = typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : ["Asia/Shanghai", "America/Los_Angeles", "America/New_York", "Europe/London", "Pacific/Honolulu", "Pacific/Kiritimati"];
  return candidates.find((timeZone) => withinNightWindow(localMinutesForTimeZone(timeZone))) ?? "UTC";
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

async function waitForHealthAt(baseUrl) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const { response, body } = await requestFrom(baseUrl, "/api/v1/health");
      if (response.ok && body.ok === true) return;
    } catch {
      // Server is still starting.
    }
    await wait(100);
  }
  throw new Error(`API did not become healthy at ${baseUrl}`);
}

async function waitForOutput(text) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (outputBuffer.includes(text)) return;
    await wait(50);
  }
  throw new Error(`API did not print expected output: ${text}`);
}

let outputBuffer = "";

function mpcFocusedSmokeEnv(overrides = {}) {
  return {
    ...process.env,
    ...overrides,
    TIKPAL_STARTUP_SCENE_SOUND_ENABLED: "0"
  };
}

function sendProviderJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function createProviderServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", PROVIDER_URL);

    if (request.method === "GET" && url.pathname === "/geo") {
      sendProviderJson(response, 200, {
        city: "Shanghai",
        region: "Shanghai",
        country_code: "CN",
        timezone: "Asia/Shanghai",
        latitude: 31.2304,
        longitude: 121.4737
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/forecast") {
      sendProviderJson(response, 200, {
        current: {
          weather_code: 61,
          precipitation: 1.2,
          rain: 1.2,
          showers: 0,
          snowfall: 0
        }
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/search") {
      const track = url.searchParams.get("track_name");

      if (track === "This City") {
        sendProviderJson(response, 200, [
          {
            trackName: track,
            artistName: "Wrong Singer",
            albumName: "Wrong Album",
            duration: 60,
            syncedLyrics: "[00:05.00]Wrong city in the wrong song",
            plainLyrics: "Wrong city in the wrong song"
          },
          {
            trackName: track,
            artistName: "Sam Fischer",
            albumName: "Not a Hobby",
            duration: 60,
            syncedLyrics: "[00:05.00]I've been seeing lonely people in crowded rooms\n[00:21.00]Covering their old heartbreaks with new tattoos\n[00:42.00]It's all about smoke screens and cigarettes\n[01:14.00]This city is gonna break my heart\n[01:46.00]This city is gonna love me then leave me alone",
            plainLyrics: "I've been seeing lonely people in crowded rooms\nCovering their old heartbreaks with new tattoos\nIt's all about smoke screens and cigarettes\nThis city is gonna break my heart"
          }
        ]);
        return;
      }

      if (track === "Duration Drift") {
        sendProviderJson(response, 200, [
          {
            trackName: track,
            artistName: "Clock Source",
            albumName: "Unreliable Metadata",
            duration: 245,
            syncedLyrics: "[00:05.00]AirPlay said this song was short\n[01:20.00]The provider still has the real lyric clock\n[03:40.00]Keep the correct title and artist alive",
            plainLyrics: "AirPlay said this song was short\nThe provider still has the real lyric clock\nKeep the correct title and artist alive"
          }
        ]);
        return;
      }

      sendProviderJson(response, 404, { error: "not found" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/get") {
      const track = url.searchParams.get("track_name");
      const duration = Number(url.searchParams.get("duration"));

      if (Number.isFinite(duration) && duration > 1000) {
        sendProviderJson(response, 400, { error: "duration should be seconds" });
        return;
      }

      if (track === "Get Lucky (feat. Pharrell Williams)") {
        sendProviderJson(response, 200, {
          trackName: track,
          artistName: "Daft Punk",
          albumName: "Random Access Memories",
          syncedLyrics: "[00:12.00]Like the legend of the phoenix\n[00:18.00]All ends with beginnings\n[00:23.50]What keeps the planet spinning",
          plainLyrics: "Like the legend of the phoenix\nAll ends with beginnings"
        });
        return;
      }

      if (track === "Instant Crush") {
        sendProviderJson(response, 200, {
          trackName: track,
          artistName: "Daft Punk",
          albumName: "Random Access Memories",
          duration: 337,
          syncedLyrics: null,
          plainLyrics: "I didn't want to be the one to forget\n\nI thought of everything I'd never regret"
        });
        return;
      }

      if (track === "Duration Drift") {
        sendProviderJson(response, 404, { error: "not found" });
        return;
      }

      if (track === "Lose Yourself to Dance") {
        sendProviderJson(response, 404, { error: "not found" });
        return;
      }

      if (track === "A.M. Ambient" || track === "Tikpal Calm - Radio Paradise Mellow") {
        sendProviderJson(response, 200, {
          trackName: track,
          artistName: "Internet Radio",
          albumName: "Radio",
          syncedLyrics: null,
          plainLyrics: "Midnight radio glow\nA softer room begins"
        });
        return;
      }

      sendProviderJson(response, 404, { error: "not found" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/json/123/searchalbum.php") {
      sendProviderJson(response, 200, { album: [] });
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/identify") {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (body.includes("BT_SUCCESS")) {
          sendProviderJson(response, 200, {
            status: { code: 0, msg: "Success" },
            metadata: {
              music: [
                {
                  title: "Get Lucky (feat. Pharrell Williams)",
                  artists: [{ name: "Daft Punk" }],
                  album: { name: "Random Access Memories" },
                  score: 98
                }
              ]
            }
          });
          return;
        }

        if (body.includes("BT_NOT_FOUND")) {
          sendProviderJson(response, 200, {
            status: { code: 3003, msg: "No result" }
          });
          return;
        }

        if (body.includes("BT_ERROR")) {
          sendProviderJson(response, 500, {
            status: { code: 5000, msg: "Mock provider failure" }
          });
          return;
        }

        sendProviderJson(response, 200, {
          status: { code: 3003, msg: "No result" }
        });
      });
      return;
    }

    sendProviderJson(response, 404, { error: "not found" });
  });
}

async function waitForLyricsStatus(expectedStatuses) {
  return await waitForLyricsStatusAt(BASE_URL, expectedStatuses);
}

async function waitForLyricsStatusAt(baseUrl, expectedStatuses) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { response, body } = await requestFrom(baseUrl, "/api/v1/lyrics/status");
    if (response.ok && expectedStatuses.includes(body.status)) {
      return body;
    }
    await wait(100);
  }
  throw new Error(`Lyrics state did not reach one of: ${expectedStatuses.join(", ")}`);
}

async function waitForLyricsTrackAt(baseUrl, { title, artist, statuses = ["ready"] }) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { response, body } = await requestFrom(baseUrl, "/api/v1/lyrics/status");
    if (
      response.ok
      && statuses.includes(body.status)
      && body.title === title
      && (artist === undefined || body.artist === artist)
    ) {
      return body;
    }
    await wait(100);
  }
  throw new Error(`Lyrics state did not reach ${title} by ${artist ?? "any artist"}`);
}

async function runMpcHifiCommandGuardSmoke(roomExperienceStatePath) {
  const port = PORT + 10;
  const baseUrl = `http://${HOST}:${port}`;
  const server = spawn(process.execPath, ["server/index.mjs"], {
    env: mpcFocusedSmokeEnv({
      TIKPAL_API_HOST: HOST,
      TIKPAL_API_PORT: String(port),
      TIKPAL_PLAYER_BACKEND: "mpc",
      TIKPAL_ROOM_EXPERIENCE_STATE_PATH: roomExperienceStatePath,
      TIKPAL_HIFI_EQ_APPLY_COMMAND: "",
      TIKPAL_HIFI_SPECTRUM_COMMAND: ""
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForHealthAt(baseUrl);
    const unsupported = await requestFrom(baseUrl, "/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_hifi_eq", hifiEqPresetId: "warm" })
    });
    assert(unsupported.response.status === 400, "mpc set_hifi_eq without command hook should return 400");
    assert(
      String(unsupported.body.message ?? "").includes("TIKPAL_HIFI_EQ_APPLY_COMMAND"),
      "mpc set_hifi_eq without command hook should explain the missing command"
    );
    const missingSpectrum = await requestFrom(baseUrl, "/api/v1/audio/spectrum");
    assert(missingSpectrum.response.status === 400, "mpc audio spectrum without command hook should return 400");
    assert(
      String(missingSpectrum.body.message ?? "").includes("TIKPAL_HIFI_SPECTRUM_COMMAND"),
      "mpc audio spectrum without command hook should explain the missing command"
    );
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => server.once("exit", resolve)),
        wait(1000)
      ]);
    }
  }
}

async function runHifiSpectrumCommandSmoke(roomExperienceStatePath) {
  const port = PORT + 11;
  const baseUrl = `http://${HOST}:${port}`;
  const spectrumFramePath = resolve(tmpdir(), `tikpal-spectrum-frame-${process.pid}.json`);
  await writeFile(spectrumFramePath, JSON.stringify({
    bands: Array.from({ length: 32 }, (_, index) => index / 31),
    peaks: { left: 0.25, right: 0.75 }
  }));
  const server = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      TIKPAL_API_HOST: HOST,
      TIKPAL_API_PORT: String(port),
      TIKPAL_PLAYER_BACKEND: "mock",
      TIKPAL_ROOM_EXPERIENCE_STATE_PATH: roomExperienceStatePath,
      TIKPAL_HIFI_SPECTRUM_COMMAND: `cat ${JSON.stringify(spectrumFramePath)}`
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForHealthAt(baseUrl);
    const spectrum = await requestFrom(baseUrl, "/api/v1/audio/spectrum");
    assert(spectrum.response.ok, "audio spectrum command hook should return 200");
    assert(spectrum.body.source === "command", "audio spectrum command hook should mark source as command");
    assert(spectrum.body.bands.length === 32, "audio spectrum command hook should expose 32 bands");
    assert(spectrum.body.bands[0] === 0, "audio spectrum command hook should preserve normalized low band");
    assert(spectrum.body.bands[31] === 1, "audio spectrum command hook should preserve normalized high band");
    assert(spectrum.body.peaks.left === 0.25, "audio spectrum command hook should preserve left peak");
    assert(spectrum.body.peaks.right === 0.75, "audio spectrum command hook should preserve right peak");
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => server.once("exit", resolve)),
        wait(1000)
      ]);
    }
    await rm(spectrumFramePath, { force: true });
  }
}

async function runMpcStartupSceneDefaultSmoke() {
  const port = PORT + 15;
  const baseUrl = `http://${HOST}:${port}`;
  const workspace = await mkdtemp(path.join(tmpdir(), "tikpal-mpc-startup-scene-"));
  const fakeMpcPath = path.join(workspace, "mpc-fake.mjs");
  const roomExperienceStatePath = path.join(workspace, "room-experience-state.json");

  await writeFile(fakeMpcPath, `#!/usr/bin/env node
const rawArgs = process.argv.slice(2);
const args = [];

for (let index = 0; index < rawArgs.length; index += 1) {
  if (rawArgs[index] === "--host" || rawArgs[index] === "--port" || rawArgs[index] === "--format") {
    index += 1;
    continue;
  }
  args.push(rawArgs[index]);
}

const command = args[0] ?? "";
switch (command) {
  case "status":
    process.stdout.write("volume:30%   repeat: off   random: off   single: off   consume: off\\n");
    break;
  case "stats":
    process.stdout.write("Artists: 0\\nAlbums: 0\\nSongs: 0\\nDB Updated: fake\\n");
    break;
  case "current":
  case "playlist":
  case "stop":
  default:
    break;
}
`);
  await chmod(fakeMpcPath, 0o755);
  await writeFile(
    roomExperienceStatePath,
    `${JSON.stringify({
      mode: "calm",
      phase: "idle",
      presetId: "calm-rain-room",
      sceneVideoId: "rainy-window",
      hifiEqPresetId: "flat",
      hifiVisualPresetId: "spectrum-bars",
      sceneSoundEnabled: false,
      playlistId: null,
      volumePercent: 38,
      brightnessPercent: 48,
      timerMinutes: 45,
      timerEndsAt: null,
      nightSchedule: {
        enabled: false,
        timeZone: "Asia/Shanghai",
        start: "22:30",
        end: "06:30",
        brightnessPercent: 5,
        active: false,
        preNightBrightnessPercent: null
      }
    }, null, 2)}\n`
  );

  const server = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      TIKPAL_API_HOST: HOST,
      TIKPAL_API_PORT: String(port),
      TIKPAL_PLAYER_BACKEND: "mpc",
      TIKPAL_MPC_BIN: fakeMpcPath,
      TIKPAL_MPD_HOST: "127.0.0.1",
      TIKPAL_MPD_PORT: "6600",
      TIKPAL_ROOM_EXPERIENCE_STATE_PATH: roomExperienceStatePath,
      TIKPAL_OUTPUT_VOLUME_GET_COMMAND: "",
      TIKPAL_RADIO_START_VERIFY_WINDOW_MS: "40",
      TIKPAL_RADIO_START_VERIFY_POLL_MS: "20",
      TIKPAL_RADIO_POST_START_SETTLE_MS: "20",
      TIKPAL_RADIO_POST_START_RECOVERY_PLAYS: "1",
      TIKPAL_RADIO_SWITCH_RETRY_DELAYS_MS: "20,20,20",
      TIKPAL_STARTUP_SCENE_SOUND_ENABLED: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForHealthAt(baseUrl);
    let startupSceneState = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const [state, experience] = await Promise.all([
        requestFrom(baseUrl, "/api/v1/system/state"),
        requestFrom(baseUrl, "/api/v1/experience/state")
      ]);
      if (
        state.response.ok
        && experience.response.ok
        && state.body.audio.currentSource.id === "scene"
        && state.body.playback.source === "scene"
        && experience.body.sceneSoundEnabled === true
      ) {
        startupSceneState = { state, experience };
        break;
      }
      await wait(200);
    }

    assert(startupSceneState, "mpc startup should keep product default Scene Sound enabled");
    assert(
      startupSceneState.state.body.playback.title === "Scene Audio",
      "mpc startup scene should expose Scene Audio playback"
    );
    assert(
      startupSceneState.experience.body.sceneVideoId === "rainy-window",
      "mpc startup scene should keep the calm room scene video"
    );
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => server.once("exit", resolve)),
        wait(1000)
      ]);
    }
    await rm(workspace, { recursive: true, force: true });
  }
}

async function runMpcLocalLibraryPathSmoke(roomExperienceStatePath) {
  const port = PORT + 12;
  const baseUrl = `http://${HOST}:${port}`;
  const workspace = await mkdtemp(path.join(tmpdir(), "tikpal-mpc-library-"));
  const fakeMpcPath = path.join(workspace, "mpc-fake.mjs");
  const fakeMpcLogPath = path.join(workspace, "mpc.log");
  const fakeMpcStatePath = path.join(workspace, "mpc-state.json");
  const fakeAudioSourceMemoryStatePath = path.join(workspace, "audio-source-memory.json");
  const fakeMpcTracks = [
    "Codex/Focus/Lo-fi Ambient/FASSounds - Good Night - Lofi Cozy Chill Music - 02m27s - Lo-fi.mp3",
    "Codex/Focus/Lo-fi Ambient/FASSounds - Lofi Study - Calm Peaceful Chill Hop - 02m27s - Lo-fi.mp3",
    "Codex/Focus/Lo-fi Ambient/AtlasAudio - Ambient Soundscapes - 04m56s - Ambient.mp3"
  ];

  await writeFile(fakeMpcPath, `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const logPath = process.env.TIKPAL_FAKE_MPC_LOG;
const statePath = process.env.TIKPAL_FAKE_MPC_STATE;
const libraryTracks = JSON.parse(process.env.TIKPAL_FAKE_MPC_TRACKS ?? "[]");
const positionalPlayStaysPaused = process.env.TIKPAL_FAKE_MPC_POSITIONAL_PLAY_STAYS_PAUSED === "1";
const rawArgs = process.argv.slice(2);
const args = [];

for (let index = 0; index < rawArgs.length; index += 1) {
  if (rawArgs[index] === "--host" || rawArgs[index] === "--port" || rawArgs[index] === "--format") {
    index += 1;
    continue;
  }
  args.push(rawArgs[index]);
}

function readState() {
  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return { queue: [], current: 0, state: "stopped", volume: 30 };
  }
}

function writeState(state) {
  writeFileSync(statePath, JSON.stringify(state));
}

function output(text) {
  process.stdout.write(text);
}

function fail(message) {
  process.stderr.write(message + "\\n");
  process.exit(1);
}

if (logPath) appendFileSync(logPath, args.join("\\t") + "\\n");

const [command, ...rest] = args;
const state = readState();

switch (command) {
  case "listall": {
    const target = rest[0] ?? "";
    if (target === "Codex") output(libraryTracks.join("\\n") + "\\n");
    else if (libraryTracks.includes(target)) output(target + "\\n");
    else fail("MPD error: No such directory");
    break;
  }
  case "clear":
    state.queue = [];
    state.current = 0;
    state.state = "stopped";
    writeState(state);
    break;
  case "add": {
    const target = rest[0] ?? "";
    if (target === "Codex") state.queue.push(...libraryTracks);
    else if (libraryTracks.includes(target)) state.queue.push(target);
    else fail("MPD error: No such song");
    writeState(state);
    break;
  }
  case "next":
    state.current = Math.min(state.queue.length - 1, state.current + 1);
    writeState(state);
    break;
  case "prev":
    state.current = Math.max(0, state.current - 1);
    writeState(state);
    break;
  case "play":
    if (rest[0]) state.current = Math.max(0, Number(rest[0]) - 1);
    state.state = positionalPlayStaysPaused && rest[0] ? "paused" : "playing";
    writeState(state);
    break;
  case "current": {
    const file = state.queue[state.current] ?? "";
    if (file) output("Fake Title\\tFake Artist\\tFake Album\\t" + file + "\\t02:27\\n");
    break;
  }
  case "status":
    if (state.queue.length > 0) {
      output("[" + state.state + "] #" + (state.current + 1) + "/" + state.queue.length + " 0:01/2:27 (0%)\\n");
    }
    output("volume:" + state.volume + "%   repeat: off   random: off   single: off   consume: off\\n");
    break;
  case "stats":
    output("Artists: 1\\nAlbums: 1\\nSongs: " + state.queue.length + "\\nDB Updated: fake\\n");
    break;
  case "playlist":
    output(state.queue.map((file, index) => index + "\\tFake Title\\tFake Artist\\tFake Album\\t02:27\\t" + file).join("\\n"));
    if (state.queue.length > 0) output("\\n");
    break;
  case "volume":
    if (rest[0]) {
      state.volume = Number(rest[0]);
      writeState(state);
    }
    break;
  case "pause":
    state.state = "paused";
    writeState(state);
    break;
  case "random":
  case "repeat":
  case "single":
    break;
  default:
    break;
}
`);
  await chmod(fakeMpcPath, 0o755);
  await writeFile(fakeMpcLogPath, "");

  const server = spawn(process.execPath, ["server/index.mjs"], {
    env: mpcFocusedSmokeEnv({
      TIKPAL_API_HOST: HOST,
      TIKPAL_API_PORT: String(port),
      TIKPAL_PLAYER_BACKEND: "mpc",
      TIKPAL_MPC_BIN: fakeMpcPath,
      TIKPAL_MPD_HOST: "127.0.0.1",
      TIKPAL_MPD_PORT: "6600",
      TIKPAL_MPD_DEFAULT_QUEUE_PATH: "Codex",
      TIKPAL_OUTPUT_VOLUME_GET_COMMAND: "",
      TIKPAL_ROOM_EXPERIENCE_STATE_PATH: roomExperienceStatePath,
      TIKPAL_AUDIO_SOURCE_MEMORY_STATE_PATH: fakeAudioSourceMemoryStatePath,
      TIKPAL_FAKE_MPC_LOG: fakeMpcLogPath,
      TIKPAL_FAKE_MPC_STATE: fakeMpcStatePath,
      TIKPAL_FAKE_MPC_TRACKS: JSON.stringify(fakeMpcTracks),
      TIKPAL_FAKE_MPC_POSITIONAL_PLAY_STAYS_PAUSED: "1"
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForHealthAt(baseUrl);
    await writeFile(fakeMpcLogPath, "");

    const library = await requestFrom(baseUrl, "/api/v1/audio/library?storage=local&limit=1");
    assert(library.response.ok, "mpc local library path smoke should read the local library");
    const localTrackPath = library.body.tracks[0]?.path;
    assert(localTrackPath && !localTrackPath.startsWith("Codex/"), "local library should expose manifest-relative track paths");

    const staleLocalTrackPath = "Removed/Old Library Track.mp3";
    await writeFile(
      fakeAudioSourceMemoryStatePath,
      `${JSON.stringify({
        target: "radio",
        localTrackPath: staleLocalTrackPath,
        radioStationId: "radio-503",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }, null, 2)}\n`
    );
    const staleLibraryResume = await requestFrom(baseUrl, "/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "mpd" })
    });
    assert(staleLibraryResume.response.ok, "mpc Library resume with replaced-library stale memory should return 200");
    assert(
      staleLibraryResume.body.audio.rememberedSource?.localTrackPath !== staleLocalTrackPath,
      "mpc Library resume should not write back a local track path missing from the current library manifest"
    );

    const switched = await requestFrom(baseUrl, "/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "mpd", localTrackPath })
    });
    assert(switched.response.ok, "mpc local library source switch should return 200");
    assert(
      switched.body.playback.queueLength >= fakeMpcTracks.length,
      `mpc local library switch should load the library queue, got ${switched.body.playback.queueLength}`
    );
    const log = await readFile(fakeMpcLogPath, "utf8");
    assert(
      switched.body.playback.state === "playing",
      `mpc local library switch should force playback out of paused state, got ${switched.body.playback.state}; log: ${log}`
    );
    assert(log.includes("listall\tCodex"), "mpc local library switch should read the prefixed MPD library once");
    assert(log.includes("add\tCodex"), "mpc local library switch should add the prefixed MPD library as a queue");
    assert(log.includes("play\t1"), "mpc local library switch should start the requested MPD queue position");
    assert(log.includes("play\n"), "mpc local library switch should retry playback when MPD stayed paused");
    assert(!log.includes(`add\t${localTrackPath}\n`), "mpc local library switch should not add the raw manifest path first");
    assert(switched.body.audio.rememberedSource?.localTrackPath === localTrackPath, "mpc local library switch should remember the selected local track path");

    await requestFrom(baseUrl, "/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "pause" })
    });
    await writeFile(fakeMpcLogPath, "");
    const next = await requestFrom(baseUrl, "/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "next" })
    });
    assert(next.response.ok, "mpc local library next should return 200");
    assert(next.body.playback.state === "playing", "mpc local library next should resume playback when MPD stayed paused");
    assert(next.body.playback.currentTrackIndex === 2, "mpc local library next should advance within the loaded queue");
    assert(next.body.audio.rememberedSource?.localTrackPath === localTrackPathFromMpcFile(fakeMpcTracks[1]), "mpc local library next should remember the advanced local track");
    const nextLog = await readFile(fakeMpcLogPath, "utf8");
    assert(nextLog.includes("next"), "mpc local library next should issue next");
    assert(nextLog.includes("play"), "mpc local library next should explicitly resume MPD after advancing");

    await writeFile(fakeMpcLogPath, "");
    const previous = await requestFrom(baseUrl, "/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "previous" })
    });
    assert(previous.response.ok, "mpc local library previous should return 200");
    assert(previous.body.playback.currentTrackIndex === 1, "mpc local library previous should return to the first queue entry");
    assert(previous.body.audio.rememberedSource?.localTrackPath === localTrackPath, "mpc local library previous should remember the previous local track");
    const previousLog = await readFile(fakeMpcLogPath, "utf8");
    assert(previousLog.includes("prev"), "mpc local library previous should issue prev");
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => server.once("exit", resolve)),
        wait(1000)
      ]);
    }
    await rm(workspace, { recursive: true, force: true });
  }
}

async function runMpcCachedStateSmoke(roomExperienceStatePath) {
  const port = PORT + 13;
  const baseUrl = `http://${HOST}:${port}`;
  const workspace = await mkdtemp(path.join(tmpdir(), "tikpal-mpc-cached-state-"));
  const fakeMpcPath = path.join(workspace, "mpc-fake.mjs");
  const slowCommandPath = path.join(workspace, "slow-command.sh");

  await writeFile(fakeMpcPath, `#!/usr/bin/env node
const args = process.argv.slice(2);
while (args[0]?.startsWith("--")) {
  args.shift();
  if (args[0] && !args[0].startsWith("--")) args.shift();
}
const command = args[0];
function output(value) { process.stdout.write(value); }
switch (command) {
  case "current":
    output("Smoke Title\\tSmoke Artist\\tSmoke Album\\tCodex/Smoke.mp3\\t02:00\\n");
    break;
  case "status":
    output("[playing] #1/1 0:01/2:00 (0%)\\nvolume:50%   repeat: off   random: off   single: off   consume: off\\n");
    break;
  case "stats":
    output("Artists: 1\\nAlbums: 1\\nSongs: 1\\nDB Updated: fake\\n");
    break;
  case "playlist":
    output("0\\tSmoke Title\\tSmoke Artist\\tSmoke Album\\t02:00\\tCodex/Smoke.mp3\\n");
    break;
  case "outputs":
    output("Output 1 (ALSA default): enabled\\n");
    break;
  default:
    break;
}
`);
  await chmod(fakeMpcPath, 0o755);
  await writeFile(slowCommandPath, "#!/bin/sh\nsleep 4\necho 'slow command finished'\n");
  await chmod(slowCommandPath, 0o755);

  const server = spawn(process.execPath, ["server/index.mjs"], {
    env: mpcFocusedSmokeEnv({
      TIKPAL_API_HOST: HOST,
      TIKPAL_API_PORT: String(port),
      TIKPAL_PLAYER_BACKEND: "mpc",
      TIKPAL_MPC_BIN: fakeMpcPath,
      TIKPAL_MPD_HOST: "127.0.0.1",
      TIKPAL_MPD_PORT: "6600",
      TIKPAL_ROOM_EXPERIENCE_STATE_PATH: roomExperienceStatePath,
      TIKPAL_STATE_SNAPSHOT_REFRESH_MS: "60000",
      TIKPAL_DDCUTIL_BIN: slowCommandPath,
      TIKPAL_OUTPUT_VOLUME_GET_COMMAND: `${slowCommandPath} volume`,
      TIKPAL_AUDIO_ACTIVE_COMMAND: `${slowCommandPath} audio-active`,
      TIKPAL_SPOTIFY_ACTIVE_COMMAND: `${slowCommandPath} spotify-active`,
      TIKPAL_BLUETOOTH_ACTIVE_COMMAND: `${slowCommandPath} bluetooth-active`,
      TIKPAL_AIRPLAY_ACTIVE_COMMAND: `${slowCommandPath} airplay-active`,
      TIKPAL_AIRPLAY_RECEIVER_ACTIVE_COMMAND: `${slowCommandPath} airplay-receiver`,
      TIKPAL_UPNP_ACTIVE_COMMAND: `${slowCommandPath} upnp-active`
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForHealthAt(baseUrl);
    const startedAt = Date.now();
    const state = await requestFrom(baseUrl, "/api/v1/system/state");
    const elapsedMs = Date.now() - startedAt;
    assert(state.response.ok, "cached mpc state should return 200");
    assert(
      elapsedMs < 1000,
      `cached mpc state should not wait for slow system commands, took ${elapsedMs}ms`
    );
    assert(state.body.runtime.apiMode === "mpc", "cached mpc state should still report mpc mode");
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => server.once("exit", resolve)),
        wait(1000)
      ]);
    }
    await rm(workspace, { recursive: true, force: true });
  }
}

async function runMpcRadioPresetFastSnapshotSmoke(roomExperienceStatePath) {
  const port = PORT + 16;
  const baseUrl = `http://${HOST}:${port}`;
  const workspace = await mkdtemp(path.join(tmpdir(), "tikpal-mpc-radio-preset-"));
  const fakeMpcPath = path.join(workspace, "mpc-fake.mjs");
  const fakeKioskAudioReleasePath = path.join(workspace, "release-kiosk-audio.mjs");
  const fakeSqlitePath = path.join(workspace, "sqlite3");
  const fakeDdcutilPath = path.join(workspace, "ddcutil");
  const fakeMpcStatePath = path.join(workspace, "mpc-state.json");
  const fakeBrightnessStatePath = path.join(workspace, "brightness-state.txt");
  const fakeLogoDir = path.join(workspace, "radio-logos");
  const fakeAudioVolumeStatePath = path.join(workspace, "audio-volume-state.json");
  const fakeAudioSourceMemoryStatePath = path.join(workspace, "audio-source-memory.json");
  const radioUri = "http://radio.example/tikpal-calm";

  await writeFile(fakeMpcStatePath, JSON.stringify({
    currentFile: "Codex/Smoke.mp3",
    failedStreamUri: null,
    failDecodeAfterAddForUri: null,
    failDecodeAfterCurrentUri: null,
    failDecodeAfterStatusReads: 0,
    failDecodeOnAddForUri: null,
    playbackState: "playing",
    volume: 0,
    failNextAddForUri: radioUri,
    addFailures: 0,
    radioStartStatusFailures: 1,
    observations: []
  }));
  await mkdir(fakeLogoDir, { recursive: true });
  await writeFile(path.join(fakeLogoDir, "Tikpal Focus - Test Exact.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  await writeFile(path.join(fakeLogoDir, "FluxFM - Chillout Radio.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  await writeFile(fakeAudioVolumeStatePath, JSON.stringify({ version: 1, lastNonZeroPercent: 44, updatedAt: "2026-01-01T00:00:00.000Z" }));
  await writeFile(fakeBrightnessStatePath, "48\n");
  await writeFile(fakeMpcPath, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const statePath = ${JSON.stringify(fakeMpcStatePath)};
const roomStatePath = ${JSON.stringify(roomExperienceStatePath)};
function readState() {
  return JSON.parse(readFileSync(statePath, "utf8"));
}
function writeState(state) {
  writeFileSync(statePath, JSON.stringify(state));
}
function readRoomSceneSoundEnabled() {
  try {
    return JSON.parse(readFileSync(roomStatePath, "utf8")).sceneSoundEnabled === true;
  } catch {
    return null;
  }
}
function recordObservation(state, command) {
  return {
    ...state,
    observations: [
      ...(Array.isArray(state.observations) ? state.observations : []),
      { command, sceneSoundEnabled: readRoomSceneSoundEnabled() }
    ]
  };
}
const rawArgs = process.argv.slice(2);
const fileOnlyCurrent = rawArgs.includes("--format") && rawArgs[rawArgs.indexOf("--format") + 1] === "%file%";
const args = [];
for (let index = 0; index < rawArgs.length; index += 1) {
  if (rawArgs[index] === "--host" || rawArgs[index] === "--port" || rawArgs[index] === "--format") {
    index += 1;
    continue;
  }
  args.push(rawArgs[index]);
}
const command = args[0] ?? "";
const state = readState();
const statusFile = state.currentFile || state.failedStreamUri || "";
const isRadio = /^https?:\\/\\//i.test(statusFile);
switch (command) {
  case "listall":
    process.stdout.write("Codex/Smoke.mp3\\n");
    break;
  case "current":
    if (!state.currentFile) break;
    if (fileOnlyCurrent) {
      process.stdout.write(state.currentFile + "\\n");
      break;
    }
    process.stdout.write(isRadio
      ? "Tikpal Calm Test\\tInternet Radio\\tRadio\\t" + state.currentFile + "\\t0:00\\n"
      : "Smoke Title\\tSmoke Artist\\tSmoke Album\\t" + state.currentFile + "\\t02:00\\n");
    break;
  case "status":
    if (state.failedStreamUri) {
      process.stdout.write("volume:" + state.volume + "%   repeat: off   random: off   single: off   consume: off\\nERROR: Failed to decode \\"" + state.failedStreamUri + "\\"; Connection timed out after 10000 milliseconds: Timeout was reached\\n");
      break;
    }
    if (state.failDecodeAfterCurrentUri && state.currentFile === state.failDecodeAfterCurrentUri) {
      const remaining = Number(state.failDecodeAfterStatusReads ?? 0);
      if (remaining <= 0) {
        writeState(recordObservation({
          ...state,
          currentFile: "",
          failedStreamUri: state.failDecodeAfterCurrentUri,
          playbackState: "stopped"
        }, "status-stream-failed"));
        process.stdout.write("volume:" + state.volume + "%   repeat: off   random: off   single: off   consume: off\\nERROR: Failed to decode \\"" + state.failDecodeAfterCurrentUri + "\\"; Connection timed out after 10000 milliseconds: Timeout was reached\\n");
        break;
      }
      writeState(recordObservation({
        ...state,
        failDecodeAfterStatusReads: remaining - 1,
        playbackState: "playing"
      }, "status-stream-pending"));
      process.stdout.write("[playing] #1/1 0:01/0:00 (0%)\\nvolume:" + state.volume + "%   repeat: off   random: off   single: off   consume: off\\n");
      break;
    }
    if (isRadio && Number(state.radioStartStatusFailures ?? 0) > 0) {
      writeState(recordObservation({
        ...state,
        radioStartStatusFailures: Number(state.radioStartStatusFailures ?? 0) - 1,
        playbackState: "paused"
      }, "status-busy"));
      process.stdout.write("[" + "paused" + "] #1/1 0:00/" + "0:00" + " (0%)\\nvolume:" + state.volume + "%   repeat: off   random: off   single: off   consume: off\\nERROR: Failed to open \\"ALSA Default\\" (alsa); Failed to open ALSA device \\"_audioout\\": Device or resource busy\\n");
      break;
    }
    process.stdout.write("[" + state.playbackState + "] #1/1 0:01/" + (isRadio ? "0:00" : "2:00") + " (0%)\\nvolume:" + state.volume + "%   repeat: off   random: off   single: off   consume: off\\n");
    break;
  case "stats":
    process.stdout.write("Artists: 1\\nAlbums: 1\\nSongs: 1\\nDB Updated: fake\\n");
    break;
  case "playlist":
    if (state.currentFile) process.stdout.write("0\\tTikpal Calm Test\\tInternet Radio\\tRadio\\t0:00\\t" + state.currentFile + "\\n");
    break;
  case "clear":
    writeState(recordObservation({ ...state, currentFile: "", failedStreamUri: null }, "clear"));
    break;
  case "add":
    if (state.failDecodeOnAddForUri && state.failDecodeOnAddForUri === args[1]) {
      writeState(recordObservation({
        ...state,
        currentFile: "",
        failedStreamUri: args[1],
        playbackState: "stopped",
        addFailures: Number(state.addFailures ?? 0) + 1
      }, "add-failed-stream"));
      break;
    }
    if (state.failNextAddForUri && state.failNextAddForUri === args[1]) {
      writeState(recordObservation({
        ...state,
        failNextAddForUri: null,
        addFailures: Number(state.addFailures ?? 0) + 1
      }, "add-failed"));
      process.stderr.write("Failed to open ALSA device _audioout: Device or resource busy\\n");
      process.exit(1);
    }
    if (state.failAlwaysAddForUri && state.failAlwaysAddForUri === args[1]) {
      writeState(recordObservation({
        ...state,
        addFailures: Number(state.addFailures ?? 0) + 1
      }, "add-failed"));
      process.stderr.write("Failed to open ALSA device _audioout: Device or resource busy\\n");
      process.exit(1);
    }
    writeState(recordObservation({
      ...state,
      currentFile: args[1] ?? "",
      failedStreamUri: null,
      failDecodeAfterCurrentUri: state.failDecodeAfterAddForUri === args[1] ? args[1] : state.failDecodeAfterCurrentUri
    }, "add"));
    break;
  case "play":
    writeState(recordObservation({ ...state, playbackState: "playing" }, "play"));
    break;
  case "pause":
    writeState({ ...state, playbackState: "paused" });
    break;
  case "stop":
    writeState({ ...state, playbackState: "stopped" });
    break;
  case "volume":
    writeState({ ...state, volume: Number(args[1] ?? 0) });
    break;
  default:
    break;
}
`);
  await chmod(fakeMpcPath, 0o755);
  await writeFile(fakeKioskAudioReleasePath, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const statePath = ${JSON.stringify(fakeMpcStatePath)};
const roomStatePath = ${JSON.stringify(roomExperienceStatePath)};
const state = JSON.parse(readFileSync(statePath, "utf8"));
let sceneSoundEnabled = null;
try {
  sceneSoundEnabled = JSON.parse(readFileSync(roomStatePath, "utf8")).sceneSoundEnabled === true;
} catch {
  sceneSoundEnabled = null;
}
writeFileSync(statePath, JSON.stringify({
  ...state,
  observations: [
    ...(Array.isArray(state.observations) ? state.observations : []),
    { command: "release-kiosk-audio", sceneSoundEnabled }
  ]
}));
`);
  await chmod(fakeKioskAudioReleasePath, 0o755);
  await writeFile(fakeSqlitePath, `#!/usr/bin/env node
if (process.argv.join(" ").includes("cfg_radio")) {
  process.stdout.write([
    "1|1.FM - Blues Radio|http://radio.example/blues|Blues|1.FM|192|MP3|local",
    "500|Tikpal Focus - Test Exact|http://radio.example/tikpal-focus|Focus, Ambient|Test FM|320|MP3|local",
    "501|Tikpal Focus - Backup|http://radio.example/tikpal-focus-backup|Focus|Backup FM|320|MP3|local",
    "502|Tikpal Focus - Dead Link|http://radio.example/tikpal-dead|Focus|Dead FM|320|MP3|local",
    "511|Tikpal Calm - FluxFM Chillout|${radioUri}|Calm, Chill Out, Laidback|FluxFM|256|MP3|local"
  ].join("\\n") + "\\n");
}
`);
  await chmod(fakeSqlitePath, 0o755);
  await writeFile(fakeDdcutilPath, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const statePath = ${JSON.stringify(fakeBrightnessStatePath)};
const args = process.argv.slice(2);
const getIndex = args.indexOf("getvcp");
const setIndex = args.indexOf("setvcp");
if (getIndex >= 0) {
  process.stdout.write("VCP 10 C " + readFileSync(statePath, "utf8").trim() + " 100\\n");
} else if (setIndex >= 0) {
  writeFileSync(statePath, String(Number(args[setIndex + 2] ?? 0)) + "\\n");
} else {
  process.exit(1);
}
`);
  await chmod(fakeDdcutilPath, 0o755);

  const server = spawn(process.execPath, ["server/index.mjs"], {
    env: mpcFocusedSmokeEnv({
      PATH: `${workspace}${path.delimiter}${process.env.PATH ?? ""}`,
      TIKPAL_API_HOST: HOST,
      TIKPAL_API_PORT: String(port),
      TIKPAL_PLAYER_BACKEND: "mpc",
      TIKPAL_MPC_BIN: fakeMpcPath,
      TIKPAL_SQLITE_BIN: fakeSqlitePath,
      TIKPAL_DDCUTIL_BIN: fakeDdcutilPath,
      TIKPAL_DDCUTIL_READ_CACHE_MS: "60000",
      TIKPAL_RADIO_LOGO_DIR: fakeLogoDir,
      TIKPAL_AUDIO_VOLUME_STATE_PATH: fakeAudioVolumeStatePath,
      TIKPAL_AUDIO_SOURCE_MEMORY_STATE_PATH: fakeAudioSourceMemoryStatePath,
      TIKPAL_MPD_HOST: "127.0.0.1",
      TIKPAL_MPD_PORT: "6600",
      TIKPAL_ROOM_EXPERIENCE_STATE_PATH: roomExperienceStatePath,
      TIKPAL_STATE_SNAPSHOT_REFRESH_MS: "60000",
      TIKPAL_RADIO_DEFAULT_URI: "",
      TIKPAL_RADIO_ACTIVATE_COMMAND: "",
      TIKPAL_RADIO_START_VERIFY_WINDOW_MS: "120",
      TIKPAL_RADIO_START_VERIFY_POLL_MS: "20",
      TIKPAL_RADIO_POST_START_SETTLE_MS: "20",
      TIKPAL_RADIO_POST_START_RECOVERY_PLAYS: "1",
      TIKPAL_RADIO_SWITCH_RETRY_DELAYS_MS: "20,20,20",
      TIKPAL_RADIO_AUTO_SKIP_POST_START_SETTLE_MS: "20",
      TIKPAL_RADIO_AUTO_SKIP_VERIFY_WINDOW_MS: "80",
      TIKPAL_RADIO_LATE_PLAY_NUDGE_DELAYS_MS: "80,160,260",
      TIKPAL_KIOSK_AUDIO_RELEASE_COMMAND: `${process.execPath} ${fakeKioskAudioReleasePath}`,
      TIKPAL_KIOSK_AUDIO_RELEASE_SETTLE_MS: "1"
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForHealthAt(baseUrl);
    const catalog = await requestFrom(baseUrl, "/api/v1/audio/radios");
    assert(catalog.response.ok, "mpc radio preset catalog should return 200");
    assert(catalog.body.total === 4, "mpc radio catalog should default to Tikpal curated stations");
    assert(catalog.body.stations[0]?.id === "radio-500", "mpc radio catalog should expose high-id Tikpal cfg_radio rows first");
    assert(catalog.body.stations[0]?.category === "focus", "mpc radio catalog should expose Tikpal category");
    assert(catalog.body.stations[0]?.broadcaster === "Test FM", "mpc radio catalog should expose broadcaster");
    assert(catalog.body.stations[0]?.logoUrl?.startsWith("/api/v1/media/radio-logo?stationId=radio-500"), "mpc radio catalog should expose radio logo URL");
    assert(catalog.body.categories.some((category) => category.id === "calm"), "mpc radio catalog should expose category tabs");

    const allCatalog = await requestFrom(baseUrl, "/api/v1/audio/radios?scope=all&limit=250");
    assert(allCatalog.response.ok, "mpc radio all-scope catalog should return 200");
    assert(allCatalog.body.total === 5, "mpc radio all-scope catalog should include moOde and Tikpal rows");
    assert(allCatalog.body.stations[0]?.catalogSource === "tikpal", "mpc radio all-scope catalog should keep Tikpal rows first");
    assert(allCatalog.body.stations.some((station) => station.id === "radio-1" && station.catalogSource === "moode"), "mpc radio all-scope catalog should retain moOde rows");

    const calmCatalog = await requestFrom(baseUrl, "/api/v1/audio/radios?category=calm");
    assert(calmCatalog.response.ok, "mpc radio category catalog should return 200");
    assert(calmCatalog.body.total === 1 && calmCatalog.body.stations[0]?.id === "radio-511", "mpc radio category filter should isolate Calm stations");

    const exactLogo = await requestBinaryFrom(baseUrl, catalog.body.stations[0].logoUrl);
    assert(exactLogo.response.ok, "mpc radio exact logo endpoint should return 200");
    assert(exactLogo.response.headers.get("content-type")?.startsWith("image/jpeg"), "mpc radio exact logo endpoint should return image bytes");
    assert(
      exactLogo.response.headers.get("cache-control")?.includes("max-age=86400"),
      "mpc radio logo endpoint should allow browser caching for faster cover switches"
    );

    const sourcesAfterCatalog = await requestFrom(baseUrl, "/api/v1/audio/sources");
    assert(sourcesAfterCatalog.response.ok, "mpc audio sources should return 200 after radio catalog read");
    assert(
      sourcesAfterCatalog.body.sources.some((source) => source.id === "radio" && source.availability === "available" && source.controllability === "switchable"),
      "mpc fast audio sources should keep Radio available from cfg_radio catalog without TIKPAL_RADIO_DEFAULT_URI"
    );

    const scene = await requestFrom(baseUrl, "/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({
        target: "scene",
        sceneVideoId: "rainy-window",
        sceneVideoLabel: "Rainy Window",
        sceneVideoSrc: "/assets/scenes/Rainy-Window.mp4"
      })
    });
    assert(scene.response.ok, "mpc scene switch should return 200 before radio cache regression check");
    assert(scene.body.audio.currentSource.id === "scene", "mpc scene switch should prime cached scene source");
    assert(
      scene.body.audio.sources.some((source) => source.id === "radio" && source.availability === "available" && source.controllability === "switchable"),
      "mpc scene switch fast snapshot should keep Radio available from cached cfg_radio catalog"
    );

    const libraryAfterScene = await requestFrom(baseUrl, "/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "mpd" })
    });
    assert(libraryAfterScene.response.ok, `mpc library switch after cached scene should return 200, got ${libraryAfterScene.response.status}: ${JSON.stringify(libraryAfterScene.body)}`);
    assert(libraryAfterScene.body.audio.currentSource.id === "mpd", "mpc library switch after cached scene should not keep stale Scene Sound as current");
    assert(libraryAfterScene.body.playback.source === "mpd", "mpc library switch after cached scene should expose Library playback");
    assert(
      libraryAfterScene.body.audio.sources.some((source) => source.id === "scene" && source.active === false),
      "mpc library switch after cached scene should deactivate Scene Sound"
    );

    const sceneAgain = await requestFrom(baseUrl, "/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({
        target: "scene",
        sceneVideoId: "rainy-window",
        sceneVideoLabel: "Rainy Window",
        sceneVideoSrc: "/assets/scenes/Rainy-Window.mp4"
      })
    });
    assert(sceneAgain.response.ok, "mpc scene switch should return 200 before radio release regression check");
    assert(sceneAgain.body.audio.currentSource.id === "scene", "mpc scene switch should re-prime Scene Sound before radio release regression check");
    const stateAfterScene = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
    await writeFile(fakeMpcStatePath, JSON.stringify({ ...stateAfterScene, observations: [] }));

    const switched = await requestFrom(baseUrl, "/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "radio", radioStationId: "radio-511" })
    });
    assert(switched.response.ok, "mpc radio preset switch should return 200");
    assert(switched.body.audio.currentSource.id === "radio", "mpc radio preset switch should make Radio current");
    assert(switched.body.audio.currentSource.radioStationId === "radio-511", "mpc radio preset switch should expose the selected station id on currentSource");
    assert(switched.body.playback.source === "radio", "mpc radio preset switch should make playback Radio");
    assert(switched.body.audio.rememberedSource?.target === "radio", "mpc radio preset switch should remember Radio");
    assert(switched.body.audio.rememberedSource?.radioStationId === "radio-511", "mpc radio preset switch should remember the selected station");
    assert(switched.body.system.volume.percent === 44, "mpc radio preset switch should restore the last nonzero MPD volume");
    assert(switched.body.playback.albumArtUrl?.startsWith("/api/v1/media/radio-logo?stationId=radio-511"), "mpc radio playback should prefer station logo artwork");
    const activeCalmCatalog = await requestFrom(baseUrl, "/api/v1/audio/radios?category=calm");
    assert(activeCalmCatalog.response.ok, "mpc radio active catalog should return 200");
    assert(
      activeCalmCatalog.body.stations[0]?.id === "radio-511" && activeCalmCatalog.body.stations[0]?.active === true,
      "mpc radio catalog should mark the selected station active"
    );
    const aliasLogo = await requestBinaryFrom(baseUrl, switched.body.playback.albumArtUrl);
    assert(aliasLogo.response.ok, "mpc radio alias logo endpoint should return 200");
    const fakeStateAfterRadio = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
    assert(fakeStateAfterRadio.volume === 44, "mpc radio preset switch should issue mpc volume restore command");
    assert(fakeStateAfterRadio.addFailures === 1, "mpc radio preset switch should retry once after a busy audio output add failure");
    assert(fakeStateAfterRadio.radioStartStatusFailures === 0, "mpc radio preset switch should nudge through a transient ALSA busy status");
    const releaseObservationIndex = fakeStateAfterRadio.observations.findIndex((entry) => entry.command === "release-kiosk-audio");
    const firstMpcStartIndex = fakeStateAfterRadio.observations.findIndex((entry) => ["clear", "add-failed", "add", "play"].includes(entry.command));
    assert(releaseObservationIndex >= 0, "mpc radio preset switch should run the kiosk audio release command");
    assert(firstMpcStartIndex >= 0 && releaseObservationIndex < firstMpcStartIndex, "mpc radio preset switch should release kiosk audio before MPD start");
    assert(fakeStateAfterRadio.observations[releaseObservationIndex]?.sceneSoundEnabled === false, "mpc radio preset switch should release kiosk audio after scene sound is disabled");
    assert(
      fakeStateAfterRadio.observations
        .filter((entry) => ["clear", "add-failed", "add", "play"].includes(entry.command))
        .every((entry) => entry.sceneSoundEnabled === false),
      "mpc radio preset switch should clear scene sound state before starting MPD radio"
    );
    assert(
      JSON.parse(await readFile(roomExperienceStatePath, "utf8")).sceneSoundEnabled === false,
      "mpc radio preset switch should persist scene sound as disabled"
    );
    assert(
      switched.body.audio.sources.some((source) => source.id === "radio" && source.availability === "available" && source.controllability === "switchable"),
      "mpc radio preset switch should return Radio as available and switchable without TIKPAL_RADIO_DEFAULT_URI"
    );

    const nextRadio = await requestFrom(baseUrl, "/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "next" })
    });
    assert(nextRadio.response.ok, "mpc radio next should return 200");
    assert(nextRadio.body.audio.currentSource.secondaryStatus === "Tikpal Focus - Test Exact active", "mpc radio next should advance to the next Tikpal station");
    assert(nextRadio.body.audio.currentSource.radioStationId === "radio-500", "mpc radio next should expose the advanced station id on currentSource");
    assert(nextRadio.body.audio.rememberedSource?.radioStationId === "radio-500", "mpc radio next should remember the advanced station");
    assert(nextRadio.body.playback.albumArtUrl?.startsWith("/api/v1/media/radio-logo?stationId=radio-500"), "mpc radio next should refresh station logo artwork");
    assert(JSON.parse(await readFile(fakeMpcStatePath, "utf8")).currentFile === "http://radio.example/tikpal-focus", "mpc radio next should replace the MPD stream URI");

    const previousRadio = await requestFrom(baseUrl, "/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "previous" })
    });
    assert(previousRadio.response.ok, "mpc radio previous should return 200");
    assert(previousRadio.body.audio.currentSource.secondaryStatus === "Tikpal Calm - FluxFM Chillout active", "mpc radio previous should return to the previous Tikpal station");
    assert(previousRadio.body.audio.currentSource.radioStationId === "radio-511", "mpc radio previous should expose the previous station id on currentSource");
    assert(previousRadio.body.audio.rememberedSource?.radioStationId === "radio-511", "mpc radio previous should remember the previous station");
    assert(previousRadio.body.playback.albumArtUrl?.startsWith("/api/v1/media/radio-logo?stationId=radio-511"), "mpc radio previous should refresh station logo artwork");
    assert(JSON.parse(await readFile(fakeMpcStatePath, "utf8")).currentFile === radioUri, "mpc radio previous should replace the MPD stream URI");

    const sceneAfterRadio = await requestFrom(baseUrl, "/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({
        target: "scene",
        sceneVideoId: "rainy-window",
        sceneVideoLabel: "Rainy Window",
        sceneVideoSrc: "/assets/scenes/Rainy-Window.mp4"
      })
    });
    assert(sceneAfterRadio.response.ok, "mpc scene switch after Radio should return 200");
    assert(sceneAfterRadio.body.audio.currentSource.id === "scene", "mpc scene switch after Radio should activate Scene Sound");
    assert(sceneAfterRadio.body.audio.rememberedSource?.target === "radio", "mpc scene switch after Radio should preserve remembered Radio");
    const sceneSoundOffAfterRadio = await requestFrom(baseUrl, "/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_scene_sound", sceneSoundEnabled: false })
    });
    assert(sceneSoundOffAfterRadio.response.ok, "mpc scene sound off after Radio should return 200");
    assert(sceneSoundOffAfterRadio.body.sceneSoundEnabled === false, "mpc scene sound off after Radio should persist off");
    const stateAfterSceneSoundOffRadio = await requestFrom(baseUrl, "/api/v1/system/state");
    assert(stateAfterSceneSoundOffRadio.body.audio.currentSource.id === "radio", "mpc scene sound off after Radio should restore Radio");
    assert(stateAfterSceneSoundOffRadio.body.audio.currentSource.radioStationId === "radio-511", "mpc scene sound off after Radio should restore the remembered station");
    assert(stateAfterSceneSoundOffRadio.body.playback.source === "radio", "mpc scene sound off after Radio should expose Radio playback");
    assert(stateAfterSceneSoundOffRadio.body.playback.state === "playing", "mpc scene sound off after Radio should not leave playback stopped");

    const libraryAfterRadioPreset = await requestFrom(baseUrl, "/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "mpd" })
    });
    assert(libraryAfterRadioPreset.response.ok, "mpc Library switch after Radio preset should return 200");
    assert(libraryAfterRadioPreset.body.audio.currentSource.id === "mpd", "mpc Library switch after Radio preset should restore MPD");
    assert(libraryAfterRadioPreset.body.audio.rememberedSource?.target === "mpd", "mpc Library switch after Radio preset should remember Library as the last source");
    assert(libraryAfterRadioPreset.body.audio.rememberedSource?.radioStationId === "radio-511", "mpc Library switch after Radio preset should preserve the previous station bookmark");
    const bareRadioAfterLibraryPreset = await requestFrom(baseUrl, "/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "radio" })
    });
    assert(bareRadioAfterLibraryPreset.response.ok, "mpc bare Radio switch after Library should return 200");
    assert(bareRadioAfterLibraryPreset.body.audio.currentSource.id === "radio", "mpc bare Radio switch after Library should restore Radio");
    assert(bareRadioAfterLibraryPreset.body.audio.currentSource.radioStationId === "radio-511", "mpc bare Radio switch after Library should restore the previous station");
    assert(bareRadioAfterLibraryPreset.body.audio.rememberedSource?.radioStationId === "radio-511", "mpc bare Radio switch after Library should keep the restored station in memory");

    const fastRefresh = await requestFrom(baseUrl, "/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "pause" })
    });
    assert(fastRefresh.response.ok, "mpc radio fast playback mutation should return 200");
    assert(fastRefresh.body.audio.currentSource.id === "radio", "mpc radio fast refresh should keep Radio current");
    assert(fastRefresh.body.audio.currentSource.radioStationId === "radio-511", "mpc radio fast refresh should keep the selected station id");
    assert(
      fastRefresh.body.audio.currentSource.secondaryStatus === "Tikpal Calm - FluxFM Chillout active",
      "mpc radio fast refresh should keep the selected station label"
    );
    assert(
      fastRefresh.body.audio.sources.some((source) => source.id === "radio" && source.availability === "available" && source.controllability === "switchable"),
      "mpc radio fast refresh should preserve preset-backed Radio availability"
    );

    const stateBeforeFailedStream = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
    await writeFile(fakeMpcStatePath, JSON.stringify({
      ...stateBeforeFailedStream,
      currentFile: "",
      failedStreamUri: radioUri,
      playbackState: "stopped",
      failAlwaysAddForUri: "http://radio.example/tikpal-focus"
    }));
    const failedStreamRefresh = await requestFrom(baseUrl, "/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "pause" })
    });
    assert(failedStreamRefresh.response.ok, "mpc failed radio stream refresh should return 200");
    assert(failedStreamRefresh.body.playback.source === "radio", "mpc failed radio stream should still report Radio source");
    assert(failedStreamRefresh.body.playback.state === "stopped", "mpc failed radio stream should not be reported as playing");
    assert(failedStreamRefresh.body.audio.currentSource.radioStationId === "radio-511", "mpc failed radio stream should keep the failed station id on currentSource");
    assert(
      failedStreamRefresh.body.audio.currentSource.secondaryStatus === "Tikpal Calm - FluxFM Chillout active",
      "mpc failed radio stream should keep the failed station label"
    );
    const failedStreamCatalog = await requestFrom(baseUrl, "/api/v1/audio/radios?category=calm");
    assert(
      failedStreamCatalog.body.stations[0]?.id === "radio-511" && failedStreamCatalog.body.stations[0]?.active === true,
      "mpc failed radio stream should keep the selected station active in the catalog"
    );
    const nextAfterFailedStream = await requestFrom(baseUrl, "/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "next" })
    });
    assert(nextAfterFailedStream.response.ok, "mpc radio next should recover from a failed stream");
    assert(nextAfterFailedStream.body.playback.state === "playing", "mpc radio next recovery should start playback");
    assert(nextAfterFailedStream.body.audio.currentSource.radioStationId === "radio-501", "mpc radio next recovery should expose the recovered station id on currentSource");
    assert(
      nextAfterFailedStream.body.audio.currentSource.secondaryStatus === "Tikpal Focus - Backup active",
      "mpc radio next recovery should skip a failed candidate station"
    );
    const stateAfterFailedStreamNext = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
    assert(stateAfterFailedStreamNext.currentFile === "http://radio.example/tikpal-focus-backup", "mpc radio next recovery should replace the failed MPD stream URI");
    assert(
      stateAfterFailedStreamNext.addFailures === Number(stateBeforeFailedStream.addFailures ?? 0) + 1,
      "mpc radio next recovery should skip each failed candidate after one fast failed start"
    );

    await writeFile(fakeMpcStatePath, JSON.stringify({
      ...stateAfterFailedStreamNext,
      currentFile: "Codex/Smoke.mp3",
      failedStreamUri: null,
      failAlwaysAddForUri: null,
      failDecodeOnAddForUri: "http://radio.example/tikpal-dead",
      playbackState: "playing"
    }));
    const manualDeadStationFallback = await requestFrom(baseUrl, "/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "radio", radioStationId: "radio-502" })
    });
    assert(manualDeadStationFallback.response.ok, "mpc radio source switch should recover from a dead selected station");
    assert(
      manualDeadStationFallback.body.audio.currentSource.radioStationId === "radio-511",
      "mpc radio source switch fallback should expose the recovered station id on currentSource"
    );
    assert(
      manualDeadStationFallback.body.audio.currentSource.secondaryStatus === "Tikpal Calm - FluxFM Chillout active",
      "mpc radio source switch should advance to the next station when the selected station cannot connect"
    );
    assert(
      manualDeadStationFallback.body.audio.rememberedSource?.radioStationId === "radio-511",
      "mpc radio source switch fallback should remember the recovered station instead of the dead station"
    );
    assert(
      manualDeadStationFallback.body.playback.albumArtUrl?.startsWith("/api/v1/media/radio-logo?stationId=radio-511"),
      "mpc radio source switch fallback should refresh station logo artwork immediately"
    );
    assert(JSON.parse(await readFile(fakeMpcStatePath, "utf8")).currentFile === radioUri, "mpc radio source switch fallback should replace the dead selected station URI");

    const stateBeforeDelayedStreamFailure = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
    await writeFile(fakeMpcStatePath, JSON.stringify({
      ...stateBeforeDelayedStreamFailure,
      currentFile: "Codex/Smoke.mp3",
      failedStreamUri: null,
      failDecodeAfterAddForUri: "http://radio.example/tikpal-dead",
      failDecodeAfterCurrentUri: null,
      failDecodeAfterStatusReads: 4,
      failDecodeOnAddForUri: null,
      playbackState: "playing"
    }));
    const delayedDeadStation = await requestFrom(baseUrl, "/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "radio", radioStationId: "radio-502" })
    });
    assert(delayedDeadStation.response.ok, "mpc radio delayed dead stream switch should initially return 200");
    assert(
      delayedDeadStation.body.audio.currentSource.radioStationId === "radio-502",
      "mpc radio delayed dead stream should initially expose the selected station id"
    );
    assert(
      delayedDeadStation.body.audio.currentSource.secondaryStatus === "Tikpal Focus - Dead Link active",
      "mpc radio delayed dead stream should initially keep the selected station label"
    );
    await wait(650);
    const autoSkippedDeadStation = await requestFrom(baseUrl, "/api/v1/system/state");
    const autoSkippedFakeState = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
    assert(
      autoSkippedDeadStation.body.audio.currentSource.secondaryStatus === "Tikpal Calm - FluxFM Chillout active",
      `mpc radio late stream failure should auto-advance to the next station: ${JSON.stringify({
        currentSource: autoSkippedDeadStation.body.audio.currentSource,
        fakeCurrentFile: autoSkippedFakeState.currentFile,
        fakeFailedStreamUri: autoSkippedFakeState.failedStreamUri,
        fakeObservations: autoSkippedFakeState.observations?.slice(-8)
      })}`
    );
    assert(
      autoSkippedDeadStation.body.audio.currentSource.radioStationId === "radio-511",
      "mpc radio late stream failure should expose the auto-advanced station id on currentSource"
    );
    assert(
      autoSkippedDeadStation.body.playback.albumArtUrl?.startsWith("/api/v1/media/radio-logo?stationId=radio-511"),
      "mpc radio late stream failure should refresh station logo artwork with the auto-advanced station"
    );
    assert(autoSkippedFakeState.currentFile === radioUri, "mpc radio late stream failure should replace the failed stream URI");
    const rememberedAfterAutoSkip = JSON.parse(await readFile(fakeAudioSourceMemoryStatePath, "utf8"));
    assert(
      rememberedAfterAutoSkip.target === "radio" && rememberedAfterAutoSkip.radioStationId === "radio-511",
      `mpc radio late stream failure should persist the auto-advanced station as remembered source: ${JSON.stringify({
        rememberedAfterAutoSkip,
        currentSource: autoSkippedDeadStation.body.audio.currentSource,
        fakeCurrentFile: autoSkippedFakeState.currentFile,
        fakeFailedStreamUri: autoSkippedFakeState.failedStreamUri,
        fakeObservations: autoSkippedFakeState.observations?.slice(-10)
      })}`
    );

    const initialBrightness = await requestFrom(baseUrl, "/api/v1/system/state");
    assert(initialBrightness.response.ok, "mpc brightness preflight should return 200");
    assert(initialBrightness.body.system.display.brightnessPercent === 48, "mpc brightness preflight should read fake ddcutil state");
    const brightness = await requestFrom(baseUrl, "/api/v1/system/actions", {
      method: "POST",
      body: JSON.stringify({ type: "brightness_set", value: 62 })
    });
    assert(brightness.response.ok, "mpc brightness_set should return 200");
    assert(brightness.body.system.display.brightnessPercent === 62, "mpc brightness_set should return the written DDC brightness");
    const brightnessAfterWrite = await requestFrom(baseUrl, "/api/v1/system/state");
    assert(brightnessAfterWrite.response.ok, "mpc brightness post-write state should return 200");
    assert(brightnessAfterWrite.body.system.display.brightnessPercent === 62, "mpc brightness post-write state should not restore the stale cached display snapshot");
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => server.once("exit", resolve)),
        wait(1000)
      ]);
    }
    await rm(workspace, { recursive: true, force: true });
  }
}

async function runMpcAirplayHandoffRefreshSmoke(roomExperienceStatePath) {
  const port = PORT + 14;
  const baseUrl = `http://${HOST}:${port}`;
  const workspace = await mkdtemp(path.join(tmpdir(), "tikpal-mpc-airplay-"));
  const fakeMpcPath = path.join(workspace, "mpc-fake.mjs");
  const fakeVolumePath = path.join(workspace, "volume-fake.mjs");
  const fakeVolumeStatePath = path.join(workspace, "volume-state.txt");
  const fakeAirplayMetadataPath = path.join(workspace, "airplay-metadata.json");
  const fakeAirplayMetadataCommandPath = path.join(workspace, "airplay-metadata.mjs");
  const fakeAirplayTransportLogPath = path.join(workspace, "airplay-transport.log");
  const fakeAirplayTransportCommandPath = path.join(workspace, "airplay-transport.mjs");
  const airplayArtworkRoot = path.join(workspace, "airplay-covers");
  const firstAirplayArtworkPath = path.join(airplayArtworkRoot, "this-city.png");
  const secondAirplayArtworkPath = path.join(airplayArtworkRoot, "instant-crush.png");
  const pngPixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/azU1wAAAABJRU5ErkJggg==", "base64");
  const writeAirplayMetadata = async (metadata) => {
    await writeFile(fakeAirplayMetadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  };

  await writeFile(fakeMpcPath, `#!/usr/bin/env node
const rawArgs = process.argv.slice(2);
const args = [];

for (let index = 0; index < rawArgs.length; index += 1) {
  if (rawArgs[index] === "--host" || rawArgs[index] === "--port" || rawArgs[index] === "--format") {
    index += 1;
    continue;
  }
  args.push(rawArgs[index]);
}

const command = args[0] ?? "";
switch (command) {
  case "status":
    process.stdout.write("volume:30%   repeat: off   random: off   single: off   consume: off\\n");
    break;
  case "stats":
    process.stdout.write("Artists: 0\\nAlbums: 0\\nSongs: 0\\nDB Updated: fake\\n");
    break;
  case "current":
  case "playlist":
  case "stop":
  default:
    break;
}
`);
  await chmod(fakeMpcPath, 0o755);
  await writeFile(fakeVolumeStatePath, "28");
  await writeFile(fakeVolumePath, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const statePath = ${JSON.stringify(fakeVolumeStatePath)};
const command = process.argv[2] ?? "get";

if (command === "set") {
  const value = Math.max(0, Math.min(100, Math.round(Number(process.argv[3]))));
  writeFileSync(statePath, String(value));
  process.exit(0);
}

const value = Number(readFileSync(statePath, "utf8"));
process.stdout.write(\`Simple mixer control 'PCM',0
  Capabilities: pvolume
  Playback channels: Front Left - Front Right
  Limits: Playback 0 - 255
  Front Left: Playback 0 [\${value}%] [-0.00dB]
  Front Right: Playback 0 [\${value}%] [-0.00dB]
\`);
`);
  await chmod(fakeVolumePath, 0o755);
  await mkdir(airplayArtworkRoot, { recursive: true });
  await writeFile(firstAirplayArtworkPath, pngPixel);
  await writeFile(secondAirplayArtworkPath, pngPixel);
  await writeFile(fakeAirplayMetadataCommandPath, `#!/usr/bin/env node
import { readFileSync } from "node:fs";

const metadata = JSON.parse(readFileSync(process.env.TIKPAL_FAKE_AIRPLAY_METADATA_PATH, "utf8"));
for (const [key, value] of Object.entries(metadata)) {
  if (value === null || value === undefined || value === "") continue;
  process.stdout.write(\`\${key}=\${String(value)}\\n\`);
}
`);
  await chmod(fakeAirplayMetadataCommandPath, 0o755);
  await writeFile(fakeAirplayTransportLogPath, "");
  await writeFile(fakeAirplayTransportCommandPath, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";

appendFileSync(${JSON.stringify(fakeAirplayTransportLogPath)}, process.argv[2] + "\\n");
`);
  await chmod(fakeAirplayTransportCommandPath, 0o755);
  await writeAirplayMetadata({
    title: "This City",
    artist: "Sam Fischer",
    album: "Not a Hobby",
    status: "playing",
    positionMs: 45000,
    durationMs: 60000,
    artworkPath: firstAirplayArtworkPath,
    artworkMtimeMs: 111000,
    metadataSource: "mpris"
  });

  const server = spawn(process.execPath, ["server/index.mjs"], {
    env: mpcFocusedSmokeEnv({
      TIKPAL_API_HOST: HOST,
      TIKPAL_API_PORT: String(port),
      TIKPAL_PLAYER_BACKEND: "mpc",
      TIKPAL_MPC_BIN: fakeMpcPath,
      TIKPAL_MPD_HOST: "127.0.0.1",
      TIKPAL_MPD_PORT: "6600",
      TIKPAL_ROOM_EXPERIENCE_STATE_PATH: roomExperienceStatePath,
      TIKPAL_STATE_SNAPSHOT_REFRESH_MS: "60000",
      TIKPAL_OUTPUT_VOLUME_GET_COMMAND: `${process.execPath} ${fakeVolumePath} get`,
      TIKPAL_OUTPUT_VOLUME_SET_COMMAND: `${process.execPath} ${fakeVolumePath} set %VALUE%`,
      TIKPAL_AIRPLAY_ENABLE_COMMAND: "true",
      TIKPAL_AIRPLAY_READY_COMMAND: "true",
      TIKPAL_AIRPLAY_ACTIVE_COMMAND: "true",
      TIKPAL_AIRPLAY_RECEIVER_ACTIVE_COMMAND: "false",
      TIKPAL_AIRPLAY_LABEL_COMMAND: "printf 'Tikpal Speaker'",
      TIKPAL_AIRPLAY_METADATA_COMMAND: `${process.execPath} ${fakeAirplayMetadataCommandPath}`,
      TIKPAL_AIRPLAY_TRANSPORT_AVAILABLE_COMMAND: "true",
      TIKPAL_AIRPLAY_PLAY_PAUSE_COMMAND: `${process.execPath} ${fakeAirplayTransportCommandPath} play-pause`,
      TIKPAL_AIRPLAY_PLAY_COMMAND: `${process.execPath} ${fakeAirplayTransportCommandPath} play`,
      TIKPAL_AIRPLAY_PAUSE_COMMAND: `${process.execPath} ${fakeAirplayTransportCommandPath} pause`,
      TIKPAL_AIRPLAY_NEXT_COMMAND: `${process.execPath} ${fakeAirplayTransportCommandPath} next`,
      TIKPAL_AIRPLAY_PREVIOUS_COMMAND: `${process.execPath} ${fakeAirplayTransportCommandPath} previous`,
      TIKPAL_FAKE_AIRPLAY_METADATA_PATH: fakeAirplayMetadataPath,
      TIKPAL_AIRPLAY_ARTWORK_ROOT: airplayArtworkRoot,
      TIKPAL_AIRPLAY_DIRECT_METADATA_REFRESH_MIN_MS: "1000",
      TIKPAL_LRCLIB_BASE_URL: PROVIDER_URL
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForHealthAt(baseUrl);
    let recovered = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const initial = await requestFrom(baseUrl, "/api/v1/system/state");
      if (
        initial.response.ok
        && initial.body.audio.currentSource.id === "airplay"
        && initial.body.audio.currentSource.connectionState === "connected"
      ) {
        recovered = initial;
        break;
      }
      await wait(200);
    }
    assert(recovered, "mpc active external source should recover as current after API startup");
    assert(recovered.body.system.volume.percent === 28, "mpc recovered external source should report output volume");
    assert(recovered.body.playback.title === "This City", "mpc recovered AirPlay state should expose metadata title");
    assert(recovered.body.playback.artist === "Sam Fischer", "mpc recovered AirPlay state should expose metadata artist");
    assert(recovered.body.playback.elapsedSeconds === 45, "mpc recovered AirPlay state should expose metadata position");
    assert(recovered.body.playback.transportCapabilities?.next === true, "mpc recovered AirPlay state should expose transport capability");
    assert(recovered.body.playback.timingDiagnostics?.metadataSource === "mpris", "mpc recovered AirPlay state should expose metadata source diagnostics");
    assert(
      recovered.body.playback.albumArtUrl?.startsWith("/api/v1/media/airplay-artwork?path="),
      "mpc recovered AirPlay state should expose proxied artwork"
    );
    assert(
      recovered.body.playback.albumArtUrl.includes("v=111000"),
      "mpc recovered AirPlay artwork should be versioned by artwork mtime"
    );
    const recoveredArtwork = await requestBinaryFrom(baseUrl, recovered.body.playback.albumArtUrl);
    assert(recoveredArtwork.response.ok, "mpc recovered AirPlay artwork endpoint should return the fake cover");
    assert(recoveredArtwork.body.length > 0, "mpc recovered AirPlay artwork endpoint should return bytes");

    const recoveredVolume = await requestFrom(baseUrl, "/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "volume_set", value: 43 })
    });
    assert(recoveredVolume.response.ok, "mpc recovered external volume_set should return 200");
    assert(recoveredVolume.body.system.volume.percent === 43, "mpc recovered external volume_set should use output volume");
    assert(
      recoveredVolume.body.audio.currentSource.connectionState === "connected",
      `mpc recovered external volume_set should keep connected, got ${recoveredVolume.body.audio.currentSource.connectionState}`
    );

    const switched = await requestFrom(baseUrl, "/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "airplay" })
    });
    assert(switched.response.ok, "mpc airplay source switch should return 200");
    assert(switched.body.audio.currentSource.id === "airplay", "mpc airplay switch should mark AirPlay current");
    assert(switched.body.audio.currentSource.armed === true, "mpc airplay switch should arm AirPlay");
    assert(
      switched.body.audio.currentSource.connectionState === "connected",
      `mpc airplay switch should refresh command-backed connection state, got ${switched.body.audio.currentSource.connectionState}`
    );
    assert(switched.body.playback.source === "airplay", "mpc airplay playback source should be AirPlay");
    assert(switched.body.playback.transportCapabilities?.previous === true, "mpc airplay switch should preserve transport capability");
    assert(switched.body.system.volume.percent === 43, "mpc external source switch should return the current output volume");
    assert(switched.body.playback.title === "This City", "mpc airplay switch should preserve fresh AirPlay metadata");
    assert(
      switched.body.playback.albumArtUrl?.includes("v=111000"),
      "mpc airplay switch should preserve versioned AirPlay artwork"
    );

    const airplayNext = await requestFrom(baseUrl, "/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "next" })
    });
    assert(airplayNext.response.ok, "mpc airplay next action should return 200");
    assert(airplayNext.body.playback.source === "airplay", "mpc airplay next should keep AirPlay as playback source");
    const airplayPrevious = await requestFrom(baseUrl, "/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "previous" })
    });
    assert(airplayPrevious.response.ok, "mpc airplay previous action should return 200");
    assert(airplayPrevious.body.playback.source === "airplay", "mpc airplay previous should keep AirPlay as playback source");
    const airplayPlayPause = await requestFrom(baseUrl, "/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "play_pause" })
    });
    assert(airplayPlayPause.response.ok, "mpc airplay play_pause action should return 200");
    const airplayTransportLog = await readFile(fakeAirplayTransportLogPath, "utf8");
    assert(
      airplayTransportLog.includes("next\n")
        && airplayTransportLog.includes("previous\n")
        && airplayTransportLog.includes("play-pause\n"),
      `mpc airplay transport should call AirPlay commands, got ${JSON.stringify(airplayTransportLog)}`
    );

    const airplayLyricsRefresh = await requestFrom(baseUrl, "/api/v1/lyrics/refresh", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(airplayLyricsRefresh.response.ok, "mpc airplay lyrics refresh should return 200");
    const thisCityLyrics = await waitForLyricsStatusAt(baseUrl, ["ready"]);
    assert(thisCityLyrics.sourceScope === "airplay_input", "AirPlay metadata lyrics should keep airplay scope");
    assert(thisCityLyrics.recognitionMode === "metadata", "trusted AirPlay metadata should use metadata lyrics lookup");
    assert(thisCityLyrics.title === "This City", "AirPlay lyrics should resolve the current metadata track");
    assert(thisCityLyrics.artist === "Sam Fischer", "AirPlay lyrics should skip same-title results from the wrong artist");
    assert(thisCityLyrics.synced === true, "AirPlay lyrics should stay synced when playback position is available");
    assert(thisCityLyrics.lines.some((line) => line.text.includes("crowded rooms")), "AirPlay lyrics should expose current track lyrics");
    assert(!thisCityLyrics.lines.some((line) => line.text.includes("Wrong city")), "AirPlay lyrics should not expose wrong-artist same-title lyrics");

    const cached = await requestFrom(baseUrl, "/api/v1/system/state");
    assert(cached.response.ok, "cached mpc airplay state should return 200");
    assert(
      cached.body.audio.currentSource.connectionState === "connected",
      `cached mpc airplay state should preserve connected after source switch, got ${cached.body.audio.currentSource.connectionState}`
    );

    const volume = await requestFrom(baseUrl, "/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "volume_set", value: 44 })
    });
    assert(volume.response.ok, "mpc external volume_set should return 200");
    assert(volume.body.system.volume.percent === 44, "mpc external volume_set should return the freshly written output volume");
    assert(
      volume.body.audio.currentSource.connectionState === "connected",
      `mpc external volume_set should preserve connected source state, got ${volume.body.audio.currentSource.connectionState}`
    );

    const afterVolume = await requestFrom(baseUrl, "/api/v1/system/state");
    assert(afterVolume.response.ok, "cached mpc airplay state after volume should return 200");
    assert(afterVolume.body.system.volume.percent === 44, "cached mpc state should keep the output volume after external volume_set");
    assert(
      afterVolume.body.audio.currentSource.connectionState === "connected",
      `cached mpc state should keep connected after external volume_set, got ${afterVolume.body.audio.currentSource.connectionState}`
    );

    await writeAirplayMetadata({
      title: "Instant Crush",
      artist: "Daft Punk",
      album: "Random Access Memories",
      status: "playing",
      positionMs: 12000,
      durationMs: 337000,
      artworkPath: secondAirplayArtworkPath,
      artworkMtimeMs: 222000,
      metadataSource: "json"
    });
    const secondLyricsRefresh = await requestFrom(baseUrl, "/api/v1/lyrics/refresh", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(secondLyricsRefresh.response.ok, "mpc airplay lyrics refresh after track change should return 200");
    const instantCrushLyrics = await waitForLyricsStatusAt(baseUrl, ["ready"]);
    assert(instantCrushLyrics.sourceScope === "airplay_input", "changed AirPlay lyrics should keep airplay scope");
    assert(instantCrushLyrics.recognitionMode === "metadata", "changed AirPlay lyrics should still use metadata lookup");
    assert(instantCrushLyrics.title === "Instant Crush", "AirPlay lyrics should switch to the changed metadata track");
    assert(instantCrushLyrics.trackKey !== thisCityLyrics.trackKey, "AirPlay track change should not keep the old lyrics key");
    assert(instantCrushLyrics.lines.some((line) => line.text.includes("forget")), "AirPlay track change should expose the new lyrics");
    const afterTrackChange = await requestFrom(baseUrl, "/api/v1/system/state");
    assert(afterTrackChange.response.ok, "cached mpc airplay state after track change should return 200");
    assert(afterTrackChange.body.playback.title === "Instant Crush", "AirPlay state should switch to the changed metadata title");
    assert(afterTrackChange.body.lyrics.title === afterTrackChange.body.playback.title, "AirPlay cached state should keep lyrics and playback title aligned after track change");
    assert(afterTrackChange.body.lyrics.artist === afterTrackChange.body.playback.artist, "AirPlay cached state should keep lyrics and playback artist aligned after track change");
    assert(
      afterTrackChange.body.playback.albumArtUrl?.includes("v=222000"),
      "AirPlay artwork should switch to the changed cover version"
    );

    await writeAirplayMetadata({
      title: "Duration Drift",
      artist: "Clock Source",
      album: "Unreliable Metadata",
      status: "playing",
      positionMs: 29000,
      durationMs: 29954,
      artworkPath: secondAirplayArtworkPath,
      artworkMtimeMs: 333000,
      metadataSource: "mpris"
    });
    const durationDriftLyricsRefresh = await requestFrom(baseUrl, "/api/v1/lyrics/refresh", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(durationDriftLyricsRefresh.response.ok, "mpc airplay lyrics refresh with unreliable duration should return 200");
    const durationDriftLyrics = await waitForLyricsTrackAt(baseUrl, {
      title: "Duration Drift",
      artist: "Clock Source"
    });
    assert(durationDriftLyrics.sourceScope === "airplay_input", "duration-drift AirPlay lyrics should keep airplay scope");
    assert(durationDriftLyrics.recognitionMode === "metadata", "duration-drift AirPlay lyrics should still use metadata lookup");
    assert(durationDriftLyrics.synced === true, "AirPlay metadata lyrics should stay synced when only duration is unreliable");
    assert(durationDriftLyrics.timingStrategy === "provider_synced", "AirPlay lyrics should prefer provider timing when metadata duration drifts");
    assert(
      durationDriftLyrics.lines.some((line) => line.text.includes("real lyric clock")),
      "AirPlay lyrics should not disappear when trusted title and artist have a mismatched duration"
    );

    await writeAirplayMetadata({
      title: "AirPlay Ready",
      artist: "Choose Tikpal from AirPlay",
      album: "AirPlay Source",
      status: "playing",
      positionMs: 0,
      durationMs: 0,
      metadataSource: "mpris"
    });
    const missingMetadataLyricsRefresh = await requestFrom(baseUrl, "/api/v1/lyrics/refresh", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(missingMetadataLyricsRefresh.response.ok, "mpc airplay lyrics refresh without usable metadata should return 200");
    assert(missingMetadataLyricsRefresh.body.status === "idle", "AirPlay without usable metadata and capture should not stay in fingerprint recognizing");
    assert(missingMetadataLyricsRefresh.body.recognitionMode === null, "AirPlay without capture should not advertise fingerprint recognition");
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => server.once("exit", resolve)),
        wait(1000)
      ]);
    }
    await rm(workspace, { recursive: true, force: true });
  }
}

async function run() {
  runAccessControlHelperSmoke();
  await runAirplayMetadataHelperClockSmoke();

  const apiAssetsRoot = await mkdtemp(path.join(tmpdir(), "tikpal-api-assets-"));
  const apiStateRoot = await mkdtemp(path.join(tmpdir(), "tikpal-api-state-"));
  const musicLibraryStatePath = path.join(apiStateRoot, "music-library-state.json");
  const roomExperienceStatePath = path.join(apiStateRoot, "room-experience-state.json");
  const audioSourceMemoryStatePath = path.join(apiStateRoot, "audio-source-memory.json");
  const sceneBytes = Buffer.from("000000 ftypisom tikpal rainy window api smoke mp4");
  const sceneSha256 = createHash("sha256").update(sceneBytes).digest("hex");
  await mkdir(path.join(apiAssetsRoot, "scenes", "_metadata"), { recursive: true });
  await writeFile(path.join(apiAssetsRoot, "output_2560x720-4k.mp4"), Buffer.from("000000 ftypisom tikpal legacy scene mp4"));
  await writeFile(path.join(apiAssetsRoot, "scenes", "Rainy-Window.mp4"), sceneBytes);
  await writeFile(
    path.join(apiAssetsRoot, "scenes", "_metadata", "scene_videos.json"),
    `${JSON.stringify({
      mode: "add",
      videos: [
        {
          id: "rainy-window",
          filename: "Rainy-Window.mp4",
          label: "Rainy Window",
          order: 30,
          roomModes: ["calm"],
          audioGainDb: 11.1,
          default: false,
          sha256: sceneSha256
        }
      ]
    }, null, 2)}\n`
  );
  await writeFile(
    roomExperienceStatePath,
    `${JSON.stringify({
      mode: "calm",
      phase: "idle",
      presetId: "calm-rain-room",
      sceneVideoId: "rainy-window",
      hifiEqPresetId: "flat",
      hifiVisualPresetId: "spectrum-bars",
      sceneSoundEnabled: false,
      playlistId: null,
      volumePercent: 38,
      brightnessPercent: 48,
      timerMinutes: 45,
      timerEndsAt: null,
      nightSchedule: {
        enabled: false,
        timeZone: "Asia/Shanghai",
        start: "22:30",
        end: "06:30",
        brightnessPercent: 5,
        active: false,
        preNightBrightnessPercent: null
      }
    }, null, 2)}\n`
  );

  await writeFile(BLUETOOTH_SCENARIO_PATH, "BT_SUCCESS\n");
  await writeFile(BLUETOOTH_METADATA_PATH, "");
  const providerServer = createProviderServer();
  await new Promise((resolve) => providerServer.listen(PROVIDER_PORT, HOST, resolve));

  const server = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      TIKPAL_API_HOST: HOST,
      TIKPAL_API_PORT: String(PORT),
      TIKPAL_PORTABLE_API_KEY: PORTABLE_API_KEY,
      TIKPAL_KIOSK_HEARTBEAT_STALE_MS: "1000",
      TIKPAL_PUBLIC_ASSETS_ROOT: apiAssetsRoot,
      TIKPAL_MUSIC_LIBRARY_STATE_PATH: musicLibraryStatePath,
      TIKPAL_ROOM_EXPERIENCE_STATE_PATH: roomExperienceStatePath,
      TIKPAL_AUDIO_SOURCE_MEMORY_STATE_PATH: audioSourceMemoryStatePath,
      TIKPAL_RECOGNITION_PROVIDER: "acrcloud",
      TIKPAL_ACRCLOUD_HOST: PROVIDER_URL,
      TIKPAL_ACRCLOUD_ACCESS_KEY: "mock-key",
      TIKPAL_ACRCLOUD_ACCESS_SECRET: "mock-secret",
      TIKPAL_SCENE_CONTEXT_GEO_URL: `${PROVIDER_URL}/geo`,
      TIKPAL_SCENE_CONTEXT_WEATHER_URL: `${PROVIDER_URL}/forecast`,
      TIKPAL_BLUETOOTH_CAPTURE_COMMAND: "./deploy/moode/tikpal-bluetooth-capture.sh",
      TIKPAL_BLUETOOTH_CAPTURE_MOCK: "1",
      TIKPAL_BLUETOOTH_CAPTURE_MOCK_FILE: BLUETOOTH_SCENARIO_PATH,
      TIKPAL_BLUETOOTH_RECOGNITION_SETTLE_MS: "700",
      TIKPAL_BLUETOOTH_RECOGNITION_RETRY_MS: "45000",
      TIKPAL_BLUETOOTH_RECOGNITION_NOT_FOUND_RETRY_MS: "300",
      TIKPAL_AIRPLAY_RECOGNITION_SETTLE_MS: "1",
      TIKPAL_AIRPLAY_CAPTURE_DURATION_SECONDS: "1",
      TIKPAL_MOCK_BLUETOOTH_CONNECT_AFTER_MS: "150",
      TIKPAL_MOCK_BLUETOOTH_METADATA_FILE: BLUETOOTH_METADATA_PATH,
      TIKPAL_LRCLIB_BASE_URL: PROVIDER_URL,
      TIKPAL_THEAUDIODB_BASE_URL: PROVIDER_URL
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
    assert(initial.body.playback.settings.playMode === "sequence", "playback should expose sequence mode by default");
    assert(initial.body.audio.currentSource.id === "mpd", "system state should expose current audio source");
    assert(initial.body.audio.rememberedSource === null, "system state should expose empty remembered source before source selection");
    assert(initial.body.lyrics?.sourceScope === "local_playback", "system state should expose lyrics state");

    const initialExperience = await request("/api/v1/experience/state");
    assert(initialExperience.response.ok, "room experience state should return 200");
    assert(initialExperience.body.mode === "calm", "room experience should default to calm");
    assert(initialExperience.body.phase === "idle", "room experience should start idle");
    assert(initialExperience.body.sceneVideoId === "rainy-window", "calm room experience should bind Rainy Window");
    assert(initialExperience.body.hifiEqPresetId === "flat", "room experience should expose the default Hi-Fi EQ preset");
    assert(initialExperience.body.hifiVisualPresetId === "spectrum-bars", "room experience should expose the default Hi-Fi visual preset");
    assert(initialExperience.body.sceneSoundEnabled === false, "mock room experience should preserve persisted scene sound off");
    assert(initialExperience.body.nightSchedule.timeZone === "Asia/Shanghai", "room experience should expose night timezone");
    assert(initial.body.system.dspState.presetId === "flat", "DSP state should reflect the default Hi-Fi EQ preset id");
    assert(initial.body.system.dspState.presetLabel === "Flat", "DSP state should reflect the default Hi-Fi EQ preset label");
    assert(initial.body.system.dspState.controllable === true, "mock DSP state should be controllable");
    assert(initial.body.system.dspState.availablePresets.length === 3, "DSP state should expose the three built-in Hi-Fi EQ presets");

    const unseenHeartbeat = await request("/api/v1/kiosk/heartbeat");
    assert(unseenHeartbeat.response.ok, "kiosk heartbeat read should return 200 before the first heartbeat");
    assert(unseenHeartbeat.body.status === "unseen", "kiosk heartbeat should start unseen");
    assert(unseenHeartbeat.body.healthy === false, "unseen kiosk heartbeat should be unhealthy");
    assert(unseenHeartbeat.body.reasons.includes("heartbeat-unseen"), "unseen kiosk heartbeat should explain the missing page heartbeat");

    const healthyHeartbeatPayload = {
      clientSentAtMs: Date.now(),
      pageMode: "ambient",
      room: { mode: "calm", phase: "idle" },
      playback: { source: "scene", state: "playing", title: "Scene Audio" },
      source: { current: "scene" },
      scene: {
        videoId: "rainy-window",
        activeVideoId: "rainy-window",
        sceneSoundEnabled: true,
        sceneVideoEnabled: true
      },
      status: {
        lastSystemStateSuccessAtMs: Date.now(),
        lastRoomStateSuccessAtMs: Date.now(),
        pending: { active: false, kind: null, sinceMs: null, durationMs: null }
      },
      eventLoop: { lagMs: 4 },
      activeSceneVideo: {
        present: true,
        src: "/assets/scenes/Rainy-Window.mp4",
        currentTime: 2.4,
        readyState: 4,
        health: "ok",
        frameReady: "true"
      }
    };
    const postedHeartbeat = await request("/api/v1/kiosk/heartbeat", {
      method: "POST",
      body: JSON.stringify(healthyHeartbeatPayload)
    });
    assert(postedHeartbeat.response.ok, "kiosk heartbeat write should return 200");
    assert(postedHeartbeat.body.status === "fresh", "fresh kiosk heartbeat should report fresh");
    assert(postedHeartbeat.body.healthy === true, "healthy kiosk heartbeat should be healthy");
    const freshHeartbeat = await request("/api/v1/kiosk/heartbeat");
    assert(freshHeartbeat.body.healthy === true, "kiosk heartbeat read should return the latest healthy heartbeat");

    const pendingHeartbeat = await request("/api/v1/kiosk/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        ...healthyHeartbeatPayload,
        status: {
          ...healthyHeartbeatPayload.status,
          pending: { active: true, kind: "source:mpd", sinceMs: Date.now() - 60000, durationMs: 60000 }
        }
      })
    });
    assert(pendingHeartbeat.body.healthy === false, "stuck pending kiosk heartbeat should be unhealthy");
    assert(pendingHeartbeat.body.reasons.some((reason) => reason.startsWith("pending-stuck:source:mpd")), "stuck pending heartbeat should include the action kind");

    const fallbackHeartbeat = await request("/api/v1/kiosk/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        ...healthyHeartbeatPayload,
        activeSceneVideo: {
          ...healthyHeartbeatPayload.activeSceneVideo,
          health: "fallback"
        }
      })
    });
    assert(fallbackHeartbeat.body.healthy === false, "scene fallback heartbeat should be unhealthy");
    assert(fallbackHeartbeat.body.reasons.includes("scene-video-fallback"), "scene fallback heartbeat should expose scene-video-fallback");

    const transitionHeartbeat = await request("/api/v1/kiosk/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        ...healthyHeartbeatPayload,
        activeSceneVideo: {
          present: false,
          scenePresent: true,
          transition: "scene",
          transitionPhase: "dimming"
        }
      })
    });
    assert(transitionHeartbeat.body.healthy === true, "scene transition heartbeat should not be treated as a missing-video failure");

    await request("/api/v1/kiosk/heartbeat", {
      method: "POST",
      body: JSON.stringify(healthyHeartbeatPayload)
    });
    await wait(1100);
    const staleHeartbeat = await request("/api/v1/kiosk/heartbeat");
    assert(staleHeartbeat.body.status === "stale", "old kiosk heartbeat should become stale");
    assert(staleHeartbeat.body.reasons.includes("heartbeat-stale"), "stale kiosk heartbeat should expose heartbeat-stale");

    const sceneContext = await request("/api/v1/scene/context?timeZone=Europe/London");
    assert(sceneContext.response.ok, "scene context should return 200");
    assert(sceneContext.body.timeZone === "Asia/Shanghai", "scene context should prefer IP timezone over a conflicting requested timezone");
    assert(sceneContext.body.locationLabel === "Shanghai", "scene context should expose IP-derived city");
    assert(sceneContext.body.countryCode === "CN", "scene context should expose IP-derived country code");
    assert(sceneContext.body.weather?.condition === "rainy", "scene context should expose IP-location weather");
    assert(sceneContext.body.weather?.label === "Rainy", "scene context should expose a weather label for ambient copy");
    assert(["morning", "afternoon", "evening", "night"].includes(sceneContext.body.dayPart), "scene context should expose a daypart");

    const openapi = await request("/api/v1/openapi.json");
    assert(openapi.response.ok, "OpenAPI JSON should return 200");
    assert(openapi.response.headers.get("content-type")?.includes("application/json"), "OpenAPI JSON should return JSON");
    assert(openapi.body.openapi === "3.0.3", "OpenAPI JSON should expose OpenAPI 3.0.3");
    assert(openapi.body.paths?.["/remote/actions"]?.post, "OpenAPI JSON should describe remote actions");
    const swagger = await request("/api/v1/swagger.json");
    assert(swagger.response.ok, "Swagger JSON should return 200");
    assert(JSON.stringify(swagger.body.paths) === JSON.stringify(openapi.body.paths), "swagger.json should mirror openapi.json paths");
    const docs = await requestText("/api/v1/docs");
    assert(docs.response.ok, "API docs should return 200");
    assert(docs.response.headers.get("content-type")?.includes("text/html"), "API docs should return HTML");
    assert(docs.body.includes("/api/v1/openapi.json"), "API docs should link to OpenAPI JSON");

    const remoteState = await request("/api/v1/remote/state");
    assert(remoteState.response.ok, "remote state should return 200");
    assert(remoteState.body.playback.title, "remote state should expose playback");
    assert(typeof remoteState.body.volume.percent === "number", "remote state should expose volume");
    assert(remoteState.body.room.mode === "calm", "remote state should expose room mode");
    assert(remoteState.body.scene.videoId === "rainy-window", "remote state should expose scene video id");
    assert(remoteState.body.source.current.id === "mpd", "remote state should expose current source");
    assert(remoteState.body.hifi.eqPresetId === "flat", "remote state should expose Hi-Fi EQ");
    assert(remoteState.body.display.transport === "mock", "remote state should expose display transport");
    const remoteCatalog = await request("/api/v1/remote/catalog");
    assert(remoteCatalog.response.ok, "remote catalog should return 200");
    assert(remoteCatalog.body.allowedActions.includes("playback.play_pause"), "remote catalog should expose allowed action ids");
    assert(remoteCatalog.body.sourceTargets.includes("mpd") && !remoteCatalog.body.sourceTargets.includes("scene"), "remote catalog should expose only portable source targets");
    assert(remoteCatalog.body.roomModes.some((mode) => mode.id === "hifi"), "remote catalog should expose room modes");
    assert(remoteCatalog.body.sceneVideos.some((video) => video.id === "rainy-window"), "remote catalog should expose scene videos");
    assert(remoteCatalog.body.hifiEqPresets.map((preset) => preset.id).join(",") === "flat,warm,vocal", "remote catalog should expose Hi-Fi EQ presets");

    const remoteMissingKey = await request("/api/v1/remote/actions", {
      method: "POST",
      body: JSON.stringify({ type: "playback.play_pause" })
    });
    assert(remoteMissingKey.response.status === 403, "remote actions should require X-Tikpal-Key");
    assert(remoteMissingKey.body.error === "FORBIDDEN", "remote actions without key should return FORBIDDEN");
    const remoteWrongKey = await request("/api/v1/remote/actions", {
      method: "POST",
      headers: { "X-Tikpal-Key": "wrong" },
      body: JSON.stringify({ type: "playback.play_pause" })
    });
    assert(remoteWrongKey.response.status === 403, "remote actions should reject wrong X-Tikpal-Key");

    const focusExperience = await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_mode", mode: "focus" })
    });
    assert(focusExperience.response.ok, "set_mode experience action should return 200");
    assert(focusExperience.body.mode === "focus", "set_mode should switch room mode");
    assert(focusExperience.body.presetId === "focus-library-flow", "set_mode should apply focus preset");
    assert(focusExperience.body.sceneVideoId === "midnight-library", "focus preset should bind Midnight Library");
    assert(focusExperience.body.sceneSoundEnabled === true, "focus preset should enable scene sound by default");
    const persistedExperience = JSON.parse(await readFile(roomExperienceStatePath, "utf8"));
    assert(persistedExperience.mode === "focus", "room experience should persist to the state file");
    const stateAfterFocus = await request("/api/v1/system/state");
    assert(stateAfterFocus.body.audio.currentSource.id === "scene", "focus room mode should switch to Scene Sound");
    assert(stateAfterFocus.body.playback.source === "scene", "focus room mode playback should follow Scene Sound");
    assert(stateAfterFocus.body.system.volume.percent === focusExperience.body.volumePercent, "room mode should apply volume through playback actions");
    assert(stateAfterFocus.body.system.display.brightnessPercent === focusExperience.body.brightnessPercent, "room mode should apply brightness through system actions");

    const focusSceneSound = await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_scene_sound", sceneSoundEnabled: true, sceneVideoId: "rainy-window" })
    });
    assert(focusSceneSound.response.ok, "set_scene_sound should return 200");
    assert(focusSceneSound.body.sceneSoundEnabled === true, "explicit scene sound should persist on");
    const stateAfterSceneSound = await request("/api/v1/system/state");
    assert(stateAfterSceneSound.body.audio.currentSource.id === "scene", "explicit scene sound should switch to Scene Sound");
    assert(stateAfterSceneSound.body.audio.sources.some((source) => source.id === "spotify" && source.armed === false), "scene sound should close spotify intake");
    assert(stateAfterSceneSound.body.audio.sources.some((source) => source.id === "bluetooth" && source.armed === false), "scene sound should close bluetooth intake");
    assert(stateAfterSceneSound.body.audio.sources.some((source) => source.id === "airplay" && source.armed === false), "scene sound should close airplay intake");
    assert(stateAfterSceneSound.body.audio.sources.some((source) => source.id === "upnp" && source.armed === false), "scene sound should close dlna intake");

    const hifiExperience = await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_mode", mode: "hifi" })
    });
    assert(hifiExperience.response.ok, "hifi room mode action should return 200");
    assert(hifiExperience.body.mode === "hifi", "hifi action should switch room mode");
    assert(hifiExperience.body.sceneSoundEnabled === false, "hifi should keep scene sound disabled");
    assert(hifiExperience.body.hifiEqPresetId === "flat", "hifi should keep the existing EQ preset");
    assert(hifiExperience.body.hifiVisualPresetId === "spectrum-bars", "hifi should keep the default visual preset");
    const stateAfterHifi = await request("/api/v1/system/state");
    assert(stateAfterHifi.body.audio.currentSource.id === "mpd", "hifi should return from Scene Sound to MPD without selecting scene");

    const hifiEq = await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_hifi_eq", hifiEqPresetId: "warm" })
    });
    assert(hifiEq.response.ok, "set_hifi_eq should return 200 in mock mode");
    assert(hifiEq.body.hifiEqPresetId === "warm", "set_hifi_eq should persist the selected EQ preset");
    assert(hifiEq.body.hifiVisualPresetId === "waveform", "set_hifi_eq should derive the compatibility visual preset");
    const stateAfterHifiEq = await request("/api/v1/system/state");
    assert(stateAfterHifiEq.body.system.dspState.presetId === "warm", "DSP state should reflect set_hifi_eq preset id");
    assert(stateAfterHifiEq.body.system.dspState.presetLabel === "Warm", "DSP state should reflect set_hifi_eq preset label");
    assert(stateAfterHifiEq.body.system.dspState.availablePresets.map((preset) => preset.id).join(",") === "flat,warm,vocal", "DSP state should list flat, warm, and vocal presets");

    const spectrum = await request("/api/v1/audio/spectrum");
    assert(spectrum.response.ok, "audio spectrum should return 200");
    assert(Array.isArray(spectrum.body.bands) && spectrum.body.bands.length === 32, "audio spectrum should expose 32 normalized bands");
    assert(spectrum.body.bands.every((band) => typeof band === "number" && band >= 0 && band <= 1), "audio spectrum bands should be normalized");
    assert(typeof spectrum.body.peaks?.left === "number" && spectrum.body.peaks.left >= 0 && spectrum.body.peaks.left <= 1, "audio spectrum should expose normalized left peak");
    assert(typeof spectrum.body.peaks?.right === "number" && spectrum.body.peaks.right >= 0 && spectrum.body.peaks.right <= 1, "audio spectrum should expose normalized right peak");
    assert(spectrum.body.source === "mock", "audio spectrum should be mock-backed by default");

    const nightTimeZone = findCurrentNightTimeZone();
    const nightEntry = await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({
        type: "update_night_schedule",
        nightSchedule: {
          enabled: true,
          timeZone: nightTimeZone,
          start: "22:30",
          end: "06:30",
          brightnessPercent: 5
        }
      })
    });
    assert(nightEntry.response.ok, "night schedule update should return 200");
    assert(nightEntry.body.nightSchedule.active === true, "night schedule should enter night in a timezone currently inside the cross-midnight window");
    const stateDuringNight = await request("/api/v1/system/state");
    assert(stateDuringNight.body.system.display.brightnessPercent === 5, "auto night should lower brightness");
    assert(stateDuringNight.body.audio.currentSource.id === "mpd", "auto night should not switch audio source");
    const invalidTimeZone = await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "update_night_schedule", nightSchedule: { timeZone: "Mars/Olympus" } })
    });
    assert(invalidTimeZone.response.status === 400, "invalid timezone should return 400");
    const nightExit = await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "update_night_schedule", nightSchedule: { enabled: false } })
    });
    assert(nightExit.response.ok, "disabling night schedule should return 200");
    assert(nightExit.body.nightSchedule.active === false, "disabling night schedule should exit night mode");
    const stateAfterNight = await request("/api/v1/system/state");
    assert(stateAfterNight.body.system.display.brightnessPercent === stateAfterHifi.body.system.display.brightnessPercent, "auto night should restore the prior brightness when disabled");

    const initialLyrics = await waitForLyricsStatus(["ready"]);
    assert(initialLyrics.synced === true, "initial MPD track should resolve synced lyrics");
    assert(initialLyrics.lines.length >= 2, "synced lyrics should include lines");

    const sources = await request("/api/v1/audio/sources");
    assert(sources.response.ok, "audio sources should return 200");
    assert(Array.isArray(sources.body.sources) && sources.body.sources.length === 8, "audio sources should return Library, Radio, Scene Sound, Audio, Spotify Connect, Bluetooth, AirPlay, and DLNA");
    assert(sources.body.currentSource.id === "mpd", "audio source payload should be on MPD after Hi-Fi and night checks");
    assert(sources.body.sources.some((source) => source.id === "scene"), "audio sources payload should include scene sound");
    assert(sources.body.sources.some((source) => source.id === "audio"), "audio sources payload should include audio");
    assert(sources.body.sources.some((source) => source.id === "spotify"), "audio sources payload should include spotify connect");
    assert(sources.body.sources.some((source) => source.id === "bluetooth"), "audio sources payload should include bluetooth");
    assert(sources.body.sources.some((source) => source.id === "airplay"), "audio sources payload should include airplay");
    assert(sources.body.sources.some((source) => source.id === "upnp"), "audio sources payload should include dlna");
    assert(sources.body.sources.some((source) => source.id === "spotify" && source.connectionState === "blocked" && source.availability === "waiting"), "spotify should start closed until selected");
    assert(sources.body.sources.some((source) => source.id === "bluetooth" && source.connectionState === "blocked" && source.availability === "waiting"), "bluetooth should start closed until selected");
    assert(sources.body.sources.some((source) => source.id === "airplay" && source.connectionState === "blocked" && source.availability === "waiting"), "airplay should start closed until selected");
    assert(sources.body.sources.some((source) => source.id === "upnp" && source.connectionState === "blocked" && source.availability === "waiting"), "dlna should start closed until selected");
    assert(sources.body.sources.some((source) => source.id === "bluetooth" && source.advertisedLabel === "Tikpal Speaker"), "bluetooth source should expose advertised device name");
    assert(sources.body.sources.some((source) => source.id === "upnp" && source.advertisedLabel === "Tikpal Speaker"), "dlna source should expose advertised renderer name");

    const localLibrary = await request("/api/v1/audio/library?storage=local&limit=5");
    assert(localLibrary.response.ok, "local audio library should return 200");
    assert(localLibrary.body.total > 0, "local audio library should load tracks from the manifest");
    assert(Array.isArray(localLibrary.body.sources) && localLibrary.body.sources.length === 6, "library source metadata should expose six visible source categories");
    assert(JSON.stringify(localLibrary.body.sources.map((source) => source.label)) === JSON.stringify(["Library", "Radio", "Spotify", "AirPlay", "Bluetooth", "DLNA"]), "library source metadata should expose the visible Player rail order");
    assert(localLibrary.body.sources.every((source) => source.id !== "audio"), "library source metadata should not expose audio as a visible category");
    assert(localLibrary.body.sources.every((source) => source.id !== "playlist"), "library source metadata should not expose playlist as a Player source category");
    assert(localLibrary.body.sources.some((source) => source.id === "upnp" && source.label === "DLNA"), "library source metadata should expose DLNA as a visible category");
    assert(localLibrary.body.storages.find((storage) => storage.id === "local")?.trackCount === localLibrary.body.total, "local storage track count should match manifest-backed total");
    assert(localLibrary.body.tracks.every((track) => track.storage === "local"), "local audio library should only return local tracks when filtered");
    assert(localLibrary.body.tracks[0]?.path, "local audio library tracks should expose manifest paths");
    assert(localLibrary.body.tracks[0]?.albumArtUrl, "local audio library tracks should expose cover art URLs");
    assert(localLibrary.body.tracks[0]?.albumArtLabel, "generic local library folder covers should expose overlay labels");
    assert(localLibrary.body.total === 39, "local audio library should keep the 39-track manifest total");
    const localStorage = localLibrary.body.storages.find((storage) => storage.id === "local");
    assert(localStorage, "local storage metadata should exist");
    const localCategoryIds = localStorage.categories.map((category) => category.id);
    assert(JSON.stringify(localCategoryIds) === JSON.stringify(["focus", "meditation", "rest"]), "local category ids should stay focus, meditation, rest");
    const expectedSubCategories = {
      focus: ["Lo-fi / Ambient", "Classical / Piano", "Binaural / Alpha / Theta", "White Noise / Brown Noise"],
      meditation: ["Guided Meditation", "Breathing", "Singing Bowl", "Nature Sounds"],
      rest: ["Nap", "Sleep", "Rain / Ocean / Forest", "Deep Sleep Long Tracks"]
    };
    for (const category of localStorage.categories) {
      assert(
        JSON.stringify(category.subCategories.map((subCategory) => subCategory.label)) === JSON.stringify(expectedSubCategories[category.id]),
        `${category.id} local subcategories should match the curated taxonomy order`
      );
    }
    const meditationLibrary = await request("/api/v1/audio/library?storage=local&category=meditation&limit=500");
    assert(meditationLibrary.response.ok, "meditation library should return 200");
    assert(meditationLibrary.body.tracks.length > 0, "meditation library should include manifest-backed tracks");
    assert(meditationLibrary.body.tracks.every((track) => track.categoryId === "meditation"), "meditation library should only include meditation category tracks");
    assert(
      meditationLibrary.body.tracks.every((track) => !["Deep Sleep Long Tracks", "Sleep", "Rain / Ocean / Forest", "Nap"].includes(track.subCategory)),
      "meditation subcategories should not include rest folders"
    );
    const localCover = await requestBinary(localLibrary.body.tracks[0].albumArtUrl);
    assert(localCover.response.ok, "local library cover should return 200");
    assert(localCover.response.headers.get("content-type")?.startsWith("image/"), "local library cover should be served as an image");
    assert(localCover.body.length > 0, "local library cover should not be empty");
    const localTrackSwitch = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "mpd", localTrackPath: localLibrary.body.tracks[0].path })
    });
    assert(localTrackSwitch.response.ok, "local track source switch should return 200");
    assert(localTrackSwitch.body.audio.currentSource.id === "mpd", "local track switch should keep MPD as the current source");
    assert(localTrackSwitch.body.playback.title === localLibrary.body.tracks[0].title, "local track switch should update playback title");
    assert(localTrackSwitch.body.playback.artist === localLibrary.body.tracks[0].artist, "local track switch should update playback artist");
    assert(localTrackSwitch.body.playback.albumArtUrl === localLibrary.body.tracks[0].albumArtUrl, "local track switch should update playback cover art");
    assert(localTrackSwitch.body.audio.rememberedSource?.target === "mpd", "local track switch should remember Library as the last source");
    assert(localTrackSwitch.body.audio.rememberedSource?.localTrackPath === localLibrary.body.tracks[0].path, "local track switch should remember the selected library track");

    const radioAfterLocalTrack = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "radio", radioStationId: "radio-2" })
    });
    assert(radioAfterLocalTrack.response.ok, "radio switch after local track should return 200");
    assert(radioAfterLocalTrack.body.audio.rememberedSource?.target === "radio", "radio switch should remain the remembered visible source");
    assert(radioAfterLocalTrack.body.audio.rememberedSource?.radioStationId === "radio-2", "radio switch should remember the selected station");
    assert(radioAfterLocalTrack.body.audio.rememberedSource?.localTrackPath === localLibrary.body.tracks[0].path, "radio switch should preserve the last local library track path");
    const libraryReturnAfterRadio = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "mpd" })
    });
    assert(libraryReturnAfterRadio.response.ok, "bare Library switch after Radio should return 200");
    assert(libraryReturnAfterRadio.body.audio.currentSource.id === "mpd", "bare Library switch after Radio should restore MPD");
    assert(libraryReturnAfterRadio.body.playback.title === localLibrary.body.tracks[0].title, "bare Library switch after Radio should restore the last local track");
    assert(libraryReturnAfterRadio.body.audio.rememberedSource?.target === "mpd", "bare Library switch after Radio should remember Library as the last source");
    assert(libraryReturnAfterRadio.body.audio.rememberedSource?.localTrackPath === localLibrary.body.tracks[0].path, "bare Library switch after Radio should remember the restored local track");
    assert(libraryReturnAfterRadio.body.audio.rememberedSource?.radioStationId === "radio-2", "bare Library switch after Radio should preserve the previous station bookmark");
    const radioReturnAfterLibrary = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "radio" })
    });
    assert(radioReturnAfterLibrary.response.ok, "bare Radio switch after Library should return 200");
    assert(radioReturnAfterLibrary.body.audio.currentSource.id === "radio", "bare Radio switch after Library should restore Radio");
    assert(radioReturnAfterLibrary.body.audio.currentSource.radioStationId === "radio-2", "bare Radio switch after Library should restore the previous station");
    assert(radioReturnAfterLibrary.body.audio.rememberedSource?.radioStationId === "radio-2", "bare Radio switch after Library should keep the restored station in memory");
    const libraryReturnAfterBareRadio = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "mpd" })
    });
    assert(libraryReturnAfterBareRadio.response.ok, "Library switch after bare Radio restore should return 200");
    assert(libraryReturnAfterBareRadio.body.playback.title === localLibrary.body.tracks[0].title, "Library switch after bare Radio restore should return to the remembered local track");

    const favoriteToggle = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "favorite_toggle" })
    });
    assert(favoriteToggle.response.ok, "favorite_toggle should return 200 for the current local track");
    assert(favoriteToggle.body.playback.favorite === true, "favorite_toggle should mark the current local track as favorite");
    const favorites = await request("/api/v1/audio/library?storage=favorites&limit=50");
    assert(favorites.response.ok, "favorites library should return 200");
    assert(favorites.body.total === 1, "favorites library should include the saved local track");
    assert(favorites.body.tracks[0]?.path === localLibrary.body.tracks[0].path, "favorites library should return the favorited track path");
    assert(favorites.body.tracks[0]?.favorite === true, "favorites library tracks should expose favorite=true");

    const favoriteRemove = await request("/api/v1/audio/favorites", {
      method: "POST",
      body: JSON.stringify({ trackPath: localLibrary.body.tracks[0].path, favorite: false })
    });
    assert(favoriteRemove.response.ok, "favorite remove endpoint should return 200");
    assert(favoriteRemove.body.playback.favorite === false, "favorite remove endpoint should update playback favorite state");
    const favoriteAdd = await request("/api/v1/audio/favorites", {
      method: "POST",
      body: JSON.stringify({ trackPath: localLibrary.body.tracks[0].path, favorite: true })
    });
    assert(favoriteAdd.response.ok, "favorite add endpoint should return 200");
    assert(favoriteAdd.body.playback.favorite === true, "favorite add endpoint should update playback favorite state");
    const persistedState = JSON.parse(await readFile(musicLibraryStatePath, "utf8"));
    assert(persistedState.favorites.trackPaths.includes(localLibrary.body.tracks[0].path), "favorites should persist to the music library state file");

    const initialPlaylists = await request("/api/v1/audio/playlists");
    assert(initialPlaylists.response.ok, "playlists endpoint should return 200");
    assert(initialPlaylists.body.playlists.filter((playlist) => playlist.source === "curated").length >= 15, "playlists endpoint should expose curated readonly playlists");
    assert(initialPlaylists.body.playlists.every((playlist) => playlist.source !== "curated" || playlist.readOnly === true), "curated playlists should be readonly");
    assert(initialPlaylists.body.playlists.every((playlist) => Array.isArray(playlist.moodTags)), "playlists should expose mood tags");
    assert(initialPlaylists.body.playlists.every((playlist) => typeof playlist.coverType === "string"), "playlists should expose cover type");
    const playlistCreate = await request("/api/v1/audio/playlists", {
      method: "POST",
      body: JSON.stringify({
        name: "Smoke List",
        moodTags: ["Calm"],
        coverType: "scene",
        coverValue: "rain",
        trackPaths: [localLibrary.body.tracks[0].path]
      })
    });
    assert(playlistCreate.response.ok, "playlist creation should return 200");
    const createdPlaylist = playlistCreate.body.playlists.find((playlist) => playlist.source === "user" && playlist.name === "Smoke List");
    assert(createdPlaylist, "playlist creation should return the new user playlist");
    assert(createdPlaylist.trackCount === 1, "playlist creation should accept initial tracks");
    assert(createdPlaylist.moodTags.includes("Calm"), "playlist creation should persist mood tags");
    assert(createdPlaylist.coverType === "scene" && createdPlaylist.coverValue === "rain", "playlist creation should persist cover metadata");
    const playlistRename = await request("/api/v1/audio/playlist-actions", {
      method: "POST",
      body: JSON.stringify({ type: "rename", playlistId: createdPlaylist.id, name: "Smoke Renamed" })
    });
    assert(playlistRename.response.ok, "playlist rename should return 200");
    assert(playlistRename.body.playlists.some((playlist) => playlist.id === createdPlaylist.id && playlist.name === "Smoke Renamed"), "playlist rename should update the user playlist");
    const playlistMetadata = await request("/api/v1/audio/playlist-actions", {
      method: "POST",
      body: JSON.stringify({
        type: "update_metadata",
        playlistId: createdPlaylist.id,
        name: "Smoke Updated",
        description: "Smoke metadata update",
        moodTags: ["Sleep", "Fireplace"],
        coverType: "collage",
        coverValue: "album-collage"
      })
    });
    assert(playlistMetadata.response.ok, "playlist update_metadata should return 200");
    const metadataPlaylist = playlistMetadata.body.playlists.find((playlist) => playlist.id === createdPlaylist.id);
    assert(metadataPlaylist.name === "Smoke Updated", "playlist update_metadata should update name");
    assert(metadataPlaylist.description === "Smoke metadata update", "playlist update_metadata should update description");
    assert(metadataPlaylist.moodTags.includes("Sleep") && metadataPlaylist.moodTags.includes("Fireplace"), "playlist update_metadata should update mood tags");
    assert(metadataPlaylist.coverType === "collage" && metadataPlaylist.coverValue === "album-collage", "playlist update_metadata should update cover metadata");
    const playlistAddSecond = await request("/api/v1/audio/playlist-actions", {
      method: "POST",
      body: JSON.stringify({ type: "add_track", playlistId: createdPlaylist.id, trackPath: localLibrary.body.tracks[1].path })
    });
    assert(playlistAddSecond.response.ok, "playlist add_track should accept a second track");
    assert(playlistAddSecond.body.playlists.find((playlist) => playlist.id === createdPlaylist.id)?.trackCount === 2, "playlist should expose added track count");
    const playlistMove = await request("/api/v1/audio/playlist-actions", {
      method: "POST",
      body: JSON.stringify({ type: "move_track", playlistId: createdPlaylist.id, fromIndex: 1, toIndex: 0 })
    });
    assert(playlistMove.response.ok, "playlist move_track should return 200");
    assert(playlistMove.body.playlists.find((playlist) => playlist.id === createdPlaylist.id)?.tracks[0]?.path === localLibrary.body.tracks[1].path, "playlist move_track should reorder tracks");
    const playlistDuplicate = await request("/api/v1/audio/playlist-actions", {
      method: "POST",
      body: JSON.stringify({ type: "duplicate", playlistId: createdPlaylist.id })
    });
    assert(playlistDuplicate.response.ok, "playlist duplicate should return 200");
    const duplicatedPlaylist = playlistDuplicate.body.playlists.find((playlist) => playlist.source === "user" && playlist.name === "Smoke Updated Copy");
    assert(duplicatedPlaylist, "playlist duplicate should create an editable copy");
    assert(duplicatedPlaylist.readOnly === false && duplicatedPlaylist.trackCount === 2, "playlist duplicate should preserve tracks as editable");
    assert(duplicatedPlaylist.coverType === "collage", "playlist duplicate should preserve cover metadata");
    const curatedPlaylist = initialPlaylists.body.playlists.find((playlist) => playlist.source === "curated");
    const curatedDuplicate = await request("/api/v1/audio/playlist-actions", {
      method: "POST",
      body: JSON.stringify({ type: "duplicate", playlistId: curatedPlaylist.id, name: "Curated Copy" })
    });
    assert(curatedDuplicate.response.ok, "curated playlist duplicate should return 200");
    const curatedCopy = curatedDuplicate.body.playlists.find((playlist) => playlist.source === "user" && playlist.name === "Curated Copy");
    assert(curatedCopy && curatedCopy.readOnly === false, "curated playlist duplicate should create an editable user playlist");
    const playlistPlay = await request("/api/v1/audio/playlist-actions", {
      method: "POST",
      body: JSON.stringify({ type: "play", playlistId: createdPlaylist.id })
    });
    assert(playlistPlay.response.ok, "playlist play should return 200");
    const playlistPlayback = await request("/api/v1/system/state");
    assert(playlistPlayback.response.ok, "system state after playlist play should return 200");
    assert(playlistPlayback.body.audio.currentSource.id === "mpd", "playlist play should keep MPD as the active source");
    assert(playlistPlayback.body.playback.queueLength === 2, "playlist play should load a mock local queue");
    assert(playlistPlayback.body.playback.title === localLibrary.body.tracks[1].title, "playlist play should start from the reordered first track");
    assert(playlistPlayback.body.audio.rememberedSource?.localTrackPath === localLibrary.body.tracks[1].path, "playlist play should remember the actual starting track");
    assert(playlistPlayback.body.audio.rememberedSource?.radioStationId === "radio-2", "playlist play should preserve the last Radio station bookmark");
    const playlistNext = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "next" })
    });
    assert(playlistNext.response.ok, "playlist-backed next should return 200");
    assert(playlistNext.body.playback.currentTrackIndex === 2, "playlist-backed next should advance within the local queue");
    assert(playlistNext.body.audio.rememberedSource?.localTrackPath === localLibrary.body.tracks[0].path, "playlist-backed next should remember the advanced local track");
    assert(playlistNext.body.audio.rememberedSource?.radioStationId === "radio-2", "playlist-backed next should preserve the last Radio station bookmark");
    const playlistPlaySecond = await request("/api/v1/audio/playlist-actions", {
      method: "POST",
      body: JSON.stringify({ type: "play", playlistId: createdPlaylist.id, startIndex: 1 })
    });
    assert(playlistPlaySecond.response.ok, "playlist play should accept startIndex");
    const playlistSecondPlayback = await request("/api/v1/system/state");
    assert(playlistSecondPlayback.response.ok, "system state after playlist startIndex play should return 200");
    assert(playlistSecondPlayback.body.playback.currentTrackIndex === 2, "playlist play startIndex should set the playback queue index");
    assert(playlistSecondPlayback.body.playback.title === localLibrary.body.tracks[0].title, "playlist play startIndex should start from the requested song");
    assert(playlistSecondPlayback.body.audio.rememberedSource?.localTrackPath === localLibrary.body.tracks[0].path, "playlist play startIndex should remember the requested song");
    const playlistPrevious = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "previous" })
    });
    assert(playlistPrevious.response.ok, "playlist-backed previous should return 200");
    assert(playlistPrevious.body.playback.currentTrackIndex === 1, "playlist-backed previous should return to the prior local queue entry");
    assert(playlistPrevious.body.audio.rememberedSource?.localTrackPath === localLibrary.body.tracks[1].path, "playlist-backed previous should remember the previous local track");
    const playlistRemove = await request("/api/v1/audio/playlist-actions", {
      method: "POST",
      body: JSON.stringify({ type: "remove_track", playlistId: createdPlaylist.id, trackPath: localLibrary.body.tracks[1].path })
    });
    assert(playlistRemove.response.ok, "playlist remove_track should return 200");
    assert(playlistRemove.body.playlists.find((playlist) => playlist.id === createdPlaylist.id)?.trackCount === 1, "playlist remove_track should reduce track count");
    const playlistDelete = await request("/api/v1/audio/playlist-actions", {
      method: "POST",
      body: JSON.stringify({ type: "delete", playlistId: createdPlaylist.id })
    });
    assert(playlistDelete.response.ok, "playlist delete should return 200");
    assert(!playlistDelete.body.playlists.some((playlist) => playlist.id === createdPlaylist.id), "playlist delete should remove the user playlist");
    const playbackAfterDelete = await request("/api/v1/system/state");
    assert(playbackAfterDelete.response.ok, "system state after playlist delete should return 200");
    assert(playbackAfterDelete.body.playback.queueLength === 2, "playlist delete should not stop the already loaded playback queue");
    const duplicateDelete = await request("/api/v1/audio/playlist-actions", {
      method: "POST",
      body: JSON.stringify({ type: "delete", playlistId: duplicatedPlaylist.id })
    });
    assert(duplicateDelete.response.ok, "playlist duplicate cleanup should return 200");
    const curatedCopyDelete = await request("/api/v1/audio/playlist-actions", {
      method: "POST",
      body: JSON.stringify({ type: "delete", playlistId: curatedCopy.id })
    });
    assert(curatedCopyDelete.response.ok, "curated copy cleanup should return 200");
    const defaultLibraryResume = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "mpd" })
    });
    assert(defaultLibraryResume.response.ok, "default MPD resume after playlist smoke should return 200");
    assert(defaultLibraryResume.body.playback.title === "Get Lucky (feat. Pharrell Williams)", "default MPD resume should restore the mock library queue");
    assert(defaultLibraryResume.body.audio.rememberedSource?.localTrackPath === null, "default MPD resume while already in Library should not keep a stale local track path");

    const repeatOne = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "play_mode_set", mode: "repeat_one" })
    });
    assert(repeatOne.response.ok, "repeat_one play mode should return 200");
    assert(repeatOne.body.playback.settings.playMode === "repeat_one", "repeat_one should enable single-track repeat");
    assert(repeatOne.body.playback.settings.playMode !== "shuffle", "repeat_one should not leave shuffle active");
    const shuffleOn = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "play_mode_set", mode: "shuffle" })
    });
    assert(shuffleOn.response.ok, "shuffle play mode should return 200");
    assert(shuffleOn.body.playback.settings.playMode === "shuffle", "shuffle should enable random playback");
    assert(shuffleOn.body.playback.settings.playMode !== "repeat_one", "shuffle should turn repeat_one off");
    const sequenceMode = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "play_mode_set", mode: "sequence" })
    });
    assert(sequenceMode.response.ok, "sequence play mode should return 200");
    assert(sequenceMode.body.playback.settings.playMode === "sequence", "sequence should restore ordinary playback");
    const invalidPlayMode = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "play_mode_set", mode: "bad_mode" })
    });
    assert(invalidPlayMode.response.status === 400, "invalid play mode should return 400");

    const backgroundVideos = await request("/api/v1/media/background-videos");
    assert(backgroundVideos.response.ok, "background video catalog should return 200");
    assert(backgroundVideos.body.total >= 2, "background video catalog should include legacy and scene MP4s");
    assert(backgroundVideos.body.videos.every((video) => video.src.startsWith("/assets/") && video.src.endsWith(".mp4")), "background videos should expose asset MP4 URLs");
    const rainyWindow = backgroundVideos.body.videos.find((video) => video.id === "rainy-window");
    assert(rainyWindow?.src === "/assets/scenes/Rainy-Window.mp4", "background video catalog should include Rainy Window scene video");
    assert(rainyWindow?.label === "Rainy Window", "background video catalog should use scene manifest labels");
    assert(rainyWindow?.order === 30, "background video catalog should expose scene manifest order");
    assert(JSON.stringify(rainyWindow?.roomModes) === JSON.stringify(["calm"]), "background video catalog should expose scene room modes");
    assert(rainyWindow?.audioGainDb === 11.1, "background video catalog should expose scene audio gain");
    assert(backgroundVideos.body.catalogVersion, "background video catalog should expose a catalog version");

    const radios = await request("/api/v1/audio/radios?q=groove&category=focus");
    assert(radios.response.ok, "radio catalog should return 200");
    assert(radios.body.total >= 1, "radio catalog should include matching stations");
    assert(radios.body.stations.every((station) => station.category === "focus"), "radio catalog should filter by Tikpal category");

    const artwork = await request("/api/v1/media/artwork?track=mock");
    assert(artwork.response.status === 404, "mock artwork endpoint should return 404 when no current artwork is available");

    const next = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "next" })
    });
    assert(next.response.ok, "next action should return 200");
    assert(next.body.playback.currentTrackIndex === 2, "next action should advance the queue");
    const instantCrushLyrics = await waitForLyricsStatus(["ready"]);
    assert(instantCrushLyrics.synced === false, "plain lyrics should degrade to unsynced mode");
    assert(instantCrushLyrics.lines[0]?.text.includes("I didn't want"), "unsynced lyrics should preserve paragraph text");

    const nextToNotFound = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "next" })
    });
    assert(nextToNotFound.response.ok, "second next action should return 200");
    const missingLyrics = await waitForLyricsStatus(["not_found", "ready"]);
    if (missingLyrics.status === "not_found") {
      assert(missingLyrics.message, "missing lyrics should produce a lightweight message");
    } else {
      assert(missingLyrics.lines.length > 0, "fallback lyric search should return displayable lines when it finds a match");
    }

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

    const calmBeforeScene = await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_mode", mode: "calm" })
    });
    assert(calmBeforeScene.response.ok, "calm room mode before scene source switch should return 200");
    assert(calmBeforeScene.body.sceneSoundEnabled === true, "calm room mode should enable scene sound by default");
    const stateAfterCalmBeforeScene = await request("/api/v1/system/state");
    assert(stateAfterCalmBeforeScene.body.audio.currentSource.id === "scene", "calm room mode should switch to Scene Sound by default");

    const scene = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({
        target: "scene",
        sceneVideoId: "fireplace-loop",
        sceneVideoLabel: "Fireplace Loop",
        sceneVideoSrc: "/assets/output_2560x720-4k.mp4"
      })
    });
    assert(scene.response.ok, "scene source switch should return 200");
    assert(scene.body.audio.currentSource.id === "scene", "scene switch should mark scene as current in mock mode");
    assert(scene.body.playback.source === "scene", "playback source should follow scene switch");
    assert(scene.body.playback.state === "playing", "scene switch should mark video audio as playing");
    assert(scene.body.playback.title === "Scene Audio", "scene playback should expose Scene Audio title");
    assert(scene.body.playback.artist === "Fireplace Loop", "scene playback artist should use the current scene label");
    assert(scene.body.playback.album === "Fireplace Loop", "scene playback album should use the current scene label");
    assert(Array.isArray(scene.body.playback.queuePreview) && scene.body.playback.queuePreview.length === 0, "scene playback should not expose a music queue");
    assert(scene.body.audio.sources.some((source) => source.id === "scene" && source.active), "scene source should be active while scene audio is playing");
    assert(scene.body.audio.rememberedSource?.target === "mpd", "scene switch should not overwrite the remembered music source");
    assert(scene.body.audio.sources.some((source) => source.id === "spotify" && source.armed === false), "scene switch should close spotify intake");
    assert(scene.body.audio.sources.some((source) => source.id === "bluetooth" && source.armed === false), "scene switch should close bluetooth intake");
    assert(scene.body.audio.sources.some((source) => source.id === "airplay" && source.armed === false), "scene switch should close airplay intake");
    assert(scene.body.audio.sources.some((source) => source.id === "upnp" && source.armed === false), "scene switch should close dlna intake");
    const experienceAfterDirectScene = await request("/api/v1/experience/state");
    assert(experienceAfterDirectScene.body.sceneSoundEnabled === true, "direct scene source switch should mark scene sound enabled");

    const sceneNext = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "next" })
    });
    assert(sceneNext.response.ok, "scene next action should return 200");
    assert(sceneNext.body.playback.source === "scene", "scene next should not leave scene playback");
    assert(sceneNext.body.playback.currentTrackIndex === 0, "scene next should not operate the music queue");

    const sceneSeek = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "seek", value: 12 })
    });
    assert(sceneSeek.response.ok, "scene seek action should return 200");
    assert(sceneSeek.body.playback.source === "scene", "scene seek should not leave scene playback");
    assert(sceneSeek.body.playback.elapsedSeconds === null, "scene seek should not expose a music timeline");

    const sceneVolume = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "volume_set", value: 37 })
    });
    assert(sceneVolume.response.ok, "scene volume_set action should return 200");
    assert(sceneVolume.body.system.volume.percent === 37, "scene volume_set should update output volume percent");

    const scenePause = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "pause" })
    });
    assert(scenePause.response.ok, "scene pause action should return 200");
    assert(scenePause.body.playback.source === "scene", "scene pause should keep scene as current source");
    assert(scenePause.body.playback.state === "stopped", "scene pause should stop scene audio without restoring music");

    const libraryResume = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "mpd" })
    });
    assert(libraryResume.response.ok, "library source switch after scene should return 200");
    assert(libraryResume.body.audio.currentSource.id === "mpd", "library resume should mark MPD as the current source");
    assert(libraryResume.body.playback.source === "mpd", "library resume should leave scene playback");
    assert(libraryResume.body.playback.state === "playing", "library resume should start library playback");
    assert(libraryResume.body.audio.sources.some((source) => source.id === "scene" && source.active === false), "library resume should deactivate scene source");
    const experienceAfterLibraryResume = await request("/api/v1/experience/state");
    assert(experienceAfterLibraryResume.body.sceneSoundEnabled === false, "music source switch should clear persisted scene sound");

    const audio = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "audio" })
    });
    assert(audio.response.ok, "audio source switch should return 200");
    assert(audio.body.audio.currentSource.id === "audio", "audio source switch should mark Audio as current in mock mode");
    assert(audio.body.playback.source === "audio", "playback source should follow audio switch");
    assert(audio.body.audio.rememberedSource?.target === "mpd", "internal Audio switch should not overwrite remembered visible source");
    assert(audio.body.audio.sources.some((source) => source.id === "scene" && source.active === false), "audio source switch should deactivate scene");

    const spotify = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "spotify" })
    });
    assert(spotify.response.ok, "spotify connect source switch should return 200");
    assert(spotify.body.audio.currentSource.id === "spotify", "spotify connect switch should activate spotify in mock mode");
    assert(spotify.body.audio.currentSource.armed === true, "spotify connect switch should arm spotify handoff");
    assert(spotify.body.audio.currentSource.connectionState === "armed", "spotify connect source should initially wait for a connected input");
    assert(spotify.body.audio.currentSource.advertisedLabel === "Tikpal Speaker", "spotify connect switch should keep advertised device name in state");
    assert(spotify.body.playback.source === "spotify", "playback source should follow spotify connect switch");
    assert(spotify.body.audio.rememberedSource?.target === "spotify", "spotify handoff should remember Spotify as the last visible source");

    const bluetooth = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "bluetooth" })
    });
    assert(bluetooth.response.ok, "bluetooth source switch should return 200");
    assert(bluetooth.body.audio.currentSource.id === "bluetooth", "bluetooth switch should activate bluetooth in mock mode");
    assert(bluetooth.body.audio.currentSource.armed === true, "bluetooth switch should arm bluetooth intake");
    assert(bluetooth.body.audio.currentSource.advertisedLabel === "Tikpal Speaker", "bluetooth switch should keep advertised device name in state");
    assert(bluetooth.body.playback.source === "bluetooth", "playback source should follow bluetooth switch");
    assert(bluetooth.body.audio.currentSource.connectionState === "armed", "bluetooth source should initially wait for a connected input");
    assert(bluetooth.body.lyrics.status === "idle", "bluetooth lyrics should stay idle until audio connects");
    assert(bluetooth.body.lyrics.sourceScope === "bluetooth_input", "bluetooth idle state should report bluetooth_input scope");

    const bluetoothRecognizing = await waitForLyricsStatus(["recognizing"]);
    assert(bluetoothRecognizing.message === "Listening to Bluetooth audio...", "bluetooth recognition should use bluetooth-specific copy");
    const bluetoothReady = await waitForLyricsStatus(["ready"]);
    assert(bluetoothReady.sourceScope === "bluetooth_input", "bluetooth ready state should report bluetooth_input scope");
    assert(bluetoothReady.recognitionMode === "fingerprint", "bluetooth ready state should report fingerprint mode");
    assert(bluetoothReady.recognitionProvider === "acrcloud", "bluetooth ready state should report acrcloud provider");
    assert(bluetoothReady.recognitionConfidence === 98, "bluetooth ready state should include provider confidence");
    assert(bluetoothReady.title === "Get Lucky (feat. Pharrell Williams)", "bluetooth fingerprint recognition should identify the track");
    assert(bluetoothReady.synced === false, "bluetooth lyrics should degrade to static display without a playback clock");
    assert(bluetoothReady.lines[0]?.text.includes("Like the legend of the phoenix"), "bluetooth lyrics should surface displayable lyric text");
    assert(bluetoothReady.lines.length >= 2, "bluetooth lyrics should keep readable short lines instead of one long ticker");

    await writeFile(
      BLUETOOTH_METADATA_PATH,
      [
        "title=This City",
        "artist=Sam Fischer",
        "album=Not a Hobby",
        "status=playing",
        "positionMs=45000",
        "durationMs=60000"
      ].join("\n")
    );
    const bluetoothMetadataRefresh = await request("/api/v1/lyrics/refresh", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(bluetoothMetadataRefresh.response.ok, "bluetooth metadata lyrics refresh should return 200");
    const thisCityLyrics = await waitForLyricsStatus(["ready"]);
    assert(thisCityLyrics.sourceScope === "bluetooth_input", "metadata bluetooth lyrics should keep bluetooth scope");
    assert(thisCityLyrics.recognitionMode === "metadata", "trusted BlueZ title metadata should use metadata lyrics lookup");
    assert(thisCityLyrics.timingStrategy === "bluez_duration_clipped", "Bluetooth timed lyrics should clip to BlueZ duration when provider timestamps overrun");
    assert(thisCityLyrics.synced === true, "clipped Bluetooth lyrics should remain synced while enough lines fit");
    assert(thisCityLyrics.lines.every((line) => line.startMs === null || line.startMs <= 62000), "clipped lyrics should drop starts beyond the BlueZ duration grace");
    assert(thisCityLyrics.lines.every((line) => line.endMs === null || line.endMs <= 60000), "clipped lyrics should clamp line ends to the BlueZ duration");
    assert(thisCityLyrics.lines.every((line) => !line.text.includes("break my heart")), "clipped lyrics should omit lyrics that start after the current Bluetooth audio");

    const airplay = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "airplay" })
    });
    assert(airplay.response.ok, "airplay source switch should return 200");
    assert(airplay.body.audio.currentSource.id === "airplay", "airplay switch should activate airplay in mock mode");
    assert(airplay.body.audio.currentSource.armed === true, "airplay switch should arm airplay intake");
    assert(airplay.body.audio.currentSource.connectionState === "armed", "airplay source should initially wait for a connected input");
    assert(airplay.body.audio.sources.some((source) => source.id === "bluetooth" && source.armed === false), "airplay switch should disarm bluetooth");

    const dlna = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "upnp" })
    });
    assert(dlna.response.ok, "dlna source switch should return 200");
    assert(dlna.body.audio.currentSource.id === "upnp", "dlna switch should activate dlna in mock mode");
    assert(dlna.body.audio.currentSource.armed === true, "dlna switch should arm dlna intake");
    assert(dlna.body.audio.currentSource.connectionState === "armed", "dlna source should initially wait for a connected input");
    assert(dlna.body.audio.currentSource.advertisedLabel === "Tikpal Speaker", "dlna switch should keep advertised renderer name in state");
    assert(dlna.body.playback.source === "upnp", "playback source should follow dlna switch");
    assert(dlna.body.audio.rememberedSource?.target === "upnp", "dlna handoff should remember DLNA as the last visible source");
    assert(dlna.body.audio.sources.some((source) => source.id === "spotify" && source.armed === false), "dlna switch should disarm spotify");
    assert(dlna.body.audio.sources.some((source) => source.id === "bluetooth" && source.armed === false), "dlna switch should disarm bluetooth");
    assert(dlna.body.audio.sources.some((source) => source.id === "airplay" && source.armed === false), "dlna switch should disarm airplay");

    const radio = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "radio", radioStationId: "radio-2" })
    });
    assert(radio.response.ok, "radio source switch should return 200");
    assert(radio.body.audio.currentSource.id === "radio", "radio switch should activate radio in mock mode");
    assert(radio.body.audio.currentSource.radioStationId === "radio-2", "radio switch should expose the selected mock station id on currentSource");
    assert(radio.body.playback.source === "radio", "playback source should follow radio switch");
    assert(radio.body.playback.title === "Tikpal Calm - Radio Paradise Mellow", "radio switch should surface the active preset label");
    assert(radio.body.audio.rememberedSource?.target === "radio", "radio switch should remember Radio as the last source");
    assert(radio.body.audio.rememberedSource?.radioStationId === "radio-2", "radio switch should remember the selected station id");
    assert(radio.body.audio.sources.some((source) => source.id === "airplay" && source.armed === false), "radio switch should close airplay intake");
    assert(radio.body.audio.sources.some((source) => source.id === "upnp" && source.armed === false), "radio switch should close dlna intake");

    const sceneAfterRadio = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({
        target: "scene",
        sceneVideoId: "rainy-window",
        sceneVideoLabel: "Rainy Window",
        sceneVideoSrc: "/assets/scenes/Rainy-Window.mp4"
      })
    });
    assert(sceneAfterRadio.response.ok, "scene source switch after Radio should return 200");
    assert(sceneAfterRadio.body.audio.currentSource.id === "scene", "scene source switch after Radio should activate Scene Sound");
    assert(sceneAfterRadio.body.audio.rememberedSource?.target === "radio", "scene source switch should preserve remembered Radio");
    const sceneSoundOffAfterRadio = await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_scene_sound", sceneSoundEnabled: false })
    });
    assert(sceneSoundOffAfterRadio.response.ok, "turning scene sound off after Radio should return 200");
    assert(sceneSoundOffAfterRadio.body.sceneSoundEnabled === false, "turning scene sound off after Radio should persist off");
    const stateAfterSceneSoundOffRadio = await request("/api/v1/system/state");
    assert(stateAfterSceneSoundOffRadio.body.audio.currentSource.id === "radio", "turning scene sound off after Radio should restore Radio");
    assert(stateAfterSceneSoundOffRadio.body.audio.currentSource.radioStationId === "radio-2", "turning scene sound off after Radio should restore the remembered station");
    assert(stateAfterSceneSoundOffRadio.body.playback.source === "radio", "turning scene sound off after Radio should expose Radio playback");
    assert(stateAfterSceneSoundOffRadio.body.playback.state === "playing", "turning scene sound off after Radio should not leave playback stopped");

    const mpd = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "mpd" })
    });
    assert(mpd.response.ok, "mpd source switch should return 200");
    assert(mpd.body.audio.currentSource.id === "mpd", "mpd switch should return to library in mock mode");
    assert(mpd.body.audio.sources.some((source) => source.id === "bluetooth" && source.armed === false), "mpd switch should keep bluetooth blocked");
    const cachedLyrics = await waitForLyricsStatus(["not_found"]);
    assert(cachedLyrics.trackKey === missingLyrics.trackKey, "repeat track should reuse cached lyrics result");

    const refreshLyrics = await request("/api/v1/lyrics/refresh", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(refreshLyrics.response.ok, "lyrics refresh should return 200");
    assert(["recognizing", "not_found", "ready", "error"].includes(refreshLyrics.body.status), "lyrics refresh should return a valid lyrics state");

    await writeFile(BLUETOOTH_SCENARIO_PATH, "BT_NOT_FOUND\n");
    await writeFile(BLUETOOTH_METADATA_PATH, "");
    const bluetoothAgain = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "bluetooth" })
    });
    assert(bluetoothAgain.response.ok, "bluetooth should stay switchable for a second recognition pass");
    await waitForLyricsStatus(["recognizing"]);
    const bluetoothNotFound = await waitForLyricsStatus(["not_found"]);
    assert(bluetoothNotFound.sourceScope === "bluetooth_input", "bluetooth not_found should keep bluetooth_input scope");

    await writeFile(BLUETOOTH_SCENARIO_PATH, "BT_SUCCESS\n");
    await wait(350);
    const bluetoothRetryTick = await request("/api/v1/system/state");
    assert(bluetoothRetryTick.response.ok, "system state should schedule bluetooth retry after not_found backoff");
    const bluetoothRetryReady = await waitForLyricsStatus(["ready"]);
    assert(bluetoothRetryReady.title === "Get Lucky (feat. Pharrell Williams)", "bluetooth not_found should retry and recover when a later sample identifies the track");

    await writeFile(BLUETOOTH_SCENARIO_PATH, "BT_ERROR\n");
    const bluetoothRefreshError = await request("/api/v1/lyrics/refresh", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(bluetoothRefreshError.response.ok, "bluetooth refresh should return 200 even when provider later fails");
    const bluetoothError = await waitForLyricsStatus(["error"]);
    assert(bluetoothError.message === "Track identification unavailable", "bluetooth provider failure should surface a concise user-safe error");

    const bluetoothErrorCached = await request("/api/v1/lyrics/status");
    assert(bluetoothErrorCached.body.status === "error", "bluetooth provider failures should remain cached during backoff");

    const libraryScan = await request("/api/v1/system/actions", {
      method: "POST",
      body: JSON.stringify({ type: "library_scan" })
    });
    assert(libraryScan.response.ok, "library_scan action should return 200");
    assert(libraryScan.body.system.library.lastScan, "library_scan should return updated system state");

    const brightness = await request("/api/v1/system/actions", {
      method: "POST",
      body: JSON.stringify({ type: "brightness_set", value: 64 })
    });
    assert(brightness.response.ok, "brightness_set action should return 200");
    assert(brightness.body.system.display.brightnessPercent === 64, "brightness_set should update display brightness percent");

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

    const invalidBrightness = await request("/api/v1/system/actions", {
      method: "POST",
      body: JSON.stringify({ type: "brightness_set", value: 180 })
    });
    assert(invalidBrightness.response.status === 400, "invalid brightness should return 400");
    assert(invalidBrightness.body.error === "BAD_REQUEST", "invalid brightness should return BAD_REQUEST");

    const invalidSource = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "vinyl" })
    });
    assert(invalidSource.response.status === 400, "invalid source should return 400");
    assert(invalidSource.body.error === "BAD_REQUEST", "invalid source should return BAD_REQUEST");

    const invalidRadioStation = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "radio", radioStationId: "radio-missing" })
    });
    assert(invalidRadioStation.response.status === 400, "unknown radio station should return 400");
    assert(invalidRadioStation.body.error === "BAD_REQUEST", "unknown radio station should return BAD_REQUEST");

    const invalidRadioQuery = await request("/api/v1/audio/radios?limit=500");
    assert(invalidRadioQuery.response.status === 400, "invalid radio query should return 400");
    assert(invalidRadioQuery.body.error === "BAD_REQUEST", "invalid radio query should return BAD_REQUEST");

    const remoteHeaders = { "X-Tikpal-Key": PORTABLE_API_KEY };
    const remotePlay = await request("/api/v1/remote/actions", {
      method: "POST",
      headers: remoteHeaders,
      body: JSON.stringify({ type: "playback.play" })
    });
    assert(remotePlay.response.ok, "remote playback.play should return 200");
    assert(remotePlay.body.playback.state === "playing", "remote playback.play should start playback");
    const remoteVolume = await request("/api/v1/remote/actions", {
      method: "POST",
      headers: remoteHeaders,
      body: JSON.stringify({ type: "volume_set", value: 33 })
    });
    assert(remoteVolume.response.ok, "remote volume_set should return 200");
    assert(remoteVolume.body.volume.percent === 33, "remote volume_set should update volume");
    const remoteSource = await request("/api/v1/remote/actions", {
      method: "POST",
      headers: remoteHeaders,
      body: JSON.stringify({ type: "source.set", target: "radio", radioStationId: "radio-2" })
    });
    assert(remoteSource.response.ok, "remote source.set should return 200");
    assert(remoteSource.body.source.current.id === "radio", "remote source.set should switch source");
    const remoteRoom = await request("/api/v1/remote/actions", {
      method: "POST",
      headers: remoteHeaders,
      body: JSON.stringify({ type: "room.set_mode", mode: "calm" })
    });
    assert(remoteRoom.response.ok, "remote room.set_mode should return 200");
    assert(remoteRoom.body.room.mode === "calm", "remote room.set_mode should update room mode");
    const remoteScene = await request("/api/v1/remote/actions", {
      method: "POST",
      headers: remoteHeaders,
      body: JSON.stringify({ type: "scene.set", sceneVideoId: "rainy-window" })
    });
    assert(remoteScene.response.ok, "remote scene.set should return 200");
    assert(remoteScene.body.scene.videoId === "rainy-window", "remote scene.set should update scene");
    const remoteSceneSound = await request("/api/v1/remote/actions", {
      method: "POST",
      headers: remoteHeaders,
      body: JSON.stringify({ type: "scene.sound_set", enabled: false })
    });
    assert(remoteSceneSound.response.ok, "remote scene.sound_set should return 200");
    assert(remoteSceneSound.body.scene.sceneSoundEnabled === false, "remote scene.sound_set should update scene sound");
    const remoteHifi = await request("/api/v1/remote/actions", {
      method: "POST",
      headers: remoteHeaders,
      body: JSON.stringify({ type: "hifi.eq_set", hifiEqPresetId: "vocal" })
    });
    assert(remoteHifi.response.ok, "remote hifi.eq_set should return 200");
    assert(remoteHifi.body.hifi.eqPresetId === "vocal", "remote hifi.eq_set should update Hi-Fi EQ");
    const remoteBrightness = await request("/api/v1/remote/actions", {
      method: "POST",
      headers: remoteHeaders,
      body: JSON.stringify({ type: "display.brightness_set", value: 44 })
    });
    assert(remoteBrightness.response.ok, "remote display.brightness_set should return 200");
    assert(remoteBrightness.body.display.brightnessPercent === 44, "remote display.brightness_set should update brightness");
    const remoteLyrics = await request("/api/v1/remote/actions", {
      method: "POST",
      headers: remoteHeaders,
      body: JSON.stringify({ type: "lyrics.refresh" })
    });
    assert(remoteLyrics.response.ok, "remote lyrics.refresh should return 200");
    const remoteUnsupportedSystem = await request("/api/v1/remote/actions", {
      method: "POST",
      headers: remoteHeaders,
      body: JSON.stringify({ type: "system.reboot" })
    });
    assert(remoteUnsupportedSystem.response.status === 400, "remote actions should not expose reboot");
    const remoteUnsupportedLibrary = await request("/api/v1/remote/actions", {
      method: "POST",
      headers: remoteHeaders,
      body: JSON.stringify({ type: "library_scan" })
    });
    assert(remoteUnsupportedLibrary.response.status === 400, "remote actions should not expose library scan");
    const remoteUnsupportedPlaylist = await request("/api/v1/remote/actions", {
      method: "POST",
      headers: remoteHeaders,
      body: JSON.stringify({ type: "playlist.create", name: "Nope" })
    });
    assert(remoteUnsupportedPlaylist.response.status === 400, "remote actions should not expose playlist CRUD");

    await runHifiSpectrumCommandSmoke(roomExperienceStatePath);
    await runMpcStartupSceneDefaultSmoke();
    await runMpcHifiCommandGuardSmoke(roomExperienceStatePath);
    await runMpcLocalLibraryPathSmoke(roomExperienceStatePath);
    await runMpcCachedStateSmoke(roomExperienceStatePath);
    await runMpcRadioPresetFastSnapshotSmoke(roomExperienceStatePath);
    await runMpcAirplayHandoffRefreshSmoke(roomExperienceStatePath);

    console.log("api smoke passed");
  } finally {
    server.kill("SIGTERM");
    await new Promise((resolve) => providerServer.close(resolve));
    await rm(BLUETOOTH_SCENARIO_PATH, { force: true });
    await rm(BLUETOOTH_METADATA_PATH, { force: true });
    await rm(apiAssetsRoot, { recursive: true, force: true });
    await rm(apiStateRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

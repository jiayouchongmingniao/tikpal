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
const PROVIDER_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/azU1wAAAABJRU5ErkJggg==", "base64");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function smokeTrackKey({ source, title, artist, album, durationSeconds = null }) {
  return createHash("sha1")
    .update([
      source,
      String(title ?? "").trim().replace(/\s+/g, " ").toLowerCase(),
      String(artist ?? "").trim().replace(/\s+/g, " ").toLowerCase(),
      String(album ?? "").trim().replace(/\s+/g, " ").toLowerCase(),
      Number.isFinite(durationSeconds) ? String(Math.round(durationSeconds)) : ""
    ].join("|"))
    .digest("hex");
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

async function waitForWebModeStateAt(baseUrl, predicate, message) {
  let latest = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await requestFrom(baseUrl, "/api/v1/web-mode/state");
    latest = state.body;
    if (predicate(latest)) return latest;
    await wait(25);
  }
  throw new Error(`${message}: ${JSON.stringify(latest)}`);
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

async function runGeneratedArtworkSourceSmoke() {
  const serverSource = await readFile("server/index.mjs", "utf8");
  const start = serverSource.indexOf("function buildGeneratedArtworkSvg");
  const end = serverSource.indexOf("function buildLyricsState", start);
  const generatedArtworkSource = start === -1 || end === -1 ? "" : serverSource.slice(start, end);
  assert(generatedArtworkSource.includes('<rect width="1200" height="1200" fill='), "generated media artwork should use a full-bleed square root");
  assert(!generatedArtworkSource.includes('<rect width="1200" height="1200" rx='), "generated media artwork should not round the root SVG background");
  assert(!generatedArtworkSource.includes('clipPath id="posterClip"'), "generated media artwork should not use an inner clipped poster");
  assert(!/<rect\s+x="\d+"[^>]*\srx=/.test(generatedArtworkSource), "generated media artwork should not draw an inner rounded card");
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
      method: "GET",
      pathname: "/api/v1/preferences",
      remoteAddress: "192.168.10.44",
      portableApiKey: PORTABLE_API_KEY
    }).allowed === true,
    "external clients should be able to read device language preferences"
  );
  assert(
    getTikpalApiAccessDecision({
      method: "PATCH",
      pathname: "/api/v1/preferences",
      remoteAddress: "192.168.10.44",
      portableApiKey: PORTABLE_API_KEY
    }).allowed === false,
    "external clients should not change kiosk language preferences directly"
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
      pathname: "/api/v1/web-mode/actions",
      headers: { "x-tikpal-key": PORTABLE_API_KEY },
      remoteAddress: "192.168.10.44",
      portableApiKey: PORTABLE_API_KEY
    }).allowed === false,
    "external remote clients should not bypass the portable facade for Explore"
  );
  assert(
    getTikpalApiAccessDecision({
      method: "POST",
      pathname: "/api/v1/web-mode/proxy-applied",
      remoteAddress: "192.168.10.44",
      portableApiKey: PORTABLE_API_KEY
    }).allowed === false,
    "external clients should not confirm Explore proxy application"
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
  const oldEventLogPath = path.join(workspace, "old-moode_spsevent.log");
  const clockStatePath = path.join(workspace, "clock-state");
  const mprisClockStatePath = path.join(workspace, "mpris-clock-state");
  const mprisSeenClockStatePath = path.join(workspace, "mpris-seen-clock-state");
  const fakeBusctlPath = path.join(workspace, "busctl");
  const coverPath = path.join(workspace, "airplay-cover.jpg");
  const eventSeconds = Math.floor(Date.now() / 1000) - 12;
  const metadataSeconds = eventSeconds + 6;
  const oldCoverSeconds = metadataSeconds - 600;
  const eventStamp = formatMoodeEventTimestamp(eventSeconds);
  const oldEventStamp = formatMoodeEventTimestamp(Math.floor(Date.now() / 1000) - 300);

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

    await writeFile(coverPath, "fake-cover");
    await utimes(coverPath, oldCoverSeconds, oldCoverSeconds);
    await writeFile(
      metadataJsonPath,
      `${JSON.stringify({
        fecmd: "update_aplmeta",
        title: "Shared Cover Track",
        artist: "AirPlay Tester",
        album: "Helper Smoke",
        duration: "204000",
        cover_url: coverPath,
        sformat: "ALAC 16/44.1K 2ch"
      })}\n`
    );
    await utimes(metadataJsonPath, metadataSeconds, metadataSeconds);
    await writeFile(fakeBusctlPath, `#!${process.execPath}
const property = process.argv.at(-1);
if (property === "Metadata") {
  process.stdout.write(JSON.stringify({ type: "a{sv}", data: {
    "mpris:artUrl": { type: "s", data: "file://${coverPath}" },
    "mpris:trackid": { type: "o", data: "/org/gnome/ShairportSync/smoke" },
    "xesam:title": { type: "s", data: "Shared Cover Track" },
    "xesam:album": { type: "s", data: "Helper Smoke" },
    "xesam:artist": { type: "as", data: ["AirPlay Tester"] },
    "mpris:length": { type: "x", data: 204000000 }
  } }) + "\\n");
} else if (property === "PlaybackStatus") {
  process.stdout.write(JSON.stringify({ type: "s", data: "Playing" }) + "\\n");
} else if (property === "Position") {
  process.stdout.write(JSON.stringify({ type: "x", data: 0 }) + "\\n");
} else {
  process.exit(1);
}
`);
    await chmod(fakeBusctlPath, 0o755);

    const mprisResult = await runProcess("sh", ["deploy/moode/tikpal-airplay-metadata.sh"], {
      env: {
        ...process.env,
        PATH: `${workspace}:${process.env.PATH}`,
        TIKPAL_AIRPLAY_EVENT_LOG: eventLogPath,
        TIKPAL_AIRPLAY_METADATA_FILE: metadataTxtPath,
        TIKPAL_AIRPLAY_METADATA_JSON_FILE: metadataJsonPath,
        TIKPAL_AIRPLAY_BUSCTL_BIN: fakeBusctlPath,
        TIKPAL_AIRPLAY_CLOCK_STATE_FILE: mprisClockStatePath,
        TIKPAL_AIRPLAY_METADATA_CLOCK_LEAD_MS: "1000"
      }
    });

    assert(mprisResult.code === 0, `AirPlay helper should read MPRIS metadata with json clock fallback, stderr: ${mprisResult.stderr}`);
    const mprisFields = parseKeyValueOutput(mprisResult.stdout);
    assert(
      mprisFields.get("metadataSource") === "mpris",
      `AirPlay helper should keep MPRIS as playback truth, stdout: ${JSON.stringify(mprisResult.stdout)}, stderr: ${JSON.stringify(mprisResult.stderr)}`
    );
    assert(Number(mprisFields.get("metadataMtimeMs")) === metadataSeconds * 1000, "MPRIS clock should use matching json metadata mtime");
    assert(Number(mprisFields.get("clockStartMs")) === metadataSeconds * 1000, "MPRIS clock should not use stale shared artwork mtime");
    assert(Number(mprisFields.get("positionMs")) < 30_000, "MPRIS inferred position should start near the current track, not the old cover mtime");

    await writeFile(oldEventLogPath, `${oldEventStamp} Event: Run spspre.sh\n`);
    const mprisSeenResult = await runProcess("sh", ["deploy/moode/tikpal-airplay-metadata.sh"], {
      env: {
        ...process.env,
        PATH: `${workspace}:${process.env.PATH}`,
        TIKPAL_AIRPLAY_EVENT_LOG: oldEventLogPath,
        TIKPAL_AIRPLAY_METADATA_FILE: metadataTxtPath,
        TIKPAL_AIRPLAY_METADATA_JSON_FILE: path.join(workspace, "missing-aplmeta.json"),
        TIKPAL_AIRPLAY_BUSCTL_BIN: fakeBusctlPath,
        TIKPAL_AIRPLAY_CLOCK_STATE_FILE: mprisSeenClockStatePath,
        TIKPAL_AIRPLAY_METADATA_CLOCK_LEAD_MS: "1000"
      }
    });
    assert(mprisSeenResult.code === 0, `AirPlay helper should recover MPRIS clock from a stale AirPlay event, stderr: ${mprisSeenResult.stderr}`);
    const mprisSeenFields = parseKeyValueOutput(mprisSeenResult.stdout);
    const mprisSeenPositionMs = Number(mprisSeenFields.get("positionMs"));
    assert(mprisSeenFields.get("clockStartReason") === "mpris_seen", "MPRIS without native position should reset stale AirPlay event clocks to mpris_seen");
    assert(mprisSeenFields.get("positionConfidence") === "estimated", "MPRIS without native position should still expose an estimated clock");
    assert(Number.isFinite(mprisSeenPositionMs) && mprisSeenPositionMs >= 0 && mprisSeenPositionMs < 2500, "fresh mpris_seen clock should start near zero");

    await wait(1100);
    const persistedMprisSeenResult = await runProcess("sh", ["deploy/moode/tikpal-airplay-metadata.sh"], {
      env: {
        ...process.env,
        PATH: `${workspace}:${process.env.PATH}`,
        TIKPAL_AIRPLAY_EVENT_LOG: oldEventLogPath,
        TIKPAL_AIRPLAY_METADATA_FILE: metadataTxtPath,
        TIKPAL_AIRPLAY_METADATA_JSON_FILE: path.join(workspace, "missing-aplmeta.json"),
        TIKPAL_AIRPLAY_BUSCTL_BIN: fakeBusctlPath,
        TIKPAL_AIRPLAY_CLOCK_STATE_FILE: mprisSeenClockStatePath,
        TIKPAL_AIRPLAY_METADATA_CLOCK_LEAD_MS: "1000"
      }
    });
    assert(persistedMprisSeenResult.code === 0, `AirPlay helper should reuse persisted MPRIS clock state, stderr: ${persistedMprisSeenResult.stderr}`);
    const persistedMprisSeenFields = parseKeyValueOutput(persistedMprisSeenResult.stdout);
    assert(persistedMprisSeenFields.get("clockStartMs") === mprisSeenFields.get("clockStartMs"), "persisted mpris_seen clock should keep the same start");
    assert(persistedMprisSeenFields.get("positionConfidence") === "estimated", "persisted mpris_seen clock should stay estimated");
    assert(Number(persistedMprisSeenFields.get("positionMs")) > mprisSeenPositionMs, "persisted mpris_seen clock should advance while playing");
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
  const playbackModeStatePath = overrides.TIKPAL_PLAYBACK_MODE_STATE_PATH
    ?? path.join(tmpdir(), `tikpal-api-smoke-playback-mode-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  return {
    ...process.env,
    TIKPAL_PLAYBACK_MODE_STATE_PATH: playbackModeStatePath,
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

function sendProviderJsonAfter(response, delayMs, status, body) {
  setTimeout(() => sendProviderJson(response, status, body), delayMs);
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
          temperature_2m: 27.4,
          weather_code: 61,
          precipitation: 1.2,
          rain: 1.2,
          showers: 0,
          snowfall: 0
        }
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/custom-lyrics") {
      const track = url.searchParams.get("title");
      if (track === "Custom Plain") {
        sendProviderJson(response, 200, {
          lyrics: "Custom provider line one\nCustom provider line two"
        });
        return;
      }
      if (track === "Fallback Song") {
        sendProviderJson(response, 401, { error: "unauthorized" });
        return;
      }
      sendProviderJson(response, 404, { error: "not found" });
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/v1/")) {
      const [, , encodedArtist, encodedTitle] = url.pathname.split("/");
      const artist = decodeURIComponent(encodedArtist ?? "");
      const track = decodeURIComponent(encodedTitle ?? "");
      if (artist === "Fallback Artist" && track === "Fallback Song") {
        sendProviderJson(response, 200, {
          lyrics: "Fallback provider line one\nFallback provider line two"
        });
        return;
      }
      sendProviderJson(response, 404, { error: "No lyrics found" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/search") {
      const track = url.searchParams.get("track_name");

      if (track === "Fallback Song") {
        sendProviderJson(response, 200, [
          {
            trackName: track,
            artistName: "Wrong Singer",
            albumName: "Wrong Album",
            duration: 180,
            syncedLyrics: "[00:05.00]Wrong fallback line",
            plainLyrics: "Wrong fallback line"
          }
        ]);
        return;
      }

      if (track === "Walter White") {
        sendProviderJson(response, 200, [
          {
            trackName: track,
            artistName: "Epic Rap Battles of History",
            albumName: "Wrong Album",
            duration: 136,
            syncedLyrics: "[00:05.00]Wrong Walter line",
            plainLyrics: "Wrong Walter line"
          }
        ]);
        return;
      }

      if (track === "Slow Empty") {
        if (!url.searchParams.get("artist_name")) {
          sendProviderJsonAfter(response, 700, 200, []);
          return;
        }
        sendProviderJson(response, 200, []);
        return;
      }

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
            syncedLyrics: null,
            plainLyrics: "A matching plain result should not outrank real timestamps"
          },
          {
            trackName: track,
            artistName: "Sam Fischer",
            albumName: "Not a Hobby",
            duration: 188,
            syncedLyrics: "[00:05.00]I've been seeing lonely people in crowded rooms\n[00:21.00]Covering their old heartbreaks with new tattoos\n[00:42.00]It's all about smoke screens and cigarettes\n[01:14.00]This city is gonna break my heart\n[01:46.00]This city is gonna love me then leave me alone",
            plainLyrics: "I've been seeing lonely people in crowded rooms\nCovering their old heartbreaks with new tattoos\nIt's all about smoke screens and cigarettes\nThis city is gonna break my heart"
          }
        ]);
        return;
      }

      if (track === "中文测试歌") {
        sendProviderJson(response, 200, [
          {
            trackName: track,
            artistName: "错误歌手",
            albumName: "错误专辑",
            duration: 214,
            syncedLyrics: "[00:05.00]错误中文歌词",
            plainLyrics: "错误中文歌词"
          },
          {
            trackName: track,
            artistName: "周杰伦",
            albumName: "中文蓝牙验证",
            duration: 214,
            syncedLyrics: "[00:08.00]中文蓝牙同步歌词第一行\n[00:20.00]中文歌手匹配不能被清空\n[00:42.00]歌词墙继续高亮",
            plainLyrics: "中文蓝牙同步歌词第一行\n中文歌手匹配不能被清空\n歌词墙继续高亮"
          }
        ]);
        return;
      }

      if (track === "City Of Stars (From \"La La Land\" Soundtrack)") {
        sendProviderJson(response, 200, [
          {
            trackName: track,
            artistName: "Ryan Gosling/Emma Stone",
            albumName: "La La Land (Original Motion Picture Soundtrack)",
            duration: 149,
            syncedLyrics: "[00:11.00]City of stars\n[00:19.00]Are you shining just for me\n[00:32.00]There's so much that I can't see\n[01:08.00]Who knows",
            plainLyrics: "City of stars\nAre you shining just for me\nThere's so much that I can't see\nWho knows"
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

      if (track === "Slow Empty") {
        sendProviderJson(response, 404, { error: "not found" });
        return;
      }

      if (track === "Fallback Song" || track === "Custom Plain" || track === "Walter White") {
        sendProviderJson(response, 404, { error: "not found" });
        return;
      }

      if (track === "A.M. Ambient" || track === "Calm - Positively Meditation") {
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

    if (request.method === "GET" && url.pathname === "/itunes/search") {
      sendProviderJson(response, 200, {
        resultCount: 1,
        results: [{
          trackName: "Pocket Signal",
          artistName: "Tikpal Phone",
          collectionName: "AVRCP Smoke",
          artworkUrl100: `${PROVIDER_URL}/artwork/pocket-signal/100x100bb.png`
        }]
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/artwork/pocket-signal/600x600bb.png") {
      response.writeHead(200, { "Content-Type": "image/png" });
      response.end(PROVIDER_PNG);
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
  const fakeMpcStatePath = path.join(workspace, "mpc-state.json");
  const roomExperienceStatePath = path.join(workspace, "room-experience-state.json");

  await writeFile(fakeMpcStatePath, `${JSON.stringify({
    title: "",
    artist: "",
    album: "",
    currentFile: "",
    duration: "",
    elapsed: "0:00",
    playbackState: "stopped",
    stopFails: false
  }, null, 2)}\n`);
  await writeFile(fakeMpcPath, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const statePath = ${JSON.stringify(fakeMpcStatePath)};
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
function readState() {
  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return {};
  }
}

function writeState(state) {
  writeFileSync(statePath, JSON.stringify(state, null, 2) + "\\n");
}

switch (command) {
  case "status":
    {
      const state = readState();
      if (state.playbackState === "playing" || state.playbackState === "paused") {
        const progress = state.duration ? \`\${state.elapsed || "0:00"}/\${state.duration}\` : "";
        process.stdout.write(\`[\${state.playbackState}] #1/1   \${progress} (42%)\\n\`);
      }
      process.stdout.write("volume:30%   repeat: off   random: off   single: off   consume: off\\n");
    }
    break;
  case "stats":
    process.stdout.write("Artists: 0\\nAlbums: 0\\nSongs: 0\\nDB Updated: fake\\n");
    break;
  case "current":
    {
      const state = readState();
      if (state.currentFile || state.title) {
        process.stdout.write([
          state.title || "",
          state.artist || "",
          state.album || "",
          state.currentFile || "",
          state.duration || ""
        ].join("\\t") + "\\n");
      }
    }
    break;
  case "playlist":
    {
      const state = readState();
      if (state.currentFile || state.title) {
        process.stdout.write(\`0\\t\${state.title || ""}\\t\${state.artist || ""}\\t\${state.album || ""}\\t\${state.duration || ""}\\t\${state.currentFile || ""}\\n\`);
      }
    }
    break;
  case "stop":
    {
      const state = readState();
      if (state.stopFails) {
        process.stderr.write("mpc stop failed\\n");
        process.exit(1);
      }
      writeState({
        ...state,
        playbackState: "stopped",
        currentFile: "",
        title: "",
        artist: "",
        album: "",
        duration: "",
        elapsed: "0:00"
      });
    }
    break;
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
      TIKPAL_MPD_STARTUP_VOLUME: "-1",
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

async function runMpcHifiRememberedStartupRestoreSmoke() {
  const port = PORT + 17;
  const baseUrl = `http://${HOST}:${port}`;
  const workspace = await mkdtemp(path.join(tmpdir(), "tikpal-mpc-hifi-startup-"));
  const fakeMpcPath = path.join(workspace, "mpc-fake.mjs");
  const fakeMpcCommandLogPath = path.join(workspace, "mpc-command.log");
  const fakeSqlitePath = path.join(workspace, "sqlite3");
  const fakeMpcStatePath = path.join(workspace, "mpc-state.json");
  const roomExperienceStatePath = path.join(workspace, "room-experience-state.json");
  const audioSourceMemoryStatePath = path.join(workspace, "audio-source-memory.json");
  const radioUri = "http://radio.example/startup-restore";

  await writeFile(fakeMpcStatePath, JSON.stringify({
    currentFile: "",
    playbackState: "stopped",
    volume: 30
  }));
  await writeFile(roomExperienceStatePath, `${JSON.stringify({ mode: "hifi", sceneSoundEnabled: false }, null, 2)}\n`);
  await writeFile(audioSourceMemoryStatePath, `${JSON.stringify({
    target: "radio",
    localTrackPath: null,
    radioStationId: "radio-505",
    updatedAt: "2026-07-01T00:00:00.000Z"
  }, null, 2)}\n`);

  await writeFile(fakeMpcPath, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const statePath = ${JSON.stringify(fakeMpcStatePath)};
function readState() {
  return JSON.parse(readFileSync(statePath, "utf8"));
}
function writeState(state) {
  writeFileSync(statePath, JSON.stringify(state));
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
const isRadio = /^https?:\\/\\//i.test(state.currentFile ?? "");

switch (command) {
  case "current":
    if (!state.currentFile) break;
    if (fileOnlyCurrent) {
      process.stdout.write(state.currentFile + "\\n");
      break;
    }
    process.stdout.write("Tikpal Startup Restore\\tInternet Radio\\tRadio\\t" + state.currentFile + "\\t0:00\\n");
    break;
  case "status":
    if (state.currentFile) {
      process.stdout.write("[" + state.playbackState + "] #1/1 0:01/" + (isRadio ? "0:00" : "2:00") + " (0%)\\n");
    }
    process.stdout.write("volume:" + state.volume + "%   repeat: off   random: off   single: off   consume: off\\n");
    break;
  case "stats":
    process.stdout.write("Artists: 1\\nAlbums: 1\\nSongs: " + (state.currentFile ? "1" : "0") + "\\nDB Updated: fake\\n");
    break;
  case "playlist":
    if (state.currentFile) process.stdout.write("0\\tTikpal Startup Restore\\tInternet Radio\\tRadio\\t0:00\\t" + state.currentFile + "\\n");
    break;
  case "clear":
    writeState({ ...state, currentFile: "", playbackState: "stopped" });
    break;
  case "add":
    writeState({ ...state, currentFile: args[1] ?? "", playbackState: "stopped" });
    break;
  case "play":
    writeState({ ...state, playbackState: "playing" });
    break;
  case "stop":
    writeState({ ...state, playbackState: "stopped" });
    break;
  case "volume":
    writeState({ ...state, volume: Number(args[1] ?? state.volume) });
    break;
  default:
    break;
}
`);
  await chmod(fakeMpcPath, 0o755);
  await writeFile(fakeSqlitePath, `#!/usr/bin/env node
if (process.argv.join(" ").includes("cfg_radio")) {
  process.stdout.write("505|Tikpal Focus - Startup Restore|${radioUri}|Focus|Startup FM|320|MP3|local\\n");
}
`);
  await chmod(fakeSqlitePath, 0o755);

  const server = spawn(process.execPath, ["server/index.mjs"], {
    env: mpcFocusedSmokeEnv({
      PATH: `${workspace}${path.delimiter}${process.env.PATH ?? ""}`,
      TIKPAL_API_HOST: HOST,
      TIKPAL_API_PORT: String(port),
      TIKPAL_PLAYER_BACKEND: "mpc",
      TIKPAL_MPC_BIN: fakeMpcPath,
      TIKPAL_SQLITE_BIN: fakeSqlitePath,
      TIKPAL_MPD_HOST: "127.0.0.1",
      TIKPAL_MPD_PORT: "6600",
      TIKPAL_RADIO_DEFAULT_URI: "",
      TIKPAL_RADIO_ACTIVATE_COMMAND: "",
      TIKPAL_RADIO_START_VERIFY_WINDOW_MS: "40",
      TIKPAL_RADIO_START_VERIFY_POLL_MS: "20",
      TIKPAL_RADIO_POST_START_SETTLE_MS: "20",
      TIKPAL_RADIO_POST_START_RECOVERY_PLAYS: "0",
      TIKPAL_ROOM_EXPERIENCE_STATE_PATH: roomExperienceStatePath,
      TIKPAL_AUDIO_SOURCE_MEMORY_STATE_PATH: audioSourceMemoryStatePath,
      TIKPAL_STARTUP_SCENE_SOUND_ENABLED: "1"
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForHealthAt(baseUrl);
    let restored = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const state = await requestFrom(baseUrl, "/api/v1/system/state");
      if (
        state.response.ok
        && state.body.audio.currentSource.id === "radio"
        && state.body.audio.currentSource.radioStationId === "radio-505"
        && state.body.playback.state === "playing"
      ) {
        restored = state.body;
        break;
      }
      await wait(100);
    }

    assert(restored, "mpc Hi-Fi startup should restore the remembered Radio station instead of staying Not Playing");
    assert(restored.playback.source === "radio", "mpc Hi-Fi startup restore should expose Radio playback");
    assert(JSON.parse(await readFile(fakeMpcStatePath, "utf8")).currentFile === radioUri, "mpc Hi-Fi startup restore should start the remembered station URI");
    assert(JSON.parse(await readFile(audioSourceMemoryStatePath, "utf8")).radioStationId === "radio-505", "mpc Hi-Fi startup restore should preserve the remembered station id");
    assert(JSON.parse(await readFile(roomExperienceStatePath, "utf8")).sceneSoundEnabled === false, "mpc Hi-Fi startup restore should not enable Scene Sound");
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

async function runMpcHifiRememberedLibraryStartupRestoreSmoke() {
  const port = PORT + 18;
  const baseUrl = `http://${HOST}:${port}`;
  const workspace = await mkdtemp(path.join(tmpdir(), "tikpal-mpc-hifi-library-startup-"));
  const fakeMpcPath = path.join(workspace, "mpc-fake.mjs");
  const fakeMpcStatePath = path.join(workspace, "mpc-state.json");
  const roomExperienceStatePath = path.join(workspace, "room-experience-state.json");
  const audioSourceMemoryStatePath = path.join(workspace, "audio-source-memory.json");
  const rememberedTrackPath = "Focus/Lo-fi Ambient/FASSounds - Good Night - Lofi Cozy Chill Music - 02m27s - Lo-fi.mp3";
  const fakeMpcTracks = [
    "Codex/Focus/Lo-fi Ambient/AtlasAudio - Ambient Soundscapes - 04m56s - Ambient.mp3",
    `Codex/${rememberedTrackPath}`,
    "Codex/Focus/Lo-fi Ambient/FASSounds - Lofi Study - Calm Peaceful Chill Hop - 02m27s - Lo-fi.mp3"
  ];

  await writeFile(fakeMpcStatePath, JSON.stringify({
    queue: [],
    current: 0,
    playbackState: "stopped",
    volume: 30
  }));
  await writeFile(roomExperienceStatePath, `${JSON.stringify({ mode: "hifi", sceneSoundEnabled: false }, null, 2)}\n`);
  await writeFile(audioSourceMemoryStatePath, `${JSON.stringify({
    target: "mpd",
    localTrackPath: rememberedTrackPath,
    radioStationId: "radio-505",
    updatedAt: "2026-07-01T00:00:00.000Z"
  }, null, 2)}\n`);

  await writeFile(fakeMpcPath, `#!/usr/bin/env node
	import { readFileSync, writeFileSync } from "node:fs";

	const statePath = ${JSON.stringify(fakeMpcStatePath)};
	const libraryTracks = ${JSON.stringify(fakeMpcTracks)};
function readState() {
  return JSON.parse(readFileSync(statePath, "utf8"));
}
function writeState(state) {
  writeFileSync(statePath, JSON.stringify(state));
}
function currentFile(state) {
  return Array.isArray(state.queue) ? state.queue[state.current ?? 0] ?? "" : "";
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
const file = currentFile(state);

switch (command) {
  case "listall": {
    const target = args[1] ?? "";
    if (target === "Codex") process.stdout.write(libraryTracks.join("\\n") + "\\n");
    else if (libraryTracks.includes(target)) process.stdout.write(target + "\\n");
    break;
  }
  case "current":
    if (!file) break;
    if (fileOnlyCurrent) {
      process.stdout.write(file + "\\n");
      break;
    }
    process.stdout.write("Good Night\\tFASSounds\\tLo-fi Ambient\\t" + file + "\\t02:27\\n");
    break;
  case "status":
    if (file) {
      process.stdout.write("[" + state.playbackState + "] #" + ((state.current ?? 0) + 1) + "/" + state.queue.length + " 0:01/2:27 (0%)\\n");
    }
    process.stdout.write("volume:" + state.volume + "%   repeat: off   random: off   single: off   consume: off\\n");
    break;
  case "stats":
    process.stdout.write("Artists: 1\\nAlbums: 1\\nSongs: " + libraryTracks.length + "\\nDB Updated: fake\\n");
    break;
  case "playlist":
    process.stdout.write((state.queue ?? []).map((track, index) => index + "\\tGood Night\\tFASSounds\\tLo-fi Ambient\\t02:27\\t" + track).join("\\n"));
    if ((state.queue ?? []).length > 0) process.stdout.write("\\n");
    break;
  case "clear":
    writeState({ ...state, queue: [], current: 0, playbackState: "stopped" });
    break;
  case "add": {
    const target = args[1] ?? "";
    const queue = target === "Codex" ? libraryTracks : libraryTracks.includes(target) ? [target] : [];
    writeState({ ...state, queue: [...(state.queue ?? []), ...queue] });
    break;
  }
  case "play":
    writeState({
      ...state,
      current: args[1] ? Math.max(0, Number(args[1]) - 1) : state.current ?? 0,
      playbackState: "playing"
    });
    break;
  case "stop":
    writeState({ ...state, playbackState: "stopped" });
    break;
  case "volume":
    writeState({ ...state, volume: Number(args[1] ?? state.volume) });
    break;
  default:
    break;
}
`);
  await chmod(fakeMpcPath, 0o755);

  const server = spawn(process.execPath, ["server/index.mjs"], {
    env: mpcFocusedSmokeEnv({
      TIKPAL_API_HOST: HOST,
      TIKPAL_API_PORT: String(port),
      TIKPAL_PLAYER_BACKEND: "mpc",
      TIKPAL_MPC_BIN: fakeMpcPath,
      TIKPAL_MPD_HOST: "127.0.0.1",
      TIKPAL_MPD_PORT: "6600",
      TIKPAL_MPD_DEFAULT_QUEUE_PATH: "Codex",
      TIKPAL_ROOM_EXPERIENCE_STATE_PATH: roomExperienceStatePath,
      TIKPAL_AUDIO_SOURCE_MEMORY_STATE_PATH: audioSourceMemoryStatePath,
      TIKPAL_OUTPUT_VOLUME_GET_COMMAND: "",
      TIKPAL_STARTUP_SCENE_SOUND_ENABLED: "1"
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForHealthAt(baseUrl);
    const state = await requestFrom(baseUrl, "/api/v1/system/state");
    assert(state.response.ok, "mpc Hi-Fi Library startup state should return 200");
    assert(state.body.audio.currentSource.id === "mpd", "mpc Hi-Fi Library startup should expose Library as current source");
    assert(state.body.playback.state === "playing", "mpc Hi-Fi Library startup should not expose a stale Not Playing snapshot");
    assert(state.body.playback.queueLength === fakeMpcTracks.length, "mpc Hi-Fi Library startup should load the local library queue");
    assert(
      state.body.playback.queuePreview.some((entry) => entry.active && entry.id === `Codex/${rememberedTrackPath}`),
      "mpc Hi-Fi Library startup should restore the remembered local track"
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

async function runMpcHifiRuntimePlaybackRecoverySmoke() {
  const port = PORT + 19;
  const baseUrl = `http://${HOST}:${port}`;
  const workspace = await mkdtemp(path.join(tmpdir(), "tikpal-mpc-hifi-runtime-recovery-"));
  const fakeMpcPath = path.join(workspace, "mpc-fake.mjs");
  const fakeMpcCommandLogPath = path.join(workspace, "mpc-command.log");
  const fakeSqlitePath = path.join(workspace, "sqlite3");
  const fakeMpcStatePath = path.join(workspace, "mpc-state.json");
  const fakeMpdLogPath = path.join(workspace, "mpd.log");
  const roomExperienceStatePath = path.join(workspace, "room-experience-state.json");
  const audioSourceMemoryStatePath = path.join(workspace, "audio-source-memory.json");
  const webModeStatePath = path.join(workspace, "web-mode-state.json");
  const playbackModeStatePath = path.join(workspace, "playback-mode-state.json");
  const radioUri = "http://radio.example/runtime-restore";
  const otherRadioUri = "http://radio.example/runtime-other";
  const rememberedTrackPath = "Focus/Lo-fi Ambient/FASSounds - Good Night - Lofi Cozy Chill Music - 02m27s - Lo-fi.mp3";
  const fakeMpcTracks = [
    `Codex/${rememberedTrackPath}`,
    "Codex/Focus/Lo-fi Ambient/AtlasAudio - Ambient Soundscapes - 04m56s - Ambient.mp3"
  ];
  const mpdLogTimestamp = (baseMs, offsetMs = 0) => {
    const date = new Date(baseMs + offsetMs);
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  };
  const radioPlayedLogLine = (uri, baseMs, offsetMs = 0) => `${mpdLogTimestamp(baseMs, offsetMs)} player: played ${JSON.stringify(uri)}`;
  const xrunLogLine = (baseMs, offsetMs = 0) => `${mpdLogTimestamp(baseMs, offsetMs)} alsa_output: Decoder is too slow; playing silence to avoid xrun`;

  await writeFile(fakeMpcPath, `#!/usr/bin/env node
	import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

	const statePath = ${JSON.stringify(fakeMpcStatePath)};
	const commandLogPath = ${JSON.stringify(fakeMpcCommandLogPath)};
	const libraryTracks = ${JSON.stringify(fakeMpcTracks)};

function readState() {
  return JSON.parse(readFileSync(statePath, "utf8"));
}
function writeState(state) {
  writeFileSync(statePath, JSON.stringify(state));
}
function currentFile(state) {
  return state.currentFile || (Array.isArray(state.queue) ? state.queue[state.current ?? 0] ?? "" : "");
}
function writeCurrent(file, fileOnlyCurrent) {
  if (!file) return;
  if (fileOnlyCurrent) {
    process.stdout.write(file + "\\n");
    return;
  }
  if (/^https?:\\/\\//i.test(file)) {
    process.stdout.write("Tikpal Runtime Restore\\tInternet Radio\\tRadio\\t" + file + "\\t0:00\\n");
    return;
  }
  process.stdout.write("Runtime Recovery\\tFASSounds\\tLo-fi Ambient\\t" + file + "\\t02:27\\n");
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
	appendFileSync(commandLogPath, args.join("\\t") + "\\n");
	const state = readState();
const file = currentFile(state);
const queueLength = Array.isArray(state.queue) && state.queue.length > 0 ? state.queue.length : file ? 1 : 0;
const isRadio = /^https?:\\/\\//i.test(file);

switch (command) {
  case "listall": {
    const target = args[1] ?? "";
    if (target === "Codex") process.stdout.write(libraryTracks.join("\\n") + "\\n");
    else if (libraryTracks.includes(target)) process.stdout.write(target + "\\n");
    break;
  }
  case "current":
    writeCurrent(file, fileOnlyCurrent);
    break;
  case "status":
    if (file) {
      process.stdout.write("[" + state.playbackState + "] #" + ((state.current ?? 0) + 1) + "/" + queueLength + " 0:01/" + (isRadio ? "0:00" : "2:27") + " (0%)\\n");
    }
    process.stdout.write("volume:" + (state.volume ?? 30) + "%   repeat: off   random: off   single: off   consume: off\\n");
    break;
  case "stats":
    process.stdout.write("Artists: 1\\nAlbums: 1\\nSongs: " + libraryTracks.length + "\\nDB Updated: fake\\n");
    break;
  case "playlist":
    if (Array.isArray(state.queue) && state.queue.length > 0) {
      process.stdout.write(state.queue.map((track, index) => index + "\\tRuntime Recovery\\tFASSounds\\tLo-fi Ambient\\t02:27\\t" + track).join("\\n") + "\\n");
    } else if (state.currentFile) {
      process.stdout.write("0\\tTikpal Runtime Restore\\tInternet Radio\\tRadio\\t0:00\\t" + state.currentFile + "\\n");
    }
    break;
  case "clear":
    writeState({ ...state, currentFile: "", queue: [], current: 0, playbackState: "stopped", switchCount: (state.switchCount ?? 0) + 1 });
    break;
  case "add": {
    const target = args[1] ?? "";
    if (/^https?:\\/\\//i.test(target)) {
      writeState({ ...state, currentFile: target, queue: [], current: 0, playbackState: "stopped", switchCount: (state.switchCount ?? 0) + 1 });
    } else {
      const queue = target === "Codex" ? libraryTracks : libraryTracks.includes(target) ? [target] : [];
      writeState({ ...state, currentFile: "", queue: [...(state.queue ?? []), ...queue], switchCount: (state.switchCount ?? 0) + 1 });
    }
    break;
  }
  case "play":
    writeState({
      ...state,
      current: args[1] ? Math.max(0, Number(args[1]) - 1) : state.current ?? 0,
      playbackState: "playing"
    });
    break;
  case "pause":
    writeState({ ...state, playbackState: "paused" });
    break;
  case "stop":
    writeState({ ...state, playbackState: "stopped" });
    break;
  case "volume":
    writeState({ ...state, volume: Number(args[1] ?? state.volume ?? 30) });
    break;
  default:
    break;
}
`);
await chmod(fakeMpcPath, 0o755);
  await writeFile(fakeSqlitePath, `#!/usr/bin/env node
if (process.argv.join(" ").includes("cfg_radio")) {
  process.stdout.write([
    "505|Tikpal Focus - Runtime Restore|${radioUri}|Focus|Runtime FM|320|MP3|local",
    "506|Tikpal Focus - Runtime Other|${otherRadioUri}|Focus|Other FM|320|MP3|local"
  ].join("\\n") + "\\n");
}
`);
  await chmod(fakeSqlitePath, 0o755);

  await writeFile(roomExperienceStatePath, `${JSON.stringify({ mode: "hifi", sceneSoundEnabled: false }, null, 2)}\n`);
  await writeFile(fakeMpdLogPath, "");
  await writeFile(audioSourceMemoryStatePath, `${JSON.stringify({
    target: "radio",
    localTrackPath: null,
    radioStationId: "radio-505",
    updatedAt: "2026-07-02T00:00:00.000Z"
  }, null, 2)}\n`);
  await writeFile(fakeMpcStatePath, JSON.stringify({
    currentFile: "",
    queue: [],
    current: 0,
    playbackState: "stopped",
    volume: 30,
    switchCount: 0
  }));

  const server = spawn(process.execPath, ["server/index.mjs"], {
    env: mpcFocusedSmokeEnv({
      PATH: `${workspace}${path.delimiter}${process.env.PATH ?? ""}`,
      TIKPAL_API_HOST: HOST,
      TIKPAL_API_PORT: String(port),
      TIKPAL_PLAYER_BACKEND: "mpc",
      TIKPAL_MPC_BIN: fakeMpcPath,
      TIKPAL_SQLITE_BIN: fakeSqlitePath,
      TIKPAL_MPD_HOST: "127.0.0.1",
      TIKPAL_MPD_PORT: "6600",
      TIKPAL_MPD_LOG_PATH: fakeMpdLogPath,
      TIKPAL_MPD_DEFAULT_QUEUE_PATH: "Codex",
      TIKPAL_RADIO_DEFAULT_URI: "",
      TIKPAL_RADIO_ACTIVATE_COMMAND: "",
      TIKPAL_RADIO_START_VERIFY_WINDOW_MS: "40",
      TIKPAL_RADIO_START_VERIFY_POLL_MS: "20",
      TIKPAL_RADIO_POST_START_SETTLE_MS: "20",
      TIKPAL_RADIO_POST_START_RECOVERY_PLAYS: "0",
      TIKPAL_RADIO_LATE_PLAY_NUDGE_DELAYS_MS: "",
      TIKPAL_ROOM_EXPERIENCE_STATE_PATH: roomExperienceStatePath,
      TIKPAL_AUDIO_SOURCE_MEMORY_STATE_PATH: audioSourceMemoryStatePath,
      TIKPAL_PLAYBACK_MODE_STATE_PATH: playbackModeStatePath,
      TIKPAL_WEB_MODE_STATE_PATH: webModeStatePath,
      TIKPAL_OUTPUT_VOLUME_GET_COMMAND: "",
      TIKPAL_RADIO_XRUN_GRACE_MS: "500",
      TIKPAL_RADIO_XRUN_WINDOW_MS: "5000",
      TIKPAL_RADIO_XRUN_SKIP_THRESHOLD: "3",
      TIKPAL_HIFI_RUNTIME_RECOVERY_COOLDOWN_MS: "1000",
      TIKPAL_HIFI_RUNTIME_RECOVERY_MUTATION_QUIET_MS: "1",
      TIKPAL_STATE_SNAPSHOT_REFRESH_MS: "1000"
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForHealthAt(baseUrl);
    let recoveredRadio = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const state = await requestFrom(baseUrl, "/api/v1/system/state");
      if (
        state.response.ok
        && state.body.audio.currentSource.id === "radio"
        && state.body.audio.currentSource.radioStationId === "radio-505"
        && state.body.playback.state === "playing"
      ) {
        recoveredRadio = state.body;
        break;
      }
      await wait(150);
    }
    assert(recoveredRadio, "mpc Hi-Fi startup should restore Radio before the runtime recovery smoke");
    let fakeState = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
    assert(fakeState.currentFile === radioUri, "mpc Hi-Fi runtime recovery should start the remembered Radio URI");

    await requestFrom(baseUrl, "/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "pause" })
    });
    await wait(2500);
    fakeState = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
    assert(fakeState.playbackState === "paused", "mpc Hi-Fi runtime recovery should not resume a user-paused Radio station");

    await writeFile(fakeMpcStatePath, JSON.stringify({ ...fakeState, currentFile: "", queue: [], playbackState: "stopped" }));
    recoveredRadio = null;
    let lastRuntimeRecoveryState = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const state = await requestFrom(baseUrl, "/api/v1/system/state");
      if (state.response.ok) lastRuntimeRecoveryState = state.body;
      if (
        state.response.ok
        && state.body.audio.currentSource.id === "radio"
        && state.body.audio.currentSource.radioStationId === "radio-505"
        && state.body.playback.state === "playing"
      ) {
        recoveredRadio = state.body;
        break;
      }
      await wait(150);
    }
    assert(
      recoveredRadio,
      `mpc Hi-Fi runtime recovery should restore stopped remembered Radio without a restart: ${JSON.stringify({
        currentSource: lastRuntimeRecoveryState?.audio?.currentSource,
        playback: lastRuntimeRecoveryState?.playback,
        rememberedSource: lastRuntimeRecoveryState?.audio?.rememberedSource
      })}`
    );

    await writeFile(fakeMpcStatePath, JSON.stringify({
      currentFile: "http://radio.example/runtime-unknown",
      queue: [],
      current: 0,
      playbackState: "playing",
      volume: 30,
      switchCount: 0
    }));
    await wait(2500);
    fakeState = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
    assert(fakeState.currentFile === "http://radio.example/runtime-unknown", "mpc Hi-Fi runtime recovery should not reload a playing Radio stream when station id is temporarily missing");
    assert(fakeState.switchCount === 0, "mpc Hi-Fi runtime recovery should wait for station identity before restoring a playing Radio stream");

    await writeFile(fakeMpcStatePath, JSON.stringify({
      currentFile: radioUri,
      queue: [],
      current: 0,
      playbackState: "playing",
      volume: 30,
      switchCount: 0
    }));
    const shortXrunBaseMs = Date.now();
    await writeFile(fakeMpdLogPath, [
      xrunLogLine(shortXrunBaseMs, -9000),
      xrunLogLine(shortXrunBaseMs, -8000),
      xrunLogLine(shortXrunBaseMs, -7000),
      radioPlayedLogLine(radioUri, shortXrunBaseMs),
      xrunLogLine(shortXrunBaseMs, 100)
    ].join("\n") + "\n");
    await wait(1500);
    await requestFrom(baseUrl, "/api/v1/system/state");
    fakeState = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
    assert(fakeState.currentFile === radioUri, "mpc Radio weak-network recovery should tolerate a short xrun burst");
    assert(fakeState.switchCount === 0, "mpc Radio weak-network recovery should ignore stale xrun lines from a previous Radio stream");

    const repeatedXrunBaseMs = Date.now() - 3000;
    await writeFile(fakeMpdLogPath, [
      xrunLogLine(repeatedXrunBaseMs, -9000),
      radioPlayedLogLine(radioUri, repeatedXrunBaseMs),
      xrunLogLine(repeatedXrunBaseMs, 500),
      xrunLogLine(repeatedXrunBaseMs, 1500),
      xrunLogLine(repeatedXrunBaseMs, 2500),
      xrunLogLine(repeatedXrunBaseMs, 3000)
    ].join("\n") + "\n");
    await writeFile(webModeStatePath, `${JSON.stringify({ activeProvider: "qq_music" }, null, 2)}\n`);
    await wait(1500);
    fakeState = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
    assert(fakeState.currentFile === radioUri, "mpc Radio background recovery should not auto-advance while Explore is active");
    assert(fakeState.switchCount === 0, "mpc Radio background recovery should not restart MPD while Explore is active");
    await writeFile(webModeStatePath, `${JSON.stringify({ activeProvider: null }, null, 2)}\n`);
    let xrunSkippedRadio = null;
    let rememberedAfterXrunSkip = null;
    let lastXrunSkipState = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const state = await requestFrom(baseUrl, "/api/v1/system/state");
      lastXrunSkipState = state.body;
      fakeState = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
      rememberedAfterXrunSkip = JSON.parse(await readFile(audioSourceMemoryStatePath, "utf8"));
      if (
        state.response.ok
        && state.body.audio.currentSource.radioStationId === "radio-506"
        && fakeState.currentFile === otherRadioUri
        && rememberedAfterXrunSkip.radioStationId === "radio-506"
      ) {
        xrunSkippedRadio = state.body;
        break;
      }
      await wait(150);
    }
    assert(
      xrunSkippedRadio,
      `mpc Radio weak-network recovery should auto-advance after repeated xrun stalls: ${JSON.stringify({
        fakeState,
        rememberedAfterXrunSkip,
        mpdLog: await readFile(fakeMpdLogPath, "utf8"),
        mpcLog: await readFile(fakeMpcCommandLogPath, "utf8"),
        state: lastXrunSkipState?.audio?.currentSource,
        playback: lastXrunSkipState?.playback
      })}`
    );

    const librarySwitch = await requestFrom(baseUrl, "/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "mpd", localTrackPath: rememberedTrackPath })
    });
    assert(
      librarySwitch.response.ok,
      `mpc Hi-Fi runtime recovery smoke should update remembered Library through the source API: ${librarySwitch.response.status} ${JSON.stringify(librarySwitch.body)}`
    );

    await writeFile(fakeMpcStatePath, JSON.stringify({
      currentFile: "",
      queue: [`Codex/${rememberedTrackPath}`],
      current: 0,
      playbackState: "paused",
      volume: 30,
      switchCount: 0
    }));
    await wait(2500);
    fakeState = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
    assert(fakeState.playbackState === "paused", "mpc Hi-Fi runtime recovery should not resume a user-paused Library track");
    assert(fakeState.switchCount === 0, "mpc Hi-Fi runtime recovery should not reload Library while paused");

    await writeFile(fakeMpcStatePath, JSON.stringify({ ...fakeState, currentFile: "", queue: [], current: 0, playbackState: "stopped" }));
    let recoveredLibrary = null;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const state = await requestFrom(baseUrl, "/api/v1/system/state");
      if (
        state.response.ok
        && state.body.audio.currentSource.id === "mpd"
        && state.body.playback.state === "playing"
        && state.body.playback.queuePreview.some((entry) => entry.active && entry.id === `Codex/${rememberedTrackPath}`)
      ) {
        recoveredLibrary = state.body;
        break;
      }
      await wait(150);
    }
    assert(recoveredLibrary, "mpc Hi-Fi runtime recovery should restore stopped remembered Library playback");

    const shuffleMode = await requestFrom(baseUrl, "/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "play_mode_set", mode: "shuffle" })
    });
    assert(shuffleMode.response.ok, "mpc Hi-Fi runtime recovery smoke should enable Library shuffle mode");
    await writeFile(fakeMpcStatePath, JSON.stringify({
      currentFile: "",
      queue: fakeMpcTracks,
      current: 1,
      playbackState: "playing",
      volume: 30,
      switchCount: 0
    }));
    await wait(2500);
    await requestFrom(baseUrl, "/api/v1/system/state");
    fakeState = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
    assert(fakeState.current === 1, "mpc Hi-Fi runtime recovery should not pull shuffle playback back to the remembered Library track");
    assert(fakeState.switchCount === 0, "mpc Hi-Fi runtime recovery should not reload Library while shuffle is playing a different track");
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
  const fakeUsbIndexPath = path.join(workspace, "usb-index.ready");
  const fakeUsbScanLogPath = path.join(workspace, "usb-scan.log");
  const fakeUsbScanCommandPath = path.join(workspace, "usb-scan-command.mjs");
  const fakeExternalDisableLogPath = path.join(workspace, "external-disable.log");
  const fakeExternalDisableCommandPath = path.join(workspace, "external-disable.mjs");
  const fakeWebModeLogPath = path.join(workspace, "web-mode.log");
  const fakeWebModeEntryPreparedPath = path.join(workspace, "web-mode-entry-prepared.started");
  const fakeWebModeEntryPrepareReleasePath = path.join(workspace, "web-mode-entry-prepared.release");
  const fakeWebModeRetryMarkerPath = path.join(workspace, "web-mode-retry.marker");
  const fakeWebModeCommandPath = path.join(workspace, "web-mode-command.mjs");
  const fakeWebModeResidentScenarioPath = path.join(workspace, "web-mode-resident-scenario.json");
  const fakeWebModeResidentEventsPath = path.join(workspace, "web-mode-resident-events.log");
  const fakeWebModeSettingsPath = path.join(workspace, "web-mode-settings.json");
  const fakeWebModeStatePath = path.join(workspace, "web-mode-state.json");
  const fakeWebModeHandoffStatePath = path.join(workspace, "web-mode-handoff.json");
  const fakeAudioSourceMemoryStatePath = path.join(workspace, "audio-source-memory.json");
  const fakePlaybackModeStatePath = path.join(workspace, "playback-mode-state.json");
  const fakeMpdMusicRoot = path.join(workspace, "mpd-music");
  const fakeUsbRoot = path.join(workspace, "Session Disk");
  const fakeNasRoot = path.join(workspace, "TikpalNAS");
  const fakeMpcTracks = [
    "Codex/Focus/Lo-fi Ambient/FASSounds - Good Night - Lofi Cozy Chill Music - 02m27s - Lo-fi.mp3",
    "Codex/Focus/Lo-fi Ambient/FASSounds - Lofi Study - Calm Peaceful Chill Hop - 02m27s - Lo-fi.mp3",
    "Codex/Focus/Lo-fi Ambient/AtlasAudio - Ambient Soundscapes - 04m56s - Ambient.mp3"
  ];
  const fakeMpcUsbTracks = [
    "USB/Session Disk/Set/Live Take.flac"
  ];
  const fakeMpcNasTracks = [
    "NAS/TikpalNAS/Album/NAS Take.flac"
  ];

  await mkdir(path.join(fakeUsbRoot, "Set"), { recursive: true });
  await mkdir(path.join(fakeNasRoot, "Album"), { recursive: true });
  await mkdir(path.join(fakeMpdMusicRoot, "Codex"), { recursive: true });
  await writeFile(path.join(fakeUsbRoot, "Set", "Live Take.flac"), "fake usb flac");
  await writeFile(path.join(fakeNasRoot, "Album", "NAS Take.flac"), "fake nas flac");
  await writeFile(fakeUsbScanLogPath, "");
  await writeFile(fakeUsbScanCommandPath, `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";

appendFileSync(${JSON.stringify(fakeUsbScanLogPath)}, (process.argv.slice(2).join("\\t") || "apply") + "\\n");
writeFileSync(${JSON.stringify(fakeUsbIndexPath)}, "ready\\n");
`);
  await chmod(fakeUsbScanCommandPath, 0o755);
  await writeFile(fakeMpcPath, `#!/usr/bin/env node
	import { appendFileSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { relative, sep } from "node:path";

const logPath = process.env.TIKPAL_FAKE_MPC_LOG;
const statePath = process.env.TIKPAL_FAKE_MPC_STATE;
const libraryTracks = JSON.parse(process.env.TIKPAL_FAKE_MPC_TRACKS ?? "[]");
const usbLibraryTracks = JSON.parse(process.env.TIKPAL_FAKE_MPC_USB_TRACKS ?? "[]");
const nasLibraryTracks = JSON.parse(process.env.TIKPAL_FAKE_MPC_NAS_TRACKS ?? "[]");
const usbIndexPath = process.env.TIKPAL_FAKE_MPC_USB_INDEX_PATH ?? "";
const musicRoot = ${JSON.stringify(fakeMpdMusicRoot)};
const positionalPlayStaysPaused = process.env.TIKPAL_FAKE_MPC_POSITIONAL_PLAY_STAYS_PAUSED === "1";
const currentFileOnly = process.env.TIKPAL_FAKE_MPC_CURRENT_FILE_ONLY === "1";
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

function tracksUnderTarget(target, tracks) {
  if (!target) return tracks;
  return tracks.filter((track) => track === target || track.startsWith(target + "/"));
}

function collectFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolutePath = root + sep + entry.name;
    if (entry.isDirectory()) {
      files.push(...collectFiles(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

function localImportTracks() {
  const importsRoot = musicRoot + sep + "Codex" + sep + "USB Imports";
  try {
    if (!statSync(importsRoot).isDirectory()) return [];
  } catch {
    return [];
  }
  return collectFiles(importsRoot).map((file) => relative(musicRoot, file).split(sep).join("/"));
}

function allLibraryTracks() {
  return [...libraryTracks, ...localImportTracks()];
}

function usbTracksVisible() {
  if (!usbIndexPath) return true;
  try {
    readFileSync(usbIndexPath, "utf8");
    return true;
  } catch {
    return false;
  }
}

if (logPath) appendFileSync(logPath, args.join("\\t") + "\\n");

const [command, ...rest] = args;
const state = readState();

switch (command) {
		  case "listall": {
		    const target = rest[0] ?? "";
		    const visibleLocalTracks = allLibraryTracks();
		    const visibleUsbTracks = usbTracksVisible() ? usbLibraryTracks : [];
		    const nasMatches = tracksUnderTarget(target, nasLibraryTracks);
		    const usbMatches = tracksUnderTarget(target, visibleUsbTracks);
		    const localMatches = tracksUnderTarget(target, visibleLocalTracks);
		    if (target === "Codex") output(visibleLocalTracks.join("\\n") + "\\n");
		    else if (visibleLocalTracks.includes(target) || visibleUsbTracks.includes(target) || nasLibraryTracks.includes(target)) output(target + "\\n");
		    else if (localMatches.length > 0) output(localMatches.join("\\n") + "\\n");
		    else if (usbMatches.length > 0) output(usbMatches.join("\\n") + "\\n");
		    else if (nasMatches.length > 0) output(nasMatches.join("\\n") + "\\n");
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
		    const visibleLocalTracks = allLibraryTracks();
		    const visibleUsbTracks = usbTracksVisible() ? usbLibraryTracks : [];
		    const nasMatches = tracksUnderTarget(target, nasLibraryTracks);
		    const usbMatches = tracksUnderTarget(target, visibleUsbTracks);
		    const localMatches = tracksUnderTarget(target, visibleLocalTracks);
		    if (target === "Codex") state.queue.push(...visibleLocalTracks);
		    else if (usbMatches.length > 0) state.queue.push(...usbMatches);
		    else if (nasMatches.length > 0) state.queue.push(...nasMatches);
		    else if (localMatches.length > 0) state.queue.push(...localMatches);
		    else if (visibleLocalTracks.includes(target) || visibleUsbTracks.includes(target) || nasLibraryTracks.includes(target)) state.queue.push(target);
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
    state.elapsed = "0:01";
    writeState(state);
    break;
  case "current": {
    const file = state.queue[state.current] ?? "";
    if (file) output(currentFileOnly ? file + "\\n" : "Fake Title\\tFake Artist\\tFake Album\\t" + file + "\\t02:27\\n");
    break;
  }
	  case "status":
	    if (state.queue.length > 0) {
	      output("[" + state.state + "] #" + (state.current + 1) + "/" + state.queue.length + " " + (state.elapsed ?? "0:01") + "/" + (state.duration ?? "2:27") + " (0%)\\n");
	    }
	    output(
	      "volume:" + state.volume
	      + "%   repeat: " + (state.repeat ? "on" : "off")
	      + "   random: " + (state.random ? "on" : "off")
	      + "   single: " + (state.single ? "on" : "off")
	      + "   consume: off\\n"
	    );
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
  case "stop":
    state.state = "stopped";
    writeState(state);
    break;
	  case "random":
	    state.random = rest[0] === "on";
	    writeState(state);
	    break;
	  case "repeat":
	    state.repeat = rest[0] === "on";
	    writeState(state);
	    break;
	  case "single":
	    state.single = rest[0] === "on";
	    writeState(state);
	    break;
	  default:
	    break;
}
`);
  await chmod(fakeMpcPath, 0o755);
  await writeFile(fakeMpcLogPath, "");
  await writeFile(fakeExternalDisableLogPath, "");
  await writeFile(fakeExternalDisableCommandPath, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";

appendFileSync(${JSON.stringify(fakeExternalDisableLogPath)}, (process.argv[2] ?? "disable") + "\\n");
`);
  await chmod(fakeExternalDisableCommandPath, 0o755);
  await writeFile(fakeWebModeLogPath, "");
  const fakeWebModeCommandSource = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const keyboardEnv = args[0] === "keyboard"
  ? [
      process.env.TIKPAL_WEB_MODE_ONBOARD_REQUESTED_POSITION ?? "",
      process.env.TIKPAL_WEB_MODE_ONBOARD_POSITION ?? "",
      process.env.TIKPAL_WEB_MODE_ONBOARD_WINDOW ?? ""
    ]
  : [];
appendFileSync(${JSON.stringify(fakeWebModeLogPath)}, [...args, ...keyboardEnv].join("\\t") + "\\n");
`;
  const fakeFailingWebModeCommandSource = (failedProvider) => `#!/usr/bin/env node
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(fakeWebModeLogPath)}, args.join("\\t") + "\\n");
if (args[0] === "open" && args[1] === ${JSON.stringify(failedProvider)}) {
  console.error("[tikpal-web-mode] ERROR: " + args[1] + " did not open");
  process.exit(1);
}
`;
  const fakeDelayedResidentWebModeCommandSource = `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(fakeWebModeLogPath)}, args.join("\\t") + "\\n");
if (args[0] !== "open" || !process.env.TIKPAL_WEB_MODE_OPEN_REQUEST_ID) process.exit(0);
const provider = args[1];
const scenarios = JSON.parse(readFileSync(${JSON.stringify(fakeWebModeResidentScenarioPath)}, "utf8"));
const scenario = scenarios[provider];
if (!scenario) process.exit(0);
const eventPath = ${JSON.stringify(fakeWebModeResidentEventsPath)};
appendFileSync(eventPath, "started\\t" + provider + "\\n");
const releasePath = ${JSON.stringify(fakeWebModeResidentScenarioPath)} + "." + provider + ".release";
while (!existsSync(releasePath)) {
  await new Promise((resolve) => setTimeout(resolve, 10));
}
appendFileSync(eventPath, "finished\\t" + provider + "\\n");
if (scenario === "fail") {
  console.error("[tikpal-web-mode] ERROR: " + provider + " did not open");
  process.exit(1);
}
`;
  await writeFile(fakeWebModeCommandPath, fakeWebModeCommandSource);
  await chmod(fakeWebModeCommandPath, 0o755);

  const server = spawn(process.execPath, ["server/index.mjs"], {
    env: mpcFocusedSmokeEnv({
      TIKPAL_API_HOST: HOST,
      TIKPAL_API_PORT: String(port),
      TIKPAL_PLAYER_BACKEND: "mpc",
      TIKPAL_MPC_BIN: fakeMpcPath,
      TIKPAL_MPD_HOST: "127.0.0.1",
      TIKPAL_MPD_PORT: "6600",
      TIKPAL_MPD_DEFAULT_QUEUE_PATH: "Codex",
      TIKPAL_MPD_MUSIC_ROOT: fakeMpdMusicRoot,
      TIKPAL_LIBRARY_AUDIO_PROBE_ENABLED: "0",
	      TIKPAL_USB_LIBRARY_ROOTS: fakeUsbRoot,
	      TIKPAL_USB_LIBRARY_MPD_PREFIX: "USB",
	      TIKPAL_USB_LIBRARY_SCAN_COMMAND: `${process.execPath} ${fakeUsbScanCommandPath}`,
	      TIKPAL_USB_LIBRARY_AUTO_UPDATE: "1",
	      TIKPAL_USB_LIBRARY_AUTO_UPDATE_MIN_MS: "50",
	      TIKPAL_NAS_LIBRARY_ROOTS: fakeNasRoot,
	      TIKPAL_NAS_LIBRARY_MPD_PREFIX: "NAS",
	      TIKPAL_OUTPUT_VOLUME_GET_COMMAND: "",
      TIKPAL_ROOM_EXPERIENCE_STATE_PATH: roomExperienceStatePath,
      TIKPAL_AUDIO_SOURCE_MEMORY_STATE_PATH: fakeAudioSourceMemoryStatePath,
      TIKPAL_PLAYBACK_MODE_STATE_PATH: fakePlaybackModeStatePath,
      TIKPAL_SPOTIFY_ACTIVATE_COMMAND: `${process.execPath} ${fakeExternalDisableCommandPath} spotify-enable`,
      TIKPAL_SPOTIFY_READY_COMMAND: "true",
      TIKPAL_SPOTIFY_ACTIVE_COMMAND: "true",
      TIKPAL_SPOTIFY_DISABLE_COMMAND: `${process.execPath} ${fakeExternalDisableCommandPath} spotify-disable`,
      TIKPAL_BLUETOOTH_ENABLE_COMMAND: `${process.execPath} ${fakeExternalDisableCommandPath} bluetooth-enable`,
      TIKPAL_BLUETOOTH_READY_COMMAND: "true",
      TIKPAL_BLUETOOTH_ACTIVE_COMMAND: "true",
      TIKPAL_BLUETOOTH_DISABLE_COMMAND: `${process.execPath} ${fakeExternalDisableCommandPath} bluetooth-disable`,
      TIKPAL_AIRPLAY_DISABLE_COMMAND: `${process.execPath} ${fakeExternalDisableCommandPath} airplay-disable`,
      TIKPAL_AIRPLAY_RECEIVER_ACTIVE_COMMAND: "true",
      TIKPAL_UPNP_DISABLE_COMMAND: `${process.execPath} ${fakeExternalDisableCommandPath} upnp-disable`,
      TIKPAL_WEB_MODE_COMMAND: `${process.execPath} ${fakeWebModeCommandPath}`,
      TIKPAL_WEB_MODE_SETTINGS_PATH: fakeWebModeSettingsPath,
      TIKPAL_WEB_MODE_STATE_PATH: fakeWebModeStatePath,
      TIKPAL_WEB_MODE_HANDOFF_STATE_PATH: fakeWebModeHandoffStatePath,
      TIKPAL_FAKE_MPC_LOG: fakeMpcLogPath,
      TIKPAL_FAKE_MPC_STATE: fakeMpcStatePath,
	      TIKPAL_FAKE_MPC_TRACKS: JSON.stringify(fakeMpcTracks),
	      TIKPAL_FAKE_MPC_USB_TRACKS: JSON.stringify(fakeMpcUsbTracks),
	      TIKPAL_FAKE_MPC_NAS_TRACKS: JSON.stringify(fakeMpcNasTracks),
      TIKPAL_FAKE_MPC_USB_INDEX_PATH: fakeUsbIndexPath,
      TIKPAL_FAKE_MPC_CURRENT_FILE_ONLY: "1",
      TIKPAL_FAKE_MPC_POSITIONAL_PLAY_STAYS_PAUSED: "1"
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    await waitForHealthAt(baseUrl);
    await writeFile(fakeMpcLogPath, "");

    const library = await requestFrom(baseUrl, "/api/v1/audio/library?storage=local&limit=1");
	    assert(library.response.ok, "mpc local library path smoke should read the local library");
	    assert(
	      library.body.storages.find((storage) => storage.id === "nas")?.trackCount === fakeMpcNasTracks.length,
	      "mpc NAS storage count should come from configured NAS roots, not MPD stats"
	    );
    const localTrackPath = library.body.tracks[0]?.path;
    assert(localTrackPath && !localTrackPath.startsWith("Codex/"), "local library should expose manifest-relative track paths");
    let autoUsbIndexReady = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await readFile(fakeUsbIndexPath, "utf8");
        autoUsbIndexReady = true;
        break;
      } catch {
        await wait(50);
      }
    }
    assert(autoUsbIndexReady, "audio library reads should auto-update the USB MPD index after detecting mounted USB tracks");
    assert((await readFile(fakeUsbScanLogPath, "utf8")).includes("apply"), "USB auto-update should run the USB scan command");

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
    const staleLibraryResumeLog = await readFile(fakeMpcLogPath, "utf8");
    assert(
      staleLibraryResume.response.ok,
      `mpc Library resume with replaced-library stale memory should return 200, got ${staleLibraryResume.response.status}: ${JSON.stringify(staleLibraryResume.body)}; mpc log: ${JSON.stringify(staleLibraryResumeLog)}`
    );
    assert(
      staleLibraryResume.body.audio.rememberedSource?.localTrackPath !== staleLocalTrackPath,
      "mpc Library resume should not write back a local track path missing from the current library manifest"
    );

    const spotifyBeforeLibrary = await requestFrom(baseUrl, "/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "spotify" })
    });
    assert(spotifyBeforeLibrary.response.ok, "mpc spotify source preflight should return 200");
    assert(spotifyBeforeLibrary.body.audio.currentSource.id === "spotify", "mpc spotify source preflight should mark Spotify current");

    await writeFile(fakeExternalDisableLogPath, "");
    const switched = await requestFrom(baseUrl, "/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "mpd", localTrackPath })
    });
    assert(switched.response.ok, "mpc local library source switch should return 200");
    assert(
      switched.body.audio.currentSource.id === "mpd",
      `mpc local library source switch should keep Library current even if an old external active probe lingers: ${JSON.stringify({
        currentSource: switched.body.audio.currentSource,
        playback: switched.body.playback,
        sources: switched.body.audio.sources
      })}`
    );
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
    const externalDisableLog = await readFile(fakeExternalDisableLogPath, "utf8");
    assert(
      externalDisableLog.includes("spotify-disable\n")
        && externalDisableLog.includes("bluetooth-disable\n")
        && externalDisableLog.includes("airplay-disable\n")
        && externalDisableLog.includes("upnp-disable\n"),
      `mpc local library switch with a concrete track should synchronously close external sources, got ${JSON.stringify(externalDisableLog)}`
    );

    await writeFile(fakeMpcLogPath, "");
    await writeFile(fakeWebModeLogPath, "");
    await rm(fakeWebModeEntryPreparedPath, { force: true });
    await rm(fakeWebModeEntryPrepareReleasePath, { force: true });
    await writeFile(fakeWebModeCommandPath, `#!/usr/bin/env node
import { appendFileSync, existsSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(fakeWebModeLogPath)}, args.join("\\t") + "\\n");
if (args[0] === "prepare-entry" && args[1] === "qq_music") {
  writeFileSync(${JSON.stringify(fakeWebModeEntryPreparedPath)}, "1\\n");
  while (!existsSync(${JSON.stringify(fakeWebModeEntryPrepareReleasePath)})) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
`);
    const openingWebModeFromPlayingLibrary = requestFrom(baseUrl, "/api/v1/web-mode/actions", {
      method: "POST",
      body: JSON.stringify({ type: "open", provider: "qq_music" })
    });
    let webModeEntryPreparationStarted = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await readFile(fakeWebModeEntryPreparedPath, "utf8");
        webModeEntryPreparationStarted = true;
        break;
      } catch {
        await wait(25);
      }
    }
    assert(webModeEntryPreparationStarted, "web mode open smoke should reach entry preparation");
    const stateDuringWebModeEntry = await requestFrom(baseUrl, "/api/v1/web-mode/state");
    assert(stateDuringWebModeEntry.body.activeProvider === null, "web mode entry should not activate provider audio before the launcher reveals it");
    await writeFile(fakeWebModeEntryPrepareReleasePath, "1\\n");
    const webModeFromPlayingLibrary = await Promise.race([
      openingWebModeFromPlayingLibrary,
      wait(10_000).then(() => {
        throw new Error(`web mode open stalled; log: ${JSON.stringify(readFile(fakeWebModeLogPath, "utf8"))}`);
      })
    ]);
    await writeFile(fakeWebModeCommandPath, fakeWebModeCommandSource);
    assert(webModeFromPlayingLibrary.response.ok, "web mode open from playing Library should return 200");
    assert(webModeFromPlayingLibrary.body.activeProvider === "qq_music", "web mode open from playing Library should activate QQ Music");
    const webModeEntryLog = await readFile(fakeWebModeLogPath, "utf8");
    assert(
      webModeEntryLog.indexOf("prepare-entry\tqq_music\n") >= 0 &&
        webModeEntryLog.indexOf("prepare-entry\tqq_music\n") < webModeEntryLog.indexOf("open\tqq_music\n"),
      "web mode should finish entry preparation before it launches the visible provider"
    );
    const pausedDuringExplore = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
    assert(pausedDuringExplore.state === "paused", "web mode open should pause playing Library while Explore owns browser audio");
    const closedPlayingLibraryExplore = await requestFrom(baseUrl, "/api/v1/web-mode/actions", {
      method: "POST",
      body: JSON.stringify({ type: "close" })
    });
    assert(closedPlayingLibraryExplore.response.ok, "web mode close from playing Library should return 200");
    assert(closedPlayingLibraryExplore.body.activeProvider === null, "web mode close should clear the active provider");
    assert(closedPlayingLibraryExplore.body.lastProvider === "qq_music", "web mode close should retain the provider selected before exit");
    assert(closedPlayingLibraryExplore.body.lastError === null, `web mode close should not report a restore error: ${closedPlayingLibraryExplore.body.lastError}`);
    let resumedAfterExplore = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
    for (let attempt = 0; attempt < 20 && resumedAfterExplore.state !== "playing"; attempt += 1) {
      await wait(100);
      resumedAfterExplore = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
    }
    assert(resumedAfterExplore.state === "playing", "web mode close should resume Library only when it was playing before Explore");
    let stateAfterPlayingExplore = await requestFrom(baseUrl, "/api/v1/system/state");
    for (let attempt = 0; attempt < 20 && stateAfterPlayingExplore.body.playback?.state !== "playing"; attempt += 1) {
      await wait(100);
      stateAfterPlayingExplore = await requestFrom(baseUrl, "/api/v1/system/state");
    }
    assert(stateAfterPlayingExplore.body.playback.state === "playing", "system state should show Library playing after Explore returns");
    assert(stateAfterPlayingExplore.body.audio.rememberedSource?.target === "mpd", "web mode return should not replace remembered Library with Explore");
    assert(
      stateAfterPlayingExplore.body.audio.rememberedSource?.localTrackPath === localTrackPath,
      "web mode return should preserve the remembered Library track"
    );
    const playingExploreLog = await readFile(fakeMpcLogPath, "utf8");
    assert(playingExploreLog.includes("pause\n"), "web mode open should issue MPD pause before opening provider audio");
    assert(playingExploreLog.includes("play\n"), "web mode close should issue MPD play to resume the handoff track");

    await requestFrom(baseUrl, "/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "pause" })
    });
    await writeFile(fakeMpcLogPath, "");
    await writeFile(fakeWebModeLogPath, "");
    const webModeFromPausedLibrary = await requestFrom(baseUrl, "/api/v1/web-mode/actions", {
      method: "POST",
      body: JSON.stringify({ type: "open" })
    });
    assert(webModeFromPausedLibrary.response.ok, "web mode reopen from paused Library should return 200");
    assert(webModeFromPausedLibrary.body.activeProvider === "qq_music", "web mode reopen should reuse the provider retained at close");
    assert(
      (await readFile(fakeWebModeLogPath, "utf8")).includes("open\tqq_music\n"),
      "web mode reopen should launch the provider retained at close"
    );
    const closedPausedLibraryExplore = await requestFrom(baseUrl, "/api/v1/web-mode/actions", {
      method: "POST",
      body: JSON.stringify({ type: "close" })
    });
    assert(closedPausedLibraryExplore.response.ok, "web mode close from paused Library should return 200");
    const pausedAfterExplore = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
    assert(pausedAfterExplore.state === "paused", "web mode close should not autoplay Library when it was paused before Explore");
    const pausedExploreLog = await readFile(fakeMpcLogPath, "utf8");
    assert(!pausedExploreLog.split("\n").includes("play"), "web mode close should not issue MPD play for a paused handoff");

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

	    await writeFile(fakeMpcLogPath, "");
	    const shuffle = await requestFrom(baseUrl, "/api/v1/playback/actions", {
	      method: "POST",
	      body: JSON.stringify({ type: "play_mode_set", mode: "shuffle" })
	    });
	    assert(shuffle.response.ok, "mpc local library shuffle mode should return 200");
	    assert(shuffle.body.playback.settings.playMode === "shuffle", "mpc local library shuffle should expose shuffle mode");
	    assert(shuffle.body.playback.currentTrackIndex !== 1, "mpc local library shuffle should immediately leave the current track");
	    assert(shuffle.body.audio.rememberedSource?.localTrackPath !== localTrackPath, "mpc local library shuffle should remember the random track");
	    const shuffleLog = await readFile(fakeMpcLogPath, "utf8");
	    assert(shuffleLog.includes("random\toff"), "mpc local library shuffle should keep MPD random off so Tikpal controls de-duplicated random jumps");
	    assert(shuffleLog.includes("single\ton"), "mpc local library shuffle should keep MPD single mode on so Tikpal owns track boundaries");
	    assert(/(^|\n)play\t[23](\n|$)/.test(shuffleLog), "mpc local library shuffle should jump to a different queue position");

	    await writeFile(fakeMpcLogPath, "");
	    const shuffleNextStartIndex = shuffle.body.playback.currentTrackIndex;
	    const shuffleNext = await requestFrom(baseUrl, "/api/v1/playback/actions", {
	      method: "POST",
	      body: JSON.stringify({ type: "next" })
	    });
	    assert(shuffleNext.response.ok, "mpc local library shuffle next should return 200");
	    assert(shuffleNext.body.playback.currentTrackIndex !== shuffleNextStartIndex, "mpc local library shuffle next should not replay the same queue position");
	    const shuffleNextLog = await readFile(fakeMpcLogPath, "utf8");
	    assert(!shuffleNextLog.split("\n").includes("next"), "mpc local library shuffle next should use an explicit random queue jump");

	    await wait(1800);
	    await writeFile(fakeMpcLogPath, "");
	    const shuffleRepeatStartState = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
	    await writeFile(fakeMpcStatePath, JSON.stringify({
	      ...shuffleRepeatStartState,
	      elapsed: "2:26",
	      duration: "2:27"
	    }));
	    await wait(700);
	    await writeFile(fakeMpcStatePath, JSON.stringify({
	      ...JSON.parse(await readFile(fakeMpcStatePath, "utf8")),
	      elapsed: "0:01",
	      duration: "2:27"
	    }));
	    let shuffleRepeatRecoveryState = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
	    for (let attempt = 0; attempt < 20 && shuffleRepeatRecoveryState.current === shuffleRepeatStartState.current; attempt += 1) {
	      await wait(150);
	      shuffleRepeatRecoveryState = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
	    }
	    assert(
	      shuffleRepeatRecoveryState.current !== shuffleRepeatStartState.current,
	      "mpc local library shuffle monitor should leave a single-mode repeat of the same track"
	    );
	    const shuffleRepeatRecoveryLog = await readFile(fakeMpcLogPath, "utf8");
	    assert(/(^|\n)play\t[123](\n|$)/.test(shuffleRepeatRecoveryLog), "mpc local library shuffle repeat recovery should issue an explicit random play");

	    await requestFrom(baseUrl, "/api/v1/playback/actions", {
	      method: "POST",
	      body: JSON.stringify({ type: "play_mode_set", mode: "sequence" })
	    });

	    const usbLibrary = await requestFrom(baseUrl, "/api/v1/audio/library?storage=usb&limit=5");
    assert(usbLibrary.response.ok, "mpc USB library should return 200");
    const usbTrackPath = usbLibrary.body.tracks[0]?.path;
    assert(usbTrackPath === fakeMpcUsbTracks[0], "mpc USB library should expose MPD-visible USB/<mount name> track paths");
    await writeFile(fakeMpcLogPath, "");
    const switchedUsb = await requestFrom(baseUrl, "/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "mpd", localTrackPath: usbTrackPath })
    });
    assert(switchedUsb.response.ok, "mpc USB local library source switch should return 200");
    assert(switchedUsb.body.audio.currentSource.id === "mpd", "mpc USB switch should keep Library current");
    assert(switchedUsb.body.playback.queueLength === fakeMpcUsbTracks.length, "mpc USB switch should queue the mounted USB root");
    assert(switchedUsb.body.audio.rememberedSource?.localTrackPath === usbTrackPath, "mpc USB switch should remember the selected USB track path");
    const usbLog = await readFile(fakeMpcLogPath, "utf8");
	    assert(usbLog.includes("listall\tUSB/Session Disk"), "mpc USB switch should list the USB mount root");
	    assert(usbLog.includes(`add\t${fakeMpcUsbTracks[0]}`), "mpc USB switch should add only playable USB audio tracks to the queue");
	    assert(!usbLog.split("\n").includes("add\tUSB/Session Disk"), "mpc USB switch should not queue the raw USB mount root because MPD can list Apple resource-fork files");
	    assert(!usbLog.includes("Codex/USB/Session Disk"), "mpc USB switch should not prefix USB paths with the local Codex root");

	    const nasLibrary = await requestFrom(baseUrl, "/api/v1/audio/library?storage=nas&limit=5");
	    assert(nasLibrary.response.ok, "mpc NAS library should return 200");
	    const nasTrackPath = nasLibrary.body.tracks[0]?.path;
	    assert(nasTrackPath === fakeMpcNasTracks[0], "mpc NAS library should expose MPD-visible NAS/<share name> track paths");
	    await writeFile(fakeMpcLogPath, "");
	    const switchedNas = await requestFrom(baseUrl, "/api/v1/audio/source", {
	      method: "POST",
	      body: JSON.stringify({ target: "mpd", localTrackPath: nasTrackPath })
	    });
	    assert(switchedNas.response.ok, "mpc NAS library source switch should return 200");
	    assert(switchedNas.body.audio.currentSource.id === "mpd", "mpc NAS switch should keep Library current");
	    assert(switchedNas.body.playback.queueLength === fakeMpcNasTracks.length, "mpc NAS switch should queue the mounted NAS root");
	    assert(switchedNas.body.audio.rememberedSource?.localTrackPath === nasTrackPath, "mpc NAS switch should remember the selected NAS track path");
	    assert(switchedNas.body.playback.transportCapabilities?.seek === false, "mpc NAS playback should not expose seek");
	    assert(switchedNas.body.playback.transportCapabilities?.reason?.includes("NAS"), "mpc NAS playback should explain why seek is unavailable");
	    const nasLog = await readFile(fakeMpcLogPath, "utf8");
	    assert(nasLog.includes("listall\tNAS/TikpalNAS"), "mpc NAS switch should list the NAS share root");
	    assert(nasLog.includes(`add\t${fakeMpcNasTracks[0]}`), "mpc NAS switch should add only playable NAS audio tracks to the queue");
	    assert(!nasLog.split("\n").includes("add\tNAS/TikpalNAS"), "mpc NAS switch should not queue the raw NAS share root");
	    assert(!nasLog.includes("Codex/NAS/TikpalNAS"), "mpc NAS switch should not prefix NAS paths with the local Codex root");
	    await writeFile(fakeMpcLogPath, "");
	    const nasSeek = await requestFrom(baseUrl, "/api/v1/playback/actions", {
	      method: "POST",
	      body: JSON.stringify({ type: "seek", value: 30 })
	    });
	    assert(nasSeek.response.status === 400, "mpc NAS seek should be rejected quickly");
	    assert(nasSeek.body.message?.includes("NAS"), "mpc NAS seek rejection should mention NAS");
	    assert(!((await readFile(fakeMpcLogPath, "utf8")).split("\n").includes("seek\t30")), "mpc NAS seek should not call mpc seek");

	    const usbFavorite = await requestFrom(baseUrl, "/api/v1/audio/favorites", {
      method: "POST",
      body: JSON.stringify({ trackPath: usbTrackPath, favorite: true })
    });
    assert(usbFavorite.response.ok, "mpc USB favorite add should return 200");
    const usbLibraryAfterFavorite = await requestFrom(baseUrl, "/api/v1/audio/library?storage=usb&limit=5");
    assert(
      usbLibraryAfterFavorite.body.tracks.some((track) => track.path === usbTrackPath && track.favorite === true),
      "mpc USB library should expose favorite=true after saving a USB track"
    );
    const favoriteLibraryAfterUsb = await requestFrom(baseUrl, "/api/v1/audio/library?storage=favorites&limit=20");
    assert(
      favoriteLibraryAfterUsb.body.tracks.some((track) => track.path === usbTrackPath),
      "mpc favorites library should include favorited USB tracks"
    );
    await requestFrom(baseUrl, "/api/v1/audio/favorites", {
      method: "POST",
      body: JSON.stringify({ trackPath: usbTrackPath, favorite: false })
    });

    const copyUsb = await requestFrom(baseUrl, "/api/v1/audio/library-actions", {
      method: "POST",
      body: JSON.stringify({ type: "copy_to_local", trackPath: usbTrackPath })
    });
    assert(copyUsb.response.ok, "mpc USB copy to local should return 200");
    assert(copyUsb.body.copied === true, "mpc USB copy to local should copy a missing local file");
    assert(copyUsb.body.copiedTrackPath === "USB Imports/Session Disk/Set/Live Take.flac", "mpc USB copy should preserve the USB mount and relative path under USB Imports");
    assert(
      (await readFile(path.join(fakeMpdMusicRoot, "Codex", "USB Imports", "Session Disk", "Set", "Live Take.flac"), "utf8")) === "fake usb flac",
      "mpc USB copy should write the file into the local MPD music root"
    );
    assert(
      copyUsb.body.library.tracks.some((track) => track.storage === "local" && track.path === copyUsb.body.copiedTrackPath),
      "mpc USB copy response should expose the imported file as a local track"
    );
	    assert(
	      Number.isFinite(copyUsb.body.library.localStorage?.freeBytes) && Number.isFinite(copyUsb.body.library.localStorage?.usedPercent),
	      "mpc USB copy response should expose local storage usage"
	    );
	    const copiedLocalPlayback = await requestFrom(baseUrl, "/api/v1/audio/source", {
	      method: "POST",
	      body: JSON.stringify({ target: "mpd", localTrackPath: copyUsb.body.copiedTrackPath })
	    });
	    assert(copiedLocalPlayback.response.ok, "copied USB local track should be playable immediately");
	    assert(
	      copiedLocalPlayback.body.audio.rememberedSource?.localTrackPath === copyUsb.body.copiedTrackPath,
	      "copied USB local playback should remember the imported local path"
	    );
	    const copyUsbAgain = await requestFrom(baseUrl, "/api/v1/audio/library-actions", {
	      method: "POST",
	      body: JSON.stringify({ type: "copy_to_local", trackPath: usbTrackPath })
    });
    assert(copyUsbAgain.response.ok, "mpc duplicate USB copy should return 200");
    assert(copyUsbAgain.body.copied === false, "mpc duplicate USB copy should not copy an existing local file");
    const deleteCopiedLocal = await requestFrom(baseUrl, "/api/v1/audio/library-actions", {
      method: "POST",
      body: JSON.stringify({ type: "delete_local", trackPath: copyUsb.body.copiedTrackPath })
    });
    assert(deleteCopiedLocal.response.ok, "mpc local delete should return 200 for an imported local track");
    assert(deleteCopiedLocal.body.deleted === true, "mpc local delete should report deleted=true");
    try {
      await readFile(path.join(fakeMpdMusicRoot, "Codex", "USB Imports", "Session Disk", "Set", "Live Take.flac"), "utf8");
      assert(false, "mpc local delete should remove the copied local file from disk");
    } catch {
      // Expected: the imported file has been deleted.
    }
    assert(
      !deleteCopiedLocal.body.library.tracks.some((track) => track.storage === "local" && track.path === copyUsb.body.copiedTrackPath),
      "mpc local delete response should remove the imported file from local tracks"
    );

    await rm(fakeUsbIndexPath, { force: true });
    await writeFile(fakeUsbScanLogPath, "");
    await writeFile(fakeMpcLogPath, "");
    const switchedUsbAfterMissingIndex = await requestFrom(baseUrl, "/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "mpd", localTrackPath: usbTrackPath })
    });
    assert(switchedUsbAfterMissingIndex.response.ok, "mpc USB switch should refresh MPD and retry when the mounted USB root is not indexed yet");
    assert(switchedUsbAfterMissingIndex.body.playback.queueLength === fakeMpcUsbTracks.length, "mpc USB retry should queue the mounted USB root after refresh");
    assert((await readFile(fakeUsbScanLogPath, "utf8")).includes("apply"), "mpc USB retry should run the USB scan command");

    const bluetoothBeforeExplore = await requestFrom(baseUrl, "/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "bluetooth" })
    });
    assert(bluetoothBeforeExplore.response.ok, "mpc bluetooth source switch before Explore should return 200");
    assert(
      bluetoothBeforeExplore.body.audio.currentSource.id === "bluetooth",
      `mpc bluetooth source switch before Explore should make Bluetooth current: ${JSON.stringify({
        currentSource: bluetoothBeforeExplore.body.audio.currentSource,
        playback: bluetoothBeforeExplore.body.playback,
        sources: bluetoothBeforeExplore.body.audio.sources
      })}`
    );

    await writeFile(fakeExternalDisableLogPath, "");
    await writeFile(fakeWebModeLogPath, "");
    const webModeFromBluetooth = await requestFrom(baseUrl, "/api/v1/web-mode/actions", {
      method: "POST",
      body: JSON.stringify({ type: "open" })
    });
    assert(webModeFromBluetooth.response.ok, "web mode open from Bluetooth should return 200");
    assert(webModeFromBluetooth.body.activeProvider === "qq_music", "web mode open without provider should default to QQ Music");
    const webModeLog = await readFile(fakeWebModeLogPath, "utf8");
    assert(webModeLog.includes("open\tqq_music\n"), `web mode command should open QQ Music by default, got ${JSON.stringify(webModeLog)}`);
    const webModeExternalDisableLog = await readFile(fakeExternalDisableLogPath, "utf8");
    assert(
      webModeExternalDisableLog.includes("spotify-disable\n")
        && webModeExternalDisableLog.includes("bluetooth-disable\n")
        && webModeExternalDisableLog.includes("airplay-disable\n")
        && webModeExternalDisableLog.includes("upnp-disable\n"),
      `web mode open should synchronously close external sources before provider audio starts, got ${JSON.stringify(webModeExternalDisableLog)}`
    );
    const stateAfterWebMode = await requestFrom(baseUrl, "/api/v1/system/state");
    assert(stateAfterWebMode.body.audio.currentSource.id !== "web_mode", "web mode should not become audio source truth");
    assert(stateAfterWebMode.body.audio.rememberedSource?.target === "bluetooth", "web mode should preserve remembered Bluetooth instead of storing Explore");

    const waitForResidentCommandEvent = async (event, provider) => {
      const expected = `${event}\t${provider}\n`;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        let events = "";
        try {
          events = await readFile(fakeWebModeResidentEventsPath, "utf8");
        } catch {}
        if (events.includes(expected)) return;
        await wait(25);
      }
      throw new Error(`resident ${event} event was not observed for ${provider}`);
    };
    const waitForWebModeCommand = async (line) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const log = await readFile(fakeWebModeLogPath, "utf8");
        if (log.includes(line)) return;
        await wait(25);
      }
      throw new Error(`web mode command was not observed: ${JSON.stringify(line)}`);
    };
    await writeFile(fakeWebModeStatePath, JSON.stringify({ activeProvider: "youtube_music", lastProvider: "youtube_music" }));
    await writeFile(fakeWebModeResidentScenarioPath, JSON.stringify({ spotify: "success", qq_music: "success" }));
    await writeFile(fakeWebModeResidentEventsPath, "");
    await writeFile(fakeWebModeCommandPath, fakeDelayedResidentWebModeCommandSource);
    const openingSpotify = await requestFrom(baseUrl, "/api/v1/web-mode/actions", {
      method: "POST",
      body: JSON.stringify({ type: "open", provider: "spotify" })
    });
    assert(
      openingSpotify.response.ok
        && openingSpotify.body.activeProvider === "youtube_music"
        && openingSpotify.body.openingProvider === "spotify",
      "a resident switch should expose the visible provider as Active and only the target as Opening"
    );
    await waitForResidentCommandEvent("started", "spotify");

    const openingQq = await requestFrom(baseUrl, "/api/v1/web-mode/actions", {
      method: "POST",
      body: JSON.stringify({ type: "open", provider: "qq_music" })
    });
    assert(
      openingQq.response.ok
        && openingQq.body.activeProvider === "youtube_music"
        && openingQq.body.openingProvider === "qq_music",
      "a newer resident switch should retain the previous Active provider and replace only Opening"
    );
    await wait(100);
    assert(
      !(await readFile(fakeWebModeResidentEventsPath, "utf8")).includes("started\tqq_music\n"),
      "a newer resident target must wait for the current resident command instead of competing for its lock"
    );
    await writeFile(`${fakeWebModeResidentScenarioPath}.spotify.release`, "1\n");
    await waitForResidentCommandEvent("finished", "spotify");
    await waitForResidentCommandEvent("started", "qq_music");
    const afterStaleSpotify = await requestFrom(baseUrl, "/api/v1/web-mode/state");
    assert(
      afterStaleSpotify.body.activeProvider === "youtube_music" && afterStaleSpotify.body.openingProvider === "qq_music",
      "a stale resident completion must not overwrite a newer Opening request"
    );
    await writeFile(`${fakeWebModeResidentScenarioPath}.qq_music.release`, "1\n");
    await waitForResidentCommandEvent("finished", "qq_music");
    const activeQq = await waitForWebModeStateAt(
      baseUrl,
      (state) => state.activeProvider === "qq_music" && state.openingProvider === null,
      "the current resident request should commit Active only after its command completes"
    );
    assert(activeQq.lastError === null, "a successful resident completion should clear its Opening error");

    await writeFile(fakeWebModeStatePath, JSON.stringify({ activeProvider: "spotify", lastProvider: "spotify" }));
    await writeFile(fakeWebModeResidentScenarioPath, JSON.stringify({ youtube_music: "fail" }));
    await writeFile(fakeWebModeResidentEventsPath, "");
    const openingFailedProvider = await requestFrom(baseUrl, "/api/v1/web-mode/actions", {
      method: "POST",
      body: JSON.stringify({ type: "open", provider: "youtube_music" })
    });
    assert(
      openingFailedProvider.response.ok
        && openingFailedProvider.body.activeProvider === "spotify"
        && openingFailedProvider.body.openingProvider === "youtube_music",
      "a pending resident failure should leave the old provider Active while the target is Opening"
    );
    await waitForResidentCommandEvent("started", "youtube_music");
    await writeFile(`${fakeWebModeResidentScenarioPath}.youtube_music.release`, "1\n");
    await waitForResidentCommandEvent("finished", "youtube_music");
    const afterResidentFailure = await waitForWebModeStateAt(
      baseUrl,
      (state) => state.activeProvider === "spotify" && state.openingProvider === null && state.lastError === "YouTube Music did not open",
      "a failed resident request should retain the old Active provider and publish its error"
    );
    assert(afterResidentFailure.lastProvider === "spotify", "a failed resident request must not replace the last visible provider");

    await writeFile(fakeWebModeStatePath, JSON.stringify({ activeProvider: "spotify", lastProvider: "spotify" }));
    await writeFile(fakeWebModeResidentScenarioPath, JSON.stringify({ qq_music: "success" }));
    await rm(`${fakeWebModeResidentScenarioPath}.qq_music.release`, { force: true });
    await writeFile(fakeWebModeResidentEventsPath, "");
    const openingBeforeClose = await requestFrom(baseUrl, "/api/v1/web-mode/actions", {
      method: "POST",
      body: JSON.stringify({ type: "open", provider: "qq_music" })
    });
    assert(
      openingBeforeClose.response.ok
        && openingBeforeClose.body.activeProvider === "spotify"
        && openingBeforeClose.body.openingProvider === "qq_music",
      "Close ownership smoke should begin with an in-flight resident request"
    );
    await waitForResidentCommandEvent("started", "qq_music");
    const closedDuringResidentOpen = await requestFrom(baseUrl, "/api/v1/web-mode/actions", {
      method: "POST",
      body: JSON.stringify({ type: "close" })
    });
    assert(
      closedDuringResidentOpen.response.ok
        && closedDuringResidentOpen.body.activeProvider === null
        && closedDuringResidentOpen.body.openingProvider === null,
      "Close should clear both Active and Opening ownership immediately"
    );
    await waitForWebModeCommand("close\n");
    await writeFile(`${fakeWebModeResidentScenarioPath}.qq_music.release`, "1\n");
    await waitForResidentCommandEvent("finished", "qq_music");
    const afterCloseWins = await waitForWebModeStateAt(
      baseUrl,
      (state) => state.activeProvider === null && state.openingProvider === null,
      "a resident completion released after Close must not reopen Explore"
    );
    assert(afterCloseWins.lastProvider === "spotify", "Close should retain the last physically visible provider after cancelling Opening");
    await writeFile(fakeWebModeStatePath, JSON.stringify({ activeProvider: "qq_music", lastProvider: "qq_music" }));
    await writeFile(fakeWebModeCommandPath, fakeWebModeCommandSource);
    await writeFile(fakeWebModeLogPath, "");

    await writeFile(fakeWebModeLogPath, "");
    const preloadKeyboard = await requestFrom(baseUrl, "/api/v1/web-mode/actions", {
      method: "POST",
      body: JSON.stringify({ type: "keyboard", preload: true })
    });
    assert(preloadKeyboard.response.ok, "web mode keyboard preload should return 200");
    const preloadKeyboardLog = await readFile(fakeWebModeLogPath, "utf8");
    assert(preloadKeyboardLog.startsWith("keyboard\tpreload\t"), `web mode keyboard preload should warm Onboard without showing geometry, got ${JSON.stringify(preloadKeyboardLog)}`);

    await writeFile(fakeWebModeLogPath, "");
    const movedKeyboard = await requestFrom(baseUrl, "/api/v1/web-mode/actions", {
      method: "POST",
      body: JSON.stringify({ type: "keyboard", enabled: true, force: true, keyboardPosition: "500,80", keyboardWindow: "900x280" })
    });
    assert(movedKeyboard.response.ok, "web mode keyboard should accept local kiosk geometry for focused Console inputs");
    const movedKeyboardLog = await readFile(fakeWebModeLogPath, "utf8");
    assert(
      movedKeyboardLog.includes("keyboard\tshow-force\t1\t500,80\t900x280\n"),
      `web mode keyboard should pass Onboard geometry through environment, got ${JSON.stringify(movedKeyboardLog)}`
    );
    await writeFile(fakeWebModeLogPath, "");
    await rm(fakeWebModeRetryMarkerPath, { force: true });
    await writeFile(fakeWebModeCommandPath, `#!/usr/bin/env node
import { appendFileSync, existsSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const markerPath = ${JSON.stringify(fakeWebModeRetryMarkerPath)};
const keyboardEnv = args[0] === "keyboard"
  ? [
      process.env.TIKPAL_WEB_MODE_ONBOARD_REQUESTED_POSITION ?? "",
      process.env.TIKPAL_WEB_MODE_ONBOARD_POSITION ?? "",
      process.env.TIKPAL_WEB_MODE_ONBOARD_WINDOW ?? ""
    ]
  : [];
if (args[0] === "keyboard" && args[1] === "show-force" && !existsSync(markerPath)) {
  writeFileSync(markerPath, "1\\n");
  console.error("[tikpal-web-mode] ERROR: Explore is already switching");
  process.exit(1);
}
appendFileSync(${JSON.stringify(fakeWebModeLogPath)}, [...args, ...keyboardEnv].join("\\t") + "\\n");
`);
    const retriedKeyboard = await requestFrom(baseUrl, "/api/v1/web-mode/actions", {
      method: "POST",
      body: JSON.stringify({ type: "keyboard", enabled: true, force: true, keyboardPosition: "500,80", keyboardWindow: "900x280" })
    });
    assert(retriedKeyboard.response.ok, "web mode keyboard should retry while Explore is switching");
    const retriedKeyboardMarker = await readFile(fakeWebModeRetryMarkerPath, "utf8");
    assert(retriedKeyboardMarker.trim() === "1", "web mode keyboard retry smoke should exercise the lock conflict path");
    const retriedKeyboardLog = await readFile(fakeWebModeLogPath, "utf8");
    assert(
      retriedKeyboardLog.includes("keyboard\tshow-force\t1\t500,80\t900x280\n"),
      `web mode keyboard retry should preserve Onboard geometry, got ${JSON.stringify(retriedKeyboardLog)}`
    );
    await writeFile(fakeWebModeCommandPath, fakeWebModeCommandSource);
    const invalidKeyboardPosition = await requestFrom(baseUrl, "/api/v1/web-mode/actions", {
      method: "POST",
      body: JSON.stringify({ type: "keyboard", enabled: true, keyboardPosition: "left,top" })
    });
    assert(invalidKeyboardPosition.response.status === 400, "web mode keyboard should reject unsafe Console geometry");

    for (const providerId of ["spotify", "youtube_music", "apple_music", "tidal", "qobuz", "deezer", "amazon_music", "suno", "netease_music"]) {
      await writeFile(fakeExternalDisableLogPath, "");
      await writeFile(fakeWebModeLogPath, "");
      const beforeProviderSwitch = await requestFrom(baseUrl, "/api/v1/web-mode/state");
      const switchedProvider = await requestFrom(baseUrl, "/api/v1/web-mode/actions", {
        method: "POST",
        body: JSON.stringify({ type: "open", provider: providerId })
      });
      assert(switchedProvider.response.ok, `web mode switch to ${providerId} should return 200`);
      if (beforeProviderSwitch.body.activeProvider && beforeProviderSwitch.body.activeProvider !== providerId) {
        assert(
          switchedProvider.body.activeProvider === beforeProviderSwitch.body.activeProvider
            && switchedProvider.body.openingProvider === providerId,
          `resident switch to ${providerId} should retain the visible provider as Active until reveal`
        );
      }
      const settledProviderSwitch = await waitForWebModeStateAt(
        baseUrl,
        (state) => state.activeProvider === providerId && state.openingProvider === null,
        `web mode switch to ${providerId} should settle as Active after the launcher completes`
      );
      assert(settledProviderSwitch.lastError === null, `web mode switch to ${providerId} should clear any prior error after reveal`);
      const providerSwitchLog = await readFile(fakeWebModeLogPath, "utf8");
      assert(providerSwitchLog.includes(`open\t${providerId}\n`), `web mode command should open ${providerId}, got ${JSON.stringify(providerSwitchLog)}`);
      const providerSwitchDisableLog = await readFile(fakeExternalDisableLogPath, "utf8");
      assert(
        providerSwitchDisableLog.trim() === "",
        `web mode resident provider switch to ${providerId} should not rerun the initial Tikpal audio handoff, got ${JSON.stringify(providerSwitchDisableLog)}`
      );
      const stateAfterProviderSwitch = await requestFrom(baseUrl, "/api/v1/system/state");
      assert(stateAfterProviderSwitch.body.audio.currentSource.id !== "web_mode", `web mode switch to ${providerId} should not become audio source truth`);
      assert(stateAfterProviderSwitch.body.audio.rememberedSource?.target === "bluetooth", `web mode switch to ${providerId} should preserve remembered Bluetooth`);
    }

    await writeFile(fakeWebModeCommandPath, fakeFailingWebModeCommandSource("suno"));
    const failedNewProvider = await requestFrom(baseUrl, "/api/v1/web-mode/actions", {
      method: "POST",
      body: JSON.stringify({ type: "open", provider: "suno" })
    });
    assert(
      failedNewProvider.response.ok
        && failedNewProvider.body.activeProvider === "netease_music"
        && failedNewProvider.body.openingProvider === "suno",
      "a resident failure should first report the target as Opening while the old provider remains Active"
    );
    const stateAfterFailedNewProvider = await waitForWebModeStateAt(
      baseUrl,
      (state) => state.activeProvider === "netease_music" && state.openingProvider === null && state.lastError === "Suno did not open",
      "failed resident switches should retain the previous visible provider"
    );
    assert(
      stateAfterFailedNewProvider.activeProvider === "netease_music",
      "failed web mode switch to a new provider should keep the previous provider active"
    );
    assert(stateAfterFailedNewProvider.lastError === "Suno did not open", "failed web mode switch should expose the failed provider message");

    await writeFile(fakeWebModeCommandPath, fakeFailingWebModeCommandSource("netease_music"));
    const failedCurrentProvider = await requestFrom(baseUrl, "/api/v1/web-mode/actions", {
      method: "POST",
      body: JSON.stringify({ type: "open", provider: "netease_music" })
    });
    assert(
      failedCurrentProvider.response.ok
        && failedCurrentProvider.body.activeProvider === "qq_music"
        && failedCurrentProvider.body.openingProvider === null,
      "failed direct-provider reopen should fall back to the other direct provider"
    );
    const stateAfterFailedCurrentProvider = await requestFrom(baseUrl, "/api/v1/web-mode/state");
    assert(
      stateAfterFailedCurrentProvider.body.activeProvider === "qq_music"
        && stateAfterFailedCurrentProvider.body.lastProvider === "qq_music",
      "failed direct-provider reopen should retain its successful fallback as active and last provider"
    );
    assert(stateAfterFailedCurrentProvider.body.lastError === null, "successful direct-provider fallback should clear the original open error");
    await writeFile(fakeWebModeCommandPath, fakeWebModeCommandSource);
    await writeFile(fakeWebModeLogPath, "");
    const reopenedLastProvider = await requestFrom(baseUrl, "/api/v1/web-mode/actions", {
      method: "POST",
      body: JSON.stringify({ type: "open" })
    });
    assert(reopenedLastProvider.response.ok, "web mode reopen without a provider should return 200");
    assert(reopenedLastProvider.body.activeProvider === "qq_music", "web mode reopen without a provider should reuse the last successful provider");
    assert(reopenedLastProvider.body.lastProvider === "qq_music", "web mode reopen should preserve the successful fallback for the next exit");
    const reopenedLastProviderLog = await readFile(fakeWebModeLogPath, "utf8");
    assert(reopenedLastProviderLog.includes("open\tqq_music\n"), `web mode reopen should target the retained provider, got ${JSON.stringify(reopenedLastProviderLog)}`);
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
  const fakeWebModeStatePath = path.join(workspace, "web-mode-state.json");
  const fakePlaybackModeStatePath = path.join(workspace, "playback-mode-state.json");
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
  await writeFile(path.join(fakeLogoDir, "Soma FM - Cliqhop.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  await writeFile(path.join(fakeLogoDir, "Soma FM - Fluid.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  await writeFile(fakeAudioVolumeStatePath, JSON.stringify({ version: 1, lastNonZeroPercent: 44, updatedAt: "2026-01-01T00:00:00.000Z" }));
  await writeFile(fakeWebModeStatePath, JSON.stringify({ activeProvider: null, lastError: null, updatedAt: "2026-01-01T00:00:00.000Z" }));
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
      ? "Calm Radio Test\\tInternet Radio\\tRadio\\t" + state.currentFile + "\\t0:00\\n"
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
    if (state.currentFile) process.stdout.write("0\\tCalm Radio Test\\tInternet Radio\\tRadio\\t0:00\\t" + state.currentFile + "\\n");
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
    "500|Focus - Soma FM Cliqhop|http://radio.example/focus-cliqhop|Focus, IDM, Downtempo, Study Beats|Soma FM|128|MP3|local",
    "501|Focus - Soma FM Beat Blender|http://radio.example/focus-beatblender|Focus, Downtempo, Deep House, Study|Soma FM|128|MP3|local",
    "502|Focus - Dead Link|http://radio.example/focus-dead|Focus, Failing Stream|Dead FM|320|MP3|local",
    "510|Calm - Positively Meditation|http://radio.example/calm-meditation|Calm, Meditation, Healing|Positivity Radio|128|MP3|local",
    "511|Calm - Soma FM Fluid|${radioUri}|Calm, Ambient, Downtempo, Meditation|Soma FM|128|MP3|local",
    "512|Calm - Soma FM Synphaera|http://radio.example/calm-synphaera|Calm, Ambient, Meditation|Soma FM|128|MP3|local",
    "520|Sleep - Ambient Sleeping Pill|http://radio.example/sleep-ambient|Sleep, Ambient|Stereoscenic|256|MP3|local",
    "521|Sleep - Soma FM Drone Zone|http://radio.example/sleep-drone|Sleep, Electronica, Ambient|Soma FM|128|AAC|local",
    "522|Sleep - Soma FM Deep Space One|http://radio.example/sleep-space|Sleep, Electronica, Space Music|Soma FM|128|AAC|local",
    "530|Jazz - Jazz24|http://radio.example/jazz24|Jazz|Jazz24.org|256|AAC|local",
    "531|Jazz - The Jazz Groove|http://radio.example/the-jazz-groove|Jazz|The Jazz Groove|128|MP3|local",
    "532|Jazz - Linn Jazz|http://radio.example/linn-jazz|Jazz|Linn|320|MP3|local",
    "590|Classical - BR-Klassik|http://radio.example/br-klassik|Classical|Bayern Radio|192|MP3|local",
    "591|Classical - NPO Klassiek|http://radio.example/npo-klassiek|Classical|NPO|192|MP3|local",
    "592|Classical - Linn Classical|http://radio.example/linn-classical|Classical|Linn|320|MP3|local",
    "600|News - NPR Program Stream|http://radio.example/npr-news|News, Public Radio, Talk|NPR|128|MP3|local",
    "601|News - DR P1|http://radio.example/dr-p1|News, Talk|DR|128|MP3|local",
    "602|News - Radio SRF 4 News|http://radio.example/srf-news|News, Current Affairs|SRF|128|MP3|local",
    "610|Hi-Fi - Radio Paradise FLAC|http://radio.example/hifi-rp|Hi-Fi, Eclectic|Radio Paradise|900|FLAC|local",
    "611|Hi-Fi - Naim Radio|http://radio.example/naim-radio|Hi-Fi, Eclectic|Naim|320|AAC|local",
    "612|Hi-Fi - Linn Radio|http://radio.example/linn-radio|Hi-Fi, Eclectic|Linn|320|MP3|local",
    "540|Blues - 1.FM Blues Radio|http://radio.example/blues|Blues|1.FM|192|MP3|local",
    "541|Blues - WDCB Chicago Jazz & Blues|http://radio.example/wdcb|Blues, Jazz|DuPage College|128|MP3|local",
    "542|Blues - WWOZ New Orleans|http://radio.example/wwoz|Blues, Jazz, Funk|WWOZ|128|MP3|local",
    "550|Rock - Radio Paradise Rock|http://radio.example/rp-rock|Rock|Radio Paradise|900|FLAC|local",
    "551|Rock - Radio Caroline|http://radio.example/radio-caroline|Rock, Classic Rock|Radio Caroline|96|MP3|local",
    "552|Rock - Soma FM Digitalis|http://radio.example/digitalis|Rock, Indie|Soma FM|128|AAC|local",
    "560|World - Radio Paradise World|http://radio.example/rp-world|World, World Music|Radio Paradise|900|FLAC|local",
    "561|World - Hi On Line World|http://radio.example/hionline-world|World, World Music|Hi.Fine|320|MP3|local",
    "562|World - Soma FM Suburbs of Goa|http://radio.example/suburbs-of-goa|World, World Music, Desi|Soma FM|128|AAC|local",
    "570|Electronic - FluxFM ElectroFlux|http://radio.example/electroflux|Electronic, Pop|FluxFM|256|MP3|local",
    "571|Electronic - FluxFM Techno Underground|http://radio.example/techno-underground|Electronic, Techno|FluxFM|256|MP3|local",
    "572|Electronic - Soma FM PopTron|http://radio.example/poptron|Electronic, Electro-Pop|Soma FM|128|AAC|local",
    "580|Podcast - BBC Radio 4|http://radio.example/bbc-radio-4|Podcast, Spoken Word, Talk|BBC|96|AAC-LC|local",
    "581|Podcast - France Culture Live|http://radio.example/france-culture|Podcast, Spoken Word, Current Affairs|Radio France|128|MP3|local",
    "582|Podcast - NPR Program Stream|http://radio.example/npr|Podcast, Public Radio, Talk|NPR|128|MP3|local"
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
      TIKPAL_PLAYBACK_MODE_STATE_PATH: fakePlaybackModeStatePath,
      TIKPAL_MPD_STARTUP_VOLUME: "-1",
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
      TIKPAL_UPNP_READY_COMMAND: "true",
      TIKPAL_UPNP_ENABLE_COMMAND: "true",
      TIKPAL_UPNP_DISABLE_COMMAND: "true",
      TIKPAL_UPNP_LABEL_COMMAND: "printf 'Tikpal Speaker'",
      TIKPAL_KIOSK_AUDIO_RELEASE_COMMAND: `${process.execPath} ${fakeKioskAudioReleasePath}`,
      TIKPAL_KIOSK_AUDIO_RELEASE_SETTLE_MS: "1",
      TIKPAL_WEB_MODE_STATE_PATH: fakeWebModeStatePath
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForHealthAt(baseUrl);
    const catalog = await requestFrom(baseUrl, "/api/v1/audio/radios");
    assert(catalog.response.ok, "mpc radio preset catalog should return 200");
    assert(catalog.body.total === 36, "mpc radio catalog should default to curated single-layer stations");
    assert(catalog.body.stations[0]?.id === "radio-500", "mpc radio catalog should expose high-id curated cfg_radio rows first");
    assert(catalog.body.stations[0]?.category === "focus", "mpc radio catalog should expose the Focus category");
    assert(catalog.body.stations[0]?.broadcaster === "Soma FM", "mpc radio catalog should expose broadcaster");
    assert(catalog.body.stations[0]?.logoUrl?.startsWith("/api/v1/media/radio-logo?stationId=radio-500"), "mpc radio catalog should expose radio logo URL");
    const expectedRadioCategoryOrder = "focus,calm,sleep,jazz,classical,news,hifi,blues,rock,world,electronic,podcast,random";
    assert(
      catalog.body.categories.map((category) => category.id).join(",") === expectedRadioCategoryOrder,
      "mpc radio catalog should expose the single-layer category order"
    );

    const allCatalog = await requestFrom(baseUrl, "/api/v1/audio/radios?scope=all&limit=250");
    assert(allCatalog.response.ok, "mpc radio all-scope catalog should return 200");
    assert(allCatalog.body.total === 37, "mpc radio all-scope catalog should include moOde and curated rows");
    assert(allCatalog.body.stations[0]?.catalogSource === "tikpal", "mpc radio all-scope catalog should keep curated rows first");
    assert(allCatalog.body.stations.some((station) => station.id === "radio-1" && station.catalogSource === "moode"), "mpc radio all-scope catalog should retain moOde rows");

    const calmCatalog = await requestFrom(baseUrl, "/api/v1/audio/radios?category=calm");
    assert(calmCatalog.response.ok, "mpc radio category catalog should return 200");
    assert(calmCatalog.body.total === 3 && calmCatalog.body.stations.every((station) => station.category === "calm"), "mpc radio category filter should isolate Calm stations");
    for (const categoryId of expectedRadioCategoryOrder.split(",").filter((categoryId) => categoryId !== "random")) {
      const categoryCatalog = await requestFrom(baseUrl, `/api/v1/audio/radios?category=${categoryId}`);
      assert(categoryCatalog.response.ok, `mpc radio ${categoryId} catalog should return 200`);
      assert(
        categoryCatalog.body.total === 3 && categoryCatalog.body.stations.every((station) => station.category === categoryId),
        `mpc radio category filter should isolate ${categoryId} stations`
      );
    }
    const randomCatalog = await requestFrom(baseUrl, "/api/v1/audio/radios?category=random");
    assert(randomCatalog.response.ok, "mpc radio random catalog should return 200");
    assert(randomCatalog.body.total === 3 && randomCatalog.body.stations.length === 3, "mpc radio random catalog should return three stations");
    assert(
      randomCatalog.body.stations.every((station) => station.catalogSource === "tikpal" && station.category && station.category !== "random"),
      "mpc radio random catalog should keep real station categories"
    );

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
      activeCalmCatalog.body.stations.some((station) => station.id === "radio-511" && station.active === true),
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
    assert(nextRadio.body.audio.currentSource.secondaryStatus === "Calm - Soma FM Synphaera active", "mpc radio next should stay inside the current Radio category");
    assert(nextRadio.body.audio.currentSource.radioStationId === "radio-512", "mpc radio next should expose the advanced station id on currentSource");
    assert(nextRadio.body.audio.rememberedSource?.radioStationId === "radio-512", "mpc radio next should remember the advanced station");
    assert(nextRadio.body.playback.albumArtUrl?.startsWith("/api/v1/media/radio-logo?stationId=radio-512"), "mpc radio next should refresh station logo artwork");
    assert(JSON.parse(await readFile(fakeMpcStatePath, "utf8")).currentFile === "http://radio.example/calm-synphaera", "mpc radio next should replace the MPD stream URI");

    const previousRadio = await requestFrom(baseUrl, "/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "previous" })
    });
    assert(previousRadio.response.ok, "mpc radio previous should return 200");
    assert(previousRadio.body.audio.currentSource.secondaryStatus === "Calm - Soma FM Fluid active", "mpc radio previous should return to the previous station inside the category");
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
      fastRefresh.body.audio.currentSource.secondaryStatus === "Calm - Soma FM Fluid active",
      "mpc radio fast refresh should keep the selected station label"
    );
    assert(
      fastRefresh.body.audio.sources.some((source) => source.id === "radio" && source.availability === "available" && source.controllability === "switchable"),
      "mpc radio fast refresh should preserve preset-backed Radio availability"
    );

    const dlnaReady = await requestFrom(baseUrl, "/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "upnp" })
    });
    assert(dlnaReady.response.ok, "mpc dlna ready switch should return 200");
    assert(dlnaReady.body.audio.currentSource.id === "upnp", "mpc dlna switch should arm DLNA when MPD is released");
    assert(dlnaReady.body.playback.source === "upnp", "mpc dlna switch should expose DLNA while waiting for a sender");

    const stateAfterDlnaReady = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
    await writeFile(fakeMpcStatePath, JSON.stringify({
      ...stateAfterDlnaReady,
      currentFile: radioUri,
      failedStreamUri: null,
      playbackState: "playing"
    }));
    const radioWhileDlnaReady = await requestFrom(baseUrl, "/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "pause" })
    });
    assert(radioWhileDlnaReady.response.ok, "mpc radio refresh while DLNA ready should return 200");
    assert(
      radioWhileDlnaReady.body.audio.currentSource.id === "radio",
      `mpc known Radio playback should remain current while DLNA is only ready: ${JSON.stringify({
        currentSource: radioWhileDlnaReady.body.audio.currentSource,
        playback: radioWhileDlnaReady.body.playback,
        sources: radioWhileDlnaReady.body.audio.sources
      })}`
    );
    assert(
      radioWhileDlnaReady.body.playback.source === "radio",
      `mpc playback source should remain Radio while DLNA is only ready: ${JSON.stringify(radioWhileDlnaReady.body.playback)}`
    );
    assert(radioWhileDlnaReady.body.audio.currentSource.radioStationId === "radio-511", "mpc Radio identity should survive a lingering DLNA ready state");
    assert(
      radioWhileDlnaReady.body.audio.sources.some((source) => source.id === "upnp" && source.armed === true && source.active === false),
      "mpc DLNA ready should remain a non-active armed source while known Radio playback is active"
    );

    const stateBeforeUnknownRadio = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
    await writeFile(fakeMpcStatePath, JSON.stringify({
      ...stateBeforeUnknownRadio,
      currentFile: "http://radio.example/user-added-station",
      failedStreamUri: null,
      playbackState: "playing"
    }));
    const unknownRadioWhileDlnaReady = await requestFrom(baseUrl, "/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "pause" })
    });
    assert(unknownRadioWhileDlnaReady.response.ok, "mpc unknown radio refresh while DLNA ready should return 200");
    assert(
      unknownRadioWhileDlnaReady.body.audio.currentSource.id === "radio",
      `mpc unknown Radio stream should remain current while DLNA is only ready: ${JSON.stringify({
        currentSource: unknownRadioWhileDlnaReady.body.audio.currentSource,
        playback: unknownRadioWhileDlnaReady.body.playback,
        sources: unknownRadioWhileDlnaReady.body.audio.sources
      })}`
    );
    assert(
      unknownRadioWhileDlnaReady.body.playback.source === "radio",
      `mpc unknown Radio playback source should not be replaced by DLNA Ready: ${JSON.stringify(unknownRadioWhileDlnaReady.body.playback)}`
    );
    assert(
      unknownRadioWhileDlnaReady.body.audio.sources.some((source) => source.id === "upnp" && source.armed === true && source.active === false),
      "mpc DLNA ready should remain non-active while an unknown Radio stream is active"
    );

    const stateBeforeFailedStream = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
    await writeFile(fakeMpcStatePath, JSON.stringify({
      ...stateBeforeFailedStream,
      currentFile: "",
      failedStreamUri: radioUri,
      playbackState: "stopped",
      failAlwaysAddForUri: "http://radio.example/calm-synphaera"
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
      failedStreamRefresh.body.audio.currentSource.secondaryStatus === "Calm - Soma FM Fluid active",
      "mpc failed radio stream should keep the failed station label"
    );
    const failedStreamCatalog = await requestFrom(baseUrl, "/api/v1/audio/radios?category=calm");
    assert(
      failedStreamCatalog.body.stations.some((station) => station.id === "radio-511" && station.active === true),
      "mpc failed radio stream should keep the selected station active in the catalog"
    );
    const nextAfterFailedStream = await requestFrom(baseUrl, "/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "next" })
    });
    assert(nextAfterFailedStream.response.ok, "mpc radio next should recover from a failed stream");
    assert(nextAfterFailedStream.body.playback.state === "playing", "mpc radio next recovery should start playback");
    assert(nextAfterFailedStream.body.audio.currentSource.radioStationId === "radio-510", "mpc radio next recovery should expose the recovered station id on currentSource");
    assert(
      nextAfterFailedStream.body.audio.currentSource.secondaryStatus === "Calm - Positively Meditation active",
      "mpc radio next recovery should skip a failed candidate station"
    );
    const stateAfterFailedStreamNext = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
    assert(stateAfterFailedStreamNext.currentFile === "http://radio.example/calm-meditation", "mpc radio next recovery should replace the failed MPD stream URI");
    assert(
      stateAfterFailedStreamNext.addFailures === Number(stateBeforeFailedStream.addFailures ?? 0) + 1,
      "mpc radio next recovery should skip each failed candidate after one fast failed start"
    );

    await writeFile(fakeMpcStatePath, JSON.stringify({
      ...stateAfterFailedStreamNext,
      currentFile: "Codex/Smoke.mp3",
      failedStreamUri: null,
      failAlwaysAddForUri: null,
      failDecodeOnAddForUri: "http://radio.example/focus-dead",
      playbackState: "playing"
    }));
    const manualDeadStationFallback = await requestFrom(baseUrl, "/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "radio", radioStationId: "radio-502" })
    });
    assert(manualDeadStationFallback.response.ok, "mpc radio source switch should recover from a dead selected station");
    assert(
      manualDeadStationFallback.body.audio.currentSource.radioStationId === "radio-500",
      "mpc radio source switch fallback should expose the recovered station id on currentSource"
    );
    assert(
      manualDeadStationFallback.body.audio.currentSource.secondaryStatus === "Focus - Soma FM Cliqhop active",
      "mpc radio source switch should advance to the next station when the selected station cannot connect"
    );
    assert(
      manualDeadStationFallback.body.audio.rememberedSource?.radioStationId === "radio-500",
      "mpc radio source switch fallback should remember the recovered station instead of the dead station"
    );
    assert(
      manualDeadStationFallback.body.playback.albumArtUrl?.startsWith("/api/v1/media/radio-logo?stationId=radio-500"),
      "mpc radio source switch fallback should refresh station logo artwork immediately"
    );
    assert(JSON.parse(await readFile(fakeMpcStatePath, "utf8")).currentFile === "http://radio.example/focus-cliqhop", "mpc radio source switch fallback should replace the dead selected station URI");

    const stateBeforeDelayedStreamFailure = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
    await writeFile(fakeMpcStatePath, JSON.stringify({
      ...stateBeforeDelayedStreamFailure,
      currentFile: "Codex/Smoke.mp3",
      failedStreamUri: null,
      failDecodeAfterAddForUri: "http://radio.example/focus-dead",
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
      delayedDeadStation.body.audio.currentSource.secondaryStatus === "Focus - Dead Link active",
      "mpc radio delayed dead stream should initially keep the selected station label"
    );
    let autoSkippedDeadStation = null;
    let autoSkippedFakeState = null;
    let rememberedAfterAutoSkip = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await wait(200);
      autoSkippedDeadStation = await requestFrom(baseUrl, "/api/v1/system/state");
      autoSkippedFakeState = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
      rememberedAfterAutoSkip = JSON.parse(await readFile(fakeAudioSourceMemoryStatePath, "utf8"));
      if (
        autoSkippedDeadStation.body.audio.currentSource.radioStationId === "radio-500"
        && autoSkippedFakeState.currentFile === "http://radio.example/focus-cliqhop"
        && rememberedAfterAutoSkip.radioStationId === "radio-500"
      ) {
        break;
      }
    }
    assert(
      autoSkippedDeadStation.body.audio.currentSource.secondaryStatus === "Focus - Soma FM Cliqhop active",
      `mpc radio late stream failure should auto-advance to the next station: ${JSON.stringify({
        currentSource: autoSkippedDeadStation.body.audio.currentSource,
        fakeCurrentFile: autoSkippedFakeState.currentFile,
        fakeFailedStreamUri: autoSkippedFakeState.failedStreamUri,
        fakeObservations: autoSkippedFakeState.observations?.slice(-8)
      })}`
    );
    assert(
      autoSkippedDeadStation.body.audio.currentSource.radioStationId === "radio-500",
      "mpc radio late stream failure should expose the auto-advanced station id on currentSource"
    );
    assert(
      autoSkippedDeadStation.body.playback.albumArtUrl?.startsWith("/api/v1/media/radio-logo?stationId=radio-500"),
      "mpc radio late stream failure should refresh station logo artwork with the auto-advanced station"
    );
    assert(autoSkippedFakeState.currentFile === "http://radio.example/focus-cliqhop", "mpc radio late stream failure should replace the failed stream URI");
    assert(
      rememberedAfterAutoSkip.target === "radio" && rememberedAfterAutoSkip.radioStationId === "radio-500",
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
  const fakeMpcStatePath = path.join(workspace, "mpc-state.json");
  const fakeVolumePath = path.join(workspace, "volume-fake.mjs");
  const fakeVolumeStatePath = path.join(workspace, "volume-state.txt");
  const fakeAirplayMetadataPath = path.join(workspace, "airplay-metadata.json");
  const fakeAirplayMetadataCommandPath = path.join(workspace, "airplay-metadata.mjs");
  const fakeAirplayTransportLogPath = path.join(workspace, "airplay-transport.log");
  const fakeAirplayTransportCommandPath = path.join(workspace, "airplay-transport.mjs");
  const fakeBluetoothMetadataPath = path.join(workspace, "bluetooth-metadata.txt");
  const fakeBluetoothMetadataCommandPath = path.join(workspace, "bluetooth-metadata.mjs");
  const fakeUpnpMetadataPath = path.join(workspace, "upnp-metadata.txt");
  const fakeUpnpMetadataCommandPath = path.join(workspace, "upnp-metadata.mjs");
  const fakeBluetoothTransportLogPath = path.join(workspace, "bluetooth-transport.log");
  const fakeBluetoothTransportCommandPath = path.join(workspace, "bluetooth-transport.mjs");
  const fakeExternalCommandLogPath = path.join(workspace, "external-command.log");
  const fakeExternalCommandPath = path.join(workspace, "external-command.mjs");
  const fakeExternalStatePath = path.join(workspace, "external-state.json");
  const airplayArtworkRoot = path.join(workspace, "airplay-covers");
  const firstAirplayArtworkPath = path.join(airplayArtworkRoot, "this-city.png");
  const secondAirplayArtworkPath = path.join(airplayArtworkRoot, "instant-crush.png");
  const pngPixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/azU1wAAAABJRU5ErkJggg==", "base64");
  const writeAirplayMetadata = async (metadata) => {
    await writeFile(fakeAirplayMetadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  };
  const waitForExternalCommand = async (needle) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const log = await readFile(fakeExternalCommandLogPath, "utf8").catch(() => "");
      if (log.includes(`${needle}\n`)) return log;
      await wait(50);
    }
    const log = await readFile(fakeExternalCommandLogPath, "utf8").catch(() => "");
    throw new Error(`Timed out waiting for ${needle} in external command log: ${JSON.stringify(log)}`);
  };

  await writeFile(fakeMpcStatePath, `${JSON.stringify({
    title: "",
    artist: "",
    album: "",
    currentFile: "",
    duration: "",
    elapsed: "0:00",
    playbackState: "stopped",
    stopFails: false
  }, null, 2)}\n`);
  await writeFile(fakeMpcPath, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const statePath = ${JSON.stringify(fakeMpcStatePath)};
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
function readState() {
  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return {};
  }
}

function writeState(state) {
  writeFileSync(statePath, JSON.stringify(state, null, 2) + "\\n");
}

switch (command) {
  case "status":
    {
      const state = readState();
      if (state.playbackState === "playing" || state.playbackState === "paused") {
        const progress = state.duration ? \`\${state.elapsed || "0:00"}/\${state.duration}\` : "";
        process.stdout.write(\`[\${state.playbackState}] #1/1   \${progress} (42%)\\n\`);
      }
      process.stdout.write("volume:30%   repeat: off   random: off   single: off   consume: off\\n");
    }
    break;
  case "stats":
    process.stdout.write("Artists: 0\\nAlbums: 0\\nSongs: 0\\nDB Updated: fake\\n");
    break;
  case "current":
    {
      const state = readState();
      if (state.currentFile || state.title) {
        process.stdout.write([
          state.title || "",
          state.artist || "",
          state.album || "",
          state.currentFile || "",
          state.duration || ""
        ].join("\\t") + "\\n");
      }
    }
    break;
  case "playlist":
    {
      const state = readState();
      if (state.currentFile || state.title) {
        process.stdout.write(\`0\\t\${state.title || ""}\\t\${state.artist || ""}\\t\${state.album || ""}\\t\${state.duration || ""}\\t\${state.currentFile || ""}\\n\`);
      }
    }
    break;
  case "stop":
    {
      const state = readState();
      if (state.stopFails) {
        process.stderr.write("mpc stop failed\\n");
        process.exit(1);
      }
      writeState({
        ...state,
        playbackState: "stopped",
        currentFile: "",
        title: "",
        artist: "",
        album: "",
        duration: "",
        elapsed: "0:00"
      });
    }
    break;
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
  await writeFile(fakeExternalCommandLogPath, "");
  await writeFile(fakeExternalStatePath, `${JSON.stringify({
    bluetoothActive: false,
    bluetoothTransportAvailable: true,
    spotifyActive: false,
    upnpActive: false
  }, null, 2)}\n`);
  await writeFile(fakeExternalCommandPath, `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";

const action = process.argv[2] ?? "";
if (action.endsWith("-active")) {
  const state = JSON.parse(readFileSync(process.env.TIKPAL_FAKE_EXTERNAL_STATE_PATH, "utf8"));
  const key = action.replace("-active", "Active").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  process.exit(state[key] ? 0 : 1);
}

appendFileSync(${JSON.stringify(fakeExternalCommandLogPath)}, action + "\\n");
`);
  await chmod(fakeExternalCommandPath, 0o755);
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
  await writeFile(fakeBluetoothMetadataPath, "title=Pocket Signal\nartist=Tikpal Phone\nalbum=AVRCP Smoke\nstatus=playing\npositionMs=12000\ndurationMs=180000\n");
	  await writeFile(fakeBluetoothMetadataCommandPath, `#!/usr/bin/env node
		import { readFileSync } from "node:fs";

		process.stdout.write(readFileSync(process.env.TIKPAL_FAKE_BLUETOOTH_METADATA_PATH, "utf8"));
		`);
  await chmod(fakeBluetoothMetadataCommandPath, 0o755);
  await writeFile(fakeUpnpMetadataPath, "");
  await writeFile(fakeUpnpMetadataCommandPath, `#!/usr/bin/env node
import { readFileSync } from "node:fs";

process.stdout.write(readFileSync(process.env.TIKPAL_FAKE_UPNP_METADATA_PATH, "utf8"));
`);
  await chmod(fakeUpnpMetadataCommandPath, 0o755);
  await writeFile(fakeBluetoothTransportLogPath, "");
  await writeFile(fakeBluetoothTransportCommandPath, `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";

const action = process.argv[2] ?? "";
const state = JSON.parse(readFileSync(process.env.TIKPAL_FAKE_EXTERNAL_STATE_PATH, "utf8"));

if (action === "available") {
  process.exit(state.bluetoothTransportAvailable ? 0 : 1);
}

if (!state.bluetoothTransportAvailable) {
  process.stderr.write("Bluetooth AVRCP player is unavailable from this sender\\n");
  process.exit(3);
}

appendFileSync(${JSON.stringify(fakeBluetoothTransportLogPath)}, action + "\\n");
`);
  await chmod(fakeBluetoothTransportCommandPath, 0o755);
  await writeAirplayMetadata({
    title: "This City",
    artist: "Sam Fischer",
    album: "Not a Hobby",
    status: "playing",
    positionMs: 45000,
    durationMs: 60000,
      artworkPath: firstAirplayArtworkPath,
      artworkMtimeMs: 111000,
      positionTrusted: true,
      positionConfidence: "trusted",
      metadataSource: "mpris"
    });

  const server = spawn(process.execPath, ["server/index.mjs"], {
    env: mpcFocusedSmokeEnv({
      TIKPAL_API_HOST: HOST,
      TIKPAL_API_PORT: String(port),
      TIKPAL_PLAYER_BACKEND: "mpc",
      TIKPAL_MPC_BIN: fakeMpcPath,
      TIKPAL_MPD_STARTUP_VOLUME: "-1",
      TIKPAL_MPD_HOST: "127.0.0.1",
      TIKPAL_MPD_PORT: "6600",
      TIKPAL_ROOM_EXPERIENCE_STATE_PATH: roomExperienceStatePath,
      TIKPAL_STATE_SNAPSHOT_REFRESH_MS: "60000",
      TIKPAL_OUTPUT_VOLUME_GET_COMMAND: `${process.execPath} ${fakeVolumePath} get`,
      TIKPAL_OUTPUT_VOLUME_SET_COMMAND: `${process.execPath} ${fakeVolumePath} set %VALUE%`,
      TIKPAL_SPOTIFY_ACTIVATE_COMMAND: `${process.execPath} ${fakeExternalCommandPath} spotify-enable`,
      TIKPAL_SPOTIFY_READY_COMMAND: "true",
      TIKPAL_SPOTIFY_ACTIVE_COMMAND: `${process.execPath} ${fakeExternalCommandPath} spotify-active`,
      TIKPAL_SPOTIFY_DISABLE_COMMAND: `${process.execPath} ${fakeExternalCommandPath} spotify-disable`,
      TIKPAL_SPOTIFY_LABEL_COMMAND: "printf 'Tikpal Speaker'",
      TIKPAL_BLUETOOTH_ENABLE_COMMAND: `${process.execPath} ${fakeExternalCommandPath} bluetooth-enable`,
      TIKPAL_BLUETOOTH_READY_COMMAND: "true",
      TIKPAL_BLUETOOTH_ACTIVE_COMMAND: `${process.execPath} ${fakeExternalCommandPath} bluetooth-active`,
      TIKPAL_BLUETOOTH_DISABLE_COMMAND: `${process.execPath} ${fakeExternalCommandPath} bluetooth-disable`,
      TIKPAL_BLUETOOTH_LABEL_COMMAND: "printf 'Tikpal Speaker'",
      TIKPAL_BLUETOOTH_METADATA_COMMAND: `${process.execPath} ${fakeBluetoothMetadataCommandPath}`,
      TIKPAL_BLUETOOTH_TRANSPORT_AVAILABLE_COMMAND: `${process.execPath} ${fakeBluetoothTransportCommandPath} available`,
      TIKPAL_BLUETOOTH_PLAY_PAUSE_COMMAND: `${process.execPath} ${fakeBluetoothTransportCommandPath} play-pause`,
      TIKPAL_BLUETOOTH_PLAY_COMMAND: `${process.execPath} ${fakeBluetoothTransportCommandPath} play`,
      TIKPAL_BLUETOOTH_PAUSE_COMMAND: `${process.execPath} ${fakeBluetoothTransportCommandPath} pause`,
      TIKPAL_BLUETOOTH_NEXT_COMMAND: `${process.execPath} ${fakeBluetoothTransportCommandPath} next`,
      TIKPAL_BLUETOOTH_PREVIOUS_COMMAND: `${process.execPath} ${fakeBluetoothTransportCommandPath} previous`,
      TIKPAL_UPNP_ENABLE_COMMAND: `${process.execPath} ${fakeExternalCommandPath} upnp-enable`,
      TIKPAL_UPNP_READY_COMMAND: "true",
      TIKPAL_UPNP_ACTIVE_COMMAND: `${process.execPath} ${fakeExternalCommandPath} upnp-active`,
      TIKPAL_UPNP_DISABLE_COMMAND: `${process.execPath} ${fakeExternalCommandPath} upnp-disable`,
      TIKPAL_UPNP_LABEL_COMMAND: "printf 'Tikpal Speaker'",
      TIKPAL_UPNP_METADATA_COMMAND: `${process.execPath} ${fakeUpnpMetadataCommandPath}`,
      TIKPAL_FAKE_EXTERNAL_STATE_PATH: fakeExternalStatePath,
      TIKPAL_FAKE_BLUETOOTH_METADATA_PATH: fakeBluetoothMetadataPath,
      TIKPAL_FAKE_UPNP_METADATA_PATH: fakeUpnpMetadataPath,
      TIKPAL_AIRPLAY_ENABLE_COMMAND: `${process.execPath} ${fakeExternalCommandPath} airplay-enable`,
      TIKPAL_AIRPLAY_READY_COMMAND: "true",
      TIKPAL_AIRPLAY_ACTIVE_COMMAND: "true",
      TIKPAL_AIRPLAY_DISABLE_COMMAND: `${process.execPath} ${fakeExternalCommandPath} airplay-disable`,
      TIKPAL_AIRPLAY_RECEIVER_ACTIVE_COMMAND: "true",
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
      TIKPAL_LYRICS_PROVIDER_CHAIN: "lrclib,custom,lyricsovh",
      TIKPAL_LYRICS_CUSTOM_URL_TEMPLATE: `${PROVIDER_URL}/custom-lyrics?artist={artist}&title={title}`,
      TIKPAL_LYRICS_CUSTOM_AUTH_HEADER: "Authorization: Bearer smoke",
      TIKPAL_LYRICS_OVH_BASE_URL: PROVIDER_URL,
      TIKPAL_LRCLIB_TIMEOUT_MS: "250",
      TIKPAL_LRCLIB_BASE_URL: PROVIDER_URL,
      TIKPAL_THEAUDIODB_BASE_URL: PROVIDER_URL,
      TIKPAL_ITUNES_SEARCH_BASE_URL: `${PROVIDER_URL}/itunes/search`
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
    assert(recovered.body.playback.timingDiagnostics?.positionTrusted === true, "mpc recovered AirPlay state should mark MPRIS position trusted");
    assert(recovered.body.playback.timingDiagnostics?.positionConfidence === "trusted", "mpc recovered AirPlay state should expose trusted position confidence");
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

    await writeFile(fakeExternalCommandLogPath, "");
    const repeatedAirplaySwitch = await requestFrom(baseUrl, "/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "airplay" })
    });
    assert(repeatedAirplaySwitch.response.ok, "mpc repeated airplay source switch should return 200");
    assert(repeatedAirplaySwitch.body.audio.currentSource.connectionState === "connected", "mpc repeated AirPlay switch should preserve the active session");
    assert(repeatedAirplaySwitch.body.playback.title === "This City", "mpc repeated AirPlay switch should keep current AirPlay metadata");
    const repeatedAirplayLog = await readFile(fakeExternalCommandLogPath, "utf8").catch(() => "");
    assert(!repeatedAirplayLog.includes("airplay-enable\n"), "mpc repeated AirPlay switch should not reopen the receiver");

    await writeFile(fakeExternalCommandLogPath, "");
    const bluetoothSwitch = await requestFrom(baseUrl, "/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "bluetooth" })
    });
    assert(bluetoothSwitch.response.ok, "mpc bluetooth source switch should return 200");
    assert(bluetoothSwitch.body.audio.currentSource.id === "bluetooth", "mpc AirPlay-to-Bluetooth switch should return Bluetooth as current");
    assert(bluetoothSwitch.body.audio.currentSource.armed === true, "mpc AirPlay-to-Bluetooth switch should arm Bluetooth");
    assert(bluetoothSwitch.body.playback.source === "bluetooth", "mpc AirPlay-to-Bluetooth playback source should be Bluetooth");
    const bluetoothSwitchLog = await waitForExternalCommand("upnp-disable");
    assert(bluetoothSwitchLog.includes("bluetooth-enable\n"), "mpc AirPlay-to-Bluetooth switch should enable Bluetooth before cleanup finishes");
    assert(bluetoothSwitchLog.includes("airplay-disable\n"), "mpc AirPlay-to-Bluetooth switch should clean up old AirPlay in the background");

    await writeFile(fakeExternalStatePath, `${JSON.stringify({
      bluetoothActive: true,
      bluetoothTransportAvailable: true,
      spotifyActive: false,
      upnpActive: false
    }, null, 2)}\n`);
    await writeFile(fakeExternalCommandLogPath, "");
    const airplayAfterBluetooth = await requestFrom(baseUrl, "/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "airplay" })
    });
    assert(airplayAfterBluetooth.response.ok, "mpc bluetooth-to-airplay source switch should return 200");
    assert(airplayAfterBluetooth.body.audio.currentSource.id === "airplay", "mpc Bluetooth-to-AirPlay switch should return AirPlay as current");
    assert(airplayAfterBluetooth.body.playback.source === "airplay", "mpc Bluetooth-to-AirPlay playback source should be AirPlay");
    const airplayAfterBluetoothLog = await waitForExternalCommand("upnp-disable");
    assert(airplayAfterBluetoothLog.includes("airplay-enable\n"), "mpc Bluetooth-to-AirPlay switch should enable AirPlay before cleanup finishes");
    assert(airplayAfterBluetoothLog.includes("bluetooth-disable\n"), "mpc Bluetooth-to-AirPlay switch should clean up old Bluetooth in the background");

    await writeFile(fakeExternalStatePath, `${JSON.stringify({
      bluetoothActive: true,
      bluetoothTransportAvailable: true,
      spotifyActive: false,
      upnpActive: false
    }, null, 2)}\n`);
    await writeFile(fakeBluetoothTransportLogPath, "");
    const bluetoothForTransport = await requestFrom(baseUrl, "/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "bluetooth" })
    });
    assert(bluetoothForTransport.response.ok, "mpc bluetooth transport source switch should return 200");
    let bluetoothArtworkState = bluetoothForTransport.body;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (bluetoothArtworkState.playback.albumArtUrl?.startsWith("/api/v1/media/artwork?track=remote-")) break;
      await wait(100);
      bluetoothArtworkState = (await requestFrom(baseUrl, "/api/v1/system/state")).body;
    }
    assert(
      bluetoothArtworkState.playback.albumArtUrl?.startsWith("/api/v1/media/artwork?track=remote-"),
      `mpc bluetooth should reuse cached iTunes artwork when BlueZ has no cover, got ${bluetoothArtworkState.playback.albumArtUrl ?? "null"}`
    );
    const bluetoothArtwork = await requestBinaryFrom(baseUrl, bluetoothArtworkState.playback.albumArtUrl);
    assert(bluetoothArtwork.response.ok, "mpc bluetooth remote artwork endpoint should return 200");
    assert(bluetoothArtwork.body.length > 0, "mpc bluetooth remote artwork endpoint should return image bytes");
    let bluetoothState = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      bluetoothState = await requestFrom(baseUrl, "/api/v1/system/state");
      if (bluetoothState.body.playback?.transportCapabilities?.next === true) break;
      await wait(100);
    }
    assert(bluetoothState.response.ok, "mpc bluetooth transport state should return 200");
    assert(bluetoothState.body.playback.source === "bluetooth", "mpc bluetooth transport state should keep Bluetooth source");
    assert(bluetoothState.body.playback.transportCapabilities?.next === true, "mpc bluetooth state should expose AVRCP capability");
    const bluetoothNext = await requestFrom(baseUrl, "/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "next" })
    });
    assert(bluetoothNext.response.ok, "mpc bluetooth next action should return 200");
    assert(bluetoothNext.body.playback.source === "bluetooth", "mpc bluetooth next should keep Bluetooth as playback source");
    const bluetoothPlayPause = await requestFrom(baseUrl, "/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "play_pause" })
    });
    assert(bluetoothPlayPause.response.ok, "mpc bluetooth play_pause action should return 200");
    const bluetoothTransportLog = await readFile(fakeBluetoothTransportLogPath, "utf8");
    assert(
      bluetoothTransportLog.includes("next\n") && bluetoothTransportLog.includes("play-pause\n"),
      `mpc bluetooth transport should call Bluetooth commands, got ${JSON.stringify(bluetoothTransportLog)}`
    );
    await writeFile(fakeExternalStatePath, `${JSON.stringify({
      bluetoothActive: true,
      bluetoothTransportAvailable: false,
      spotifyActive: false,
      upnpActive: false
    }, null, 2)}\n`);
    const unavailableBluetoothNext = await requestFrom(baseUrl, "/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "next" })
    });
    assert(unavailableBluetoothNext.response.status === 400, "mpc bluetooth next should fail honestly when AVRCP is unavailable");
    assert(
      unavailableBluetoothNext.body.message === "Bluetooth AVRCP control is unavailable from this sender",
      "mpc bluetooth unavailable transport should return a clear reason"
    );

    await writeFile(fakeExternalStatePath, `${JSON.stringify({
      bluetoothActive: false,
      bluetoothTransportAvailable: true,
      spotifyActive: false,
      upnpActive: false
    }, null, 2)}\n`);
    const airplayForTransport = await requestFrom(baseUrl, "/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "airplay" })
    });
    assert(airplayForTransport.response.ok, "mpc airplay source should recover after Bluetooth transport checks");

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

    await writeAirplayMetadata({
      title: "someone else",
      artist: "City Of Stars (From \"La La Land\" Soundtrack) — Ryan Gosling/Emma Stone",
      album: "La La Land (Original Motion Picture Soundtrack)",
      status: "playing",
      positionMs: 19000,
      durationMs: 149000,
      artworkPath: firstAirplayArtworkPath,
      artworkMtimeMs: 111500,
      positionTrusted: false,
      metadataSource: "mpris"
    });
    const lyricTitleRefresh = await requestFrom(baseUrl, "/api/v1/lyrics/refresh", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(lyricTitleRefresh.response.ok, "mpc airplay lyrics-line metadata refresh should return 200");
    const lyricTitleState = await requestFrom(baseUrl, "/api/v1/system/state");
    assert(lyricTitleState.response.ok, "mpc airplay lyrics-line metadata state should return 200");
    assert(
      lyricTitleState.body.playback.title === "City Of Stars (From \"La La Land\" Soundtrack)",
      "AirPlay should recover the track title when MPRIS title is only the current lyric line"
    );
    assert(
      lyricTitleState.body.playback.artist === "Ryan Gosling/Emma Stone",
      "AirPlay should recover the real artist from a compound artist label"
    );
    const cityOfStarsLyrics = await waitForLyricsTrackAt(baseUrl, {
      title: "City Of Stars (From \"La La Land\" Soundtrack)",
      artist: "Ryan Gosling/Emma Stone"
    });
    assert(cityOfStarsLyrics.sourceScope === "airplay_input", "AirPlay lyrics-line metadata should keep airplay scope");
    assert(cityOfStarsLyrics.lines.some((line) => line.text.includes("City of stars")), "AirPlay lyrics-line metadata should expose the recovered track lyrics");

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
      title: "This City",
      artist: "Sam Fischer",
      album: "Not a Hobby",
      status: "playing",
      positionMs: 65000,
      durationMs: 60000,
      artworkPath: firstAirplayArtworkPath,
      artworkMtimeMs: 112000,
      positionTrusted: true,
      positionConfidence: "trusted",
      metadataSource: "mpris"
    });
    const overrunLyricsRefresh = await requestFrom(baseUrl, "/api/v1/lyrics/refresh", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(overrunLyricsRefresh.response.ok, "mpc airplay lyrics refresh with overrun position should return 200");
    const overrunState = await requestFrom(baseUrl, "/api/v1/system/state");
    assert(overrunState.response.ok, "cached mpc airplay overrun state should return 200");
    assert(overrunState.body.playback.title === "This City", "AirPlay metadata position overrun should not clear the current track");
    assert(overrunState.body.playback.state === "playing", "AirPlay metadata position overrun should keep playing state");
    assert(overrunState.body.playback.elapsedSeconds === 60, "AirPlay metadata position overrun should clamp elapsed time to duration");
    assert(overrunState.body.lyrics.title === "This City", "AirPlay metadata position overrun should keep lyrics tied to the current track");

    await writeAirplayMetadata({
      title: "This City",
      artist: "Sam Fischer",
      album: "Not a Hobby",
      status: "playing",
      positionMs: 843000,
      durationMs: 60000,
      artworkPath: firstAirplayArtworkPath,
      artworkMtimeMs: 113000,
      positionTrusted: true,
      positionConfidence: "trusted",
      metadataSource: "mpris"
    });
    const liveMprisOverrunRefresh = await requestFrom(baseUrl, "/api/v1/lyrics/refresh", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(liveMprisOverrunRefresh.response.ok, "mpc airplay lyrics refresh with live MPRIS overrun should return 200");
    const liveMprisOverrunState = await requestFrom(baseUrl, "/api/v1/system/state");
    assert(liveMprisOverrunState.response.ok, "cached mpc airplay live MPRIS overrun state should return 200");
    assert(liveMprisOverrunState.body.playback.title === "This City", "live MPRIS overrun should not fall back to AirPlay Ready");
    assert(liveMprisOverrunState.body.playback.state === "playing", "live MPRIS overrun should keep AirPlay playing");
    assert(liveMprisOverrunState.body.playback.elapsedSeconds === null, "live MPRIS overrun should drop unreliable elapsed time instead of wrapping it");
    assert(liveMprisOverrunState.body.playback.timingDiagnostics?.positionTrusted === false, "live MPRIS overrun should mark position untrusted");
    assert(liveMprisOverrunState.body.lyrics.synced === false, "live MPRIS overrun should keep lyrics static instead of highlighting the wrong line");

    await writeAirplayMetadata({
      title: "This City",
      artist: "Sam Fischer",
      album: "Not a Hobby",
      status: "playing",
      positionMs: 32000,
      durationMs: 60000,
      artworkPath: firstAirplayArtworkPath,
      artworkMtimeMs: 114000,
      positionTrusted: false,
      metadataSource: "mpris"
    });
    const untrustedClockRefresh = await requestFrom(baseUrl, "/api/v1/lyrics/refresh", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(untrustedClockRefresh.response.ok, "mpc airplay lyrics refresh with untrusted position should return 200");
    const untrustedClockState = await requestFrom(baseUrl, "/api/v1/system/state");
    assert(untrustedClockState.response.ok, "cached mpc airplay untrusted clock state should return 200");
    assert(untrustedClockState.body.playback.elapsedSeconds === 32, "untrusted AirPlay clock may still expose progress for display");
    assert(untrustedClockState.body.playback.timingDiagnostics?.positionTrusted === false, "untrusted AirPlay clock should be marked in diagnostics");
    assert(untrustedClockState.body.lyrics.title === "This City", "untrusted AirPlay clock should keep the correct lyrics identity");
    assert(untrustedClockState.body.lyrics.synced === false, "untrusted AirPlay clock should keep lyrics static instead of synced highlighting");

    await writeAirplayMetadata({
      title: "This City",
      artist: "Sam Fischer",
      album: "Not a Hobby",
      status: "playing",
      positionMs: 33000,
      durationMs: 60000,
      artworkPath: firstAirplayArtworkPath,
      artworkMtimeMs: 115000,
      positionTrusted: false,
      positionConfidence: "estimated",
      metadataSource: "mpris"
    });
    const estimatedClockRefresh = await requestFrom(baseUrl, "/api/v1/lyrics/refresh", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(estimatedClockRefresh.response.ok, "mpc airplay lyrics refresh with estimated position should return 200");
    const estimatedClockState = await requestFrom(baseUrl, "/api/v1/system/state");
    assert(estimatedClockState.response.ok, "cached mpc airplay estimated clock state should return 200");
    assert(estimatedClockState.body.playback.timingDiagnostics?.positionConfidence === "estimated", "estimated AirPlay clock should be marked in diagnostics");
    assert(estimatedClockState.body.lyrics.title === "This City", "estimated AirPlay clock should keep the correct lyrics identity");
    assert(estimatedClockState.body.lyrics.synced === true, "estimated AirPlay clock should drive synced lyrics");
    assert(
      estimatedClockState.body.lyrics.timingStrategy !== "plain_static"
        && estimatedClockState.body.lyrics.timingStrategy !== "static_duration_mismatch",
      "estimated AirPlay clock should not degrade ready synced lyrics to a static wall"
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
      positionTrusted: true,
      positionConfidence: "trusted",
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
      durationDriftLyrics.trackKey === smokeTrackKey({
        source: "airplay",
        title: "Duration Drift",
        artist: "Clock Source",
        album: "Unreliable Metadata",
        durationSeconds: null
      }),
      "AirPlay lyrics should ignore unreliable short metadata duration in the track key"
    );
    assert(
      durationDriftLyrics.lines.some((line) => line.text.includes("real lyric clock")),
      "AirPlay lyrics should not disappear when trusted title and artist have a mismatched duration"
    );

    await writeAirplayMetadata({
      title: "Slow Empty",
      artist: "Timeout Artist",
      album: "Provider Edge",
      status: "playing",
      positionMs: 8000,
      durationMs: 180000,
      artworkPath: secondAirplayArtworkPath,
      artworkMtimeMs: 334000,
      metadataSource: "mpris"
    });
    const slowEmptyLyricsRefresh = await requestFrom(baseUrl, "/api/v1/lyrics/refresh", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(slowEmptyLyricsRefresh.response.ok, "mpc airplay lyrics refresh with one slow empty branch should return 200");
    const slowEmptyLyrics = await waitForLyricsTrackAt(baseUrl, {
      title: "Slow Empty",
      artist: "Timeout Artist",
      statuses: ["not_found"]
    });
    assert(slowEmptyLyrics.message.includes("lrclib") && slowEmptyLyrics.message.includes("lyricsovh"), "AirPlay slow empty lookup should report the provider chain");

    await writeAirplayMetadata({
      title: "Fallback Song",
      artist: "Fallback Artist",
      album: "Fallback Album",
      status: "playing",
      positionMs: 12000,
      durationMs: 180000,
      artworkPath: secondAirplayArtworkPath,
      artworkMtimeMs: 335000,
      metadataSource: "mpris"
    });
    const fallbackLyricsRefresh = await requestFrom(baseUrl, "/api/v1/lyrics/refresh", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(fallbackLyricsRefresh.response.ok, "mpc airplay fallback lyrics refresh should return 200");
    const fallbackLyrics = await waitForLyricsTrackAt(baseUrl, {
      title: "Fallback Song",
      artist: "Fallback Artist"
    });
    assert(fallbackLyrics.recognitionProvider === "lyricsovh", "AirPlay fallback lyrics should report lyricsovh provider");
    assert(fallbackLyrics.synced === false && fallbackLyrics.timingStrategy === "plain_static", "AirPlay plain lyrics should stay static without provider timestamps");
    assert(fallbackLyrics.lines.some((line) => line.text.includes("Fallback provider line one")), "AirPlay fallback lyrics should expose lyrics.ovh plain lyrics");
    assert(!fallbackLyrics.lines.some((line) => line.text.includes("Wrong fallback line")), "AirPlay fallback lyrics should still reject wrong-artist LRCLIB results");

    await writeAirplayMetadata({
      title: "Custom Plain",
      artist: "Custom Artist",
      album: "Custom Album",
      status: "playing",
      positionMs: 15000,
      durationMs: 120000,
      artworkPath: secondAirplayArtworkPath,
      artworkMtimeMs: 336000,
      metadataSource: "mpris"
    });
    const customLyricsRefresh = await requestFrom(baseUrl, "/api/v1/lyrics/refresh", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(customLyricsRefresh.response.ok, "mpc airplay custom lyrics refresh should return 200");
    const customLyrics = await waitForLyricsTrackAt(baseUrl, {
      title: "Custom Plain",
      artist: "Custom Artist"
    });
    assert(customLyrics.recognitionProvider === "custom", "AirPlay custom lyrics should report custom provider");
    assert(customLyrics.synced === false && customLyrics.timingStrategy === "plain_static", "custom plain lyrics should stay static without provider timestamps");
    assert(customLyrics.lines.some((line) => line.text.includes("Custom provider line one")), "AirPlay custom lyrics should expose plain custom lyrics");

    await writeAirplayMetadata({
      title: "Walter White",
      artist: "Junior Simba, Manz",
      album: "Walter White",
      status: "playing",
      positionMs: 6000,
      durationMs: 205000,
      artworkPath: secondAirplayArtworkPath,
      artworkMtimeMs: 337000,
      metadataSource: "mpris"
    });
    const walterLyricsRefresh = await requestFrom(baseUrl, "/api/v1/lyrics/refresh", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(walterLyricsRefresh.response.ok, "mpc airplay wrong-title-only lyrics refresh should return 200");
    const walterLyrics = await waitForLyricsTrackAt(baseUrl, {
      title: "Walter White",
      artist: "Junior Simba, Manz",
      statuses: ["not_found"]
    });
    assert(walterLyrics.lines.length === 0, "AirPlay missing fallback lyrics should not expose title-only wrong artist lyrics");
    assert(walterLyrics.message.includes("lrclib") && walterLyrics.message.includes("lyricsovh"), "AirPlay missing fallback lyrics should report the provider chain");

    await writeAirplayMetadata({
      title: "Stale AirPlay Metadata",
      artist: "Old Sender",
      album: "Expired Snapshot",
      status: "playing",
      positionMs: 330000,
      durationMs: 29954,
      artworkPath: secondAirplayArtworkPath,
      artworkMtimeMs: 444000,
      metadataSource: "json"
    });
    const staleAirplayLyricsRefresh = await requestFrom(baseUrl, "/api/v1/lyrics/refresh", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(staleAirplayLyricsRefresh.response.ok, "stale AirPlay lyrics refresh should return 200");
    assert(staleAirplayLyricsRefresh.body.status === "idle", "stale AirPlay metadata should not start lyrics recognition");
    assert(staleAirplayLyricsRefresh.body.sourceScope === "airplay_input", "stale AirPlay lyrics idle state should keep airplay scope");
    const staleAirplayState = await requestFrom(baseUrl, "/api/v1/system/state");
    assert(staleAirplayState.response.ok, "stale AirPlay metadata state should return 200");
    assert(staleAirplayState.body.playback.source === "airplay", "stale AirPlay metadata should keep AirPlay as source");
    assert(staleAirplayState.body.playback.state === "stopped", "stale AirPlay metadata should not drive playing state");
    assert(staleAirplayState.body.playback.title !== "Stale AirPlay Metadata", "stale AirPlay metadata should not replace now-playing title");

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

    await writeFile(fakeUpnpMetadataPath, [
      "title=中文测试歌",
      "artist=周杰伦",
      "album=中文蓝牙验证",
      "status=playing",
      "positionMs=42000",
      "durationMs=214000",
      `artworkUrl=${PROVIDER_URL}/artwork/pocket-signal/600x600bb.png`,
      "metadataSource=upmpdcli",
      "positionTrusted=true",
      "positionConfidence=trusted"
    ].join("\n") + "\n");
    const dlnaOpen = await requestFrom(baseUrl, "/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "upnp" })
    });
    assert(dlnaOpen.response.ok, "mpc dlna source switch should return 200 before metadata playback");
    assert(dlnaOpen.body.audio.currentSource.id === "upnp", "mpc dlna switch should not be stolen by an old external connected probe");
    assert(dlnaOpen.body.playback.source === "upnp", "mpc dlna switch should expose DLNA while waiting for sender metadata");

    const stateAfterDlnaOpen = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
    await writeFile(fakeMpcStatePath, JSON.stringify({
      ...stateAfterDlnaOpen,
      currentFile: "http://dlna.example/chinese-test.flac",
      title: "",
      artist: "",
      album: "",
      duration: "3:34",
      elapsed: "0:42",
      failedStreamUri: null,
      playbackState: "playing"
    }, null, 2) + "\n");
    let dlnaMetadataState = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      dlnaMetadataState = await requestFrom(baseUrl, "/api/v1/system/state");
      if (
        dlnaMetadataState.response.ok
        && dlnaMetadataState.body.playback.source === "upnp"
        && dlnaMetadataState.body.playback.title === "中文测试歌"
      ) {
        break;
      }
      await wait(100);
    }
    assert(dlnaMetadataState?.response.ok, "mpc dlna metadata state should return 200");
    assert(
      dlnaMetadataState.body.audio.currentSource.id === "upnp",
      `mpc DLNA metadata should promote DLNA as the current source: ${JSON.stringify(dlnaMetadataState.body.audio.currentSource)}`
    );
    assert(
      dlnaMetadataState.body.audio.currentSource.connectionState === "connected",
      "mpc DLNA metadata playback should mark DLNA connected"
    );
    assert(dlnaMetadataState.body.playback.source === "upnp", "mpc DLNA metadata playback should use upnp source");
    assert(dlnaMetadataState.body.playback.title === "中文测试歌", "mpc DLNA metadata playback should expose sender title");
    assert(dlnaMetadataState.body.playback.artist === "周杰伦", "mpc DLNA metadata playback should expose sender artist");
    assert(dlnaMetadataState.body.playback.album === "中文蓝牙验证", "mpc DLNA metadata playback should expose sender album");
    assert(dlnaMetadataState.body.playback.elapsedSeconds === 42, "mpc DLNA metadata playback should expose sender elapsed");
    assert(dlnaMetadataState.body.playback.durationSeconds === 214, "mpc DLNA metadata playback should expose sender duration");
    assert(
      dlnaMetadataState.body.playback.albumArtUrl === `${PROVIDER_URL}/artwork/pocket-signal/600x600bb.png`,
      "mpc DLNA metadata playback should expose sender artwork URL"
    );
    assert(
      dlnaMetadataState.body.playback.timingDiagnostics?.positionConfidence === "trusted",
      "mpc DLNA metadata playback should expose trusted timing diagnostics"
    );

    const dlnaLyricsRefresh = await requestFrom(baseUrl, "/api/v1/lyrics/refresh", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(dlnaLyricsRefresh.response.ok, "mpc dlna metadata lyrics refresh should return 200");
    const dlnaChineseLyrics = await waitForLyricsTrackAt(baseUrl, {
      title: "中文测试歌",
      artist: "周杰伦"
    });
    assert(dlnaChineseLyrics.sourceScope === "upnp_input", "DLNA metadata lyrics should keep upnp scope");
    assert(dlnaChineseLyrics.recognitionMode === "metadata", "DLNA sender metadata should use metadata lyrics lookup");
    assert(dlnaChineseLyrics.recognitionProvider === "lrclib", "DLNA Chinese metadata lyrics should resolve through LRCLIB");
    assert(dlnaChineseLyrics.synced === true, "DLNA metadata lyrics should preserve synced provider timing");
    assert(dlnaChineseLyrics.lines.some((line) => line.text.includes("中文蓝牙同步歌词")), "DLNA lyrics wall should keep displayable CJK text");

    await writeFile(fakeUpnpMetadataPath, [
      "title=中文测试歌",
      "artist=周杰伦",
      "album=中文蓝牙验证",
      "status=playing",
      "durationMs=214000",
      `artworkUrl=${PROVIDER_URL}/artwork/pocket-signal/600x600bb.png`,
      "metadataSource=upmpdcli_journal",
      "metadataOnly=true",
      "streamAvailable=false",
      "positionTrusted=false",
      "positionConfidence=none"
    ].join("\n") + "\n");
    const stateAfterMetadataOnlyDlna = JSON.parse(await readFile(fakeMpcStatePath, "utf8"));
    await writeFile(fakeMpcStatePath, JSON.stringify({
      ...stateAfterMetadataOnlyDlna,
      currentFile: "",
      title: "",
      artist: "",
      album: "",
      duration: "",
      elapsed: "0:00",
      failedStreamUri: null,
      playbackState: "stopped"
    }, null, 2) + "\n");
    const metadataOnlyDlnaState = await requestFrom(baseUrl, "/api/v1/system/state");
    assert(metadataOnlyDlnaState.response.ok, "metadata-only DLNA state should return 200");
    assert(metadataOnlyDlnaState.body.audio.currentSource.id === "upnp", "metadata-only DLNA should keep DLNA current");
    assert(
      metadataOnlyDlnaState.body.audio.currentSource.connectionState === "armed",
      `metadata-only DLNA should stay armed without an MPD stream: ${JSON.stringify(metadataOnlyDlnaState.body.audio.currentSource)}`
    );
    assert(metadataOnlyDlnaState.body.playback.source === "upnp", "metadata-only DLNA should expose upnp playback source");
    assert(metadataOnlyDlnaState.body.playback.state === "stopped", "metadata-only DLNA should not fake playback without an MPD stream");
    assert(metadataOnlyDlnaState.body.playback.title === "中文测试歌", "metadata-only DLNA should expose sender title without MPD current");
    assert(
      metadataOnlyDlnaState.body.playback.albumArtUrl === `${PROVIDER_URL}/artwork/pocket-signal/600x600bb.png`,
      "metadata-only DLNA should expose sender artwork without MPD current"
    );
    const metadataOnlyDlnaLyricsRefresh = await requestFrom(baseUrl, "/api/v1/lyrics/refresh", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(metadataOnlyDlnaLyricsRefresh.response.ok, "metadata-only DLNA lyrics refresh should return 200");
    const metadataOnlyDlnaLyrics = metadataOnlyDlnaLyricsRefresh.body;
    assert(metadataOnlyDlnaLyrics.status === "idle", "metadata-only DLNA should not enter the lyrics wall without connected audio");
    assert(metadataOnlyDlnaLyrics.sourceScope === "upnp_input", "metadata-only DLNA lyrics should keep upnp scope");
    assert(metadataOnlyDlnaLyrics.message === "Waiting for DLNA audio", "metadata-only DLNA lyrics should explain that audio is still waiting");
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
  await runGeneratedArtworkSourceSmoke();
  await runAirplayMetadataHelperClockSmoke();

  const apiAssetsRoot = await mkdtemp(path.join(tmpdir(), "tikpal-api-assets-"));
  const apiStateRoot = await mkdtemp(path.join(tmpdir(), "tikpal-api-state-"));
  const apiUsbParentRoot = await mkdtemp(path.join(tmpdir(), "tikpal-api-usb-"));
  const proxyTestScenarioPath = path.join(apiStateRoot, "proxy-test-scenario.txt");
  const fakeCurlPath = path.join(apiStateRoot, "curl");
  const apiUsbRoot = path.join(apiUsbParentRoot, "Field Recorder");
  const musicLibraryStatePath = path.join(apiStateRoot, "music-library-state.json");
  const roomExperienceStatePath = path.join(apiStateRoot, "room-experience-state.json");
  const audioSourceMemoryStatePath = path.join(apiStateRoot, "audio-source-memory.json");
  const webModeSettingsPath = path.join(apiStateRoot, "web-mode-settings.json");
  const webModeStatePath = path.join(apiStateRoot, "web-mode-state.json");
  const uiPreferencesStatePath = path.join(apiStateRoot, "ui-preferences.json");
  const nasSourcesStatePath = path.join(apiStateRoot, "nas-sources.json");
  const nasCredentialsDir = path.join(apiStateRoot, "nas-credentials");
  const sceneBytes = Buffer.from("000000 ftypisom tikpal rainy window api smoke mp4");
  const sceneSha256 = createHash("sha256").update(sceneBytes).digest("hex");
  const warmSceneBytes = Buffer.from("000000 ftypisom tikpal warm fireplace api smoke mp4");
  const warmSceneSha256 = createHash("sha256").update(warmSceneBytes).digest("hex");
  const midnightLibrarySceneBytes = Buffer.from("000000 ftypisom tikpal midnight library api smoke mp4");
  const midnightLibrarySceneSha256 = createHash("sha256").update(midnightLibrarySceneBytes).digest("hex");
  await mkdir(path.join(apiAssetsRoot, "scenes", "_metadata"), { recursive: true });
  await mkdir(path.join(apiUsbRoot, "Bootleg Set"), { recursive: true });
  await writeFile(path.join(apiUsbRoot, "Bootleg Set", "Stage Test.flac"), "fake flac bytes");
  await writeFile(path.join(apiUsbRoot, "Bootleg Set", "._Stage Test.flac"), "apple resource fork");
  await writeFile(path.join(apiAssetsRoot, "output_2560x720-4k.mp4"), Buffer.from("000000 ftypisom tikpal legacy scene mp4"));
  await writeFile(path.join(apiAssetsRoot, "scenes", "Midnight-Library.mp4"), midnightLibrarySceneBytes);
  await writeFile(path.join(apiAssetsRoot, "scenes", "Rainy-Window.mp4"), sceneBytes);
  await writeFile(path.join(apiAssetsRoot, "scenes", "Warm-Fireplace.mp4"), warmSceneBytes);
  await writeFile(
    path.join(apiAssetsRoot, "scenes", "_metadata", "scene_videos.json"),
    `${JSON.stringify({
      mode: "add",
      videos: [
        {
          id: "midnight-library",
          filename: "Midnight-Library.mp4",
          label: "Midnight Library",
          order: 20,
          roomModes: ["focus"],
          audioGainDb: 0,
          default: false,
          sha256: midnightLibrarySceneSha256
        },
        {
          id: "rainy-window",
          filename: "Rainy-Window.mp4",
          label: "Rainy Window",
          order: 30,
          roomModes: ["calm"],
          audioGainDb: 11.1,
          default: false,
          sha256: sceneSha256
        },
        {
          id: "warm-fireplace",
          filename: "Warm-Fireplace.mp4",
          label: "Warm Fireplace",
          order: 40,
          roomModes: ["calm"],
          audioGainDb: 1.3,
          default: false,
          sha256: warmSceneSha256
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
  await writeFile(proxyTestScenarioPath, "success\n");
  await writeFile(fakeCurlPath, `#!/bin/sh
scenario=$(cat ${JSON.stringify(proxyTestScenarioPath)})
case "$scenario:$*" in
  fail-apple-music:*https://music.apple.com/*) exit 22 ;;
esac
exit 0
`);
  await chmod(fakeCurlPath, 0o755);
  const providerServer = createProviderServer();
  await new Promise((resolve) => providerServer.listen(PROVIDER_PORT, HOST, resolve));

  const server = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      PATH: `${apiStateRoot}${path.delimiter}${process.env.PATH ?? ""}`,
      TIKPAL_WEB_MODE_PROXY_TEST_CURL_BIN: fakeCurlPath,
      TIKPAL_API_HOST: HOST,
      TIKPAL_API_PORT: String(PORT),
      TIKPAL_PORTABLE_API_KEY: PORTABLE_API_KEY,
      TIKPAL_KIOSK_HEARTBEAT_STALE_MS: "1000",
      TIKPAL_PUBLIC_ASSETS_ROOT: apiAssetsRoot,
      TIKPAL_USB_LIBRARY_ROOTS: apiUsbRoot,
      TIKPAL_USB_LIBRARY_MPD_PREFIX: "USB",
      TIKPAL_MUSIC_LIBRARY_STATE_PATH: musicLibraryStatePath,
      TIKPAL_ROOM_EXPERIENCE_STATE_PATH: roomExperienceStatePath,
      TIKPAL_AUDIO_SOURCE_MEMORY_STATE_PATH: audioSourceMemoryStatePath,
      TIKPAL_UI_PREFERENCES_STATE_PATH: uiPreferencesStatePath,
      TIKPAL_WEB_MODE_SETTINGS_PATH: webModeSettingsPath,
      TIKPAL_WEB_MODE_STATE_PATH: webModeStatePath,
      TIKPAL_NAS_SOURCES_STATE_PATH: nasSourcesStatePath,
      TIKPAL_NAS_CREDENTIALS_DIR: nasCredentialsDir,
      TIKPAL_NAS_DISCOVERY_HINTS: "//192.168.10.103:1445/TikpalNAS",
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
      TIKPAL_THEAUDIODB_BASE_URL: PROVIDER_URL,
      TIKPAL_ITUNES_SEARCH_BASE_URL: `${PROVIDER_URL}/itunes/search`
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
    assert(initial.body.preferences.audioOutputProfile === "everyday", "preferences should default Audio Output to Everyday");
    assert(initial.body.preferences.audioOutputCustomSettings?.volumeNormalization === true, "preferences should default Custom volume normalization on");
    assert(initial.body.preferences.audioOutputCustomSettings?.dsdMode === false, "preferences should default Custom DSD mode off");
    assert(initial.body.preferences.mpdBitPerfectMode === "standard", "legacy MPD quality should derive from Everyday");

    const pureAudioProfile = await request("/api/v1/preferences", {
      method: "PATCH",
      body: JSON.stringify({ audioOutputProfile: "pure" })
    });
    assert(pureAudioProfile.response.ok, "preferences should accept Pure Listening profile");
    assert(pureAudioProfile.body.audioOutputProfile === "pure", "preferences should persist Pure Listening profile");
    assert(pureAudioProfile.body.mpdBitPerfectMode === "strict", "Pure Listening should remain compatible with strict bit-perfect mode");

    const legacyEverydayProfile = await request("/api/v1/preferences", {
      method: "PATCH",
      body: JSON.stringify({ mpdBitPerfectMode: "standard" })
    });
    assert(legacyEverydayProfile.response.ok, "legacy MPD quality preference should still be accepted");
    assert(legacyEverydayProfile.body.audioOutputProfile === "everyday", "legacy standard mode should map to Everyday");
    assert(legacyEverydayProfile.body.mpdBitPerfectMode === "standard", "Everyday should derive legacy standard mode");

    const customAudioProfile = await request("/api/v1/preferences", {
      method: "PATCH",
      body: JSON.stringify({ audioOutputProfile: "custom" })
    });
    assert(customAudioProfile.response.ok, "preferences should accept Custom Audio Output profile");
    assert(customAudioProfile.body.audioOutputProfile === "custom", "preferences should persist Custom Audio Output profile");
    assert(customAudioProfile.body.mpdBitPerfectMode === "standard", "Custom Audio Output should remain compatible with standard legacy mode");

    const tunedCustomAudioProfile = await request("/api/v1/preferences", {
      method: "PATCH",
      body: JSON.stringify({
        audioOutputProfile: "custom",
        audioOutputCustomSettings: {
          pureDirect: true,
          volumeNormalization: false,
          smoothTransition: false,
          automaticSampleRate: false,
          dsdMode: true,
          playbackStability: false
        }
      })
    });
    assert(tunedCustomAudioProfile.response.ok, "preferences should accept Custom Audio Output switches");
    assert(tunedCustomAudioProfile.body.audioOutputProfile === "custom", "Custom switch changes should keep the Custom profile active");
    assert(tunedCustomAudioProfile.body.audioOutputCustomSettings.pureDirect === true, "Custom Pure Direct switch should persist");
    assert(tunedCustomAudioProfile.body.audioOutputCustomSettings.volumeNormalization === false, "Custom Volume Normalization switch should persist");
    assert(tunedCustomAudioProfile.body.audioOutputCustomSettings.dsdMode === true, "Custom DSD Mode switch should persist");

    const invalidAudioProfile = await request("/api/v1/preferences", {
      method: "PATCH",
      body: JSON.stringify({ audioOutputProfile: "developer" })
    });
    assert(invalidAudioProfile.response.status === 400, "preferences should reject unsupported Audio Output profiles");

    const everydayAudioProfile = await request("/api/v1/preferences", {
      method: "PATCH",
      body: JSON.stringify({ audioOutputProfile: "everyday" })
    });
    assert(everydayAudioProfile.response.ok, "preferences should switch Audio Output back to Everyday");

    const audioDiagnostics = await request("/api/v1/audio/output-diagnostics");
    assert(audioDiagnostics.response.ok, "Audio Output diagnostics should return 200 for the local kiosk API");
    assert(audioDiagnostics.body.profile === "everyday", "Audio Output diagnostics should report the current profile");
    assert(String(audioDiagnostics.body.text ?? "").includes("profile=everyday"), "Audio Output diagnostics should include profile text");

    const webMode = await request("/api/v1/web-mode/state");
    assert(webMode.response.ok, "web mode state should return 200");
    assert(webMode.body.settings.proxyEnabled === true, "web mode should enable the development HTTP proxy by default");
    assert(webMode.body.settings.proxyUrl === "http://127.0.0.1:7897", "web mode should default to the HTTP development proxy");
    assert(webMode.body.settings.providerTextScale === 1.1, "web mode should default provider text scale to 110%");
    assert(typeof webMode.body.settings.updatedAt === "string", "web mode settings should always expose a revision for the extension");
    assert(webMode.body.providers.some((provider) => provider.id === "spotify"), "web mode should expose Spotify provider");

    const savedWebMode = await request("/api/v1/web-mode/settings", {
      method: "PATCH",
      body: JSON.stringify({ proxyEnabled: true, proxyUrl: "http://127.0.0.1:7897", providerTextScale: 1.2 })
    });
    assert(savedWebMode.response.ok, "web mode settings patch should return 200");
    assert(savedWebMode.body.settings.proxyUrl === "http://127.0.0.1:7897", "web mode settings patch should persist HTTP proxy URL");
    assert(savedWebMode.body.settings.providerTextScale === 1.2, "web mode settings patch should persist provider text scale");

    const savedBareWebModeProxy = await request("/api/v1/web-mode/settings", {
      method: "PATCH",
      body: JSON.stringify({ proxyEnabled: true, proxyUrl: "127.0.0.1:7897" })
    });
    assert(savedBareWebModeProxy.response.ok, "web mode settings should accept a bare host:port proxy URL");
    assert(savedBareWebModeProxy.body.settings.proxyUrl === "http://127.0.0.1:7897", "web mode settings should normalize bare host:port proxy URL to HTTP");

    const invalidWebModeProxy = await request("/api/v1/web-mode/settings", {
      method: "PATCH",
      body: JSON.stringify({ proxyEnabled: true, proxyUrl: "ftp://127.0.0.1:7897" })
    });
    assert(invalidWebModeProxy.response.status === 400, "web mode settings should reject unsupported proxy protocols");

    const webModeSettingsBeforeProxyCheck = await readFile(webModeSettingsPath, "utf8");
    const candidateProxyCheck = await request("/api/v1/web-mode/proxy-test", {
      method: "POST",
      body: JSON.stringify({ proxyUrl: "http://127.0.0.1:7896" })
    });
    assert(candidateProxyCheck.response.ok, "candidate proxy check should return 200");
    assert(candidateProxyCheck.body.ok === true, "candidate proxy check should require every target to pass");
    assert(candidateProxyCheck.body.proxyUrl === "http://127.0.0.1:7896", "candidate proxy check should normalize and return the unsaved URL");
    assert(candidateProxyCheck.body.checks.map((check) => check.id).join(",") === "google,apple_music,spotify" && candidateProxyCheck.body.checks.every((check) => check.ok), "candidate proxy check should report Google, Apple Music, and Spotify success");
    assert(await readFile(webModeSettingsPath, "utf8") === webModeSettingsBeforeProxyCheck, "candidate proxy check should not persist an unsaved URL");

    await writeFile(proxyTestScenarioPath, "fail-apple-music\n");
    const failedCandidateProxyCheck = await request("/api/v1/web-mode/proxy-test", {
      method: "POST",
      body: JSON.stringify({ proxyUrl: "http://127.0.0.1:7895" })
    });
    assert(failedCandidateProxyCheck.response.ok, "failed candidate proxy check should return a result instead of a request error");
    assert(failedCandidateProxyCheck.body.ok === false, "a failed target should reject the candidate proxy");
    assert(failedCandidateProxyCheck.body.checks.find((check) => check.id === "apple_music")?.ok === false, "failed candidate proxy check should identify Apple Music");
    assert(await readFile(webModeSettingsPath, "utf8") === webModeSettingsBeforeProxyCheck, "failed candidate proxy check should not modify settings");

    const invalidCandidateProxyCheck = await request("/api/v1/web-mode/proxy-test", {
      method: "POST",
      body: JSON.stringify({ proxyUrl: "ftp://127.0.0.1:7897" })
    });
    assert(invalidCandidateProxyCheck.response.status === 400, "candidate proxy check should reject unsupported proxy protocols");

    await writeFile(proxyTestScenarioPath, "success\n");
    const savedProxyCheck = await request("/api/v1/web-mode/proxy-test", { method: "POST", body: JSON.stringify({}) });
    assert(savedProxyCheck.response.ok && savedProxyCheck.body.proxyUrl === "http://127.0.0.1:7897" && savedProxyCheck.body.ok === true, "proxy check without a candidate should remain compatible with the saved URL");

    const invalidWebModeTextScale = await request("/api/v1/web-mode/settings", {
      method: "PATCH",
      body: JSON.stringify({ providerTextScale: 1.25 })
    });
    assert(invalidWebModeTextScale.response.status === 400, "web mode settings should reject unsupported provider text scales");

    const openedWebMode = await request("/api/v1/web-mode/actions", {
      method: "POST",
      body: JSON.stringify({ type: "open", provider: "spotify" })
    });
    assert(openedWebMode.response.ok, "web mode open should return 200");
    assert(openedWebMode.body.activeProvider === "spotify", "web mode open should remember active provider");
    const afterWebModeOpen = await request("/api/v1/system/state");
    assert(afterWebModeOpen.body.audio.currentSource.id === "mpd", "web mode should not change audio source truth");
    assert(afterWebModeOpen.body.audio.rememberedSource === null, "web mode should not write remembered source");
    assert(afterWebModeOpen.body.playback.state === "paused", "web mode should pause Tikpal playback before provider audio starts");

    const switchedWebMode = await request("/api/v1/web-mode/actions", {
      method: "POST",
      body: JSON.stringify({ type: "open", provider: "youtube_music" })
    });
    assert(switchedWebMode.response.ok, "web mode provider switch should return 200");
    assert(
      switchedWebMode.body.activeProvider === "spotify" && switchedWebMode.body.openingProvider === "youtube_music",
      "resident provider switch should leave Spotify Active until YouTube Music is physically revealed"
    );
    await waitForWebModeStateAt(
      BASE_URL,
      (state) => state.activeProvider === "youtube_music" && state.openingProvider === null,
      "resident provider switch should commit YouTube Music only after its launcher completes"
    );

    const scaledWebMode = await request("/api/v1/web-mode/actions", {
      method: "POST",
      body: JSON.stringify({ type: "provider_text_scale", providerTextScale: 1 })
    });
    assert(scaledWebMode.response.ok, "web mode text scale action should return 200");
    assert(scaledWebMode.body.settings.providerTextScale === 1, "web mode text scale action should persist the selected scale");
    assert(scaledWebMode.body.activeProvider === "youtube_music", "web mode text scale action should preserve the active provider");

    const invalidTextScaleAction = await request("/api/v1/web-mode/actions", {
      method: "POST",
      body: JSON.stringify({ type: "provider_text_scale", providerTextScale: 1.05 })
    });
    assert(invalidTextScaleAction.response.status === 400, "web mode text scale action should reject internal fallback-only scales");

    const directProxyAction = await request("/api/v1/web-mode/actions", {
      method: "POST",
      body: JSON.stringify({ type: "proxy", enabled: false })
    });
    assert(directProxyAction.response.ok, "shared web mode proxy action should return 200");
    assert(directProxyAction.body.settings.proxyEnabled === false, "shared web mode proxy action should update the proxy setting");
    assert(directProxyAction.body.activeProvider === "youtube_music", "shared web mode proxy action should preserve the active provider");

    const invalidProxyAction = await request("/api/v1/web-mode/actions", {
      method: "POST",
      body: JSON.stringify({ type: "proxy" })
    });
    assert(invalidProxyAction.response.status === 400, "shared web mode proxy action should require a boolean enabled value");

    const mismatchedProxyConfirmation = await request("/api/v1/web-mode/proxy-applied", {
      method: "POST",
      body: JSON.stringify({ settingsUpdatedAt: "2000-01-01T00:00:00.000Z" })
    });
    assert(mismatchedProxyConfirmation.response.status === 400, "proxy confirmation should reject stale settings revisions");

    const appliedProxyConfirmation = await request("/api/v1/web-mode/proxy-applied", {
      method: "POST",
      body: JSON.stringify({ settingsUpdatedAt: directProxyAction.body.settings.updatedAt })
    });
    assert(appliedProxyConfirmation.response.ok, "loopback extension should confirm the current proxy settings revision");
    assert(appliedProxyConfirmation.body.settingsUpdatedAt === directProxyAction.body.settings.updatedAt, "proxy confirmation should return the applied revision");

    for (const enabled of [true, false, undefined]) {
      const keyboardAction = await request("/api/v1/web-mode/actions", {
        method: "POST",
        body: JSON.stringify({ type: "keyboard", ...(enabled === undefined ? {} : { enabled }) })
      });
      assert(keyboardAction.response.ok, `web mode keyboard ${enabled === undefined ? "toggle" : enabled ? "show" : "hide"} should return 200`);
    }
    const invalidKeyboardAction = await request("/api/v1/web-mode/actions", {
      method: "POST",
      body: JSON.stringify({ type: "keyboard", enabled: "yes" })
    });
    assert(invalidKeyboardAction.response.status === 400, "web mode keyboard should reject non-boolean enabled values");
    const invalidKeyboardForceAction = await request("/api/v1/web-mode/actions", {
      method: "POST",
      body: JSON.stringify({ type: "keyboard", enabled: true, force: "yes" })
    });
    assert(invalidKeyboardForceAction.response.status === 400, "web mode keyboard should reject non-boolean force values");

    const closedWebMode = await request("/api/v1/web-mode/actions", {
      method: "POST",
      body: JSON.stringify({ type: "close" })
    });
    assert(closedWebMode.response.ok, "web mode close should return 200");
    assert(closedWebMode.body.activeProvider === null, "web mode close should clear active provider");

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

    const visibleLagHeartbeat = await request("/api/v1/kiosk/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        ...healthyHeartbeatPayload,
        visibility: "visible",
        eventLoop: { lagMs: 6000 }
      })
    });
    assert(visibleLagHeartbeat.body.healthy === false, "visible kiosk event-loop lag should be unhealthy");
    assert(visibleLagHeartbeat.body.reasons.includes("event-loop-lag"), "visible kiosk event-loop lag should remain a restart reason");

    const hiddenLagHeartbeat = await request("/api/v1/kiosk/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        ...healthyHeartbeatPayload,
        visibility: "hidden",
        eventLoop: { lagMs: 6000 }
      })
    });
    assert(hiddenLagHeartbeat.body.healthy === true, "hidden kiosk event-loop lag should not be treated as a broken visible kiosk");
    assert(hiddenLagHeartbeat.body.ignoredReasons.includes("event-loop-lag:hidden-page"), "hidden kiosk event-loop lag should stay visible as ignored diagnostics");
    assert(hiddenLagHeartbeat.body.thresholds.hiddenStaleMs > hiddenLagHeartbeat.body.thresholds.staleMs, "hidden kiosk heartbeats should have a wider stale threshold for Chromium timer throttling");

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

    const visualFallbackHeartbeat = await request("/api/v1/kiosk/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        ...healthyHeartbeatPayload,
        playback: { source: "mpd", state: "paused", title: "Ambient visual only" },
        activeSceneVideo: {
          ...healthyHeartbeatPayload.activeSceneVideo,
          health: "fallback"
        }
      })
    });
    assert(visualFallbackHeartbeat.body.healthy === false, "Ambient visual fallback should be unhealthy even when Scene Sound is off");
    assert(visualFallbackHeartbeat.body.reasons.includes("scene-video-fallback"), "Ambient visual fallback should retain the scene-video reason");

    const visualNotReadyHeartbeat = await request("/api/v1/kiosk/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        ...healthyHeartbeatPayload,
        playback: { source: "mpd", state: "paused", title: "Ambient visual only" },
        activeSceneVideo: {
          ...healthyHeartbeatPayload.activeSceneVideo,
          readyState: 1,
          health: "recovering"
        }
      })
    });
    assert(visualNotReadyHeartbeat.body.healthy === false, "Ambient visual metadata-only video should be unhealthy even when Scene Sound is off");
    assert(visualNotReadyHeartbeat.body.reasons.includes("scene-video-not-ready"), "Ambient visual metadata-only video should expose scene-video-not-ready");

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
      body: JSON.stringify({
        ...healthyHeartbeatPayload,
        visibility: "hidden"
      })
    });
    await wait(1100);
    const hiddenStaleHeartbeat = await request("/api/v1/kiosk/heartbeat");
    assert(hiddenStaleHeartbeat.body.healthy === true, "hidden kiosk heartbeat should tolerate browser timer throttling past the visible stale threshold");
    assert(hiddenStaleHeartbeat.body.ignoredReasons.includes("heartbeat-stale:hidden-page"), "hidden stale heartbeat should stay visible as ignored diagnostics");

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
    assert(sceneContext.body.weather?.temperatureCelsius === 27, "scene context should expose rounded Celsius temperature");
    assert(["morning", "afternoon", "evening", "night"].includes(sceneContext.body.dayPart), "scene context should expose a daypart");

    const openapi = await request("/api/v1/openapi.json");
    assert(openapi.response.ok, "OpenAPI JSON should return 200");
    assert(openapi.response.headers.get("content-type")?.includes("application/json"), "OpenAPI JSON should return JSON");
    assert(openapi.body.openapi === "3.0.3", "OpenAPI JSON should expose OpenAPI 3.0.3");
    assert(openapi.body.paths?.["/remote/actions"]?.post, "OpenAPI JSON should describe remote actions");
    assert(JSON.stringify(openapi.body.components?.schemas?.RemoteActionRequest).includes("explore.proxy_set"), "OpenAPI JSON should describe remote Explore actions");
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
    assert(remoteState.body.explore.activeProvider === null, "remote state should expose inactive Explore state");
    assert(remoteState.body.explore.proxyEnabled === false, "remote state should expose the current Explore proxy status without its URL");
    assert(remoteState.body.explore.proxyUrl === undefined, "remote state should not expose the Explore proxy URL");
    const remoteCatalog = await request("/api/v1/remote/catalog");
    assert(remoteCatalog.response.ok, "remote catalog should return 200");
    assert(remoteCatalog.body.allowedActions.includes("playback.play_pause"), "remote catalog should expose allowed action ids");
    assert(remoteCatalog.body.allowedActions.includes("explore.open") && remoteCatalog.body.allowedActions.includes("explore.close") && remoteCatalog.body.allowedActions.includes("explore.proxy_set"), "remote catalog should expose Explore actions");
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

    const explicitRoomModeVolume = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "volume_set", value: 31 })
    });
    assert(explicitRoomModeVolume.response.ok, "explicit volume_set before room mode should return 200");
    assert(explicitRoomModeVolume.body.system.volume.percent === 31, "explicit volume_set should establish global volume before room mode");

    const focusExperience = await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_mode", mode: "focus" })
    });
    assert(focusExperience.response.ok, "set_mode experience action should return 200");
    assert(focusExperience.body.mode === "focus", "set_mode should switch room mode");
    assert(focusExperience.body.presetId === "focus-library-flow", "set_mode should apply focus preset");
    assert(focusExperience.body.sceneVideoId === "midnight-library", "focus preset should bind Midnight Library");
    assert(focusExperience.body.sceneSoundEnabled === false, "focus mode switch should leave Scene Sound off unless explicitly enabled");
    const persistedExperience = JSON.parse(await readFile(roomExperienceStatePath, "utf8"));
    assert(persistedExperience.mode === "focus", "room experience should persist to the state file");
    const stateAfterFocus = await request("/api/v1/system/state");
    assert(stateAfterFocus.body.audio.currentSource.id === "mpd", "focus room mode should preserve the current music source");
    assert(stateAfterFocus.body.playback.source === "mpd", "focus room mode playback should not switch to Scene Sound");
    assert(stateAfterFocus.body.system.volume.percent === 31, "room mode should preserve explicit global volume");
    assert(stateAfterFocus.body.system.display.brightnessPercent === focusExperience.body.brightnessPercent, "room mode should apply brightness through system actions");

    const calmSceneDefault = await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_mode", mode: "calm" })
    });
    assert(calmSceneDefault.response.ok, "calm mode before scene memory check should return 200");
    assert(calmSceneDefault.body.sceneVideoId === "rainy-window", "calm should start from the preset scene before user scene memory");
    assert(calmSceneDefault.body.sceneSoundEnabled === false, "calm mode switch should leave Scene Sound off unless explicitly enabled");
    const warmSceneMemory = await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_scene", sceneVideoId: "warm-fireplace" })
    });
    assert(warmSceneMemory.response.ok, "set_scene should return 200 for a calm scene");
    assert(warmSceneMemory.body.sceneVideoId === "warm-fireplace", "set_scene should persist the selected scene");
    assert(warmSceneMemory.body.sceneVideoByMode?.calm === "warm-fireplace", "set_scene should remember the selected calm scene");
    const stateAfterWarmScene = await request("/api/v1/system/state");
    assert(stateAfterWarmScene.body.audio.currentSource.id === "mpd", "set_scene should not interrupt music while Scene Sound is off");
    assert(stateAfterWarmScene.body.playback.source === "mpd", "set_scene should not retarget playback while Scene Sound is off");
    const hifiAfterWarmScene = await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_mode", mode: "hifi" })
    });
    assert(hifiAfterWarmScene.response.ok, "hifi mode after warm scene should return 200");
    const calmAfterWarmScene = await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_mode", mode: "calm" })
    });
    assert(calmAfterWarmScene.response.ok, "calm mode after hifi should return 200");
    assert(calmAfterWarmScene.body.sceneVideoId === "warm-fireplace", "calm should restore the remembered warm fireplace scene");
    assert(calmAfterWarmScene.body.sceneSoundEnabled === false, "calm mode after hifi should keep Scene Sound off");
    const legacyCalmState = { ...calmAfterWarmScene.body };
    delete legacyCalmState.sceneVideoByMode;
    await writeFile(roomExperienceStatePath, `${JSON.stringify(legacyCalmState, null, 2)}\n`);
    const legacyCalmRepeat = await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_mode", mode: "calm" })
    });
    assert(legacyCalmRepeat.response.ok, "legacy calm repeat set_mode should return 200");
    assert(legacyCalmRepeat.body.sceneVideoId === "warm-fireplace", "legacy calm state without sceneVideoByMode should preserve the current scene");
    assert(legacyCalmRepeat.body.sceneVideoByMode?.calm === "warm-fireplace", "legacy calm repeat should backfill sceneVideoByMode");
    const focusBeforeSceneSound = await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_mode", mode: "focus" })
    });
    assert(focusBeforeSceneSound.response.ok, "focus mode after scene memory check should return 200");
    assert(focusBeforeSceneSound.body.sceneVideoId === "midnight-library", "focus should keep its own scene after calm scene memory");
    assert(focusBeforeSceneSound.body.sceneSoundEnabled === false, "focus mode should still require manual Scene Sound enable");

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
    assert(Array.isArray(sources.body.sources) && sources.body.sources.length === 11, "audio sources should return Library, Radio, Scene Sound, Audio, Spotify Connect, Bluetooth, AirPlay, Roon Bridge, Lyrion, Tikpal Multi-room, and DLNA");
    assert(sources.body.currentSource.id === "mpd", "audio source payload should be on MPD after Hi-Fi and night checks");
    assert(sources.body.sources.some((source) => source.id === "scene"), "audio sources payload should include scene sound");
    assert(sources.body.sources.some((source) => source.id === "audio"), "audio sources payload should include audio");
    assert(sources.body.sources.some((source) => source.id === "spotify"), "audio sources payload should include spotify connect");
    assert(sources.body.sources.some((source) => source.id === "bluetooth"), "audio sources payload should include bluetooth");
    assert(sources.body.sources.some((source) => source.id === "airplay"), "audio sources payload should include airplay");
    assert(sources.body.sources.some((source) => source.id === "roonbridge"), "audio sources payload should include Roon Bridge status");
    assert(sources.body.sources.some((source) => source.id === "lyrion"), "audio sources payload should include Lyrion status");
    assert(sources.body.sources.some((source) => source.id === "tikpal_multiroom"), "audio sources payload should include Tikpal Multi-room status");
    assert(sources.body.sources.some((source) => source.id === "upnp"), "audio sources payload should include dlna");
    assert(sources.body.sources.some((source) => source.id === "spotify" && source.connectionState === "blocked" && source.availability === "waiting"), "spotify should start closed until selected");
    assert(sources.body.sources.some((source) => source.id === "bluetooth" && source.connectionState === "blocked" && source.availability === "waiting"), "bluetooth should start closed until selected");
    assert(sources.body.sources.some((source) => source.id === "airplay" && source.connectionState === "blocked" && source.availability === "waiting"), "airplay should start closed until selected");
    assert(sources.body.sources.some((source) => source.id === "upnp" && source.connectionState === "blocked" && source.availability === "waiting"), "dlna should start closed until selected");
    assert(sources.body.sources.some((source) => source.id === "bluetooth" && source.advertisedLabel === "Tikpal Speaker"), "bluetooth source should expose advertised device name");
    assert(sources.body.sources.some((source) => source.id === "upnp" && source.advertisedLabel === "Tikpal Speaker"), "dlna source should expose advertised renderer name");

    const multiroom = await request("/api/v1/multiroom");
    assert(multiroom.response.ok, "multi-room state should return 200");
    assert(multiroom.body.ecosystems?.roon?.label, "multi-room payload should include Roon");
    assert(multiroom.body.ecosystems?.lyrion?.label, "multi-room payload should include Lyrion");
    assert(multiroom.body.ecosystems?.tikpal?.label, "multi-room payload should include Tikpal Multi-room");
    assert(multiroom.body.ecosystems?.music_assistant?.comingSoon === true, "Music Assistant should be a coming-soon placeholder");

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
    assert(localLibrary.body.tracks[0]?.codec, "local audio library tracks should expose file audio information");
    assert(localLibrary.body.localStorage?.rootPath, "local audio library should expose local storage root information");
    assert(localLibrary.body.total === 39, "local audio library should keep the 39-track manifest total");
    const usbLibrary = await request("/api/v1/audio/library?storage=usb&limit=10");
    assert(usbLibrary.response.ok, "USB audio library should return 200");
    assert(usbLibrary.body.total === 1, "USB audio library should scan mounted audio files without requiring a Music label");
    assert(usbLibrary.body.storages.find((storage) => storage.id === "usb")?.trackCount === 1, "USB storage track count should match scanned tracks");
    assert(usbLibrary.body.tracks[0]?.storage === "usb", "USB library filter should only return USB tracks");
    assert(usbLibrary.body.tracks[0]?.categoryId === "usb", "USB tracks should expose the usb category id");
    assert(usbLibrary.body.tracks[0]?.subCategory === "Field Recorder", "USB tracks should use the mount name as the display group");
    assert(usbLibrary.body.tracks[0]?.path === "USB/Field Recorder/Bootleg Set/Stage Test.flac", "USB track path should be MPD-visible under USB/<mount name>");
    assert(usbLibrary.body.tracks[0]?.codec === "flac", "USB tracks should expose fallback codec information from the file extension");
    assert(usbLibrary.body.tracks[0]?.fileSizeBytes > 0, "USB tracks should expose file size information");
    assert(!usbLibrary.body.tracks.some((track) => track.path?.includes("._Stage Test")), "USB library should ignore Apple resource-fork files");
    const allLibrary = await request("/api/v1/audio/library?storage=all&limit=500");
    assert(allLibrary.response.ok, "all audio library should return 200");
    assert(allLibrary.body.tracks.some((track) => track.storage === "usb" && track.path === usbLibrary.body.tracks[0].path), "all audio library should include scanned USB tracks for the Player overlay");
    const initialNasSources = await request("/api/v1/nas/sources");
    assert(initialNasSources.response.ok, "NAS sources should return 200");
    assert(initialNasSources.body.configuredCount === 0, "NAS sources should start with no configured shares");
    const nasDiscover = await request("/api/v1/nas/discover", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(nasDiscover.response.ok, "NAS discovery should return 200");
    assert(nasDiscover.body.candidates.some((candidate) => candidate.host === "192.168.10.103" && candidate.share === "TikpalNAS"), "NAS discovery should return candidates without saving them");
    const nasAfterDiscover = await request("/api/v1/nas/sources");
    assert(nasAfterDiscover.body.configuredCount === 0, "NAS discovery should not save candidates");
    const nasGuestSource = {
      name: "TikpalNAS",
      host: "192.168.10.103",
      port: 1445,
      share: "TikpalNAS",
      path: "",
      authMode: "guest",
      mountName: "TikpalNAS"
    };
    const nasGuestTest = await request("/api/v1/nas/sources/_draft/test", {
      method: "POST",
      body: JSON.stringify(nasGuestSource)
    });
    assert(nasGuestTest.response.ok && nasGuestTest.body.ok === true, "draft NAS guest test should return a non-saving ready result in mock mode");
    const nasGuestSave = await request("/api/v1/nas/sources", {
      method: "POST",
      body: JSON.stringify(nasGuestSource)
    });
    assert(nasGuestSave.response.ok && nasGuestSave.body.configuredCount === 1, "saving a NAS source should persist one configured source");
    assert(!JSON.stringify(nasGuestSave.body).includes("password"), "NAS source responses should not expose password fields");
    const savedNas = nasGuestSave.body.sources.find((source) => source.name === "TikpalNAS");
    assert(savedNas?.mpdPath === "NAS/TikpalNAS", "saved NAS source should expose an MPD-visible NAS/<name> path");
    const nasGuestMount = await request(`/api/v1/nas/sources/${encodeURIComponent(savedNas.id)}/mount`, {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(nasGuestMount.response.ok && nasGuestMount.body.sources.find((source) => source.id === savedNas.id)?.status === "ready", "NAS mount should mark saved source ready");
    const nasPasswordSave = await request("/api/v1/nas/sources", {
      method: "POST",
      body: JSON.stringify({
        name: "Private NAS",
        host: "192.168.10.104",
        port: 445,
        share: "Music",
        authMode: "password",
        username: "listener",
        password: "secret",
        mountName: "Private"
      })
    });
    assert(nasPasswordSave.response.ok, "NAS username/password source should save");
    const privateNas = nasPasswordSave.body.sources.find((source) => source.name === "Private NAS");
    assert(privateNas?.hasCredentials === true && privateNas.username === "listener", "NAS password source should expose username and hasCredentials only");
    assert(!JSON.stringify(nasPasswordSave.body).includes("secret"), "NAS password source response should never echo the clear password");
    const nasDelete = await request(`/api/v1/nas/sources/${encodeURIComponent(privateNas.id)}`, { method: "DELETE" });
    assert(nasDelete.response.ok && !nasDelete.body.sources.some((source) => source.id === privateNas.id), "NAS delete should remove the saved source");
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
      body: JSON.stringify({ target: "radio", radioStationId: "radio-510" })
    });
    assert(radioAfterLocalTrack.response.ok, "radio switch after local track should return 200");
    assert(radioAfterLocalTrack.body.audio.rememberedSource?.target === "radio", "radio switch should remain the remembered visible source");
    assert(radioAfterLocalTrack.body.audio.rememberedSource?.radioStationId === "radio-510", "radio switch should remember the selected station");
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
    assert(libraryReturnAfterRadio.body.audio.rememberedSource?.radioStationId === "radio-510", "bare Library switch after Radio should preserve the previous station bookmark");
    const radioReturnAfterLibrary = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "radio" })
    });
    assert(radioReturnAfterLibrary.response.ok, "bare Radio switch after Library should return 200");
    assert(radioReturnAfterLibrary.body.audio.currentSource.id === "radio", "bare Radio switch after Library should restore Radio");
    assert(radioReturnAfterLibrary.body.audio.currentSource.radioStationId === "radio-510", "bare Radio switch after Library should restore the previous station");
    assert(radioReturnAfterLibrary.body.audio.rememberedSource?.radioStationId === "radio-510", "bare Radio switch after Library should keep the restored station in memory");
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
    const usbFavoriteAdd = await request("/api/v1/audio/favorites", {
      method: "POST",
      body: JSON.stringify({ trackPath: usbLibrary.body.tracks[0].path, favorite: true })
    });
    assert(usbFavoriteAdd.response.ok, "USB favorite add endpoint should return 200");
    const usbLibraryAfterFavorite = await request("/api/v1/audio/library?storage=usb&limit=10");
    assert(
      usbLibraryAfterFavorite.body.tracks.some((track) => track.path === usbLibrary.body.tracks[0].path && track.favorite === true),
      "USB library should expose favorite=true for saved USB tracks"
    );
    const favoritesWithUsb = await request("/api/v1/audio/library?storage=favorites&limit=50");
    assert(favoritesWithUsb.body.total === 2, "favorites library should include saved local and USB tracks");
    assert(
      favoritesWithUsb.body.tracks.some((track) => track.path === usbLibrary.body.tracks[0].path),
      "favorites library should return the favorited USB track path"
    );
    const persistedState = JSON.parse(await readFile(musicLibraryStatePath, "utf8"));
    assert(persistedState.favorites.trackPaths.includes(localLibrary.body.tracks[0].path), "favorites should persist to the music library state file");
    assert(persistedState.favorites.trackPaths.includes(usbLibrary.body.tracks[0].path), "USB favorites should persist to the music library state file");

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
    assert(playlistPlayback.body.audio.rememberedSource?.radioStationId === "radio-510", "playlist play should preserve the last Radio station bookmark");
    const playlistNext = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "next" })
    });
    assert(playlistNext.response.ok, "playlist-backed next should return 200");
    assert(playlistNext.body.playback.currentTrackIndex === 2, "playlist-backed next should advance within the local queue");
    assert(playlistNext.body.audio.rememberedSource?.localTrackPath === localLibrary.body.tracks[0].path, "playlist-backed next should remember the advanced local track");
    assert(playlistNext.body.audio.rememberedSource?.radioStationId === "radio-510", "playlist-backed next should preserve the last Radio station bookmark");
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

    const radios = await request("/api/v1/audio/radios?q=cliqhop&category=focus");
    assert(radios.response.ok, "radio catalog should return 200");
    assert(radios.body.total >= 1, "radio catalog should include matching stations");
    assert(radios.body.stations.every((station) => station.category === "focus"), "radio catalog should filter by single-layer category");

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
    const missingLyrics = await waitForLyricsTrackAt(BASE_URL, {
      title: nextToNotFound.body.playback.title,
      artist: nextToNotFound.body.playback.artist,
      statuses: ["not_found", "ready"]
    });
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
    assert(calmBeforeScene.body.sceneSoundEnabled === false, "calm room mode should leave scene sound off by default");
    const stateAfterCalmBeforeScene = await request("/api/v1/system/state");
    assert(stateAfterCalmBeforeScene.body.audio.currentSource.id === "mpd", "calm room mode should preserve the current music source by default");

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

    const focusWithSceneSound = await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_mode", mode: "focus" })
    });
    assert(focusWithSceneSound.response.ok, "focus mode should accept an active scene source");
    assert(focusWithSceneSound.body.sceneSoundEnabled === true, "focus mode should preserve active scene sound");
    assert(focusWithSceneSound.body.sceneVideoId === "midnight-library", "focus mode should retarget active scene sound to the focus scene");
    const stateAfterFocusWithSceneSound = await request("/api/v1/system/state");
    assert(stateAfterFocusWithSceneSound.body.audio.currentSource.id === "scene", "focus mode should keep Scene Sound as the active source");
    assert(stateAfterFocusWithSceneSound.body.playback.source === "scene", "focus mode should not fall silent while Scene Sound is active");

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
    assert(thisCityLyrics.timingStrategy === "provider_synced", "Bluetooth timed lyrics should prefer provider timing when BlueZ reports a short unreliable duration");
    assert(thisCityLyrics.synced === true, "Bluetooth metadata lyrics should stay synced when playback position is available");
    assert(thisCityLyrics.lines.some((line) => line.text.includes("break my heart")), "Bluetooth lyrics should not clip provider-synced lines to a short fake BlueZ duration");
    assert(
      thisCityLyrics.trackKey === smokeTrackKey({
        source: "bluetooth",
        title: "This City",
        artist: "Sam Fischer",
        album: "Not a Hobby",
        durationSeconds: null
      }),
      "Bluetooth lyrics should ignore unreliable short metadata duration in the track key"
    );

    await writeFile(
      BLUETOOTH_METADATA_PATH,
      [
        "title=中文测试歌",
        "artist=周杰伦",
        "album=中文蓝牙验证",
        "status=playing",
        "positionMs=42000",
        "durationMs=60000"
      ].join("\n")
    );
    const chineseBluetoothLyricsRefresh = await request("/api/v1/lyrics/refresh", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(chineseBluetoothLyricsRefresh.response.ok, "bluetooth Chinese metadata lyrics refresh should return 200");
    const chineseBluetoothLyrics = await waitForLyricsTrackAt(BASE_URL, {
      title: "中文测试歌",
      artist: "周杰伦"
    });
    assert(chineseBluetoothLyrics.sourceScope === "bluetooth_input", "Chinese bluetooth lyrics should keep bluetooth scope");
    assert(chineseBluetoothLyrics.recognitionMode === "metadata", "Chinese BlueZ metadata should use metadata lyrics lookup");
    assert(chineseBluetoothLyrics.recognitionProvider === "lrclib", "Chinese bluetooth lyrics should resolve through LRCLIB");
    assert(chineseBluetoothLyrics.synced === true, "Chinese bluetooth lyrics should preserve synced provider timing");
    assert(chineseBluetoothLyrics.lines.some((line) => line.text.includes("中文蓝牙同步歌词")), "Chinese bluetooth lyrics should keep displayable CJK text");

    const airplay = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "airplay" })
    });
    assert(airplay.response.ok, "airplay source switch should return 200");
    assert(airplay.body.audio.currentSource.id === "airplay", "airplay switch should activate airplay in mock mode");
    assert(airplay.body.audio.currentSource.armed === true, "airplay switch should arm airplay intake");
    assert(airplay.body.audio.currentSource.connectionState === "armed", "airplay source should initially wait for a connected input");
    assert(airplay.body.audio.sources.some((source) => source.id === "bluetooth" && source.armed === false), "airplay switch should disarm bluetooth");

    const hifiWithAirplay = await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_mode", mode: "hifi" })
    });
    assert(hifiWithAirplay.response.ok, "hifi mode with AirPlay should return 200");
    assert(hifiWithAirplay.body.sceneSoundEnabled === false, "hifi mode with AirPlay should keep Scene Sound off");
    const focusWithAirplay = await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_mode", mode: "focus" })
    });
    assert(focusWithAirplay.response.ok, "focus mode from hifi with AirPlay should return 200");
    assert(focusWithAirplay.body.sceneSoundEnabled === false, "focus mode from hifi should keep Scene Sound off");
    const stateAfterFocusWithAirplay = await request("/api/v1/system/state");
    assert(stateAfterFocusWithAirplay.body.audio.currentSource.id === "airplay", "focus mode from hifi should preserve AirPlay");
    assert(stateAfterFocusWithAirplay.body.playback.source === "airplay", "focus mode from hifi should not replace AirPlay with Scene Sound");
    const hifiAfterFocusWithAirplay = await request("/api/v1/experience/actions", {
      method: "POST",
      body: JSON.stringify({ type: "set_mode", mode: "hifi" })
    });
    assert(hifiAfterFocusWithAirplay.response.ok, "hifi mode after focus with AirPlay should return 200");
    const stateAfterHifiWithAirplay = await request("/api/v1/system/state");
    assert(stateAfterHifiWithAirplay.body.audio.currentSource.id === "airplay", "hifi mode after focus should preserve AirPlay");

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
      body: JSON.stringify({ target: "radio", radioStationId: "radio-510" })
    });
    assert(radio.response.ok, "radio source switch should return 200");
    assert(radio.body.audio.currentSource.id === "radio", "radio switch should activate radio in mock mode");
    assert(radio.body.audio.currentSource.radioStationId === "radio-510", "radio switch should expose the selected mock station id on currentSource");
    assert(radio.body.playback.source === "radio", "playback source should follow radio switch");
    assert(radio.body.playback.title === "Calm - Positively Meditation", "radio switch should surface the active preset label");
    assert(radio.body.playback.albumArtUrl?.startsWith("data:image/svg+xml"), "radio switch should expose the active station logo as playback artwork");
    assert(radio.body.audio.rememberedSource?.target === "radio", "radio switch should remember Radio as the last source");
    assert(radio.body.audio.rememberedSource?.radioStationId === "radio-510", "radio switch should remember the selected station id");
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
    assert(stateAfterSceneSoundOffRadio.body.audio.currentSource.radioStationId === "radio-510", "turning scene sound off after Radio should restore the remembered station");
    assert(stateAfterSceneSoundOffRadio.body.playback.source === "radio", "turning scene sound off after Radio should expose Radio playback");
    assert(stateAfterSceneSoundOffRadio.body.playback.state === "playing", "turning scene sound off after Radio should not leave playback stopped");

    const mpd = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "mpd" })
    });
    assert(mpd.response.ok, "mpd source switch should return 200");
    assert(mpd.body.audio.currentSource.id === "mpd", "mpd switch should return to library in mock mode");
    assert(mpd.body.audio.sources.some((source) => source.id === "bluetooth" && source.armed === false), "mpd switch should keep bluetooth blocked");
    const cachedLyrics = await waitForLyricsTrackAt(BASE_URL, {
      title: mpd.body.playback.title,
      artist: mpd.body.playback.artist,
      statuses: ["not_found", "ready"]
    });
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
    const remoteExploreOpen = await request("/api/v1/remote/actions", {
      method: "POST",
      headers: remoteHeaders,
      body: JSON.stringify({ type: "explore.open" })
    });
    assert(remoteExploreOpen.response.ok, "remote explore.open should return 200");
    assert(remoteExploreOpen.body.explore.activeProvider === "qq_music", "remote explore.open should default to QQ Music");
    assert(remoteExploreOpen.body.explore.activeProviderLabel === "QQ Music", "remote explore.open should expose the active provider label");
    const remoteProxyOff = await request("/api/v1/remote/actions", {
      method: "POST",
      headers: remoteHeaders,
      body: JSON.stringify({ type: "explore.proxy_set", enabled: false })
    });
    assert(remoteProxyOff.response.ok, "remote explore.proxy_set should return 200");
    assert(remoteProxyOff.body.explore.proxyEnabled === false, "remote explore.proxy_set should disable the proxy");
    assert(remoteProxyOff.body.explore.activeProvider === "qq_music", "remote proxy changes should preserve the active provider without reopening it");
    const remoteProxyOn = await request("/api/v1/remote/actions", {
      method: "POST",
      headers: remoteHeaders,
      body: JSON.stringify({ type: "explore.proxy_set", enabled: true })
    });
    assert(remoteProxyOn.response.ok, "remote explore.proxy_set should re-enable the proxy");
    assert(remoteProxyOn.body.explore.proxyEnabled === true, "remote explore.proxy_set should expose the updated proxy status");
    const invalidRemoteProxy = await request("/api/v1/remote/actions", {
      method: "POST",
      headers: remoteHeaders,
      body: JSON.stringify({ type: "explore.proxy_set" })
    });
    assert(invalidRemoteProxy.response.status === 400, "remote explore.proxy_set should require a boolean enabled value");
    const remoteExploreClose = await request("/api/v1/remote/actions", {
      method: "POST",
      headers: remoteHeaders,
      body: JSON.stringify({ type: "explore.close" })
    });
    assert(remoteExploreClose.response.ok, "remote explore.close should return 200");
    assert(remoteExploreClose.body.explore.activeProvider === null, "remote explore.close should clear the active provider");
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
      body: JSON.stringify({ type: "source.set", target: "radio", radioStationId: "radio-510" })
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
    assert(remoteRoom.body.volume.percent === 33, "remote room.set_mode should preserve explicit global volume");
    assert(remoteRoom.body.scene.sceneSoundEnabled === false, "remote room.set_mode should keep Scene Sound off by default");
    assert(remoteRoom.body.source.current.id === "radio", "remote room.set_mode should preserve Radio");
    const remoteScene = await request("/api/v1/remote/actions", {
      method: "POST",
      headers: remoteHeaders,
      body: JSON.stringify({ type: "scene.set", sceneVideoId: "warm-fireplace" })
    });
    assert(remoteScene.response.ok, "remote scene.set should return 200");
    assert(remoteScene.body.scene.videoId === "warm-fireplace", "remote scene.set should update scene");
    assert(remoteScene.body.source.current.id === "radio", "remote scene.set should preserve Radio while Scene Sound is off");
    const remoteHifiAfterScene = await request("/api/v1/remote/actions", {
      method: "POST",
      headers: remoteHeaders,
      body: JSON.stringify({ type: "room.set_mode", mode: "hifi" })
    });
    assert(remoteHifiAfterScene.response.ok, "remote room.set_mode hifi after scene.set should return 200");
    assert(remoteHifiAfterScene.body.source.current.id === "radio", "remote room.set_mode hifi should preserve Radio");
    const remoteCalmAfterScene = await request("/api/v1/remote/actions", {
      method: "POST",
      headers: remoteHeaders,
      body: JSON.stringify({ type: "room.set_mode", mode: "calm" })
    });
    assert(remoteCalmAfterScene.response.ok, "remote room.set_mode calm after scene.set should return 200");
    assert(remoteCalmAfterScene.body.scene.videoId === "warm-fireplace", "remote room.set_mode should restore remembered calm scene");
    assert(remoteCalmAfterScene.body.scene.sceneSoundEnabled === false, "remote room.set_mode calm after hifi should keep Scene Sound off");
    assert(remoteCalmAfterScene.body.source.current.id === "radio", "remote room.set_mode calm after hifi should preserve Radio");
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
    await runMpcHifiRememberedStartupRestoreSmoke();
    await runMpcHifiRememberedLibraryStartupRestoreSmoke();
    await runMpcHifiRuntimePlaybackRecoverySmoke();
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
    await rm(apiUsbParentRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

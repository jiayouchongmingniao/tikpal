import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const source = await readFile(path.join(root, "deploy/chromium/web-mode-extension/provider-audio-gate.js"), "utf8");
const mediaElements = [];
const listeners = new Map();
const messages = [];

class FakeMediaElement {
  constructor() {
    this.volume = 0.4;
    this.ended = false;
    this.muted = false;
    this.paused = true;
    this.playCalls = 0;
  }

  addEventListener(type, handler) {
    this.handlers ||= new Map();
    this.handlers.set(type, handler);
  }

  play() {
    this.playCalls += 1;
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }
}

class FakeAudioContext {
  constructor() {
    this.state = "running";
  }

  suspend() {
    this.state = "suspended";
    return Promise.resolve();
  }

  resume() {
    this.state = "running";
    return Promise.resolve();
  }
}

const document = {
  addEventListener(type, handler) {
    const handlers = listeners.get(type) || [];
    handlers.push(handler);
    listeners.set(type, handlers);
  },
  querySelectorAll(selector) {
    return selector === "audio,video" ? mediaElements : [];
  }
};
const window = {
  AudioContext: FakeAudioContext,
  HTMLMediaElement: FakeMediaElement,
  location: { origin: "https://example.test" },
  postMessage(message) {
    messages.push(message);
  }
};
window.window = window;

vm.runInNewContext(source, {
  document,
  HTMLMediaElement: FakeMediaElement,
  Promise,
  setTimeout: (callback) => callback(),
  window
});

const gate = window.__tikpalProviderAudioGate;
assert.equal(gate?.version, 3, "document-start gate should expose the v3 contract");
assert.equal(gate.status().active, false, "prewarm gate should start inactive");
assert.equal(messages[0]?.type, "tikpal-provider-audio-muted", "prewarm gate should request a muted tab immediately");
assert.equal(messages[0]?.muted, true, "prewarm gate should request muted browser output immediately");

const suppressed = new FakeMediaElement();
const untouched = new FakeMediaElement();
mediaElements.push(suppressed, untouched);
await suppressed.play();
assert.equal(suppressed.muted, true, "inactive gate should mute media before playback");
assert.equal(suppressed.paused, true, "inactive gate should pause suppressed playback");

const context = new window.AudioContext();
await Promise.resolve();
assert.equal(context.state, "suspended", "inactive gate should suspend newly-created Web Audio contexts");

gate.setActive(true);
await Promise.resolve();
assert.equal(suppressed.muted, false, "foreground activation should unmute suppressed media");
assert.equal(suppressed.paused, false, "foreground activation should resume suppressed media");
assert.equal(untouched.playCalls, 0, "foreground activation must not start media that prewarm never tried to play");
assert.equal(context.state, "running", "foreground activation should resume suspended Web Audio contexts");

gate.setActive(false);
const eventOnly = new FakeMediaElement();
eventOnly.paused = false;
mediaElements.push(eventOnly);
for (const handler of listeners.get("play") || []) handler({ target: eventOnly });
assert.equal(eventOnly.muted, true, "play-event fallback should mute media created outside the patched play path");
assert.equal(eventOnly.paused, true, "play-event fallback should pause media created outside the patched play path");

// MusicKit propagates media mute into its persisted player volume.
const reactive = new FakeMediaElement();
reactive.volume = 0.6;
Object.defineProperty(reactive, "muted", {
  get() { return this._muted || false; },
  set(value) { this._muted = value; if (value) this.volume = 0; }
});
mediaElements.push(reactive);
gate.setActive(true);
await reactive.play();
gate.setActive(false);
gate.setActive(false);
assert.equal(reactive.volume, 0, "fixture should reproduce player volume following mute");
gate.setActive(true);
assert.equal(reactive.volume, 1, "activation must restore unity gain after reactive mute");
assert.equal(reactive.paused, false, "volume recovery must preserve playback resume");
reactive.volume = 0;
gate.setActive(false);
gate.setActive(true);
assert.equal(reactive.volume, 1, "provider gain must use unity even if the site saved zero");
reactive.volume = 0.2;
for (const handler of listeners.get("volumechange") || []) handler({ target: reactive });
assert.equal(reactive.volume, 1, "foreground site volume changes must not introduce a second gain control");
const detached = new FakeMediaElement();
await detached.play();
assert.equal(detached.volume, 1, "detached media must use unified gain before play");
gate.setActive(false);
assert.equal(detached.paused, true, "detached playback must be isolated in background");
gate.setActive(true);
assert.equal(detached.paused, false, "detached playback must resume");
const sound = { _id: 7, _paused: true, _volume: 0.3 };
const howl = { _sounds: [sound], _volume: 0.2, volume(value, id) {
  if (value === undefined) return this._volume;
  if (id === undefined) this._volume = value;
  else sound._volume = value;
} };
window.Howler = { _howls: [howl], _volume: 0.1, volume(value) {
  if (value === undefined) return this._volume;
  this._volume = value;
}, mute() {} };
gate.setActive(true);
assert.equal(window.Howler._volume, 1);
assert.equal(howl._volume, 1);
assert.equal(sound._volume, 1, "Howler per-sound gain must also use unity");

// Exercise the guard against a Manager whose maintenance budget is exhausted.
const failedMedia = new FakeMediaElement();
gate.setActive(true);
await failedMedia.play();
const playingBeforeFailure = gate.status().playingCount;
failedMedia.error = {code:2};
assert.equal(gate.status().playingCount, playingBeforeFailure - 1, 'errored media cannot count as healthy playback');
let reportedFailures = 0;
window.__tikpalDeezerPreviewRecovery = { mediaError: element => { assert.equal(element, failedMedia); reportedFailures++; }, setActive() {} };
failedMedia.handlers.get('error')();
assert.equal(reportedFailures, 1, 'media read error must reach the provider recovery hook');
gate.setActive(false);gate.setActive(true);
assert.equal(reportedFailures, 2, 'returning to a failed previously-playing element must report the existing error');
delete window.__tikpalDeezerPreviewRecovery;
failedMedia.pause();

const guardSource = await readFile(path.join(root, "deploy/chromium/tikpal-web-mode-guard.mjs"), "utf8");
const guardFunction = (name, nextName) => guardSource.slice(
  guardSource.indexOf(`async function ${name}(`),
  guardSource.indexOf(`async function ${nextName}(`)
);
let runtime = { active: true, opening: false, deactivating: false, frozen: false };
let player = { ready: true, playing: true, muted: false };
let gateActive = false;
let primeRunning = false;
let primeCalls = 0;
const guard = vm.createContext({
  providerId: "qq_music",
  qqAudioPrime: true,
  qqAudioPrimeAttempts: new Map(),
  qqAudioPrimeCooldownMs: 12000,
  qqAudioStateExpression: "state",
  qqAudioPrimeExpression: "prime",
  providerAudioGateExpression: (active) => active ? "activate" : "deactivate",
  readProviderRuntimeState: () => runtime,
  isQqMusicPlayerPage: () => true,
  isProviderWebPage: () => true,
  isFriendlyErrorPage: () => false,
  console: { log() {} },
  evaluate: async (_url, expression, priority = "maintenance") => {
    if (priority === "maintenance") throw new Error("CDP maintenance throttled");
    if (expression === "state") return player;
    if (expression === "prime") {
      primeCalls += 1;
      primeRunning = player.playing && !player.muted;
      return { primed: primeRunning, state: "running" };
    }
    gateActive = expression === "activate";
    return { active: gateActive };
  }
});
vm.runInContext(
  guardFunction("runProviderAudioGate", "runProviderAudioGateWithRetries") +
  guardFunction("runQqAudioPrimeFeatures", "runQqMvTouchTargetFeatures"), guard
);
const targets = [{ id: "qq", webSocketDebuggerUrl: "manager://qq_music/qq" }];
assert.equal(await guard.runProviderAudioGate(targets, true), true, "QQ must repair an inactive gate under maintenance throttling");
assert.equal(gateActive, true);
await guard.runQqAudioPrimeFeatures(targets);
assert.equal(primeRunning, true, "both QQ state check and priming must survive maintenance throttling");
await guard.runQqAudioPrimeFeatures(targets);
assert.equal(primeCalls, 1, "successful priming should keep its cooldown");
for (const state of [{ playing: false, muted: false }, { playing: true, muted: true }]) {
  player = { ready: true, ...state };
  primeRunning = true;
  await guard.runQqAudioPrimeFeatures(targets);
  assert.equal(primeRunning, false, "pause or mute must stop priming even during cooldown");
}
const callsBeforeHandoff = primeCalls;
player = { ready: true, playing: true, muted: false };
for (const role of [{ active: false }, { opening: true }, { deactivating: true }, { frozen: true }]) {
  runtime = { active: true, opening: false, deactivating: false, frozen: false, ...role };
  await guard.runQqAudioPrimeFeatures(targets);
}
assert.equal(primeCalls, callsBeforeHandoff, "QQ priming must yield during switching and while inactive or frozen");
assert.equal(await guard.runProviderAudioGate(targets, false), true, "QQ deactivation must also survive maintenance throttling");
assert.equal(gateActive, false);
for (const provider of ["qobuz", "spotify", "apple_music", "suno", "tidal", "deezer", "amazon_music", "youtube_music", "netease_music"]) {
  guard.providerId = provider;
  gateActive = false; // A fresh document after login starts with playback blocked.
  assert.equal(await guard.runProviderAudioGate(targets, true), true, `${provider} must restore foreground playback under maintenance throttling`);
  assert.equal(gateActive, true);
  assert.equal(await guard.runProviderAudioGate(targets, false), false, "ordinary background maintenance should retain its throttle");
}

console.log("[provider-audio-gate-fixture] passed");

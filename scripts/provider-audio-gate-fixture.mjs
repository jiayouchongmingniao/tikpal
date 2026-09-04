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
    this.ended = false;
    this.muted = false;
    this.paused = true;
    this.playCalls = 0;
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

console.log("[provider-audio-gate-fixture] passed");

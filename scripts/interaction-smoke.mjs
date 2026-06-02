import { spawn } from "node:child_process";
import { spawnSync } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const APP_URL = process.env.TIKPAL_TEST_URL ?? "http://localhost:4173/";
const DEVTOOLS_PORT = Number(process.env.TIKPAL_TEST_DEVTOOLS_PORT ?? 9222);
const INTERACTION_SCENE_FIXTURE_DIR = path.resolve("public", "assets", ".interaction-smoke");
const INTERACTION_SCENE_FIXTURE_PATH = path.join(INTERACTION_SCENE_FIXTURE_DIR, "scene.mp4");
const INTERACTION_SCENE_FIXTURE_SRC = "/assets/.interaction-smoke/scene.mp4";

async function canAccess(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function detectChromeBinary() {
  if (process.env.CHROME_BIN) {
    if (await canAccess(process.env.CHROME_BIN)) {
      return process.env.CHROME_BIN;
    }
    throw new Error(`CHROME_BIN is set but not executable: ${process.env.CHROME_BIN}`);
  }

  const fileCandidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  ];

  for (const candidate of fileCandidates) {
    if (await canAccess(candidate)) {
      return candidate;
    }
  }

  const commandCandidates = [
    "google-chrome-stable",
    "google-chrome",
    "chromium",
    "chromium-browser",
    "chrome"
  ];

  for (const candidate of commandCandidates) {
    const result = spawnSync("which", [candidate], { encoding: "utf8" });
    if (result.status === 0) {
      const resolved = result.stdout.trim();
      if (resolved) return resolved;
    }
  }

  throw new Error("No Chrome/Chromium binary found. Set CHROME_BIN to a valid browser executable.");
}

async function prepareInteractionSceneFixture() {
  if (process.env.TIKPAL_INTERACTION_SCENE_VIDEO_SRC) {
    return process.env.TIKPAL_INTERACTION_SCENE_VIDEO_SRC;
  }

  await mkdir(INTERACTION_SCENE_FIXTURE_DIR, { recursive: true });
  const result = spawnSync("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", "color=c=0xe65f22:s=160x90:r=12",
    "-f", "lavfi",
    "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-t", "2.4",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "32",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "64k",
    "-movflags", "+faststart",
    INTERACTION_SCENE_FIXTURE_PATH
  ], { encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(`Failed to generate interaction scene fixture with ffmpeg:\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }

  return INTERACTION_SCENE_FIXTURE_SRC;
}

async function resetInteractionRoomExperience() {
  const actionsUrl = new URL("/api/v1/experience/actions", APP_URL);
  for (const body of [
    { type: "set_hifi_eq", hifiEqPresetId: "flat" },
    { type: "set_mode", mode: "calm" }
  ]) {
    const response = await fetch(actionsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`Failed to reset room experience for interaction smoke: ${response.status}`);
    }
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return await new Promise((resolve) => {
    const handleExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off("exit", handleExit);
      resolve(false);
    }, timeoutMs);
    child.once("exit", handleExit);
  });
}

async function waitForDevTools() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const payload = await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json/version`).then((response) => response.json());
      if (payload.webSocketDebuggerUrl) {
        return payload.webSocketDebuggerUrl;
      }
    } catch {
      // Chrome is still starting.
    }
    await wait(125);
  }
  throw new Error("Timed out waiting for Chrome DevTools endpoint");
}

async function getPageWebSocket(browserWsUrl) {
  const url = new URL(browserWsUrl);
  const targetsUrl = `http://${url.host}/json`;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const targets = await fetch(targetsUrl).then((response) => response.json());
    const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
    if (page) return page.webSocketDebuggerUrl;
    await wait(100);
  }
  throw new Error("No page target found");
}

class CdpClient {
  constructor(wsUrl) {
    this.id = 0;
    this.pending = new Map();
    this.ws = new WebSocket(wsUrl);
  }

  async open() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  close() {
    this.ws.close();
  }
}

async function expect(client, expression, label) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true
  });
  if (!result.result.value) {
    throw new Error(`Failed: ${label}`);
  }
  console.log(`ok - ${label}`);
}

async function expectEventually(client, expression, label, attempts = 20, delayMs = 150) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await client.send("Runtime.evaluate", {
      expression,
      returnByValue: true
    });
    if (result.result.value) {
      console.log(`ok - ${label}`);
      return;
    }
    await wait(delayMs);
  }

  throw new Error(`Failed: ${label}`);
}

async function expectEventuallyEvaluate(client, expression, label, attempts = 20, delayMs = 150) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(client, expression)) {
      console.log(`ok - ${label}`);
      return;
    }
    await wait(delayMs);
  }

  throw new Error(`Failed: ${label}`);
}

async function sampleLoopVideoLuma(client) {
  const sample = await evaluate(
    client,
    `
      (() => {
        const videos = [...document.querySelectorAll('.flame-video[data-flame-layer="active"]')];
        const canvas = document.createElement('canvas');
        const size = 32;
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return null;

        let luma = 0;
        let totalOpacity = 0;
        const roles = [];

        for (const video of videos) {
          if (!(video instanceof HTMLVideoElement) || video.videoWidth <= 0 || video.videoHeight <= 0) continue;
          const opacity = Math.max(0, Math.min(1, Number.parseFloat(getComputedStyle(video).opacity) || 0));
          roles.push([
            video.getAttribute('data-flame-loop-role'),
            opacity.toFixed(2),
            video.getAttribute('data-flame-frame-ready'),
            video.getAttribute('data-flame-loop-phase')
          ].join(':'));
          if (opacity <= 0.01) continue;

          const sourceSize = Math.max(8, Math.min(video.videoWidth, video.videoHeight, Math.floor(Math.min(video.videoWidth, video.videoHeight) * 0.5)));
          const sx = Math.max(0, Math.floor((video.videoWidth - sourceSize) / 2));
          const sy = Math.max(0, Math.floor((video.videoHeight - sourceSize) / 2));
          context.clearRect(0, 0, size, size);
          context.drawImage(video, sx, sy, sourceSize, sourceSize, 0, 0, size, size);
          const pixels = context.getImageData(0, 0, size, size).data;
          let videoLuma = 0;
          for (let index = 0; index < pixels.length; index += 4) {
            videoLuma += (0.2126 * pixels[index]) + (0.7152 * pixels[index + 1]) + (0.0722 * pixels[index + 2]);
          }
          luma += opacity * (videoLuma / (pixels.length / 4));
          totalOpacity += opacity;
        }

        return { luma, totalOpacity, roles };
      })()
    `
  );

  if (!sample || !Number.isFinite(sample.luma)) {
    throw new Error("Failed: scene loop luma sample is unavailable");
  }
  return sample;
}

async function sampleLoopAudioState(client) {
  const sample = await evaluate(
    client,
    `
      (() => {
        const videos = [...document.querySelectorAll('.flame-video[data-flame-layer="active"]')];
        const audibleVideos = videos
          .filter((video) => video instanceof HTMLVideoElement)
          .map((video) => ({
            slot: video.getAttribute('data-flame-slot-index'),
            loopRole: video.getAttribute('data-flame-loop-role'),
            audioRole: video.getAttribute('data-flame-audio-role'),
            audioSlot: video.getAttribute('data-flame-audio-slot'),
            muted: video.muted,
            paused: video.paused,
            ended: video.ended,
            volume: video.volume,
            sceneVolume: Number.parseFloat(video.getAttribute('data-scene-volume') ?? '0'),
            currentTime: video.currentTime,
            duration: video.duration
          }))
          .filter((video) => !video.muted && video.sceneVolume > 0);
        return {
          audibleVideos,
          activeCount: videos.filter((video) => video.getAttribute('data-flame-audio-slot') === 'active').length
        };
      })()
    `
  );

  const audibleVideos = sample?.audibleVideos ?? [];
  const hasInvalidAudible = audibleVideos.some((video) => video.paused || video.ended || video.volume <= 0 || video.sceneVolume <= 0);
  const isValidSingle = audibleVideos.length === 1 && sample.activeCount === 1;
  const isValidCrossfade = audibleVideos.length === 2
    && audibleVideos.some((video) => video.audioRole === "crossfade-in")
    && audibleVideos.some((video) => video.audioRole === "crossfade-out");

  if (!sample || hasInvalidAudible || (!isValidSingle && !isValidCrossfade)) {
    throw new Error(`Failed: scene loop audio active slot dropped out (${JSON.stringify(sample)})`);
  }
  return sample;
}

async function navigate(client, url) {
  await client.send("Page.navigate", { url });
  await wait(750);
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  return result.result.value;
}

function sourceTabExpression(sourceId, { selected, active }) {
  return `
    (() => {
      const target = document.querySelector('[data-source-item="${sourceId}"]');
      return Boolean(
        target
        && target.classList.contains('library-primary-tab')
        && target.classList.contains('is-selected') === ${selected}
        && target.classList.contains('is-active') === ${active}
      );
    })()
  `;
}

function sourceHighlightExpression(theme) {
  return `
    (() => {
      const root = document.documentElement;
      if (root.dataset.surfaceTheme !== ${JSON.stringify(theme)}) return false;
      const idle = document.querySelector('[data-source-item="radio"]');
      const selectedActive = document.querySelector('[data-source-item="mpd"]');
      if (!idle || !selectedActive) return false;

      const styleKey = (node) => {
        const style = window.getComputedStyle(node);
        return [
          style.borderColor,
          style.backgroundColor,
          style.backgroundImage,
          style.boxShadow,
          style.color
        ].join('|');
      };

      const makeProbe = (className) => {
        const probe = idle.cloneNode(true);
        probe.classList.remove('is-selected', 'is-active');
        probe.classList.add(className);
        probe.style.position = 'fixed';
        probe.style.left = '-10000px';
        probe.style.top = '-10000px';
        probe.style.width = '120px';
        probe.style.height = '60px';
        document.body.appendChild(probe);
        return probe;
      };

      const idleStyle = styleKey(idle);
      const selectedStyle = styleKey(makeProbe('is-selected'));
      const activeStyle = styleKey(makeProbe('is-active'));
      const selectedActiveStyle = styleKey(selectedActive);
      document.querySelectorAll('body > .library-primary-tab').forEach((node) => node.remove());

      return selectedStyle !== idleStyle
        && activeStyle !== idleStyle
        && selectedActiveStyle !== idleStyle
        && selectedActiveStyle !== activeStyle;
    })()
  `;
}

function settingsSummaryExpression(section, expectedTitles) {
  return `
    (() => {
      const grid = document.querySelector('.settings-grid[data-settings-section="${section}"]');
      if (!grid) return false;
      const columns = window.getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean);
      const cards = [...grid.querySelectorAll('.settings-card')];
      const labels = cards.map((node) => node.querySelector('span')?.textContent?.trim());
      const expected = ${JSON.stringify(expectedTitles)};
      if (columns.length !== 4 || cards.length !== expected.length) return false;
      if (!expected.every((title, index) => labels[index] === title)) return false;

      const rects = cards.map((node) => node.getBoundingClientRect());
      if (!rects.length) return false;
      const first = rects[0];
      const sameSize = rects.every((rect) => Math.abs(rect.width - first.width) < 1 && Math.abs(rect.height - first.height) < 1);
      const fixedHeight = rects.every((rect) => Math.abs(rect.height - 132) < 1);
      const noSpan = cards.every((node) => {
        const style = window.getComputedStyle(node);
        return style.gridColumnStart === 'auto' && style.gridColumnEnd === 'auto';
      });

      return sameSize && fixedHeight && noSpan && grid.scrollHeight <= grid.clientHeight + 1;
    })()
  `;
}

async function wheelAt(client, x, y, deltaX, deltaY, modifiers = 0) {
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x,
    y,
    deltaX,
    deltaY,
    modifiers
  });
  await wait(350);
}

async function wheel(client, deltaY, modifiers = 0) {
  await wheelAt(client, 1280, 360, 0, deltaY, modifiers);
}

async function click(client, x, y) {
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1
  });
  await wait(250);
}

async function clickButtonContaining(client, rootSelector, text) {
  const clicked = await evaluate(
    client,
    `
      (() => {
        const root = document.querySelector(${JSON.stringify(rootSelector)}) ?? document;
        const target = [...root.querySelectorAll('button')].find((button) => button.textContent?.includes(${JSON.stringify(text)}));
        target?.click();
        return Boolean(target);
      })()
    `
  );
  if (!clicked) throw new Error(`Failed: button containing ${text} was not found in ${rootSelector}`);
  await wait(250);
}

async function setInputValue(client, selector, value) {
  const updated = await evaluate(
    client,
    `
      (() => {
        const input = document.querySelector(${JSON.stringify(selector)});
        if (!(input instanceof HTMLInputElement)) return false;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()
    `
  );
  if (!updated) throw new Error(`Failed: input not found for ${selector}`);
  await wait(150);
}

async function drag(client, fromX, fromY, toX, toY, steps = 8) {
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: fromX,
    y: fromY,
    button: "left",
    clickCount: 1
  });

  for (let index = 1; index <= steps; index += 1) {
    const progress = index / steps;
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: fromX + (toX - fromX) * progress,
      y: fromY + (toY - fromY) * progress,
      button: "left",
      buttons: 1
    });
    await wait(16);
  }

  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: toX,
    y: toY,
    button: "left",
    clickCount: 1
  });
  await wait(300);
}

async function dragUntilHold(client, fromX, fromY, toX, toY, steps = 4) {
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: fromX,
    y: fromY,
    button: "left",
    clickCount: 1
  });

  for (let index = 1; index <= steps; index += 1) {
    const progress = index / steps;
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: fromX + (toX - fromX) * progress,
      y: fromY + (toY - fromY) * progress,
      button: "left",
      buttons: 1
    });
    await wait(16);
  }

  await wait(80);
}

async function releaseDrag(client, x, y) {
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1
  });
  await wait(300);
}

async function touchSwipe(client, fromX, fromY, toX, toY, steps = 8) {
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: fromX, y: fromY, radiusX: 1, radiusY: 1, force: 1, id: 1 }]
  });

  for (let index = 1; index <= steps; index += 1) {
    const progress = index / steps;
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{
        x: fromX + (toX - fromX) * progress,
        y: fromY + (toY - fromY) * progress,
        radiusX: 1,
        radiusY: 1,
        force: 1,
        id: 1
      }]
    });
    await wait(16);
  }

  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: []
  });
  await wait(350);
}

const CHROME_BIN = await detectChromeBinary();
const profileDir = await mkdtemp(path.join(tmpdir(), "tikpal-chrome-"));
const interactionSceneVideoSrc = await prepareInteractionSceneFixture();
await resetInteractionRoomExperience();
const chrome = spawn(CHROME_BIN, [
  "--headless=new",
  "--disable-gpu=false",
  "--enable-webgl",
  "--ignore-gpu-blocklist",
  "--autoplay-policy=no-user-gesture-required",
  `--remote-debugging-port=${DEVTOOLS_PORT}`,
  `--user-data-dir=${profileDir}`,
  "--window-size=2560,720",
  APP_URL
]);

let client;
try {
  const browserWsUrl = await waitForDevTools();
  const pageWsUrl = await getPageWebSocket(browserWsUrl);
  client = new CdpClient(pageWsUrl);
  await client.open();
  await client.send("Page.enable");
  await client.send("Runtime.enable");

  await navigate(client, APP_URL);
  await expect(client, "document.querySelector('.ambient-screen') !== null", "ambient root renders");
  await expect(
    client,
    "document.querySelectorAll('.startup-mode-grid button').length === 4 && [...document.querySelectorAll('.startup-mode-grid button')].some((node) => node.textContent?.includes('Hi-Fi'))",
    "startup mode chooser renders Focus, Calm, Sleep, and Hi-Fi"
  );
  await expect(
    client,
    "document.querySelector('.startup-mode-heading strong')?.textContent?.trim() === 'Set Your Room Mood'",
    "startup mode chooser uses the requested title"
  );
  await expect(
    client,
    `
      (() => {
        const labels = [...document.querySelectorAll('.startup-mode-grid button')].map((button) => button.textContent?.trim());
        return labels.some((label) => label === 'FocusDeep work & reading')
          && labels.some((label) => label === 'CalmUnwind & relax')
          && labels.some((label) => label === 'SleepDim, timer, fade-out')
          && labels.some((label) => label === 'Hi-FiPure music listening')
          && document.querySelector('.startup-mode-grid button em') === null;
      })()
    `,
    "startup mode cards use the simplified copy"
  );
  const startupDefaultMode = await evaluate(client, "document.querySelector('.startup-mode-grid button.is-active')?.getAttribute('data-startup-mode') ?? 'calm'");
  await wait(5200);
  await expectEventually(
    client,
    `document.querySelector('.startup-mode-chooser') === null && document.querySelector('.ambient-screen')?.getAttribute('data-room-mode') === ${JSON.stringify(startupDefaultMode)}`,
    "startup mode chooser defaults to the persisted room mode after 5 seconds"
  );
  await evaluate(
    client,
    `
      (() => {
        const button = [...document.querySelectorAll('.ambient-room-mode-buttons button')]
          .find((node) => node.textContent?.trim() === 'Hi-Fi');
        button?.click();
        return Boolean(button);
      })()
    `
  );
  await expectEventually(
    client,
    "document.querySelector('[data-hifi-now-playing][data-hifi-centered-now-playing]') !== null && document.querySelector('[data-hifi-cover-art]') !== null && document.querySelector('[data-hifi-track-info]') !== null && document.querySelector('[data-hifi-eq-visual]') === null && document.querySelector('[data-spectrum-band]') === null && document.querySelector('video.flame-video.is-active') === null && document.querySelector('.ambient-screen')?.getAttribute('data-room-mode') === 'hifi'",
    "Hi-Fi room mode renders centered cover and track info without EQ display"
  );
  await expect(
    client,
    `
      (() => {
        const labels = [...document.querySelectorAll('.ambient-transport button')].map((button) => button.getAttribute('aria-label'));
        return labels.includes('Choose audio source')
          && !labels.includes('Previous Hi-Fi EQ preset')
          && !labels.includes('Next Hi-Fi EQ preset')
          && document.querySelector('.ambient-transport-scene-next') === null;
      })()
    `,
    "Hi-Fi ambient transport exposes source selection and no EQ preset controls"
  );
  await evaluate(client, "document.querySelector('[data-ambient-source-toggle]')?.click()");
  await expectEventually(
    client,
    "document.querySelectorAll('[data-ambient-source-picker] [data-ambient-source-option]').length === 6",
    "Hi-Fi source picker opens six source choices"
  );
  await wait(5200);
  await expectEventually(client, "document.querySelector('[data-ambient-source-picker]') === null", "Hi-Fi source picker auto-closes after 5 seconds");
  await evaluate(client, "document.querySelector('[data-ambient-source-toggle]')?.click()");
  await expectEventually(client, "document.querySelector('[data-ambient-source-option=\"radio\"]') !== null", "Hi-Fi source picker exposes Radio");
  await evaluate(client, "document.querySelector('[data-ambient-source-option=\"radio\"]')?.click()");
  await expectEventuallyEvaluate(
    client,
    "fetch('/api/v1/system/state').then((response) => response.json()).then((state) => state.audio.currentSource.id === 'radio' && state.playback.source === 'radio')",
    "Hi-Fi source picker switches immediately to Radio"
  );
  await expect(
    client,
    "document.querySelector('.ambient-transport [data-hifi-playlist-entry][aria-label=\"Open playlist\"]') !== null",
    "Hi-Fi ambient transport exposes playlist entry"
  );
  await evaluate(
    client,
    `
      (() => {
        const target = document.querySelector('.ambient-transport [data-hifi-playlist-entry]');
        target?.click();
        return Boolean(target);
      })()
    `
  );
  await expectEventually(client, "document.querySelector('.playlist-overlay.is-active') !== null", "Hi-Fi ambient playlist entry opens playlist page");
  await evaluate(client, "document.querySelector('.overlay-backdrop')?.click();");
  await expectEventually(client, "document.querySelector('.ambient-screen')?.getAttribute('data-room-mode') === 'hifi' && document.querySelector('.playlist-overlay.is-active') === null", "Hi-Fi ambient playlist entry returns to Ambient after backdrop");
  await navigate(client, `${APP_URL}?mode=quickMenu`);
  await expect(client, "document.querySelector('[data-quick-menu-toggle=\"hifi-eq\"]') === null", "quick menu omits Hi-Fi EQ visibility toggle");
  await evaluate(client, "document.querySelector('.overlay-backdrop')?.click();");
  await expectEventually(
    client,
    "document.querySelector('[data-hifi-now-playing]') !== null && document.querySelector('[data-hifi-eq-visual]') === null && document.querySelector('[data-spectrum-band]') === null && document.querySelector('.hifi-eq-summary') === null",
    "Hi-Fi EQ display stays hidden"
  );
  await expect(client, "document.querySelector('.ambient-screen.is-hud-visible') !== null", "ambient HUD starts visible");
  await expect(client, "document.querySelector('.ambient-hud[data-room-mode]') !== null", "ambient HUD exposes room mode state");
  await expect(client, "document.querySelector('.ambient-room-beacon') === null", "ambient top-left mood card is removed");
  await expect(
    client,
    "document.querySelectorAll('.ambient-room-mode-buttons button').length === 4 && document.querySelector('.ambient-room-mode-buttons button[aria-pressed=\"true\"]') !== null",
    "ambient bottom overlay renders only Focus, Calm, Sleep, and Hi-Fi mood controls"
  );
  for (const [label, expectedMode] of [["Focus", "focus"], ["Calm", "calm"], ["Sleep", "sleep"]]) {
    const point = await evaluate(
      client,
      `
        (() => {
          const button = [...document.querySelectorAll('.ambient-room-mode-buttons button')]
            .find((node) => node.textContent?.trim() === ${JSON.stringify(label)});
          const rect = button?.getBoundingClientRect();
          return rect ? { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) } : null;
        })()
      `
    );
    if (!point) throw new Error(`Failed: ${label} room mode button is missing`);
    await click(client, point.x, point.y);
    await expectEventually(
      client,
      `
        document.querySelector('.ambient-screen')?.getAttribute('data-room-mode') === ${JSON.stringify(expectedMode)}
        && document.querySelector('.ambient-room-mode-buttons button[aria-pressed="true"]')?.textContent?.trim() === ${JSON.stringify(label)}
        && document.querySelector('.ambient-room-beacon') === null
      `,
      `ambient ${label} room mode click updates visible state`
    );
  }
  await evaluate(
    client,
    `
      (() => {
        const button = [...document.querySelectorAll('.ambient-room-mode-buttons button')]
          .find((node) => node.textContent?.trim() === 'Calm');
        button?.click();
        return Boolean(button);
      })()
    `
  );
  await expectEventually(client, "document.querySelector('.ambient-screen')?.getAttribute('data-room-mode') === 'calm'", "ambient returns to Calm before scene-video checks");
  await expect(client, "document.querySelector('[data-ambient-lyrics]') !== null", "ambient lyrics layer renders");
  await expect(
    client,
    `
      (() => {
        const ambient = document.querySelector('.ambient-screen');
        if (!ambient) return false;
        const rangeInputs = [...ambient.querySelectorAll('input[type="range"]')];
        return ambient.querySelector('.ambient-cover') === null
          && ambient.querySelector('.ambient-track') === null
          && ambient.querySelector('.ambient-status') === null
          && ambient.querySelector('.ambient-progress') === null
          && ambient.querySelector('.progress-slider') === null
          && rangeInputs.length === 0;
      })()
    `,
    "ambient mood overlay omits music metadata and seek controls"
  );

  await wait(5600);
  await expect(client, "document.querySelector('.ambient-screen.is-hud-hidden') !== null", "ambient HUD auto hides after startup");

  await click(client, 1280, 280);
  await expect(client, "document.querySelector('.ambient-screen.is-hud-visible') !== null", "single tap shows ambient HUD");
  await expectEventually(
    client,
    "document.querySelectorAll('[data-ambient-source-picker] [data-ambient-source-option]').length === 6",
    "ambient scene single tap opens six source choices"
  );
  await evaluate(client, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true");
  await expectEventually(client, "document.querySelector('[data-ambient-source-picker]') === null", "ambient scene source picker closes with Escape");
  await expect(
    client,
    `
      (() => {
        const transport = document.querySelector('.ambient-transport');
        const labels = [...document.querySelectorAll('.ambient-transport button')].map((button) => button.getAttribute('aria-label'));
        return Boolean(transport)
          && document.querySelector('.ambient-screen')?.getAttribute('data-room-mode') !== 'hifi'
          && labels.includes('Previous scene')
          && labels.includes('Next scene')
          && labels.includes('Choose audio source')
          && (labels.includes('Unmute scene sound') || labels.includes('Mute scene sound'))
          && !labels.includes('Previous track')
          && !labels.includes('Next track')
          && !labels.includes('Play')
          && !labels.includes('Pause')
          && !labels.includes('Favorite')
          && !labels.includes('Remove favorite')
          && !transport.querySelector('.ambient-play-mode');
      })()
    `,
    "ambient non-Hi-Fi transport keeps scene controls plus source selection"
  );
  await evaluate(
    client,
    `
      (() => {
        const originalFetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
          const url = String(input instanceof Request ? input.url : input);
          if (url.includes('/api/v1/media/background-videos')) {
            return Promise.resolve(new Response(JSON.stringify({
              videos: [
                {
                  id: 'interaction-scene',
                  filename: 'Interaction-Scene.mp4',
                  label: 'Interaction Scene',
                  src: ${JSON.stringify(interactionSceneVideoSrc)},
                  roomModes: ['calm'],
                  source: 'scene'
                },
                {
                  id: 'rainy-window',
                  filename: 'Rainy-Window.mp4',
                  label: 'Rainy Window',
                  src: ${JSON.stringify(`${interactionSceneVideoSrc}?ota=rainy`)},
                  order: 30,
                  roomModes: ['calm'],
                  source: 'scene'
                },
                {
                  id: 'focus-smoke-scene',
                  filename: 'Focus-Smoke.mp4',
                  label: 'Focus Smoke',
                  src: ${JSON.stringify(`${interactionSceneVideoSrc}?ota=focus`)},
                  order: 40,
                  roomModes: ['focus'],
                  source: 'scene'
                }
              ],
              total: 3,
              updatedAt: new Date().toISOString(),
              catalogVersion: 'interaction-rainy',
              defaultVideoId: 'interaction-scene'
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }));
          }
          return originalFetch(input, init);
        };
        window.dispatchEvent(new Event('tikpal:background-videos-refresh'));
        return true;
      })()
    `
  );
  await expectEventually(client, "!document.querySelector('.ambient-transport-scene-next')?.disabled", "ambient scene catalog refresh enables OTA scene navigation");
  await evaluate(
    client,
    `
      (() => {
        document.querySelector('.ambient-transport-scene-next')?.click();
        return true;
      })()
    `
  );
  await expectEventually(client, "[...document.querySelectorAll('.flame-video')].some((video) => video.getAttribute('src')?.includes('ota=rainy'))", "ambient can mount OTA scene video after catalog refresh");
  await evaluate(
    client,
    `
      (() => {
        const button = [...document.querySelectorAll('.ambient-room-mode-buttons button')]
          .find((node) => node.textContent?.trim() === 'Focus');
        button?.click();
        return Boolean(button);
      })()
    `
  );
  await expectEventually(
    client,
    `
      document.querySelector('.ambient-screen')?.getAttribute('data-room-mode') === 'focus'
      && [...document.querySelectorAll('.flame-video')].some((video) => video.getAttribute('src')?.includes('ota=focus'))
      && ![...document.querySelectorAll('.flame-video.is-active')].some((video) => video.getAttribute('src')?.includes('ota=rainy'))
    `,
    "room mode scene switching stays inside the selected MP4 category"
  );

  await wait(5600);
  await expect(client, "document.querySelector('.ambient-screen.is-hud-hidden') !== null", "ambient HUD auto hides after tap show");

  await wheel(client, 220);
  await expectEventually(client, "document.querySelector('.playlist-overlay.is-active') !== null", "ambient wheel down opens playlist");

  await navigate(client, `${APP_URL}?mode=playlist`);
  await expect(client, "document.querySelector('.playlist-overlay.is-active [data-playlist-page]') !== null", "playlist direct mode renders");
  await expectEventually(
    client,
    "document.querySelector('[data-playlist-left]') !== null && document.querySelector('[data-playlist-library]') !== null && document.querySelector('[data-playlist-actions]') !== null",
    "playlist hub renders three touch columns"
  );
  await expect(
    client,
    "document.querySelector('.playlist-search-field input[placeholder=\"Search playlists / songs...\"]') !== null",
    "playlist hub exposes search in header"
  );
  await expect(
    client,
    "document.querySelector('.playlist-room-rituals[data-room-mode]') !== null && document.querySelector('.playlist-room-mode-grid button[aria-pressed=\"true\"]') !== null",
    "playlist hub exposes scene library ritual mode controls"
  );
  await expect(
    client,
    "!document.body.textContent.includes('Touch Mode') && !document.body.textContent.includes('Trackpad Debug') && !document.body.textContent.includes('Mouse Debug') && document.querySelector('.playlist-input-mode') === null",
    "playlist header hides touch and pointer debug controls"
  );
  await expect(
    client,
    `
      (() => {
        const layout = document.querySelector('.playlist-hub-layout');
        const left = document.querySelector('[data-playlist-left]');
        const library = document.querySelector('[data-playlist-library]');
        const actions = document.querySelector('[data-playlist-actions]');
        if (!layout || !left || !library || !actions) return false;
        const widths = [left, library, actions].map((node) => node.getBoundingClientRect().width);
        return layout.getAttribute('data-layout-focus') === 'library'
          && widths[0] >= 540
          && widths[1] >= 1000
          && widths[2] >= 540
          && document.documentElement.scrollWidth <= window.innerWidth + 1;
      })()
    `,
    "playlist browse layout focuses library while all columns remain readable"
  );
  await expect(
    client,
    `
      (() => {
        const controls = [...document.querySelectorAll('.playlist-touch-icon, .playlist-primary-button, .playlist-secondary-button, .playlist-danger-button, .playlist-action-button')];
        return controls.length > 0 && controls.every((control) => {
          const rect = control.getBoundingClientRect();
          return rect.width >= 56 && rect.height >= 56;
        });
      })()
    `,
    "playlist primary controls keep 56px touch targets"
  );
  const playlistScrollPoint = await evaluate(
    client,
    `
      (() => {
        const scroller = document.querySelector('.playlist-library-scroll');
        const rect = scroller?.getBoundingClientRect();
        if (!rect) return null;
        return {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + Math.min(rect.height - 24, 120))
        };
      })()
    `
  );
  if (!playlistScrollPoint) throw new Error("Failed: playlist library scroll area is missing");
  await wheelAt(client, playlistScrollPoint.x, playlistScrollPoint.y, 0, -260);
  await expect(
    client,
    `
      (() => {
        const overlay = document.querySelector('.playlist-overlay.is-active');
        const layout = document.querySelector('.playlist-hub-layout');
        return Boolean(overlay)
          && layout?.getAttribute('data-layout-focus') === 'library'
          && document.documentElement.scrollWidth <= window.innerWidth + 1;
      })()
    `,
    "playlist vertical trackpad scroll stays inside hub without closing or overflowing"
  );
  await clickButtonContaining(client, "body", "New Playlist");
  await expectEventually(client, "document.querySelector('[data-playlist-mode=\"create\"]') !== null", "playlist new playlist opens create flow");
  await expect(
    client,
    `
      (() => {
        const layout = document.querySelector('.playlist-hub-layout');
        const left = document.querySelector('[data-playlist-left]');
        const library = document.querySelector('[data-playlist-library]');
        const actions = document.querySelector('[data-playlist-actions]');
        if (!layout || !left || !library || !actions) return false;
        const widths = [left, library, actions].map((node) => node.getBoundingClientRect().width);
        return layout.getAttribute('data-layout-focus') === 'actions'
          && widths[0] >= 540
          && widths[1] >= 540
          && widths[2] >= 1000;
      })()
    `,
    "playlist task layout focuses actions while side columns remain readable"
  );
  const playlistSmokeName = `Touch Smoke ${Date.now().toString(36).slice(-5)}`;
  const playlistRenamedName = `${playlistSmokeName} Renamed`;
  await evaluate(client, `window.__playlistSmoke = { name: ${JSON.stringify(playlistSmokeName)}, renamedName: ${JSON.stringify(playlistRenamedName)} }`);
  await setInputValue(client, '[data-playlist-mode="create"] input', playlistSmokeName);
  await clickButtonContaining(client, '[data-playlist-mode="create"]', "Next");
  await expectEventually(client, "document.querySelector('[data-playlist-mode=\"create\"]')?.textContent?.includes('Step 2 of 3')", "playlist create advances to mood step");
  await clickButtonContaining(client, '[data-playlist-mode="create"]', "Sleep");
  await clickButtonContaining(client, '[data-playlist-mode="create"]', "Next");
  await expectEventually(client, "document.querySelector('[data-playlist-mode=\"create\"]')?.textContent?.includes('Step 3 of 3')", "playlist create advances to add songs step");
  await expectEventually(client, "document.querySelectorAll('[data-playlist-mode=\"create\"] .playlist-song-row').length >= 2", "playlist create shows local songs from real library");
  await evaluate(
    client,
    `
      (() => {
        const rows = [...document.querySelectorAll('[data-playlist-mode="create"] .playlist-song-row')].slice(0, 2);
        rows.forEach((row) => row.click());
        return rows.length === 2;
      })()
    `
  );
  await expectEventually(client, "document.querySelectorAll('[data-playlist-mode=\"create\"] .playlist-song-row.is-selected').length >= 2", "playlist create selects songs before submit");
  await clickButtonContaining(client, '[data-playlist-mode="create"]', "Create Playlist");
  await expectEventually(client, "document.querySelector('[data-playlist-mode=\"created\"]') !== null", "playlist create completes with created state");
  await expectEventuallyEvaluate(
    client,
    `
      fetch('/api/v1/audio/playlists').then((response) => response.json()).then((payload) => {
        const selectedId = document.querySelector('.playlist-card.is-selected')?.getAttribute('data-playlist-card');
        const playlist = payload.playlists.find((item) => item.id === selectedId && item.name === window.__playlistSmoke.name);
        if (!playlist || playlist.trackCount !== 2) return false;
        window.__playlistSmoke.originalId = playlist.id;
        window.__playlistSmoke.trackCount = playlist.trackCount;
        return true;
      })
    `,
    "playlist create persists selected songs through API"
  );
  await clickButtonContaining(client, '[data-playlist-mode="created"]', "Keep Editing");
  await expectEventually(client, "document.querySelector('[data-playlist-mode=\"actions\"]') !== null", "playlist created item returns to actions");
  await expect(
    client,
    "document.querySelector('[data-playlist-actions]')?.textContent?.includes('Add Songs') && document.querySelector('[data-playlist-actions]')?.textContent?.includes('Duplicate')",
    "playlist actions expose touch task entries"
  );
  await expectEventually(client, "document.querySelectorAll('[data-playlist-left] .playlist-song-row').length >= 2", "playlist selected songs render in current column");
  await evaluate(
    client,
    `
      (() => {
        const rows = [...document.querySelectorAll('[data-playlist-left] .playlist-song-row')];
        window.__playlistSmoke.secondTrackTitle = rows[1]?.querySelector('strong')?.textContent?.trim();
        rows[1]?.click();
        return Boolean(window.__playlistSmoke.secondTrackTitle);
      })()
    `
  );
  await expectEventuallyEvaluate(
    client,
    "fetch('/api/v1/system/state').then((response) => response.json()).then((state) => state.playback.title === window.__playlistSmoke.secondTrackTitle && state.playback.currentTrackIndex === 2)",
    "playlist song row click plays the requested song"
  );
  await clickButtonContaining(client, '[data-playlist-mode="actions"]', "Add Songs");
  await expectEventually(
    client,
    "document.querySelector('[data-playlist-mode=\"addSongs\"]')?.textContent?.includes('Local Library') && document.querySelector('[data-playlist-mode=\"addSongs\"]')?.textContent?.includes('AI Generated Tracks')",
    "playlist add songs exposes real and unavailable source buckets"
  );
  await evaluate(
    client,
    `
      (() => {
        const row = document.querySelector('[data-playlist-mode="addSongs"] .playlist-song-row');
        row?.click();
        return Boolean(row);
      })()
    `
  );
  await expectEventually(client, "document.querySelector('[data-playlist-mode=\"addSongs\"] .playlist-song-row.is-selected') !== null", "playlist add songs selects a real track");
  await clickButtonContaining(client, '[data-playlist-mode="addSongs"]', "Done");
  await expectEventually(client, "document.querySelector('[data-playlist-mode=\"actions\"]') !== null", "playlist add songs done returns to actions");
  await expectEventuallyEvaluate(
    client,
    `
      fetch('/api/v1/audio/playlists').then((response) => response.json()).then((payload) => {
        const playlist = payload.playlists.find((item) => item.id === window.__playlistSmoke.originalId);
        if (!playlist || playlist.trackCount !== 3) return false;
        window.__playlistSmoke.trackCount = playlist.trackCount;
        return true;
      })
    `,
    "playlist add songs done saves replace_tracks through API"
  );
  await clickButtonContaining(client, '[data-playlist-mode="actions"]', "Reorder Songs");
  await expectEventually(client, "document.querySelector('[data-playlist-mode=\"reorderSongs\"]') !== null", "playlist reorder task opens");
  await evaluate(
    client,
    `
      fetch('/api/v1/audio/playlists').then((response) => response.json()).then((payload) => {
        const playlist = payload.playlists.find((item) => item.id === window.__playlistSmoke.originalId);
        window.__playlistSmoke.reorderFirstPath = playlist?.tracks[0]?.path;
        window.__playlistSmoke.reorderSecondPath = playlist?.tracks[1]?.path;
        return true;
      })
    `
  );
  const reorderPoints = await evaluate(
    client,
    `
      (() => {
        const rows = [...document.querySelectorAll('[data-playlist-mode="reorderSongs"] .playlist-reorder-row')];
        if (rows.length < 2) return null;
        const first = rows[0].getBoundingClientRect();
        const second = rows[1].getBoundingClientRect();
        return {
          fromX: Math.round(first.left + first.width / 2),
          fromY: Math.round(first.top + first.height / 2),
          toX: Math.round(second.left + second.width / 2),
          toY: Math.round(second.top + second.height / 2)
        };
      })()
    `
  );
  if (!reorderPoints) throw new Error("Failed: playlist reorder rows are missing");
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: reorderPoints.fromX, y: reorderPoints.fromY, button: "left", buttons: 1, clickCount: 1 });
  await wait(650);
  for (let step = 1; step <= 8; step += 1) {
    const progress = step / 8;
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: reorderPoints.fromX + (reorderPoints.toX - reorderPoints.fromX) * progress,
      y: reorderPoints.fromY + (reorderPoints.toY - reorderPoints.fromY) * progress,
      button: "left",
      buttons: 1
    });
    await wait(35);
  }
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: reorderPoints.toX, y: reorderPoints.toY, button: "left", clickCount: 1 });
  await wait(250);
  await clickButtonContaining(client, '[data-playlist-mode="reorderSongs"]', "Done");
  await expectEventually(client, "document.querySelector('[data-playlist-mode=\"actions\"]') !== null", "playlist reorder done returns to actions");
  await expectEventuallyEvaluate(
    client,
    `
      fetch('/api/v1/audio/playlists').then((response) => response.json()).then((payload) => {
        const playlist = payload.playlists.find((item) => item.id === window.__playlistSmoke.originalId);
        return playlist?.tracks[0]?.path === window.__playlistSmoke.reorderSecondPath
          && playlist?.tracks[1]?.path === window.__playlistSmoke.reorderFirstPath;
      })
    `,
    "playlist reorder done saves new order through API"
  );
  await clickButtonContaining(client, '[data-playlist-mode="actions"]', "Rename");
  await expectEventually(client, "document.querySelector('[data-playlist-mode=\"rename\"]') !== null", "playlist rename task opens");
  await setInputValue(client, '[data-playlist-mode="rename"] input', playlistRenamedName);
  await clickButtonContaining(client, '[data-playlist-mode="rename"]', "Save");
  await expectEventuallyEvaluate(
    client,
    `
      fetch('/api/v1/audio/playlists').then((response) => response.json()).then((payload) => {
        const playlist = payload.playlists.find((item) => item.id === window.__playlistSmoke.originalId);
        return playlist?.name === window.__playlistSmoke.renamedName;
      })
    `,
    "playlist rename save persists through API"
  );
  await clickButtonContaining(client, '[data-playlist-mode="actions"]', "Change Cover");
  await expectEventually(client, "document.querySelector('[data-playlist-mode=\"changeCover\"]') !== null", "playlist cover task opens");
  await clickButtonContaining(client, '[data-playlist-mode="changeCover"]', "Fireplace");
  await clickButtonContaining(client, '[data-playlist-mode="changeCover"]', "Save");
  await expectEventuallyEvaluate(
    client,
    `
      fetch('/api/v1/audio/playlists').then((response) => response.json()).then((payload) => {
        const playlist = payload.playlists.find((item) => item.id === window.__playlistSmoke.originalId);
        return playlist?.coverType === 'scene' && playlist?.coverValue === 'fireplace';
      })
    `,
    "playlist cover save persists through API"
  );
  const cardSwipePoints = await evaluate(
    client,
    `
      (() => {
        const card = document.querySelector('.playlist-card.is-selected');
        card?.scrollIntoView({ block: 'center' });
        const rect = card?.getBoundingClientRect();
        if (!rect) return null;
        return {
          fromX: Math.round(rect.right - 34),
          fromY: Math.round(rect.top + rect.height / 2),
          toX: Math.round(rect.left + 80),
          toY: Math.round(rect.top + rect.height / 2)
        };
      })()
    `
  );
  if (!cardSwipePoints) throw new Error("Failed: selected playlist card is missing");
  await drag(client, cardSwipePoints.fromX, cardSwipePoints.fromY, cardSwipePoints.toX, cardSwipePoints.toY);
  await expectEventually(
    client,
    "document.querySelector('.playlist-card.has-actions .playlist-card-swipe-actions')?.textContent?.includes('Edit') && document.querySelector('.playlist-card.has-actions .playlist-card-swipe-actions')?.textContent?.includes('Duplicate') && document.querySelector('.playlist-card.has-actions .playlist-card-swipe-actions')?.textContent?.includes('Delete')",
    "playlist card left swipe reveals edit duplicate delete"
  );
  const clearedCardSwipe = await evaluate(
    client,
    `
      (() => {
        const button = document.querySelector('.playlist-card.is-selected .playlist-card-main');
        button?.click();
        button?.click();
        return Boolean(button);
      })()
    `
  );
  if (!clearedCardSwipe) throw new Error("Failed: selected playlist card main button is missing");
  await expectEventually(client, "document.querySelector('.playlist-card.has-actions') === null", "playlist card swipe can be cleared by selecting the card");
  const cardTrackpadPoint = await evaluate(
    client,
    `
      (() => {
        const card = document.querySelector('.playlist-card.is-selected');
        card?.scrollIntoView({ block: 'center' });
        const rect = card?.getBoundingClientRect();
        if (!rect) return null;
        return {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2)
        };
      })()
    `
  );
  if (!cardTrackpadPoint) throw new Error("Failed: selected playlist card is missing for trackpad swipe");
  await wheelAt(client, cardTrackpadPoint.x, cardTrackpadPoint.y, -240, 0);
  await expectEventually(
    client,
    "document.querySelector('.playlist-card.has-actions .playlist-card-swipe-actions')?.textContent?.includes('Edit') && document.querySelector('.playlist-card.has-actions .playlist-card-swipe-actions')?.textContent?.includes('Duplicate') && document.querySelector('.playlist-card.has-actions .playlist-card-swipe-actions')?.textContent?.includes('Delete')",
    "playlist card trackpad left swipe reveals edit duplicate delete"
  );
  await clickButtonContaining(client, '.playlist-card.has-actions .playlist-card-swipe-actions', "Duplicate");
  await expectEventuallyEvaluate(
    client,
    `
      fetch('/api/v1/audio/playlists').then((response) => response.json()).then((payload) => {
        const duplicate = payload.playlists.find((item) => item.name === window.__playlistSmoke.renamedName + ' Copy');
        if (!duplicate || duplicate.trackCount !== 3 || duplicate.coverType !== 'scene') return false;
        window.__playlistSmoke.duplicateId = duplicate.id;
        return document.querySelector('.playlist-card.is-selected')?.getAttribute('data-playlist-card') === duplicate.id;
      })
    `,
    "playlist duplicate creates and selects an editable copy"
  );
  const longPressPoints = await evaluate(
    client,
    `
      (() => {
        const card = document.querySelector('.playlist-card.is-selected');
        card?.scrollIntoView({ block: 'center' });
        const rect = card?.getBoundingClientRect();
        if (!rect) return null;
        return {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2)
        };
      })()
    `
  );
  if (!longPressPoints) throw new Error("Failed: duplicate playlist card is missing");
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: longPressPoints.x, y: longPressPoints.y, button: "left", buttons: 1, clickCount: 1 });
  await wait(650);
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: longPressPoints.x, y: longPressPoints.y, button: "left", clickCount: 1 });
  await wait(250);
  await expectEventually(client, "document.querySelector('.playlist-card.has-actions .playlist-card-swipe-actions') !== null", "playlist card long press opens quick actions");
  await expectEventually(client, "document.querySelectorAll('[data-playlist-left] .playlist-song-row').length >= 3", "playlist duplicate keeps songs visible");
  const rowSwipePoints = await evaluate(
    client,
    `
      (() => {
        const row = document.querySelector('[data-playlist-left] .playlist-song-row');
        const rect = row?.getBoundingClientRect();
        if (!rect) return null;
        return {
          fromX: Math.round(rect.right - 24),
          fromY: Math.round(rect.top + rect.height / 2),
          toX: Math.round(rect.left + 80),
          toY: Math.round(rect.top + rect.height / 2)
        };
      })()
    `
  );
  if (!rowSwipePoints) throw new Error("Failed: playlist song row is missing");
  await drag(client, rowSwipePoints.fromX, rowSwipePoints.fromY, rowSwipePoints.toX, rowSwipePoints.toY);
  await expectEventually(
    client,
    "document.querySelector('.playlist-song-row-wrap.has-actions .playlist-song-swipe-actions')?.textContent?.includes('Remove') && document.querySelector('.playlist-song-row-wrap.has-actions .playlist-song-swipe-actions')?.textContent?.includes('More')",
    "playlist song left swipe reveals remove and more"
  );
  await clickButtonContaining(client, '.playlist-song-row-wrap.has-actions .playlist-song-swipe-actions', "More");
  await expectEventually(client, "document.querySelector('[data-playlist-mode=\"removeSongs\"]') !== null", "playlist song more opens remove task");
  await evaluate(
    client,
    `
      (() => {
        document.querySelector('[data-playlist-mode="removeSongs"] .playlist-touch-icon')?.click();
        return true;
      })()
    `
  );
  await expectEventually(client, "document.querySelector('[data-playlist-mode=\"actions\"]') !== null", "playlist remove task back returns to actions");
  const rowTrackpadPoint = await evaluate(
    client,
    `
      (() => {
        const row = document.querySelector('[data-playlist-left] .playlist-song-row');
        const rect = row?.getBoundingClientRect();
        if (!rect) return null;
        return {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2)
        };
      })()
    `
  );
  if (!rowTrackpadPoint) throw new Error("Failed: playlist song row is missing for trackpad swipe");
  await wheelAt(client, rowTrackpadPoint.x, rowTrackpadPoint.y, -220, 0);
  await expectEventually(
    client,
    "document.querySelector('.playlist-song-row-wrap.has-actions .playlist-song-swipe-actions')?.textContent?.includes('Remove') && document.querySelector('.playlist-song-row-wrap.has-actions .playlist-song-swipe-actions')?.textContent?.includes('More')",
    "playlist song trackpad left swipe reveals remove and more"
  );
  await clickButtonContaining(client, '.playlist-song-row-wrap.has-actions .playlist-song-swipe-actions', "Remove");
  await expectEventuallyEvaluate(
    client,
    `
      fetch('/api/v1/audio/playlists').then((response) => response.json()).then((payload) => {
        const duplicate = payload.playlists.find((item) => item.id === window.__playlistSmoke.duplicateId);
        if (!duplicate || duplicate.trackCount !== 2) return false;
        window.__playlistSmoke.trackCount = duplicate.trackCount;
        return true;
      })
    `,
    "playlist row remove saves remove_track through API"
  );
  await clickButtonContaining(client, '[data-playlist-mode="actions"]', "Remove Songs");
  await expectEventually(client, "document.querySelector('[data-playlist-mode=\"removeSongs\"]') !== null", "playlist remove selected task opens");
  await evaluate(
    client,
    `
      (() => {
        const row = document.querySelector('[data-playlist-mode="removeSongs"] .playlist-song-row');
        row?.click();
        return Boolean(row);
      })()
    `
  );
  await expectEventually(client, "document.querySelector('[data-playlist-mode=\"removeSongs\"] .playlist-song-row.is-selected') !== null", "playlist remove selected marks a real song");
  await clickButtonContaining(client, '[data-playlist-mode="removeSongs"]', "Remove Selected");
  await expectEventuallyEvaluate(
    client,
    `
      fetch('/api/v1/audio/playlists').then((response) => response.json()).then((payload) => {
        const duplicate = payload.playlists.find((item) => item.id === window.__playlistSmoke.duplicateId);
        return duplicate?.trackCount === 1;
      })
    `,
    "playlist remove selected saves through API"
  );
  await clickButtonContaining(client, '[data-playlist-mode="actions"]', "Delete Playlist");
  await expectEventually(client, "document.querySelector('[data-playlist-mode=\"confirmDelete\"]') !== null", "playlist delete opens confirmation");
  await clickButtonContaining(client, '[data-playlist-mode="confirmDelete"]', "Delete");
  await expectEventually(client, "document.querySelector('[data-playlist-mode=\"browse\"]') !== null", "playlist delete confirms and returns to empty actions");
  await expectEventuallyEvaluate(
    client,
    `
      fetch('/api/v1/audio/playlists').then((response) => response.json()).then((payload) => (
        !payload.playlists.some((item) => item.id === window.__playlistSmoke.duplicateId)
      ))
    `,
    "playlist delete removes duplicated smoke playlist"
  );
  await evaluate(
    client,
    `
      fetch('/api/v1/audio/playlist-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'delete', playlistId: window.__playlistSmoke.originalId })
      }).then(() => true)
    `
  );
  await drag(client, 1280, 610, 1280, 430);
  await expectEventually(client, "document.querySelector('.playlist-overlay.is-active') === null", "playlist swipe up exits to ambient");

  await navigate(client, `${APP_URL}?mode=playlist`);
  await click(client, 10, 10);
  await expect(client, "document.querySelector('.playlist-overlay.is-active') === null", "playlist backdrop click exits to ambient");

  await evaluate(
    client,
    `
      fetch('/api/v1/experience/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'set_mode', mode: 'calm' })
      }).then(() => true)
    `
  );
  await navigate(client, `${APP_URL}?mode=quickMenu`);
  await expect(client, "document.querySelector('.quick-menu.is-active') !== null", "quick menu opens");
  await expectEventually(client, "document.querySelector('.ambient-screen')?.getAttribute('data-room-mode') === 'calm'", "quick menu scene checks run outside Hi-Fi mode");
  await expect(
    client,
    `
      (() => {
        const text = document.querySelector('.quick-menu-panel')?.textContent ?? '';
        return document.querySelectorAll('.quick-menu-panel [data-quick-menu-toggle]').length === 3
          && text.includes('Scene Video')
          && !text.includes('Room Mode')
          && text.includes('Clock')
          && !text.includes('Hi-Fi EQ')
          && text.includes('Scene Sound')
          && !text.includes('Flame')
          && !text.includes('Screen Off');
      })()
    `,
    "quick menu exposes scene toggles without stale labels"
  );

  await evaluate(
    client,
    `
      (() => {
        document.querySelector('[data-quick-menu-toggle="scene-video"]')?.click();
        return true;
      })()
    `
  );
  await expect(client, "document.querySelector('.flame-scene.is-video-off') !== null", "scene video off makes ambient background black");
  await expect(client, "document.querySelector('.fireplace-backdrop') === null && document.querySelector('.flame-video') === null", "scene video off removes fireplace media layers");
  await expect(client, "document.querySelector('.ambient-clock') !== null", "clock remains independent while scene video is off");

  await evaluate(
    client,
    `
      (() => {
        document.querySelector('[data-quick-menu-toggle="clock"]')?.click();
        return true;
      })()
    `
  );
  await expect(client, "document.querySelector('.ambient-clock') === null", "quick menu clock toggle hides ambient clock");

  await evaluate(
    client,
    `
      (() => {
        document.querySelector('[data-quick-menu-toggle="scene-sound"]')?.click();
        return true;
      })()
    `
  );
  await expectEventually(client, "document.querySelector('[data-quick-menu-toggle=\"scene-sound\"]')?.getAttribute('aria-pressed') === 'true'", "scene sound toggle turns on");
  await expectEventually(
    client,
    `
      (() => {
        const video = document.querySelector('.flame-video.is-active');
        return video instanceof HTMLVideoElement
          && !document.querySelector('.flame-scene.is-video-off')
          && video.muted === false
          && video.paused === false;
      })()
    `,
    "scene sound forces video on and unmutes the active video"
  );
  await expectEventuallyEvaluate(
    client,
    "fetch('/api/v1/system/state').then((response) => response.json()).then((state) => state.playback.source === 'scene' && state.playback.state === 'playing')",
    "scene sound switches API source to scene"
  );
  await expectEventually(
    client,
    `
      (() => {
        const video = document.querySelector('.flame-video[data-flame-layer="active"][data-flame-loop-role="active"]');
        const standby = [...document.querySelectorAll('.flame-video[data-flame-layer="active"]')]
          .find((node) => node.getAttribute('data-flame-loop-role') === 'parked');
        return video instanceof HTMLVideoElement
          && standby instanceof HTMLVideoElement
          && Number.isFinite(video.duration)
          && video.duration >= 2
          && video.readyState >= 1
          && video.loop === false
          && standby.loop === false
          && standby.muted === true
          && standby.getAttribute('data-flame-audio-slot') === 'standby'
          && standby.getAttribute('data-flame-frame-ready') === 'false'
          && standby.getAttribute('data-flame-loop-phase') === 'parked'
          && getComputedStyle(standby).opacity === '0';
      })()
    `,
    "dual scene loop slots are ready without native loop"
  );
  await evaluate(
    client,
    `
      (() => {
        const videos = [...document.querySelectorAll('.flame-video[data-flame-layer="active"]')];
        const video = videos.find((node) => node.getAttribute('data-flame-loop-role') === 'active');
        if (!(video instanceof HTMLVideoElement) || !Number.isFinite(video.duration)) return false;
        window.__tikpalLoopStartSlot = video.getAttribute('data-flame-slot-index');
        videos.forEach((node) => {
          if (node instanceof HTMLVideoElement) node.playbackRate = 0.25;
        });
        video.currentTime = Math.max(0, video.duration - 0.8);
        video.dispatchEvent(new Event('seeked'));
        video.dispatchEvent(new Event('timeupdate'));
        void video.play();
        return true;
      })()
    `
  );
  await expectEventually(
    client,
    `
      (() => {
        const videos = [...document.querySelectorAll('.flame-video[data-flame-layer="active"]')];
        const standbyVideo = videos.find((video) => video.getAttribute('data-flame-slot-index') !== window.__tikpalLoopStartSlot);
        const readyBeforeHandoff = standbyVideo?.getAttribute('data-flame-loop-role') === 'parked'
          && standbyVideo?.getAttribute('data-flame-loop-phase') === 'ready'
          && !videos.some((video) => ['incoming', 'outgoing'].includes(video.getAttribute('data-flame-loop-role')));
        const alreadyHandoff = standbyVideo?.getAttribute('data-flame-loop-role') === 'incoming'
          && standbyVideo?.getAttribute('data-flame-loop-phase') === 'handoff'
          && videos.some((video) => video.getAttribute('data-flame-loop-role') === 'outgoing');
        return videos.length === 2
          && standbyVideo instanceof HTMLVideoElement
          && standbyVideo.getAttribute('data-flame-frame-ready') === 'true'
          && standbyVideo.muted === true
          && (readyBeforeHandoff || alreadyHandoff);
      })()
    `,
    "standby scene loop slot decodes before handoff completes",
    80,
    75
  );
  await evaluate(
    client,
    `
      (() => {
        const videos = [...document.querySelectorAll('.flame-video[data-flame-layer="active"]')];
        const video = videos.find((node) => node.getAttribute('data-flame-slot-index') === window.__tikpalLoopStartSlot);
        if (!(video instanceof HTMLVideoElement) || !Number.isFinite(video.duration)) return false;
        videos.forEach((node) => {
          if (node instanceof HTMLVideoElement) node.playbackRate = 1;
        });
        video.currentTime = Math.max(0, video.duration - 0.4);
        void video.play();
        video.dispatchEvent(new Event('timeupdate', { bubbles: true }));
        video.dispatchEvent(new Event('seeked', { bubbles: true }));
        return true;
      })()
    `
  );
  await expectEventually(
    client,
    `
      (() => {
        const videos = [...document.querySelectorAll('.flame-video[data-flame-layer="active"]')];
        const outgoing = videos.find((video) => video.getAttribute('data-flame-loop-role') === 'outgoing');
        const incoming = videos.find((video) => video.getAttribute('data-flame-loop-role') === 'incoming');
        const fade = document.querySelector('.flame-video-fade');
        if (!(outgoing instanceof HTMLVideoElement) || !(incoming instanceof HTMLVideoElement) || !(fade instanceof HTMLElement)) return false;
        const audibleVideos = videos.filter((video) => video instanceof HTMLVideoElement && video.muted === false && Number.parseFloat(video.getAttribute('data-scene-volume') ?? '0') > 0);
        const transitionDurations = getComputedStyle(incoming).transitionDuration.split(',').map((duration) => {
          const trimmed = duration.trim();
          return trimmed.endsWith('ms') ? Number.parseFloat(trimmed) : Number.parseFloat(trimmed) * 1000;
        });
        return incoming.getAttribute('data-flame-frame-ready') === 'true'
          && incoming.getAttribute('data-flame-loop-phase') === 'handoff'
          && outgoing.getAttribute('data-flame-loop-phase') === 'handoff'
          && incoming.getAttribute('data-flame-audio-role') === 'crossfade-in'
          && outgoing.getAttribute('data-flame-audio-role') === 'crossfade-out'
          && audibleVideos.length >= 1
          && audibleVideos.length <= 2
          && audibleVideos.every((video) => ['crossfade-in', 'crossfade-out'].includes(video.getAttribute('data-flame-audio-role') ?? ''))
          && Number.parseFloat(getComputedStyle(outgoing).opacity) >= 0.99
          && Number.parseFloat(getComputedStyle(incoming).opacity) >= 0
          && Number.parseFloat(getComputedStyle(incoming).opacity) <= 1
          && transitionDurations.some((duration) => Math.abs(duration - 360) < 2)
          && getComputedStyle(fade).opacity === '0'
          && !document.querySelector('.flame-scene.is-loop-dimming, .flame-scene.is-sound-transitioning');
      })()
    `,
    "dual scene loop starts a ready-gated incoming fade while outgoing stays visible",
    60,
    35
  );

  const loopLumaSamples = [];
  const loopAudioSamples = [];
  for (let index = 0; index < 5; index += 1) {
    loopLumaSamples.push(await sampleLoopVideoLuma(client));
    loopAudioSamples.push(await sampleLoopAudioState(client));
    await wait(55);
  }
  const loopLumas = loopLumaSamples.map((sample) => sample.luma);
  const minLoopLuma = Math.min(...loopLumas);
  const maxLoopLuma = Math.max(...loopLumas);
  if (minLoopLuma < Math.max(40, maxLoopLuma * 0.45)) {
    throw new Error(`Failed: scene loop center luma dropped near black (${loopLumas.map((value) => value.toFixed(1)).join(', ')}; ${loopLumaSamples.map((sample) => sample.roles.join('/')).join(' | ')})`);
  }
  console.log(`ok - scene loop center luma avoids black/transparent drop (${loopLumas.map((value) => value.toFixed(1)).join(', ')})`);
  console.log(`ok - scene loop audio keeps live audible slots (${loopAudioSamples.map((sample) => sample.audibleVideos.map((video) => `${video.audioRole}:${video.currentTime.toFixed(2)}`).join('+')).join(', ')})`);

  await expectEventually(
    client,
    `
      (() => {
        const videos = [...document.querySelectorAll('.flame-video[data-flame-layer="active"]')];
        const activeVideo = videos.find((video) => video.getAttribute('data-flame-loop-role') === 'active');
        const parkedVideo = videos.find((video) => video.getAttribute('data-flame-loop-role') === 'parked');
        return videos.length === 2
          && activeVideo instanceof HTMLVideoElement
          && parkedVideo instanceof HTMLVideoElement
          && activeVideo.getAttribute('data-flame-slot-index') !== window.__tikpalLoopStartSlot
          && activeVideo.getAttribute('data-flame-audio-slot') === 'active'
          && parkedVideo.getAttribute('data-flame-audio-slot') === 'standby'
          && activeVideo.muted === false
          && parkedVideo.muted === true
          && activeVideo.loop === false
          && parkedVideo.loop === false
          && activeVideo.currentTime < 0.8
          && parkedVideo.getAttribute('data-flame-loop-phase') === 'parked'
          && parkedVideo.getAttribute('data-flame-frame-ready') === 'false'
          && !videos.some((video) => ['incoming', 'outgoing'].includes(video.getAttribute('data-flame-loop-role')))
          && document.querySelector('.flame-video-fade') instanceof HTMLElement
          && getComputedStyle(document.querySelector('.flame-video-fade')).opacity === '0';
      })()
    `,
    "dual scene loop completes with one audible active slot and one muted parked slot"
  );
  await expectEventually(
    client,
    `
      (() => {
        const videos = [...document.querySelectorAll('.flame-video[data-flame-layer="active"]')];
        const activeVideos = videos.filter((video) => video.getAttribute('data-flame-audio-slot') === 'active');
        const standbyVideos = videos.filter((video) => video.getAttribute('data-flame-audio-slot') === 'standby');
        const activeVideo = activeVideos[0];
        return videos.length === 2
          && activeVideos.length === 1
          && standbyVideos.length === 1
          && activeVideo instanceof HTMLVideoElement
          && activeVideo.paused === false
          && activeVideo.muted === false
          && standbyVideos.every((video) => video instanceof HTMLVideoElement && video.muted === true)
          && videos.every((video) => video.getAttribute('data-scene-audio-fading') === null);
      })()
    `,
    "scene loop keeps audio on one active layer only"
  );

  await evaluate(
    client,
    `
      (() => {
        document.querySelector('[data-quick-menu-toggle="scene-sound"]')?.click();
        return true;
      })()
    `
  );
  await expectEventually(client, "document.querySelector('[data-quick-menu-toggle=\"scene-sound\"]')?.getAttribute('aria-pressed') === 'false'", "turning scene sound off clears the toggle");
  await expectEventuallyEvaluate(
    client,
    "fetch('/api/v1/system/state').then((response) => response.json()).then((state) => state.audio.currentSource.id === 'mpd' && state.playback.source === 'mpd' && state.playback.state === 'playing')",
    "turning scene sound off resumes library playback"
  );
  await expectEventually(client, "document.querySelector('.flame-video.is-active') instanceof HTMLVideoElement && document.querySelector('.flame-video.is-active').muted === true", "turning scene sound off remutes the active video");

  await evaluate(
    client,
    `
      (() => {
        document.querySelector('[data-quick-menu-toggle="scene-sound"]')?.click();
        return true;
      })()
    `
  );
  await expectEventually(client, "document.querySelector('[data-quick-menu-toggle=\"scene-sound\"]')?.getAttribute('aria-pressed') === 'true'", "scene sound can turn back on before scene video off");
  await expectEventuallyEvaluate(
    client,
    "fetch('/api/v1/system/state').then((response) => response.json()).then((state) => state.playback.source === 'scene' && state.playback.state === 'playing')",
    "scene sound switches API source to scene again"
  );

  await evaluate(
    client,
    `
      (() => {
        document.querySelector('[data-quick-menu-toggle="scene-video"]')?.click();
        return true;
      })()
    `
  );
  await expectEventually(client, "document.querySelector('[data-quick-menu-toggle=\"scene-sound\"]')?.getAttribute('aria-pressed') === 'false'", "turning scene video off first disables scene sound");
  await expect(client, "document.querySelector('.flame-scene.is-video-off') !== null", "scene video off after scene sound returns to black background");
  await expectEventuallyEvaluate(
    client,
    "fetch('/api/v1/system/state').then((response) => response.json()).then((state) => state.audio.currentSource.id === 'mpd' && state.playback.source === 'mpd' && state.playback.state === 'playing')",
    "scene video off resumes library playback"
  );

  await evaluate(
    client,
    `
      (() => {
        document.querySelector('[data-quick-menu-toggle="scene-video"]')?.click();
        document.querySelector('[data-quick-menu-toggle="clock"]')?.click();
        return true;
      })()
    `
  );
  await expect(client, "document.querySelector('.ambient-clock') !== null", "quick menu clock toggle restores ambient clock");
  await evaluate(
    client,
    `
      (() => {
        document.querySelector('[data-quick-menu-toggle="scene-sound"]')?.click();
        return true;
      })()
    `
  );
  await expectEventually(client, "document.querySelector('.flame-video.is-active') instanceof HTMLVideoElement && document.querySelector('.flame-video.is-active').muted === false", "scene sound can be re-enabled before switching sources");
  await evaluate(
    client,
    `
      (() => {
        document.querySelector('.overlay-backdrop')?.click();
        return true;
      })()
    `
  );
  await expectEventually(client, "document.querySelector('.ambient-screen') !== null && document.querySelector('.quick-menu.is-active') === null", "quick menu returns to Ambient before source selection");
  await click(client, 1280, 280);
  await evaluate(client, "document.querySelector('[data-ambient-source-toggle]')?.click()");
  await expectEventually(client, "document.querySelector('[data-ambient-source-option=\"mpd\"]') !== null", "Ambient source picker exposes Library");
  await evaluate(client, "document.querySelector('[data-ambient-source-option=\"mpd\"]')?.click()");
  await expectEventually(client, "document.querySelector('.flame-video.is-active') instanceof HTMLVideoElement && document.querySelector('.flame-video.is-active').muted === true", "Ambient music source switch remutes the active scene video");
  await expectEventuallyEvaluate(
    client,
    "Promise.all([fetch('/api/v1/system/state').then((response) => response.json()), fetch('/api/v1/experience/state').then((response) => response.json())]).then(([state, experience]) => state.audio.currentSource.id === 'mpd' && state.playback.source === 'mpd' && experience.sceneSoundEnabled === false)",
    "Ambient source selection deactivates scene sound and restores Library"
  );

  await navigate(client, `${APP_URL}?mode=player`);
  await click(client, 1360, 600);
  await expect(client, "document.querySelector('.player-overlay.is-active') !== null", "protected player click stays in player");
  await dragUntilHold(client, 100, 600, 100, 540);
  await expect(client, "document.querySelector('.gesture-cue.is-visible') === null", "protected player swipe does not show the global gesture cue");
  await releaseDrag(client, 100, 540);
  await expect(client, "document.querySelector('.player-overlay.is-active') !== null", "short protected player swipe stays in player");
  await dragUntilHold(client, 100, 600, 200, 430, 8);
  await releaseDrag(client, 200, 430);
  await expectEventually(
    client,
    "document.querySelector('.player-overlay.is-active') === null && document.querySelector('.ambient-screen')?.getAttribute('data-room-mode') === 'calm'",
    "slightly angled protected player swipe returns smoothly to Calm ambient"
  );
  await navigate(client, `${APP_URL}?mode=player`);

  await expect(client, "document.querySelector('[data-source-panel]') !== null", "player source panel opens");
  await expectEventuallyEvaluate(
    client,
    `
      fetch('/api/v1/system/state').then((response) => response.json()).then((state) => {
        const title = document.querySelector('.track-stack h1')?.textContent?.trim();
        return Boolean(state.playback.title) && title === state.playback.title;
      })
    `,
    "player now playing title follows playback truth"
  );
  await expect(
    client,
    `
      (() => {
        const expected = ['mpd', 'radio', 'spotify', 'airplay', 'bluetooth', 'upnp'];
        return expected.every((sourceId) => document.querySelector(\`[data-source-item="\${sourceId}"]\`))
          && document.querySelector('[data-source-item="playlist"]') === null
          && document.querySelector('[data-source-item="audio"]') === null;
      })()
    `,
    "player source tabs include six visible source categories"
  );
  await expect(
    client,
    "document.querySelector('.transport-row [data-player-playlist-entry][aria-label=\"Open playlist\"]') !== null && document.querySelector('.library-browser-title [data-player-playlist-entry]') === null",
    "player exposes playlist entry beside transport controls only"
  );
  await evaluate(
    client,
    `
      (() => {
        const target = document.querySelector('.transport-row [data-player-playlist-entry]');
        target?.click();
        return Boolean(target);
      })()
    `
  );
  await expectEventually(client, "document.querySelector('.playlist-overlay.is-active') !== null", "player playlist entry opens playlist page");
  await navigate(client, `${APP_URL}?mode=player`);
  await expect(client, sourceTabExpression("mpd", { selected: true, active: true }), "library source starts selected and active");

  await evaluate(
    client,
    `
      (() => {
        const target = document.querySelector('[data-source-item="bluetooth"]');
        target?.click();
        return Boolean(target);
      })()
    `
  );
  await expectEventually(client, "document.querySelector('.source-line span')?.textContent?.includes('Bluetooth') === true", "single tap on bluetooth source switches source");
  await expectEventually(client, sourceTabExpression("bluetooth", { selected: true, active: true }), "bluetooth source is selected and active after tap");

  await evaluate(
    client,
    `
      (() => {
        const target = document.querySelector('[data-source-item="mpd"]');
        target?.click();
        return Boolean(target);
      })()
    `
  );
  await expectEventually(client, "document.querySelector('.source-line span')?.textContent?.includes('Library') === true", "single tap on library source returns to mpd");
  await expectEventually(client, sourceTabExpression("mpd", { selected: true, active: true }), "library source is selected and active after return");

  await evaluate(
    client,
    `
      (() => {
        const slider = document.querySelector('.progress-slider');
        return slider instanceof HTMLInputElement && !slider.disabled && Number(slider.max) > 0;
      })()
    `
  );
  await expect(client, "document.querySelector('.progress-slider') instanceof HTMLInputElement && !document.querySelector('.progress-slider').disabled && Number(document.querySelector('.progress-slider').max) > 0", "mpd playback renders an enabled seek slider");
  await expect(
    client,
    `
      (() => {
        const slider = document.querySelector('[data-player-volume-slider]');
        return slider instanceof HTMLInputElement
          && slider.type === 'range'
          && slider.min === '0'
          && slider.max === '100'
          && slider.step === '1'
          && document.querySelector('[aria-label="Volume down"]') === null
          && document.querySelector('[aria-label="Volume up"]') === null;
      })()
    `,
    "player volume renders a range slider instead of plus/minus buttons"
  );

  await evaluate(
    client,
    `
      (() => {
        const slider = document.querySelector('[data-player-volume-slider]');
        if (!(slider instanceof HTMLInputElement)) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(slider, '31');
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        slider.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()
    `
  );
  await expectEventually(
    client,
    `
      (() => {
        const slider = document.querySelector('[data-player-volume-slider]');
        const label = document.querySelector('[data-player-volume-percent]');
        return slider instanceof HTMLInputElement
          && Number(slider.value) === 31
          && label?.textContent?.trim() === '31%';
      })()
    `,
    "player volume slider reflects the dragged value"
  );
  await expectEventuallyEvaluate(
    client,
    "fetch('/api/v1/system/state').then((response) => response.json()).then((state) => state.system.volume.percent === 31)",
    "player volume slider updates the global API volume"
  );

  await navigate(client, `${APP_URL}?mode=quickMenu`);
  await evaluate(
    client,
    `
      (() => {
        document.querySelector('[data-quick-menu-toggle="scene-sound"]')?.click();
        return true;
      })()
    `
  );
  await expectEventuallyEvaluate(
    client,
    `
      fetch('/api/v1/system/state').then((response) => response.json()).then((state) => {
        const video = document.querySelector('.flame-video.is-active');
        return state.system.volume.percent === 31
          && video instanceof HTMLVideoElement
          && Math.abs(video.volume - 0.31) < 0.01
          && video.muted === false;
      })
    `,
    "scene video element volume follows the global volume"
  );
  await navigate(client, `${APP_URL}?mode=player`);
  await evaluate(
    client,
    `
      (() => {
        const target = document.querySelector('[data-source-item="mpd"]');
        target?.click();
        return Boolean(target);
      })()
    `
  );
  await expectEventuallyEvaluate(
    client,
    "fetch('/api/v1/system/state').then((response) => response.json()).then((state) => state.playback.source !== 'scene')",
    "music source remains available after scene volume sync"
  );

  for (const [categoryLabel, expectedLabels] of Object.entries({
    Focus: ["Lo-fi / Ambient", "Classical / Piano", "Binaural / Alpha / Theta", "White Noise / Brown Noise"],
    Meditation: ["Guided Meditation", "Breathing", "Singing Bowl", "Nature Sounds"],
    Rest: ["Nap", "Sleep", "Rain / Ocean / Forest", "Deep Sleep Long Tracks"]
  })) {
    await evaluate(
      client,
      `
        (() => {
          const target = [...document.querySelectorAll('.library-category-tab')].find((node) => node.textContent.includes(${JSON.stringify(categoryLabel)}));
          target?.click();
          return Boolean(target);
        })()
      `
    );
    await expectEventually(
      client,
      `
        (() => {
          const container = document.querySelector('.library-subcategory-tabs');
          if (!container) return false;
          const labels = [...document.querySelectorAll('.library-subcategory-tab strong')]
            .map((node) => node.textContent?.trim())
            .filter((label) => label && label !== 'All');
          return container.scrollWidth <= container.clientWidth + 1
            && window.getComputedStyle(container).overflowX !== 'auto'
            && JSON.stringify(labels) === ${JSON.stringify(JSON.stringify(expectedLabels))};
        })()
      `,
      `${categoryLabel.toLowerCase()} subcategory tabs match the curated taxonomy order`,
      20,
      50
    );
  }

  for (const theme of ["warm-gold", "graphite-silver", "ivory-studio"]) {
    await evaluate(client, `window.localStorage.setItem('tikpal.surfaceTheme', ${JSON.stringify(theme)})`);
    await navigate(client, `${APP_URL}?mode=player&surfaceTheme=${theme}`);
    await expect(client, sourceHighlightExpression(theme), `${theme} source highlight states are visually distinct`);
  }

  await expect(
    client,
    "document.querySelector('[aria-label=\"Queue\"]') === null && document.querySelector('[data-queue-panel]') === null",
    "player no longer exposes the inline queue panel"
  );

  await navigate(client, `${APP_URL}?mode=player`);
  await click(client, 10, 10);
  await expect(client, "document.querySelector('.player-overlay.is-active') === null", "backdrop click exits player");

  await navigate(client, `${APP_URL}?mode=quickSettings`);
  await click(client, 1260, 210);
  await expect(client, "document.querySelector('.quick-settings.is-active') !== null", "protected settings click stays in settings");
  await expect(client, "document.querySelector('[data-settings-section=\"output\"]') !== null", "settings defaults to Preferences");
  await expect(
    client,
    `
      (() => {
        const labels = [...document.querySelectorAll('.settings-nav-item span')].map((node) => node.textContent?.trim());
        return labels.join('|') === 'Network|Preferences|System' && !labels.includes('Home');
      })()
    `,
    "settings nav has no Home section"
  );
  await expect(client, settingsSummaryExpression("output", ["Audio Output", "DSP", "Display", "Time & Night", "Font", "Skin", "Lyrics"]), "settings Preferences summary keeps fixed four-column cards");
  await expect(
    client,
    `
      (() => {
        const shell = document.querySelector('.settings-shell');
        const content = document.querySelector('.settings-content');
        return Boolean(shell && content && shell.scrollHeight <= shell.clientHeight && content.scrollHeight <= content.clientHeight);
      })()
    `,
    "settings shell stays within kiosk height"
  );

  await evaluate(
    client,
    `
      (() => {
        const section = [...document.querySelectorAll('.settings-nav-item')].find((node) => node.textContent.includes('Preferences'));
        section?.click();
        return Boolean(section);
      })()
    `
  );
  await expect(client, "document.querySelector('[data-settings-section=\"output\"]') !== null", "settings Preferences section opens");
  await expect(client, "document.querySelector('[data-settings-detail]') === null", "settings Preferences summary stays summary-first");
  await expect(client, settingsSummaryExpression("output", ["Audio Output", "DSP", "Display", "Time & Night", "Font", "Skin", "Lyrics"]), "settings Preferences remains a fixed four-column grid");

  await evaluate(
    client,
    `
      (() => {
        const target = [...document.querySelectorAll('.settings-card-button')].find((node) => node.textContent.includes('Display'));
        target?.click();
        return Boolean(target);
      })()
    `
  );
  await expect(client, "document.querySelector('[data-settings-detail=\"display\"]') !== null", "settings display detail opens");
  await expect(client, "document.querySelector('.display-brightness-panel-detail') !== null", "settings display detail shows brightness controls");
  await expect(
    client,
    `
      (() => {
        const content = document.querySelector('.settings-content');
        return Boolean(content && content.scrollHeight <= content.clientHeight);
      })()
    `,
    "settings display detail stays within kiosk height"
  );

  await evaluate(
    client,
    `
      (() => {
        const target = document.querySelector('.settings-detail-back');
        target?.click();
        return Boolean(target);
      })()
    `
  );
  await expect(client, "document.querySelector('[data-settings-detail]') === null", "settings display detail closes back to summary");

  await evaluate(
    client,
    `
      (() => {
        const target = [...document.querySelectorAll('.settings-card-button')].find((node) => node.textContent.includes('Time & Night'));
        target?.click();
        return Boolean(target);
      })()
    `
  );
  await expect(client, "document.querySelector('[data-settings-detail=\"night\"]') !== null", "settings night detail opens");
  await expect(
    client,
    "document.querySelector('.night-settings-panel select') !== null && document.querySelector('.night-settings-panel input[type=\"time\"]') !== null",
    "settings night detail exposes timezone and time controls"
  );
  await expect(
    client,
    `
      (() => {
        const content = document.querySelector('.settings-content');
        return Boolean(content && content.scrollHeight <= content.clientHeight);
      })()
    `,
    "settings night detail stays within kiosk height"
  );

  await evaluate(
    client,
    `
      (() => {
        const target = document.querySelector('.settings-detail-back');
        target?.click();
        return Boolean(target);
      })()
    `
  );
  await expect(client, "document.querySelector('[data-settings-detail]') === null", "settings night detail closes back to summary");

  await evaluate(
    client,
    `
      (() => {
        const target = [...document.querySelectorAll('.settings-card-button')].find((node) => node.textContent.includes('Font'));
        target?.click();
        return Boolean(target);
      })()
    `
  );
  await expect(client, "document.querySelector('[data-settings-detail=\"font\"]') !== null", "settings font detail opens");
  await expect(
    client,
    "document.querySelectorAll('.font-theme-options-detail .font-theme-option').length >= 6 && document.querySelector('.font-theme-options-detail')?.textContent?.includes('Hardware UI')",
    "settings font detail shows expanded modern font presets"
  );
  await expect(
    client,
    `
      (() => {
        const content = document.querySelector('.settings-content');
        return Boolean(content && content.scrollHeight <= content.clientHeight);
      })()
    `,
    "settings font detail stays within kiosk height"
  );

  await evaluate(
    client,
    `
      (() => {
        const target = document.querySelector('.settings-detail-back');
        target?.click();
        return Boolean(target);
      })()
    `
  );
  await expect(client, "document.querySelector('[data-settings-detail]') === null", "settings font detail closes back to summary");

  await evaluate(
    client,
    `
      (() => {
        const section = [...document.querySelectorAll('.settings-nav-item')].find((node) => node.textContent.includes('System'));
        section?.click();
        return Boolean(section);
      })()
    `
  );
  await expect(client, "document.querySelector('[data-settings-section=\"system\"]') !== null", "settings system section opens");
  await expect(client, settingsSummaryExpression("system", ["Library", "Restart", "Shutdown"]), "settings system summary keeps fixed four-column cards");

  await evaluate(
    client,
    `
      (() => {
        const target = [...document.querySelectorAll('.settings-card-button')].find((node) => node.textContent.includes('Restart'));
        target?.click();
        return Boolean(target);
      })()
    `
  );
  await expect(client, "document.querySelector('.settings-card-button.is-confirming') !== null", "restart requires a confirm step");

  await evaluate(
    client,
    `
      (() => {
        const section = [...document.querySelectorAll('.settings-nav-item')].find((node) => node.textContent.includes('Network'));
        section?.click();
        return Boolean(section);
      })()
    `
  );
  await expect(client, "document.querySelector('[data-settings-section=\"network\"]') !== null", "settings network section opens");
  await expect(client, settingsSummaryExpression("network", ["Network", "System"]), "settings network summary keeps fixed four-column cards");
  await expect(
    client,
    `
      (() => {
        const shell = document.querySelector('.settings-shell');
        const content = document.querySelector('.settings-content');
        return Boolean(shell && content && shell.scrollHeight <= shell.clientHeight && content.scrollHeight <= content.clientHeight);
      })()
    `,
    "settings network summary stays within kiosk height"
  );

  await evaluate(
    client,
    `
      (() => {
        const target = [...document.querySelectorAll('.settings-card')].find((node) => node.textContent.includes('Network'));
        target?.click();
        return Boolean(target);
      })()
    `
  );
  await expect(client, "document.querySelector('.settings-card-button.is-confirming') === null", "confirm state clears when another card is tapped");

  await click(client, 10, 10);
  await expect(client, "document.querySelector('.quick-settings.is-active') === null", "settings backdrop click exits settings");
} finally {
  if (client) {
    await Promise.race([
      client.send("Browser.close").catch(() => undefined),
      wait(1000)
    ]);
    client.close();
  }
  if (chrome.exitCode === null && chrome.signalCode === null) {
    chrome.kill("SIGTERM");
  }
  if (!(await waitForExit(chrome))) {
    chrome.kill("SIGKILL");
    await waitForExit(chrome, 2000);
  }
  await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await rm(INTERACTION_SCENE_FIXTURE_DIR, { recursive: true, force: true });
}

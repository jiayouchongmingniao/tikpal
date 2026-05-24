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
        const videos = [...document.querySelectorAll('.flame-video')];
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
        const videos = [...document.querySelectorAll('.flame-video')];
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

async function wheel(client, deltaY, modifiers = 0) {
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: 1280,
    y: 360,
    deltaX: 0,
    deltaY,
    modifiers
  });
  await wait(350);
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
  await expect(client, "document.querySelector('.ambient-screen.is-hud-visible') !== null", "ambient HUD starts visible");
  await expect(client, "document.querySelector('[data-ambient-lyrics]') !== null", "ambient lyrics layer renders");
  await expect(
    client,
    `
      (() => {
        const ambient = document.querySelector('.ambient-screen');
        if (!ambient) return false;
        const rangeInputs = [...ambient.querySelectorAll('input[type="range"]')];
        return ambient.querySelector('.ambient-progress') !== null
          && ambient.querySelector('.progress-slider') === null
          && rangeInputs.length === 0;
      })()
    `,
    "ambient progress is display-only and has no seek slider"
  );

  await wait(5600);
  await expect(client, "document.querySelector('.ambient-screen.is-hud-hidden') !== null", "ambient HUD auto hides after startup");

  await click(client, 1280, 280);
  await expect(client, "document.querySelector('.ambient-screen.is-hud-visible') !== null", "single tap shows ambient HUD");
  await expect(
    client,
    "document.querySelector('.ambient-transport button[aria-label=\"Favorite\"], .ambient-transport button[aria-label=\"Remove favorite\"]') !== null",
    "ambient transport favorite button renders"
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
                  source: 'scene'
                },
                {
                  id: 'rainy-window',
                  filename: 'Rainy-Window.mp4',
                  label: 'Rainy Window',
                  src: ${JSON.stringify(`${interactionSceneVideoSrc}?ota=rainy`)},
                  order: 30,
                  source: 'scene'
                }
              ],
              total: 2,
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

  await wait(5600);
  await expect(client, "document.querySelector('.ambient-screen.is-hud-hidden') !== null", "ambient HUD auto hides after tap show");

  await wheel(client, 220);
  await expectEventually(client, "document.querySelector('.quick-settings.is-active') !== null", "ambient wheel down opens settings");

  await navigate(client, `${APP_URL}?mode=quickMenu`);
  await expect(client, "document.querySelector('.quick-menu.is-active') !== null", "quick menu opens");
  await expect(
    client,
    `
      (() => {
        const text = document.querySelector('.quick-menu-panel')?.textContent ?? '';
        return text.includes('Scene Video')
          && text.includes('Clock')
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
        const video = document.querySelector('.flame-video[data-flame-loop-role="active"]');
        const standby = [...document.querySelectorAll('.flame-video')]
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
        const videos = [...document.querySelectorAll('.flame-video')];
        const video = videos.find((node) => node.getAttribute('data-flame-loop-role') === 'active');
        if (!(video instanceof HTMLVideoElement) || !Number.isFinite(video.duration)) return false;
        window.__tikpalLoopStartSlot = video.getAttribute('data-flame-slot-index');
        videos.forEach((node) => {
          if (node instanceof HTMLVideoElement) node.playbackRate = 0.25;
        });
        video.currentTime = Math.max(0, video.duration - 0.8);
        void video.play();
        return true;
      })()
    `
  );
  await expectEventually(
    client,
    `
      (() => {
        const videos = [...document.querySelectorAll('.flame-video')];
        const standbyVideo = videos.find((video) => video.getAttribute('data-flame-slot-index') !== window.__tikpalLoopStartSlot);
        return videos.length === 2
          && standbyVideo instanceof HTMLVideoElement
          && standbyVideo.getAttribute('data-flame-loop-role') === 'parked'
          && standbyVideo.getAttribute('data-flame-frame-ready') === 'true'
          && standbyVideo.getAttribute('data-flame-loop-phase') === 'ready'
          && standbyVideo.getAttribute('data-flame-audio-slot') === 'standby'
          && standbyVideo.muted === true
          && !videos.some((video) => ['incoming', 'outgoing'].includes(video.getAttribute('data-flame-loop-role')));
      })()
    `,
    "standby scene loop slot decodes its first frame before handoff",
    40,
    50
  );
  await evaluate(
    client,
    `
      (() => {
        const videos = [...document.querySelectorAll('.flame-video')];
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
        const videos = [...document.querySelectorAll('.flame-video')];
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
  if (minLoopLuma < Math.max(45, maxLoopLuma * 0.45)) {
    throw new Error(`Failed: scene loop center luma dropped near black (${loopLumas.map((value) => value.toFixed(1)).join(', ')}; ${loopLumaSamples.map((sample) => sample.roles.join('/')).join(' | ')})`);
  }
  console.log(`ok - scene loop center luma avoids black/transparent drop (${loopLumas.map((value) => value.toFixed(1)).join(', ')})`);
  console.log(`ok - scene loop audio keeps live audible slots (${loopAudioSamples.map((sample) => sample.audibleVideos.map((video) => `${video.audioRole}:${video.currentTime.toFixed(2)}`).join('+')).join(', ')})`);

  await expectEventually(
    client,
    `
      (() => {
        const videos = [...document.querySelectorAll('.flame-video')];
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
        const videos = [...document.querySelectorAll('.flame-video')];
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
  await navigate(client, `${APP_URL}?mode=player`);
  await evaluate(
    client,
    `
      (() => {
        document.querySelector('[data-source-item="mpd"]')?.click();
        return true;
      })()
    `
  );
  await expectEventually(client, "document.querySelector('.flame-video.is-active') instanceof HTMLVideoElement && document.querySelector('.flame-video.is-active').muted === true", "music source switch remutes the active video");
  await expectEventuallyEvaluate(
    client,
    "fetch('/api/v1/system/state').then((response) => response.json()).then((state) => state.playback.source !== 'scene')",
    "switching to music deactivates scene source"
  );

  await navigate(client, `${APP_URL}?mode=player`);
  await click(client, 1360, 600);
  await expect(client, "document.querySelector('.player-overlay.is-active') !== null", "protected player click stays in player");

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
        const expected = ['mpd', 'radio', 'spotify', 'airplay', 'bluetooth'];
        return expected.every((sourceId) => document.querySelector(\`[data-source-item="\${sourceId}"]\`))
          && document.querySelector('[data-source-item="audio"]') === null;
      })()
    `,
    "player source tabs include five visible source categories"
  );
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

  await evaluate(
    client,
    `
      (() => {
        const target = document.querySelector('[aria-label=\"Queue\"]');
        target?.click();
        return Boolean(target);
      })()
    `
  );
  await expect(client, "document.querySelector('[data-queue-panel]') !== null", "player queue panel opens");

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
  await expect(client, settingsSummaryExpression("output", ["Audio Output", "DSP", "Display", "Font", "Skin", "Lyrics"]), "settings Preferences summary keeps fixed four-column cards");
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
  await expect(client, settingsSummaryExpression("output", ["Audio Output", "DSP", "Display", "Font", "Skin", "Lyrics"]), "settings Preferences remains a fixed four-column grid");

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
        const target = [...document.querySelectorAll('.settings-card-button')].find((node) => node.textContent.includes('Font'));
        target?.click();
        return Boolean(target);
      })()
    `
  );
  await expect(client, "document.querySelector('[data-settings-detail=\"font\"]') !== null", "settings font detail opens");
  await expect(client, "document.querySelector('.font-theme-options-detail') !== null", "settings font detail shows presets");
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

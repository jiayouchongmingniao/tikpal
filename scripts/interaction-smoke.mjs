import { spawn } from "node:child_process";
import { spawnSync } from "node:child_process";
import { access, copyFile, mkdir } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const APP_URL = process.env.TIKPAL_TEST_URL ?? "http://localhost:4173/";
const REMOTE_APP_URL = process.env.TIKPAL_TEST_REMOTE_URL ?? "http://localhost:4174/";
const DEVTOOLS_PORT = Number(process.env.TIKPAL_TEST_DEVTOOLS_PORT ?? 9222);
const INTERACTION_SCENE_FIXTURE_DIR = path.resolve("public", "assets", ".interaction-smoke");
const INTERACTION_SCENE_FIXTURE_PATH = path.join(INTERACTION_SCENE_FIXTURE_DIR, "scene.mp4");
const INTERACTION_SCENE_DIST_FIXTURE_PATH = path.resolve("dist", "assets", ".interaction-smoke", "scene.mp4");
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

  if (await canAccess(path.resolve("dist"))) {
    await mkdir(path.dirname(INTERACTION_SCENE_DIST_FIXTURE_PATH), { recursive: true });
    await copyFile(INTERACTION_SCENE_FIXTURE_PATH, INTERACTION_SCENE_DIST_FIXTURE_PATH);
  }

  return INTERACTION_SCENE_FIXTURE_SRC;
}

async function resetInteractionRoomExperience() {
  const actionsUrl = new URL("/api/v1/experience/actions", APP_URL);
  const sourceUrl = new URL("/api/v1/audio/source", APP_URL);
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
  const sourceResponse = await fetch(sourceUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target: "mpd" })
  });
  if (!sourceResponse.ok) {
    throw new Error(`Failed to reset audio source for interaction smoke: ${sourceResponse.status}`);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generatedCoverSquareRootExpression(selector) {
  return `
    (() => {
      const src = document.querySelector(${JSON.stringify(selector)})?.getAttribute('src') ?? "";
      if (!src.startsWith('data:image/svg+xml')) return false;
      const encodedSvg = src.includes(",") ? src.slice(src.indexOf(",") + 1) : src;
      const svg = decodeURIComponent(encodedSvg);
      return /<rect\\s+width="1200"\\s+height="1200"\\s+fill=/.test(svg)
        && !/<rect\\s+width="1200"\\s+height="1200"\\s+rx=/.test(svg)
        && !/clipPath\\s+id="posterClip"/.test(svg)
        && !/<rect\\s+x="\\d+"[^>]*\\srx=/.test(svg);
    })()
  `;
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

async function postExperienceAction(client, action) {
  const ok = await evaluate(
    client,
    `
      fetch('/api/v1/experience/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: ${JSON.stringify(JSON.stringify(action))}
      }).then((response) => response.ok)
    `
  );
  if (!ok) throw new Error(`Failed: experience action ${action.type} was rejected`);
}

async function installSceneTransitionObserver(client) {
  await evaluate(
    client,
    `
      (() => {
        window.__tikpalSceneTransitionObserver?.disconnect?.();
        window.__tikpalSceneTransitionSnapshots = [];
	        const record = () => {
	          const scene = document.querySelector('.flame-scene');
	          const videos = [...document.querySelectorAll('.flame-video')];
	          const videoLayers = videos.map((video) => ({
	            src: video.getAttribute('src') ?? '',
	            layer: video.getAttribute('data-flame-layer') ?? '',
	            role: video.getAttribute('data-flame-loop-role') ?? '',
	            phase: video.getAttribute('data-flame-loop-phase') ?? '',
	            frameReady: video.getAttribute('data-flame-frame-ready') ?? ''
	          }));
	          window.__tikpalSceneTransitionSnapshots.push({
	            phase: scene?.getAttribute('data-flame-transition-phase') ?? 'missing',
	            transition: scene?.getAttribute('data-flame-transition') ?? 'missing',
	            loopMode: scene?.getAttribute('data-flame-loop-mode') ?? 'dual',
	            layerCount: document.querySelectorAll('.flame-video-layer').length,
	            videoLayers,
	            activeSrcs: videos
	              .filter((video) => video.getAttribute('data-flame-layer') === 'active')
	              .map((video) => video.getAttribute('src') ?? ''),
            allSrcs: videos.map((video) => video.getAttribute('src') ?? ''),
            activeGainDbs: videos
              .filter((video) => video.getAttribute('data-flame-layer') === 'active')
              .map((video) => Number.parseFloat(video.getAttribute('data-scene-gain-db') ?? 'NaN')),
            activeVolumes: videos
              .filter((video) => video.getAttribute('data-flame-layer') === 'active')
              .map((video) => Number.parseFloat(video.getAttribute('data-scene-volume') ?? '0'))
          });
        };
        const observer = new MutationObserver(record);
        observer.observe(document.body, {
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'data-flame-transition', 'data-flame-transition-phase', 'data-flame-layer', 'src', 'data-scene-volume']
        });
        window.__tikpalSceneTransitionObserver = observer;
        record();
        return true;
      })()
    `
  );
}

async function setStatePatchMode(client, mode) {
  return await evaluate(
    client,
    `
      (() => {
        window.__tikpalSmokeStatePatchMode = ${JSON.stringify(mode)};
        return window.__tikpalSmokePatchedStateVersion ?? 0;
      })()
    `
  );
}

async function waitForStatePatchRefresh(client, previousVersion, label) {
  await expectEventually(
    client,
    `(window.__tikpalSmokePatchedStateVersion ?? 0) > ${Number(previousVersion)}`,
    label,
    35,
    150
  );
  await wait(120);
}

async function restoreInteractionFetchMocks(client) {
  await evaluate(
    client,
    `
      (() => {
        if (window.__tikpalRememberedLibraryOriginalFetch) {
          window.fetch = window.__tikpalRememberedLibraryOriginalFetch;
          delete window.__tikpalRememberedLibraryOriginalFetch;
        }
        if (window.__tikpalRememberedRadioOriginalFetch) {
          window.fetch = window.__tikpalRememberedRadioOriginalFetch;
          delete window.__tikpalRememberedRadioOriginalFetch;
        }
        window.__tikpalSmokeStatePatchMode = "";
        return true;
      })()
    `
  );
}

async function switchRoomModeAndNavigate(client, mode, label) {
  await restoreInteractionFetchMocks(client);
  await postExperienceAction(client, { type: "set_mode", mode });
  await navigate(client, APP_URL);
  await expectEventuallyEvaluate(
    client,
    `
      Promise.all([
        fetch('/api/v1/experience/state').then((response) => response.json()),
        Promise.resolve(document.querySelector('.ambient-screen')?.getAttribute('data-room-mode'))
      ]).then(([experience, domMode]) => experience.mode === ${JSON.stringify(mode)} && domMode === ${JSON.stringify(mode)})
    `,
    label,
    45,
    150
  );
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

function sourceHandoffExpression(sourceId) {
  return `
    (() => {
      const card = document.querySelector('[data-source-handoff-waiting="${sourceId}"]');
      return Boolean(card && card.textContent?.includes('Connecting'));
    })()
  `;
}

async function expectLibrarySearchForStorage(client, storageId, placeholder) {
  await evaluate(client, `document.querySelector('[data-library-storage="${storageId}"]')?.click(); true`);
  await expectEventually(client, `document.querySelector('[data-library-storage="${storageId}"].is-selected') !== null`, `player Library ${storageId} storage tab is selected`);
  await expectEventually(
    client,
    `document.querySelector('[data-library-search-input]')?.getAttribute('placeholder') === ${JSON.stringify(placeholder)}`,
    `player Library search shows ${placeholder}`
  );
  const probe = await evaluate(
    client,
    `
      (() => {
        const input = document.querySelector('[data-library-search-input]');
        if (!(input instanceof HTMLInputElement)) return { ready: false, rows: 0, token: "" };
        const rowsBefore = [...document.querySelectorAll('[data-library-track-list] [data-library-track]')];
        const text = [
          ...rowsBefore[0]?.querySelectorAll('.library-track-copy strong, .library-track-copy em, .library-track-meta i, .library-track-meta small') ?? []
        ].map((node) => node.textContent ?? "").join(" ");
        const token = text
          .split(/[^\\p{L}\\p{N}]+/u)
          .map((entry) => entry.trim())
          .find((entry) => entry.length >= 3) ?? "";
        window.__tikpalLibrarySearchProbe = {
          before: rowsBefore.length,
          storage: ${JSON.stringify(storageId)},
          token: token.toLocaleLowerCase()
        };
        if (token) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          if (setter) setter.call(input, token);
          else input.value = token;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return { ready: true, rows: rowsBefore.length, token };
      })()
    `
  );
  if (!probe?.ready) throw new Error(`Failed: player Library ${storageId} search input is ready`);
  if (probe.token) {
    await expectEventually(
      client,
      `
        (() => {
          const probe = window.__tikpalLibrarySearchProbe;
          const input = document.querySelector('[data-library-search-input]');
          const rows = [...document.querySelectorAll('[data-library-track-list] [data-library-track]')];
          return Boolean(probe?.token)
            && input instanceof HTMLInputElement
            && input.value.toLocaleLowerCase() === probe.token
            && rows.length > 0
            && rows.length <= probe.before
            && rows.every((row) => row.textContent?.toLocaleLowerCase().includes(probe.token));
        })()
      `,
      `player Library ${storageId} search filters visible tracks`
    );
    await evaluate(client, "document.querySelector('[data-library-search-clear]')?.click(); true");
    await expectEventually(
      client,
      `
        (() => {
          const probe = window.__tikpalLibrarySearchProbe;
          const input = document.querySelector('[data-library-search-input]');
          const rows = [...document.querySelectorAll('[data-library-track-list] [data-library-track]')];
          return input instanceof HTMLInputElement
            && input.value === ''
            && (!probe || rows.length === probe.before);
        })()
      `,
      `player Library ${storageId} search clears back to full list`
    );
  }
}

function hifiAmbientSourceSettledExpression(sourceId) {
  const label = {
    mpd: "Library",
    radio: "Radio",
    bluetooth: "Bluetooth",
    airplay: "AirPlay"
  }[sourceId] ?? sourceId;
  return `
    fetch('/api/v1/system/state')
      .then((response) => response.json())
      .then((state) => {
        const toggleTitle = document.querySelector('[data-ambient-source-toggle]')?.getAttribute('title') ?? '';
        return state.audio.currentSource.id === ${JSON.stringify(sourceId)}
          && state.playback.source === ${JSON.stringify(sourceId)}
          && toggleTitle.includes(${JSON.stringify(label)});
      })
  `;
}

async function waitForEvaluate(client, expression, attempts = 20, delayMs = 150) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(client, expression)) return true;
    await wait(delayMs);
  }
  return false;
}

async function switchHifiAmbientSource(client, sourceId, exposeLabel, switchLabel) {
  const optionExpression = `document.querySelector('[data-ambient-source-option="${sourceId}"]:not(:disabled)') !== null`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await evaluate(
      client,
      `
        (() => {
          if (!document.querySelector('[data-ambient-source-picker]')) {
            document.querySelector('[data-ambient-source-toggle]:not(:disabled)')?.click();
          }
          return true;
        })()
      `
    );
    if (!await waitForEvaluate(client, optionExpression, 20, 150)) continue;
    if (attempt === 0) console.log(`ok - ${exposeLabel}`);
    const clicked = await evaluate(
      client,
      `
        (() => {
          const target = document.querySelector('[data-ambient-source-option="${sourceId}"]:not(:disabled)');
          target?.click();
          return Boolean(target);
        })()
      `
    );
    if (!clicked) continue;
    if (await waitForEvaluate(client, hifiAmbientSourceSettledExpression(sourceId), 20, 150)) {
      console.log(`ok - ${switchLabel}`);
      return;
    }
  }
  throw new Error(`Failed: ${switchLabel}`);
}

async function switchPlayerSourceAndExpectHandoff(client, sourceId, sourceLabel) {
  await expectEventually(
    client,
    `document.querySelector('[data-source-item="${sourceId}"]:not(:disabled)') !== null`,
    `${sourceLabel} source tab is ready`
  );
  await evaluate(
    client,
    `
      (() => {
        const target = document.querySelector('[data-source-item="${sourceId}"]:not(:disabled)');
        target?.click();
        return Boolean(target);
      })()
    `
  );
  await expectEventually(
    client,
    `(${sourceHandoffExpression(sourceId)}) || document.querySelector('.source-line span')?.textContent?.includes('${sourceLabel}') === true`,
    `${sourceLabel} source shows waiting handoff card or connects quickly`
  );
  await expectEventually(client, `document.querySelector('.source-line span')?.textContent?.includes('${sourceLabel}') === true`, `${sourceLabel} source connects after handoff`);
  await expectEventually(client, sourceTabExpression(sourceId, { selected: true, active: true }), `${sourceLabel} source is selected and active after handoff`);
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
      const fixedHeight = rects.every((rect) => Math.abs(rect.height - 118) < 1);
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
  await client.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      (() => {
        window.localStorage.setItem('tikpal.lyricsVisible.v3', 'false');
        const nativeFetch = window.fetch.bind(window);
        const realBluetoothCover = "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22120%22%20height%3D%22120%22%3E%3Crect%20width%3D%22120%22%20height%3D%22120%22%20fill%3D%22%2318405a%22%2F%3E%3Ccircle%20cx%3D%2260%22%20cy%3D%2260%22%20r%3D%2232%22%20fill%3D%22%23f2d36b%22%2F%3E%3C%2Fsvg%3E";
        const realRadioCover = "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22120%22%20height%3D%22120%22%3E%3Crect%20width%3D%22120%22%20height%3D%22120%22%20fill%3D%22%231f2937%22%2F%3E%3Ccircle%20cx%3D%2260%22%20cy%3D%2260%22%20r%3D%2238%22%20fill%3D%22%23d6b761%22%2F%3E%3Ctext%20x%3D%2260%22%20y%3D%2268%22%20font-family%3D%22Arial%22%20font-size%3D%2228%22%20font-weight%3D%22700%22%20text-anchor%3D%22middle%22%20fill%3D%22%231f2937%22%3ER%3C%2Ftext%3E%3C%2Fsvg%3E";

        function clone(value) {
          return JSON.parse(JSON.stringify(value));
        }

        function withSource(state, sourceId, options = {}) {
          const next = clone(state);
          next.audio.sources = next.audio.sources.map((source) => {
            const patched = {
              ...source,
              active: source.id === sourceId,
              availability: source.id === sourceId ? "available" : source.availability,
              armed: false,
              connectionState: source.id === sourceId ? "connected" : "idle",
              connectedLabel: source.id === sourceId ? (sourceId === "bluetooth" ? "Tikpal Demo Phone" : source.connectedLabel) : null
            };
            if (source.id === "radio") {
              patched.radioStationId = sourceId === "radio" ? options.radioStationId ?? source.radioStationId ?? null : null;
            }
            return patched;
          });
          next.audio.currentSource = next.audio.sources.find((source) => source.id === sourceId) ?? next.audio.currentSource;
          return next;
        }

        function applyPatch(state) {
          const mode = window.__tikpalSmokeStatePatchMode ?? "";
          if (mode === "syncedLyrics") {
            const next = clone(state);
            next.playback = {
              ...next.playback,
              source: "mpd",
              albumArtUrl: null,
              title: "Synced Lyric Study",
              artist: "Tikpal Smoke",
              album: "Wall Text",
              elapsedSeconds: 2.2,
              durationSeconds: 180
            };
            next.lyrics = {
              ...next.lyrics,
              status: "ready",
              trackKey: "smoke-synced-lyrics",
              synced: true,
              activeLineIndex: null,
              title: "Synced Lyric Study",
              artist: "Tikpal Smoke",
              lines: [
                { text: "Synced line one", startMs: 0, endMs: 1000 },
                { text: "Synced line two", startMs: 1000, endMs: 2000 },
                { text: "Synced line three carries a longer phrase for the rolling lyrics ticker", startMs: 2000, endMs: 3000 },
                { text: "Synced line four carries a longer phrase for the rolling lyrics ticker", startMs: 3000, endMs: 4000 },
                { text: "Synced line five carries a longer phrase for the rolling lyrics ticker", startMs: 4000, endMs: 5000 }
              ],
              message: null,
              updatedAt: new Date().toISOString()
            };
            return next;
          }

          if (mode === "staticLyrics") {
            const next = clone(state);
            next.playback = {
              ...next.playback,
              source: "mpd",
              albumArtUrl: null,
              title: "Static Lyric Study",
              artist: "Tikpal Smoke",
              album: "Wall Text",
              elapsedSeconds: null,
              durationSeconds: null
            };
            next.lyrics = {
              ...next.lyrics,
              status: "ready",
              trackKey: "smoke-static-lyrics",
              synced: false,
              activeLineIndex: null,
              title: "Static Lyric Study",
              artist: "Tikpal Smoke",
              lines: [
                { text: "Static line one", startMs: null, endMs: null },
                { text: "Static line two", startMs: null, endMs: null },
                { text: "Static line three", startMs: null, endMs: null },
                { text: "Static line four", startMs: null, endMs: null },
                { text: "Static line five", startMs: null, endMs: null }
              ],
              message: null,
              updatedAt: new Date().toISOString()
            };
            return next;
          }

          if (mode === "noReadyLyrics") {
            const next = clone(state);
            next.lyrics = {
              ...next.lyrics,
              status: "not_found",
              trackKey: "smoke-no-ready-lyrics",
              synced: false,
              activeLineIndex: null,
              lines: [],
              message: "No lyrics found",
              updatedAt: new Date().toISOString()
            };
            return next;
          }

          if (mode === "pausedNoReadyLyrics") {
            const next = clone(state);
            next.playback = {
              ...next.playback,
              state: "paused"
            };
            next.lyrics = {
              ...next.lyrics,
              status: "not_found",
              trackKey: "smoke-paused-no-ready-lyrics",
              synced: false,
              activeLineIndex: null,
              lines: [],
              message: "No lyrics found",
              updatedAt: new Date().toISOString()
            };
            return next;
          }

          if (mode === "bluetoothFallback" || mode === "bluetoothRealCover") {
            const next = withSource(state, "bluetooth");
            next.playback = {
              ...next.playback,
              state: "playing",
              source: "bluetooth",
              albumArtUrl: mode === "bluetoothRealCover" ? realBluetoothCover : null,
              title: "Pocket Signal",
              artist: "Tikpal Phone",
              album: "Bluetooth Session",
              elapsedSeconds: 12,
              durationSeconds: 188,
              currentTrackIndex: 0,
              queueLength: 0,
              favorite: false,
              queuePreview: []
            };
            return next;
          }

          if (mode === "bluetoothReadyLyrics") {
            const next = withSource(state, "bluetooth");
            next.playback = {
              ...next.playback,
              state: "playing",
              source: "bluetooth",
              albumArtUrl: null,
              title: "Pocket Signal",
              artist: "Tikpal Phone",
              album: "Bluetooth Session",
              elapsedSeconds: 42,
              durationSeconds: 188,
              currentTrackIndex: 0,
              queueLength: 0,
              favorite: false,
              queuePreview: []
            };
            next.lyrics = {
              ...next.lyrics,
              status: "ready",
              sourceScope: "bluetooth_input",
              recognitionMode: "metadata",
              trackKey: "smoke-bluetooth-ready-lyrics",
              synced: true,
              activeLineIndex: null,
              title: "Pocket Signal",
              artist: "Tikpal Phone",
              lines: [
                { text: "Bluetooth line one", startMs: 0, endMs: 18000 },
                { text: "Bluetooth line two", startMs: 18000, endMs: 36000 },
                { text: "Bluetooth chorus line glows through the shared lyrics wall", startMs: 36000, endMs: 54000 },
                { text: "Bluetooth line four", startMs: 54000, endMs: 72000 }
              ],
              message: null,
              updatedAt: new Date().toISOString()
            };
            return next;
          }

          if (mode === "radioReadyLyrics") {
            const next = withSource(state, "radio", { radioStationId: "radio-502" });
            next.playback = {
              ...next.playback,
              state: "playing",
              source: "radio",
              albumArtUrl: realRadioCover,
              title: "Midnight Radio Glow",
              artist: "Tikpal Broadcast",
              album: "Tikpal Hi-Fi Radio",
              elapsedSeconds: 34,
              durationSeconds: 180,
              currentTrackIndex: 0,
              queueLength: 0,
              favorite: false,
              queuePreview: []
            };
            next.lyrics = {
              ...next.lyrics,
              status: "ready",
              sourceScope: "local_playback",
              recognitionMode: "metadata",
              recognitionProvider: "lrclib",
              trackKey: "smoke-radio-ready-lyrics",
              synced: true,
              activeLineIndex: null,
              title: "Midnight Radio Glow",
              artist: "Tikpal Broadcast",
              lines: [
                { text: "Radio line one", startMs: 0, endMs: 15000 },
                { text: "Radio line two", startMs: 15000, endMs: 30000 },
                { text: "Radio chorus line uses the shared lyrics wall", startMs: 30000, endMs: 50000 },
                { text: "Radio line four", startMs: 50000, endMs: 72000 }
              ],
              message: null,
              updatedAt: new Date().toISOString()
            };
            return next;
          }

          if (mode === "airplayFallbackLyrics") {
            const next = withSource(state, "airplay");
            next.playback = {
              ...next.playback,
              state: "playing",
              source: "airplay",
              albumArtUrl: null,
              title: "Fallback Song",
              artist: "Fallback Artist",
              album: "Fallback Album",
              elapsedSeconds: 28,
              durationSeconds: 180,
              currentTrackIndex: 0,
              queueLength: 0,
              favorite: false,
              queuePreview: []
            };
            next.lyrics = {
              ...next.lyrics,
              status: "ready",
              sourceScope: "airplay_input",
              recognitionMode: "metadata",
              recognitionProvider: "lyricsovh",
              trackKey: "smoke-airplay-fallback-lyrics",
              synced: false,
              activeLineIndex: null,
              title: "Fallback Song",
              artist: "Fallback Artist",
              lines: [
                { text: "AirPlay fallback line one", startMs: null, endMs: null },
                { text: "AirPlay fallback line two", startMs: null, endMs: null },
                { text: "AirPlay fallback chorus line", startMs: null, endMs: null }
              ],
              message: null,
              updatedAt: new Date().toISOString()
            };
            return next;
          }

          if (mode === "airplayUntrustedSyncedLyrics") {
            const next = withSource(state, "airplay");
            next.playback = {
              ...next.playback,
              state: "playing",
              source: "airplay",
              albumArtUrl: null,
              title: "Untrusted AirPlay Clock",
              artist: "Tikpal Smoke",
              album: "Wall Text",
              elapsedSeconds: 42,
              durationSeconds: 120,
              timingDiagnostics: {
                ...(next.playback.timingDiagnostics ?? {}),
                metadataSource: "mpris",
                positionTrusted: false
              },
              currentTrackIndex: 0,
              queueLength: 0,
              favorite: false,
              queuePreview: []
            };
            next.lyrics = {
              ...next.lyrics,
              status: "ready",
              sourceScope: "airplay_input",
              recognitionMode: "metadata",
              recognitionProvider: "lrclib",
              trackKey: "smoke-airplay-untrusted-synced-lyrics",
              synced: true,
              activeLineIndex: null,
              title: "Untrusted AirPlay Clock",
              artist: "Tikpal Smoke",
              lines: [
                { text: "Untrusted AirPlay line one", startMs: 0, endMs: 10000 },
                { text: "Untrusted AirPlay line two", startMs: 10000, endMs: 20000 },
                { text: "Untrusted AirPlay line three should not become active from stale elapsed", startMs: 40000, endMs: 60000 }
              ],
              message: null,
              updatedAt: new Date().toISOString()
            };
            return next;
          }

          if (mode === "airplayEstimatedSyncedLyrics") {
            const next = withSource(state, "airplay");
            next.playback = {
              ...next.playback,
              state: "playing",
              source: "airplay",
              albumArtUrl: null,
              title: "Estimated AirPlay Clock",
              artist: "Tikpal Smoke",
              album: "Wall Text",
              elapsedSeconds: 18,
              durationSeconds: 120,
              timingDiagnostics: {
                ...(next.playback.timingDiagnostics ?? {}),
                metadataSource: "mpris",
                positionTrusted: false,
                positionConfidence: "estimated"
              },
              currentTrackIndex: 0,
              queueLength: 0,
              favorite: false,
              queuePreview: []
            };
            next.lyrics = {
              ...next.lyrics,
              status: "ready",
              sourceScope: "airplay_input",
              recognitionMode: "metadata",
              recognitionProvider: "lrclib",
              trackKey: "smoke-airplay-estimated-synced-lyrics",
              synced: true,
              activeLineIndex: null,
              title: "Estimated AirPlay Clock",
              artist: "Tikpal Smoke",
              lines: [
                { text: "Estimated AirPlay line one", startMs: 0, endMs: 10000 },
                { text: "Estimated AirPlay line two follows the estimated clock", startMs: 10000, endMs: 20000 },
                { text: "Estimated AirPlay line three advances locally", startMs: 20000, endMs: 60000 }
              ],
              message: null,
              updatedAt: new Date().toISOString()
            };
            return next;
          }

          if (mode === "brokenArtwork") {
            const next = withSource(state, "mpd");
            next.playback = {
              ...next.playback,
              state: "playing",
              source: "mpd",
              albumArtUrl: "/api/v1/media/artwork?track=missing-smoke-cover",
              title: "Broken Artwork Study",
              artist: "Tikpal Smoke",
              album: "Generated Fallback",
              elapsedSeconds: 24,
              durationSeconds: 188,
              currentTrackIndex: 1,
              queueLength: 3,
              favorite: false
            };
            return next;
          }

          if (mode === "longPlayerTitle") {
            const next = withSource(state, "mpd");
            next.playback = {
              ...next.playback,
              state: "playing",
              source: "mpd",
              albumArtUrl: null,
              title: "WolfgangAmadeusMozart-SymphonyNo.40InGMinorK.550-01-MoltoAllegro",
              artist: "Unknown Artist",
              album: "Untitled",
              elapsedSeconds: 138,
              durationSeconds: 551,
              currentTrackIndex: 9,
              queueLength: 13,
              favorite: false
            };
            return next;
          }

          if (mode === "hifiRememberedDifferentRadio" || mode === "hifiRememberedSameRadio" || mode === "hifiRememberedRadioPendingMemory") {
            const currentStationId = mode === "hifiRememberedSameRadio" ? "radio-503" : "radio-500";
            const next = withSource(state, "radio", { radioStationId: currentStationId });
            const currentStationLabel = currentStationId === "radio-503"
              ? "Focus - Soma FM Groove Salad"
              : "Focus - Soma FM Cliqhop";
            next.audio.rememberedSource = mode === "hifiRememberedRadioPendingMemory"
              ? null
              : {
                  target: "radio",
                  localTrackPath: null,
                  radioStationId: "radio-503",
                  updatedAt: "2026-06-30T00:00:00.000Z"
                };
            next.playback = {
              ...next.playback,
              state: "playing",
              source: "radio",
              albumArtUrl: '/api/v1/media/radio-logo?stationId=' + currentStationId,
              title: currentStationLabel,
              artist: "Internet Radio",
              album: currentStationLabel,
              elapsedSeconds: null,
              durationSeconds: null,
              currentTrackIndex: 0,
              queueLength: 0,
              favorite: false,
              queuePreview: []
            };
            return next;
          }

          if (mode === "hifiRememberedDifferentLibrary" || mode === "hifiRememberedSameLibrary") {
            const rememberedTrackPath = "Focus/Lo-fi Ambient/FASSounds - Good Night - Lofi Cozy Chill Music - 02m27s - Lo-fi.mp3";
            const next = mode === "hifiRememberedSameLibrary"
              ? withSource(state, "mpd")
              : withSource(state, "radio", { radioStationId: "radio-500" });
            next.audio.rememberedSource = {
              target: "mpd",
              localTrackPath: rememberedTrackPath,
              radioStationId: null,
              updatedAt: "2026-06-30T00:00:00.000Z"
            };
            next.playback = {
              ...next.playback,
              state: "playing",
              source: mode === "hifiRememberedSameLibrary" ? "mpd" : "radio",
              albumArtUrl: mode === "hifiRememberedSameLibrary" ? "/api/v1/media/library-cover?track=smoke" : "/api/v1/media/radio-logo?stationId=radio-500",
              title: mode === "hifiRememberedSameLibrary" ? "Good Night" : "Focus - Soma FM Cliqhop",
              artist: mode === "hifiRememberedSameLibrary" ? "FASSounds" : "Internet Radio",
              album: mode === "hifiRememberedSameLibrary" ? "Lo-fi Ambient" : "Focus - Soma FM Cliqhop",
              elapsedSeconds: mode === "hifiRememberedSameLibrary" ? 42 : null,
              durationSeconds: mode === "hifiRememberedSameLibrary" ? 147 : null,
              currentTrackIndex: mode === "hifiRememberedSameLibrary" ? 1 : 0,
              queueLength: mode === "hifiRememberedSameLibrary" ? 3 : 0,
              favorite: false,
              queuePreview: mode === "hifiRememberedSameLibrary"
                ? [{
                    id: "Codex/" + rememberedTrackPath,
                    position: 1,
                    title: "Good Night",
                    artist: "FASSounds",
                    album: "Lo-fi Ambient",
                    durationSeconds: 147,
                    active: true
                  }]
                : []
            };
            return next;
          }

          if (mode === "singleLoopScene") {
            const next = withSource(state, "scene");
            next.runtime = {
              ...next.runtime,
              apiMode: "mpc"
            };
            next.playback = {
              ...next.playback,
              state: "playing",
              source: "scene",
              title: "Scene Audio",
              artist: "Interaction Scene",
              album: "Interaction Scene",
              elapsedSeconds: 2.4,
              durationSeconds: null,
              currentTrackIndex: 0,
              queueLength: 0,
              favorite: false,
              queuePreview: [],
              transportCapabilities: {
                playPause: true,
                play: true,
                pause: true,
                next: false,
                previous: false,
                seek: false,
                reason: null
              }
            };
            return next;
          }

          return state;
        }

        window.__tikpalSmokeStatePatchMode = "";
        window.__tikpalSmokePatchedStateVersion = 0;
        window.fetch = async (input, init) => {
          const response = await nativeFetch(input, init);
          const rawUrl = typeof input === "string" ? input : input?.url;
          const pathname = rawUrl ? new URL(rawUrl, window.location.href).pathname : "";
          if (pathname !== "/api/v1/system/state" || !window.__tikpalSmokeStatePatchMode) {
            return response;
          }

          try {
            const body = await response.clone().json();
            const headers = new Headers(response.headers);
            headers.set("content-type", "application/json");
            const patchedBody = applyPatch(body);
            window.__tikpalSmokePatchedStateVersion = (window.__tikpalSmokePatchedStateVersion ?? 0) + 1;
            return new Response(JSON.stringify(patchedBody), {
              status: response.status,
              statusText: response.statusText,
              headers
            });
          } catch {
            return response;
          }
        };
      })();
    `
  });

  await navigate(client, APP_URL);
  await expect(client, "document.querySelector('.ambient-screen') !== null", "ambient root renders");
  await expect(
    client,
    "window.localStorage.getItem('tikpal.lyricsVisible.v3') === 'true' && window.localStorage.getItem('tikpal.lyricsVisible.autoRestored.v1') === 'true'",
    "stale hidden lyrics visibility auto-restores once"
  );
  await expect(
    client,
    `
      (() => {
        const left = document.querySelector('.ambient-adjust-zone-left');
        const right = document.querySelector('.ambient-adjust-zone-right');
        return left?.getAttribute('data-ambient-adjust-zone') === 'brightness'
          && right?.getAttribute('data-ambient-adjust-zone') === 'volume'
          && (left.getAttribute('aria-label') ?? '').includes('brightness')
          && (right.getAttribute('aria-label') ?? '').includes('volume');
      })()
    `,
    "ambient edge controls map brightness left and volume right"
  );
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
      fetch('/api/v1/playback/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'volume_set', value: 34 })
      }).then((response) => response.ok)
    `
  );
  await wait(250);
  await touchSwipe(client, 2460, 540, 2460, 360);
  await expectEventually(
    client,
    "fetch('/api/v1/system/state').then((response) => response.json()).then((state) => state.system.volume.percent >= 78)",
    "ambient right-edge touch swipe updates the global volume"
  );
  await expect(
    client,
    "document.querySelector('.ambient-adjust-indicator')?.textContent.includes('Volume') && !document.querySelector('.ambient-adjust-indicator')?.textContent.includes('moOde live level')",
    "ambient right-edge touch swipe shows the volume overlay without the moOde helper copy"
  );
  await wait(1100);
  await expect(
    client,
    "document.querySelector('.ambient-adjust-indicator')?.textContent.includes('Volume') && document.querySelector('[data-ambient-adjust-back]') !== null",
    "ambient volume overlay stays open with an explicit Back button"
  );
  await evaluate(client, "document.querySelector('[data-ambient-adjust-back]')?.click();");
  await expectEventually(
    client,
    "document.querySelector('.ambient-adjust-indicator') === null",
    "ambient volume Back closes the adjustment overlay"
  );
  await postExperienceAction(client, { type: "set_mode", mode: "hifi" });
  await navigate(client, APP_URL);
  await expectEventually(
    client,
    "document.querySelector('[data-hifi-now-playing][data-hifi-centered-now-playing]') !== null && document.querySelector('[data-hifi-cover-art]') !== null && document.querySelector('[data-hifi-track-info]') !== null && document.querySelector('[data-hifi-playback-presence][data-hifi-playback-state=\"playing\"]') !== null && document.querySelector('[data-hifi-eq-visual]') === null && document.querySelector('[data-spectrum-band]') === null && document.querySelector('video.flame-video.is-active') === null && document.querySelector('.ambient-screen')?.getAttribute('data-room-mode') === 'hifi'",
    "Hi-Fi room mode renders centered cover and track info without EQ display",
    50,
    150
  );
  await expect(
    client,
    `
      (() => {
        const visuals = document.querySelector('[data-hifi-ambient-visuals]');
        const presence = document.querySelector('[data-hifi-playback-presence]');
        const surface = document.querySelector('.hifi-now-playing-surface');
        const wave = document.querySelector('[data-hifi-wave-line]');
        const particle = document.querySelector('[data-hifi-particle]');
        if (!visuals || !presence || !surface || !wave || !particle) return false;

        const visualsStyle = getComputedStyle(visuals);
        const presenceStyle = getComputedStyle(presence);
        const surfaceStyle = getComputedStyle(surface);
        const waveStyle = getComputedStyle(wave);
        const particleStyle = getComputedStyle(particle);
        const presenceWidth = Number.parseFloat(presenceStyle.width);
        const presenceHeight = Number.parseFloat(presenceStyle.height);
        return document.querySelectorAll('[data-hifi-wave-line]').length >= 7
          && document.querySelectorAll('[data-hifi-particle]').length >= 24
          && visualsStyle.pointerEvents === 'none'
          && presenceStyle.pointerEvents === 'none'
          && presenceWidth >= 870
          && presenceHeight >= 570
          && waveStyle.animationName !== 'none'
          && waveStyle.animationPlayState === 'running'
          && particleStyle.animationName !== 'none'
          && particleStyle.animationPlayState === 'running'
          && Number.parseInt(visualsStyle.zIndex, 10) < Number.parseInt(surfaceStyle.zIndex, 10);
      })()
    `,
    "Hi-Fi centered background renders lightweight non-blocking waves, particles, and playback presence"
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
  const syncedLyricsPatchVersion = await setStatePatchMode(client, "syncedLyrics");
  await waitForStatePatchRefresh(client, syncedLyricsPatchVersion, "Hi-Fi synced lyrics fixture refreshes");
  await evaluate(
    client,
    `
      (() => {
        const button = document.querySelector('.ambient-transport button[aria-label="Show lyrics"]');
        button?.click();
        return Boolean(button);
      })()
    `
  );
  await expectEventually(
    client,
    `
      (() => {
        const panel = document.querySelector('[data-hifi-lyrics-panel]');
        const activeLine = document.querySelector('[data-hifi-lyrics-line][data-hifi-lyrics-active]');
        const ticker = document.querySelector('.ambient-lyrics-ticker');
        const controls = document.querySelector('[data-hifi-lyrics-controls]');
        const play = controls?.querySelector('button[aria-label="Pause"], button[aria-label="Play"]');
        const controlsStyle = controls ? getComputedStyle(controls) : null;
        const activeText = activeLine?.textContent?.trim() ?? "";
        return panel !== null
          && document.querySelector('.ambient-screen.is-hud-visible') !== null
          && document.querySelector('[data-hifi-centered-now-playing]') === null
          && document.querySelector('[data-hifi-playback-presence]') === null
          && document.querySelectorAll('[data-hifi-lyrics-line]').length >= 4
          && activeLine?.classList.contains('is-active') === true
          && activeText.length > 0
          && document.querySelector('[data-ambient-lyrics]')?.getAttribute('aria-hidden') === 'true'
          && ticker === null
          && controls !== null
          && play !== null
          && controlsStyle?.pointerEvents === 'none'
          && Number.parseFloat(controlsStyle?.opacity ?? '1') <= 0.05;
      })()
    `,
    "Hi-Fi ready synced lyrics hide footer controls while the real HUD transport is visible"
  );
  await wait(1500);
  await expectEventually(
    client,
    `
      (() => {
        const activeLine = document.querySelector('[data-hifi-lyrics-line][data-hifi-lyrics-active]');
        const text = activeLine?.textContent?.trim() ?? "";
        return (text.includes("Synced line four") || text.includes("Synced line five"))
          && document.querySelector('.ambient-lyrics-ticker') === null;
      })()
    `,
    "Hi-Fi synced lyrics advance wall from the local playback clock between state refreshes"
  );
  await wait(4200);
  await expectEventually(
    client,
    `
      (() => {
        const activeLine = document.querySelector('[data-hifi-lyrics-line][data-hifi-lyrics-active]');
        const controls = document.querySelector('[data-hifi-lyrics-controls]');
        const controlsStyle = controls ? getComputedStyle(controls) : null;
        const footerPlay = controls?.querySelector('button[aria-label="Pause"], button[aria-label="Play"]');
        return document.querySelector('.ambient-screen.is-hud-hidden') !== null
          && document.querySelector('[data-hifi-lyrics-panel]') !== null
          && document.querySelector('.ambient-lyrics-ticker') === null
          && document.querySelector('.ambient-transport') !== null
          && getComputedStyle(document.querySelector('.ambient-transport')).pointerEvents === 'none'
          && footerPlay !== null
          && controlsStyle?.pointerEvents !== 'none'
          && Number.parseFloat(controlsStyle?.opacity ?? '0') >= 0.95
          && (activeLine?.textContent?.trim().length ?? 0) > 0;
      })()
    `,
    "Hi-Fi HUD auto hides while lyrics wall footer controls return"
  );
  const staticLyricsPatchVersion = await setStatePatchMode(client, "staticLyrics");
  await waitForStatePatchRefresh(client, staticLyricsPatchVersion, "Hi-Fi static lyrics fixture refreshes");
  await expectEventually(
    client,
    `
      (() => {
        const panel = document.querySelector('[data-hifi-lyrics-panel]');
        const activeLine = document.querySelector('[data-hifi-lyrics-line][data-hifi-lyrics-active]');
        const ticker = document.querySelector('.ambient-lyrics-ticker');
        return panel !== null
          && panel.classList.contains('is-static')
          && document.querySelectorAll('[data-hifi-lyrics-line]').length === 5
          && panel.textContent?.includes('Static line')
          && activeLine === null
          && ticker === null
          && document.querySelector('[data-hifi-lyrics-controls]') !== null;
      })()
    `,
    "Hi-Fi static ready lyrics render lyrics wall without ticker or false active-line highlight"
  );
  const noReadyLyricsPatchVersion = await setStatePatchMode(client, "noReadyLyrics");
  await waitForStatePatchRefresh(client, noReadyLyricsPatchVersion, "Hi-Fi no-ready lyrics fixture refreshes");
  await expectEventually(
    client,
    "document.querySelector('[data-hifi-now-playing][data-hifi-centered-now-playing]') !== null && document.querySelector('[data-hifi-playback-presence][data-hifi-playback-state=\"playing\"]') !== null && document.querySelector('[data-hifi-lyrics-panel]') === null && document.querySelector('.ambient-lyrics-ticker') === null && document.querySelector('[data-ambient-lyrics]')?.getAttribute('aria-hidden') === 'true'",
    "Hi-Fi without ready lyrics returns to centered now-playing with playback presence"
  );
  const pausedNoReadyLyricsPatchVersion = await setStatePatchMode(client, "pausedNoReadyLyrics");
  await waitForStatePatchRefresh(client, pausedNoReadyLyricsPatchVersion, "Hi-Fi paused no-ready lyrics fixture refreshes");
  await expectEventually(
    client,
    `
      (() => {
        const scene = document.querySelector('[data-hifi-now-playing][data-hifi-centered-now-playing]');
        const presence = document.querySelector('[data-hifi-playback-presence][data-hifi-playback-state="paused"]');
        const wave = document.querySelector('[data-hifi-wave-line]');
        const particle = document.querySelector('[data-hifi-particle]');
        if (!wave || !particle) return false;
        const waveStyle = getComputedStyle(wave);
        const particleStyle = getComputedStyle(particle);
        return scene !== null
          && scene.classList.contains('is-paused')
          && !scene.classList.contains('is-playing')
          && presence !== null
          && getComputedStyle(presence).animationName === 'none'
          && waveStyle.animationPlayState === 'paused'
          && particleStyle.animationPlayState === 'paused'
          && document.querySelector('[data-hifi-lyrics-panel]') === null;
      })()
    `,
    "Hi-Fi paused centered fallback keeps playback presence static"
  );
  const brokenArtworkPatchVersion = await setStatePatchMode(client, "brokenArtwork");
  await waitForStatePatchRefresh(client, brokenArtworkPatchVersion, "broken artwork fixture refreshes");
  await expectEventually(
    client,
    "document.querySelector('[data-hifi-cover-art][data-generated-cover-fallback=\"true\"] img')?.getAttribute('src')?.startsWith('data:image/svg+xml') === true && document.querySelector('[data-hifi-track-info]')?.textContent?.includes('Broken Artwork Study')",
    "Hi-Fi broken artwork URL falls back to generated cover"
  );
  await expectEventually(
    client,
    generatedCoverSquareRootExpression('[data-hifi-cover-art][data-generated-cover-fallback="true"] img'),
    "Hi-Fi generated cover uses the outer container for rounded clipping"
  );
  const bluetoothFallbackPatchVersion = await setStatePatchMode(client, "bluetoothFallback");
  await waitForStatePatchRefresh(client, bluetoothFallbackPatchVersion, "Bluetooth fallback fixture refreshes");
  await expectEventually(
    client,
    "document.querySelector('[data-bluetooth-generated-cover]') !== null && document.querySelector('[data-hifi-track-info]')?.textContent?.includes('Pocket Signal')",
    "Bluetooth without real artwork uses generated record poster"
  );
  await expectEventually(
    client,
    generatedCoverSquareRootExpression('[data-bluetooth-generated-cover] img'),
    "Bluetooth generated poster uses a square SVG root"
  );
  const bluetoothRealCoverPatchVersion = await setStatePatchMode(client, "bluetoothRealCover");
  await waitForStatePatchRefresh(client, bluetoothRealCoverPatchVersion, "Bluetooth real cover fixture refreshes");
  await expectEventually(
    client,
    "document.querySelector('[data-bluetooth-generated-cover]') === null && document.querySelector('[data-hifi-cover-art] img')?.getAttribute('src')?.startsWith('data:image/svg+xml')",
    "Bluetooth real artwork is not replaced by generated poster",
    50,
    150
  );
  const bluetoothReadyLyricsPatchVersion = await setStatePatchMode(client, "bluetoothReadyLyrics");
  await waitForStatePatchRefresh(client, bluetoothReadyLyricsPatchVersion, "Bluetooth ready lyrics fixture refreshes");
  await expectEventually(
    client,
    `
      (() => {
        const panel = document.querySelector('[data-hifi-lyrics-panel]');
        const activeLine = document.querySelector('[data-hifi-lyrics-line][data-hifi-lyrics-active]');
        const cover = document.querySelector('[data-hifi-cover-art]');
        const footer = document.querySelector('[data-hifi-lyrics-footer]');
        const miniEq = document.querySelector('[data-hifi-mini-eq]');
        const firstBar = document.querySelector('[data-hifi-mini-eq-bar]');
        const time = document.querySelector('[data-hifi-lyrics-time]');
        const controls = document.querySelector('[data-hifi-lyrics-controls]');
        const progressGroup = document.querySelector('[data-hifi-lyrics-progress-eq]');
        const progressRow = document.querySelector('.hifi-lyrics-progress-row');
        const play = controls?.querySelector('button[aria-label="Pause"], button[aria-label="Play"]');
        if (!panel || !activeLine || !cover || !footer || !miniEq || !firstBar || !time || !controls || !progressGroup || !progressRow || !play) return false;
        const bars = Array.from(document.querySelectorAll('[data-hifi-mini-eq-bar]'));
        const barStyle = getComputedStyle(firstBar);
        const barDurations = new Set(bars.map((bar) => getComputedStyle(bar).animationDuration));
        const barPeaks = new Set(bars.map((bar) => getComputedStyle(bar).getPropertyValue('--hifi-mini-eq-high').trim()));
        const coverRect = cover.getBoundingClientRect();
        const footerRect = footer.getBoundingClientRect();
        const progressRect = progressGroup.getBoundingClientRect();
        const miniEqRect = miniEq.getBoundingClientRect();
        const progressRowRect = progressRow.getBoundingClientRect();
        const controlsRect = controls.getBoundingClientRect();
        const coverCenterX = coverRect.left + coverRect.width / 2;
        const miniEqCenterX = miniEqRect.left + miniEqRect.width / 2;
        const activeText = activeLine.textContent?.trim() ?? "";
        return document.querySelector('[data-hifi-centered-now-playing]') === null
          && document.querySelector('[data-hifi-playback-presence]') === null
          && document.querySelector('[data-bluetooth-generated-cover]') !== null
          && bars.length >= 24
          && barStyle.animationName !== 'none'
          && barStyle.animationPlayState === 'running'
          && barDurations.size >= 5
          && barPeaks.size >= 5
          && activeText.includes('Bluetooth chorus line')
          && document.querySelector('.ambient-lyrics-ticker') === null
          && footerRect.left >= 250
          && footerRect.left <= 330
          && footerRect.bottom < window.innerHeight - 56
          && footerRect.top > window.innerHeight - 215
          && progressGroup.contains(time)
          && Math.abs(miniEqCenterX - coverCenterX) <= 18
          && miniEqRect.bottom <= progressRowRect.top - 2
          && progressRect.width < window.innerWidth * 0.46
          && controlsRect.left < window.innerWidth * 0.68
          && controlsRect.right < window.innerWidth - 320
          && time.textContent?.trim() === '0:42/3:08';
      })()
    `,
    "Bluetooth ready lyrics use the shared Hi-Fi lyrics wall with lightweight footer"
  );
  const radioReadyLyricsPatchVersion = await setStatePatchMode(client, "radioReadyLyrics");
  await waitForStatePatchRefresh(client, radioReadyLyricsPatchVersion, "Radio ready lyrics fixture refreshes");
  await expectEventually(
    client,
    `
      (() => {
        const panel = document.querySelector('[data-hifi-lyrics-panel]');
        const activeLine = document.querySelector('[data-hifi-lyrics-line][data-hifi-lyrics-active]');
        const coverImage = document.querySelector('[data-hifi-cover-art] img');
        const controls = document.querySelector('[data-hifi-lyrics-controls]');
        const activeText = activeLine?.textContent?.trim() ?? "";
        return panel !== null
          && document.querySelector('[data-hifi-centered-now-playing]') === null
          && document.querySelector('[data-hifi-playback-presence]') === null
          && coverImage?.getAttribute('src')?.startsWith('data:image/svg+xml') === true
          && document.querySelector('[data-bluetooth-generated-cover]') === null
          && activeText.includes('Radio chorus line')
          && document.querySelector('.ambient-lyrics-ticker') === null
          && document.querySelector('[data-ambient-lyrics]')?.getAttribute('aria-hidden') === 'true'
          && controls !== null;
      })()
    `,
    "Radio ready lyrics use the shared Hi-Fi lyrics wall with station artwork"
  );
  const airplayFallbackLyricsPatchVersion = await setStatePatchMode(client, "airplayFallbackLyrics");
  await waitForStatePatchRefresh(client, airplayFallbackLyricsPatchVersion, "AirPlay fallback lyrics fixture refreshes");
  await expectEventually(
    client,
    `
      (() => {
        const panel = document.querySelector('[data-hifi-lyrics-panel]');
        const activeLine = document.querySelector('[data-hifi-lyrics-line][data-hifi-lyrics-active]');
        const controls = document.querySelector('[data-hifi-lyrics-controls]');
        return panel !== null
          && panel.classList.contains('is-static')
          && document.querySelector('[data-hifi-centered-now-playing]') === null
          && panel.textContent?.includes('AirPlay fallback')
          && activeLine === null
          && document.querySelector('.ambient-lyrics-ticker') === null
          && document.querySelector('[data-ambient-lyrics]')?.getAttribute('aria-hidden') === 'true'
          && controls !== null;
      })()
    `,
    "AirPlay fallback plain lyrics use a static Hi-Fi wall without false active-line highlight"
  );
  const airplayUntrustedSyncedLyricsPatchVersion = await setStatePatchMode(client, "airplayUntrustedSyncedLyrics");
  await waitForStatePatchRefresh(client, airplayUntrustedSyncedLyricsPatchVersion, "AirPlay untrusted synced lyrics fixture refreshes");
  await expectEventually(
    client,
    `
      (() => {
        const panel = document.querySelector('[data-hifi-lyrics-panel]');
        const activeLine = document.querySelector('[data-hifi-lyrics-line][data-hifi-lyrics-active]');
        return panel !== null
          && panel.classList.contains('is-static')
          && document.querySelector('[data-hifi-centered-now-playing]') === null
          && panel.textContent?.includes('Untrusted AirPlay line one')
          && activeLine === null
          && document.querySelector('.ambient-lyrics-ticker') === null;
      })()
    `,
    "Hi-Fi AirPlay lyrics with an untrusted clock stay on a static wall without false highlight"
  );
  await wait(1500);
  await expect(
    client,
    `
      (() => {
        const activeLine = document.querySelector('[data-hifi-lyrics-line][data-hifi-lyrics-active]');
        const panel = document.querySelector('[data-hifi-lyrics-panel]');
        return activeLine === null
          && panel?.classList.contains('is-static')
          && panel.textContent?.includes('Untrusted AirPlay line one');
      })()
    `,
    "Hi-Fi AirPlay lyrics do not create an active line from an untrusted elapsed clock"
  );
  const airplayEstimatedSyncedLyricsPatchVersion = await setStatePatchMode(client, "airplayEstimatedSyncedLyrics");
  await waitForStatePatchRefresh(client, airplayEstimatedSyncedLyricsPatchVersion, "AirPlay estimated synced lyrics fixture refreshes");
  await expectEventually(
    client,
    `
      (() => {
        const activeLine = document.querySelector('[data-hifi-lyrics-line][data-hifi-lyrics-active]');
        const activeText = activeLine?.textContent?.trim() ?? "";
        return activeText.includes('Estimated AirPlay line two')
          && document.querySelector('.ambient-lyrics-ticker') === null;
      })()
    `,
    "Hi-Fi AirPlay lyrics accept an estimated clock for active line selection"
  );
  await wait(2600);
  await expectEventually(
    client,
    `
      (() => {
        const activeLine = document.querySelector('[data-hifi-lyrics-line][data-hifi-lyrics-active]');
        const activeText = activeLine?.textContent?.trim() ?? "";
        return activeText.includes('Estimated AirPlay line three');
      })()
    `,
    "Hi-Fi AirPlay estimated lyrics advance from the local clock"
  );
  await evaluate(client, "document.querySelector('.ambient-transport button[aria-label=\"Hide lyrics\"]')?.click(); true");
  await setStatePatchMode(client, "");
  await wait(3300);
  await evaluate(client, "document.querySelector('[data-ambient-source-toggle]')?.click()");
  await expectEventually(
    client,
    "document.querySelectorAll('[data-ambient-source-picker] [data-ambient-source-option]').length === 7 && document.querySelector('[data-ambient-source-option=\"web-mode\"] strong')?.textContent === 'Explore'",
    "Hi-Fi source picker opens six source choices plus Explore"
  );
  await expect(
    client,
    `
      (() => {
        const picker = document.querySelector('[data-ambient-source-picker]');
        const transport = document.querySelector('.ambient-transport.is-hifi');
        const options = [...document.querySelectorAll('[data-ambient-source-picker] [data-ambient-source-option]')];
        if (!(picker instanceof HTMLElement) || !(transport instanceof HTMLElement) || options.length !== 7) return false;
        const pickerRect = picker.getBoundingClientRect();
        const transportRect = transport.getBoundingClientRect();
        const tops = options.map((option) => option.getBoundingClientRect().top);
        const pickerCenter = pickerRect.left + pickerRect.width / 2;
        const transportCenter = transportRect.left + transportRect.width / 2;
        return Math.max(...tops) - Math.min(...tops) < 2
          && pickerRect.left >= 0
          && pickerRect.right <= window.innerWidth
          && pickerRect.height <= 122
          && pickerRect.bottom <= transportRect.top + 8
          && Math.abs(pickerCenter - transportCenter) <= 18;
      })()
    `,
    "Hi-Fi source picker renders as a compact shelf above the transport"
  );
  await wait(5200);
  await expectEventually(client, "document.querySelector('[data-ambient-source-picker]') === null", "Hi-Fi source picker auto-closes after 5 seconds");
  await switchHifiAmbientSource(client, "radio", "Hi-Fi source picker exposes Radio", "Hi-Fi source picker switches immediately to Radio");
  await expectEventually(client, "document.querySelector('[data-ambient-source-toggle]:not(:disabled)') !== null", "Hi-Fi source toggle is ready after Radio");
  await switchHifiAmbientSource(client, "bluetooth", "Hi-Fi source picker exposes Bluetooth", "Hi-Fi source picker switches immediately to Bluetooth waiting state");
  await expectEventually(client, "document.querySelector('[data-ambient-source-toggle]:not(:disabled)') !== null", "Hi-Fi source toggle is ready after Bluetooth");
  await switchHifiAmbientSource(client, "airplay", "Hi-Fi source picker exposes AirPlay after Bluetooth", "Hi-Fi source picker switches from Bluetooth to AirPlay waiting state");
  await expectEventually(client, "document.querySelector('[data-ambient-source-toggle]:not(:disabled)') !== null", "Hi-Fi source toggle is ready after AirPlay");
  await switchHifiAmbientSource(client, "bluetooth", "Hi-Fi source picker exposes Bluetooth after AirPlay", "Hi-Fi source picker switches from AirPlay to Bluetooth waiting state");
  await expectEventually(client, "document.querySelector('[data-ambient-source-toggle]:not(:disabled)') !== null", "Hi-Fi source toggle is ready after AirPlay-to-Bluetooth");
  await switchHifiAmbientSource(client, "airplay", "Hi-Fi source picker exposes AirPlay after AirPlay-to-Bluetooth", "Hi-Fi source picker returns from Bluetooth to AirPlay waiting state");
  await expectEventually(client, "document.querySelector('[data-ambient-source-toggle]:not(:disabled)') !== null", "Hi-Fi source toggle is ready after AirPlay return");
  await switchHifiAmbientSource(client, "mpd", "Hi-Fi source picker exposes Library after AirPlay", "Hi-Fi source picker switches back to Library after AirPlay");
  await expectEventually(client, "document.querySelector('[data-ambient-source-toggle]:not(:disabled)') !== null", "Hi-Fi source toggle is ready after Library");
  await switchHifiAmbientSource(client, "bluetooth", "Hi-Fi source picker exposes Bluetooth after Library", "Hi-Fi source picker switches from Library to Bluetooth waiting state");
  await evaluate(
    client,
    `
      fetch('/api/v1/audio/source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'radio' })
      }).then((response) => response.ok)
    `
  );
  await expectEventuallyEvaluate(
    client,
    "fetch('/api/v1/system/state').then((response) => response.json()).then((state) => state.audio.currentSource.id === 'radio' && state.playback.source === 'radio')",
    "Hi-Fi source picker regression establishes Radio fixture for preserve-source checks"
  );
  await switchRoomModeAndNavigate(client, "focus", "Focus room mode is active before Hi-Fi preserve-source check");
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
  await expectEventuallyEvaluate(
    client,
    "fetch('/api/v1/system/state').then((response) => response.json()).then((state) => document.querySelector('.ambient-screen')?.getAttribute('data-room-mode') === 'hifi' && state.audio.currentSource.id === 'radio' && state.playback.source === 'radio')",
    "Hi-Fi entry preserves the current Radio source"
  );
  await switchRoomModeAndNavigate(client, "focus", "Focus room mode is active before Hi-Fi different remembered station preserve check");
  const differentRadioPatchVersion = await setStatePatchMode(client, "hifiRememberedDifferentRadio");
  await waitForStatePatchRefresh(client, differentRadioPatchVersion, "Hi-Fi different remembered Radio fixture refreshes");
  await evaluate(
    client,
    `
      (() => {
        window.__tikpalRememberedRadioRequests = [];
        window.__tikpalRememberedRadioOriginalFetch = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          const rawUrl = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
          const pathname = new URL(rawUrl, window.location.href).pathname;
          if (pathname === '/api/v1/audio/source') {
            const body = JSON.parse(String(init?.body ?? '{}'));
            window.__tikpalRememberedRadioRequests.push(body);
            if (body.target === 'radio') {
              const response = await window.__tikpalRememberedRadioOriginalFetch('/api/v1/system/state');
              const state = await response.json();
              const next = JSON.parse(JSON.stringify(state));
              next.audio.sources = next.audio.sources.map((source) => {
                const patched = {
                  ...source,
                  active: source.id === 'radio',
                  armed: false,
                  connectionState: source.id === 'radio' ? 'idle' : source.connectionState,
                  connectedLabel: null
                };
                if (source.id === 'radio') {
                  patched.radioStationId = body.radioStationId ?? null;
                  patched.secondaryStatus = 'Focus - Soma FM Groove Salad active';
                }
                return patched;
              });
              next.audio.currentSource = next.audio.sources.find((source) => source.id === 'radio') ?? next.audio.currentSource;
              next.audio.rememberedSource = {
                target: 'radio',
                localTrackPath: null,
                radioStationId: body.radioStationId ?? null,
                updatedAt: new Date().toISOString()
              };
              next.playback = {
                ...next.playback,
                state: 'playing',
                source: 'radio',
                albumArtUrl: '/api/v1/media/radio-logo?stationId=' + encodeURIComponent(body.radioStationId ?? ''),
                title: 'Focus - Soma FM Groove Salad',
                artist: 'Internet Radio',
                album: 'Focus - Soma FM Groove Salad'
              };
              return new Response(JSON.stringify(next), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              });
            }
          }
          return window.__tikpalRememberedRadioOriginalFetch(input, init);
        };
        return true;
      })()
    `
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
  await wait(1800);
  await expect(
    client,
    "!(window.__tikpalRememberedRadioRequests ?? []).some((body) => body.target === 'radio')",
    "Hi-Fi entry preserves the current Radio station instead of restoring a different remembered station"
  );
  await expectEventuallyEvaluate(
    client,
    "fetch('/api/v1/system/state').then((response) => response.json()).then((state) => state.audio.currentSource.id === 'radio' && state.audio.currentSource.radioStationId === 'radio-500')",
    "Hi-Fi entry keeps the current Radio station when rememberedSource differs"
  );
  await evaluate(
    client,
    `
      (() => {
        if (window.__tikpalRememberedRadioOriginalFetch) {
          window.fetch = window.__tikpalRememberedRadioOriginalFetch;
          delete window.__tikpalRememberedRadioOriginalFetch;
        }
        return true;
      })()
    `
  );
  await switchRoomModeAndNavigate(client, "focus", "Focus room mode is active before delayed Hi-Fi remembered station preserve check");
  const pendingRadioPatchVersion = await setStatePatchMode(client, "hifiRememberedRadioPendingMemory");
  await waitForStatePatchRefresh(client, pendingRadioPatchVersion, "Hi-Fi pending remembered Radio fixture refreshes");
  await evaluate(
    client,
    `
      (() => {
        window.__tikpalRememberedRadioRequests = [];
        window.__tikpalRememberedRadioOriginalFetch = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          const rawUrl = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
          const pathname = new URL(rawUrl, window.location.href).pathname;
          if (pathname === '/api/v1/audio/source') {
            const body = JSON.parse(String(init?.body ?? '{}'));
            window.__tikpalRememberedRadioRequests.push(body);
            if (body.target === 'radio') {
              const response = await window.__tikpalRememberedRadioOriginalFetch('/api/v1/system/state');
              const state = await response.json();
              const next = JSON.parse(JSON.stringify(state));
              next.audio.sources = next.audio.sources.map((source) => {
                const patched = {
                  ...source,
                  active: source.id === 'radio',
                  armed: false,
                  connectionState: source.id === 'radio' ? 'idle' : source.connectionState,
                  connectedLabel: null
                };
                if (source.id === 'radio') {
                  patched.radioStationId = body.radioStationId ?? null;
                  patched.secondaryStatus = 'Focus - Soma FM Groove Salad active';
                }
                return patched;
              });
              next.audio.currentSource = next.audio.sources.find((source) => source.id === 'radio') ?? next.audio.currentSource;
              next.audio.rememberedSource = {
                target: 'radio',
                localTrackPath: null,
                radioStationId: body.radioStationId ?? null,
                updatedAt: new Date().toISOString()
              };
              next.playback = {
                ...next.playback,
                state: 'playing',
                source: 'radio',
                albumArtUrl: '/api/v1/media/radio-logo?stationId=' + encodeURIComponent(body.radioStationId ?? ''),
                title: 'Focus - Soma FM Groove Salad',
                artist: 'Internet Radio',
                album: 'Focus - Soma FM Groove Salad'
              };
              return new Response(JSON.stringify(next), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              });
            }
          }
          return window.__tikpalRememberedRadioOriginalFetch(input, init);
        };
        return true;
      })()
    `
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
  await wait(350);
  const delayedRadioPatchVersion = await setStatePatchMode(client, "hifiRememberedDifferentRadio");
  await waitForStatePatchRefresh(client, delayedRadioPatchVersion, "Hi-Fi delayed remembered Radio fixture refreshes");
  await wait(1800);
  await expect(
    client,
    "!(window.__tikpalRememberedRadioRequests ?? []).some((body) => body.target === 'radio')",
    "Hi-Fi initial load preserves current Radio when rememberedSource arrives after the Hi-Fi edge"
  );
  await evaluate(
    client,
    `
      (() => {
        if (window.__tikpalRememberedRadioOriginalFetch) {
          window.fetch = window.__tikpalRememberedRadioOriginalFetch;
          delete window.__tikpalRememberedRadioOriginalFetch;
        }
        window.__tikpalRememberedRadioRequests = [];
        window.__tikpalSmokeStatePatchMode = "";
        return true;
      })()
    `
  );
  await switchRoomModeAndNavigate(client, "focus", "Focus room mode is active before same Hi-Fi remembered station preserve check");
  const sameRadioPatchVersion = await setStatePatchMode(client, "hifiRememberedSameRadio");
  await waitForStatePatchRefresh(client, sameRadioPatchVersion, "Hi-Fi same remembered Radio fixture refreshes");
  await evaluate(
    client,
    `
      (() => {
        window.__tikpalRememberedRadioRequests = [];
        window.__tikpalRememberedRadioOriginalFetch = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          const rawUrl = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
          const pathname = new URL(rawUrl, window.location.href).pathname;
          if (pathname === '/api/v1/audio/source') {
            window.__tikpalRememberedRadioRequests.push(JSON.parse(String(init?.body ?? '{}')));
          }
          return window.__tikpalRememberedRadioOriginalFetch(input, init);
        };
        return true;
      })()
    `
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
  await wait(1800);
  await expect(
    client,
    "!(window.__tikpalRememberedRadioRequests ?? []).some((body) => body.target === 'radio')",
    "Hi-Fi entry does not request Radio restore when the remembered station is already current"
  );
  await evaluate(
    client,
    `
      (() => {
        if (window.__tikpalRememberedRadioOriginalFetch) {
          window.fetch = window.__tikpalRememberedRadioOriginalFetch;
          delete window.__tikpalRememberedRadioOriginalFetch;
        }
        window.__tikpalRememberedRadioRequests = [];
        window.__tikpalSmokeStatePatchMode = "";
        return true;
      })()
    `
  );
  await switchRoomModeAndNavigate(client, "focus", "Focus room mode is active before Hi-Fi remembered Library preserve check");
  const differentLibraryPatchVersion = await setStatePatchMode(client, "hifiRememberedDifferentLibrary");
  await waitForStatePatchRefresh(client, differentLibraryPatchVersion, "Hi-Fi different remembered Library fixture refreshes");
  await evaluate(
    client,
    `
      (() => {
        window.__tikpalRememberedLibraryRequests = [];
        window.__tikpalRememberedLibraryOriginalFetch = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          const rawUrl = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
          const pathname = new URL(rawUrl, window.location.href).pathname;
          if (pathname === '/api/v1/audio/source') {
            const body = JSON.parse(String(init?.body ?? '{}'));
            window.__tikpalRememberedLibraryRequests.push(body);
            if (body.target === 'mpd') {
              const response = await window.__tikpalRememberedLibraryOriginalFetch('/api/v1/system/state');
              const state = await response.json();
              const next = JSON.parse(JSON.stringify(state));
              next.audio.sources = next.audio.sources.map((source) => ({
                ...source,
                active: source.id === 'mpd',
                armed: false,
                connectionState: source.id === 'mpd' ? 'idle' : source.connectionState,
                connectedLabel: null
              }));
              next.audio.currentSource = next.audio.sources.find((source) => source.id === 'mpd') ?? next.audio.currentSource;
              next.audio.rememberedSource = {
                target: 'mpd',
                localTrackPath: body.localTrackPath ?? null,
                radioStationId: null,
                updatedAt: new Date().toISOString()
              };
              next.playback = {
                ...next.playback,
                state: 'playing',
                source: 'mpd',
                albumArtUrl: '/api/v1/media/library-cover?track=smoke',
                title: 'Good Night',
                artist: 'FASSounds',
                album: 'Lo-fi Ambient',
                elapsedSeconds: 0,
                durationSeconds: 147,
                currentTrackIndex: 1,
                queueLength: 3,
                queuePreview: [{
                  id: 'Codex/' + String(body.localTrackPath ?? ''),
                  position: 1,
                  title: 'Good Night',
                  artist: 'FASSounds',
                  album: 'Lo-fi Ambient',
                  durationSeconds: 147,
                  active: true
                }]
              };
              return new Response(JSON.stringify(next), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              });
            }
          }
          return window.__tikpalRememberedLibraryOriginalFetch(input, init);
        };
        return true;
      })()
    `
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
  await wait(1800);
  await expect(
    client,
    "!(window.__tikpalRememberedLibraryRequests ?? []).some((body) => body.target === 'mpd')",
    "Hi-Fi entry preserves the current source instead of restoring a remembered Library track"
  );
  await expectEventuallyEvaluate(
    client,
    "fetch('/api/v1/system/state').then((response) => response.json()).then((state) => state.audio.currentSource.id === 'radio')",
    "Hi-Fi entry keeps Radio when rememberedSource points at Library"
  );
  await evaluate(
    client,
    `
      (() => {
        if (window.__tikpalRememberedLibraryOriginalFetch) {
          window.fetch = window.__tikpalRememberedLibraryOriginalFetch;
          delete window.__tikpalRememberedLibraryOriginalFetch;
        }
        return true;
      })()
    `
  );
  await switchRoomModeAndNavigate(client, "focus", "Focus room mode is active before same Hi-Fi remembered Library preserve check");
  const sameLibraryPatchVersion = await setStatePatchMode(client, "hifiRememberedSameLibrary");
  await waitForStatePatchRefresh(client, sameLibraryPatchVersion, "Hi-Fi same remembered Library fixture refreshes");
  await evaluate(
    client,
    `
      (() => {
        window.__tikpalRememberedLibraryRequests = [];
        window.__tikpalRememberedLibraryOriginalFetch = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          const rawUrl = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
          const pathname = new URL(rawUrl, window.location.href).pathname;
          if (pathname === '/api/v1/audio/source') {
            window.__tikpalRememberedLibraryRequests.push(JSON.parse(String(init?.body ?? '{}')));
          }
          return window.__tikpalRememberedLibraryOriginalFetch(input, init);
        };
        return true;
      })()
    `
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
  await wait(1800);
  await expect(
    client,
    "!(window.__tikpalRememberedLibraryRequests ?? []).some((body) => body.target === 'mpd')",
    "Hi-Fi entry does not request Library restore when the remembered track is already current"
  );
  await evaluate(
    client,
    `
      (() => {
        if (window.__tikpalRememberedLibraryOriginalFetch) {
          window.fetch = window.__tikpalRememberedLibraryOriginalFetch;
          delete window.__tikpalRememberedLibraryOriginalFetch;
        }
        window.__tikpalRememberedLibraryRequests = [];
        window.__tikpalSmokeStatePatchMode = "";
        return true;
      })()
    `
  );
  await expect(
    client,
    "document.querySelector('.ambient-transport [data-hifi-playlist-entry]') === null && document.querySelector('.playlist-overlay') === null",
    "Hi-Fi ambient transport omits playlist editing entry"
  );
  await expect(client, "document.querySelector('[data-hifi-player-entry]') !== null", "Hi-Fi ambient transport exposes Player entry");
  await evaluate(client, "document.querySelector('[data-hifi-player-entry]')?.click();");
  await expectEventually(client, "document.querySelector('.player-overlay.is-active') !== null", "Hi-Fi Player entry opens Player");
  await navigate(client, APP_URL);
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
    "document.querySelectorAll('[data-ambient-source-picker] [data-ambient-source-option]').length === 7 && document.querySelector('[data-ambient-source-option=\"web-mode\"] strong')?.textContent === 'Explore'",
    "ambient scene single tap opens six source choices plus Explore"
  );
  await expect(
    client,
    `
      (() => {
        const options = [...document.querySelectorAll('[data-ambient-source-picker] [data-ambient-source-option]')];
        if (options.length !== 7) return false;
        const tops = options.map((option) => option.getBoundingClientRect().top);
        return Math.max(...tops) - Math.min(...tops) < 2;
      })()
    `,
    "ambient source picker keeps Explore on the first row"
  );
  await expect(
    client,
    `
      (() => {
        const statuses = [...document.querySelectorAll('[data-ambient-source-picker] [data-ambient-source-option] span:last-child')]
          .map((entry) => entry.textContent?.trim());
        return statuses.includes('Active')
          && statuses.filter((status) => status === 'Ready').length >= 4
          && !statuses.includes('Closed')
          && !statuses.includes('Blocked');
      })()
    `,
    "ambient source picker uses unified source status labels"
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
                  audioGainDb: 0,
                  source: 'scene'
                },
                {
                  id: 'rainy-window',
                  filename: 'Rainy-Window.mp4',
                  label: 'Rainy Window',
                  src: ${JSON.stringify(`${interactionSceneVideoSrc}?ota=rainy`)},
                  order: 30,
                  roomModes: ['calm'],
                  audioGainDb: 11.1,
                  source: 'scene'
                },
	                {
	                  id: 'focus-smoke-scene',
	                  filename: 'Focus-Smoke.mp4',
	                  label: 'Focus Smoke',
	                  src: ${JSON.stringify(`${interactionSceneVideoSrc}?ota=focus`)},
	                  order: 40,
	                  roomModes: ['focus'],
	                  audioGainDb: -6.2,
	                  source: 'scene'
	                },
	                {
	                  id: 'sleep-smoke-scene',
	                  filename: 'Sleep-Smoke.mp4',
	                  label: 'Sleep Smoke',
	                  src: ${JSON.stringify(`${interactionSceneVideoSrc}?ota=sleep`)},
	                  order: 50,
	                  roomModes: ['sleep'],
	                  audioGainDb: -8.4,
	                  source: 'scene'
	                }
	              ],
	              total: 4,
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
	  const singleLoopPatchVersion = await setStatePatchMode(client, "singleLoopScene");
	  await waitForStatePatchRefresh(client, singleLoopPatchVersion, "single-loop scene fixture refreshes");
	  await expectEventually(client, "document.querySelector('.flame-scene')?.getAttribute('data-flame-loop-mode') === 'single'", "ambient scene test runs through single-loop mode");
	  await expect(
	    client,
	    `
      (() => {
        const logo = document.querySelector('.scene-logo-backdrop .scene-logo-mark');
        return logo instanceof HTMLImageElement
          && logo.complete
          && logo.naturalWidth > 0
          && document.querySelector('.fireplace-backdrop') === null;
      })()
    `,
    "scene fallback uses loaded Tikpal logo without fireplace backdrop"
  );
  await expectEventually(
    client,
    `
      (() => {
        const activeVideo = [...document.querySelectorAll('.flame-video[data-flame-layer="active"]')]
          .find((video) => video instanceof HTMLVideoElement
            && Boolean(video.getAttribute('src'))
            && !video.getAttribute('src')?.includes('ota=rainy')
            && video.getAttribute('data-flame-loop-role') === 'active');
        return activeVideo instanceof HTMLVideoElement
          && activeVideo.readyState >= 2
          && activeVideo.videoWidth > 0;
      })()
    `,
    "ambient active scene is drawable before scene switch",
    50,
    150
  );
  await installSceneTransitionObserver(client);
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
  try {
    await expectEventually(
      client,
      `
	        (() => {
	          const snapshots = window.__tikpalSceneTransitionSnapshots ?? [];
	          const sawOutgoingDuringDim = snapshots.some((snapshot) => snapshot.phase === 'dimming'
	            && (snapshot.allSrcs ?? snapshot.activeSrcs).some((src) => src && !src.includes('ota=rainy')));
	          const sawPreparedIncoming = snapshots.some((snapshot) => snapshot.loopMode === 'single'
	            && snapshot.phase === 'dimming'
	            && snapshot.videoLayers?.some((video) => video.layer === 'active' && video.src && !video.src.includes('ota=rainy'))
	            && snapshot.videoLayers?.some((video) => video.layer === 'incoming' && video.src?.includes('ota=rainy') && video.frameReady === 'true'));
	          return sawOutgoingDuringDim
	            && sawPreparedIncoming
	            && snapshots.some((snapshot) => snapshot.phase === 'revealing'
	              && snapshot.activeSrcs.some((src) => src.includes('ota=rainy')));
	        })()
      `,
      "ambient scene switch records dim/reveal without blanking"
    );
  } catch (error) {
    const snapshots = await evaluate(client, "JSON.stringify((window.__tikpalSceneTransitionSnapshots ?? []).slice(-12), null, 2)");
    const videos = await evaluate(
      client,
      `
        JSON.stringify([...document.querySelectorAll('.flame-video')].map((video) => ({
          src: video.getAttribute('src'),
          layer: video.getAttribute('data-flame-layer'),
          slot: video.getAttribute('data-flame-slot-index'),
          role: video.getAttribute('data-flame-loop-role'),
          phase: video.getAttribute('data-flame-loop-phase'),
          frameReady: video.getAttribute('data-flame-frame-ready'),
          readyState: video.readyState,
          networkState: video.networkState,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          currentTime: video.currentTime,
          duration: video.duration,
          paused: video.paused,
          ended: video.ended
        })), null, 2)
      `
    );
    console.error(`scene transition snapshots:\n${snapshots}`);
    console.error(`scene videos:\n${videos}`);
    throw error;
  }
  await expectEventually(
    client,
    `
      (() => {
        const activeVideo = [...document.querySelectorAll('.flame-video[data-flame-layer="active"]')]
          .find((video) => video instanceof HTMLVideoElement
            && video.getAttribute('src')?.includes('ota=rainy')
            && video.getAttribute('data-flame-loop-role') === 'active');
        return activeVideo instanceof HTMLVideoElement
          && activeVideo.readyState >= 2
          && activeVideo.videoWidth > 0
          && activeVideo.getAttribute('data-flame-frame-ready') === 'true'
          && Number.parseFloat(activeVideo.getAttribute('data-scene-gain-db') ?? 'NaN') === 11.1
          && document.querySelector('.flame-video[poster]') === null
          && document.querySelector('.fireplace-backdrop') === null;
      })()
    `,
    "ambient scene switch reveals decoded OTA video with gain and without poster fallback"
  );
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
      (() => {
        const activeSceneVideo = [...document.querySelectorAll('.flame-video[data-flame-layer="active"]')]
          .find((video) => video instanceof HTMLVideoElement
            && video.getAttribute('data-flame-loop-role') === 'active');
        return document.querySelector('.ambient-screen')?.getAttribute('data-room-mode') === 'focus'
          && activeSceneVideo instanceof HTMLVideoElement
          && activeSceneVideo.readyState >= 2
          && activeSceneVideo.getAttribute('data-flame-frame-ready') === 'true'
          && Number.isFinite(Number.parseFloat(activeSceneVideo.getAttribute('data-scene-gain-db') ?? 'NaN'))
          && document.querySelector('.flame-video[poster]') === null
          && document.querySelector('.fireplace-backdrop') === null;
      })()
    `,
	    "room mode scene switching keeps a decoded active scene with gain",
	    40,
	    150
	  );
	  await installSceneTransitionObserver(client);
	  await evaluate(
	    client,
	    `
	      (() => {
	        const button = [...document.querySelectorAll('.ambient-room-mode-buttons button')]
	          .find((node) => node.textContent?.trim() === 'Sleep');
	        button?.click();
	        return Boolean(button);
	      })()
	    `
	  );
	  await expectEventually(
	    client,
	    `
	      (() => {
	        const activeVideo = [...document.querySelectorAll('.flame-video[data-flame-layer="active"]')]
	          .find((video) => video instanceof HTMLVideoElement
	            && video.getAttribute('data-flame-loop-role') === 'active');
	        const snapshots = window.__tikpalSceneTransitionSnapshots ?? [];
	        return document.querySelector('.ambient-screen')?.getAttribute('data-room-mode') === 'sleep'
	          && activeVideo instanceof HTMLVideoElement
	          && activeVideo.getAttribute('src')?.includes('ota=sleep')
	          && activeVideo.readyState >= 2
	          && activeVideo.getAttribute('data-flame-frame-ready') === 'true'
	          && snapshots.some((snapshot) => snapshot.loopMode === 'single'
	            && snapshot.phase === 'dimming'
	            && snapshot.videoLayers?.some((video) => video.layer === 'active' && video.src && !video.src.includes('ota=sleep'))
	            && snapshot.videoLayers?.some((video) => video.layer === 'incoming' && video.src?.includes('ota=sleep') && video.frameReady === 'true'));
	      })()
	    `,
	    "single-loop Sleep mode keeps outgoing scene until incoming is drawable",
	    50,
	    150
	  );
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
	  await expectEventually(
	    client,
	    `
	      (() => {
	        const activeVideo = [...document.querySelectorAll('.flame-video[data-flame-layer="active"]')]
	          .find((video) => video instanceof HTMLVideoElement
	            && video.getAttribute('data-flame-loop-role') === 'active');
	        return document.querySelector('.ambient-screen')?.getAttribute('data-room-mode') === 'calm'
	          && activeVideo instanceof HTMLVideoElement
	          && activeVideo.readyState >= 2
	          && activeVideo.getAttribute('data-flame-frame-ready') === 'true'
	          && activeVideo.getAttribute('src')?.includes('ota=rainy');
	      })()
	    `,
	    "single-loop Calm mode returns to a decoded scene",
	    50,
	    150
	  );
	  await setStatePatchMode(client, "");

  await wait(5600);
  await expect(client, "document.querySelector('.ambient-screen.is-hud-hidden') !== null", "ambient HUD auto hides after tap show");

  await wheel(client, 220);
  await expectEventually(
    client,
    "document.querySelector('.quick-settings.is-active') !== null && document.querySelector('.playlist-overlay') === null",
    "ambient wheel down opens Console instead of playlist"
  );
  await evaluate(client, "document.querySelector('.overlay-backdrop')?.click();");
  await expectEventually(client, "document.querySelector('.quick-settings.is-active') === null", "Console backdrop exits to ambient");

  await navigate(client, `${APP_URL}?mode=playlist`);
  await expect(
    client,
    "document.querySelector('.ambient-screen') !== null && document.querySelector('.playlist-overlay') === null",
    "legacy playlist URL falls back to Ambient"
  );

  await evaluate(
    client,
    `
      fetch('/api/v1/experience/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'set_mode', mode: 'calm' })
      })
        .then(() => fetch('/api/v1/experience/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'set_scene_sound', sceneSoundEnabled: false })
        }))
        .then(() => fetch('/api/v1/playback/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'volume_set', value: 58 })
        }))
        .then(() => fetch('/api/v1/system/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'brightness_set', value: 64 })
        }))
        .then(() => fetch('/api/v1/audio/source', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: 'mpd' })
        }))
        .then(() => true)
    `
  );
  await expectEventuallyEvaluate(
    client,
    "fetch('/api/v1/system/state').then((response) => response.json()).then((state) => state.audio.currentSource.id === 'mpd' && state.playback.source === 'mpd' && state.audio.rememberedSource?.target === 'mpd')",
    "quick menu scene checks start from remembered Library playback"
  );
  await navigate(client, `${APP_URL}?mode=quickMenu`);
  await expect(client, "document.querySelector('.quick-menu.is-active') !== null", "quick menu opens");
  await expectEventually(client, "document.querySelector('.ambient-screen')?.getAttribute('data-room-mode') === 'calm'", "quick menu scene checks run outside Hi-Fi mode");
  await expect(
    client,
    `
      (() => {
        const text = document.querySelector('.quick-menu-panel')?.textContent ?? '';
        const timeLabel = document.querySelector('[data-quick-menu-toggle="time"] span')?.textContent?.trim() ?? '';
        const sleepLabel = document.querySelector('[data-quick-menu-toggle="sleep"] span')?.textContent?.trim() ?? '';
        return document.querySelectorAll('.quick-menu-panel [data-quick-menu-toggle]').length === 4
          && text.includes('Screen')
          && !text.includes('Room Mode')
          && text.includes('Volume')
          && text.includes('Time')
          && text.includes('Sleep')
          && ['Visible', 'Hidden'].includes(timeLabel)
          && ['Tap to sleep', 'Syncing'].includes(sleepLabel)
          && !text.includes('Tap wake')
          && !text.includes('Hi-Fi EQ')
          && !text.includes('Scene Sound')
          && !text.includes('Unavailable')
          && !text.includes('Flame')
          && !text.includes('Screen Off');
      })()
    `,
    "quick menu exposes screen, volume, time, and sleep toggles without stale labels"
  );

  await evaluate(
    client,
    `
      (async () => {
        const state = await fetch('/api/v1/system/state').then((response) => response.json());
        window.__tikpalQuickMenuScreenBeforeVolume = state.system.volume.percent;
        document.querySelector('[data-quick-menu-toggle="screen"]')?.click();
        return true;
      })()
    `
  );
  await expectEventually(client, "document.querySelector('.screen-off-overlay') !== null && document.querySelector('.quick-menu.is-active') === null", "quick menu screen toggle enters a black tap-to-wake overlay");
  await expectEventuallyEvaluate(
    client,
    "fetch('/api/v1/system/state').then((response) => response.json()).then((state) => state.system.volume.percent === window.__tikpalQuickMenuScreenBeforeVolume)",
    "quick menu screen toggle keeps global volume unchanged"
  );
  await evaluate(client, "document.querySelector('.screen-off-overlay')?.click();");
  await expectEventually(client, "document.querySelector('.screen-off-overlay') === null", "single tap wakes the quick menu screen overlay");

  await navigate(client, `${APP_URL}?mode=quickMenu`);

  await evaluate(
    client,
    `
      (() => {
        document.querySelector('[data-quick-menu-toggle="time"]')?.click();
        return true;
      })()
    `
  );
  await expect(client, "document.querySelector('.ambient-clock') === null", "quick menu clock toggle hides ambient clock");
  await evaluate(client, "document.querySelector('[data-quick-menu-toggle=\"time\"]')?.click();");
  await expectEventually(
    client,
    `
      (() => {
        const time = document.querySelector('[data-quick-menu-toggle="time"]');
        const screen = document.querySelector('[data-quick-menu-toggle="screen"]');
        if (!(time instanceof HTMLElement) || !(screen instanceof HTMLElement)) return false;
        return document.querySelector('.ambient-clock') !== null
          && time.getAttribute('aria-pressed') === 'true'
          && time.classList.contains('is-on')
          && getComputedStyle(time).borderColor === getComputedStyle(screen).borderColor;
      })()
    `,
    "quick menu clock toggle restores active state border"
  );

  await evaluate(
    client,
    `
      (async () => {
        const state = await fetch('/api/v1/system/state').then((response) => response.json());
        window.__tikpalQuickMenuVolumeBefore = state.system.volume.percent;
        document.querySelector('[data-quick-menu-toggle="volume"]')?.click();
        return true;
      })()
    `
  );
  await expectEventuallyEvaluate(
    client,
    "fetch('/api/v1/system/state').then((response) => response.json()).then((state) => state.system.volume.percent === 0)",
    "quick menu volume toggle mutes the global API volume"
  );
  await expectEventually(client, "document.querySelector('[data-quick-menu-toggle=\"volume\"]')?.getAttribute('aria-pressed') === 'false'", "quick menu volume toggle shows muted state");
  await evaluate(client, "document.querySelector('[data-quick-menu-toggle=\"volume\"]')?.click();");
  await expectEventuallyEvaluate(
    client,
    "fetch('/api/v1/system/state').then((response) => response.json()).then((state) => state.system.volume.percent === window.__tikpalQuickMenuVolumeBefore)",
    "quick menu volume toggle restores the previous global volume"
  );

  await evaluate(
    client,
    `
      (async () => {
        const state = await fetch('/api/v1/system/state').then((response) => response.json());
        window.__tikpalQuickMenuSleepBefore = {
          brightness: state.system.display.brightnessPercent,
          volume: state.system.volume.percent
        };
        document.querySelector('[data-quick-menu-toggle="sleep"]')?.click();
        return true;
      })()
    `
  );
  await expectEventually(client, "document.querySelector('.system-sleep-overlay') !== null && document.querySelector('.quick-menu.is-active') === null", "quick menu sleep enters a black tap-to-wake overlay");
  await expectEventuallyEvaluate(
    client,
    "fetch('/api/v1/system/state').then((response) => response.json()).then((state) => state.system.volume.percent === 0 && state.system.display.brightnessPercent === 0)",
    "quick menu sleep mutes volume and lowers brightness"
  );
  await evaluate(client, "document.querySelector('.system-sleep-overlay')?.click();");
  await expectEventually(
    client,
    "document.querySelector('.system-sleep-overlay') === null",
    "single tap wakes the quick menu sleep overlay",
    35,
    120
  );
  await expectEventuallyEvaluate(
    client,
    "fetch('/api/v1/system/state').then((response) => response.json()).then((state) => state.system.volume.percent === window.__tikpalQuickMenuSleepBefore.volume && state.system.display.brightnessPercent === window.__tikpalQuickMenuSleepBefore.brightness)",
    "quick menu sleep wake restores brightness and volume"
  );

  await navigate(client, APP_URL);
  await evaluate(client, "document.querySelector('.ambient-transport-sound')?.click();");
  await expectEventually(client, "document.querySelector('.ambient-transport-sound')?.getAttribute('aria-pressed') === 'true'", "ambient scene sound toggle turns on");
  await expectEventually(
    client,
    `
      (() => {
        const video = document.querySelector('.flame-video.is-active');
        return video instanceof HTMLVideoElement
          && !document.querySelector('.flame-scene.is-video-off')
          && video.muted === false
          && video.paused === false
          && Number.isFinite(Number.parseFloat(video.getAttribute('data-scene-gain-db') ?? 'NaN'));
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
        return video instanceof HTMLVideoElement
          && video.paused === false
          && video.muted === false
          && Number.parseFloat(video.getAttribute('data-scene-volume') ?? '0') > 0;
      })()
    `,
    "scene sound active video has nonzero volume before scene switch"
  );
  await installSceneTransitionObserver(client);
  await evaluate(
    client,
    `
      (async () => {
        const activeVideo = document.querySelector('.flame-video[data-flame-layer="active"][data-flame-loop-role="active"]');
        const experience = await fetch('/api/v1/experience/state').then((response) => response.json());
        window.__tikpalSceneSoundSwitchBefore = {
          sceneVideoId: experience.sceneVideoId,
          volume: Number.parseFloat(activeVideo?.getAttribute('data-scene-volume') ?? '0'),
          gainDb: Number.parseFloat(activeVideo?.getAttribute('data-scene-gain-db') ?? 'NaN'),
          src: activeVideo?.getAttribute('src') ?? ''
        };
        document.querySelector('.ambient-transport-scene-next')?.click();
        return true;
      })()
    `
  );
  await expectEventuallyEvaluate(
    client,
    "fetch('/api/v1/experience/state').then((response) => response.json()).then((experience) => experience.sceneVideoId !== window.__tikpalSceneSoundSwitchBefore?.sceneVideoId && experience.sceneVideoByMode?.calm === experience.sceneVideoId)",
    "Ambient next scene persists the calm scene selection"
  );
  await expectEventually(
    client,
    `
      (() => {
        const snapshots = window.__tikpalSceneTransitionSnapshots ?? [];
        return snapshots.some((snapshot) => snapshot.phase === 'dimming')
          && snapshots.some((snapshot) => snapshot.phase === 'revealing');
      })()
    `,
    "scene sound scene switch enters dim/reveal transition"
  );
  await expectEventually(
    client,
    `
      (() => {
        const before = window.__tikpalSceneSoundSwitchBefore;
        const video = document.querySelector('.flame-video[data-flame-layer="active"][data-flame-loop-role="active"]');
        if (!(video instanceof HTMLVideoElement) || !before) return false;
        const volume = Number.parseFloat(video.getAttribute('data-scene-volume') ?? '0');
        const gainDb = Number.parseFloat(video.getAttribute('data-scene-gain-db') ?? 'NaN');
        return document.querySelector('.flame-scene')?.getAttribute('data-flame-transition') === 'none'
          && video.paused === false
          && video.muted === false
          && video.readyState >= 2
          && Number.isFinite(gainDb)
          && volume > 0
          && Math.abs(volume - before.volume) < 0.06
          && !document.querySelector('.flame-scene.is-static-only, .flame-scene.is-video-off');
      })()
    `,
    "scene sound scene switch keeps playing with stable volume envelope and gain",
    35,
    150
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
        document.querySelector('.ambient-transport-sound')?.click();
        return true;
      })()
    `
  );
  await expectEventually(client, "document.querySelector('.ambient-transport-sound')?.getAttribute('aria-pressed') === 'false'", "turning scene sound off clears the toggle");
  await expectEventuallyEvaluate(
    client,
    "fetch('/api/v1/system/state').then((response) => response.json()).then((state) => state.audio.currentSource.id === 'mpd' && state.playback.source === 'mpd' && state.playback.state === 'playing')",
    "turning scene sound off resumes library playback"
  );
  await expectEventually(
    client,
    `
      (() => {
        const scene = document.querySelector('.flame-scene');
        const video = document.querySelector('.flame-video.is-active');
        return scene instanceof HTMLElement
          && video instanceof HTMLVideoElement
          && !scene.classList.contains('is-video-off')
          && !scene.classList.contains('is-static-only')
            && video.muted === true
            && video.paused === false
            && video.getAttribute('data-flame-frame-ready') === 'true'
            && Number.isFinite(Number.parseFloat(video.getAttribute('data-scene-gain-db') ?? 'NaN'));
        })()
      `,
    "turning scene sound off keeps scene video playing muted"
  );

  await evaluate(
    client,
    `
      (() => {
        document.querySelector('.ambient-transport-sound')?.click();
        return true;
      })()
    `
  );
  await expectEventually(client, "document.querySelector('.ambient-transport-sound')?.getAttribute('aria-pressed') === 'true'", "scene sound can turn back on before screen overlay checks");
  await expectEventuallyEvaluate(
    client,
    "fetch('/api/v1/system/state').then((response) => response.json()).then((state) => state.playback.source === 'scene' && state.playback.state === 'playing')",
    "scene sound switches API source to scene again"
  );

  await navigate(client, `${APP_URL}?mode=quickMenu`);
  await evaluate(
    client,
    `
      (async () => {
        const state = await fetch('/api/v1/system/state').then((response) => response.json());
        window.__tikpalQuickMenuScreenDuringSceneSound = {
          volume: state.system.volume.percent,
          source: state.playback.source
        };
        document.querySelector('[data-quick-menu-toggle="screen"]')?.click();
        return true;
      })()
    `
  );
  await expectEventually(client, "document.querySelector('.screen-off-overlay') !== null && document.querySelector('.quick-menu.is-active') === null", "quick menu screen overlay is available while scene sound is active");
  await expectEventuallyEvaluate(
    client,
    "fetch('/api/v1/system/state').then((response) => response.json()).then((state) => state.playback.source === window.__tikpalQuickMenuScreenDuringSceneSound.source && state.system.volume.percent === window.__tikpalQuickMenuScreenDuringSceneSound.volume)",
    "quick menu screen overlay does not change source or volume"
  );
  await evaluate(client, "document.querySelector('.screen-off-overlay')?.click();");
  await expectEventually(client, "document.querySelector('.screen-off-overlay') === null", "single tap wakes screen overlay while scene sound continues");

  await navigate(client, `${APP_URL}?mode=quickMenu`);
  await evaluate(
    client,
    `
      (() => {
        if (!document.querySelector('.ambient-clock')) {
          document.querySelector('[data-quick-menu-toggle="time"]')?.click();
        }
        return true;
      })()
    `
  );
  await expect(
    client,
    `
      (() => {
        const time = document.querySelector('[data-quick-menu-toggle="time"]');
        return document.querySelector('.ambient-clock') !== null
          && time?.getAttribute('aria-pressed') === 'true'
          && time?.classList.contains('is-on');
      })()
    `,
    "quick menu clock toggle keeps ambient clock restored"
  );
  await evaluate(client, "document.querySelector('.overlay-backdrop')?.click();");
  await expectEventually(client, "document.querySelector('.quick-menu.is-active') === null", "quick menu closes while scene sound remains active");
  await expectEventually(client, "document.querySelector('.flame-video.is-active') instanceof HTMLVideoElement && document.querySelector('.flame-video.is-active').muted === false", "scene sound stays enabled before switching sources");
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
  await evaluate(
    client,
    `
      (async () => {
        const headers = { 'Content-Type': 'application/json' };
        await fetch('/api/v1/audio/source', {
          method: 'POST',
          headers,
          body: JSON.stringify({ target: 'radio', radioStationId: 'radio-510' })
        });
        await fetch('/api/v1/audio/source', {
          method: 'POST',
          headers,
          body: JSON.stringify({ target: 'mpd' })
        });
        await fetch('/api/v1/experience/actions', {
          method: 'POST',
          headers,
          body: JSON.stringify({ type: 'set_scene_sound', sceneSoundEnabled: true })
        });
        return true;
      })()
    `
  );
  await expectEventuallyEvaluate(
    client,
    "Promise.all([fetch('/api/v1/system/state').then((response) => response.json()), fetch('/api/v1/experience/state').then((response) => response.json())]).then(([state, experience]) => state.audio.rememberedSource?.target === 'mpd' && state.audio.rememberedSource?.radioStationId === 'radio-510' && experience.sceneSoundEnabled === true)",
    "Ambient Radio source selection precondition preserves previous station while back on Library"
  );
  await click(client, 1280, 280);
  await evaluate(
    client,
    `
      (() => {
        if (!document.querySelector('[data-ambient-source-option="radio"]')) {
          document.querySelector('[data-ambient-source-toggle]')?.click();
        }
        return true;
      })()
    `
  );
  await expectEventually(client, "document.querySelector('[data-ambient-source-option=\"radio\"]') !== null", "Ambient source picker exposes Radio from Scene Sound");
  await evaluate(
    client,
    `
      (() => {
        const originalFetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
          const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
          if (url.includes('/api/v1/audio/source')) {
            window.fetch = originalFetch;
            return Promise.resolve(new Response(JSON.stringify({ error: 'SMOKE_SOURCE_SWITCH_FAILURE' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' }
            }));
          }
          return originalFetch(input, init);
        };
        return true;
      })()
    `
  );
  await evaluate(client, "document.querySelector('[data-ambient-source-option=\"radio\"]')?.click()");
  await wait(80);
  await expect(client, "document.querySelector('.flame-video.is-active') instanceof HTMLVideoElement && document.querySelector('.flame-video.is-active').muted === true", "Ambient Radio failed switch first mutes scene video");
  await expectEventually(client, "document.querySelector('.flame-video.is-active') instanceof HTMLVideoElement && document.querySelector('.flame-video.is-active').muted === false && document.querySelector('.ambient-source-error') !== null", "Ambient Radio failed switch restores scene audio");
  await evaluate(client, "document.querySelector('[data-ambient-source-option=\"radio\"]')?.click()");
  await wait(80);
  await expect(client, "document.querySelector('.flame-video.is-active') instanceof HTMLVideoElement && document.querySelector('.flame-video.is-active').muted === true", "Ambient Radio source switch mutes scene video before backend switch");
  await expectEventuallyEvaluate(
    client,
    "Promise.all([fetch('/api/v1/system/state').then((response) => response.json()), fetch('/api/v1/experience/state').then((response) => response.json())]).then(([state, experience]) => state.audio.currentSource.id === 'radio' && state.audio.currentSource.radioStationId === 'radio-510' && state.playback.source === 'radio' && experience.sceneSoundEnabled === false)",
    "Ambient Radio source selection deactivates scene sound and starts Radio"
  );
  await expectEventually(
    client,
    "document.querySelector('[data-ambient-source-picker]') === null && document.querySelector('[data-ambient-source-status-pill][data-ambient-source-status-source=\"radio\"]')?.textContent?.includes('Radio') === true",
    "Ambient Radio source selection closes the picker and shows the corner source pill"
  );
  await expectEventually(
    client,
    `
      (async () => {
        const video = document.querySelector('.flame-video.is-active');
        if (!(video instanceof HTMLVideoElement)) return false;
        const before = video.currentTime;
        await new Promise((resolve) => setTimeout(resolve, 250));
        return document.querySelector('.flame-scene.is-video-off') === null
          && video.muted === true
          && video.paused === false
          && video.readyState >= 2
          && Math.abs(video.currentTime - before) > 0.03;
      })()
    `,
    "Ambient Radio switch keeps the scene video mounted and playing muted",
    30,
    150
  );
  await click(client, 1280, 280);
  await evaluate(
    client,
    `
      (() => {
        if (!document.querySelector('[data-ambient-source-option="mpd"]')) {
          document.querySelector('[data-ambient-source-toggle]')?.click();
        }
        return true;
      })()
    `
  );
  await expectEventually(client, "document.querySelector('[data-ambient-source-option=\"mpd\"]') !== null", "Ambient source picker exposes Library");
  await evaluate(client, "document.querySelector('[data-ambient-source-option=\"mpd\"]')?.click()");
  await expectEventually(client, "document.querySelector('.flame-video.is-active') instanceof HTMLVideoElement && document.querySelector('.flame-video.is-active').muted === true", "Ambient music source switch remutes the active scene video");
  await expectEventuallyEvaluate(
    client,
    "Promise.all([fetch('/api/v1/system/state').then((response) => response.json()), fetch('/api/v1/experience/state').then((response) => response.json())]).then(([state, experience]) => state.audio.currentSource.id === 'mpd' && state.playback.source === 'mpd' && experience.sceneSoundEnabled === false)",
    "Ambient source selection deactivates scene sound and restores Library"
  );
  await expectEventually(
    client,
    "document.querySelector('[data-ambient-source-picker]') === null && document.querySelector('[data-ambient-source-status-pill][data-ambient-source-status-source=\"mpd\"]')?.textContent?.includes('Library') === true",
    "Ambient Library source selection closes the picker and shows the corner source pill"
  );
  await expectEventually(
    client,
    `
      (async () => {
        const video = document.querySelector('.flame-video.is-active');
        if (!(video instanceof HTMLVideoElement)) return false;
        const before = video.currentTime;
        await new Promise((resolve) => setTimeout(resolve, 250));
        return document.querySelector('.flame-scene.is-video-off') === null
          && video.muted === true
          && video.paused === false
          && video.readyState >= 2
          && Math.abs(video.currentTime - before) > 0.03;
      })()
    `,
    "Ambient Library switch keeps the scene video mounted and playing muted",
    30,
    150
  );
  await navigate(client, `${APP_URL}?mode=player`);
  const playerLongTitlePatchVersion = await setStatePatchMode(client, "longPlayerTitle");
  await waitForStatePatchRefresh(client, playerLongTitlePatchVersion, "Player long title fixture refreshes");
  await expectEventually(
    client,
    "document.querySelector('[data-player-now-playing-pane]') !== null && document.querySelector('[data-player-library-pane]') !== null",
    "player renders distinct now-playing and library panes"
  );
  await expectEventually(
    client,
    `
      (() => {
        const nowPane = document.querySelector('[data-player-now-playing-pane]');
        const libraryPane = document.querySelector('[data-player-library-pane]');
        const title = document.querySelector('.track-stack h1');
        if (!(nowPane instanceof HTMLElement) || !(libraryPane instanceof HTMLElement) || !(title instanceof HTMLElement)) return false;
        const nowRect = nowPane.getBoundingClientRect();
        const libraryRect = libraryPane.getBoundingClientRect();
        const titleRect = title.getBoundingClientRect();
        const style = getComputedStyle(title);
        return style.webkitLineClamp === '3'
          && titleRect.left >= nowRect.left - 1
          && titleRect.right <= nowRect.right + 1
          && titleRect.right < libraryRect.left - 8
          && nowRect.right < libraryRect.left;
      })()
    `,
    "player long now-playing title stays inside the left pane"
  );
  const playerBrokenArtworkPatchVersion = await setStatePatchMode(client, "brokenArtwork");
  await waitForStatePatchRefresh(client, playerBrokenArtworkPatchVersion, "Player broken artwork fixture refreshes");
  await expectEventually(
    client,
    "document.querySelector('.player-overlay .cover-art[data-generated-cover-fallback=\"true\"] img')?.getAttribute('src')?.startsWith('data:image/svg+xml') === true",
    "Player broken artwork URL falls back to generated cover"
  );
  await expectEventually(
    client,
    generatedCoverSquareRootExpression('.player-overlay .cover-art[data-generated-cover-fallback="true"] img'),
    "Player generated cover uses the outer container for rounded clipping"
  );
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
  await setStatePatchMode(client, "");
  await wait(500);
  await expect(
    client,
    `
      (() => {
        const expected = ['mpd', 'radio', 'spotify', 'airplay', 'bluetooth', 'upnp', 'web-mode'];
        return expected.every((sourceId) => document.querySelector(\`[data-source-item="\${sourceId}"]\`))
          && document.querySelector('[data-source-item="playlist"]') === null
          && document.querySelector('[data-source-item="audio"]') === null;
      })()
    `,
    "player source tabs include six visible source categories plus Explore"
  );
  await evaluate(client, "document.querySelector('[data-source-item=\"radio\"]')?.click(); true");
  await expectEventually(
    client,
    "document.querySelector('[data-radio-scope]') === null && document.querySelector('[data-radio-category=\"focus\"][aria-selected=\"true\"]') !== null && document.querySelector('[aria-label=\"Search radio stations\"]') === null",
    "Radio panel defaults to the single-layer Focus category"
  );
  await expectEventually(
    client,
    `
      (() => {
        const expected = ['focus', 'calm', 'sleep', 'jazz', 'classical', 'news', 'hifi', 'blues', 'rock', 'world', 'electronic', 'podcast', 'random'];
        const tabs = Array.from(document.querySelectorAll('[data-radio-category]'));
        return tabs.length === expected.length
          && expected.every((category, index) => tabs[index]?.getAttribute('data-radio-category') === category);
      })()
    `,
    "Radio panel exposes the single-layer category tabs"
  );
  await expectEventually(
    client,
    "document.querySelector('[data-radio-station-logo]') instanceof HTMLImageElement && document.querySelector('[data-radio-station-logo]')?.complete === true && document.querySelector('[data-radio-station-logo]')?.naturalWidth > 0",
    "Radio panel renders station logo images"
  );
  await evaluate(client, "document.querySelector('[data-radio-category=\"jazz\"]')?.click(); true");
  await expectEventually(
    client,
    "document.querySelector('[data-radio-category=\"jazz\"][aria-selected=\"true\"]') !== null && document.querySelectorAll('.source-panel-radio .radio-catalog-item').length === 3",
    "Radio panel can show a full three-station category"
  );
  await expectEventually(
    client,
    `
      (() => {
        const panel = document.querySelector('.source-panel-radio');
        const shell = document.querySelector('.player-shell');
        const items = [...document.querySelectorAll('.source-panel-radio .radio-catalog-item')];
        if (!(panel instanceof HTMLElement) || !(shell instanceof HTMLElement) || items.length !== 3) return false;
        const lastRect = items[items.length - 1].getBoundingClientRect();
        const shellRect = shell.getBoundingClientRect();
        return !/\\b\\d+\\s+stations\\b/i.test(panel.textContent ?? "")
          && document.querySelector('.source-panel-hint') === null
          && lastRect.bottom <= shellRect.bottom - 4
          && shellRect.bottom - lastRect.bottom <= 72;
      })()
    `,
    "Radio panel omits station count and bottom hint while filling the player shell with three station rows"
  );
  await evaluate(client, "document.querySelector('[data-radio-category=\"random\"]')?.click(); true");
  await expectEventually(
    client,
    `
      (() => {
        const items = [...document.querySelectorAll('.source-panel-radio .radio-catalog-item')];
        const categoryNodes = [...document.querySelectorAll('.source-panel-radio [data-radio-station-category]')];
        const categories = categoryNodes.map((node) => node.getAttribute('data-radio-station-category'));
        const text = document.querySelector('.source-panel-radio')?.textContent ?? '';
        return document.querySelector('[data-radio-category="random"][aria-selected="true"]') !== null
          && items.length === 3
          && categoryNodes.length === 3
          && text.includes('Three fresh picks. Tap one to play.')
          && categories.every((category) => category && category !== 'random');
      })()
    `,
    "Radio Random tab shows three stations with their real categories"
  );
  await evaluate(client, "document.querySelector('[data-radio-category=\"sleep\"]')?.click(); true");
  await expectEventually(
    client,
    "Array.from(document.querySelectorAll('[data-radio-station-category]')).length > 0 && Array.from(document.querySelectorAll('[data-radio-station-category]')).every((node) => node.getAttribute('data-radio-station-category') === 'sleep')",
    "Radio panel category filter shows Sleep stations only"
  );
  await evaluate(client, "document.querySelector('[data-source-item=\"mpd\"]')?.click(); true");
  await expect(
    client,
    "document.querySelector('[data-player-playlist-entry]') === null && document.querySelector('.playlist-overlay') === null",
    "player omits playlist editing entry"
  );
  await expectEventually(client, "document.querySelector('[data-library-storage=\"local\"]') !== null", "player Library exposes local storage tab");
  await evaluate(client, "document.querySelector('[data-library-storage=\"local\"]')?.click(); true");
  await expectEventually(client, "document.querySelector('[data-library-storage=\"local\"].is-selected') !== null", "player Library local storage tab is selected");
  await expectEventually(client, "document.querySelector('[data-library-track-list] [data-library-track] .library-track-main') !== null", "player Library keeps selectable tracks");
  await expectLibrarySearchForStorage(client, "local", "Search Local");
  await expectLibrarySearchForStorage(client, "usb", "Search USB");
  await expectLibrarySearchForStorage(client, "nas", "Search NAS");
  await expectLibrarySearchForStorage(client, "favorites", "Search Favorites");
  await evaluate(client, "document.querySelector('[data-library-storage=\"local\"]')?.click(); true");
  await expectEventually(client, "document.querySelector('[data-library-storage=\"local\"].is-selected') !== null", "player Library returns to local storage after search checks");
  await expectEventually(
    client,
    `
      (() => {
        const shell = document.querySelector('[data-library-track-list-shell]');
        const control = document.querySelector('[data-library-fast-scroll]');
        if (!(shell instanceof HTMLElement) || !(control instanceof HTMLElement)) return false;
        const columns = getComputedStyle(shell).gridTemplateColumns.split(' ').filter(Boolean);
        const style = getComputedStyle(control);
        return columns.length === 2
          && style.position === 'relative'
          && style.pointerEvents !== 'none'
          && Number.parseFloat(style.opacity || '0') >= 0.95;
      })()
    `,
    "player Library fast scroll is a fixed visible rail on long lists"
  );
  await evaluate(
    client,
    `
      (() => {
        const list = document.querySelector('[data-library-track-list]');
        if (!(list instanceof HTMLElement)) return false;
        list.scrollTop = Math.max(1, list.scrollHeight * 0.35);
        list.dispatchEvent(new Event('scroll', { bubbles: true }));
        return list.scrollTop > 0;
      })()
    `
  );
  await expectEventually(client, "document.querySelector('[data-library-fast-scroll]') !== null", "player Library fast scroll remains mounted after list scroll");
  await expect(client, "document.querySelector('[data-library-fast-scroll-thumb]') !== null", "player Library fast scroll exposes thumb hook");
  const fastScrollBox = await evaluate(
    client,
    `
      (() => {
        const track = document.querySelector('[data-library-fast-scroll] .library-fast-scroll-track');
        if (!(track instanceof HTMLElement)) return null;
        const rect = track.getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width / 2), top: Math.round(rect.top + 2), bottom: Math.round(rect.bottom - 2) };
      })()
    `
  );
  if (!fastScrollBox) throw new Error("Failed: player Library fast scroll track geometry is available");
  await drag(client, fastScrollBox.x, fastScrollBox.top, fastScrollBox.x, fastScrollBox.bottom, 6);
  await expect(
    client,
    `
      (() => {
        const list = document.querySelector('[data-library-track-list]');
        if (!(list instanceof HTMLElement)) return false;
        const maxScrollTop = list.scrollHeight - list.clientHeight;
        return maxScrollTop > 0 && list.scrollTop >= maxScrollTop * 0.72;
      })()
    `,
    "player Library fast scroll drag moves toward the list end"
  );
  await expect(
    client,
    `
      (() => {
        const list = document.querySelector('[data-library-track-list]');
        if (!(list instanceof HTMLElement)) return false;
        const listRect = list.getBoundingClientRect();
        const actions = [...document.querySelectorAll('[data-library-delete-local], [data-library-copy-local], .library-track-favorite')];
        const action = actions.find((node) => {
          if (!(node instanceof HTMLElement)) return false;
          const rect = node.getBoundingClientRect();
          return rect.top >= listRect.top && rect.bottom <= listRect.bottom;
        });
        if (!(action instanceof HTMLElement)) return false;
        const rect = action.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return hit === action || action.contains(hit);
      })()
    `,
    "player Library fast scroll does not cover row action buttons"
  );
  await evaluate(
    client,
    `
      (() => {
        const list = document.querySelector('[data-library-track-list]');
        if (!(list instanceof HTMLElement)) return false;
        const listRect = list.getBoundingClientRect();
        const button = [...document.querySelectorAll('[data-library-delete-local]')].find((node) => {
          if (!(node instanceof HTMLElement)) return false;
          const rect = node.getBoundingClientRect();
          return rect.top >= listRect.top && rect.bottom <= listRect.bottom;
        });
        button?.click();
        return Boolean(button);
      })()
    `
  );
  await expectEventually(
    client,
    "document.querySelector('[data-library-delete-confirm]')?.textContent.includes('Delete?') && document.querySelector('[data-library-delete-confirm-yes]') !== null && document.querySelector('[data-library-delete-confirm-no]') !== null",
    "local Library delete asks for Delete, Yes, and No confirmation"
  );
  await evaluate(client, "document.querySelector('[data-library-delete-confirm-no]')?.click(); true");
  await expectEventually(
    client,
    "document.querySelector('[data-library-delete-confirm]') === null && document.querySelector('[data-library-delete-local]') !== null",
    "local Library delete confirmation cancels with No"
  );
  await evaluate(
    client,
    `
      (() => {
        const buttons = [...document.querySelectorAll('[data-library-track-list] [data-library-track] .library-track-main')];
        const target = buttons.find((button) => button.getAttribute('aria-pressed') !== 'true') ?? buttons[0];
        target?.click();
        return Boolean(target);
      })()
    `
  );
  await expectEventuallyEvaluate(
    client,
    `
      fetch('/api/v1/system/state').then((response) => response.json()).then((state) => (
        state.audio?.currentSource?.id === 'mpd'
          && state.audio?.rememberedSource?.target === 'mpd'
          && typeof state.audio?.rememberedSource?.localTrackPath === 'string'
          && state.audio.rememberedSource.localTrackPath.length > 0
      ))
    `,
    "Library track selection switches MPD with a concrete localTrackPath"
  );
  await expectEventually(client, "document.querySelector('[data-library-fast-scroll]') !== null", "player Library fast scroll stays fixed after track selection completes");
  await expectEventually(client, sourceTabExpression("mpd", { selected: true, active: true }), "library source starts selected and active");

  // Spotify Connect uses third-party librespot, so its runtime availability is intentionally non-blocking.
  await switchPlayerSourceAndExpectHandoff(client, "airplay", "AirPlay");
  await switchPlayerSourceAndExpectHandoff(client, "bluetooth", "Bluetooth");
  await switchPlayerSourceAndExpectHandoff(client, "upnp", "DLNA");

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
          && document.querySelector('[data-player-volume-back]') !== null
          && !document.querySelector('.idle-meter.is-visible')
          && document.querySelector('[aria-label="Volume down"]') === null
          && document.querySelector('[aria-label="Volume up"]') === null;
      })()
    `,
    "player volume renders a range slider with Back and without idle countdown"
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
  for (const roomMode of ["focus", "calm", "sleep"]) {
    await postExperienceAction(client, { type: "set_mode", mode: roomMode });
    await expectEventuallyEvaluate(
      client,
      `
        Promise.all([
          fetch('/api/v1/experience/state').then((response) => response.json()),
          fetch('/api/v1/system/state').then((response) => response.json())
        ]).then(([experience, state]) => (
          experience.mode === ${JSON.stringify(roomMode)}
            && state.system.volume.percent === 31
        ))
      `,
      `${roomMode} room mode preserves the explicit global volume`
    );
  }
  await postExperienceAction(client, { type: "set_scene_sound", sceneSoundEnabled: false });
  await evaluate(
    client,
    `
      fetch('/api/v1/audio/source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'mpd' })
      }).then(() => true)
    `
  );
  await expectEventuallyEvaluate(
    client,
    "fetch('/api/v1/system/state').then((response) => response.json()).then((state) => state.audio.currentSource.id === 'mpd' && state.system.volume.percent === 31)",
    "Library restore after room-mode volume checks keeps global volume"
  );
  await navigate(client, `${APP_URL}?mode=player`);
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
    "player volume display stays on the global volume after room mode changes"
  );

  await navigate(client, APP_URL);
  await evaluate(
    client,
    `
      (() => {
        document.querySelector('.ambient-transport-sound')?.click();
        return true;
      })()
    `
  );
  await expectEventuallyEvaluate(
    client,
    `
      fetch('/api/v1/system/state').then((response) => response.json()).then((state) => {
        const video = document.querySelector('.flame-video.is-active');
        const sceneVolume = Number.parseFloat(video?.getAttribute('data-scene-volume') ?? '0');
        const sceneEffectiveVolume = Number.parseFloat(video?.getAttribute('data-scene-effective-volume') ?? '0');
        return state.system.volume.percent === 31
          && video instanceof HTMLVideoElement
          && Math.abs(sceneVolume - 0.31) < 0.01
          && Math.abs(video.volume - sceneEffectiveVolume) < 0.01
          && sceneEffectiveVolume > 0
          && video.muted === false;
      })
    `,
    "scene video source volume follows global volume with scene gain applied"
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

  await expect(
    client,
    `
      (() => {
        const localTab = document.querySelector('[data-library-storage="local"]');
        localTab?.click();
        return !document.querySelector('.library-category-tab')
          && !document.querySelector('.library-subcategory-tab')
          && document.querySelectorAll('[data-library-track]').length > 0
          && document.querySelector('[data-library-delete-local]')
          && document.querySelector('.library-track-audio-info')
          && document.querySelector('[data-library-local-storage]');
      })()
    `,
    "local library is flat and exposes audio info, delete, and storage meter"
  );

  await expect(
    client,
    `
      (() => {
        const usbTab = document.querySelector('[data-library-storage="usb"]');
        usbTab?.click();
        const copy = document.querySelector('[data-library-copy-local]');
        return !copy || copy.textContent.trim() === 'Copy to Local';
      })()
    `,
    "USB copy button preserves Copy to Local casing"
  );

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
  await evaluate(client, "document.querySelector('[data-player-volume-back]')?.click();");
  await expect(client, "document.querySelector('.player-overlay.is-active') === null && document.querySelector('.ambient-screen') !== null", "player volume Back exits to Ambient");

  await navigate(client, `${APP_URL}?mode=player`);
  await click(client, 10, 10);
  await expect(client, "document.querySelector('.player-overlay.is-active') === null", "backdrop click exits player");

  await navigate(client, `${APP_URL}?mode=quickSettings`);
  await click(client, 1260, 86);
  await expect(client, "document.querySelector('.quick-settings.is-active') !== null", "protected Console click stays in Console");
  await expect(client, "document.querySelector('[data-settings-section=\"output\"]') !== null", "Console defaults to Preferences");
  await expect(
    client,
    "document.querySelector('.console-title-block')?.textContent?.includes('Console') && document.querySelector('[data-console-now-playing]') !== null",
    "Console shows the listening status header"
  );
  await expectEventually(
    client,
    `
      (() => {
        const switcher = document.querySelector('.console-room-switcher');
        const shortcuts = [...document.querySelectorAll('[data-room-shortcut]')];
        const labels = shortcuts.map((node) => node.textContent?.trim());
        const rows = new Set(shortcuts.map((node) => Math.round(node.getBoundingClientRect().top)));
        const activeIds = shortcuts
          .filter((node) => node.getAttribute('aria-pressed') === 'true')
          .map((node) => node.getAttribute('data-room-shortcut'));
        const activeRoomIds = activeIds.filter((id) => id !== 'explore');
        return Boolean(switcher)
          && switcher.getBoundingClientRect().width >= 600
          && labels.join('|') === 'Focus|Calm|Sleep|Hi-Fi|Explore|Back'
          && shortcuts.every((node) => node.querySelector('svg'))
          && activeRoomIds.length === 1
          && activeIds.every((id) => id === 'explore' || activeRoomIds.includes(id))
          && rows.size === 1
          && document.querySelector('[data-console-back-button]') !== null;
      })()
    `,
    "Console shows one-row icon and text room shortcuts"
  );
  await evaluate(
    client,
    `
      (() => {
        const target = document.querySelector('[data-console-back-button]');
        target?.click();
        return Boolean(target);
      })()
    `
  );
  await expect(client, "document.querySelector('.quick-settings.is-active') === null", "Console Back shortcut exits Console");
  await navigate(client, `${APP_URL}?mode=quickSettings`);
  await expect(client, "document.querySelector('.quick-settings.is-active') !== null", "Console reopens after Back shortcut test");
  await expect(
    client,
    `
      (() => {
        const labels = [...document.querySelectorAll('.settings-top-tab span')].map((node) => node.textContent?.trim());
        return !document.querySelector('.settings-nav')
          && labels.join('|') === 'Preferences|Library|Link|Care'
          && !labels.includes('Home');
      })()
    `,
    "Console chips replace the left nav without a Home section"
  );
  await expect(
    client,
    `
      (() => {
        const shell = document.querySelector('.quick-settings .settings-shell');
        const backdrop = document.querySelector('.quick-settings .overlay-backdrop');
        const shellStyle = shell ? getComputedStyle(shell) : null;
        const backdropStyle = backdrop ? getComputedStyle(backdrop) : null;
        const shellFilter = shellStyle?.backdropFilter || shellStyle?.webkitBackdropFilter || 'none';
        const backdropFilter = backdropStyle?.backdropFilter || backdropStyle?.webkitBackdropFilter || 'none';
        return shellFilter === 'none' && backdropFilter === 'none';
      })()
    `,
    "Console avoids heavy backdrop blur"
  );
  await expect(client, settingsSummaryExpression("output", ["Audio Output", "Multi-room Audio", "Display", "Time & Night", "Font", "Skin", "Lyrics"]), "Console Preferences summary keeps fixed hardware tiles");
  await expect(
    client,
    `
      (() => {
        const shell = document.querySelector('.settings-shell');
        const content = document.querySelector('.settings-content');
        return Boolean(shell && content && shell.scrollHeight <= shell.clientHeight && content.scrollHeight <= content.clientHeight);
      })()
    `,
    "Console shell stays within kiosk height"
  );

  await evaluate(
    client,
    `
      (() => {
        const section = document.querySelector('[data-settings-tab="output"]');
        section?.click();
        return Boolean(section);
      })()
    `
  );
  await expect(client, "document.querySelector('[data-settings-section=\"output\"]') !== null", "Console Preferences section opens");
  await expect(client, "document.querySelector('[data-settings-detail]') === null", "Console Preferences summary stays summary-first");
  await expect(client, settingsSummaryExpression("output", ["Audio Output", "Multi-room Audio", "Display", "Time & Night", "Font", "Skin", "Lyrics"]), "Console Preferences remains a fixed hardware tile grid");

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
  await expect(client, "document.querySelector('[data-settings-detail=\"display\"]') !== null", "Console display drawer opens");
  await expect(client, "document.querySelector('.display-brightness-panel-detail') !== null", "Console display drawer shows brightness controls");
  await expect(
    client,
    `
      (() => {
        const content = document.querySelector('.settings-content');
        return Boolean(content && content.scrollHeight <= content.clientHeight);
      })()
    `,
    "Console display drawer stays within kiosk height"
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
  await expect(client, "document.querySelector('[data-settings-detail]') === null", "Console display drawer closes back to summary");

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
  await expect(client, "document.querySelector('[data-settings-detail=\"night\"]') !== null", "Console night drawer opens");
  await expect(
    client,
    "document.querySelector('.night-settings-panel select') !== null && document.querySelector('.night-settings-panel input[type=\"time\"]') !== null",
    "Console night drawer exposes timezone and time controls"
  );
  await expect(
    client,
    `
      (() => {
        const content = document.querySelector('.settings-content');
        return Boolean(content && content.scrollHeight <= content.clientHeight);
      })()
    `,
    "Console night drawer stays within kiosk height"
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
  await expect(client, "document.querySelector('[data-settings-detail]') === null", "Console night drawer closes back to summary");

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
  await expect(client, "document.querySelector('[data-settings-detail=\"font\"]') !== null", "Console font drawer opens");
  await expect(
    client,
    "document.querySelectorAll('.font-theme-options-detail .font-theme-option').length >= 6 && document.querySelector('.font-theme-options-detail')?.textContent?.includes('Hardware UI')",
    "Console font drawer shows expanded modern font presets"
  );
  await expect(
    client,
    `
      (() => {
        const content = document.querySelector('.settings-content');
        return Boolean(content && content.scrollHeight <= content.clientHeight);
      })()
    `,
    "Console font drawer stays within kiosk height"
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
  await expect(client, "document.querySelector('[data-settings-detail]') === null", "Console font drawer closes back to summary");

  await evaluate(
    client,
    `
      (() => {
        const section = document.querySelector('[data-settings-tab="library"]');
        section?.click();
        return Boolean(section);
      })()
    `
  );
  await expect(client, "document.querySelector('[data-settings-section=\"library\"]') !== null", "Console Library section opens");
  await expect(client, settingsSummaryExpression("library", ["Local Library", "NAS Sources", "USB", "Library Scan"]), "Console Library summary keeps fixed hardware tiles");
  await evaluate(
    client,
    `
      (() => {
        const target = [...document.querySelectorAll('.settings-card-button')].find((node) => node.textContent.includes('NAS Sources'));
        target?.click();
        return Boolean(target);
      })()
    `
  );
  await expect(client, "document.querySelector('[data-settings-detail=\"nas\"]') !== null", "Console NAS drawer opens");
  await expect(client, "document.querySelector('.nas-source-detail') !== null", "Console NAS drawer shows source status");
  await expect(client, "document.querySelector('[data-nas-detail-left]') !== null && document.querySelector('[data-nas-detail-right]') !== null", "Console NAS drawer uses fixed two-column layout");
  await expect(
    client,
    `
      [...document.querySelectorAll('.nas-source-toolbar button')].map((button) => button.textContent.trim()).join('|') === 'Add NAS|Scan Network'
        && document.querySelector('.nas-list-heading')?.textContent.includes('Saved NAS')
        && [...document.querySelectorAll('.nas-list-heading')].some((node) => node.textContent.includes('Scan Results'))
    `,
    "Console NAS drawer keeps primary actions and lists visible without bottom controls"
  );
  await expect(
    client,
    `
      (() => {
        const content = document.querySelector('.settings-content');
        return Boolean(content && content.scrollHeight <= content.clientHeight);
      })()
    `,
    "Console NAS drawer stays within kiosk height"
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

  await evaluate(
    client,
    `
      (() => {
        const section = document.querySelector('[data-settings-tab="system"]');
        section?.click();
        return Boolean(section);
      })()
    `
  );
  await expect(client, "document.querySelector('[data-settings-section=\"system\"]') !== null", "Console Care section opens");
  await expect(
    client,
    "[...document.querySelectorAll('.settings-top-tab.is-active')].length === 1 && document.querySelector('.settings-top-tab.is-active')?.textContent?.trim() === 'Care'",
    "Console only highlights the active Care chip"
  );
  await expect(client, settingsSummaryExpression("system", ["System", "Restart", "Shutdown"]), "Console Care summary keeps fixed hardware tiles");

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
  await expect(client, "document.querySelector('.settings-card-button.is-confirming') !== null", "Console restart requires a confirm step");

  await evaluate(
    client,
    `
      (() => {
        const section = document.querySelector('[data-settings-tab="network"]');
        section?.click();
        return Boolean(section);
      })()
    `
  );
  await expect(client, "document.querySelector('[data-settings-section=\"network\"]') !== null", "Console Link section opens");
  await expect(client, settingsSummaryExpression("network", ["Network", "Explore"]), "Console Link summary keeps fixed hardware tiles");
  await expect(
    client,
    `
      (() => {
        const shell = document.querySelector('.settings-shell');
        const content = document.querySelector('.settings-content');
        return Boolean(shell && content && shell.scrollHeight <= shell.clientHeight && content.scrollHeight <= content.clientHeight);
      })()
    `,
    "Console Link summary stays within kiosk height"
  );
  await evaluate(
    client,
    `
      fetch('/api/v1/web-mode/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerTextScale: 1.1 })
      })
    `
  );

  await evaluate(
    client,
    `
      (() => {
        const target = [...document.querySelectorAll('.settings-card-button')].find((node) => node.textContent.includes('Explore'));
        target?.click();
        return Boolean(target);
      })()
    `
  );
  await expect(client, "document.querySelector('[data-settings-detail=\"web-mode\"]') !== null", "Console Explore drawer opens");
  await expectEventually(
    client,
    "document.querySelector('.web-mode-proxy-field input')?.value.startsWith('http') && document.querySelector('[data-web-mode-settings-scale]')?.textContent.includes('Font') && document.querySelector('.web-mode-settings-scale-option.is-active')?.textContent === 'Medium' && [...document.querySelectorAll('.web-mode-settings-scale-option')].map((node) => node.textContent?.trim()).join(',') === 'Small,Medium,Large' && !document.querySelector('.web-mode-settings-actions') && ![...document.querySelectorAll('[data-settings-detail=\"web-mode\"] button')].some((button) => ['Test', 'Save', 'Keyboard'].includes(button.textContent?.trim() ?? ''))",
    "Console Explore drawer auto-saves proxy settings without action buttons"
  );
  await expect(
    client,
    "document.querySelector('[data-settings-detail=\"web-mode\"]')?.scrollHeight <= document.querySelector('[data-settings-detail=\"web-mode\"]')?.clientHeight",
    "Console Explore drawer fits within kiosk height"
  );
  await evaluate(
    client,
    `
      (() => {
        window.__tikpalKeyboardNativeFetch = window.fetch.bind(window);
        window.__tikpalKeyboardActions = [];
        window.fetch = (input, init) => {
          const url = String(input instanceof Request ? input.url : input);
          if (url.includes('/api/v1/web-mode/actions')) {
            try {
              window.__tikpalKeyboardActions.push(JSON.parse(String(init?.body ?? '{}')));
            } catch {
              window.__tikpalKeyboardActions.push({ parseError: true });
            }
            return Promise.resolve(new Response(JSON.stringify({
              enabled: true,
              activeProvider: null,
              providers: [],
              settings: {
                proxyEnabled: true,
                proxyUrl: document.querySelector('.web-mode-proxy-field input')?.value || 'http://127.0.0.1:7897',
                providerTextScale: 1.1,
                updatedAt: new Date().toISOString()
              },
              lastError: null,
              updatedAt: new Date().toISOString()
            }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
          }
          return window.__tikpalKeyboardNativeFetch(input, init);
        };
        const input = document.querySelector('.web-mode-proxy-field input');
        input?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
        input?.focus();
        input?.blur();
        return Boolean(input);
      })()
    `
  );
  await wait(220);
  await expect(
    client,
    "Array.isArray(window.__tikpalKeyboardActions) && window.__tikpalKeyboardActions.some((action) => action.type === 'keyboard' && action.enabled === true && action.force === true) && !window.__tikpalKeyboardActions.some((action) => action.type === 'keyboard' && action.enabled === false)",
    "Console Explore proxy input blur alone keeps Onboard visible"
  );
  await evaluate(
    client,
    `
      (() => {
        document.querySelector('.settings-detail-header')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
        return true;
      })()
    `
  );
  await wait(120);
  await expect(
    client,
    "window.__tikpalKeyboardActions.some((action) => action.type === 'keyboard' && action.enabled === false)",
    "Console Explore outside tap hides Onboard after proxy input"
  );
  await evaluate(
    client,
    `
      (() => {
        if (window.__tikpalKeyboardNativeFetch) window.fetch = window.__tikpalKeyboardNativeFetch;
        delete window.__tikpalKeyboardNativeFetch;
        delete window.__tikpalKeyboardActions;
        return true;
      })()
    `
  );
  const originalProxyUrl = await evaluate(client, "document.querySelector('.web-mode-proxy-field input')?.value");
  await setInputValue(client, ".web-mode-proxy-field input", "http://127.0.0.1:7896");
  await expectEventually(
    client,
    "document.querySelector('.settings-detail-header p')?.textContent === 'Saved automatically' && document.querySelector('.web-mode-proxy-field input')?.value === 'http://127.0.0.1:7896' && document.querySelector('.web-mode-settings-help')?.textContent.includes('switch Proxy and retry')",
    "Console Explore proxy URL auto-saves without rewriting the input"
  );
  await setInputValue(client, ".web-mode-proxy-field input", originalProxyUrl);
  await expectEventually(
    client,
    "document.querySelector('.settings-detail-header p')?.textContent === 'Saved automatically'",
    "Console Explore proxy URL restores after the auto-save check"
  );
  await evaluate(
    client,
    `
      (() => {
        const target = [...document.querySelectorAll('.web-mode-settings-scale-option')].find((node) => node.textContent.trim() === 'Large');
        target?.click();
        return Boolean(target);
      })()
    `
  );
  await expectEventually(
    client,
    "document.querySelector('.settings-detail-header p')?.textContent === 'Saved automatically' && document.querySelector('.web-mode-settings-scale-option.is-active')?.textContent === 'Large'",
    "Console Explore provider text scale auto-saves"
  );
  await evaluate(
    client,
    `
      (() => {
        const target = [...document.querySelectorAll('.web-mode-settings-scale-option')].find((node) => node.textContent.trim() === 'Medium');
        target?.click();
        return Boolean(target);
      })()
    `
  );
  await expectEventually(
    client,
    "document.querySelector('.settings-detail-header p')?.textContent === 'Saved automatically' && document.querySelector('.web-mode-settings-scale-option.is-active')?.textContent === 'Medium'",
    "Console Explore provider text scale restores to the default"
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
  await expect(client, "document.querySelector('[data-settings-detail]') === null", "Console Explore drawer closes back to summary");

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
  await expect(client, "document.querySelector('.settings-card-button.is-confirming') === null", "Console confirm state clears when another card is tapped");

  await click(client, 10, 10);
  await expect(client, "document.querySelector('.quick-settings.is-active') === null", "Console backdrop click exits Console");

  await navigate(client, new URL("/side-panel", APP_URL).toString());
  await expect(client, "document.querySelector('[data-web-mode-panel]') !== null && document.querySelector('.app-root') === null", "Explore side panel renders without the main kiosk app");
  await expect(client, "document.querySelectorAll('[data-web-mode-provider]').length >= 10", "Explore side panel exposes common web player providers");
  await expect(
    client,
    "document.querySelector('[data-web-mode-proxy-toggle]')?.tagName === 'BUTTON' && document.querySelector('[data-web-mode-top-back]') !== null && document.querySelector('[data-web-mode-text-scale]')?.textContent.includes('Font') && [...document.querySelectorAll('[data-web-mode-text-scale-option]')].map((node) => node.textContent?.trim()).join(',') === 'Small,Medium,Large' && document.querySelector('[data-web-mode-text-scale-option=\"1.1\"].is-active') !== null && document.querySelector('[data-web-mode-keyboard-toggle]') === null && document.querySelector('.web-mode-actions') === null",
    "Explore side panel exposes proxy, provider text scale, and one top-right Back control without a manual Keyboard button"
  );
  await expect(
    client,
    `
      (() => {
        const ids = [...document.querySelectorAll('[data-web-mode-provider]')].map((node) => node.dataset.webModeProvider);
        return ids.length === new Set(ids).size
          && ids[0] === 'suno'
          && ids.filter((id) => id === 'qq_music').length === 1
          && document.querySelector('[data-web-mode-provider="suno"] strong')?.textContent === 'Suno'
          && document.querySelector('[data-web-mode-provider][disabled]') === null
          && document.querySelector('[data-web-mode-provider="amazon_music"] strong')?.textContent === 'Amazon Music'
          && document.querySelector('[data-web-mode-provider="qq_music"] strong')?.textContent === 'QQ Music'
          && document.querySelector('[data-web-mode-provider="youtube_music"] em')?.textContent !== 'Experimental';
      })()
    `,
    "Explore side panel keeps provider cards unique with canonical labels"
  );
  await evaluate(
    client,
    `
      (() => {
        const target = document.querySelector('[data-web-mode-provider="spotify"]');
        target?.click();
        return Boolean(target);
      })()
    `
  );
  await expectEventually(client, "document.querySelector('[data-web-mode-provider=\"spotify\"]')?.classList.contains('is-active')", "Explore side panel establishes the current provider before a staged switch");
  await evaluate(
    client,
    `
      (() => {
        const nativeFetch = window.fetch.bind(window);
        window.__tikpalExploreNativeFetch = nativeFetch;
        window.fetch = (input, init) => {
          const url = typeof input === 'string' ? input : input?.url ?? '';
          const isProviderOpen = url.includes('/api/v1/web-mode/actions') && String(init?.body ?? '').includes('"type":"open"');
          if (!isProviderOpen) return nativeFetch(input, init);
          return new Promise((resolve, reject) => window.setTimeout(() => nativeFetch(input, init).then(resolve, reject), 2500));
        };
        return true;
      })()
    `
  );
  await evaluate(
    client,
    `
      (() => {
        const target = document.querySelector('[data-web-mode-provider="youtube_music"]');
        target?.click();
        return Boolean(target);
      })()
    `
  );
  await expectEventually(
    client,
    `
      (() => {
        const target = document.querySelector('[data-web-mode-provider="youtube_music"]');
        const current = document.querySelector('[data-web-mode-provider="spotify"]');
        return target?.classList.contains('is-connecting')
          && target.querySelector('em')?.textContent === 'Connecting'
          && current?.classList.contains('is-current')
          && current.querySelector('em')?.textContent === 'Current'
          && !target.classList.contains('is-active')
          && !current.classList.contains('is-active')
          && document.querySelector('.web-mode-panel-footer')?.textContent === 'Connecting to YouTube Music';
      })()
    `,
    "Explore side panel distinguishes Connecting from the previous Current provider"
  );
  await expect(
    client,
    "getComputedStyle(document.querySelector('[data-web-mode-provider=\"youtube_music\"]'), '::after').animationName === 'webModeProviderSignalTrace'",
    "Explore Connecting card runs the lightweight signal trace"
  );
  await client.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }]
  });
  await expect(
    client,
    "getComputedStyle(document.querySelector('[data-web-mode-provider=\"youtube_music\"]'), '::after').animationName === 'none'",
    "Explore Connecting trace becomes static for reduced motion"
  );
  await client.send("Emulation.setEmulatedMedia", { features: [] });
  await evaluate(
    client,
    `
      (() => {
        if (window.__tikpalExploreNativeFetch) window.fetch = window.__tikpalExploreNativeFetch;
        delete window.__tikpalExploreNativeFetch;
        return true;
      })()
    `
  );
  await expectEventually(client, "document.querySelector('[data-web-mode-provider=\"youtube_music\"]')?.classList.contains('is-active')", "Explore side panel promotes the provider to Active only after switching finishes", 30, 150);

  await navigate(client, REMOTE_APP_URL);
  await expect(client, "document.querySelector('.remote-root') !== null", "portable remote renders on the remote port");
  await expect(
    client,
    "document.querySelector('[data-remote-key]') !== null && document.querySelector('[data-remote-volume-slider]') !== null && document.querySelector('[data-remote-explore]') !== null && document.querySelector('[data-remote-explore-open]') !== null && document.querySelector('[data-remote-explore-close]') !== null && document.querySelector('[data-remote-explore-proxy]') !== null",
    "portable remote exposes its key field, volume slider, Explore start, back, and proxy controls"
  );
  await expect(
    client,
    "document.querySelector('.remote-key-panel span')?.textContent?.trim() === 'Access key' && document.querySelector('.remote-key-panel strong')?.textContent?.trim() === 'No key'",
    "portable remote defaults to no-key mode without setup friction"
  );
  await expectEventually(
    client,
    "document.querySelector('[data-remote-explore-open]')?.disabled === true && document.querySelector('[data-remote-explore-open]')?.textContent.includes('YouTube Music') && document.querySelector('[data-remote-explore-close]')?.disabled === false",
    "portable remote reflects active Explore provider and keeps Back available"
  );
  await expect(
    client,
    `
      (() => {
        const proxy = document.querySelector('[data-remote-explore-proxy]');
        return proxy?.getAttribute('aria-pressed') === (proxy?.textContent.includes('Proxy On') ? 'true' : 'false');
      })()
    `,
    "portable remote shows whether the Explore proxy is enabled"
  );
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

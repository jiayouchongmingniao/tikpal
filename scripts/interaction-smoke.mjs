import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const APP_URL = process.env.TIKPAL_TEST_URL ?? "http://localhost:4173/";
const CHROME_BIN = process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    child.once("exit", resolve);
  });
}

function waitForDevTools(chrome) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for Chrome DevTools endpoint")), 10000);
    const onData = (chunk) => {
      const text = String(chunk);
      const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        chrome.stderr.off("data", onData);
        resolve(match[1]);
      }
    };
    chrome.stderr.on("data", onData);
  });
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

async function navigate(client, url) {
  await client.send("Page.navigate", { url });
  await wait(750);
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

const profileDir = await mkdtemp(path.join(tmpdir(), "tikpal-chrome-"));
const chrome = spawn(CHROME_BIN, [
  "--headless=new",
  "--disable-gpu=false",
  "--enable-webgl",
  "--ignore-gpu-blocklist",
  "--remote-debugging-port=0",
  `--user-data-dir=${profileDir}`,
  "--window-size=2560,720",
  APP_URL
]);

let client;
try {
  const browserWsUrl = await waitForDevTools(chrome);
  const pageWsUrl = await getPageWebSocket(browserWsUrl);
  client = new CdpClient(pageWsUrl);
  await client.open();
  await client.send("Page.enable");
  await client.send("Runtime.enable");

  await navigate(client, APP_URL);
  await expect(client, "document.querySelector('.ambient-screen') !== null", "ambient root renders");
  await expect(client, "document.querySelector('.ambient-screen.is-hud-visible') !== null", "ambient HUD starts visible");

  await wait(5200);
  await expect(client, "document.querySelector('.ambient-screen.is-hud-hidden') !== null", "ambient HUD auto hides after startup");

  await click(client, 1280, 280);
  await expect(client, "document.querySelector('.ambient-screen.is-hud-visible') !== null", "single tap shows ambient HUD");

  await wait(5200);
  await expect(client, "document.querySelector('.ambient-screen.is-hud-hidden') !== null", "ambient HUD auto hides after tap show");

  await wheel(client, 260);
  await expect(client, "document.querySelector('.player-overlay.is-active') !== null", "wheel down opens player overlay");

  await wheel(client, -260);
  await expect(client, "document.querySelector('.player-overlay.is-active') === null", "wheel up returns from player");

  await navigate(client, `${APP_URL}?mode=player`);
  await click(client, 1360, 600);
  await expect(client, "document.querySelector('.player-overlay.is-active') !== null", "protected player click stays in player");

  await drag(client, 1360, 600, 1360, 470);
  await expect(client, "document.querySelector('.player-overlay.is-active') === null", "protected player swipe up exits player");

  await navigate(client, `${APP_URL}?mode=player`);
  await click(client, 10, 10);
  await expect(client, "document.querySelector('.player-overlay.is-active') === null", "backdrop click exits player");

  await navigate(client, APP_URL);
  await wheel(client, 260, 8);
  await expect(client, "document.querySelector('.quick-settings.is-active') !== null", "shift wheel opens quick settings");

  await navigate(client, `${APP_URL}?mode=quickSettings`);
  await click(client, 1260, 210);
  await expect(client, "document.querySelector('.quick-settings.is-active') !== null", "protected settings click stays in settings");

  await drag(client, 1260, 500, 1260, 350);
  await expect(client, "document.querySelector('.quick-settings.is-active') === null", "protected settings swipe up exits settings");
} finally {
  client?.close();
  chrome.kill();
  await waitForExit(chrome);
  await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

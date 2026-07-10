import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const requiredFiles = [
  "server/index.mjs",
  "server/web.mjs",
  "deploy/chromium/launch-tikpal-kiosk.sh",
  "deploy/chromium/start-tikpal-kiosk-devtools-proxy.sh",
  "deploy/chromium/start-tikpal-kiosk-display.sh",
  "deploy/chromium/start-tikpal-kiosk-session.sh",
  "deploy/chromium/start-tikpal-kiosk-viewer.sh",
  "deploy/chromium/tikpal-kiosk-healthcheck.sh",
  "deploy/chromium/tikpal-kiosk-viewerctl.sh",
  "deploy/chromium/tikpal-web-mode.sh",
  "deploy/chromium/tikpal-web-mode-guard.mjs",
  "deploy/chromium/tikpal-web-mode-qq-confirm.mjs",
  "deploy/chromium/chromium-flags.conf",
  "deploy/chromium/managed-policies.json",
  "deploy/chromium/env.kiosk.example",
  "public/web-mode-error.html",
  "deploy/moode/tikpal-alsa-loopback.sh",
  "deploy/moode/tikpal-airplay-transport.sh",
  "deploy/moode/tikpal-output-volume.sh",
  "deploy/moode/tikpal-snd-aloop-enable.sh",
  "deploy/moode/tikpal-quiet-boot-enable.sh",
  "deploy/systemd/tikpal-api.service",
  "deploy/systemd/tikpal-web.service",
  "deploy/systemd/tikpal-kiosk-devtools.service",
  "deploy/systemd/tikpal-kiosk.service",
  "deploy/systemd/tikpal-kiosk-viewer.service",
  "deploy/systemd/tikpal-kiosk-watchdog.service",
  "deploy/systemd/tikpal-kiosk-watchdog.timer",
  "deploy/systemd/install-systemd-services.sh"
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertExecutable(file) {
  await access(path.join(ROOT, file), constants.X_OK);
}

async function getFreePorts(count) {
  const servers = Array.from({ length: count }, () => createNetServer());
  await Promise.all(servers.map((server) => new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  })));
  const ports = servers.map((server) => server.address().port);
  await Promise.all(servers.map((server) => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
  return ports;
}

function requestWeb(port, pathname = "/", method = "GET") {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method,
      headers: { Host: `192.0.2.10:${port}` }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    request.once("error", reject);
    request.end();
  });
}

async function waitForWeb(port) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await requestWeb(port);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`web server did not start on port ${port}`);
}

async function run() {
  for (const file of requiredFiles) {
    const info = await stat(path.join(ROOT, file));
    assert(info.isFile(), `${file} should be a file`);
  }

  await assertExecutable("deploy/chromium/launch-tikpal-kiosk.sh");
  await assertExecutable("deploy/chromium/start-tikpal-kiosk-devtools-proxy.sh");
  await assertExecutable("deploy/chromium/start-tikpal-kiosk-display.sh");
  await assertExecutable("deploy/chromium/start-tikpal-kiosk-session.sh");
  await assertExecutable("deploy/chromium/start-tikpal-kiosk-viewer.sh");
  await assertExecutable("deploy/chromium/tikpal-kiosk-healthcheck.sh");
  await assertExecutable("deploy/chromium/tikpal-kiosk-viewerctl.sh");
  await assertExecutable("deploy/chromium/tikpal-web-mode.sh");
  await assertExecutable("deploy/moode/tikpal-alsa-loopback.sh");
  await assertExecutable("deploy/moode/tikpal-airplay-transport.sh");
  await assertExecutable("deploy/moode/tikpal-output-volume.sh");
  await assertExecutable("deploy/moode/tikpal-snd-aloop-enable.sh");
  await assertExecutable("deploy/moode/tikpal-quiet-boot-enable.sh");
  await assertExecutable("deploy/systemd/install-systemd-services.sh");

  const apiUnit = await readFile(path.join(ROOT, "deploy/systemd/tikpal-api.service"), "utf8");
  const webUnit = await readFile(path.join(ROOT, "deploy/systemd/tikpal-web.service"), "utf8");
  const kioskDevtoolsUnit = await readFile(path.join(ROOT, "deploy/systemd/tikpal-kiosk-devtools.service"), "utf8");
  const kioskUnit = await readFile(path.join(ROOT, "deploy/systemd/tikpal-kiosk.service"), "utf8");
  const kioskViewerUnit = await readFile(path.join(ROOT, "deploy/systemd/tikpal-kiosk-viewer.service"), "utf8");
  const kioskWatchdogUnit = await readFile(path.join(ROOT, "deploy/systemd/tikpal-kiosk-watchdog.service"), "utf8");
  const kioskWatchdogTimer = await readFile(path.join(ROOT, "deploy/systemd/tikpal-kiosk-watchdog.timer"), "utf8");
  const systemdInstaller = await readFile(path.join(ROOT, "deploy/systemd/install-systemd-services.sh"), "utf8");
  assert(apiUnit.includes("network.target"), "api unit should use network.target");
  assert(!apiUnit.includes("network-online.target"), "api unit should not wait for network-online.target");
  assert(webUnit.includes("server/web.mjs"), "web unit should use the production static server");
  assert(webUnit.includes("TIKPAL_WEB_REMOTE_PORT=4174"), "web unit should expose portable remote control separately from the kiosk UI");
  assert(kioskDevtoolsUnit.includes("start-tikpal-kiosk-devtools-proxy.sh"), "kiosk DevTools unit should launch the LAN proxy");
  assert(kioskDevtoolsUnit.includes("PartOf=tikpal-kiosk.service"), "kiosk DevTools proxy should follow kiosk service lifecycle");
  assert(kioskUnit.includes("start-tikpal-kiosk-display.sh"), "kiosk unit should launch the display-mode wrapper");
  assert(!kioskUnit.includes("/usr/bin/startx"), "kiosk unit should leave physical versus virtual X startup to the wrapper");
  assert(kioskViewerUnit.includes("start-tikpal-kiosk-viewer.sh"), "kiosk viewer unit should launch the noVNC wrapper");
  assert(kioskViewerUnit.includes(".env.kiosk.viewer"), "kiosk viewer unit should load the viewer-only switch file");
  assert(kioskViewerUnit.includes("PartOf=tikpal-kiosk.service"), "kiosk viewer should follow kiosk service lifecycle");
  assert(kioskWatchdogUnit.includes("tikpal-kiosk-healthcheck.sh"), "kiosk watchdog unit should launch the healthcheck script");
  assert(kioskWatchdogUnit.includes("User=root"), "kiosk watchdog should run as root so it can restart the kiosk service");
  assert(!kioskWatchdogUnit.includes("PartOf=tikpal-kiosk.service"), "kiosk watchdog should survive kiosk restarts");
  assert(kioskWatchdogTimer.includes("OnUnitActiveSec=75s"), "kiosk watchdog timer should run inside the 60-90s cadence");
  assert(kioskWatchdogTimer.includes("tikpal-kiosk-watchdog.service"), "kiosk watchdog timer should target the watchdog service");
  assert(systemdInstaller.includes("tikpal-kiosk-watchdog.service"), "systemd installer should install the kiosk watchdog service");
  assert(systemdInstaller.includes("tikpal-kiosk-watchdog.timer"), "systemd installer should install and enable the kiosk watchdog timer");
  assert(kioskUnit.includes("TIKPAL_KIOSK_SKIP_ENV_SOURCE=1"), "kiosk unit should preserve systemd EnvironmentFile override order");

  const webSmokeDir = mkdtempSync(path.join(tmpdir(), "tikpal-web-surfaces-"));
  writeFileSync(path.join(webSmokeDir, "index.html"), "<!doctype html><html><head></head><body>Tikpal</body></html>");
  const [kioskPort, remotePort, unusedApiPort] = await getFreePorts(3);
  const webProcess = spawn(process.execPath, ["server/web.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      TIKPAL_WEB_HOST: "127.0.0.1",
      TIKPAL_WEB_PORT: String(kioskPort),
      TIKPAL_WEB_REMOTE_PORT: String(remotePort),
      TIKPAL_WEB_DIST_DIR: webSmokeDir,
      TIKPAL_API_ORIGIN: `http://127.0.0.1:${unusedApiPort}`
    },
    stdio: "ignore"
  });

  try {
    await waitForWeb(kioskPort);
    const kioskPage = await requestWeb(kioskPort);
    const remotePage = await requestWeb(remotePort);
    assert(kioskPage.status === 200, "kiosk web port should serve the full UI to LAN hosts");
    assert(!kioskPage.body.includes("__TIKPAL_REMOTE_MODE__"), "kiosk web port should not inject portable remote mode");
    assert(remotePage.body.includes("__TIKPAL_REMOTE_MODE__=true"), "remote web port should inject portable remote mode");

    const kioskApi = await requestWeb(kioskPort, "/api/v1/system/state");
    const remoteApi = await requestWeb(remotePort, "/api/v1/system/state");
    const remoteHeartbeat = await requestWeb(kioskPort, "/api/v1/kiosk/heartbeat", "POST");
    assert(kioskApi.status === 502, "kiosk web port should allow the LAN full-UI API through to its configured origin");
    assert(remoteApi.status === 403, "remote web port should block the full kiosk API");
    assert(remoteHeartbeat.status === 403, "LAN kiosk views should not overwrite the physical kiosk heartbeat");
  } finally {
    if (webProcess.exitCode === null) {
      webProcess.kill("SIGTERM");
      await new Promise((resolve) => webProcess.once("exit", resolve));
    }
  }

  const kioskEnv = await readFile(path.join(ROOT, "deploy/chromium/env.kiosk.example"), "utf8");
  assert(kioskEnv.includes("TIKPAL_KIOSK_REMOTE_DEBUG=0"), "kiosk env should default remote debugging off");
  assert(kioskEnv.includes("TIKPAL_KIOSK_VIEWER=none"), "kiosk env should default noVNC viewer off");
  assert(kioskEnv.includes("TIKPAL_KIOSK_DISPLAY_MODE=auto"), "kiosk env should document automatic physical/virtual display selection");
  assert(kioskEnv.includes("TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS=5"), "kiosk env should document bounded xset/xrandr commands");
  assert(kioskEnv.includes("TIKPAL_KIOSK_WATCHDOG_ENABLED=1"), "kiosk env should default the display watchdog on");
  assert(kioskEnv.includes("TIKPAL_KIOSK_WATCHDOG_GPU_LOG_SCAN=1"), "kiosk env should enable GPU reset log scanning");
  assert(kioskEnv.includes("TIKPAL_KIOSK_WATCHDOG_PAGE_HEARTBEAT_ENABLED=1"), "kiosk env should enable page heartbeat scanning");
  assert(kioskEnv.includes("TIKPAL_KIOSK_WATCHDOG_PAGE_HEARTBEAT_URL=http://127.0.0.1:8787/api/v1/kiosk/heartbeat"), "kiosk env should point the watchdog at the loopback page heartbeat API");
  assert(kioskEnv.includes("TIKPAL_KIOSK_WATCHDOG_WEB_MODE_HEARTBEAT_BYPASS=1"), "kiosk env should not restart the kiosk for stale page heartbeat while Explore is active");
  assert(kioskEnv.includes("TIKPAL_KIOSK_WATCHDOG_REBOOT_AFTER_RESTARTS=3"), "kiosk env should document persistent display-failure reboot escalation");
  assert(kioskEnv.includes("TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE="), "kiosk env should expose Chromium ALSA output selection");
  assert(!kioskEnv.includes("TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE=_audioout"), "kiosk env should not default Chromium Scene Sound to Loopback-backed _audioout");
  assert(kioskEnv.includes("dmix:CARD="), "kiosk env should document physical USB dmix output for Chromium Scene Sound");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT=9234"), "kiosk env should document the Explore provider local CDP port");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_PROVIDER_GUARD=1"), "kiosk env should enable the Explore provider guard by default");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_ERROR_PAGE_URL=http://127.0.0.1:4173/web-mode-error.html"), "kiosk env should point provider guard at the local friendly error page");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_TRANSITION_URL=http://127.0.0.1:4173/web-mode-transition.html"), "kiosk env should point staged Explore switches at the local transition page");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_STAGE_POSITION=2560,0"), "kiosk env should stage provider windows offscreen");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS=2"), "kiosk env should bound Explore provider switch locking");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_QQ_AUTO_CONFIRM=1"), "kiosk env should enable safe QQ Music auto-confirm by default");
  const kioskLauncher = await readFile(path.join(ROOT, "deploy/chromium/launch-tikpal-kiosk.sh"), "utf8");
  const kioskSession = await readFile(path.join(ROOT, "deploy/chromium/start-tikpal-kiosk-session.sh"), "utf8");
  const webModeScript = await readFile(path.join(ROOT, "deploy/chromium/tikpal-web-mode.sh"), "utf8");
  assert(kioskLauncher.includes("TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS"), "kiosk launcher should expose an X command timeout");
  assert(kioskLauncher.includes("run_x_command xrandr"), "kiosk launcher should bound xrandr commands");
  assert(kioskLauncher.includes("run_x_command xset"), "kiosk launcher should bound xset commands");
  assert(kioskSession.includes("TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS"), "kiosk session should expose an X command timeout");
  assert(kioskSession.includes("run_x_command xset"), "kiosk session should bound xset commands");
  assert(webModeScript.includes("nohup \"$SCRIPT_DIR/tikpal-web-mode.sh\" guard"), "web mode should keep the window guard alive after the launcher exits");
  assert(webModeScript.includes("window-guard.pid"), "web mode should track the persistent window guard pid");
  assert(webModeScript.includes('flock -x -w "$TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS"'), "web mode should not wait forever on provider switch locks");
  assert(webModeScript.includes("9>&- &"), "web mode background children should not inherit the provider switch lock");
  const openProviderBody = webModeScript.slice(
    webModeScript.indexOf("open_provider()"),
    webModeScript.indexOf("check_runtime()")
  );
  assert(
    openProviderBody.indexOf("ensure_side_panel") >= 0 &&
      openProviderBody.indexOf("ensure_side_panel") < openProviderBody.indexOf("launch_transition_veil"),
    "web mode should show the right provider panel before the left loading veil"
  );

  const loopbackGuardDir = mkdtempSync(path.join(tmpdir(), "tikpal-loopback-guard-"));
  const hdmiLoopbackConfig = path.join(loopbackGuardDir, "_sndaloop-hdmi.conf");
  const externalLoopbackConfig = path.join(loopbackGuardDir, "_sndaloop-external.conf");
  writeFileSync(
    hdmiLoopbackConfig,
    'pcm.!_audioout {\n  type plug\n  slave.pcm {\n    type multi\n    slaves {\n      a { channels 2 pcm "default:vc4hdmi0" }\n      b { channels 2 pcm "hw:Loopback,0" }\n    }\n  }\n}\n'
  );
  writeFileSync(
    externalLoopbackConfig,
    'pcm.!_audioout {\n  type plug\n  slave.pcm {\n    type multi\n    slaves {\n      a { channels 2 pcm "hw:TikpalSpeaker,0" }\n      b { channels 2 pcm "hw:Loopback,0" }\n    }\n  }\n}\n'
  );
  const hdmiGuardCheck = spawnSync("sh", ["-c", ". ./deploy/moode/tikpal-alsa-loopback.sh; tikpal_validate_alsa_loopback_config \"$1\"", "sh", hdmiLoopbackConfig], {
    cwd: ROOT,
    encoding: "utf8"
  });
  assert(hdmiGuardCheck.status !== 0, "ALSA Loopback guard should reject HDMI-only physical output by default");
  assert(hdmiGuardCheck.stderr.includes("HDMI"), "ALSA Loopback guard should explain HDMI-only rejection");

  const externalGuardCheck = spawnSync("sh", ["-c", ". ./deploy/moode/tikpal-alsa-loopback.sh; tikpal_validate_alsa_loopback_config \"$1\"", "sh", externalLoopbackConfig], {
    cwd: ROOT,
    encoding: "utf8"
  });
  assert(externalGuardCheck.status === 0, `ALSA Loopback guard should accept non-HDMI physical output:\n${externalGuardCheck.stdout}\n${externalGuardCheck.stderr}`);

  const check = spawnSync("bash", ["deploy/chromium/launch-tikpal-kiosk.sh", "--check"], {
    cwd: ROOT,
    env: {
      ...process.env,
      TIKPAL_CHROMIUM_BIN: process.execPath,
      TIKPAL_CHROMIUM_PROFILE_DIR: path.join(ROOT, ".tikpal", "kiosk-smoke-profile"),
      TIKPAL_KIOSK_REMOTE_DEBUG: "1",
      TIKPAL_KIOSK_REMOTE_DEBUG_ADDRESS: "0.0.0.0",
      TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_PORT: "9223",
      TIKPAL_KIOSK_XRANDR_MODE: "none"
    },
    encoding: "utf8"
  });

  assert(check.status === 0, `launcher --check failed:\n${check.stdout}\n${check.stderr}`);
  assert(check.stdout.includes("check passed"), "launcher --check should report success");
  assert(check.stdout.includes("chromium window: 2560,720"), "launcher should normalize Chromium window size");
  assert(check.stdout.includes("window position: 0,0"), "launcher should pin Chromium to the top-left display origin");
  assert(check.stdout.includes("remote debug: 0.0.0.0:9222 -> 127.0.0.1:9223"), "launcher should report remote debugging proxy target");

  const overrideEnvDir = mkdtempSync(path.join(tmpdir(), "tikpal-kiosk-env-override-"));
  const overrideEnvFile = path.join(overrideEnvDir, ".env.kiosk");
  writeFileSync(overrideEnvFile, "TIKPAL_KIOSK_WINDOW=800x600\nTIKPAL_KIOSK_XRANDR_MODE=none\n");
  const skipEnvCheck = spawnSync("bash", ["deploy/chromium/launch-tikpal-kiosk.sh", "--check"], {
    cwd: ROOT,
    env: {
      ...process.env,
      TIKPAL_CHROMIUM_BIN: process.execPath,
      TIKPAL_CHROMIUM_PROFILE_DIR: path.join(ROOT, ".tikpal", "kiosk-smoke-profile"),
      TIKPAL_KIOSK_ENV_FILE: overrideEnvFile,
      TIKPAL_KIOSK_SKIP_ENV_SOURCE: "1",
      TIKPAL_KIOSK_WINDOW: "2560x720",
      TIKPAL_KIOSK_XRANDR_MODE: "2560x720"
    },
    encoding: "utf8"
  });
  assert(skipEnvCheck.status === 0, `launcher skip-env --check failed:\n${skipEnvCheck.stdout}\n${skipEnvCheck.stderr}`);
  assert(skipEnvCheck.stdout.includes("window: 2560x720"), "launcher should preserve systemd-provided window when env sourcing is skipped");

  const webModeCheck = spawnSync("bash", ["deploy/chromium/tikpal-web-mode.sh", "--check"], {
    cwd: ROOT,
    env: {
      ...process.env,
      TIKPAL_CHROMIUM_BIN: process.execPath,
      TIKPAL_KIOSK_XRANDR_MODE: "none"
    },
    encoding: "utf8"
  });
  assert(webModeCheck.status === 0, `web mode --check failed:\n${webModeCheck.stdout}\n${webModeCheck.stderr}`);
  assert(webModeCheck.stdout.includes("left: 0,0 1920,720"), "web mode should keep the provider window on the left");
  assert(webModeCheck.stdout.includes("panel: 1920,0 640,720"), "web mode should keep the Tikpal panel on the right");
  assert(webModeCheck.stdout.includes("single provider window: 1"), "web mode should guard against multiple visible provider windows");
  assert(webModeCheck.stdout.includes("popup blocking: 1"), "web mode should enable provider popup blocking by default");
  assert(webModeCheck.stdout.includes("extension: 0"), "web mode should keep the unpacked extension disabled by default");
  assert(webModeCheck.stdout.includes("provider debug: 127.0.0.1:9234"), "web mode should expose only a local provider CDP port");
  assert(webModeCheck.stdout.includes("provider debug stride: per-provider"), "web mode should avoid CDP port clashes during staged provider switches");
  assert(webModeCheck.stdout.includes("provider guard: 1"), "web mode should enable the provider guard by default");
  assert(webModeCheck.stdout.includes("provider hang monitor: 1"), "web mode should suppress provider unresponsive dialogs");
  assert(webModeCheck.stdout.includes("switch lock timeout: 2s"), "web mode should report the bounded provider switch lock timeout");
  assert(webModeCheck.stdout.includes("error page: http://127.0.0.1:4173/web-mode-error.html"), "web mode should report the friendly error page URL");
  assert(webModeCheck.stdout.includes("transition page: http://127.0.0.1:4173/web-mode-transition.html"), "web mode should report the staged switch transition page");
  assert(webModeCheck.stdout.includes("onboard: 500,420 900,280"), "web mode should place the full Onboard keyboard near provider login inputs");
  assert(webModeCheck.stdout.includes("onboard input focus: 1"), "web mode should enable input-focus keyboard activation");
  assert(webModeCheck.stdout.includes("qq scoped auto confirm: 1"), "web mode should keep QQ auto-confirm scoped inside the provider guard");
  assert(webModeCheck.stdout.includes("proxy: enabled http://192.168.10.140:7897"), "web mode should default to the HTTP development proxy");

  const providerGuardCheck = spawnSync(process.execPath, ["deploy/chromium/tikpal-web-mode-guard.mjs", "--check"], {
    cwd: ROOT,
    encoding: "utf8"
  });
  assert(providerGuardCheck.status === 0, `provider guard --check failed:\n${providerGuardCheck.stdout}\n${providerGuardCheck.stderr}`);
  assert(providerGuardCheck.stdout.includes("check passed"), "provider guard should report check passed");
  assert(providerGuardCheck.stdout.includes("kiosk interaction blocking: 1"), "provider guard should disable browser-like context gestures");
  assert(providerGuardCheck.stdout.includes("friendly error redirect: 1"), "provider guard should redirect Chromium error pages");
  assert(providerGuardCheck.stdout.includes("provider native failure redirect: 1"), "provider guard should redirect provider-native failure pages");
  assert(providerGuardCheck.stdout.includes("oauth navigation abort ignored: 1"), "provider guard should not redirect normal OAuth navigation aborts");
  assert(providerGuardCheck.stdout.includes("safe consent auto confirm: 1"), "provider guard should auto-confirm safe cookie consent prompts");
  assert(providerGuardCheck.stdout.includes("input focus keyboard: 1"), "provider guard should raise Onboard when provider inputs receive focus");
  assert(providerGuardCheck.stdout.includes("empty page timeout: 18s"), "provider guard should redirect long-running blank provider pages");
  assert(providerGuardCheck.stdout.includes("取消"), "provider guard should include safe QQ cancel prompts");
  assert(providerGuardCheck.stdout.includes("youtube safe dismiss: 1"), "provider guard should dismiss safe YouTube prompts");
  assert(providerGuardCheck.stdout.includes("no, thanks"), "provider guard should include the YouTube no-thanks prompt");
  assert(providerGuardCheck.stdout.includes("关闭"), "provider guard should include safe QQ close prompts");
  assert(providerGuardCheck.stdout.includes("dismiss labels:"), "provider guard should allow safe dismiss prompts without accepting upsells");
  assert(providerGuardCheck.stdout.includes("duplicate player pruning: 1"), "provider guard should prune duplicate QQ player pages");
  assert(providerGuardCheck.stdout.includes("single pane navigation: 1"), "provider guard should keep QQ links in the left pane");
  const providerGuardSource = await readFile(path.join(ROOT, "deploy/chromium/tikpal-web-mode-guard.mjs"), "utf8");
  assert(providerGuardSource.includes("querySelectorAll(\"iframe\")"), "provider guard should scan same-origin QQ modal iframes");
  assert(providerGuardSource.includes("[class*='confirm']"), "provider guard should recognize QQ confirm-style modal containers");
  assert(providerGuardSource.includes("unsupported_browser"), "provider guard should classify unsupported-browser provider failures");
  assert(providerGuardSource.includes("region_unavailable"), "provider guard should classify region-blocked provider failures");
  assert(providerGuardSource.includes("Number(diagnostics?.visibleCount || 0) <= 3"), "provider guard should not classify a populated provider loading shell as empty");
  assert(providerGuardSource.includes("diagnostics?.resourceCount || 0"), "provider guard should reset the empty-page timeout while provider resources are still loading");
  assert(providerGuardSource.includes("__tikpalInputFocusGuardInstalled"), "provider guard should hot-install input focus handling on existing provider pages");
  assert(webModeScript.includes('args+=("--disable-hang-monitor")'), "provider Chromium should not block Explore return on a page-unresponsive dialog");
  assert(webModeScript.includes('pkill -KILL -f -- "--user-data-dir=$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/"'), "Explore close should force-exit an unresponsive provider after the grace period");

  const webModeErrorPage = await readFile(path.join(ROOT, "public/web-mode-error.html"), "utf8");
  assert(webModeErrorPage.includes("did not respond"), "friendly Explore error page should avoid native Chromium error copy");
  assert(webModeErrorPage.includes("Proxy switch"), "friendly Explore error page should point users to the side-panel proxy switch");
  assert(!webModeErrorPage.includes("sendKioskHeartbeat"), "friendly Explore error page should not post kiosk heartbeats");
  const webModeTransitionPage = await readFile(path.join(ROOT, "public/web-mode-transition.html"), "utf8");
  assert(webModeTransitionPage.includes("Opening Explore"), "Explore transition page should provide a local staged-switch veil");
  assert(!webModeTransitionPage.includes("sendKioskHeartbeat"), "Explore transition page should not post kiosk heartbeats");

  const watchdogCheck = spawnSync("bash", ["deploy/chromium/tikpal-kiosk-healthcheck.sh", "--check"], {
    cwd: ROOT,
    env: {
      ...process.env,
      TIKPAL_KIOSK_WATCHDOG_STATE_DIR: mkdtempSync(path.join(tmpdir(), "tikpal-kiosk-watchdog-smoke-"))
    },
    encoding: "utf8"
  });
  assert(watchdogCheck.status === 0, `watchdog --check failed:\n${watchdogCheck.stdout}\n${watchdogCheck.stderr}`);
  assert(watchdogCheck.stdout.includes("watchdog enabled: 1"), "watchdog --check should report that it is enabled");
  assert(watchdogCheck.stdout.includes("page heartbeat enabled: 1"), "watchdog --check should report page heartbeat scanning");
  assert(watchdogCheck.stdout.includes("/api/v1/kiosk/heartbeat"), "watchdog --check should report the heartbeat endpoint");
  assert(watchdogCheck.stdout.includes("web mode profile root:"), "watchdog --check should report the Explore profile root used for heartbeat bypass");
  assert(watchdogCheck.stdout.includes("check passed"), "watchdog --check should report success");

  const heartbeatSmokeDir = mkdtempSync(path.join(tmpdir(), "tikpal-heartbeat-smoke-"));
  const heartbeatSmokePortFile = path.join(heartbeatSmokeDir, "port");
  const heartbeatSmokeServer = spawn(process.execPath, [
    "-e",
    `
      const fs = require("node:fs");
      const http = require("node:http");
      const server = http.createServer((_request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          ok: true,
          healthy: false,
          status: "unhealthy",
          reasons: ["pending-stuck:source:mpd"]
        }));
      });
      server.listen(0, "127.0.0.1", () => {
        fs.writeFileSync(process.argv[1], String(server.address().port));
      });
      process.on("SIGTERM", () => server.close(() => process.exit(0)));
    `,
    heartbeatSmokePortFile
  ], {
    stdio: "ignore"
  });
  try {
    let heartbeatSmokePort = "";
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        heartbeatSmokePort = (await readFile(heartbeatSmokePortFile, "utf8")).trim();
      } catch {
        // The child writes the port after listen().
      }
      if (heartbeatSmokePort) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert(/^[0-9]+$/.test(heartbeatSmokePort), "heartbeat smoke server should expose a port");
    const watchdogDryRun = spawnSync("bash", ["deploy/chromium/tikpal-kiosk-healthcheck.sh"], {
      cwd: ROOT,
      env: {
        ...process.env,
        TIKPAL_KIOSK_WATCHDOG_STATE_DIR: mkdtempSync(path.join(tmpdir(), "tikpal-kiosk-watchdog-dry-run-")),
        TIKPAL_KIOSK_WATCHDOG_DRY_RUN: "1",
        TIKPAL_KIOSK_WATCHDOG_X_DISPLAY_SCAN: "0",
        TIKPAL_KIOSK_WATCHDOG_CHROMIUM_PROCESS_SCAN: "0",
        TIKPAL_KIOSK_WATCHDOG_WEB_URL_SCAN: "0",
        TIKPAL_KIOSK_WATCHDOG_API_URL_SCAN: "0",
        TIKPAL_KIOSK_WATCHDOG_GPU_LOG_SCAN: "0",
        TIKPAL_KIOSK_WATCHDOG_PAGE_HEARTBEAT_URL: `http://127.0.0.1:${heartbeatSmokePort}/heartbeat`
      },
      encoding: "utf8"
    });
    assert(watchdogDryRun.status === 0, `watchdog dry-run unhealthy page smoke failed:\n${watchdogDryRun.stdout}\n${watchdogDryRun.stderr}`);
    assert(watchdogDryRun.stdout.includes("page-unhealthy:pending-stuck:source:mpd"), "watchdog dry-run should include the page-unhealthy reason");
    assert(watchdogDryRun.stdout.includes("dry-run restart suppressed"), "watchdog dry-run should suppress the real service restart");

    const webModeProfileRoot = mkdtempSync(path.join(tmpdir(), "tikpal-web-mode-profile-"));
    const fakeProvider = spawn(process.execPath, [
      "-e",
      "setTimeout(() => {}, 60000)",
      "--",
      `--user-data-dir=${path.join(webModeProfileRoot, "providers", "qq_music")}`
    ], {
      stdio: "ignore"
    });
    try {
      const watchdogWebModeBypass = spawnSync("bash", ["deploy/chromium/tikpal-kiosk-healthcheck.sh"], {
        cwd: ROOT,
        env: {
          ...process.env,
          TIKPAL_KIOSK_WATCHDOG_STATE_DIR: mkdtempSync(path.join(tmpdir(), "tikpal-kiosk-watchdog-web-mode-")),
          TIKPAL_KIOSK_WATCHDOG_DRY_RUN: "1",
          TIKPAL_KIOSK_WATCHDOG_X_DISPLAY_SCAN: "0",
          TIKPAL_KIOSK_WATCHDOG_CHROMIUM_PROCESS_SCAN: "0",
          TIKPAL_KIOSK_WATCHDOG_WEB_URL_SCAN: "0",
          TIKPAL_KIOSK_WATCHDOG_API_URL_SCAN: "0",
          TIKPAL_KIOSK_WATCHDOG_GPU_LOG_SCAN: "0",
          TIKPAL_KIOSK_WATCHDOG_PAGE_HEARTBEAT_URL: `http://127.0.0.1:${heartbeatSmokePort}/heartbeat`,
          TIKPAL_WEB_MODE_PROFILE_ROOT: webModeProfileRoot
        },
        encoding: "utf8"
      });
      assert(watchdogWebModeBypass.status === 0, `watchdog should bypass stale heartbeat while Explore provider is active:\n${watchdogWebModeBypass.stdout}\n${watchdogWebModeBypass.stderr}`);
      assert(!watchdogWebModeBypass.stdout.includes("page-unhealthy"), "watchdog should not report page-unhealthy while Explore provider is active");
      assert(!watchdogWebModeBypass.stdout.includes("dry-run restart suppressed"), "watchdog should not restart while Explore provider is active");
    } finally {
      fakeProvider.kill("SIGTERM");
      await new Promise((resolve) => fakeProvider.once("exit", resolve));
    }
  } finally {
    heartbeatSmokeServer.kill("SIGTERM");
    await new Promise((resolve) => heartbeatSmokeServer.once("exit", resolve));
  }

  const devtoolsCheck = spawnSync("bash", ["deploy/chromium/start-tikpal-kiosk-devtools-proxy.sh", "--check"], {
    cwd: ROOT,
    env: {
      ...process.env,
      TIKPAL_KIOSK_REMOTE_DEBUG: "1",
      TIKPAL_KIOSK_REMOTE_DEBUG_ADDRESS: "0.0.0.0",
      TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_PORT: "9223"
    },
    encoding: "utf8"
  });
  assert(devtoolsCheck.status === 0, `DevTools proxy --check failed:\n${devtoolsCheck.stdout}\n${devtoolsCheck.stderr}`);
  assert(devtoolsCheck.stdout.includes("public endpoint: 0.0.0.0:9222"), "DevTools proxy should report public endpoint");
  assert(devtoolsCheck.stdout.includes("chromium endpoint: 127.0.0.1:9223"), "DevTools proxy should report Chromium endpoint");

  const displayCheck = spawnSync("bash", ["deploy/chromium/start-tikpal-kiosk-display.sh", "--check"], {
    cwd: ROOT,
    env: {
      ...process.env,
      TIKPAL_KIOSK_DISPLAY_MODE: "virtual",
      TIKPAL_KIOSK_WINDOW: "2560x720"
    },
    encoding: "utf8"
  });
  assert(displayCheck.status === 0, `display wrapper --check failed:\n${displayCheck.stdout}\n${displayCheck.stderr}`);
  assert(displayCheck.stdout.includes("active display mode: virtual"), "display wrapper should expose virtual mode");
  assert(displayCheck.stdout.includes("virtual geometry: 2560x720x24"), "display wrapper should derive Xvfb geometry");

  const viewerCheck = spawnSync("bash", ["deploy/chromium/start-tikpal-kiosk-viewer.sh", "--check"], {
    cwd: ROOT,
    env: {
      ...process.env,
      TIKPAL_KIOSK_VIEWER: "novnc"
    },
    encoding: "utf8"
  });
  assert(viewerCheck.status === 0, `viewer wrapper --check failed:\n${viewerCheck.stdout}\n${viewerCheck.stderr}`);
  assert(viewerCheck.stdout.includes("viewer: novnc"), "viewer wrapper should report noVNC mode");
  assert(viewerCheck.stdout.includes("novnc: 0.0.0.0:6080"), "viewer wrapper should report noVNC endpoint");

  const viewerCtlCheck = spawnSync("bash", ["deploy/chromium/tikpal-kiosk-viewerctl.sh", "--check"], {
    cwd: ROOT,
    env: {
      ...process.env,
      TIKPAL_KIOSK_VIEWER_ENV_FILE: path.join(tmpdir(), "tikpal-kiosk-viewer-smoke.env")
    },
    encoding: "utf8"
  });
  assert(viewerCtlCheck.status === 0, `viewerctl --check failed:\n${viewerCtlCheck.stdout}\n${viewerCtlCheck.stderr}`);
  assert(viewerCtlCheck.stdout.includes("novnc endpoint: 0.0.0.0:6080"), "viewerctl should report the default noVNC endpoint");
  assert(viewerCtlCheck.stdout.includes("check passed"), "viewerctl --check should report success");

  const quietBootDir = mkdtempSync(path.join(tmpdir(), "tikpal-quiet-boot-"));
  const quietBootCmdline = path.join(quietBootDir, "cmdline.txt");
  writeFileSync(
    quietBootCmdline,
    "console=serial0,115200 console=tty1 root=PARTUUID=abc rootfstype=ext4 fsck.repair=yes rootwait\n"
  );
  const quietBootCheck = spawnSync("bash", [
    "deploy/moode/tikpal-quiet-boot-enable.sh",
    "--dry-run",
    "--cmdline",
    quietBootCmdline
  ], {
    cwd: ROOT,
    encoding: "utf8"
  });

  assert(quietBootCheck.status === 0, `quiet boot dry-run failed:\n${quietBootCheck.stdout}\n${quietBootCheck.stderr}`);
  const nextCmdline = quietBootCheck.stdout.match(/next cmdline: (.+)/)?.[1] ?? "";
  assert(!/\bconsole=tty[0-9]*\b/.test(nextCmdline), "quiet boot should remove visible tty consoles from the kernel cmdline");
  assert(nextCmdline.includes("systemd.show_status=false"), "quiet boot should hide systemd status lines");
  assert(nextCmdline.includes("vt.global_cursor_default=0"), "quiet boot should hide the text cursor");
  assert(quietBootCheck.stdout.includes("planned: mask getty@tty1.service"), "quiet boot should mask tty1 getty");
  assert(quietBootCheck.stdout.includes("planned: mask getty@tty2.service"), "quiet boot should mask tty2 getty");
  assert(quietBootCheck.stdout.includes("planned: mask getty@tty3.service"), "quiet boot should mask tty3 getty");

  console.log("kiosk package smoke passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
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
  "deploy/chromium/chromium-flags.conf",
  "deploy/chromium/managed-policies.json",
  "deploy/chromium/env.kiosk.example",
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

  const kioskEnv = await readFile(path.join(ROOT, "deploy/chromium/env.kiosk.example"), "utf8");
  assert(kioskEnv.includes("TIKPAL_KIOSK_REMOTE_DEBUG=0"), "kiosk env should default remote debugging off");
  assert(kioskEnv.includes("TIKPAL_KIOSK_VIEWER=none"), "kiosk env should default noVNC viewer off");
  assert(kioskEnv.includes("TIKPAL_KIOSK_DISPLAY_MODE=auto"), "kiosk env should document automatic physical/virtual display selection");
  assert(kioskEnv.includes("TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS=5"), "kiosk env should document bounded xset/xrandr commands");
  assert(kioskEnv.includes("TIKPAL_KIOSK_WATCHDOG_ENABLED=1"), "kiosk env should default the display watchdog on");
  assert(kioskEnv.includes("TIKPAL_KIOSK_WATCHDOG_GPU_LOG_SCAN=1"), "kiosk env should enable GPU reset log scanning");
  assert(kioskEnv.includes("TIKPAL_KIOSK_WATCHDOG_PAGE_HEARTBEAT_ENABLED=1"), "kiosk env should enable page heartbeat scanning");
  assert(kioskEnv.includes("TIKPAL_KIOSK_WATCHDOG_PAGE_HEARTBEAT_URL=http://127.0.0.1:8787/api/v1/kiosk/heartbeat"), "kiosk env should point the watchdog at the loopback page heartbeat API");
  assert(kioskEnv.includes("TIKPAL_KIOSK_WATCHDOG_REBOOT_AFTER_RESTARTS=3"), "kiosk env should document persistent display-failure reboot escalation");
  assert(kioskEnv.includes("TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE="), "kiosk env should expose Chromium ALSA output selection");
  assert(!kioskEnv.includes("TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE=_audioout"), "kiosk env should not default Chromium Scene Sound to Loopback-backed _audioout");
  assert(kioskEnv.includes("dmix:CARD="), "kiosk env should document physical USB dmix output for Chromium Scene Sound");
  const kioskLauncher = await readFile(path.join(ROOT, "deploy/chromium/launch-tikpal-kiosk.sh"), "utf8");
  const kioskSession = await readFile(path.join(ROOT, "deploy/chromium/start-tikpal-kiosk-session.sh"), "utf8");
  assert(kioskLauncher.includes("TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS"), "kiosk launcher should expose an X command timeout");
  assert(kioskLauncher.includes("run_x_command xrandr"), "kiosk launcher should bound xrandr commands");
  assert(kioskLauncher.includes("run_x_command xset"), "kiosk launcher should bound xset commands");
  assert(kioskSession.includes("TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS"), "kiosk session should expose an X command timeout");
  assert(kioskSession.includes("run_x_command xset"), "kiosk session should bound xset commands");

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
  assert(webModeCheck.stdout.includes("web-mode-extension"), "web mode should report the bundled navigation guard extension");
  assert(webModeCheck.stdout.includes("proxy: enabled http://192.168.10.140:7897"), "web mode should default to the HTTP development proxy");

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
  assert(nextCmdline.includes("console=tty3"), "quiet boot should move visible console away from tty1");
  assert(!nextCmdline.includes("console=tty1"), "quiet boot should remove tty1 from the kernel console");
  assert(nextCmdline.includes("systemd.show_status=false"), "quiet boot should hide systemd status lines");
  assert(nextCmdline.includes("vt.global_cursor_default=0"), "quiet boot should hide the text cursor");

  console.log("kiosk package smoke passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

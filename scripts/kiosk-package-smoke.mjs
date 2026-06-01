import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
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
  "deploy/chromium/chromium-flags.conf",
  "deploy/chromium/managed-policies.json",
  "deploy/chromium/env.kiosk.example",
  "deploy/moode/tikpal-snd-aloop-enable.sh",
  "deploy/moode/tikpal-quiet-boot-enable.sh",
  "deploy/systemd/tikpal-api.service",
  "deploy/systemd/tikpal-web.service",
  "deploy/systemd/tikpal-kiosk-devtools.service",
  "deploy/systemd/tikpal-kiosk.service",
  "deploy/systemd/tikpal-kiosk-viewer.service",
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
  await assertExecutable("deploy/moode/tikpal-snd-aloop-enable.sh");
  await assertExecutable("deploy/moode/tikpal-quiet-boot-enable.sh");
  await assertExecutable("deploy/systemd/install-systemd-services.sh");

  const apiUnit = await readFile(path.join(ROOT, "deploy/systemd/tikpal-api.service"), "utf8");
  const webUnit = await readFile(path.join(ROOT, "deploy/systemd/tikpal-web.service"), "utf8");
  const kioskDevtoolsUnit = await readFile(path.join(ROOT, "deploy/systemd/tikpal-kiosk-devtools.service"), "utf8");
  const kioskUnit = await readFile(path.join(ROOT, "deploy/systemd/tikpal-kiosk.service"), "utf8");
  const kioskViewerUnit = await readFile(path.join(ROOT, "deploy/systemd/tikpal-kiosk-viewer.service"), "utf8");
  assert(apiUnit.includes("network.target"), "api unit should use network.target");
  assert(!apiUnit.includes("network-online.target"), "api unit should not wait for network-online.target");
  assert(webUnit.includes("server/web.mjs"), "web unit should use the production static server");
  assert(kioskDevtoolsUnit.includes("start-tikpal-kiosk-devtools-proxy.sh"), "kiosk DevTools unit should launch the LAN proxy");
  assert(kioskDevtoolsUnit.includes("PartOf=tikpal-kiosk.service"), "kiosk DevTools proxy should follow kiosk service lifecycle");
  assert(kioskUnit.includes("start-tikpal-kiosk-display.sh"), "kiosk unit should launch the display-mode wrapper");
  assert(!kioskUnit.includes("/usr/bin/startx"), "kiosk unit should leave physical versus virtual X startup to the wrapper");
  assert(kioskViewerUnit.includes("start-tikpal-kiosk-viewer.sh"), "kiosk viewer unit should launch the noVNC wrapper");
  assert(kioskViewerUnit.includes("PartOf=tikpal-kiosk.service"), "kiosk viewer should follow kiosk service lifecycle");

  const kioskEnv = await readFile(path.join(ROOT, "deploy/chromium/env.kiosk.example"), "utf8");
  assert(kioskEnv.includes("TIKPAL_KIOSK_REMOTE_DEBUG=0"), "kiosk env should default remote debugging off");
  assert(kioskEnv.includes("TIKPAL_KIOSK_VIEWER=novnc"), "kiosk env should document noVNC viewer mode");
  assert(kioskEnv.includes("TIKPAL_KIOSK_DISPLAY_MODE=auto"), "kiosk env should document automatic physical/virtual display selection");

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

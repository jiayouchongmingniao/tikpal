import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const requiredFiles = [
  "server/index.mjs",
  "server/web.mjs",
  "deploy/chromium/launch-tikpal-kiosk.sh",
  "deploy/chromium/start-tikpal-kiosk-session.sh",
  "deploy/chromium/chromium-flags.conf",
  "deploy/chromium/managed-policies.json",
  "deploy/chromium/env.kiosk.example",
  "deploy/systemd/tikpal-api.service",
  "deploy/systemd/tikpal-web.service",
  "deploy/systemd/tikpal-kiosk.service",
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
  await assertExecutable("deploy/chromium/start-tikpal-kiosk-session.sh");
  await assertExecutable("deploy/systemd/install-systemd-services.sh");

  const apiUnit = await readFile(path.join(ROOT, "deploy/systemd/tikpal-api.service"), "utf8");
  const webUnit = await readFile(path.join(ROOT, "deploy/systemd/tikpal-web.service"), "utf8");
  const kioskUnit = await readFile(path.join(ROOT, "deploy/systemd/tikpal-kiosk.service"), "utf8");
  assert(apiUnit.includes("network.target"), "api unit should use network.target");
  assert(!apiUnit.includes("network-online.target"), "api unit should not wait for network-online.target");
  assert(webUnit.includes("server/web.mjs"), "web unit should use the production static server");
  assert(kioskUnit.includes("startx"), "kiosk unit should own X startup through startx");
  assert(kioskUnit.includes("start-tikpal-kiosk-session.sh"), "kiosk unit should launch the session wrapper");

  const check = spawnSync("bash", ["deploy/chromium/launch-tikpal-kiosk.sh", "--check"], {
    cwd: ROOT,
    env: {
      ...process.env,
      TIKPAL_CHROMIUM_BIN: process.execPath,
      TIKPAL_CHROMIUM_PROFILE_DIR: path.join(ROOT, ".tikpal", "kiosk-smoke-profile"),
      TIKPAL_KIOSK_XRANDR_MODE: "none"
    },
    encoding: "utf8"
  });

  assert(check.status === 0, `launcher --check failed:\n${check.stdout}\n${check.stderr}`);
  assert(check.stdout.includes("check passed"), "launcher --check should report success");

  console.log("kiosk package smoke passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

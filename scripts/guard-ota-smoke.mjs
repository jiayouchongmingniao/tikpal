#!/usr/bin/env node
import { spawn } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UPDATER = join(ROOT, "deploy", "chromium", "tikpal-guard-ota.mjs");
const RUNNER = join(ROOT, "deploy", "chromium", "tikpal-guard-ota-run.sh");
const PACKAGER = join(ROOT, "scripts", "build-guard-ota-release.mjs");
const REQUIRED_FILES = [
  "web-mode-extension",
  "tikpal-web-mode-guard.mjs",
  "tikpal-web-mode-qq-confirm.mjs",
  "tikpal-close-audio.mjs",
  "tikpal-oauth-window-layout.mjs",
  "guard-ota-extension-key.sha256"
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wait(milliseconds) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));
}

function run(command, args, { env = process.env } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.once("error", rejectPromise);
    child.once("close", code => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else rejectPromise(new Error(`${command} ${args.join(" ")} failed (${code}): ${stderr || stdout}`));
    });
  });
}

async function runJson(command, args, options) {
  const result = await run(command, args, options);
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    throw new Error(`Expected JSON from ${command}: ${result.stdout}\n${result.stderr}`);
  }
}

async function copyGuardSource(target) {
  for (const source of REQUIRED_FILES) {
    await cp(join(ROOT, "deploy", "chromium", source), join(target, source), { recursive: true, verbatimSymlinks: true });
  }
}

async function writeExtensionVersion(sourceRoot, version) {
  const path = join(sourceRoot, "web-mode-extension", "manifest.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  manifest.version = version;
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function startStaticServer(root) {
  let pointerDelayMs = 0;
  let interruptNextArchive = false;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const requested = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, "");
    if (!requested || requested.startsWith("..") || requested.includes(`${String.fromCharCode(0)}`)) {
      response.writeHead(400).end();
      return;
    }
    try {
      const bytes = await readFile(join(root, requested));
      if (requested.startsWith("guard/v1/channels/") && requested.endsWith(".json") && pointerDelayMs > 0) await wait(pointerDelayMs);
      response.writeHead(200, { "Content-Length": bytes.byteLength, "Cache-Control": "no-store" });
      if (requested.endsWith("/guard-browser-bundle.tar.gz") && interruptNextArchive) {
        interruptNextArchive = false;
        response.write(bytes.subarray(0, Math.max(1, Math.floor(bytes.byteLength / 2))));
        response.destroy();
        return;
      }
      response.end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Guard OTA fixture server did not bind a TCP port");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    setPointerDelay(milliseconds) { pointerDelayMs = milliseconds; },
    interruptArchiveOnce() { interruptNextArchive = true; },
    close: () => new Promise(resolvePromise => server.close(resolvePromise))
  };
}

async function main() {
  const workspace = await mkdtemp(join(tmpdir(), "tikpal-guard-ota-smoke-"));
  let staticServer = null;
  try {
    const bundled = join(workspace, "bundled");
    const releaseSource = join(workspace, "release-1.1.8");
    const stableSource = join(workspace, "release-1.1.7");
    const output = join(workspace, "published");
    const stateRoot = join(workspace, "device-state");
    const wrapperStateRoot = join(workspace, "wrapper-device-state");
    const profileMarker = join(workspace, "provider-profile", "cookies-kept.txt");
    await copyGuardSource(bundled);
    await copyGuardSource(releaseSource);
    await copyGuardSource(stableSource);
    await writeExtensionVersion(releaseSource, "1.1.8");
    await mkdir(dirname(profileMarker), { recursive: true });
    await writeFile(profileMarker, "provider login state must survive Guard activation\n");

    const keys = generateKeyPairSync("ed25519");
    const privateKeyPath = join(workspace, "release-private.pem");
    const publicKeyPath = join(workspace, "device-public.pem");
    await writeFile(privateKeyPath, keys.privateKey.export({ type: "pkcs8", format: "pem" }));
    await writeFile(publicKeyPath, keys.publicKey.export({ type: "spki", format: "pem" }));
    const wrapperEnvPath = join(workspace, "device.env");
    await writeFile(wrapperEnvPath, [
      "TIKPAL_GUARD_OTA_ENABLED=1",
      `TIKPAL_GUARD_OTA_ROOT=${wrapperStateRoot}`,
      "TIKPAL_GUARD_OTA_CHANNEL=test"
    ].join("\n") + "\n");
    await run("bash", [RUNNER, "--bootstrap"], {
      env: { ...process.env, TIKPAL_KIOSK_ENV_FILE: wrapperEnvPath }
    });
    const wrapperState = JSON.parse(await readFile(join(wrapperStateRoot, "state.json"), "utf8"));
    assert(wrapperState.installedVersion === "1.1.7", "the systemd runner bootstrap must source device configuration and create its local Guard state");
    staticServer = await startStaticServer(output);

    await run(process.execPath, [PACKAGER, "--version", "1.1.8", "--out", output, "--private-key-file", privateKeyPath, "--channel", "test", "--base-url", staticServer.baseUrl, "--source-root", releaseSource]);
    const channelPath = join(output, "guard", "v1", "channels", "test.json");
    const channelSignaturePath = `${channelPath}.sig`;
    const currentChannel = await readFile(channelPath);
    const currentChannelSignature = await readFile(channelSignaturePath);
    const updaterEnv = {
      ...process.env,
      TIKPAL_GUARD_OTA_ENABLED: "1",
      TIKPAL_GUARD_OTA_ROOT: stateRoot,
      TIKPAL_GUARD_OTA_BUNDLED_ROOT: bundled,
      TIKPAL_GUARD_OTA_PUBLIC_KEY_PATH: publicKeyPath,
      TIKPAL_GUARD_OTA_PUBLIC_KEY: "",
      TIKPAL_GUARD_OTA_CHANNEL: "test",
      TIKPAL_GUARD_OTA_CHANNEL_URL: `${staticServer.baseUrl}/guard/v1/channels/test.json`,
      TIKPAL_GUARD_OTA_ALLOW_INSECURE_TEST_URL: "1"
    };

    const bootstrap = await runJson(process.execPath, [UPDATER, "bootstrap"], { env: updaterEnv });
    assert(bootstrap.current === "1.1.7", "bootstrap should install the app-bundled Guard before checking R2");
    const bundledGuard = await run(process.execPath, [join(stateRoot, "current", "tikpal-web-mode-guard.mjs"), "--check"], { env: updaterEnv });
    assert(bundledGuard.stdout.includes("[tikpal-web-mode-guard] check passed"), "the installed Guard bundle must resolve every local ESM dependency");
    staticServer.setPointerDelay(180);
    const firstCheck = runJson(process.execPath, [UPDATER, "check"], { env: updaterEnv });
    await wait(40);
    const busyCheck = await runJson(process.execPath, [UPDATER, "check"], { env: updaterEnv });
    const staged = await firstCheck;
    staticServer.setPointerDelay(0);
    assert(busyCheck.result === "busy", "concurrent timer checks must share one local updater lock");
    assert(staged.state === "pending_idle" && staged.stagedVersion === "1.1.8", "a valid signed release should download and wait for Explore to become idle");
    assert(await readFile(profileMarker, "utf8") === "provider login state must survive Guard activation\n", "staging must not touch provider profiles");

    const activated = await runJson(process.execPath, [UPDATER, "activate"], { env: updaterEnv });
    assert(activated.state === "pending_activation" && activated.installedVersion === "1.1.8" && activated.previousVersion === "1.1.7", "activation should atomically promote the staged Guard and retain one previous version");
    const confirmed = await runJson(process.execPath, [UPDATER, "confirm-activation"], { env: updaterEnv });
    assert(confirmed.state === "idle" && confirmed.pendingActivationVersion === null, "a matching first provider marker should confirm the new Guard");

    await run(process.execPath, [PACKAGER, "--version", "1.1.7", "--out", output, "--private-key-file", privateKeyPath, "--channel", "test", "--base-url", staticServer.baseUrl, "--source-root", stableSource]);
    const downgrade = await runJson(process.execPath, [UPDATER, "check"], { env: updaterEnv });
    assert(downgrade.state === "idle" && downgrade.installedVersion === "1.1.8" && downgrade.stagedVersion === null, "a signed downgrade pointer must not replace the installed Guard");

    const rollback = await runJson(process.execPath, [UPDATER, "rollback", "fixture_marker_missing"], { env: updaterEnv });
    assert(rollback.state === "rolled_back" && rollback.installedVersion === "1.1.7" && rollback.previousVersion === "1.1.8", "failed first-load verification should roll back only the Guard release");
    assert(await readFile(profileMarker, "utf8") === "provider login state must survive Guard activation\n", "rollback must retain provider profiles");

    await writeFile(channelPath, currentChannel);
    await writeFile(channelSignaturePath, currentChannelSignature);
    const archivePath = join(output, "guard", "v1", "releases", "1.1.8", "guard-browser-bundle.tar.gz");
    const originalArchive = await readFile(archivePath);
    await writeFile(archivePath, Buffer.concat([originalArchive, Buffer.from("tamper")]));
    const hashRejected = await runJson(process.execPath, [UPDATER, "check"], { env: updaterEnv });
    assert(hashRejected.state === "failed" && hashRejected.lastErrorCode === "ARCHIVE_HASH_MISMATCH", "a changed archive must be rejected before staging");
    await writeFile(archivePath, originalArchive);

    staticServer.interruptArchiveOnce();
    const interrupted = await runJson(process.execPath, [UPDATER, "check"], { env: updaterEnv });
    assert(interrupted.state === "failed" && interrupted.installedVersion === "1.1.7", "an interrupted archive transfer must leave the current Guard active");

    const releasePath = join(output, "guard", "v1", "releases", "1.1.8", "release.json");
    const releaseSignaturePath = `${releasePath}.sig`;
    const originalRelease = await readFile(releasePath);
    const originalReleaseSignature = await readFile(releaseSignaturePath);
    const unsafeRelease = JSON.parse(originalRelease.toString("utf8"));
    unsafeRelease.files[0].path = "../outside";
    const unsafeReleaseBytes = Buffer.from(`${JSON.stringify(unsafeRelease, null, 2)}\n`);
    await writeFile(releasePath, unsafeReleaseBytes);
    await writeFile(releaseSignaturePath, `${sign(null, unsafeReleaseBytes, keys.privateKey).toString("base64")}\n`);
    const unsafePath = await runJson(process.execPath, [UPDATER, "check"], { env: updaterEnv });
    assert(unsafePath.state === "failed" && unsafePath.lastErrorCode === "INVALID_RELEASE", "unsafe signed release paths must still be rejected");
    await writeFile(releasePath, originalRelease);
    await writeFile(releaseSignaturePath, originalReleaseSignature);

    await writeFile(channelSignaturePath, "invalid-signature\n");
    const rejected = await runJson(process.execPath, [UPDATER, "check"], { env: updaterEnv });
    assert(rejected.state === "failed" && rejected.lastErrorCode === "SIGNATURE_INVALID", "a tampered channel pointer must be rejected");
    const afterTamper = await runJson(process.execPath, [UPDATER, "status"], { env: updaterEnv });
    assert(afterTamper.installedVersion === "1.1.7", "a rejected release must leave the last known-good Guard active");

    process.stdout.write("Guard OTA smoke passed: signatures, hashes, interrupted downloads, path validation, timer locking, idle activation, downgrade rejection, rollback, and profile retention.\n");
  } finally {
    await staticServer?.close();
    await rm(workspace, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`[guard-ota-smoke] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});

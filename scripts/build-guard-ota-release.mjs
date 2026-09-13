#!/usr/bin/env node
import { createHash, createPrivateKey, sign } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BASE_URL = "https://updates.tikpal.ai";
// Keep every local ESM dependency of the Guard in the signed, atomic bundle.
// The Guard executes from the activated release directory, so imports cannot
// safely fall back to the application source directory.
const REQUIRED_SCRIPTS = [
  "tikpal-web-mode-guard.mjs",
  "tikpal-web-mode-qq-confirm.mjs",
  "tikpal-close-audio.mjs",
  "tikpal-oauth-window-layout.mjs"
];
const STABLE_EXTENSION_KEY_PATH = join(ROOT, "deploy", "chromium", "guard-ota-extension-key.sha256");

function usage() {
  return "Usage: node scripts/build-guard-ota-release.mjs --version X.Y.Z --out DIR --private-key-file PEM [--channel stable|test] [--base-url URL] [--source-root DIR]";
}

function parseArguments(args) {
  const options = { version: "", out: "", privateKeyFile: "", channel: "stable", baseUrl: DEFAULT_BASE_URL, sourceRoot: join(ROOT, "deploy", "chromium") };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--version") options.version = args[++index] ?? "";
    else if (value === "--out") options.out = args[++index] ?? "";
    else if (value === "--private-key-file") options.privateKeyFile = args[++index] ?? "";
    else if (value === "--channel") options.channel = args[++index] ?? "";
    else if (value === "--base-url") options.baseUrl = args[++index] ?? "";
    else if (value === "--source-root") options.sourceRoot = args[++index] ?? "";
    else throw new Error(`Unexpected argument: ${value}\n${usage()}`);
  }
  if (!options.version || !options.out || !options.privateKeyFile) throw new Error(usage());
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(options.version)) throw new Error("Guard OTA releases require a stable X.Y.Z version");
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(options.channel)) throw new Error("Guard OTA channel names must be lowercase letters, numbers, or hyphens");
  return { ...options, out: resolve(options.out), privateKeyFile: resolve(options.privateKeyFile), sourceRoot: resolve(options.sourceRoot), baseUrl: String(options.baseUrl).replace(/\/$/, "") };
}

async function listFiles(root, prefix = "") {
  const files = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Guard bundle cannot contain a symlink: ${relativePath}`);
    if (entry.isDirectory()) files.push(...await listFiles(absolutePath, relativePath));
    else if (entry.isFile()) files.push(relativePath);
    else throw new Error(`Guard bundle contains an unsupported entry: ${relativePath}`);
  }
  return files;
}

async function hashFile(filePath) {
  const content = await readFile(filePath);
  return { sha256: createHash("sha256").update(content).digest("hex"), bytes: content.byteLength };
}

function run(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-4096); });
    child.once("error", error => rejectPromise(error));
    child.once("close", code => code === 0 ? resolvePromise() : rejectPromise(new Error(stderr.trim() || `${command} exited ${code}`)));
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const extensionSource = join(options.sourceRoot, "web-mode-extension");
  const extensionManifest = JSON.parse(await readFile(join(extensionSource, "manifest.json"), "utf8"));
  const expectedKeySha256 = String(await readFile(STABLE_EXTENSION_KEY_PATH, "utf8")).trim().toLowerCase();
  const extensionKeySha256 = createHash("sha256").update(String(extensionManifest.key ?? "")).digest("hex");
  if (extensionManifest.manifest_version !== 3 || extensionManifest.version !== options.version || !/^[a-f0-9]{64}$/.test(expectedKeySha256) || extensionKeySha256 !== expectedKeySha256) {
    throw new Error("Extension manifest version or stable key does not match the Guard release");
  }
  for (const script of REQUIRED_SCRIPTS) await stat(join(options.sourceRoot, script));
  const temporaryRoot = await mkdtemp(join(tmpdir(), "tikpal-guard-ota-package-"));
  try {
    const bundleRoot = join(temporaryRoot, "bundle");
    await cp(extensionSource, join(bundleRoot, "web-mode-extension"), { recursive: true, verbatimSymlinks: true });
    for (const script of REQUIRED_SCRIPTS) await cp(join(options.sourceRoot, script), join(bundleRoot, script), { verbatimSymlinks: true });
    const files = [
      ...(await listFiles(join(bundleRoot, "web-mode-extension"), "web-mode-extension")),
      ...REQUIRED_SCRIPTS
    ].sort();
    const releaseFiles = [];
    for (const file of files) {
      const source = join(bundleRoot, file);
      await utimes(source, 0, 0);
      releaseFiles.push({ path: file, ...await hashFile(source) });
    }
    const releaseDir = join(options.out, "guard", "v1", "releases", options.version);
    try {
      await stat(releaseDir);
      throw new Error(`Guard OTA release already exists: ${releaseDir}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await mkdir(releaseDir, { recursive: true });
    const archivePath = join(releaseDir, "guard-browser-bundle.tar.gz");
    await run("tar", ["-czf", archivePath, "-C", bundleRoot, ...files]);
    const archive = await hashFile(archivePath);
    const release = {
      schema: 1,
      version: options.version,
      minUpdaterVersion: "1.0.0",
      archive: {
        url: `${options.baseUrl}/guard/v1/releases/${options.version}/guard-browser-bundle.tar.gz`,
        ...archive
      },
      extension: {
        manifestVersion: extensionManifest.version,
        keySha256: extensionKeySha256
      },
      files: releaseFiles
    };
    const privateKey = createPrivateKey(await readFile(options.privateKeyFile, "utf8"));
    const writeSignedJson = async (path, object) => {
      const bytes = Buffer.from(`${JSON.stringify(object, null, 2)}\n`);
      await writeFile(path, bytes, { mode: 0o644 });
      await writeFile(`${path}.sig`, `${sign(null, bytes, privateKey).toString("base64")}\n`, { mode: 0o644 });
    };
    await writeSignedJson(join(releaseDir, "release.json"), release);
    const channelDir = join(options.out, "guard", "v1", "channels");
    await mkdir(channelDir, { recursive: true });
    await writeSignedJson(join(channelDir, `${options.channel}.json`), {
      schema: 1,
      channel: options.channel,
      version: options.version,
      releaseUrl: `${options.baseUrl}/guard/v1/releases/${options.version}/release.json`
    });
    process.stdout.write(`${JSON.stringify({ version: options.version, channel: options.channel, releaseDir, channelDir, files: releaseFiles.length, archiveBytes: archive.bytes })}\n`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`[build-guard-ota-release] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

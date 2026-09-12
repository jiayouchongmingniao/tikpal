#!/usr/bin/env node
import { createHash, createPublicKey, verify } from "node:crypto";
import { constants } from "node:fs";
import { access, cp, lstat, mkdir, readFile, readdir, readlink, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const UPDATER_VERSION = "1.0.0";
const MAX_ARCHIVE_BYTES_DEFAULT = 16 * 1024 * 1024;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(process.env.TIKPAL_APP_DIR ?? join(SCRIPT_DIR, "..", ".."));
const BUNDLED_GUARD_ROOT = resolve(process.env.TIKPAL_GUARD_OTA_BUNDLED_ROOT ?? SCRIPT_DIR);
const OTA_ROOT = resolve(process.env.TIKPAL_GUARD_OTA_ROOT ?? join(APP_DIR, ".tikpal", "guard-ota"));
const CONFIGURED_CHANNEL = String(process.env.TIKPAL_GUARD_OTA_CHANNEL ?? "stable").trim().toLowerCase();
const CHANNEL_NAME = /^[a-z][a-z0-9-]{0,31}$/.test(CONFIGURED_CHANNEL) ? CONFIGURED_CHANNEL : null;
const CHANNEL_URL = String(process.env.TIKPAL_GUARD_OTA_CHANNEL_URL ?? `https://updates.tikpal.ai/guard/v1/channels/${CHANNEL_NAME ?? "stable"}.json`).trim();
const ENABLED = isEnabled(process.env.TIKPAL_GUARD_OTA_ENABLED ?? "0");
const MAX_ARCHIVE_BYTES = parsePositiveInteger(process.env.TIKPAL_GUARD_OTA_MAX_ARCHIVE_BYTES, MAX_ARCHIVE_BYTES_DEFAULT);
const PUBLIC_KEY_PATH = resolve(process.env.TIKPAL_GUARD_OTA_PUBLIC_KEY_PATH ?? join(SCRIPT_DIR, "guard-ota-public-key.pem"));
const STABLE_EXTENSION_KEY_PATH = join(BUNDLED_GUARD_ROOT, "guard-ota-extension-key.sha256");
const ALLOW_INSECURE_TEST_URL = isEnabled(process.env.TIKPAL_GUARD_OTA_ALLOW_INSECURE_TEST_URL ?? "0");

const RELEASES_DIR = join(OTA_ROOT, "releases");
const STAGING_DIR = join(OTA_ROOT, "staging");
const CURRENT_LINK = join(OTA_ROOT, "current");
const PREVIOUS_LINK = join(OTA_ROOT, "previous");
const STATE_PATH = join(OTA_ROOT, "state.json");
const LOCK_DIR = join(OTA_ROOT, "ota.lock");
const RELEASE_SCHEMA = 1;
const POINTER_SCHEMA = 1;
const ALLOWED_TOP_LEVEL = new Set(["web-mode-extension", "tikpal-web-mode-guard.mjs", "tikpal-web-mode-qq-confirm.mjs"]);

function isEnabled(value) {
  return ["1", "true", "yes", "on", "enabled"].includes(String(value ?? "").trim().toLowerCase());
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function errorWithCode(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function semverParts(value) {
  const match = String(value ?? "").trim().match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return { numeric: match.slice(1, 4).map(Number), prerelease: match[4] ?? null };
}

function compareVersion(left, right) {
  const a = semverParts(left);
  const b = semverParts(right);
  if (!a || !b) throw errorWithCode("INVALID_VERSION", `Invalid semantic version: ${!a ? left : right}`);
  for (let index = 0; index < 3; index += 1) {
    if (a.numeric[index] !== b.numeric[index]) return a.numeric[index] > b.numeric[index] ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

function safeRelativePath(value) {
  const raw = String(value ?? "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
  if (!raw || raw.includes("\0") || raw.endsWith("/")) return null;
  if (raw.startsWith("/") || raw.split("/").some(part => !part || part === "." || part === "..")) return null;
  if (!ALLOWED_TOP_LEVEL.has(raw.split("/")[0])) return null;
  return raw;
}

function resolveInside(root, relativePath) {
  const safe = safeRelativePath(relativePath);
  if (!safe) throw errorWithCode("UNSAFE_PATH", `Unsafe Guard bundle path: ${relativePath}`);
  const target = resolve(root, safe);
  const relation = relative(root, target);
  if (!relation || relation.startsWith("..") || isAbsolute(relation)) throw errorWithCode("UNSAFE_PATH", `Guard bundle path escapes its root: ${relativePath}`);
  return target;
}

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, filePath);
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function defaultState() {
  return {
    schema: 1,
    updaterVersion: UPDATER_VERSION,
    state: ENABLED ? "idle" : "disabled",
    installedVersion: null,
    previousVersion: null,
    candidateVersion: null,
    stagedVersion: null,
    pendingActivationVersion: null,
    lastCheckedAt: null,
    lastAppliedAt: null,
    lastRollbackAt: null,
    lastErrorCode: null,
    lastError: null,
    lastFailedVersion: null
  };
}

async function readState() {
  const state = await readJson(STATE_PATH, {});
  return { ...defaultState(), ...(state && typeof state === "object" ? state : {}) };
}

async function updateState(patch) {
  const next = { ...(await readState()), ...patch, updaterVersion: UPDATER_VERSION };
  await writeJsonAtomic(STATE_PATH, next);
  return next;
}

async function recursivelyListFiles(root, prefix = "") {
  const entries = await readdir(root, { withFileTypes: true });
  const results = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = join(root, entry.name);
    const details = await lstat(absolutePath);
    if (details.isSymbolicLink()) throw errorWithCode("SYMLINK", `Guard bundle cannot contain a symlink: ${relativePath}`);
    if (details.isDirectory()) {
      results.push(...await recursivelyListFiles(absolutePath, relativePath));
    } else if (details.isFile()) {
      results.push(relativePath.replace(/\\/g, "/"));
    } else {
      throw errorWithCode("INVALID_FILE", `Guard bundle contains an unsupported entry: ${relativePath}`);
    }
  }
  return results;
}

async function listBundleFiles(bundleRoot) {
  const extensionRoot = join(bundleRoot, "web-mode-extension");
  const manifestPath = join(extensionRoot, "manifest.json");
  if (!(await exists(manifestPath))) throw errorWithCode("MISSING_MANIFEST", "Guard bundle is missing web-mode-extension/manifest.json");
  const requiredScripts = ["tikpal-web-mode-guard.mjs", "tikpal-web-mode-qq-confirm.mjs"];
  for (const script of requiredScripts) {
    if (!(await exists(join(bundleRoot, script)))) throw errorWithCode("MISSING_FILE", `Guard bundle is missing ${script}`);
  }
  const files = (await recursivelyListFiles(extensionRoot, "web-mode-extension"))
    .concat(requiredScripts)
    .map(safeRelativePath);
  if (files.some(file => !file)) throw errorWithCode("UNSAFE_PATH", "Guard bundle contains an unsafe file path");
  return files.sort();
}

async function fileMetadata(bundleRoot, files = null) {
  const paths = files ?? await listBundleFiles(bundleRoot);
  const metadata = [];
  for (const file of paths) {
    const absolutePath = resolveInside(bundleRoot, file);
    const info = await stat(absolutePath);
    if (!info.isFile() || info.size < 0) throw errorWithCode("INVALID_FILE", `Guard bundle file is unavailable: ${file}`);
    metadata.push({ path: file, sha256: await sha256(absolutePath), bytes: info.size });
  }
  return metadata.sort((left, right) => left.path.localeCompare(right.path));
}

function normalizeReleaseFiles(value) {
  if (!Array.isArray(value) || value.length === 0) throw errorWithCode("INVALID_RELEASE", "Release manifest must list Guard bundle files");
  const seen = new Set();
  return value.map((entry) => {
    const filePath = safeRelativePath(entry?.path);
    const checksum = String(entry?.sha256 ?? "").toLowerCase();
    const bytes = Number(entry?.bytes);
    if (!filePath || !/^[a-f0-9]{64}$/.test(checksum) || !Number.isSafeInteger(bytes) || bytes < 0 || seen.has(filePath)) {
      throw errorWithCode("INVALID_RELEASE", "Release manifest has an invalid Guard bundle file entry");
    }
    seen.add(filePath);
    return { path: filePath, sha256: checksum, bytes };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function validateReleaseManifest(raw) {
  if (!raw || typeof raw !== "object" || raw.schema !== RELEASE_SCHEMA) throw errorWithCode("INVALID_RELEASE", "Unsupported Guard release manifest schema");
  const version = String(raw.version ?? "");
  if (!semverParts(version) || semverParts(version)?.prerelease) throw errorWithCode("INVALID_VERSION", "Guard stable release version must be a semantic release version");
  const minUpdaterVersion = String(raw.minUpdaterVersion ?? "");
  if (!semverParts(minUpdaterVersion)) throw errorWithCode("INVALID_RELEASE", "Guard release must declare minUpdaterVersion");
  if (compareVersion(UPDATER_VERSION, minUpdaterVersion) < 0) throw errorWithCode("UPDATER_TOO_OLD", `Guard release requires updater ${minUpdaterVersion}`);
  const archive = raw.archive;
  const archiveUrl = String(archive?.url ?? "");
  const archiveSha256 = String(archive?.sha256 ?? "").toLowerCase();
  const archiveBytes = Number(archive?.bytes);
  if (!archiveUrl || !/^[a-f0-9]{64}$/.test(archiveSha256) || !Number.isSafeInteger(archiveBytes) || archiveBytes <= 0 || archiveBytes > MAX_ARCHIVE_BYTES) {
    throw errorWithCode("INVALID_RELEASE", "Guard release archive metadata is invalid");
  }
  const extension = raw.extension;
  const extensionVersion = String(extension?.manifestVersion ?? "");
  const extensionKeySha256 = String(extension?.keySha256 ?? "").toLowerCase();
  if (!semverParts(extensionVersion) || extensionVersion !== version || !/^[a-f0-9]{64}$/.test(extensionKeySha256)) {
    throw errorWithCode("INVALID_RELEASE", "Guard release extension metadata is invalid");
  }
  return { schema: RELEASE_SCHEMA, version, minUpdaterVersion, archive: { url: archiveUrl, sha256: archiveSha256, bytes: archiveBytes }, extension: { manifestVersion: extensionVersion, keySha256: extensionKeySha256 }, files: normalizeReleaseFiles(raw.files) };
}

async function readExtensionManifest(bundleRoot) {
  const manifest = await readJson(join(bundleRoot, "web-mode-extension", "manifest.json"));
  if (!manifest || manifest.manifest_version !== 3 || !semverParts(manifest.version) || !String(manifest.key ?? "").trim()) {
    throw errorWithCode("INVALID_EXTENSION", "Guard extension manifest is invalid");
  }
  return manifest;
}

async function readStableExtensionKeySha256() {
  const fingerprint = String(await readFile(STABLE_EXTENSION_KEY_PATH, "utf8").catch(() => "")).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw errorWithCode("STABLE_EXTENSION_KEY_MISSING", "Guard OTA stable extension key fingerprint is missing or invalid");
  }
  const bundledManifest = await readExtensionManifest(BUNDLED_GUARD_ROOT);
  const bundledKeySha256 = createHash("sha256").update(String(bundledManifest.key)).digest("hex");
  if (bundledKeySha256 !== fingerprint) {
    throw errorWithCode("STABLE_EXTENSION_KEY_CHANGED", "App-bundled Guard extension key does not match its pinned fingerprint");
  }
  return fingerprint;
}

async function validateBundle(bundleRoot, release) {
  const manifest = await readExtensionManifest(bundleRoot);
  const files = await fileMetadata(bundleRoot);
  const expected = normalizeReleaseFiles(release.files);
  if (files.length !== expected.length || files.some((entry, index) => entry.path !== expected[index].path || entry.sha256 !== expected[index].sha256 || entry.bytes !== expected[index].bytes)) {
    throw errorWithCode("BUNDLE_HASH_MISMATCH", "Guard bundle files do not match the signed release manifest");
  }
  const keySha256 = createHash("sha256").update(String(manifest.key)).digest("hex");
  const stableKeySha256 = await readStableExtensionKeySha256();
  if (manifest.version !== release.version || keySha256 !== release.extension.keySha256 || keySha256 !== stableKeySha256) {
    throw errorWithCode("EXTENSION_ID_CHANGED", "Guard release changed the stable Chromium extension identity");
  }
  return { manifest, files };
}

async function releaseFromBundle(bundleRoot, version, source = "bundled") {
  const manifest = await readExtensionManifest(bundleRoot);
  if (manifest.version !== version) throw errorWithCode("INVALID_VERSION", "Guard bundle version does not match its extension manifest");
  const keySha256 = createHash("sha256").update(String(manifest.key)).digest("hex");
  if (keySha256 !== await readStableExtensionKeySha256()) {
    throw errorWithCode("EXTENSION_ID_CHANGED", "Guard bundle changed the stable Chromium extension identity");
  }
  const files = await fileMetadata(bundleRoot);
  return {
    schema: RELEASE_SCHEMA,
    version,
    minUpdaterVersion: UPDATER_VERSION,
    source,
    archive: { url: "bundled", sha256: "0".repeat(64), bytes: 1 },
    extension: { manifestVersion: manifest.version, keySha256 },
    files
  };
}

async function copyBundle(sourceRoot, targetRoot) {
  await mkdir(targetRoot, { recursive: true, mode: 0o700 });
  await cp(join(sourceRoot, "web-mode-extension"), join(targetRoot, "web-mode-extension"), { recursive: true, force: true, verbatimSymlinks: true });
  for (const script of ["tikpal-web-mode-guard.mjs", "tikpal-web-mode-qq-confirm.mjs"]) {
    await cp(join(sourceRoot, script), join(targetRoot, script), { force: true, verbatimSymlinks: true });
  }
}

async function createReleaseFromBundle(sourceRoot, version, source = "bundled") {
  const finalDirectory = join(RELEASES_DIR, version);
  if (await exists(finalDirectory)) return finalDirectory;
  const temporaryDirectory = join(STAGING_DIR, `bootstrap-${version}-${process.pid}-${Date.now()}`);
  await rm(temporaryDirectory, { recursive: true, force: true });
  await copyBundle(sourceRoot, temporaryDirectory);
  const release = await releaseFromBundle(temporaryDirectory, version, source);
  await writeJsonAtomic(join(temporaryDirectory, "release.json"), release);
  await validateBundle(temporaryDirectory, release);
  await mkdir(RELEASES_DIR, { recursive: true, mode: 0o700 });
  await rename(temporaryDirectory, finalDirectory);
  return finalDirectory;
}

async function readReleaseAt(directory) {
  const release = validateReleaseManifest(await readJson(join(directory, "release.json")));
  await validateBundle(directory, release);
  return release;
}

async function readCurrentDirectory(linkPath = CURRENT_LINK) {
  try {
    const target = await readlink(linkPath);
    const resolved = resolve(dirname(linkPath), target);
    const relation = relative(RELEASES_DIR, resolved);
    if (!relation || relation.startsWith("..") || isAbsolute(relation)) return null;
    return resolved;
  } catch {
    return null;
  }
}

async function replaceLink(linkPath, releaseDirectory) {
  const temporaryLink = `${linkPath}.tmp-${process.pid}-${Date.now()}`;
  const target = relative(dirname(linkPath), releaseDirectory);
  await rm(temporaryLink, { force: true });
  await symlink(target, temporaryLink);
  await rename(temporaryLink, linkPath);
}

async function currentRelease() {
  const directory = await readCurrentDirectory();
  if (!directory) return null;
  try {
    return { directory, release: await readReleaseAt(directory) };
  } catch {
    return null;
  }
}

async function bootstrap() {
  await mkdir(STAGING_DIR, { recursive: true, mode: 0o700 });
  await mkdir(RELEASES_DIR, { recursive: true, mode: 0o700 });
  const bundledManifest = await readExtensionManifest(BUNDLED_GUARD_ROOT);
  const bundledVersion = bundledManifest.version;
  const current = await currentRelease();
  if (!current || compareVersion(bundledVersion, current.release.version) > 0) {
    const directory = await createReleaseFromBundle(BUNDLED_GUARD_ROOT, bundledVersion);
    const oldDirectory = current?.directory ?? null;
    if (oldDirectory && oldDirectory !== directory) await replaceLink(PREVIOUS_LINK, oldDirectory);
    await replaceLink(CURRENT_LINK, directory);
  }
  const selected = await currentRelease();
  const state = await updateState({
    installedVersion: selected?.release.version ?? null,
    previousVersion: (await previousRelease())?.release.version ?? null,
    state: ENABLED ? "idle" : "disabled"
  });
  return { state, current: selected?.release.version ?? null };
}

async function previousRelease() {
  const directory = await readCurrentDirectory(PREVIOUS_LINK);
  if (!directory) return null;
  try {
    return { directory, release: await readReleaseAt(directory) };
  } catch {
    return null;
  }
}

async function acquireLock() {
  try {
    await mkdir(LOCK_DIR, { mode: 0o700 });
    await writeFile(join(LOCK_DIR, "owner.json"), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { mode: 0o600 });
    return true;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    try {
      const info = await stat(LOCK_DIR);
      if (Date.now() - info.mtimeMs > 15 * 60 * 1000) {
        await rm(LOCK_DIR, { recursive: true, force: true });
        return await acquireLock();
      }
    } catch {
      return await acquireLock();
    }
    return false;
  }
}

async function releaseLock() {
  await rm(LOCK_DIR, { recursive: true, force: true });
}

async function readPublicKey() {
  const inline = String(process.env.TIKPAL_GUARD_OTA_PUBLIC_KEY ?? "").trim();
  const pem = inline || await readFile(PUBLIC_KEY_PATH, "utf8").catch(() => "");
  if (!pem.trim()) throw errorWithCode("PUBLIC_KEY_MISSING", "Guard OTA public key is not configured");
  try {
    return createPublicKey(pem);
  } catch {
    throw errorWithCode("PUBLIC_KEY_INVALID", "Guard OTA public key is invalid");
  }
}

function signatureUrl(url) {
  return `${url}.sig`;
}

function verifyDetached(publicKey, body, signatureText, label) {
  let signature;
  try {
    signature = Buffer.from(String(signatureText).trim(), "base64");
  } catch {
    throw errorWithCode("SIGNATURE_INVALID", `${label} signature is invalid`);
  }
  if (!signature.length || !verify(null, body, publicKey, signature)) throw errorWithCode("SIGNATURE_INVALID", `${label} signature verification failed`);
}

async function fetchBuffer(url, maxBytes = MAX_ARCHIVE_BYTES) {
  const response = await fetch(url, { headers: { "Cache-Control": "no-store", Accept: "application/json, application/octet-stream" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw errorWithCode("DOWNLOAD_FAILED", `Guard OTA download failed (${response.status})`);
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw errorWithCode("ARCHIVE_TOO_LARGE", "Guard OTA archive exceeds its configured size limit");
  const reader = response.body?.getReader();
  if (!reader) return Buffer.from(await response.arrayBuffer());
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) throw errorWithCode("ARCHIVE_TOO_LARGE", "Guard OTA archive exceeds its configured size limit");
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, bytes);
}

function validateRemoteUrl(value, kind) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw errorWithCode("INVALID_URL", `${kind} URL is invalid`);
  }
  const channel = new URL(CHANNEL_URL);
  const secure = url.protocol === "https:" || (ALLOW_INSECURE_TEST_URL && url.protocol === "http:");
  if (!secure || url.origin !== channel.origin || !url.pathname.startsWith("/guard/v1/releases/")) {
    throw errorWithCode("UNTRUSTED_URL", `${kind} URL is outside the configured Guard release origin`);
  }
  return url.toString();
}

function validatePointer(pointer) {
  if (!CHANNEL_NAME) throw errorWithCode("INVALID_CHANNEL", "Guard OTA channel name is invalid");
  if (!pointer || typeof pointer !== "object" || pointer.schema !== POINTER_SCHEMA || pointer.channel !== CHANNEL_NAME) {
    throw errorWithCode("INVALID_POINTER", "Guard OTA channel pointer is invalid");
  }
  const version = String(pointer.version ?? "");
  if (!semverParts(version) || semverParts(version)?.prerelease) throw errorWithCode("INVALID_VERSION", "Guard OTA channel version is invalid");
  const releaseUrl = validateRemoteUrl(String(pointer.releaseUrl ?? ""), "Release manifest");
  return { version, releaseUrl };
}

async function run(command, args) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-2048); });
    child.once("error", rejectPromise);
    child.once("close", code => code === 0 ? resolvePromise() : rejectPromise(errorWithCode("ARCHIVE_EXTRACT_FAILED", stderr.trim() || `${command} exited ${code}`)));
  });
}

function allowedArchiveDirectories(files) {
  const result = new Set();
  for (const file of files) {
    const parts = file.path.split("/");
    for (let index = 1; index < parts.length; index += 1) result.add(parts.slice(0, index).join("/"));
  }
  return result;
}

async function archiveEntries(archivePath) {
  const output = await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("tar", ["-tzf", archivePath], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.once("error", () => rejectPromise(errorWithCode("TAR_UNAVAILABLE", "tar is required for Guard OTA extraction")));
    child.once("close", code => code === 0 ? resolvePromise(stdout.split(/\r?\n/).filter(Boolean)) : rejectPromise(errorWithCode("ARCHIVE_INVALID", stderr.trim() || "Cannot inspect Guard OTA archive")));
  });
  return output.map(entry => entry.replace(/^\.\//, "").replace(/\/$/, ""));
}

async function extractAndValidateArchive(archivePath, destination, release) {
  const expectedFiles = new Map(release.files.map(file => [file.path, file]));
  const allowedDirectories = allowedArchiveDirectories(release.files);
  for (const entry of await archiveEntries(archivePath)) {
    if (!entry || entry.includes("\0") || entry.startsWith("/") || entry.split("/").some(part => part === "." || part === "..")) {
      throw errorWithCode("UNSAFE_ARCHIVE", "Guard OTA archive contains an unsafe path");
    }
    if (!expectedFiles.has(entry) && !allowedDirectories.has(entry)) {
      throw errorWithCode("UNEXPECTED_ARCHIVE_FILE", `Guard OTA archive contains an unexpected entry: ${entry}`);
    }
  }
  await mkdir(destination, { recursive: true, mode: 0o700 });
  await run("tar", ["-xzf", archivePath, "-C", destination]);
  await validateBundle(destination, release);
}

async function cleanupReleases() {
  const current = await readCurrentDirectory();
  const previous = await readCurrentDirectory(PREVIOUS_LINK);
  const keep = new Set([current, previous].filter(Boolean));
  for (const entry of await readdir(RELEASES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(RELEASES_DIR, entry.name);
    if (!keep.has(directory)) await rm(directory, { recursive: true, force: true });
  }
}

async function stageRelease(release, archive) {
  const finalDirectory = join(RELEASES_DIR, release.version);
  if (await exists(finalDirectory)) {
    await validateBundle(finalDirectory, release);
    return finalDirectory;
  }
  const temporaryDirectory = join(STAGING_DIR, `${release.version}-${process.pid}-${Date.now()}`);
  await rm(temporaryDirectory, { recursive: true, force: true });
  await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });
  const archivePath = join(temporaryDirectory, "bundle.tar.gz");
  await writeFile(archivePath, archive, { mode: 0o600 });
  await extractAndValidateArchive(archivePath, temporaryDirectory, release);
  await rm(archivePath, { force: true });
  await writeJsonAtomic(join(temporaryDirectory, "release.json"), release);
  await validateBundle(temporaryDirectory, release);
  await mkdir(RELEASES_DIR, { recursive: true, mode: 0o700 });
  await rename(temporaryDirectory, finalDirectory);
  return finalDirectory;
}

async function checkForUpdate() {
  const bootstrapped = await bootstrap();
  if (!ENABLED) return { ...bootstrapped.state, result: "disabled" };
  const publicKey = await readPublicKey();
  await updateState({ state: "checking", lastErrorCode: null, lastError: null });
  const [pointerBody, pointerSignature] = await Promise.all([fetchBuffer(CHANNEL_URL, 256 * 1024), fetchBuffer(signatureUrl(CHANNEL_URL), 32 * 1024)]);
  verifyDetached(publicKey, pointerBody, pointerSignature.toString("utf8"), "Guard OTA channel pointer");
  const pointer = validatePointer(JSON.parse(pointerBody.toString("utf8")));
  const current = await currentRelease();
  if (current && compareVersion(pointer.version, current.release.version) <= 0) {
    return await updateState({ state: "idle", installedVersion: current.release.version, candidateVersion: pointer.version, stagedVersion: null, lastCheckedAt: new Date().toISOString(), lastErrorCode: null, lastError: null });
  }
  const [releaseBody, releaseSignature] = await Promise.all([fetchBuffer(pointer.releaseUrl, 512 * 1024), fetchBuffer(signatureUrl(pointer.releaseUrl), 32 * 1024)]);
  verifyDetached(publicKey, releaseBody, releaseSignature.toString("utf8"), "Guard OTA release manifest");
  const release = validateReleaseManifest(JSON.parse(releaseBody.toString("utf8")));
  if (release.version !== pointer.version) throw errorWithCode("VERSION_MISMATCH", "Guard OTA pointer and release manifest versions do not match");
  const archiveUrl = validateRemoteUrl(release.archive.url, "Guard archive");
  await updateState({ state: "downloading", candidateVersion: release.version });
  const archive = await fetchBuffer(archiveUrl, MAX_ARCHIVE_BYTES);
  if (archive.byteLength !== release.archive.bytes || createHash("sha256").update(archive).digest("hex") !== release.archive.sha256) {
    throw errorWithCode("ARCHIVE_HASH_MISMATCH", "Guard OTA archive does not match its signed checksum");
  }
  await stageRelease(release, archive);
  return await updateState({ state: "pending_idle", installedVersion: current?.release.version ?? null, candidateVersion: release.version, stagedVersion: release.version, lastCheckedAt: new Date().toISOString(), lastErrorCode: null, lastError: null });
}

async function activateStagedRelease() {
  await bootstrap();
  const state = await readState();
  if (!ENABLED || !state.stagedVersion) return { ...state, result: "nothing_to_apply" };
  const stagedDirectory = join(RELEASES_DIR, state.stagedVersion);
  const release = await readReleaseAt(stagedDirectory);
  const current = await currentRelease();
  if (current?.release.version === release.version) return await updateState({ state: "idle", stagedVersion: null, installedVersion: release.version, pendingActivationVersion: null });
  if (current?.directory) await replaceLink(PREVIOUS_LINK, current.directory);
  await replaceLink(CURRENT_LINK, stagedDirectory);
  await cleanupReleases();
  return await updateState({ state: "pending_activation", installedVersion: release.version, previousVersion: current?.release.version ?? null, stagedVersion: null, pendingActivationVersion: release.version, lastAppliedAt: new Date().toISOString(), lastErrorCode: null, lastError: null });
}

async function confirmActivation() {
  const current = await currentRelease();
  const state = await readState();
  if (!current || !state.pendingActivationVersion || current.release.version !== state.pendingActivationVersion) return state;
  return await updateState({ state: "idle", installedVersion: current.release.version, previousVersion: (await previousRelease())?.release.version ?? null, pendingActivationVersion: null, lastErrorCode: null, lastError: null });
}

async function rollback(reason = "guard_activation_failed") {
  const current = await currentRelease();
  const previous = await previousRelease();
  if (!current || !previous || current.directory === previous.directory) throw errorWithCode("ROLLBACK_UNAVAILABLE", "No previous Guard release is available for rollback");
  await replaceLink(CURRENT_LINK, previous.directory);
  await replaceLink(PREVIOUS_LINK, current.directory);
  return await updateState({ state: "rolled_back", installedVersion: previous.release.version, previousVersion: current.release.version, pendingActivationVersion: null, lastRollbackAt: new Date().toISOString(), lastFailedVersion: current.release.version, lastErrorCode: "GUARD_ACTIVATION_FAILED", lastError: String(reason).slice(0, 240) });
}

async function status() {
  const [state, current, previous] = await Promise.all([readState(), currentRelease(), previousRelease()]);
  return {
    ...state,
    enabled: ENABLED,
    channel: CHANNEL_NAME ?? "invalid",
    channelUrl: CHANNEL_URL,
    installedVersion: current?.release.version ?? state.installedVersion ?? null,
    previousVersion: previous?.release.version ?? state.previousVersion ?? null,
    nextCheckAt: state.lastCheckedAt ? new Date(new Date(state.lastCheckedAt).getTime() + 60 * 60 * 1000).toISOString() : null
  };
}

async function execute(action, args) {
  if (action === "bootstrap") return await bootstrap();
  if (action === "status") return await status();
  if (action === "activate") return await activateStagedRelease();
  if (action === "confirm-activation") return await confirmActivation();
  if (action === "rollback") return await rollback(args[0] ?? "guard_activation_failed");
  if (action === "check") {
    if (!await acquireLock()) return { ...(await status()), result: "busy" };
    try {
      return await checkForUpdate();
    } catch (error) {
      const code = String(error?.code ?? "CHECK_FAILED");
      const message = error instanceof Error ? error.message : String(error);
      return await updateState({ state: "failed", lastCheckedAt: new Date().toISOString(), lastErrorCode: code, lastError: message.slice(0, 240) });
    } finally {
      await releaseLock();
    }
  }
  throw errorWithCode("USAGE", "Usage: tikpal-guard-ota.mjs <bootstrap|check|activate|confirm-activation|rollback|status>");
}

const [action = "status", ...args] = process.argv.slice(2);
execute(action, args)
  .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[tikpal-guard-ota] ${message}\n`);
    process.exit(1);
  });

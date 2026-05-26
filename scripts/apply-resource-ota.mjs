import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PUBLIC_ASSETS_DIR = path.join(ROOT, "public", "assets");
const DEFAULT_DIST_ASSETS_DIR = path.join(ROOT, "dist", "assets");
const DEFAULT_STATE_DIR = path.join(ROOT, ".tikpal");
const DEFAULT_MUSIC_ROOT = "assets/music";
const DEFAULT_MUSIC_MANIFEST = "assets/music/_metadata/library_manifest.json";
const DEFAULT_FIREPLACE_VIDEO = "assets/output_2560x720-4k.mp4";
const DEFAULT_FIREPLACE_VIDEO_TARGET = "output_2560x720-4k.mp4";
const DEFAULT_SCENE_ROOT = "assets/scenes";
const DEFAULT_SCENE_MANIFEST = "assets/scenes/_metadata/scene_videos.json";
const SCENE_MANIFEST_TARGET = "scenes/_metadata/scene_videos.json";
const AUDIO_EXTENSIONS = new Set([".aac", ".flac", ".m4a", ".mp3", ".ogg", ".wav"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const SCENE_VIDEO_EXTENSIONS = new Set([".mp4"]);
const COVER_COLUMNS = ["cover_relative_path", "cover_path", "album_art_relative_path", "artwork_relative_path"];
const SCENE_ROOM_MODES = new Set(["focus", "calm", "sleep"]);

function usage() {
  return [
    "Usage: node scripts/apply-resource-ota.mjs <package-dir> [--dry-run]",
    "",
    "Package defaults:",
    "  manifest.json",
    "  assets/music/_metadata/library_manifest.json",
    "  assets/music/**",
    "  assets/scenes/_metadata/scene_videos.json",
    "  assets/scenes/**.mp4",
    "  assets/output_2560x720-4k.mp4"
  ].join("\n");
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    packageDir: null,
    dryRun: false
  };

  for (const arg of args) {
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (!options.packageDir) {
      options.packageDir = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!options.packageDir) {
    throw new Error(usage());
  }

  return {
    ...options,
    packageDir: path.resolve(options.packageDir)
  };
}

function normalizeSceneRoomModes(value) {
  if (!Array.isArray(value)) return [];
  const modes = [];
  for (const entry of value) {
    const mode = String(entry ?? "").trim().toLowerCase();
    if (!SCENE_ROOM_MODES.has(mode) || modes.includes(mode)) continue;
    modes.push(mode);
  }
  return modes;
}

function isSafeRelativePath(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return false;
  if (path.isAbsolute(normalized)) return false;
  return !normalized.split(/[\\/]+/).some((part) => part === "..");
}

function resolveInside(root, relativePath) {
  if (!isSafeRelativePath(relativePath)) {
    throw new Error(`Unsafe package path: ${relativePath}`);
  }
  const resolved = path.resolve(root, relativePath);
  const relation = path.relative(root, resolved);
  if (relation.startsWith("..") || path.isAbsolute(relation)) {
    throw new Error(`Package path escapes root: ${relativePath}`);
  }
  return resolved;
}

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function parseJsonRows(text, label) {
  const rows = JSON.parse(text.replace(/^\uFEFF/, ""));
  if (!Array.isArray(rows)) {
    throw new Error(`${label} must be a JSON array`);
  }
  return rows.filter((row) => row && typeof row === "object" && !Array.isArray(row));
}

async function readPackageManifest(packageDir) {
  const manifestPath = path.join(packageDir, "manifest.json");
  if (!(await exists(manifestPath))) {
    return {};
  }

  const raw = await readFile(manifestPath, "utf8");
  return JSON.parse(raw);
}

async function readSha256(filePath) {
  const buffer = await readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

async function validateMp4(filePath, label = "MP4 file") {
  const info = await stat(filePath);
  if (!info.isFile() || info.size <= 0) {
    throw new Error(`${label} is empty or not a file: ${filePath}`);
  }
  const header = (await readFile(filePath)).subarray(0, 128).toString("latin1");
  if (!header.includes("ftyp")) {
    throw new Error(`${label} does not look like an MP4 file: ${filePath}`);
  }
  return {
    bytes: info.size,
    sha256: await readSha256(filePath)
  };
}

function normalizeSceneVideoId(value, index) {
  const id = String(value ?? "").trim();
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
    throw new Error(`Scene video #${index + 1} has an invalid id: ${id || "(empty)"}`);
  }
  return id;
}

function normalizeSceneVideoOrder(value) {
  if (value === undefined || value === null || value === "") return null;
  const order = Number(value);
  if (!Number.isFinite(order)) {
    throw new Error(`Scene video order must be a finite number: ${value}`);
  }
  return order;
}

async function validateSceneVideosManifest({ manifestPath, packageSceneRoot }) {
  const raw = await readFile(manifestPath, "utf8");
  const parsed = JSON.parse(raw);
  const mode = String(parsed.mode ?? "add").trim().toLowerCase();
  if (mode !== "add") {
    throw new Error(`Scene video OTA only supports mode=add for now: ${mode}`);
  }
  if (!Array.isArray(parsed.videos) || parsed.videos.length === 0) {
    throw new Error("Scene video manifest must include at least one video");
  }

  const ids = new Set();
  const filenames = new Set();
  const videos = [];
  let defaultCount = 0;

  for (const [index, video] of parsed.videos.entries()) {
    const id = normalizeSceneVideoId(video.id, index);
    const filename = String(video.filename ?? "").trim();
    if (!isSafeRelativePath(filename)) {
      throw new Error(`Scene video ${id} has an unsafe filename: ${filename}`);
    }
    if (!SCENE_VIDEO_EXTENSIONS.has(path.extname(filename).toLowerCase())) {
      throw new Error(`Scene video ${id} must be an MP4 file: ${filename}`);
    }
    if (ids.has(id)) {
      throw new Error(`Scene video manifest contains duplicate id: ${id}`);
    }
    if (filenames.has(filename)) {
      throw new Error(`Scene video manifest contains duplicate filename: ${filename}`);
    }

    const expectedSha256 = String(video.sha256 ?? "").trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
      throw new Error(`Scene video ${id} must include a sha256 checksum`);
    }

    const sourcePath = path.join(packageSceneRoot, filename);
    const mp4 = await validateMp4(sourcePath, `Scene video ${id}`);
    if (mp4.sha256 !== expectedSha256) {
      throw new Error(`Scene video ${id} sha256 mismatch: expected ${expectedSha256}, got ${mp4.sha256}`);
    }

    const isDefault = video.default === true;
    if (isDefault) defaultCount += 1;
    ids.add(id);
    filenames.add(filename);
    const roomModes = normalizeSceneRoomModes(video.roomModes);
    videos.push({
      id,
      filename,
      label: String(video.label ?? "").trim() || path.basename(filename, path.extname(filename)),
      order: normalizeSceneVideoOrder(video.order),
      default: isDefault,
      roomModes,
      sha256: mp4.sha256,
      bytes: mp4.bytes,
      sourcePath
    });
  }

  if (defaultCount > 1) {
    throw new Error("Scene video manifest can mark at most one video as default");
  }

  return {
    mode,
    bytes: Buffer.byteLength(raw),
    sha256: createHash("sha256").update(raw).digest("hex"),
    videoCount: videos.length,
    videos
  };
}

async function validateMusicManifest({ manifestPath, packageMusicRoot, publicMusicRoot }) {
  const raw = await readFile(manifestPath, "utf8");
  const rows = parseJsonRows(raw, "Music manifest");
  const requiredHeaders = ["id", "title", "category_level_1", "final_relative_path"];
  const discoveredHeaders = new Set(rows.flatMap((row) => Object.keys(row)));
  const missingHeaders = requiredHeaders.filter((header) => !discoveredHeaders.has(header));
  if (missingHeaders.length > 0) {
    throw new Error(`Music manifest is missing required columns: ${missingHeaders.join(", ")}`);
  }

  const missingFiles = [];
  const missingCovers = [];
  const trackRows = [];
  for (const row of rows) {
    const relativePath = row.final_relative_path?.trim();
    if (!relativePath) continue;
    if (!isSafeRelativePath(relativePath)) {
      throw new Error(`Music manifest contains unsafe path: ${relativePath}`);
    }
    if (!AUDIO_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) {
      throw new Error(`Music manifest path has unsupported audio extension: ${relativePath}`);
    }

    const packagePath = path.join(packageMusicRoot, relativePath);
    const installedPath = path.join(publicMusicRoot, relativePath);
    if (!(await exists(packagePath)) && !(await exists(installedPath))) {
      missingFiles.push(relativePath);
    }

    for (const column of COVER_COLUMNS) {
      const coverPath = row[column]?.trim();
      if (!coverPath) continue;
      if (!isSafeRelativePath(coverPath)) {
        throw new Error(`Music manifest contains unsafe cover path: ${coverPath}`);
      }
      if (!IMAGE_EXTENSIONS.has(path.extname(coverPath).toLowerCase())) {
        throw new Error(`Music manifest cover path has unsupported image extension: ${coverPath}`);
      }

      const packageCoverPath = path.join(packageMusicRoot, coverPath);
      const installedCoverPath = path.join(publicMusicRoot, coverPath);
      if (!(await exists(packageCoverPath)) && !(await exists(installedCoverPath))) {
        missingCovers.push(coverPath);
      }
    }

    trackRows.push(row);
  }

  if (missingFiles.length > 0) {
    throw new Error(`Music manifest references missing files: ${missingFiles.slice(0, 5).join(", ")}${missingFiles.length > 5 ? " ..." : ""}`);
  }
  if (missingCovers.length > 0) {
    throw new Error(`Music manifest references missing cover files: ${missingCovers.slice(0, 5).join(", ")}${missingCovers.length > 5 ? " ..." : ""}`);
  }

  return {
    bytes: Buffer.byteLength(raw),
    sha256: createHash("sha256").update(raw).digest("hex"),
    trackCount: trackRows.length
  };
}

async function backupFile(sourcePath, backupRoot, relativePath) {
  if (!(await exists(sourcePath))) return false;
  const targetPath = path.join(backupRoot, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath, { force: true });
  return true;
}

function toSceneManifestVideo(video) {
  return {
    id: video.id,
    filename: video.filename,
    label: video.label,
    ...(video.order !== null ? { order: video.order } : {}),
    ...(video.default ? { default: true } : {}),
    ...(video.roomModes?.length ? { roomModes: video.roomModes } : {}),
    sha256: video.sha256
  };
}

async function readInstalledSceneManifest(manifestPath) {
  if (!(await exists(manifestPath))) {
    return { videos: [] };
  }
  const raw = await readFile(manifestPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.videos)) {
    throw new Error(`Installed scene manifest has no videos array: ${manifestPath}`);
  }
  return parsed;
}

function mergeSceneManifests(installedManifest, scenePackage) {
  const merged = new Map();
  for (const video of installedManifest.videos ?? []) {
    const id = String(video.id ?? "").trim();
    const filename = String(video.filename ?? "").trim();
    if (!id || !filename) continue;
    merged.set(id, {
      id,
      filename,
      label: String(video.label ?? "").trim() || path.basename(filename, path.extname(filename)),
      ...(Number.isFinite(Number(video.order)) ? { order: Number(video.order) } : {}),
      ...(video.default === true ? { default: true } : {}),
      ...(normalizeSceneRoomModes(video.roomModes).length ? { roomModes: normalizeSceneRoomModes(video.roomModes) } : {}),
      ...(typeof video.sha256 === "string" && video.sha256 ? { sha256: video.sha256 } : {})
    });
  }

  const incomingDefault = scenePackage.videos.find((video) => video.default);
  if (incomingDefault) {
    for (const [id, video] of merged) {
      merged.set(id, {
        ...video,
        ...(id === incomingDefault.id ? { default: true } : { default: undefined })
      });
    }
  }

  for (const video of scenePackage.videos) {
    merged.set(video.id, toSceneManifestVideo(video));
  }

  return {
    mode: "add",
    videos: [...merged.values()]
      .map((video) => Object.fromEntries(Object.entries(video).filter(([, value]) => value !== undefined)))
      .sort((first, second) => {
        const firstOrder = Number.isFinite(first.order) ? first.order : null;
        const secondOrder = Number.isFinite(second.order) ? second.order : null;
        if (firstOrder !== null || secondOrder !== null) {
          if (firstOrder === null) return 1;
          if (secondOrder === null) return -1;
          if (firstOrder !== secondOrder) return firstOrder - secondOrder;
        }
        return first.filename.localeCompare(second.filename);
      })
  };
}

async function syncSceneVideos({ scenePackage, publicAssetsDir, distAssetsDir, distAssetsAvailable, backupRoot, backups }) {
  if (!scenePackage) return false;

  const publicSceneRoot = path.join(publicAssetsDir, "scenes");
  const distSceneRoot = path.join(distAssetsDir, "scenes");
  const publicSceneManifestPath = path.join(publicAssetsDir, SCENE_MANIFEST_TARGET);
  const installedManifest = await readInstalledSceneManifest(publicSceneManifestPath);
  const mergedManifest = mergeSceneManifests(installedManifest, scenePackage);

  await backupFile(publicSceneManifestPath, backupRoot, `public/assets/${SCENE_MANIFEST_TARGET}`)
    .then((saved) => { if (saved) backups.push(`public/assets/${SCENE_MANIFEST_TARGET}`); });

  await mkdir(path.dirname(publicSceneManifestPath), { recursive: true });
  for (const video of scenePackage.videos) {
    const publicTarget = path.join(publicSceneRoot, video.filename);
    await backupFile(publicTarget, backupRoot, `public/assets/scenes/${video.filename}`)
      .then((saved) => { if (saved) backups.push(`public/assets/scenes/${video.filename}`); });
    await mkdir(path.dirname(publicTarget), { recursive: true });
    await cp(video.sourcePath, publicTarget, { force: true });
  }
  await writeFile(publicSceneManifestPath, `${JSON.stringify(mergedManifest, null, 2)}\n`);

  if (distAssetsAvailable) {
    const distSceneManifestPath = path.join(distAssetsDir, SCENE_MANIFEST_TARGET);
    await mkdir(path.dirname(distSceneManifestPath), { recursive: true });
    for (const video of scenePackage.videos) {
      const distTarget = path.join(distSceneRoot, video.filename);
      await mkdir(path.dirname(distTarget), { recursive: true });
      await cp(video.sourcePath, distTarget, { force: true });
    }
    await writeFile(distSceneManifestPath, `${JSON.stringify(mergedManifest, null, 2)}\n`);
  }

  return true;
}

async function syncToAssets({ packagePath, packageMusicRoot, scenePackage, publicAssetsDir, distAssetsDir, fireplaceVideoTarget, dryRun }) {
  const publicMusicRoot = path.join(publicAssetsDir, "music");
  const distMusicRoot = path.join(distAssetsDir, "music");
  const backups = [];
  const backupId = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.join(process.env.TIKPAL_RESOURCE_OTA_STATE_DIR ?? DEFAULT_STATE_DIR, "resource-ota-backups", backupId);
  const packageHasMusicRoot = await exists(packageMusicRoot);
  const distAssetsAvailable = await exists(distAssetsDir);
  const packageVideoPath = packagePath.fireplaceVideoPath;
  const publicVideoPath = path.join(publicAssetsDir, fireplaceVideoTarget);
  const distVideoPath = path.join(distAssetsDir, fireplaceVideoTarget);

  if (dryRun) {
    return {
      backupId: null,
      publicSynced: false,
      distSynced: false,
      sceneSynced: false,
      backups
    };
  }

  await mkdir(publicAssetsDir, { recursive: true });

  if (packageHasMusicRoot) {
    await backupFile(path.join(publicMusicRoot, "_metadata", "library_manifest.json"), backupRoot, "public/assets/music/_metadata/library_manifest.json")
      .then((saved) => { if (saved) backups.push("public/assets/music/_metadata/library_manifest.json"); });
    await cp(packageMusicRoot, publicMusicRoot, { recursive: true, force: true });

    if (distAssetsAvailable) {
      await mkdir(distAssetsDir, { recursive: true });
      await cp(packageMusicRoot, distMusicRoot, { recursive: true, force: true });
    }
  }

  if (packageVideoPath) {
    await backupFile(publicVideoPath, backupRoot, `public/assets/${fireplaceVideoTarget}`)
      .then((saved) => { if (saved) backups.push(`public/assets/${fireplaceVideoTarget}`); });
    await cp(packageVideoPath, publicVideoPath, { force: true });

    if (distAssetsAvailable) {
      await cp(packageVideoPath, distVideoPath, { force: true });
    }
  }

  const sceneSynced = await syncSceneVideos({
    scenePackage,
    publicAssetsDir,
    distAssetsDir,
    distAssetsAvailable,
    backupRoot,
    backups
  });

  return {
    backupId,
    publicSynced: true,
    distSynced: distAssetsAvailable,
    sceneSynced,
    backups
  };
}

async function run() {
  const options = parseArgs(process.argv);
  const packageManifest = await readPackageManifest(options.packageDir);
  const assetsSpec = packageManifest.assets ?? {};
  const publicAssetsDir = path.resolve(process.env.TIKPAL_RESOURCE_OTA_PUBLIC_ASSETS_DIR ?? DEFAULT_PUBLIC_ASSETS_DIR);
  const distAssetsDir = path.resolve(process.env.TIKPAL_RESOURCE_OTA_DIST_ASSETS_DIR ?? DEFAULT_DIST_ASSETS_DIR);
  const stateDir = path.resolve(process.env.TIKPAL_RESOURCE_OTA_STATE_DIR ?? DEFAULT_STATE_DIR);
  const musicRootRelative = assetsSpec.musicRoot ?? DEFAULT_MUSIC_ROOT;
  const musicManifestRelative = assetsSpec.musicManifest ?? DEFAULT_MUSIC_MANIFEST;
  const fireplaceVideoRelative = assetsSpec.fireplaceVideo ?? DEFAULT_FIREPLACE_VIDEO;
  const fireplaceVideoTarget = assetsSpec.fireplaceVideoTarget ?? DEFAULT_FIREPLACE_VIDEO_TARGET;
  const sceneRootRelative = assetsSpec.sceneRoot ?? DEFAULT_SCENE_ROOT;
  const sceneManifestRelative = assetsSpec.sceneManifest ?? DEFAULT_SCENE_MANIFEST;
  const packageMusicRoot = resolveInside(options.packageDir, musicRootRelative);
  const packageManifestPath = resolveInside(options.packageDir, musicManifestRelative);
  const packageSceneRoot = resolveInside(options.packageDir, sceneRootRelative);
  const packageSceneManifestPath = resolveInside(options.packageDir, sceneManifestRelative);
  const packageVideoPath = (await exists(resolveInside(options.packageDir, fireplaceVideoRelative)))
    ? resolveInside(options.packageDir, fireplaceVideoRelative)
    : null;
  const publicMusicRoot = path.join(publicAssetsDir, "music");
  const summary = {
    ok: true,
    dryRun: options.dryRun,
    version: packageManifest.version ?? null,
    packageDir: options.packageDir,
    appliedAt: new Date().toISOString(),
    music: null,
    fireplaceVideo: null,
    scenes: null,
    sync: null
  };

  const hasMusicManifest = await exists(packageManifestPath);
  const hasSceneManifest = await exists(packageSceneManifestPath);
  if (!hasMusicManifest && !packageVideoPath && !hasSceneManifest) {
    throw new Error("Resource OTA package must include a music manifest, fireplace video, or scene video manifest");
  }

  if (hasMusicManifest) {
    summary.music = await validateMusicManifest({
      manifestPath: packageManifestPath,
      packageMusicRoot,
      publicMusicRoot
    });
  }

  if (packageVideoPath) {
    summary.fireplaceVideo = await validateMp4(packageVideoPath, "Fireplace video");
  }

  let scenePackage = null;
  if (hasSceneManifest) {
    scenePackage = await validateSceneVideosManifest({
      manifestPath: packageSceneManifestPath,
      packageSceneRoot
    });
    summary.scenes = {
      bytes: scenePackage.bytes,
      sha256: scenePackage.sha256,
      videoCount: scenePackage.videoCount,
      videos: scenePackage.videos.map((video) => ({
        id: video.id,
        filename: video.filename,
        label: video.label,
        order: video.order,
        default: video.default,
        roomModes: video.roomModes,
        bytes: video.bytes,
        sha256: video.sha256
      }))
    };
  }

  summary.sync = await syncToAssets({
    packagePath: { fireplaceVideoPath: packageVideoPath },
    packageMusicRoot,
    scenePackage,
    publicAssetsDir,
    distAssetsDir,
    fireplaceVideoTarget,
    dryRun: options.dryRun
  });

  if (!options.dryRun) {
    await mkdir(stateDir, { recursive: true });
    await writeFile(path.join(stateDir, "resource-ota-state.json"), `${JSON.stringify(summary, null, 2)}\n`);
  }

  console.log(JSON.stringify(summary, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

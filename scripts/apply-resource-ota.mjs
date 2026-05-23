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
const DEFAULT_MUSIC_MANIFEST = "assets/music/_metadata/library_manifest.csv";
const DEFAULT_FIREPLACE_VIDEO = "assets/output_2560x720-4k.mp4";
const DEFAULT_FIREPLACE_VIDEO_TARGET = "output_2560x720-4k.mp4";
const AUDIO_EXTENSIONS = new Set([".aac", ".flac", ".m4a", ".mp3", ".ogg", ".wav"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const COVER_COLUMNS = ["cover_relative_path", "cover_path", "album_art_relative_path", "artwork_relative_path"];

function usage() {
  return [
    "Usage: node scripts/apply-resource-ota.mjs <package-dir> [--dry-run]",
    "",
    "Package defaults:",
    "  manifest.json",
    "  assets/music/_metadata/library_manifest.csv",
    "  assets/music/**",
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

function parseCsvRows(text) {
  const rows = [];
  let currentRow = [];
  let currentCell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === "\"") {
      if (inQuotes && nextChar === "\"") {
        currentCell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") index += 1;
      currentRow.push(currentCell);
      if (currentRow.some((cell) => cell.trim().length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = "";
      continue;
    }

    currentCell += char;
  }

  currentRow.push(currentCell);
  if (currentRow.some((cell) => cell.trim().length > 0)) {
    rows.push(currentRow);
  }

  const [headerRow, ...dataRows] = rows;
  if (!headerRow) return { headers: [], rows: [] };
  const headers = headerRow.map((header) => header.replace(/^\uFEFF/, "").trim());
  return {
    headers,
    rows: dataRows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])))
  };
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

async function validateMp4(filePath) {
  const info = await stat(filePath);
  if (!info.isFile() || info.size <= 0) {
    throw new Error(`Fireplace video is empty or not a file: ${filePath}`);
  }
  const header = (await readFile(filePath)).subarray(0, 128).toString("latin1");
  if (!header.includes("ftyp")) {
    throw new Error(`Fireplace video does not look like an MP4 file: ${filePath}`);
  }
  return {
    bytes: info.size,
    sha256: await readSha256(filePath)
  };
}

async function validateMusicManifest({ manifestPath, packageMusicRoot, publicMusicRoot }) {
  const raw = await readFile(manifestPath, "utf8");
  const parsed = parseCsvRows(raw);
  const requiredHeaders = ["id", "title", "category_level_1", "final_relative_path"];
  const missingHeaders = requiredHeaders.filter((header) => !parsed.headers.includes(header));
  if (missingHeaders.length > 0) {
    throw new Error(`Music manifest is missing required columns: ${missingHeaders.join(", ")}`);
  }

  const missingFiles = [];
  const missingCovers = [];
  const trackRows = [];
  for (const row of parsed.rows) {
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

async function syncToAssets({ packagePath, packageMusicRoot, publicAssetsDir, distAssetsDir, fireplaceVideoTarget, dryRun }) {
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
      backups
    };
  }

  await mkdir(publicAssetsDir, { recursive: true });

  if (packageHasMusicRoot) {
    await backupFile(path.join(publicMusicRoot, "_metadata", "library_manifest.csv"), backupRoot, "public/assets/music/_metadata/library_manifest.csv")
      .then((saved) => { if (saved) backups.push("public/assets/music/_metadata/library_manifest.csv"); });
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

  return {
    backupId,
    publicSynced: true,
    distSynced: distAssetsAvailable,
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
  const packageMusicRoot = resolveInside(options.packageDir, musicRootRelative);
  const packageManifestPath = resolveInside(options.packageDir, musicManifestRelative);
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
    sync: null
  };

  if (!(await exists(packageManifestPath)) && !packageVideoPath) {
    throw new Error("Resource OTA package must include a music manifest or fireplace video");
  }

  if (await exists(packageManifestPath)) {
    summary.music = await validateMusicManifest({
      manifestPath: packageManifestPath,
      packageMusicRoot,
      publicMusicRoot
    });
  }

  if (packageVideoPath) {
    summary.fireplaceVideo = await validateMp4(packageVideoPath);
  }

  summary.sync = await syncToAssets({
    packagePath: { fireplaceVideoPath: packageVideoPath },
    packageMusicRoot,
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

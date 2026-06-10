import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { constants } from "node:fs";
import { access, cp, mkdir, open, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT_DIR = path.join(ROOT, ".tikpal", "resource-ota-packages");
const DEFAULT_SCENE_ROOT = "assets/scenes";
const DEFAULT_SCENE_MANIFEST = "assets/scenes/_metadata/scene_videos.json";
const DEFAULT_ORDER_START = 100;
const DEFAULT_ORDER_STEP = 10;
const AUDIO_GAIN_TARGET_MEAN_DB = -24;
const AUDIO_GAIN_PEAK_CEILING_DB = -1;
const AUDIO_GAIN_MIN_DB = -24;
const AUDIO_GAIN_MAX_DB = 12;
const AUDIO_GAIN_ANALYSIS_TIMEOUT_MS = 15_000;

function usage() {
  return [
    "Usage: node scripts/generate-mp4-resource-otas.mjs <mp4-dir> [options]",
    "",
    "Creates resource OTA packages that can be applied with:",
    "  npm run ota:resources -- <package-dir>",
    "",
    "Options:",
    "  --output <dir>              Output root. Default: .tikpal/resource-ota-packages",
    "  --recursive                 Include nested directories",
    "  --bundle                    Build one OTA package containing all MP4 files",
    "  --force                     Replace generated package directories if they already exist",
    "  --dry-run                   Print the package plan without writing files",
    "  --version-prefix <value>    Version prefix. Default: mp4-scenes-<timestamp>",
    "  --start-order <number>      First scene order. Default: 100",
    "  --order-step <number>       Scene order increment. Default: 10",
    "  --default <id|filename>     Mark one generated scene as the default"
  ].join("\n");
}

function readOptionValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parseNumberOption(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a finite number: ${value}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    inputDir: null,
    outputDir: DEFAULT_OUTPUT_DIR,
    recursive: false,
    bundle: false,
    force: false,
    dryRun: false,
    versionPrefix: null,
    startOrder: DEFAULT_ORDER_START,
    orderStep: DEFAULT_ORDER_STEP,
    defaultScene: null
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else if (arg === "--output") {
      options.outputDir = readOptionValue(args, index, arg);
      index += 1;
    } else if (arg === "--recursive") {
      options.recursive = true;
    } else if (arg === "--bundle") {
      options.bundle = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--version-prefix") {
      options.versionPrefix = readOptionValue(args, index, arg);
      index += 1;
    } else if (arg === "--start-order") {
      options.startOrder = parseNumberOption(readOptionValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--order-step") {
      options.orderStep = parseNumberOption(readOptionValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--default") {
      options.defaultScene = readOptionValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!options.inputDir) {
      options.inputDir = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!options.inputDir) {
    throw new Error(usage());
  }

  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return {
    ...options,
    inputDir: path.resolve(options.inputDir),
    outputDir: path.resolve(options.outputDir),
    versionPrefix: options.versionPrefix ?? `mp4-scenes-${timestamp}`
  };
}

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isInsideOrSame(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function toPosixPath(value) {
  return value.split(path.sep).join(path.posix.sep);
}

function slugify(value, fallback) {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+$/, "");
  return normalized || fallback;
}

function toLabel(filePath) {
  const parsed = path.parse(filePath);
  return parsed.name
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || parsed.name;
}

function makeUnique(value, used) {
  if (!used.has(value)) {
    used.add(value);
    return value;
  }

  let suffix = 2;
  while (used.has(`${value}-${suffix}`)) {
    suffix += 1;
  }
  const unique = `${value}-${suffix}`;
  used.add(unique);
  return unique;
}

async function validateMp4(filePath) {
  const info = await stat(filePath);
  if (!info.isFile() || info.size <= 0) {
    throw new Error(`MP4 is empty or not a file: ${filePath}`);
  }

  const handle = await open(filePath, "r");
  try {
    const headerBytes = Math.min(info.size, 4096);
    const header = Buffer.alloc(headerBytes);
    await handle.read(header, 0, headerBytes, 0);
    if (!header.toString("latin1").includes("ftyp")) {
      throw new Error(`File does not look like an MP4: ${filePath}`);
    }
  } finally {
    await handle.close();
  }

  return info;
}

async function readSha256(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolve);
  });
  return hash.digest("hex");
}

function roundAudioGainDb(value) {
  const rounded = Number(value.toFixed(1));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function computeAudioGainDb({ meanVolumeDb, maxVolumeDb }) {
  const targetGainDb = AUDIO_GAIN_TARGET_MEAN_DB - meanVolumeDb;
  const peakLimitedGainDb = AUDIO_GAIN_PEAK_CEILING_DB - maxVolumeDb;
  const gainDb = Math.max(
    AUDIO_GAIN_MIN_DB,
    Math.min(AUDIO_GAIN_MAX_DB, targetGainDb, peakLimitedGainDb)
  );
  return roundAudioGainDb(gainDb);
}

function parseVolumedetectOutput(output) {
  const meanMatch = output.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/i);
  const maxMatch = output.match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/i);
  if (!meanMatch || !maxMatch) return null;

  const meanVolumeDb = Number(meanMatch[1]);
  const maxVolumeDb = Number(maxMatch[1]);
  if (!Number.isFinite(meanVolumeDb) || !Number.isFinite(maxVolumeDb)) return null;
  return { meanVolumeDb, maxVolumeDb };
}

async function analyzeAudioGainDb(filePath) {
  return await new Promise((resolve) => {
    let settled = false;
    let stderr = "";
    const child = spawn("ffmpeg", [
      "-hide_banner",
      "-nostats",
      "-t",
      "12",
      "-i",
      filePath,
      "-af",
      "volumedetect",
      "-f",
      "null",
      "-"
    ], { stdio: ["ignore", "ignore", "pipe"] });

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, AUDIO_GAIN_ANALYSIS_TIMEOUT_MS);

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", () => finish(null));
    child.on("close", () => {
      const analysis = parseVolumedetectOutput(stderr);
      finish(analysis ? computeAudioGainDb(analysis) : null);
    });
  });
}

async function scanMp4Files({ inputDir, outputDir, recursive }) {
  const inputInfo = await stat(inputDir);
  if (!inputInfo.isDirectory()) {
    throw new Error(`Input path is not a directory: ${inputDir}`);
  }

  const files = [];
  async function visit(currentDir) {
    if (isInsideOrSame(outputDir, currentDir)) return;

    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (recursive) {
          await visit(absolutePath);
        }
        continue;
      }
      if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".mp4") {
        files.push(absolutePath);
      }
    }
  }

  await visit(inputDir);
  return files.sort((first, second) => path.relative(inputDir, first).localeCompare(path.relative(inputDir, second)));
}

function resolveDefaultScene(defaultScene, videos) {
  if (!defaultScene) return null;
  const normalized = String(defaultScene).trim();
  const match = videos.find((video) => {
    return video.id === normalized
      || video.filename === normalized
      || path.basename(video.filename) === normalized
      || path.basename(video.filename, ".mp4") === normalized;
  });
  if (!match) {
    throw new Error(`Default scene did not match any generated MP4: ${defaultScene}`);
  }
  return match.id;
}

async function buildVideoEntries(options) {
  const sourceFiles = await scanMp4Files(options);
  if (sourceFiles.length === 0) {
    throw new Error(`No MP4 files found in ${options.inputDir}${options.recursive ? "" : " (use --recursive for nested files)"}`);
  }

  const usedIds = new Set();
  const videos = [];
  for (const [index, filePath] of sourceFiles.entries()) {
    const info = await validateMp4(filePath);
    const relativePath = toPosixPath(path.relative(options.inputDir, filePath));
    const idBase = slugify(path.join(path.dirname(relativePath), path.basename(relativePath, ".mp4")), `scene-${index + 1}`);
    const id = makeUnique(idBase, usedIds);
    videos.push({
      id,
      sourcePath: filePath,
      filename: relativePath,
      label: toLabel(filePath),
      order: options.startOrder + (index * options.orderStep),
      default: false,
      bytes: info.size,
      sha256: await readSha256(filePath),
      audioGainDb: await analyzeAudioGainDb(filePath)
    });
  }

  const defaultId = resolveDefaultScene(options.defaultScene, videos);
  return videos.map((video) => ({
    ...video,
    default: video.id === defaultId
  }));
}

function toSceneManifest(videos) {
  return {
    mode: "add",
    videos: videos.map((video) => ({
      id: video.id,
      filename: video.filename,
      label: video.label,
      order: video.order,
      ...(video.default ? { default: true } : {}),
      ...(video.audioGainDb !== null ? { audioGainDb: video.audioGainDb } : {}),
      sha256: video.sha256
    }))
  };
}

function toPackageManifest(version) {
  return {
    version,
    assets: {
      sceneRoot: DEFAULT_SCENE_ROOT,
      sceneManifest: DEFAULT_SCENE_MANIFEST
    }
  };
}

async function preparePackageDir(packageDir, { force, dryRun }) {
  if (dryRun) return;
  if (await exists(packageDir)) {
    if (!force) {
      throw new Error(`Output package already exists: ${packageDir} (use --force to replace it)`);
    }
    await rm(packageDir, { recursive: true, force: true });
  }
  await mkdir(path.join(packageDir, DEFAULT_SCENE_ROOT, "_metadata"), { recursive: true });
}

async function writeJson(filePath, value, dryRun) {
  if (dryRun) return;
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writePackage({ packageDir, version, videos, options }) {
  await preparePackageDir(packageDir, options);
  if (!options.dryRun) {
    for (const video of videos) {
      const targetPath = path.join(packageDir, DEFAULT_SCENE_ROOT, ...video.filename.split("/"));
      await mkdir(path.dirname(targetPath), { recursive: true });
      await cp(video.sourcePath, targetPath, { force: true });
    }
  }

  await writeJson(path.join(packageDir, "manifest.json"), toPackageManifest(version), options.dryRun);
  await writeJson(path.join(packageDir, DEFAULT_SCENE_MANIFEST), toSceneManifest(videos), options.dryRun);

  return {
    packageDir,
    version,
    videos: videos.map((video) => ({
      id: video.id,
      filename: video.filename,
      label: video.label,
      order: video.order,
      default: video.default,
      bytes: video.bytes,
      ...(video.audioGainDb !== null ? { audioGainDb: video.audioGainDb } : {}),
      sha256: video.sha256
    }))
  };
}

async function buildPackages(options, videos) {
  const outputPackages = [];

  if (options.bundle) {
    const inputName = slugify(path.basename(options.inputDir), "mp4-scenes");
    const packageDir = path.join(options.outputDir, `${inputName}-scene-ota`);
    outputPackages.push(await writePackage({
      packageDir,
      version: `${options.versionPrefix}-${inputName}`,
      videos,
      options
    }));
    return outputPackages;
  }

  for (const video of videos) {
    const packageDir = path.join(options.outputDir, `${video.id}-scene-ota`);
    outputPackages.push(await writePackage({
      packageDir,
      version: `${options.versionPrefix}-${video.id}`,
      videos: [video],
      options
    }));
  }

  return outputPackages;
}

async function run() {
  const options = parseArgs(process.argv);
  const videos = await buildVideoEntries(options);
  const packages = await buildPackages(options, videos);

  console.log(JSON.stringify({
    ok: true,
    dryRun: options.dryRun,
    mode: options.bundle ? "bundle" : "split",
    inputDir: options.inputDir,
    outputDir: options.outputDir,
    videoCount: videos.length,
    packageCount: packages.length,
    packages
  }, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

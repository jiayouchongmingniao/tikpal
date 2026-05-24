import { constants } from "node:fs";
import { access, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PUBLIC_ASSETS_DIR = path.join(ROOT, "public", "assets");
const DEFAULT_DIST_ASSETS_DIR = path.join(ROOT, "dist", "assets");
const DEFAULT_STATE_DIR = path.join(ROOT, ".tikpal");
const SCENE_MANIFEST_TARGET = path.join("scenes", "_metadata", "scene_videos.json");

function usage() {
  return [
    "Usage: node scripts/clear-scene-videos.mjs [options]",
    "",
    "Clears installed Ambient scene videos and resets scene_videos.json.",
    "",
    "Options:",
    "  --public-assets-dir <dir>  Public assets root. Default: public/assets",
    "  --dist-assets-dir <dir>    Dist assets root. Default: dist/assets",
    "  --state-dir <dir>          State root. Default: .tikpal",
    "  --dry-run                  Print what would be cleared without writing"
  ].join("\n");
}

function readOptionValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    publicAssetsDir: process.env.TIKPAL_RESOURCE_OTA_PUBLIC_ASSETS_DIR ?? DEFAULT_PUBLIC_ASSETS_DIR,
    distAssetsDir: process.env.TIKPAL_RESOURCE_OTA_DIST_ASSETS_DIR ?? DEFAULT_DIST_ASSETS_DIR,
    stateDir: process.env.TIKPAL_RESOURCE_OTA_STATE_DIR ?? DEFAULT_STATE_DIR,
    dryRun: false
  };

  const args = argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else if (arg === "--public-assets-dir") {
      options.publicAssetsDir = readOptionValue(args, index, arg);
      index += 1;
    } else if (arg === "--dist-assets-dir") {
      options.distAssetsDir = readOptionValue(args, index, arg);
      index += 1;
    } else if (arg === "--state-dir") {
      options.stateDir = readOptionValue(args, index, arg);
      index += 1;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    publicAssetsDir: path.resolve(options.publicAssetsDir),
    distAssetsDir: path.resolve(options.distAssetsDir),
    stateDir: path.resolve(options.stateDir),
    dryRun: options.dryRun
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

function assertSceneRootInsideAssets(assetsDir, sceneRoot) {
  const relative = path.relative(assetsDir, sceneRoot);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to clear a scene root outside assets dir: ${sceneRoot}`);
  }
}

async function countFiles(rootDir) {
  if (!(await exists(rootDir))) return 0;
  let total = 0;

  async function visit(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        total += 1;
      }
    }
  }

  await visit(rootDir);
  return total;
}

async function clearSceneRoot(assetsDir, { dryRun }) {
  const sceneRoot = path.join(assetsDir, "scenes");
  const manifestPath = path.join(assetsDir, SCENE_MANIFEST_TARGET);
  assertSceneRootInsideAssets(assetsDir, sceneRoot);
  const existed = await exists(sceneRoot);
  const removedFiles = await countFiles(sceneRoot);

  if (!dryRun) {
    await rm(sceneRoot, { recursive: true, force: true });
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify({ mode: "add", videos: [] }, null, 2)}\n`);
  }

  return {
    assetsDir,
    sceneRoot,
    manifestPath,
    existed,
    removedFiles
  };
}

async function run() {
  const options = parseArgs(process.argv);
  const publicResult = await clearSceneRoot(options.publicAssetsDir, options);
  const distAssetsExists = await exists(options.distAssetsDir);
  const distResult = distAssetsExists
    ? await clearSceneRoot(options.distAssetsDir, options)
    : null;

  const summary = {
    ok: true,
    dryRun: options.dryRun,
    clearedAt: new Date().toISOString(),
    public: publicResult,
    dist: distResult
  };

  if (!options.dryRun) {
    await mkdir(options.stateDir, { recursive: true });
    await writeFile(path.join(options.stateDir, "scene-video-clear-state.json"), `${JSON.stringify(summary, null, 2)}\n`);
  }

  console.log(JSON.stringify(summary, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

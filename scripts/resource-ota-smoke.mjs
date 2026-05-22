import { constants } from "node:fs";
import { access, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function run() {
  const workspace = await mkdtemp(path.join(tmpdir(), "tikpal-resource-ota-"));
  const packageDir = path.join(workspace, "package");
  const packageMusicDir = path.join(packageDir, "assets", "music");
  const targetPublicAssets = path.join(workspace, "target-public", "assets");
  const targetDistAssets = path.join(workspace, "target-dist", "assets");
  const stateDir = path.join(workspace, "state");
  const trackPath = path.join(packageMusicDir, "Focus", "Lo-fi", "Smoke Track.mp3");
  const manifestPath = path.join(packageMusicDir, "_metadata", "library_manifest.csv");
  const videoPath = path.join(packageDir, "assets", "output_2560x720-4k.mp4");

  try {
    await mkdir(path.dirname(trackPath), { recursive: true });
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await mkdir(targetDistAssets, { recursive: true });
    await writeFile(
      path.join(packageDir, "manifest.json"),
      `${JSON.stringify({ version: "smoke", assets: {} }, null, 2)}\n`
    );
    await writeFile(trackPath, "fake mp3 bytes");
    await writeFile(
      manifestPath,
      [
        "id,title,artist_or_author,category_level_1,category_level_2,duration_mm_ss,final_relative_path",
        "SMOKE-001,Smoke Track,Tikpal,Focus,Lo-fi,00:10,Focus/Lo-fi/Smoke Track.mp3"
      ].join("\n")
    );
    await writeFile(videoPath, Buffer.from("000000 ftypisom tikpal smoke mp4"));

    const apply = spawnSync(process.execPath, ["scripts/apply-resource-ota.mjs", packageDir], {
      cwd: ROOT,
      env: {
        ...process.env,
        TIKPAL_RESOURCE_OTA_PUBLIC_ASSETS_DIR: targetPublicAssets,
        TIKPAL_RESOURCE_OTA_DIST_ASSETS_DIR: targetDistAssets,
        TIKPAL_RESOURCE_OTA_STATE_DIR: stateDir
      },
      encoding: "utf8"
    });

    assert(apply.status === 0, `resource OTA apply failed:\n${apply.stdout}\n${apply.stderr}`);
    const summary = JSON.parse(apply.stdout);
    assert(summary.music.trackCount === 1, "resource OTA should report one manifest track");
    assert(summary.fireplaceVideo.bytes > 0, "resource OTA should report fireplace video bytes");
    assert(summary.sync.publicSynced === true, "resource OTA should sync public assets");
    assert(summary.sync.distSynced === true, "resource OTA should sync dist assets when present");
    assert(await exists(path.join(targetPublicAssets, "music", "_metadata", "library_manifest.csv")), "public music manifest should be copied");
    assert(await exists(path.join(targetPublicAssets, "music", "Focus", "Lo-fi", "Smoke Track.mp3")), "public music file should be copied");
    assert(await exists(path.join(targetDistAssets, "music", "Focus", "Lo-fi", "Smoke Track.mp3")), "dist music file should be copied");
    assert(await exists(path.join(targetPublicAssets, "output_2560x720-4k.mp4")), "public fireplace video should be copied");
    assert(await exists(path.join(targetDistAssets, "output_2560x720-4k.mp4")), "dist fireplace video should be copied");

    const state = JSON.parse(await readFile(path.join(stateDir, "resource-ota-state.json"), "utf8"));
    assert(state.version === "smoke", "resource OTA state should persist package version");
    const videoInfo = await stat(path.join(targetPublicAssets, "output_2560x720-4k.mp4"));
    assert(videoInfo.size === summary.fireplaceVideo.bytes, "copied video size should match summary");

    console.log("resource ota smoke passed");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

import { constants } from "node:fs";
import { createHash } from "node:crypto";
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
  const manifestPath = path.join(packageMusicDir, "_metadata", "library_manifest.json");
  const videoPath = path.join(packageDir, "assets", "output_2560x720-4k.mp4");
  const sceneVideoPath = path.join(packageDir, "assets", "scenes", "Rainy-Window.mp4");
  const sceneManifestPath = path.join(packageDir, "assets", "scenes", "_metadata", "scene_videos.json");

  try {
    await mkdir(path.dirname(trackPath), { recursive: true });
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await mkdir(path.dirname(sceneManifestPath), { recursive: true });
    await mkdir(targetDistAssets, { recursive: true });
    await writeFile(
      path.join(packageDir, "manifest.json"),
      `${JSON.stringify({ version: "smoke", assets: {} }, null, 2)}\n`
    );
    await writeFile(trackPath, "fake mp3 bytes");
    await writeFile(
      manifestPath,
      `${JSON.stringify([
        {
          id: "SMOKE-001",
          title: "Smoke Track",
          artist_or_author: "Tikpal",
          category_level_1: "Focus",
          category_level_2: "Lo-fi",
          duration_mm_ss: "00:10",
          final_relative_path: "Focus/Lo-fi/Smoke Track.mp3"
        }
      ], null, 2)}\n`
    );
    await writeFile(videoPath, Buffer.from("000000 ftypisom tikpal smoke mp4"));
    const sceneBytes = Buffer.from("000000 ftypisom tikpal rainy window smoke mp4");
    const sceneSha256 = createHash("sha256").update(sceneBytes).digest("hex");
    await writeFile(sceneVideoPath, sceneBytes);
    await writeFile(
      sceneManifestPath,
      `${JSON.stringify({
        mode: "add",
        videos: [
          {
            id: "rainy-window",
            filename: "Rainy-Window.mp4",
            label: "Rainy Window",
            order: 30,
            default: false,
            sha256: sceneSha256
          }
        ]
      }, null, 2)}\n`
    );

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
    assert(summary.scenes.videoCount === 1, "resource OTA should report one scene video");
    assert(summary.scenes.videos[0].id === "rainy-window", "resource OTA should preserve scene video id");
    assert(summary.sync.publicSynced === true, "resource OTA should sync public assets");
    assert(summary.sync.distSynced === true, "resource OTA should sync dist assets when present");
    assert(summary.sync.sceneSynced === true, "resource OTA should sync scene assets");
    assert(await exists(path.join(targetPublicAssets, "music", "_metadata", "library_manifest.json")), "public music manifest should be copied");
    assert(await exists(path.join(targetPublicAssets, "music", "Focus", "Lo-fi", "Smoke Track.mp3")), "public music file should be copied");
    assert(await exists(path.join(targetDistAssets, "music", "Focus", "Lo-fi", "Smoke Track.mp3")), "dist music file should be copied");
    assert(await exists(path.join(targetPublicAssets, "output_2560x720-4k.mp4")), "public fireplace video should be copied");
    assert(await exists(path.join(targetDistAssets, "output_2560x720-4k.mp4")), "dist fireplace video should be copied");
    assert(await exists(path.join(targetPublicAssets, "scenes", "Rainy-Window.mp4")), "public scene video should be copied");
    assert(await exists(path.join(targetDistAssets, "scenes", "Rainy-Window.mp4")), "dist scene video should be copied");
    assert(await exists(path.join(targetPublicAssets, "scenes", "_metadata", "scene_videos.json")), "public scene manifest should be copied");

    const state = JSON.parse(await readFile(path.join(stateDir, "resource-ota-state.json"), "utf8"));
    assert(state.version === "smoke", "resource OTA state should persist package version");
    assert(state.scenes.videos[0].sha256 === sceneSha256, "resource OTA state should persist scene checksum");
    const videoInfo = await stat(path.join(targetPublicAssets, "output_2560x720-4k.mp4"));
    assert(videoInfo.size === summary.fireplaceVideo.bytes, "copied video size should match summary");
    const sceneInfo = await stat(path.join(targetPublicAssets, "scenes", "Rainy-Window.mp4"));
    assert(sceneInfo.size === summary.scenes.videos[0].bytes, "copied scene video size should match summary");

    console.log("resource ota smoke passed");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

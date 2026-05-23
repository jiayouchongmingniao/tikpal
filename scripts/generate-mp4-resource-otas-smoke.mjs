import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

function runNode(args, env = {}) {
  return spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      ...env
    },
    encoding: "utf8"
  });
}

async function run() {
  const workspace = await mkdtemp(path.join(tmpdir(), "tikpal-mp4-ota-generator-"));
  const inputDir = path.join(workspace, "input");
  const outputDir = path.join(workspace, "packages");
  const firstVideo = Buffer.from("000000 ftypisom tikpal calm fireplace smoke mp4");
  const secondVideo = Buffer.from("000000 ftypisom tikpal rainy window smoke mp4");

  try {
    await mkdir(path.join(inputDir, "Nested"), { recursive: true });
    await writeFile(path.join(inputDir, "Calm Fireplace.mp4"), firstVideo);
    await writeFile(path.join(inputDir, "Nested", "Rainy_Window.mp4"), secondVideo);

    const generate = runNode([
      "scripts/generate-mp4-resource-otas.mjs",
      inputDir,
      "--output",
      outputDir,
      "--recursive",
      "--version-prefix",
      "smoke",
      "--start-order",
      "40",
      "--default",
      "Calm Fireplace.mp4"
    ]);

    assert(generate.status === 0, `MP4 OTA generation failed:\n${generate.stdout}\n${generate.stderr}`);
    const summary = JSON.parse(generate.stdout);
    assert(summary.videoCount === 2, "generator should find two recursive MP4 files");
    assert(summary.packageCount === 2, "split mode should create one package per MP4");

    const firstPackage = summary.packages.find((item) => item.videos[0].filename === "Calm Fireplace.mp4");
    const secondPackage = summary.packages.find((item) => item.videos[0].filename === "Nested/Rainy_Window.mp4");
    assert(firstPackage, "generator should report the first package");
    assert(secondPackage, "generator should preserve nested scene filenames");
    assert(firstPackage.videos[0].default === true, "generator should mark the requested default scene");
    assert(firstPackage.videos[0].sha256 === createHash("sha256").update(firstVideo).digest("hex"), "first checksum should match");
    assert(secondPackage.videos[0].order === 50, "scene order should increment by the configured step");

    for (const packageSummary of summary.packages) {
      assert(await exists(path.join(packageSummary.packageDir, "manifest.json")), "package should include manifest.json");
      assert(
        await exists(path.join(packageSummary.packageDir, "assets", "scenes", "_metadata", "scene_videos.json")),
        "package should include scene_videos.json"
      );
      const apply = runNode(["scripts/apply-resource-ota.mjs", packageSummary.packageDir, "--dry-run"], {
        TIKPAL_RESOURCE_OTA_PUBLIC_ASSETS_DIR: path.join(workspace, "target-public", "assets"),
        TIKPAL_RESOURCE_OTA_DIST_ASSETS_DIR: path.join(workspace, "target-dist", "assets"),
        TIKPAL_RESOURCE_OTA_STATE_DIR: path.join(workspace, "state")
      });
      assert(apply.status === 0, `Generated package did not pass OTA dry-run:\n${apply.stdout}\n${apply.stderr}`);
    }

    const sceneManifest = JSON.parse(await readFile(path.join(firstPackage.packageDir, "assets", "scenes", "_metadata", "scene_videos.json"), "utf8"));
    assert(sceneManifest.videos[0].id === "calm-fireplace", "scene id should be slugged from the filename");

    console.log("mp4 resource ota generator smoke passed");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

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

function canRunFfmpeg() {
  const result = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  return result.status === 0;
}

function canRunFfprobe() {
  const result = spawnSync("ffprobe", ["-version"], { encoding: "utf8" });
  return result.status === 0;
}

function readRatio(value) {
  const [numeratorRaw, denominatorRaw] = String(value ?? "").split("/");
  const numerator = Number(numeratorRaw);
  const denominator = Number(denominatorRaw);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

function probeVideo(filePath) {
  const result = spawnSync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=codec_name,profile,level,width,height,pix_fmt,r_frame_rate,avg_frame_rate,bit_rate,has_b_frames",
    "-show_entries",
    "format=bit_rate",
    "-of",
    "json",
    filePath
  ], { encoding: "utf8" });
  assert(result.status === 0, `ffprobe failed for ${filePath}:\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

function assertPiFriendlySceneVideo(filePath) {
  const probe = probeVideo(filePath);
  const stream = probe.streams?.[0] ?? {};
  const frameRate = readRatio(stream.avg_frame_rate) ?? readRatio(stream.r_frame_rate);
  const bitRate = Number(stream.bit_rate ?? probe.format?.bit_rate);
  assert(stream.codec_name === "h264", "packaged scene video should use H.264");
  assert(String(stream.profile).toLowerCase() === "main", `packaged scene video should use H.264 Main profile, got ${stream.profile}`);
  assert(Number(stream.level) <= 41, `packaged scene video should use H.264 Level 4.1 or lower, got ${stream.level}`);
  assert(Number(stream.width) === 2560, `packaged scene video width should be 2560, got ${stream.width}`);
  assert(Number(stream.height) === 720, `packaged scene video height should be 720, got ${stream.height}`);
  assert(stream.pix_fmt === "yuv420p", `packaged scene video should use yuv420p, got ${stream.pix_fmt}`);
  assert(Math.abs((frameRate ?? 0) - 24) < 0.01, `packaged scene video should be 24fps, got ${stream.avg_frame_rate || stream.r_frame_rate}`);
  assert(Number(stream.has_b_frames ?? 0) === 0, "packaged scene video should not use B-frames");
  if (Number.isFinite(bitRate) && bitRate > 0) {
    assert(bitRate <= 4_500_000, `packaged scene video bitrate should not exceed 4500k, got ${bitRate}`);
  }
}

function writeSmokeMp4(filePath, { color, frequency }) {
  return spawnSync("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=${color}:s=96x54:r=12`,
    "-f", "lavfi",
    "-i", `sine=frequency=${frequency}:sample_rate=44100`,
    "-t", "0.8",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "35",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "48k",
    "-movflags", "+faststart",
    filePath
  ], { encoding: "utf8" });
}

async function run() {
  const workspace = await mkdtemp(path.join(tmpdir(), "tikpal-mp4-ota-generator-"));
  const inputDir = path.join(workspace, "input");
  const outputDir = path.join(workspace, "packages");
  let firstVideo = Buffer.from("000000 ftypisom tikpal calm fireplace smoke mp4");
  let secondVideo = Buffer.from("000000 ftypisom tikpal rainy window smoke mp4");
  const shouldExpectAudioGain = canRunFfmpeg();
  const shouldProbeNormalizedVideo = shouldExpectAudioGain && canRunFfprobe();

  try {
    await mkdir(path.join(inputDir, "Nested"), { recursive: true });
    const firstVideoPath = path.join(inputDir, "Calm Fireplace.mp4");
    const secondVideoPath = path.join(inputDir, "Nested", "Rainy_Window.mp4");
    if (shouldExpectAudioGain) {
      const firstWrite = writeSmokeMp4(firstVideoPath, { color: "0xe65f22", frequency: 440 });
      const secondWrite = writeSmokeMp4(secondVideoPath, { color: "0x335c8a", frequency: 660 });
      assert(firstWrite.status === 0, `Failed to create first smoke MP4:\n${firstWrite.stdout}\n${firstWrite.stderr}`);
      assert(secondWrite.status === 0, `Failed to create second smoke MP4:\n${secondWrite.stdout}\n${secondWrite.stderr}`);
      firstVideo = await readFile(firstVideoPath);
      secondVideo = await readFile(secondVideoPath);
    } else {
      await writeFile(firstVideoPath, firstVideo);
      await writeFile(secondVideoPath, secondVideo);
    }

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
      "Calm Fireplace.mp4",
      ...(!shouldExpectAudioGain ? ["--copy-original"] : [])
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
    const firstPackagedVideoPath = path.join(firstPackage.packageDir, "assets", "scenes", "Calm Fireplace.mp4");
    const secondPackagedVideoPath = path.join(secondPackage.packageDir, "assets", "scenes", "Nested", "Rainy_Window.mp4");
    const firstPackagedVideo = await readFile(firstPackagedVideoPath);
    const secondPackagedVideo = await readFile(secondPackagedVideoPath);
    assert(firstPackage.videos[0].sha256 === createHash("sha256").update(firstPackagedVideo).digest("hex"), "first checksum should match packaged output");
    assert(secondPackage.videos[0].sha256 === createHash("sha256").update(secondPackagedVideo).digest("hex"), "second checksum should match packaged output");
    if (!shouldExpectAudioGain) {
      assert(firstPackagedVideo.equals(firstVideo), "copy-original fallback should preserve first MP4 bytes");
      assert(secondPackagedVideo.equals(secondVideo), "copy-original fallback should preserve second MP4 bytes");
    }
    if (shouldProbeNormalizedVideo) {
      assertPiFriendlySceneVideo(firstPackagedVideoPath);
      assertPiFriendlySceneVideo(secondPackagedVideoPath);
    }
    assert(secondPackage.videos[0].order === 50, "scene order should increment by the configured step");
    if (shouldExpectAudioGain) {
      assert(Number.isFinite(firstPackage.videos[0].audioGainDb), "generator should analyze and report first scene audio gain");
      assert(Number.isFinite(secondPackage.videos[0].audioGainDb), "generator should analyze and report second scene audio gain");
    } else {
      assert(!("audioGainDb" in firstPackage.videos[0]), "generator should omit audio gain when analysis is unavailable");
    }

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
    if (shouldExpectAudioGain) {
      assert(sceneManifest.videos[0].audioGainDb === firstPackage.videos[0].audioGainDb, "package manifest should include analyzed scene audio gain");
    } else {
      assert(!("audioGainDb" in sceneManifest.videos[0]), "package manifest should omit audio gain when analysis fails");
    }

    console.log("mp4 resource ota generator smoke passed");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

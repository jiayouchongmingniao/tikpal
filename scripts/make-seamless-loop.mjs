import { spawnSync } from "node:child_process";
import { copyFile, mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_INPUT = "public/assets/output_2560x720-4k.mp4";
const DEFAULT_CROSSFADE_SECONDS = 0.9;
const DEFAULT_FPS = 24;

function printUsage() {
  console.log([
    "Usage: node scripts/make-seamless-loop.mjs [--input <mp4>] [--output <mp4>] [--crossfade <seconds>]",
    "",
    "Defaults:",
    `  --input ${DEFAULT_INPUT}`,
    "  --output <input>",
    `  --crossfade ${DEFAULT_CROSSFADE_SECONDS}`,
    "",
    "The script keeps the same public asset URL by default, writing a backup under .codex-artifacts first."
  ].join("\n"));
}

function parseArgs(argv) {
  const options = {
    input: DEFAULT_INPUT,
    output: null,
    crossfadeSeconds: DEFAULT_CROSSFADE_SECONDS,
    fps: DEFAULT_FPS
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--input") {
      options.input = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--output") {
      options.output = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--crossfade") {
      options.crossfadeSeconds = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--fps") {
      options.fps = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  options.output ??= options.input;
  if (!options.input || !options.output) {
    throw new Error("--input and --output must be non-empty paths");
  }
  if (!Number.isFinite(options.crossfadeSeconds) || options.crossfadeSeconds <= 0) {
    throw new Error("--crossfade must be a positive number of seconds");
  }
  if (!Number.isFinite(options.fps) || options.fps <= 0) {
    throw new Error("--fps must be a positive number");
  }

  return options;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8"
  });
  if (result.status !== 0) {
    const detail = options.capture ? `${result.stdout ?? ""}${result.stderr ?? ""}` : "";
    throw new Error(`${command} failed${detail ? `:\n${detail}` : ""}`);
  }
  return result.stdout ?? "";
}

function probe(input) {
  const stdout = run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:stream=index,codec_type",
    "-of", "json",
    input
  ], { capture: true });
  const payload = JSON.parse(stdout);
  const duration = Number(payload.format?.duration);
  const hasAudio = Array.isArray(payload.streams)
    && payload.streams.some((stream) => stream.codec_type === "audio");
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Could not read MP4 duration from ${input}`);
  }
  return { duration, hasAudio };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const input = path.resolve(options.input);
  const output = path.resolve(options.output);
  const sameOutput = input === output;
  const { duration, hasAudio } = probe(input);

  if (options.crossfadeSeconds * 3 >= duration) {
    throw new Error(`Crossfade ${options.crossfadeSeconds}s is too long for ${duration.toFixed(3)}s video`);
  }

  const outputDir = path.dirname(output);
  const backupDir = path.resolve(".codex-artifacts", "media-backups");
  const tmpOutput = path.join(
    outputDir,
    `.${path.basename(output, path.extname(output))}.seamless-${Date.now()}${path.extname(output)}`
  );
  const backupOutput = sameOutput
    ? path.join(backupDir, `${path.basename(output)}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`)
    : null;
  const frameSeconds = 1 / options.fps;
  const cutSeconds = options.crossfadeSeconds * 2;
  const headSeconds = cutSeconds + frameSeconds;
  const transitionOffset = duration - cutSeconds - options.crossfadeSeconds;
  const videoFilter = [
    `[0:v]trim=start=${cutSeconds}:end=${duration},setpts=PTS-STARTPTS[mainv]`,
    `[0:v]trim=start=0:end=${headSeconds},setpts=PTS-STARTPTS[headv]`,
    `[mainv][headv]xfade=transition=fade:duration=${options.crossfadeSeconds}:offset=${transitionOffset},fps=${options.fps},format=yuv420p[v]`
  ];
  const filterParts = [...videoFilter];
  const ffmpegArgs = [
    "-y",
    "-i", input,
    "-filter_complex"
  ];

  if (hasAudio) {
    filterParts.push(
      `[0:a]atrim=start=${cutSeconds}:end=${duration},asetpts=PTS-STARTPTS[maina]`,
      `[0:a]atrim=start=0:end=${headSeconds},asetpts=PTS-STARTPTS[heada]`,
      `[maina][heada]acrossfade=d=${options.crossfadeSeconds}:c1=tri:c2=tri[a]`
    );
  }

  ffmpegArgs.push(filterParts.join(";"));
  ffmpegArgs.push(
    "-map", "[v]",
    ...(hasAudio ? ["-map", "[a]", "-c:a", "aac", "-b:a", "128k"] : ["-an"]),
    "-c:v", "libx264",
    "-profile:v", "high",
    "-preset", "slow",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    tmpOutput
  );

  run("ffmpeg", ffmpegArgs);
  await stat(tmpOutput);
  if (backupOutput) {
    await mkdir(path.dirname(backupOutput), { recursive: true });
    await copyFile(input, backupOutput);
  }
  await rename(tmpOutput, output);
  console.log(JSON.stringify({
    input,
    output,
    backup: backupOutput,
    sourceDurationSeconds: duration,
    outputDurationSeconds: duration - options.crossfadeSeconds + frameSeconds,
    crossfadeSeconds: options.crossfadeSeconds,
    audioCrossfaded: hasAudio
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

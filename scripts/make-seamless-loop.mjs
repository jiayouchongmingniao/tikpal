import { spawnSync } from "node:child_process";
import { copyFile, mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_INPUT = "public/assets/output_2560x720-4k.mp4";
const DEFAULT_CROSSFADE_SECONDS = 0.9;
const DEFAULT_FPS = 24;
const DEFAULT_REPEATS = 1;

function printUsage() {
  console.log([
    "Usage: node scripts/make-seamless-loop.mjs [--input <mp4>] [--output <mp4>] [--crossfade <seconds>] [--repeats <count>] [--mute]",
    "",
    "Defaults:",
    `  --input ${DEFAULT_INPUT}`,
    "  --output <input>",
    `  --crossfade ${DEFAULT_CROSSFADE_SECONDS}`,
    `  --repeats ${DEFAULT_REPEATS}`,
    "",
    "--repeats 1 preserves the legacy tail-to-head loop rewrite. Higher values build a longer master from crossfaded source repetitions.",
    "--mute strips the source audio so a separate long scene-audio asset can own playback.",
    "The script keeps the same public asset URL by default, writing a backup under .codex-artifacts first."
  ].join("\n"));
}

function parseArgs(argv) {
  const options = {
    input: DEFAULT_INPUT,
    output: null,
    crossfadeSeconds: DEFAULT_CROSSFADE_SECONDS,
    fps: DEFAULT_FPS,
    repeats: DEFAULT_REPEATS,
    mute: false
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
    if (arg === "--repeats") {
      options.repeats = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--mute") {
      options.mute = true;
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
  if (!Number.isInteger(options.repeats) || options.repeats <= 0) {
    throw new Error("--repeats must be a positive integer");
  }

  return options;
}

function buildRepeatedFilter({ duration, crossfadeSeconds, fps, repeats, hasAudio, mute }) {
  const filterParts = [];
  const videoInputs = [];
  const audioInputs = [];
  for (let index = 0; index < repeats; index += 1) {
    const videoLabel = `v${index}`;
    filterParts.push(`[${index}:v]fps=${fps},format=yuv420p,setpts=PTS-STARTPTS[${videoLabel}]`);
    videoInputs.push(videoLabel);
    if (hasAudio && !mute) {
      const audioLabel = `a${index}`;
      filterParts.push(`[${index}:a]asetpts=PTS-STARTPTS[${audioLabel}]`);
      audioInputs.push(audioLabel);
    }
  }

  let videoOutput = videoInputs[0];
  let audioOutput = audioInputs[0] ?? null;
  let outputDurationSeconds = duration;
  for (let index = 1; index < repeats; index += 1) {
    const nextVideoOutput = `vx${index}`;
    filterParts.push(`[${videoOutput}][${videoInputs[index]}]xfade=transition=fade:duration=${crossfadeSeconds}:offset=${outputDurationSeconds - crossfadeSeconds}[${nextVideoOutput}]`);
    videoOutput = nextVideoOutput;
    if (audioOutput) {
      const nextAudioOutput = `ax${index}`;
      filterParts.push(`[${audioOutput}][${audioInputs[index]}]acrossfade=d=${crossfadeSeconds}:c1=tri:c2=tri[${nextAudioOutput}]`);
      audioOutput = nextAudioOutput;
    }
    outputDurationSeconds += duration - crossfadeSeconds;
  }

  return {
    filter: filterParts.join(";"),
    videoOutput,
    audioOutput,
    outputDurationSeconds
  };
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
  const ffmpegArgs = ["-y", "-hide_banner", "-loglevel", "error"];
  for (let index = 0; index < options.repeats; index += 1) {
    ffmpegArgs.push("-i", input);
  }

  let outputDurationSeconds;
  if (options.repeats === 1) {
    const frameSeconds = 1 / options.fps;
    const cutSeconds = options.crossfadeSeconds * 2;
    const headSeconds = cutSeconds + frameSeconds;
    const transitionOffset = duration - cutSeconds - options.crossfadeSeconds;
    const filterParts = [
      `[0:v]trim=start=${cutSeconds}:end=${duration},setpts=PTS-STARTPTS[mainv]`,
      `[0:v]trim=start=0:end=${headSeconds},setpts=PTS-STARTPTS[headv]`,
      `[mainv][headv]xfade=transition=fade:duration=${options.crossfadeSeconds}:offset=${transitionOffset},fps=${options.fps},format=yuv420p[v]`
    ];
    if (hasAudio && !options.mute) {
      filterParts.push(
        `[0:a]atrim=start=${cutSeconds}:end=${duration},asetpts=PTS-STARTPTS[maina]`,
        `[0:a]atrim=start=0:end=${headSeconds},asetpts=PTS-STARTPTS[heada]`,
        `[maina][heada]acrossfade=d=${options.crossfadeSeconds}:c1=tri:c2=tri[a]`
      );
    }
    ffmpegArgs.push("-filter_complex", filterParts.join(";"), "-map", "[v]");
    ffmpegArgs.push(...(hasAudio && !options.mute ? ["-map", "[a]", "-c:a", "aac", "-b:a", "128k"] : ["-an"]));
    outputDurationSeconds = duration - options.crossfadeSeconds + frameSeconds;
  } else {
    const repeated = buildRepeatedFilter({
      duration,
      crossfadeSeconds: options.crossfadeSeconds,
      fps: options.fps,
      repeats: options.repeats,
      hasAudio,
      mute: options.mute
    });
    ffmpegArgs.push("-filter_complex", repeated.filter, "-map", `[${repeated.videoOutput}]`);
    ffmpegArgs.push(...(repeated.audioOutput ? ["-map", `[${repeated.audioOutput}]`, "-c:a", "aac", "-b:a", "128k"] : ["-an"]));
    outputDurationSeconds = repeated.outputDurationSeconds;
  }

  ffmpegArgs.push(
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
    outputDurationSeconds,
    crossfadeSeconds: options.crossfadeSeconds,
    repeats: options.repeats,
    muted: options.mute,
    audioCrossfaded: hasAudio && !options.mute
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

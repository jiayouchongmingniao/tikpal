import { spawnSync } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const DEFAULT_DURATION_SECONDS = 15 * 60;
const DEFAULT_CROSSFADE_SECONDS = 0.8;

function usage() {
  return [
    "Usage: node scripts/make-scene-ambient-audio.mjs --input <source-audio> --output <scene.ogg> [--duration <seconds>] [--crossfade <seconds>] [--active-seconds <seconds> --quiet-seconds <seconds> --envelope-fade-seconds <seconds>]",
    "",
    "Builds a tail-to-head crossfaded loop unit from a reviewed source recording and renders a long Opus asset.",
    `Defaults: --duration ${DEFAULT_DURATION_SECONDS} --crossfade ${DEFAULT_CROSSFADE_SECONDS}. The optional active/quiet envelope softly alternates the rendered ambience with silence.`
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    input: null,
    output: null,
    durationSeconds: DEFAULT_DURATION_SECONDS,
    crossfadeSeconds: DEFAULT_CROSSFADE_SECONDS,
    activeSeconds: null,
    quietSeconds: null,
    envelopeFadeSeconds: 3
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
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
    if (arg === "--duration") {
      options.durationSeconds = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--crossfade") {
      options.crossfadeSeconds = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--active-seconds") {
      options.activeSeconds = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--quiet-seconds") {
      options.quietSeconds = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--envelope-fade-seconds") {
      options.envelopeFadeSeconds = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.input || !options.output) throw new Error(usage());
  if (!Number.isFinite(options.durationSeconds) || options.durationSeconds <= 0) {
    throw new Error("--duration must be a positive number of seconds");
  }
  if (!Number.isFinite(options.crossfadeSeconds) || options.crossfadeSeconds <= 0) {
    throw new Error("--crossfade must be a positive number of seconds");
  }
  const hasEnvelope = options.activeSeconds !== null || options.quietSeconds !== null;
  if (hasEnvelope && (options.activeSeconds === null || options.quietSeconds === null)) {
    throw new Error("--active-seconds and --quiet-seconds must be used together");
  }
  if (hasEnvelope && (!Number.isFinite(options.activeSeconds) || options.activeSeconds <= options.envelopeFadeSeconds)) {
    throw new Error("--active-seconds must exceed --envelope-fade-seconds");
  }
  if (hasEnvelope && (!Number.isFinite(options.quietSeconds) || options.quietSeconds <= options.envelopeFadeSeconds)) {
    throw new Error("--quiet-seconds must exceed --envelope-fade-seconds");
  }
  if (hasEnvelope && (!Number.isFinite(options.envelopeFadeSeconds) || options.envelopeFadeSeconds <= 0)) {
    throw new Error("--envelope-fade-seconds must be a positive number of seconds");
  }

  return {
    ...options,
    input: path.resolve(options.input),
    output: path.resolve(options.output)
  };
}

function buildActiveQuietEnvelope({ activeSeconds, quietSeconds, envelopeFadeSeconds }) {
  const cycleSeconds = activeSeconds + quietSeconds;
  const fadeOutStart = activeSeconds - envelopeFadeSeconds;
  const fadeInStart = cycleSeconds - envelopeFadeSeconds;
  const phase = `mod(t\\,${cycleSeconds})`;
  return `volume='if(lt(${phase}\\,${fadeOutStart})\\,1\\,if(lt(${phase}\\,${activeSeconds})\\,(${activeSeconds}-${phase})/${envelopeFadeSeconds}\\,if(lt(${phase}\\,${fadeInStart})\\,0\\,(${phase}-${fadeInStart})/${envelopeFadeSeconds})))':eval=frame`;
}

function run(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8"
  });
  if (result.status === 0) return result.stdout ?? "";
  const detail = capture ? `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() : "";
  throw new Error(`${command} failed${detail ? `:\n${detail}` : ""}`);
}

function probe(input) {
  const stdout = run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type",
    "-of", "json",
    input
  ], { capture: true });
  const payload = JSON.parse(stdout);
  const duration = Number(payload.format?.duration);
  const hasAudio = Array.isArray(payload.streams)
    && payload.streams.some((stream) => stream.codec_type === "audio");
  if (!Number.isFinite(duration) || duration <= 0 || !hasAudio) {
    throw new Error(`Input must contain a readable audio stream: ${input}`);
  }
  return { duration };
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { duration } = probe(options.input);
  if (options.crossfadeSeconds * 3 >= duration) {
    throw new Error(`Crossfade ${options.crossfadeSeconds}s is too long for ${duration.toFixed(3)}s audio`);
  }

  const outputDirectory = path.dirname(options.output);
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "tikpal-scene-audio-"));
  const loopUnitPath = path.join(temporaryDirectory, "loop-unit.wav");
  const temporaryOutput = path.join(temporaryDirectory, path.basename(options.output));
  const backupPath = await exists(options.output)
    ? path.resolve(".codex-artifacts", "media-backups", `${path.basename(options.output)}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`)
    : null;
  const cutSeconds = options.crossfadeSeconds * 2;
  const headSeconds = cutSeconds + (1 / 48_000);
  const loopUnitDurationSeconds = duration - options.crossfadeSeconds + (1 / 48_000);
  const envelope = options.activeSeconds === null
    ? null
    : buildActiveQuietEnvelope(options);

  try {
    run("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel", "error",
      "-i", options.input,
      "-filter_complex",
      `[0:a]atrim=start=${cutSeconds}:end=${duration},asetpts=PTS-STARTPTS[main];[0:a]atrim=start=0:end=${headSeconds},asetpts=PTS-STARTPTS[head];[main][head]acrossfade=d=${options.crossfadeSeconds}:c1=tri:c2=tri,loudnorm=I=-23:TP=-1.5:LRA=7[loop]`,
      "-map", "[loop]",
      "-c:a", "pcm_s16le",
      "-ar", "48000",
      "-ac", "2",
      loopUnitPath
    ]);

    run("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel", "error",
      "-stream_loop", "-1",
      "-i", loopUnitPath,
      "-t", String(options.durationSeconds),
      "-map", "0:a:0",
      ...(envelope ? ["-af", envelope] : []),
      "-c:a", "libopus",
      "-b:a", "96k",
      "-vbr", "on",
      "-compression_level", "5",
      "-application", "audio",
      "-ar", "48000",
      "-ac", "2",
      temporaryOutput
    ]);

    await stat(temporaryOutput);
    if (backupPath) {
      await mkdir(path.dirname(backupPath), { recursive: true });
      await copyFile(options.output, backupPath);
    }
    await mkdir(outputDirectory, { recursive: true });
    await rename(temporaryOutput, options.output);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  console.log(JSON.stringify({
    input: options.input,
    output: options.output,
    backup: backupPath,
    sourceDurationSeconds: duration,
    loopUnitDurationSeconds,
    outputDurationSeconds: options.durationSeconds,
    crossfadeSeconds: options.crossfadeSeconds,
    activeSeconds: options.activeSeconds,
    quietSeconds: options.quietSeconds,
    envelopeFadeSeconds: options.activeSeconds === null ? null : options.envelopeFadeSeconds,
    codec: "opus",
    bitrate: "96k"
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const DEFAULT_SAMPLE_RATE = 44_100;
const DEFAULT_CHANNELS = 2;
const DEFAULT_BAND_COUNT = 32;
const DEFAULT_SECONDS = 0.24;
const DEFAULT_TIMEOUT_MS = 1_400;
const MAX_FFT_SIZE = 4_096;
const MIN_CAPTURE_BYTES = 1_024;

function readNumber(name, fallback, { min = 0, max = Number.POSITIVE_INFINITY } = {}) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function clampUnit(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function parseDevices() {
  const explicit = process.env.TIKPAL_HIFI_SPECTRUM_DEVICES ?? process.env.TIKPAL_HIFI_SPECTRUM_DEVICE ?? "";
  if (explicit.trim()) {
    return explicit.split(/[\s,]+/).map((device) => device.trim()).filter(Boolean);
  }
  return ["plughw:Loopback,1,0", "hw:Loopback,1,0", "plughw:Loopback,1", "hw:Loopback,1", "default"];
}

function buildCaptureCommands({ sampleRate, channels, seconds }) {
  const captureCommand = process.env.TIKPAL_HIFI_SPECTRUM_CAPTURE_COMMAND ?? "";
  if (captureCommand.trim()) {
    return [{ label: "custom", command: captureCommand }];
  }

  const ffmpegBin = process.env.TIKPAL_HIFI_SPECTRUM_FFMPEG_BIN ?? process.env.TIKPAL_FFMPEG_BIN ?? "ffmpeg";
  const arecordBin = process.env.TIKPAL_HIFI_SPECTRUM_ARECORD_BIN ?? "arecord";
  const timeoutSeconds = Math.max(seconds + 0.15, 0.2).toFixed(2);
  return parseDevices().flatMap((device) => [
    {
      label: `ffmpeg:${device}`,
      command: [
        `command -v ${shellQuote(ffmpegBin)} >/dev/null 2>&1 &&`,
        `${shellQuote(ffmpegBin)} -hide_banner -loglevel error -nostdin`,
        "-f alsa",
        `-ac ${channels}`,
        `-ar ${sampleRate}`,
        `-i ${shellQuote(device)}`,
        `-t ${seconds}`,
        "-vn -f s16le -acodec pcm_s16le -"
      ].join(" ")
    },
    {
      label: `arecord:${device}`,
      command: [
        "command -v timeout >/dev/null 2>&1 &&",
        `command -v ${shellQuote(arecordBin)} >/dev/null 2>&1 &&`,
        `timeout ${timeoutSeconds}s ${shellQuote(arecordBin)} -q`,
        `-D ${shellQuote(device)}`,
        "-f S16_LE",
        `-c ${channels}`,
        `-r ${sampleRate}`,
        "-t raw"
      ].join(" ")
    }
  ]);
}

function capturePcm(options) {
  const errors = [];
  for (const candidate of buildCaptureCommands(options)) {
    const result = spawnSync("sh", ["-lc", candidate.command], {
      encoding: "buffer",
      maxBuffer: 1024 * 512,
      timeout: options.timeoutMs
    });
    const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0);
    if (stdout.length >= MIN_CAPTURE_BYTES) {
      return stdout;
    }
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8").trim() : "";
    const reason = result.error?.message ?? stderr ?? `exit ${result.status ?? "unknown"}`;
    errors.push(`${candidate.label}: ${reason}`);
  }
  throw new Error(`Hi-Fi spectrum capture failed; checked ${errors.join("; ")}`);
}

function readInt16(buffer, offset) {
  if (offset + 2 > buffer.length) return 0;
  return buffer.readInt16LE(offset) / 32768;
}

function parseWav(buffer) {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    return null;
  }

  let cursor = 12;
  let format = null;
  let data = null;
  while (cursor + 8 <= buffer.length) {
    const id = buffer.toString("ascii", cursor, cursor + 4);
    const size = buffer.readUInt32LE(cursor + 4);
    const start = cursor + 8;
    const end = Math.min(start + size, buffer.length);
    if (id === "fmt " && size >= 16) {
      format = {
        audioFormat: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        bitsPerSample: buffer.readUInt16LE(start + 14)
      };
    } else if (id === "data") {
      data = buffer.subarray(start, end);
    }
    cursor = end + (size % 2);
  }

  if (!format || !data || format.audioFormat !== 1 || format.bitsPerSample !== 16) {
    return null;
  }
  return { buffer: data, channels: format.channels, sampleRate: format.sampleRate };
}

function highestPowerOfTwo(value) {
  let size = 1;
  while (size * 2 <= value) {
    size *= 2;
  }
  return size;
}

function fft(real, imag) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  for (let length = 2; length <= n; length <<= 1) {
    const angle = -2 * Math.PI / length;
    const wlenReal = Math.cos(angle);
    const wlenImag = Math.sin(angle);
    for (let i = 0; i < n; i += length) {
      let wReal = 1;
      let wImag = 0;
      for (let j = 0; j < length / 2; j += 1) {
        const uReal = real[i + j];
        const uImag = imag[i + j];
        const vReal = real[i + j + length / 2] * wReal - imag[i + j + length / 2] * wImag;
        const vImag = real[i + j + length / 2] * wImag + imag[i + j + length / 2] * wReal;
        real[i + j] = uReal + vReal;
        imag[i + j] = uImag + vImag;
        real[i + j + length / 2] = uReal - vReal;
        imag[i + j + length / 2] = uImag - vImag;
        const nextReal = wReal * wlenReal - wImag * wlenImag;
        wImag = wReal * wlenImag + wImag * wlenReal;
        wReal = nextReal;
      }
    }
  }
}

function analyzePcm(inputBuffer, options) {
  const wav = parseWav(inputBuffer);
  const buffer = wav?.buffer ?? inputBuffer;
  const sampleRate = wav?.sampleRate ?? options.sampleRate;
  const channels = wav?.channels ?? options.channels;
  const bytesPerFrame = channels * 2;
  const totalFrames = Math.floor(buffer.length / bytesPerFrame);
  const fftSize = highestPowerOfTwo(Math.min(totalFrames, MAX_FFT_SIZE));
  if (fftSize < 256) {
    throw new Error("Hi-Fi spectrum capture did not contain enough PCM samples");
  }

  let leftPeak = 0;
  let rightPeak = 0;
  for (let frame = 0; frame < totalFrames; frame += 1) {
    const offset = frame * bytesPerFrame;
    const left = Math.abs(readInt16(buffer, offset));
    const right = Math.abs(readInt16(buffer, offset + (channels > 1 ? 2 : 0)));
    leftPeak = Math.max(leftPeak, left);
    rightPeak = Math.max(rightPeak, channels > 1 ? right : left);
  }

  const startFrame = totalFrames - fftSize;
  const real = new Array(fftSize);
  const imag = new Array(fftSize).fill(0);
  for (let i = 0; i < fftSize; i += 1) {
    const frame = startFrame + i;
    const offset = frame * bytesPerFrame;
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += readInt16(buffer, offset + channel * 2);
    }
    const mono = sum / channels;
    const windowValue = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1));
    real[i] = mono * windowValue;
  }

  fft(real, imag);

  const nyquist = sampleRate / 2;
  const minHz = readNumber("TIKPAL_HIFI_SPECTRUM_MIN_HZ", 45, { min: 1, max: nyquist });
  const maxHz = Math.max(minHz, Math.min(readNumber("TIKPAL_HIFI_SPECTRUM_MAX_HZ", 18_000, { min: minHz, max: nyquist }), nyquist));
  const magnitudes = real.slice(0, fftSize / 2).map((value, index) => Math.hypot(value, imag[index]) / (fftSize / 2));
  const bands = [];
  for (let band = 0; band < options.bandCount; band += 1) {
    const low = minHz * Math.pow(maxHz / minHz, band / options.bandCount);
    const high = minHz * Math.pow(maxHz / minHz, (band + 1) / options.bandCount);
    const lowBin = Math.max(1, Math.floor(low * fftSize / sampleRate));
    const highBin = Math.max(lowBin + 1, Math.ceil(high * fftSize / sampleRate));
    let energy = 0;
    let count = 0;
    for (let bin = lowBin; bin < Math.min(highBin, magnitudes.length); bin += 1) {
      energy += magnitudes[bin] * magnitudes[bin];
      count += 1;
    }
    const rms = Math.sqrt(energy / Math.max(1, count));
    bands.push(clampUnit(Math.log1p(rms * 70) / Math.log1p(70)));
  }

  return {
    bands,
    peaks: {
      left: clampUnit(leftPeak),
      right: clampUnit(rightPeak)
    },
    bandCount: options.bandCount,
    updatedAt: new Date().toISOString()
  };
}

try {
  const options = {
    sampleRate: Math.round(readNumber("TIKPAL_HIFI_SPECTRUM_SAMPLE_RATE", DEFAULT_SAMPLE_RATE, { min: 8_000, max: 192_000 })),
    channels: Math.round(readNumber("TIKPAL_HIFI_SPECTRUM_CHANNELS", DEFAULT_CHANNELS, { min: 1, max: 8 })),
    bandCount: Math.round(readNumber("TIKPAL_HIFI_SPECTRUM_BANDS", DEFAULT_BAND_COUNT, { min: 8, max: 64 })),
    seconds: readNumber("TIKPAL_HIFI_SPECTRUM_SECONDS", DEFAULT_SECONDS, { min: 0.05, max: 1 }),
    timeoutMs: Math.round(readNumber("TIKPAL_HIFI_SPECTRUM_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, { min: 250, max: 5_000 }))
  };
  const frame = analyzePcm(capturePcm(options), options);
  process.stdout.write(`${JSON.stringify(frame)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Hi-Fi spectrum capture failed"}\n`);
  process.exit(1);
}

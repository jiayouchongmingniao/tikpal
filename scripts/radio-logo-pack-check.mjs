#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const logoDir = resolve(root, "public/assets/radio-logos");
const manifest = JSON.parse(readFileSync(resolve(logoDir, "manifest.json"), "utf8"));
const presets = new Map(
  [...readFileSync(resolve(root, "deploy/moode/tikpal-radio-presets-sync.sh"), "utf8").matchAll(
    /^\s*"([0-9]+)\|[^|]*\|([^|]+)\|/gm
  )].map(([, id, station]) => [`radio-${id}`, station])
);
const aliases = new Map(
  [...readFileSync(resolve(root, "server/index.mjs"), "utf8").matchAll(
    /^\s*\["([^"]+)", "([^"]+)"\],$/gm
  )].map(([, station, file]) => [station, file])
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(manifest.schemaVersion === 1, "unsupported radio logo manifest schema");
assert(manifest.assets.length === 36, `expected 36 curated logo mappings, got ${manifest.assets.length}`);
assert(new Set(manifest.assets.map(({ stationId }) => stationId)).size === 36, "duplicate station IDs");

for (const asset of manifest.assets) {
  assert(presets.get(asset.stationId) === asset.station, `${asset.stationId}: station does not match curated preset`);
  assert(aliases.get(asset.station) === asset.file, `${asset.stationId}: file does not match RADIO_LOGO_ALIASES`);
  assert(/^https:\/\//.test(asset.sourceUrl) && /^https:\/\//.test(asset.homepage), `${asset.stationId}: missing HTTPS source record`);

  const imagePath = resolve(logoDir, asset.file);
  assert(existsSync(imagePath), `${asset.stationId}: missing ${asset.file}`);
  const image = readFileSync(imagePath);
  assert(image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff, `${asset.stationId}: ${asset.file} is not a JPEG`);
  assert(
    createHash("sha256").update(image).digest("hex") === asset.sha256,
    `${asset.stationId}: checksum mismatch for ${asset.file}`
  );

  const decoded = spawnSync(process.env.FFMPEG_BIN ?? "ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-i", imagePath, "-frames:v", "1", "-f", "null", "-"
  ], { encoding: "utf8" });
  assert(decoded.status === 0, `${asset.stationId}: cannot decode ${asset.file}: ${decoded.stderr.trim()}`);
}

console.log(`radio logo pack OK: ${manifest.assets.length} curated mappings, ${new Set(manifest.assets.map(({ file }) => file)).size} image files`);

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const X86_ARCHITECTURES = new Set(["x64", "ia32"]);
const X86_CPU_HWMON_NAMES = new Set(["coretemp", "k10temp", "x86_pkg_temp", "zenpower"]);
const THERMAL_ZONE_CPU_PATTERN = /cpu|coretemp|k10temp|package|pkg|soc/i;

function parseMilliCelsius(value) {
  const milliCelsius = Number(String(value ?? "").trim());
  if (!Number.isFinite(milliCelsius) || milliCelsius <= 0) return null;
  return Math.round(milliCelsius / 1000);
}

async function readText(path) {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch {
    return "";
  }
}

async function readDirectory(path) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

function selectHottest(candidates) {
  return candidates.reduce((hottest, candidate) => (
    hottest === null || candidate.celsius > hottest.celsius ? candidate : hottest
  ), null);
}

export function getCpuThermalPolicy(architecture = process.arch) {
  return X86_ARCHITECTURES.has(architecture)
    ? { pauseCelsius: 90, resumeCelsius: 80 }
    : { pauseCelsius: 76, resumeCelsius: 68 };
}

export async function readCpuTemperatureFromSysfs({ sysfsRoot = "/sys", architecture = process.arch } = {}) {
  const hwmonRoot = join(sysfsRoot, "class", "hwmon");
  const hwmonEntries = await readDirectory(hwmonRoot);
  const hwmonCandidates = [];

  for (const entry of hwmonEntries) {
    if (!entry.name.startsWith("hwmon")) continue;
    const directory = join(hwmonRoot, entry.name);
    const chip = await readText(join(directory, "name"));
    if (!X86_ARCHITECTURES.has(architecture) || !X86_CPU_HWMON_NAMES.has(chip)) continue;

    const sensorEntries = await readDirectory(directory);
    for (const sensorEntry of sensorEntries) {
      const match = sensorEntry.name.match(/^temp(\d+)_input$/);
      if (!match) continue;
      const celsius = parseMilliCelsius(await readText(join(directory, sensorEntry.name)));
      if (celsius === null) continue;
      const label = await readText(join(directory, `temp${match[1]}_label`));
      hwmonCandidates.push({
        celsius,
        source: label ? `${chip}:${label}` : chip
      });
    }
  }

  const hwmonTemperature = selectHottest(hwmonCandidates);
  if (hwmonTemperature !== null) return hwmonTemperature;

  const thermalRoot = join(sysfsRoot, "class", "thermal");
  const thermalEntries = await readDirectory(thermalRoot);
  const zoneCandidates = [];

  for (const entry of thermalEntries) {
    if (!entry.name.startsWith("thermal_zone")) continue;
    const directory = join(thermalRoot, entry.name);
    const type = await readText(join(directory, "type"));
    if (X86_ARCHITECTURES.has(architecture) && !THERMAL_ZONE_CPU_PATTERN.test(type)) continue;
    if (!X86_ARCHITECTURES.has(architecture) && type && !THERMAL_ZONE_CPU_PATTERN.test(type)) continue;
    const celsius = parseMilliCelsius(await readText(join(directory, "temp")));
    if (celsius === null) continue;
    zoneCandidates.push({
      celsius,
      source: type || entry.name
    });
  }

  const zoneTemperature = selectHottest(zoneCandidates);
  if (zoneTemperature !== null) return zoneTemperature;

  if (!X86_ARCHITECTURES.has(architecture)) {
    const fallbackTemperature = parseMilliCelsius(await readText(join(thermalRoot, "thermal_zone0", "temp")));
    if (fallbackTemperature !== null) {
      return { celsius: fallbackTemperature, source: "thermal_zone0" };
    }
  }

  return null;
}

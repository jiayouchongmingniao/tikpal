export interface HifiThemePalette {
  bgA: string;
  bgB: string;
  bgC: string;
  accent: string;
  accentSoft: string;
  accentGlow: string;
  title: string;
  lyric: string;
  lyricSoft: string;
  meta: string;
}

const HASH_PALETTES = [
  { base: 184, accent: 43, deep: 214 },
  { base: 168, accent: 49, deep: 202 },
  { base: 207, accent: 36, deep: 232 },
  { base: 193, accent: 51, deep: 225 }
];

function hashSeed(parts: string[]) {
  let hash = 2166136261;
  for (const part of parts) {
    for (let index = 0; index < part.length; index += 1) {
      hash ^= part.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return hash >>> 0;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function hsl(hue: number, saturation: number, lightness: number) {
  return `hsl(${Math.round(hue)} ${Math.round(saturation)}% ${Math.round(lightness)}%)`;
}

function hsla(hue: number, saturation: number, lightness: number, alpha: number) {
  return `hsl(${Math.round(hue)} ${Math.round(saturation)}% ${Math.round(lightness)}% / ${alpha})`;
}

function truncateSvgText(value: string, maxLength: number) {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function rgbToHsl(red: number, green: number, blue: number) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) {
    return { hue: 200, saturation: 0, lightness: lightness * 100 };
  }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (max === r) hue = ((g - b) / delta) % 6;
  if (max === g) hue = (b - r) / delta + 2;
  if (max === b) hue = (r - g) / delta + 4;

  return {
    hue: (hue * 60 + 360) % 360,
    saturation: saturation * 100,
    lightness: lightness * 100
  };
}

export function buildHifiSeedTheme(parts: string[]): HifiThemePalette {
  const seed = hashSeed(parts);
  const preset = HASH_PALETTES[seed % HASH_PALETTES.length];
  const base = (preset.base + (seed % 18) - 9 + 360) % 360;
  const accent = (preset.accent + ((seed >>> 8) % 14) - 7 + 360) % 360;
  const deep = (preset.deep + ((seed >>> 16) % 18) - 9 + 360) % 360;

  return {
    bgA: hsl(deep, 64, 5),
    bgB: hsl(base, 48, 15),
    bgC: hsl((base + 34) % 360, 42, 8),
    accent: hsl(accent, 86, 68),
    accentSoft: hsla(accent, 78, 64, 0.22),
    accentGlow: hsla(accent, 88, 64, 0.36),
    title: hsl((base + 8) % 360, 34, 94),
    lyric: hsl(accent, 92, 78),
    lyricSoft: hsla((base + 6) % 360, 36, 88, 0.56),
    meta: hsla((base + 10) % 360, 34, 82, 0.7)
  };
}

function buildSampledTheme(accentRgb: [number, number, number], averageRgb: [number, number, number], fallback: HifiThemePalette): HifiThemePalette {
  const accentHsl = rgbToHsl(accentRgb[0], accentRgb[1], accentRgb[2]);
  const averageHsl = rgbToHsl(averageRgb[0], averageRgb[1], averageRgb[2]);
  const accentHue = accentHsl.saturation > 8 ? accentHsl.hue : rgbToHsl(averageRgb[0], averageRgb[1], averageRgb[2]).hue;
  const baseHue = averageHsl.saturation > 8 ? averageHsl.hue : accentHue;

  return {
    bgA: hsl((baseHue + 210) % 360, 58, 5),
    bgB: hsl(baseHue, clamp(averageHsl.saturation + 12, 34, 62), 13),
    bgC: hsl((baseHue + 28) % 360, clamp(averageHsl.saturation + 2, 28, 54), 8),
    accent: hsl(accentHue, clamp(accentHsl.saturation + 16, 56, 88), clamp(accentHsl.lightness + 16, 58, 75)),
    accentSoft: hsla(accentHue, clamp(accentHsl.saturation + 10, 52, 82), 60, 0.22),
    accentGlow: hsla(accentHue, clamp(accentHsl.saturation + 14, 58, 88), 62, 0.34),
    title: hsl((baseHue + 4) % 360, 32, 94),
    lyric: hsl(accentHue, clamp(accentHsl.saturation + 18, 62, 92), 78),
    lyricSoft: hsla((baseHue + 6) % 360, 34, 88, 0.56),
    meta: fallback.meta
  };
}

function canSampleCoverUrl(albumArtUrl: string) {
  if (albumArtUrl.startsWith("data:")) return true;
  try {
    const parsed = new URL(albumArtUrl, window.location.href);
    return parsed.origin === window.location.origin;
  } catch {
    return false;
  }
}

export async function buildHifiCoverTheme(albumArtUrl: string, seedParts: string[]): Promise<HifiThemePalette> {
  const fallback = buildHifiSeedTheme(seedParts);
  if (!albumArtUrl || typeof window === "undefined" || !canSampleCoverUrl(albumArtUrl)) {
    return fallback;
  }

  return await new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const size = 28;
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          resolve(fallback);
          return;
        }

        context.drawImage(image, 0, 0, size, size);
        const data = context.getImageData(0, 0, size, size).data;
        let totalRed = 0;
        let totalGreen = 0;
        let totalBlue = 0;
        let total = 0;
        let bestScore = -1;
        let accent: [number, number, number] = [210, 178, 85];

        for (let index = 0; index < data.length; index += 4) {
          const alpha = data[index + 3] / 255;
          if (alpha < 0.35) continue;
          const red = data[index];
          const green = data[index + 1];
          const blue = data[index + 2];
          const color = rgbToHsl(red, green, blue);
          const lightnessScore = 1 - Math.abs(color.lightness - 54) / 54;
          const score = color.saturation * 1.2 + lightnessScore * 34;

          totalRed += red * alpha;
          totalGreen += green * alpha;
          totalBlue += blue * alpha;
          total += alpha;

          if (score > bestScore && color.lightness > 16 && color.lightness < 84) {
            bestScore = score;
            accent = [red, green, blue];
          }
        }

        if (total <= 0) {
          resolve(fallback);
          return;
        }

        resolve(buildSampledTheme(accent, [
          totalRed / total,
          totalGreen / total,
          totalBlue / total
        ], fallback));
      } catch {
        resolve(fallback);
      }
    };
    image.onerror = () => resolve(fallback);
    image.src = albumArtUrl;
  });
}

export function hifiThemeToCssVariables(palette: HifiThemePalette) {
  return {
    "--hifi-theme-bg-a": palette.bgA,
    "--hifi-theme-bg-b": palette.bgB,
    "--hifi-theme-bg-c": palette.bgC,
    "--hifi-theme-accent": palette.accent,
    "--hifi-theme-accent-soft": palette.accentSoft,
    "--hifi-theme-accent-glow": palette.accentGlow,
    "--hifi-theme-title": palette.title,
    "--hifi-theme-lyric": palette.lyric,
    "--hifi-theme-lyric-soft": palette.lyricSoft,
    "--hifi-theme-meta": palette.meta
  };
}

export function buildBluetoothGeneratedCoverArtUrl(title: string, artist: string, album: string) {
  const palette = buildHifiSeedTheme([title, artist, album, "bluetooth"]);
  const safeTitle = escapeXml(truncateSvgText(title || "Bluetooth Audio", 22));
  const safeArtist = escapeXml(truncateSvgText(artist || "Unknown Artist", 28));
  const safeAlbum = escapeXml(truncateSvgText(album || "Bluetooth Source", 28));

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
  <defs>
    <radialGradient id="record" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.92)"/>
      <stop offset="13%" stop-color="${palette.accent}"/>
      <stop offset="16%" stop-color="rgba(12,16,22,0.98)"/>
      <stop offset="100%" stop-color="rgba(3,6,10,0.98)"/>
    </radialGradient>
    <linearGradient id="poster" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette.bgB}"/>
      <stop offset="58%" stop-color="${palette.bgC}"/>
      <stop offset="100%" stop-color="rgba(3,6,10,0.98)"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="1200" fill="url(#poster)"/>
  <circle cx="600" cy="420" r="250" fill="url(#record)" opacity="0.54"/>
  <circle cx="600" cy="420" r="196" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="2"/>
  <circle cx="600" cy="420" r="132" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="2"/>
  <circle cx="600" cy="420" r="46" fill="rgba(8,12,18,0.84)" stroke="rgba(255,255,255,0.16)" stroke-width="3"/>
  <text x="600" y="220" text-anchor="middle" fill="${palette.accent}" font-family="SF Pro Display, Inter, Helvetica Neue, sans-serif" font-size="42" font-weight="800" letter-spacing="3">BLUETOOTH</text>
  <text x="600" y="760" text-anchor="middle" fill="${palette.title}" font-family="SF Pro Display, Inter, Helvetica Neue, sans-serif" font-size="74" font-weight="760">${safeTitle}</text>
  <text x="600" y="835" text-anchor="middle" fill="rgba(255,255,255,0.76)" font-family="SF Pro Text, Inter, Helvetica Neue, sans-serif" font-size="40" font-weight="620">${safeArtist}</text>
  <text x="600" y="895" text-anchor="middle" fill="rgba(255,255,255,0.56)" font-family="SF Pro Text, Inter, Helvetica Neue, sans-serif" font-size="34" font-weight="560">${safeAlbum}</text>
  <path d="M450 986h300" stroke="${palette.accent}" stroke-width="7" stroke-linecap="round" opacity="0.84"/>
</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

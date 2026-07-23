import type { FontTheme } from "./types";

const COVER_FONT_FAMILIES: Record<FontTheme, string> = {
  system: "SF Pro Display, SF Pro Text, Inter, Helvetica Neue, PingFang SC, sans-serif",
  hardware: "Avenir Next, DIN Alternate, DIN Condensed, SF Pro Display, PingFang SC, sans-serif",
  precision: "SF Mono, Roboto Mono, IBM Plex Mono, JetBrains Mono, PingFang SC, monospace",
  sans: "Inter, SF Pro Display, Helvetica Neue, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif",
  serif: "Iowan Old Style, Palatino Linotype, Book Antiqua, Georgia, Times New Roman, Songti SC, serif",
  mono: "SF Mono, IBM Plex Mono, JetBrains Mono, Cascadia Mono, Fira Code, Source Han Mono SC, monospace"
};

function hashSeed(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function truncateSvgText(value: string, maxLength: number) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function buildGeneratedCoverArtUrl(title: string, artist: string, album: string, fontTheme: FontTheme = "system") {
  const seed = hashSeed(`${title}|${artist}|${album}`);
  const hueA = seed % 360;
  const hueB = (hueA + 72 + (seed % 90)) % 360;
  const fontFamily = escapeXml(COVER_FONT_FAMILIES[fontTheme]);
  const safeTitle = escapeXml(truncateSvgText(title || "Not Playing", 26));
  const safeArtist = escapeXml(truncateSvgText(artist || "Unknown Artist", 32));
  const safeAlbum = escapeXml(truncateSvgText(album || "MPD Queue", 32));
  const label = (album || title || "TK")
    .split(/\s+/)
    .map((word) => word[0] ?? "")
    .join("")
    .slice(0, 3)
    .toUpperCase();

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hueA} 42% 24%)"/>
      <stop offset="58%" stop-color="hsl(${hueB} 36% 18%)"/>
      <stop offset="100%" stop-color="hsl(${hueB} 32% 11%)"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="1200" fill="url(#bg)"/>
  <circle cx="860" cy="330" r="250" fill="rgba(255,255,255,0.08)"/>
  <circle cx="310" cy="900" r="250" fill="rgba(0,0,0,0.18)"/>
  <rect x="100" y="100" width="1000" height="1000" rx="72" fill="rgba(12,16,24,0.24)" stroke="rgba(255,255,255,0.12)"/>
  <text x="600" y="520" text-anchor="middle" fill="rgba(255,255,255,0.94)" font-family="${fontFamily}" font-size="220" font-weight="700">${escapeXml(label || "TK")}</text>
  <text x="130" y="860" fill="rgba(255,255,255,0.96)" font-family="${fontFamily}" font-size="80" font-weight="700">${safeTitle}</text>
  <text x="130" y="935" fill="rgba(255,255,255,0.78)" font-family="${fontFamily}" font-size="46">${safeArtist}</text>
  <text x="130" y="995" fill="rgba(255,255,255,0.62)" font-family="${fontFamily}" font-size="38">${safeAlbum}</text>
</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

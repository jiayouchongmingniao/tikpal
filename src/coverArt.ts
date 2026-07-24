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
  const safeTitle = escapeXml(truncateSvgText(title || "Not Playing", 22));
  const safeArtist = escapeXml(truncateSvgText(artist || "Unknown Artist", 28));
  const safeAlbum = escapeXml(truncateSvgText(album || "MPD Queue", 28));
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
  <circle cx="600" cy="420" r="230" fill="rgba(255,255,255,0.055)"/>
  <circle cx="600" cy="420" r="150" fill="rgba(0,0,0,0.12)"/>
  <text x="600" y="490" text-anchor="middle" fill="rgba(255,255,255,0.94)" font-family="${fontFamily}" font-size="210" font-weight="700">${escapeXml(label || "TK")}</text>
  <path d="M430 640h340" stroke="rgba(255,255,255,0.2)" stroke-width="5" stroke-linecap="round"/>
  <text x="600" y="780" text-anchor="middle" fill="rgba(255,255,255,0.96)" font-family="${fontFamily}" font-size="68" font-weight="700">${safeTitle}</text>
  <text x="600" y="850" text-anchor="middle" fill="rgba(255,255,255,0.72)" font-family="${fontFamily}" font-size="40">${safeArtist}</text>
  <text x="600" y="908" text-anchor="middle" fill="rgba(255,255,255,0.54)" font-family="${fontFamily}" font-size="34">${safeAlbum}</text>
</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

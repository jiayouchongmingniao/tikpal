import type { FontTheme } from "./types";

const COVER_FONT_FAMILIES: Record<FontTheme, string> = {
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

export function buildGeneratedCoverArtUrl(title: string, artist: string, album: string, fontTheme: FontTheme = "sans") {
  const seed = hashSeed(`${title}|${artist}|${album}`);
  const hueA = seed % 360;
  const hueB = (hueA + 72 + (seed % 90)) % 360;
  const fontFamily = escapeXml(COVER_FONT_FAMILIES[fontTheme]);
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
      <stop offset="0%" stop-color="hsl(${hueA} 72% 58%)"/>
      <stop offset="100%" stop-color="hsl(${hueB} 68% 18%)"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="1200" rx="88" fill="url(#bg)"/>
  <circle cx="920" cy="280" r="220" fill="rgba(255,255,255,0.12)"/>
  <circle cx="300" cy="920" r="260" fill="rgba(0,0,0,0.18)"/>
  <rect x="100" y="100" width="1000" height="1000" rx="72" fill="rgba(12,16,24,0.28)" stroke="rgba(255,255,255,0.16)"/>
  <text x="600" y="520" text-anchor="middle" fill="rgba(255,255,255,0.94)" font-family="${fontFamily}" font-size="220" font-weight="700">${escapeXml(label || "TK")}</text>
  <text x="130" y="860" fill="rgba(255,255,255,0.96)" font-family="${fontFamily}" font-size="80" font-weight="700">${escapeXml(title || "Not Playing")}</text>
  <text x="130" y="935" fill="rgba(255,255,255,0.78)" font-family="${fontFamily}" font-size="46">${escapeXml(artist || "Unknown Artist")}</text>
  <text x="130" y="995" fill="rgba(255,255,255,0.62)" font-family="${fontFamily}" font-size="38">${escapeXml(album || "MPD Queue")}</text>
</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

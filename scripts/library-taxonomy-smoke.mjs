import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const MUSIC_ROOT = path.join(ROOT, "public", "assets", "music");
const MANIFEST_PATH = path.join(MUSIC_ROOT, "_metadata", "library_manifest.csv");
const PLAYLIST_DIR = path.join(MUSIC_ROOT, "_playlists");
const PLAYLIST_INDEX_PATH = path.join(MUSIC_ROOT, "_metadata", "playlist_index.csv");

const TAXONOMY = {
  Focus: {
    "Lo-fi / Ambient": "Lo-fi Ambient",
    "Classical / Piano": "Classical Piano",
    "Binaural / Alpha / Theta": "Binaural Alpha Theta",
    "White Noise / Brown Noise": "White Noise Brown Noise"
  },
  Meditation: {
    "Guided Meditation": "Guided Meditation",
    "Breathing": "Breathing",
    "Singing Bowl": "Singing Bowl",
    "Nature Sounds": "Nature Sounds"
  },
  Rest: {
    "Nap": "Nap",
    "Sleep": "Sleep",
    "Rain / Ocean / Forest": "Rain Ocean Forest",
    "Deep Sleep Long Tracks": "Deep Sleep Long Tracks"
  }
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseCsvRows(text) {
  const rows = [];
  let currentRow = [];
  let currentCell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === "\"") {
      if (inQuotes && nextChar === "\"") {
        currentCell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") index += 1;
      currentRow.push(currentCell);
      if (currentRow.some((cell) => cell.trim().length > 0)) rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      continue;
    }

    currentCell += char;
  }

  currentRow.push(currentCell);
  if (currentRow.some((cell) => cell.trim().length > 0)) rows.push(currentRow);

  const [headerRow, ...dataRows] = rows;
  const headers = headerRow.map((header) => header.replace(/^\uFEFF/, "").trim());
  return dataRows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

async function assertFile(relativePath, label) {
  const absolutePath = path.resolve(MUSIC_ROOT, ...relativePath.split("/"));
  assert(absolutePath.startsWith(`${MUSIC_ROOT}${path.sep}`), `${label} escapes music root: ${relativePath}`);
  const info = await stat(absolutePath);
  assert(info.isFile(), `${label} is not a file: ${relativePath}`);
}

async function main() {
  const manifestRows = parseCsvRows(await readFile(MANIFEST_PATH, "utf8"));
  assert(manifestRows.length === 39, `expected 39 local tracks, found ${manifestRows.length}`);

  for (const row of manifestRows) {
    const safeSubdir = TAXONOMY[row.category_level_1]?.[row.category_level_2];
    assert(safeSubdir, `unexpected taxonomy bucket for ${row.id}: ${row.category_level_1}/${row.category_level_2}`);

    const expectedPrefix = `${row.category_level_1}/${safeSubdir}/`;
    assert(row.final_relative_path.startsWith(expectedPrefix), `${row.id} final path should start with ${expectedPrefix}`);
    assert(row.cover_relative_path === `${expectedPrefix}folder.jpg`, `${row.id} cover path should use ${expectedPrefix}folder.jpg`);
    await assertFile(row.final_relative_path, `${row.id} final_relative_path`);
    await assertFile(row.cover_relative_path, `${row.id} cover_relative_path`);
  }

  const playlistIndexRows = parseCsvRows(await readFile(PLAYLIST_INDEX_PATH, "utf8"));
  const indexedPlaylists = new Set(playlistIndexRows.map((row) => row.file_name));
  const playlistFiles = (await readdir(PLAYLIST_DIR)).filter((file) => file.endsWith(".m3u"));
  for (const file of playlistFiles) {
    assert(indexedPlaylists.has(file), `playlist is missing from playlist_index.csv: ${file}`);
    const playlistText = await readFile(path.join(PLAYLIST_DIR, file), "utf8");
    for (const line of playlistText.split(/\r?\n/)) {
      const entry = line.trim();
      if (!entry || entry.startsWith("#")) continue;
      const absolutePath = path.resolve(PLAYLIST_DIR, entry);
      assert(absolutePath.startsWith(`${MUSIC_ROOT}${path.sep}`), `playlist entry escapes music root: ${file} -> ${entry}`);
      const info = await stat(absolutePath);
      assert(info.isFile(), `playlist entry is missing: ${file} -> ${entry}`);
    }
  }

  console.log("library taxonomy smoke passed");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

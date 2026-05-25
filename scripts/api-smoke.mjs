import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path, { resolve } from "node:path";

const PORT = Number(process.env.TIKPAL_API_SMOKE_PORT ?? 18787);
const HOST = "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;
const SERVER_READY_TEXT = "tikpal-api mock listening";
const PROVIDER_PORT = Number(process.env.TIKPAL_PROVIDER_SMOKE_PORT ?? 18788);
const PROVIDER_URL = `http://${HOST}:${PROVIDER_PORT}`;
const BLUETOOTH_SCENARIO_PATH = resolve(process.cwd(), ".tmp-api-smoke-bluetooth.txt");
const BLUETOOTH_METADATA_PATH = resolve(process.cwd(), ".tmp-api-smoke-bluetooth-metadata.txt");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  const body = await response.json();
  return { response, body };
}

async function requestBinary(path) {
  const response = await fetch(`${BASE_URL}${path}`);
  const body = Buffer.from(await response.arrayBuffer());
  return { response, body };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const { response, body } = await request("/api/v1/health");
      if (response.ok && body.ok === true) return;
    } catch {
      // Server is still starting.
    }
    await wait(100);
  }
  throw new Error("API did not become healthy");
}

async function waitForOutput(text) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (outputBuffer.includes(text)) return;
    await wait(50);
  }
  throw new Error(`API did not print expected output: ${text}`);
}

let outputBuffer = "";

function sendProviderJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function createProviderServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", PROVIDER_URL);

    if (request.method === "GET" && url.pathname === "/api/search") {
      const track = url.searchParams.get("track_name");

      if (track === "This City") {
        sendProviderJson(response, 200, [
          {
            trackName: track,
            artistName: "Sam Fischer",
            albumName: "Not a Hobby",
            syncedLyrics: "[00:05.00]I've been seeing lonely people in crowded rooms\n[00:21.00]Covering their old heartbreaks with new tattoos\n[00:42.00]It's all about smoke screens and cigarettes\n[01:14.00]This city is gonna break my heart\n[01:46.00]This city is gonna love me then leave me alone",
            plainLyrics: "I've been seeing lonely people in crowded rooms\nCovering their old heartbreaks with new tattoos\nIt's all about smoke screens and cigarettes\nThis city is gonna break my heart"
          }
        ]);
        return;
      }

      sendProviderJson(response, 404, { error: "not found" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/get") {
      const track = url.searchParams.get("track_name");

      if (track === "Get Lucky (feat. Pharrell Williams)") {
        sendProviderJson(response, 200, {
          trackName: track,
          artistName: "Daft Punk",
          albumName: "Random Access Memories",
          syncedLyrics: "[00:12.00]Like the legend of the phoenix\n[00:18.00]All ends with beginnings\n[00:23.50]What keeps the planet spinning",
          plainLyrics: "Like the legend of the phoenix\nAll ends with beginnings"
        });
        return;
      }

      if (track === "Instant Crush") {
        sendProviderJson(response, 200, {
          trackName: track,
          artistName: "Daft Punk",
          albumName: "Random Access Memories",
          syncedLyrics: null,
          plainLyrics: "I didn't want to be the one to forget\n\nI thought of everything I'd never regret"
        });
        return;
      }

      if (track === "Lose Yourself to Dance") {
        sendProviderJson(response, 404, { error: "not found" });
        return;
      }

      if (track === "A.M. Ambient") {
        sendProviderJson(response, 200, {
          trackName: track,
          artistName: "Internet Radio",
          albumName: "Radio",
          syncedLyrics: null,
          plainLyrics: "Midnight radio glow\nA softer room begins"
        });
        return;
      }

      sendProviderJson(response, 404, { error: "not found" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/json/123/searchalbum.php") {
      sendProviderJson(response, 200, { album: [] });
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/identify") {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (body.includes("BT_SUCCESS")) {
          sendProviderJson(response, 200, {
            status: { code: 0, msg: "Success" },
            metadata: {
              music: [
                {
                  title: "Get Lucky (feat. Pharrell Williams)",
                  artists: [{ name: "Daft Punk" }],
                  album: { name: "Random Access Memories" },
                  score: 98
                }
              ]
            }
          });
          return;
        }

        if (body.includes("BT_NOT_FOUND")) {
          sendProviderJson(response, 200, {
            status: { code: 3003, msg: "No result" }
          });
          return;
        }

        if (body.includes("BT_ERROR")) {
          sendProviderJson(response, 500, {
            status: { code: 5000, msg: "Mock provider failure" }
          });
          return;
        }

        sendProviderJson(response, 200, {
          status: { code: 3003, msg: "No result" }
        });
      });
      return;
    }

    sendProviderJson(response, 404, { error: "not found" });
  });
}

async function waitForLyricsStatus(expectedStatuses) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { response, body } = await request("/api/v1/lyrics/status");
    if (response.ok && expectedStatuses.includes(body.status)) {
      return body;
    }
    await wait(100);
  }
  throw new Error(`Lyrics state did not reach one of: ${expectedStatuses.join(", ")}`);
}

async function run() {
  const apiAssetsRoot = await mkdtemp(path.join(tmpdir(), "tikpal-api-assets-"));
  const apiStateRoot = await mkdtemp(path.join(tmpdir(), "tikpal-api-state-"));
  const musicLibraryStatePath = path.join(apiStateRoot, "music-library-state.json");
  const sceneBytes = Buffer.from("000000 ftypisom tikpal rainy window api smoke mp4");
  const sceneSha256 = createHash("sha256").update(sceneBytes).digest("hex");
  await mkdir(path.join(apiAssetsRoot, "scenes", "_metadata"), { recursive: true });
  await writeFile(path.join(apiAssetsRoot, "output_2560x720-4k.mp4"), Buffer.from("000000 ftypisom tikpal legacy scene mp4"));
  await writeFile(path.join(apiAssetsRoot, "scenes", "Rainy-Window.mp4"), sceneBytes);
  await writeFile(
    path.join(apiAssetsRoot, "scenes", "_metadata", "scene_videos.json"),
    `${JSON.stringify({
      mode: "add",
      videos: [
        {
          id: "rainy-window",
          filename: "Rainy-Window.mp4",
          label: "Rainy Window",
          order: 30,
          default: false,
          sha256: sceneSha256
        }
      ]
    }, null, 2)}\n`
  );

  await writeFile(BLUETOOTH_SCENARIO_PATH, "BT_SUCCESS\n");
  await writeFile(BLUETOOTH_METADATA_PATH, "");
  const providerServer = createProviderServer();
  await new Promise((resolve) => providerServer.listen(PROVIDER_PORT, HOST, resolve));

  const server = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      TIKPAL_API_HOST: HOST,
      TIKPAL_API_PORT: String(PORT),
      TIKPAL_PUBLIC_ASSETS_ROOT: apiAssetsRoot,
      TIKPAL_MUSIC_LIBRARY_STATE_PATH: musicLibraryStatePath,
      TIKPAL_RECOGNITION_PROVIDER: "acrcloud",
      TIKPAL_ACRCLOUD_HOST: PROVIDER_URL,
      TIKPAL_ACRCLOUD_ACCESS_KEY: "mock-key",
      TIKPAL_ACRCLOUD_ACCESS_SECRET: "mock-secret",
      TIKPAL_BLUETOOTH_CAPTURE_COMMAND: "./deploy/moode/tikpal-bluetooth-capture.sh",
      TIKPAL_BLUETOOTH_CAPTURE_MOCK: "1",
      TIKPAL_BLUETOOTH_CAPTURE_MOCK_FILE: BLUETOOTH_SCENARIO_PATH,
      TIKPAL_BLUETOOTH_RECOGNITION_SETTLE_MS: "700",
      TIKPAL_BLUETOOTH_RECOGNITION_RETRY_MS: "45000",
      TIKPAL_BLUETOOTH_RECOGNITION_NOT_FOUND_RETRY_MS: "300",
      TIKPAL_MOCK_BLUETOOTH_CONNECT_AFTER_MS: "150",
      TIKPAL_MOCK_BLUETOOTH_METADATA_FILE: BLUETOOTH_METADATA_PATH,
      TIKPAL_LRCLIB_BASE_URL: PROVIDER_URL,
      TIKPAL_THEAUDIODB_BASE_URL: PROVIDER_URL
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  server.stdout.on("data", (chunk) => {
    outputBuffer += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    outputBuffer += chunk.toString();
  });

  try {
    await waitForHealth();
    await waitForOutput(SERVER_READY_TEXT);

    const initial = await request("/api/v1/system/state");
    assert(initial.response.ok, "system state should return 200");
    assert(initial.body.runtime.apiMode === "mock", "runtime should report mock API mode");
    assert(initial.body.playback.title, "playback title should be present");
    assert(initial.body.playback.settings.playMode === "sequence", "playback should expose sequence mode by default");
    assert(initial.body.audio.currentSource.id === "mpd", "system state should expose current audio source");
    assert(initial.body.lyrics?.sourceScope === "local_playback", "system state should expose lyrics state");

    const initialLyrics = await waitForLyricsStatus(["ready"]);
    assert(initialLyrics.synced === true, "initial MPD track should resolve synced lyrics");
    assert(initialLyrics.lines.length >= 2, "synced lyrics should include lines");

    const sources = await request("/api/v1/audio/sources");
    assert(sources.response.ok, "audio sources should return 200");
    assert(Array.isArray(sources.body.sources) && sources.body.sources.length === 8, "audio sources should return Library, Radio, Scene Sound, Audio, Spotify Connect, Bluetooth, AirPlay, and DLNA");
    assert(sources.body.currentSource.id === "mpd", "audio source payload should start on MPD");
    assert(sources.body.sources.some((source) => source.id === "scene"), "audio sources payload should include scene sound");
    assert(sources.body.sources.some((source) => source.id === "audio"), "audio sources payload should include audio");
    assert(sources.body.sources.some((source) => source.id === "spotify"), "audio sources payload should include spotify connect");
    assert(sources.body.sources.some((source) => source.id === "bluetooth"), "audio sources payload should include bluetooth");
    assert(sources.body.sources.some((source) => source.id === "airplay"), "audio sources payload should include airplay");
    assert(sources.body.sources.some((source) => source.id === "upnp"), "audio sources payload should include dlna");
    assert(sources.body.sources.some((source) => source.id === "spotify" && source.connectionState === "blocked" && source.availability === "waiting"), "spotify should start closed until selected");
    assert(sources.body.sources.some((source) => source.id === "bluetooth" && source.connectionState === "blocked" && source.availability === "waiting"), "bluetooth should start closed until selected");
    assert(sources.body.sources.some((source) => source.id === "airplay" && source.connectionState === "blocked" && source.availability === "waiting"), "airplay should start closed until selected");
    assert(sources.body.sources.some((source) => source.id === "upnp" && source.connectionState === "blocked" && source.availability === "waiting"), "dlna should start closed until selected");
    assert(sources.body.sources.some((source) => source.id === "bluetooth" && source.advertisedLabel === "Tikpal Speaker"), "bluetooth source should expose advertised device name");
    assert(sources.body.sources.some((source) => source.id === "upnp" && source.advertisedLabel === "Tikpal Speaker"), "dlna source should expose advertised renderer name");

    const localLibrary = await request("/api/v1/audio/library?storage=local&limit=5");
    assert(localLibrary.response.ok, "local audio library should return 200");
    assert(localLibrary.body.total > 0, "local audio library should load tracks from the manifest");
    assert(Array.isArray(localLibrary.body.sources) && localLibrary.body.sources.length === 6, "library source metadata should expose six visible source categories");
    assert(JSON.stringify(localLibrary.body.sources.map((source) => source.label)) === JSON.stringify(["Library", "Radio", "Spotify", "AirPlay", "Bluetooth", "DLNA"]), "library source metadata should expose the visible Player rail order");
    assert(localLibrary.body.sources.every((source) => source.id !== "audio"), "library source metadata should not expose audio as a visible category");
    assert(localLibrary.body.sources.every((source) => source.id !== "playlist"), "library source metadata should not expose playlist as a Player source category");
    assert(localLibrary.body.sources.some((source) => source.id === "upnp" && source.label === "DLNA"), "library source metadata should expose DLNA as a visible category");
    assert(localLibrary.body.storages.find((storage) => storage.id === "local")?.trackCount === localLibrary.body.total, "local storage track count should match manifest-backed total");
    assert(localLibrary.body.tracks.every((track) => track.storage === "local"), "local audio library should only return local tracks when filtered");
    assert(localLibrary.body.tracks[0]?.path, "local audio library tracks should expose manifest paths");
    assert(localLibrary.body.tracks[0]?.albumArtUrl, "local audio library tracks should expose cover art URLs");
    assert(localLibrary.body.tracks[0]?.albumArtLabel, "generic local library folder covers should expose overlay labels");
    assert(localLibrary.body.total === 39, "local audio library should keep the 39-track manifest total");
    const localStorage = localLibrary.body.storages.find((storage) => storage.id === "local");
    assert(localStorage, "local storage metadata should exist");
    const localCategoryIds = localStorage.categories.map((category) => category.id);
    assert(JSON.stringify(localCategoryIds) === JSON.stringify(["focus", "meditation", "rest"]), "local category ids should stay focus, meditation, rest");
    const expectedSubCategories = {
      focus: ["Lo-fi / Ambient", "Classical / Piano", "Binaural / Alpha / Theta", "White Noise / Brown Noise"],
      meditation: ["Guided Meditation", "Breathing", "Singing Bowl", "Nature Sounds"],
      rest: ["Nap", "Sleep", "Rain / Ocean / Forest", "Deep Sleep Long Tracks"]
    };
    for (const category of localStorage.categories) {
      assert(
        JSON.stringify(category.subCategories.map((subCategory) => subCategory.label)) === JSON.stringify(expectedSubCategories[category.id]),
        `${category.id} local subcategories should match the curated taxonomy order`
      );
    }
    const meditationLibrary = await request("/api/v1/audio/library?storage=local&category=meditation&limit=500");
    assert(meditationLibrary.response.ok, "meditation library should return 200");
    assert(meditationLibrary.body.tracks.length > 0, "meditation library should include manifest-backed tracks");
    assert(meditationLibrary.body.tracks.every((track) => track.categoryId === "meditation"), "meditation library should only include meditation category tracks");
    assert(
      meditationLibrary.body.tracks.every((track) => !["Deep Sleep Long Tracks", "Sleep", "Rain / Ocean / Forest", "Nap"].includes(track.subCategory)),
      "meditation subcategories should not include rest folders"
    );
    const localCover = await requestBinary(localLibrary.body.tracks[0].albumArtUrl);
    assert(localCover.response.ok, "local library cover should return 200");
    assert(localCover.response.headers.get("content-type")?.startsWith("image/"), "local library cover should be served as an image");
    assert(localCover.body.length > 0, "local library cover should not be empty");
    const localTrackSwitch = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "mpd", localTrackPath: localLibrary.body.tracks[0].path })
    });
    assert(localTrackSwitch.response.ok, "local track source switch should return 200");
    assert(localTrackSwitch.body.audio.currentSource.id === "mpd", "local track switch should keep MPD as the current source");
    assert(localTrackSwitch.body.playback.title === localLibrary.body.tracks[0].title, "local track switch should update playback title");
    assert(localTrackSwitch.body.playback.artist === localLibrary.body.tracks[0].artist, "local track switch should update playback artist");
    assert(localTrackSwitch.body.playback.albumArtUrl === localLibrary.body.tracks[0].albumArtUrl, "local track switch should update playback cover art");

    const favoriteToggle = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "favorite_toggle" })
    });
    assert(favoriteToggle.response.ok, "favorite_toggle should return 200 for the current local track");
    assert(favoriteToggle.body.playback.favorite === true, "favorite_toggle should mark the current local track as favorite");
    const favorites = await request("/api/v1/audio/library?storage=favorites&limit=50");
    assert(favorites.response.ok, "favorites library should return 200");
    assert(favorites.body.total === 1, "favorites library should include the saved local track");
    assert(favorites.body.tracks[0]?.path === localLibrary.body.tracks[0].path, "favorites library should return the favorited track path");
    assert(favorites.body.tracks[0]?.favorite === true, "favorites library tracks should expose favorite=true");

    const favoriteRemove = await request("/api/v1/audio/favorites", {
      method: "POST",
      body: JSON.stringify({ trackPath: localLibrary.body.tracks[0].path, favorite: false })
    });
    assert(favoriteRemove.response.ok, "favorite remove endpoint should return 200");
    assert(favoriteRemove.body.playback.favorite === false, "favorite remove endpoint should update playback favorite state");
    const favoriteAdd = await request("/api/v1/audio/favorites", {
      method: "POST",
      body: JSON.stringify({ trackPath: localLibrary.body.tracks[0].path, favorite: true })
    });
    assert(favoriteAdd.response.ok, "favorite add endpoint should return 200");
    assert(favoriteAdd.body.playback.favorite === true, "favorite add endpoint should update playback favorite state");
    const persistedState = JSON.parse(await readFile(musicLibraryStatePath, "utf8"));
    assert(persistedState.favorites.trackPaths.includes(localLibrary.body.tracks[0].path), "favorites should persist to the music library state file");

    const initialPlaylists = await request("/api/v1/audio/playlists");
    assert(initialPlaylists.response.ok, "playlists endpoint should return 200");
    assert(initialPlaylists.body.playlists.filter((playlist) => playlist.source === "curated").length >= 15, "playlists endpoint should expose curated readonly playlists");
    assert(initialPlaylists.body.playlists.every((playlist) => playlist.source !== "curated" || playlist.readOnly === true), "curated playlists should be readonly");
    assert(initialPlaylists.body.playlists.every((playlist) => Array.isArray(playlist.moodTags)), "playlists should expose mood tags");
    assert(initialPlaylists.body.playlists.every((playlist) => typeof playlist.coverType === "string"), "playlists should expose cover type");
    const playlistCreate = await request("/api/v1/audio/playlists", {
      method: "POST",
      body: JSON.stringify({
        name: "Smoke List",
        moodTags: ["Calm"],
        coverType: "scene",
        coverValue: "rain",
        trackPaths: [localLibrary.body.tracks[0].path]
      })
    });
    assert(playlistCreate.response.ok, "playlist creation should return 200");
    const createdPlaylist = playlistCreate.body.playlists.find((playlist) => playlist.source === "user" && playlist.name === "Smoke List");
    assert(createdPlaylist, "playlist creation should return the new user playlist");
    assert(createdPlaylist.trackCount === 1, "playlist creation should accept initial tracks");
    assert(createdPlaylist.moodTags.includes("Calm"), "playlist creation should persist mood tags");
    assert(createdPlaylist.coverType === "scene" && createdPlaylist.coverValue === "rain", "playlist creation should persist cover metadata");
    const playlistRename = await request("/api/v1/audio/playlist-actions", {
      method: "POST",
      body: JSON.stringify({ type: "rename", playlistId: createdPlaylist.id, name: "Smoke Renamed" })
    });
    assert(playlistRename.response.ok, "playlist rename should return 200");
    assert(playlistRename.body.playlists.some((playlist) => playlist.id === createdPlaylist.id && playlist.name === "Smoke Renamed"), "playlist rename should update the user playlist");
    const playlistMetadata = await request("/api/v1/audio/playlist-actions", {
      method: "POST",
      body: JSON.stringify({
        type: "update_metadata",
        playlistId: createdPlaylist.id,
        name: "Smoke Updated",
        description: "Smoke metadata update",
        moodTags: ["Sleep", "Fireplace"],
        coverType: "collage",
        coverValue: "album-collage"
      })
    });
    assert(playlistMetadata.response.ok, "playlist update_metadata should return 200");
    const metadataPlaylist = playlistMetadata.body.playlists.find((playlist) => playlist.id === createdPlaylist.id);
    assert(metadataPlaylist.name === "Smoke Updated", "playlist update_metadata should update name");
    assert(metadataPlaylist.description === "Smoke metadata update", "playlist update_metadata should update description");
    assert(metadataPlaylist.moodTags.includes("Sleep") && metadataPlaylist.moodTags.includes("Fireplace"), "playlist update_metadata should update mood tags");
    assert(metadataPlaylist.coverType === "collage" && metadataPlaylist.coverValue === "album-collage", "playlist update_metadata should update cover metadata");
    const playlistAddSecond = await request("/api/v1/audio/playlist-actions", {
      method: "POST",
      body: JSON.stringify({ type: "add_track", playlistId: createdPlaylist.id, trackPath: localLibrary.body.tracks[1].path })
    });
    assert(playlistAddSecond.response.ok, "playlist add_track should accept a second track");
    assert(playlistAddSecond.body.playlists.find((playlist) => playlist.id === createdPlaylist.id)?.trackCount === 2, "playlist should expose added track count");
    const playlistMove = await request("/api/v1/audio/playlist-actions", {
      method: "POST",
      body: JSON.stringify({ type: "move_track", playlistId: createdPlaylist.id, fromIndex: 1, toIndex: 0 })
    });
    assert(playlistMove.response.ok, "playlist move_track should return 200");
    assert(playlistMove.body.playlists.find((playlist) => playlist.id === createdPlaylist.id)?.tracks[0]?.path === localLibrary.body.tracks[1].path, "playlist move_track should reorder tracks");
    const playlistDuplicate = await request("/api/v1/audio/playlist-actions", {
      method: "POST",
      body: JSON.stringify({ type: "duplicate", playlistId: createdPlaylist.id })
    });
    assert(playlistDuplicate.response.ok, "playlist duplicate should return 200");
    const duplicatedPlaylist = playlistDuplicate.body.playlists.find((playlist) => playlist.source === "user" && playlist.name === "Smoke Updated Copy");
    assert(duplicatedPlaylist, "playlist duplicate should create an editable copy");
    assert(duplicatedPlaylist.readOnly === false && duplicatedPlaylist.trackCount === 2, "playlist duplicate should preserve tracks as editable");
    assert(duplicatedPlaylist.coverType === "collage", "playlist duplicate should preserve cover metadata");
    const curatedPlaylist = initialPlaylists.body.playlists.find((playlist) => playlist.source === "curated");
    const curatedDuplicate = await request("/api/v1/audio/playlist-actions", {
      method: "POST",
      body: JSON.stringify({ type: "duplicate", playlistId: curatedPlaylist.id, name: "Curated Copy" })
    });
    assert(curatedDuplicate.response.ok, "curated playlist duplicate should return 200");
    const curatedCopy = curatedDuplicate.body.playlists.find((playlist) => playlist.source === "user" && playlist.name === "Curated Copy");
    assert(curatedCopy && curatedCopy.readOnly === false, "curated playlist duplicate should create an editable user playlist");
    const playlistPlay = await request("/api/v1/audio/playlist-actions", {
      method: "POST",
      body: JSON.stringify({ type: "play", playlistId: createdPlaylist.id })
    });
    assert(playlistPlay.response.ok, "playlist play should return 200");
    const playlistPlayback = await request("/api/v1/system/state");
    assert(playlistPlayback.response.ok, "system state after playlist play should return 200");
    assert(playlistPlayback.body.audio.currentSource.id === "mpd", "playlist play should keep MPD as the active source");
    assert(playlistPlayback.body.playback.queueLength === 2, "playlist play should load a mock local queue");
    assert(playlistPlayback.body.playback.title === localLibrary.body.tracks[1].title, "playlist play should start from the reordered first track");
    const playlistPlaySecond = await request("/api/v1/audio/playlist-actions", {
      method: "POST",
      body: JSON.stringify({ type: "play", playlistId: createdPlaylist.id, startIndex: 1 })
    });
    assert(playlistPlaySecond.response.ok, "playlist play should accept startIndex");
    const playlistSecondPlayback = await request("/api/v1/system/state");
    assert(playlistSecondPlayback.response.ok, "system state after playlist startIndex play should return 200");
    assert(playlistSecondPlayback.body.playback.currentTrackIndex === 2, "playlist play startIndex should set the playback queue index");
    assert(playlistSecondPlayback.body.playback.title === localLibrary.body.tracks[0].title, "playlist play startIndex should start from the requested song");
    const playlistRemove = await request("/api/v1/audio/playlist-actions", {
      method: "POST",
      body: JSON.stringify({ type: "remove_track", playlistId: createdPlaylist.id, trackPath: localLibrary.body.tracks[1].path })
    });
    assert(playlistRemove.response.ok, "playlist remove_track should return 200");
    assert(playlistRemove.body.playlists.find((playlist) => playlist.id === createdPlaylist.id)?.trackCount === 1, "playlist remove_track should reduce track count");
    const playlistDelete = await request("/api/v1/audio/playlist-actions", {
      method: "POST",
      body: JSON.stringify({ type: "delete", playlistId: createdPlaylist.id })
    });
    assert(playlistDelete.response.ok, "playlist delete should return 200");
    assert(!playlistDelete.body.playlists.some((playlist) => playlist.id === createdPlaylist.id), "playlist delete should remove the user playlist");
    const playbackAfterDelete = await request("/api/v1/system/state");
    assert(playbackAfterDelete.response.ok, "system state after playlist delete should return 200");
    assert(playbackAfterDelete.body.playback.queueLength === 2, "playlist delete should not stop the already loaded playback queue");
    const duplicateDelete = await request("/api/v1/audio/playlist-actions", {
      method: "POST",
      body: JSON.stringify({ type: "delete", playlistId: duplicatedPlaylist.id })
    });
    assert(duplicateDelete.response.ok, "playlist duplicate cleanup should return 200");
    const curatedCopyDelete = await request("/api/v1/audio/playlist-actions", {
      method: "POST",
      body: JSON.stringify({ type: "delete", playlistId: curatedCopy.id })
    });
    assert(curatedCopyDelete.response.ok, "curated copy cleanup should return 200");
    const defaultLibraryResume = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "mpd" })
    });
    assert(defaultLibraryResume.response.ok, "default MPD resume after playlist smoke should return 200");
    assert(defaultLibraryResume.body.playback.title === "Get Lucky (feat. Pharrell Williams)", "default MPD resume should restore the mock library queue");

    const repeatOne = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "play_mode_set", mode: "repeat_one" })
    });
    assert(repeatOne.response.ok, "repeat_one play mode should return 200");
    assert(repeatOne.body.playback.settings.playMode === "repeat_one", "repeat_one should enable single-track repeat");
    assert(repeatOne.body.playback.settings.playMode !== "shuffle", "repeat_one should not leave shuffle active");
    const shuffleOn = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "play_mode_set", mode: "shuffle" })
    });
    assert(shuffleOn.response.ok, "shuffle play mode should return 200");
    assert(shuffleOn.body.playback.settings.playMode === "shuffle", "shuffle should enable random playback");
    assert(shuffleOn.body.playback.settings.playMode !== "repeat_one", "shuffle should turn repeat_one off");
    const sequenceMode = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "play_mode_set", mode: "sequence" })
    });
    assert(sequenceMode.response.ok, "sequence play mode should return 200");
    assert(sequenceMode.body.playback.settings.playMode === "sequence", "sequence should restore ordinary playback");
    const invalidPlayMode = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "play_mode_set", mode: "bad_mode" })
    });
    assert(invalidPlayMode.response.status === 400, "invalid play mode should return 400");

    const backgroundVideos = await request("/api/v1/media/background-videos");
    assert(backgroundVideos.response.ok, "background video catalog should return 200");
    assert(backgroundVideos.body.total >= 2, "background video catalog should include legacy and scene MP4s");
    assert(backgroundVideos.body.videos.every((video) => video.src.startsWith("/assets/") && video.src.endsWith(".mp4")), "background videos should expose asset MP4 URLs");
    const rainyWindow = backgroundVideos.body.videos.find((video) => video.id === "rainy-window");
    assert(rainyWindow?.src === "/assets/scenes/Rainy-Window.mp4", "background video catalog should include Rainy Window scene video");
    assert(rainyWindow?.label === "Rainy Window", "background video catalog should use scene manifest labels");
    assert(rainyWindow?.order === 30, "background video catalog should expose scene manifest order");
    assert(backgroundVideos.body.catalogVersion, "background video catalog should expose a catalog version");

    const radios = await request("/api/v1/audio/radios?q=ambient&genre=Ambient");
    assert(radios.response.ok, "radio catalog should return 200");
    assert(radios.body.total >= 1, "radio catalog should include matching stations");
    assert(radios.body.stations.every((station) => station.genre === "Ambient"), "radio catalog should filter by genre");

    const artwork = await request("/api/v1/media/artwork?track=mock");
    assert(artwork.response.status === 404, "mock artwork endpoint should return 404 when no current artwork is available");

    const next = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "next" })
    });
    assert(next.response.ok, "next action should return 200");
    assert(next.body.playback.currentTrackIndex === 2, "next action should advance the queue");
    const instantCrushLyrics = await waitForLyricsStatus(["ready"]);
    assert(instantCrushLyrics.synced === false, "plain lyrics should degrade to unsynced mode");
    assert(instantCrushLyrics.lines[0]?.text.includes("I didn't want"), "unsynced lyrics should preserve paragraph text");

    const nextToNotFound = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "next" })
    });
    assert(nextToNotFound.response.ok, "second next action should return 200");
    const missingLyrics = await waitForLyricsStatus(["not_found", "ready"]);
    if (missingLyrics.status === "not_found") {
      assert(missingLyrics.message, "missing lyrics should produce a lightweight message");
    } else {
      assert(missingLyrics.lines.length > 0, "fallback lyric search should return displayable lines when it finds a match");
    }

    const pause = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "play_pause" })
    });
    assert(pause.response.ok, "play_pause action should return 200");
    assert(pause.body.playback.state === "paused", "play_pause should pause active playback");

    const seek = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "seek", value: 123 })
    });
    assert(seek.response.ok, "seek action should return 200");
    assert(seek.body.playback.elapsedSeconds === 123, "seek action should set elapsed seconds");

    const volume = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "volume_set", value: 42 })
    });
    assert(volume.response.ok, "volume_set action should return 200");
    assert(volume.body.system.volume.percent === 42, "volume_set should update volume percent");

    const scene = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({
        target: "scene",
        sceneVideoId: "fireplace-loop",
        sceneVideoLabel: "Fireplace Loop",
        sceneVideoSrc: "/assets/output_2560x720-4k.mp4"
      })
    });
    assert(scene.response.ok, "scene source switch should return 200");
    assert(scene.body.audio.currentSource.id === "scene", "scene switch should mark scene as current in mock mode");
    assert(scene.body.playback.source === "scene", "playback source should follow scene switch");
    assert(scene.body.playback.state === "playing", "scene switch should mark video audio as playing");
    assert(scene.body.playback.title === "Scene Audio", "scene playback should expose Scene Audio title");
    assert(scene.body.playback.artist === "Fireplace Loop", "scene playback artist should use the current scene label");
    assert(scene.body.playback.album === "Fireplace Loop", "scene playback album should use the current scene label");
    assert(Array.isArray(scene.body.playback.queuePreview) && scene.body.playback.queuePreview.length === 0, "scene playback should not expose a music queue");
    assert(scene.body.audio.sources.some((source) => source.id === "scene" && source.active), "scene source should be active while scene audio is playing");
    assert(scene.body.audio.sources.some((source) => source.id === "spotify" && source.armed === false), "scene switch should close spotify intake");
    assert(scene.body.audio.sources.some((source) => source.id === "bluetooth" && source.armed === false), "scene switch should close bluetooth intake");
    assert(scene.body.audio.sources.some((source) => source.id === "airplay" && source.armed === false), "scene switch should close airplay intake");
    assert(scene.body.audio.sources.some((source) => source.id === "upnp" && source.armed === false), "scene switch should close dlna intake");

    const sceneNext = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "next" })
    });
    assert(sceneNext.response.ok, "scene next action should return 200");
    assert(sceneNext.body.playback.source === "scene", "scene next should not leave scene playback");
    assert(sceneNext.body.playback.currentTrackIndex === 0, "scene next should not operate the music queue");

    const sceneSeek = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "seek", value: 12 })
    });
    assert(sceneSeek.response.ok, "scene seek action should return 200");
    assert(sceneSeek.body.playback.source === "scene", "scene seek should not leave scene playback");
    assert(sceneSeek.body.playback.elapsedSeconds === null, "scene seek should not expose a music timeline");

    const sceneVolume = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "volume_set", value: 37 })
    });
    assert(sceneVolume.response.ok, "scene volume_set action should return 200");
    assert(sceneVolume.body.system.volume.percent === 37, "scene volume_set should update output volume percent");

    const scenePause = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "pause" })
    });
    assert(scenePause.response.ok, "scene pause action should return 200");
    assert(scenePause.body.playback.source === "scene", "scene pause should keep scene as current source");
    assert(scenePause.body.playback.state === "stopped", "scene pause should stop scene audio without restoring music");

    const libraryResume = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "mpd" })
    });
    assert(libraryResume.response.ok, "library source switch after scene should return 200");
    assert(libraryResume.body.audio.currentSource.id === "mpd", "library resume should mark MPD as the current source");
    assert(libraryResume.body.playback.source === "mpd", "library resume should leave scene playback");
    assert(libraryResume.body.playback.state === "playing", "library resume should start library playback");
    assert(libraryResume.body.audio.sources.some((source) => source.id === "scene" && source.active === false), "library resume should deactivate scene source");

    const audio = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "audio" })
    });
    assert(audio.response.ok, "audio source switch should return 200");
    assert(audio.body.audio.currentSource.id === "audio", "audio source switch should mark Audio as current in mock mode");
    assert(audio.body.playback.source === "audio", "playback source should follow audio switch");
    assert(audio.body.audio.sources.some((source) => source.id === "scene" && source.active === false), "audio source switch should deactivate scene");

    const spotify = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "spotify" })
    });
    assert(spotify.response.ok, "spotify connect source switch should return 200");
    assert(spotify.body.audio.currentSource.id === "spotify", "spotify connect switch should activate spotify in mock mode");
    assert(spotify.body.audio.currentSource.armed === true, "spotify connect switch should arm spotify handoff");
    assert(spotify.body.audio.currentSource.advertisedLabel === "Tikpal Speaker", "spotify connect switch should keep advertised device name in state");
    assert(spotify.body.playback.source === "spotify", "playback source should follow spotify connect switch");

    const bluetooth = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "bluetooth" })
    });
    assert(bluetooth.response.ok, "bluetooth source switch should return 200");
    assert(bluetooth.body.audio.currentSource.id === "bluetooth", "bluetooth switch should activate bluetooth in mock mode");
    assert(bluetooth.body.audio.currentSource.armed === true, "bluetooth switch should arm bluetooth intake");
    assert(bluetooth.body.audio.currentSource.advertisedLabel === "Tikpal Speaker", "bluetooth switch should keep advertised device name in state");
    assert(bluetooth.body.playback.source === "bluetooth", "playback source should follow bluetooth switch");
    assert(bluetooth.body.audio.currentSource.connectionState === "armed", "bluetooth source should initially wait for a connected input");
    assert(bluetooth.body.lyrics.status === "idle", "bluetooth lyrics should stay idle until audio connects");
    assert(bluetooth.body.lyrics.sourceScope === "bluetooth_input", "bluetooth idle state should report bluetooth_input scope");

    const bluetoothRecognizing = await waitForLyricsStatus(["recognizing"]);
    assert(bluetoothRecognizing.message === "Listening to Bluetooth audio...", "bluetooth recognition should use bluetooth-specific copy");
    const bluetoothReady = await waitForLyricsStatus(["ready"]);
    assert(bluetoothReady.sourceScope === "bluetooth_input", "bluetooth ready state should report bluetooth_input scope");
    assert(bluetoothReady.recognitionMode === "fingerprint", "bluetooth ready state should report fingerprint mode");
    assert(bluetoothReady.recognitionProvider === "acrcloud", "bluetooth ready state should report acrcloud provider");
    assert(bluetoothReady.recognitionConfidence === 98, "bluetooth ready state should include provider confidence");
    assert(bluetoothReady.title === "Get Lucky (feat. Pharrell Williams)", "bluetooth fingerprint recognition should identify the track");
    assert(bluetoothReady.synced === false, "bluetooth lyrics should degrade to static display without a playback clock");
    assert(bluetoothReady.lines[0]?.text.includes("Like the legend of the phoenix"), "bluetooth lyrics should surface displayable lyric text");
    assert(bluetoothReady.lines.length >= 2, "bluetooth lyrics should keep readable short lines instead of one long ticker");

    await writeFile(
      BLUETOOTH_METADATA_PATH,
      [
        "title=This City",
        "artist=Sam Fischer",
        "album=Not a Hobby",
        "status=playing",
        "positionMs=45000",
        "durationMs=60000"
      ].join("\n")
    );
    const bluetoothMetadataRefresh = await request("/api/v1/lyrics/refresh", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(bluetoothMetadataRefresh.response.ok, "bluetooth metadata lyrics refresh should return 200");
    const thisCityLyrics = await waitForLyricsStatus(["ready"]);
    assert(thisCityLyrics.sourceScope === "bluetooth_input", "metadata bluetooth lyrics should keep bluetooth scope");
    assert(thisCityLyrics.recognitionMode === "metadata", "trusted BlueZ title metadata should use metadata lyrics lookup");
    assert(thisCityLyrics.timingStrategy === "bluez_duration_clipped", "Bluetooth timed lyrics should clip to BlueZ duration when provider timestamps overrun");
    assert(thisCityLyrics.synced === true, "clipped Bluetooth lyrics should remain synced while enough lines fit");
    assert(thisCityLyrics.lines.every((line) => line.startMs === null || line.startMs <= 62000), "clipped lyrics should drop starts beyond the BlueZ duration grace");
    assert(thisCityLyrics.lines.every((line) => line.endMs === null || line.endMs <= 60000), "clipped lyrics should clamp line ends to the BlueZ duration");
    assert(thisCityLyrics.lines.every((line) => !line.text.includes("break my heart")), "clipped lyrics should omit lyrics that start after the current Bluetooth audio");

    const airplay = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "airplay" })
    });
    assert(airplay.response.ok, "airplay source switch should return 200");
    assert(airplay.body.audio.currentSource.id === "airplay", "airplay switch should activate airplay in mock mode");
    assert(airplay.body.audio.currentSource.armed === true, "airplay switch should arm airplay intake");
    assert(airplay.body.audio.sources.some((source) => source.id === "bluetooth" && source.armed === false), "airplay switch should disarm bluetooth");

    const dlna = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "upnp" })
    });
    assert(dlna.response.ok, "dlna source switch should return 200");
    assert(dlna.body.audio.currentSource.id === "upnp", "dlna switch should activate dlna in mock mode");
    assert(dlna.body.audio.currentSource.armed === true, "dlna switch should arm dlna intake");
    assert(dlna.body.audio.currentSource.advertisedLabel === "Tikpal Speaker", "dlna switch should keep advertised renderer name in state");
    assert(dlna.body.playback.source === "upnp", "playback source should follow dlna switch");
    assert(dlna.body.audio.sources.some((source) => source.id === "spotify" && source.armed === false), "dlna switch should disarm spotify");
    assert(dlna.body.audio.sources.some((source) => source.id === "bluetooth" && source.armed === false), "dlna switch should disarm bluetooth");
    assert(dlna.body.audio.sources.some((source) => source.id === "airplay" && source.armed === false), "dlna switch should disarm airplay");

    const radio = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "radio", radioStationId: "radio-2" })
    });
    assert(radio.response.ok, "radio source switch should return 200");
    assert(radio.body.audio.currentSource.id === "radio", "radio switch should activate radio in mock mode");
    assert(radio.body.playback.source === "radio", "playback source should follow radio switch");
    assert(radio.body.playback.title === "A.M. Ambient", "radio switch should surface the active preset label");
    assert(radio.body.audio.sources.some((source) => source.id === "airplay" && source.armed === false), "radio switch should close airplay intake");
    assert(radio.body.audio.sources.some((source) => source.id === "upnp" && source.armed === false), "radio switch should close dlna intake");
    const radioLyrics = await waitForLyricsStatus(["ready"]);
    assert(radioLyrics.lines[0]?.text.includes("Midnight radio glow"), "radio metadata changes should resolve a new lyrics payload");

    const mpd = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "mpd" })
    });
    assert(mpd.response.ok, "mpd source switch should return 200");
    assert(mpd.body.audio.currentSource.id === "mpd", "mpd switch should return to library in mock mode");
    assert(mpd.body.audio.sources.some((source) => source.id === "bluetooth" && source.armed === false), "mpd switch should keep bluetooth blocked");
    const cachedLyrics = await waitForLyricsStatus(["not_found"]);
    assert(cachedLyrics.trackKey === missingLyrics.trackKey, "repeat track should reuse cached lyrics result");

    const refreshLyrics = await request("/api/v1/lyrics/refresh", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(refreshLyrics.response.ok, "lyrics refresh should return 200");
    assert(["recognizing", "not_found", "ready", "error"].includes(refreshLyrics.body.status), "lyrics refresh should return a valid lyrics state");

    await writeFile(BLUETOOTH_SCENARIO_PATH, "BT_NOT_FOUND\n");
    await writeFile(BLUETOOTH_METADATA_PATH, "");
    const bluetoothAgain = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "bluetooth" })
    });
    assert(bluetoothAgain.response.ok, "bluetooth should stay switchable for a second recognition pass");
    await waitForLyricsStatus(["recognizing"]);
    const bluetoothNotFound = await waitForLyricsStatus(["not_found"]);
    assert(bluetoothNotFound.sourceScope === "bluetooth_input", "bluetooth not_found should keep bluetooth_input scope");

    await writeFile(BLUETOOTH_SCENARIO_PATH, "BT_SUCCESS\n");
    await wait(350);
    const bluetoothRetryTick = await request("/api/v1/system/state");
    assert(bluetoothRetryTick.response.ok, "system state should schedule bluetooth retry after not_found backoff");
    const bluetoothRetryReady = await waitForLyricsStatus(["ready"]);
    assert(bluetoothRetryReady.title === "Get Lucky (feat. Pharrell Williams)", "bluetooth not_found should retry and recover when a later sample identifies the track");

    await writeFile(BLUETOOTH_SCENARIO_PATH, "BT_ERROR\n");
    const bluetoothRefreshError = await request("/api/v1/lyrics/refresh", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(bluetoothRefreshError.response.ok, "bluetooth refresh should return 200 even when provider later fails");
    const bluetoothError = await waitForLyricsStatus(["error"]);
    assert(bluetoothError.message === "Track identification unavailable", "bluetooth provider failure should surface a concise user-safe error");

    const bluetoothErrorCached = await request("/api/v1/lyrics/status");
    assert(bluetoothErrorCached.body.status === "error", "bluetooth provider failures should remain cached during backoff");

    const libraryScan = await request("/api/v1/system/actions", {
      method: "POST",
      body: JSON.stringify({ type: "library_scan" })
    });
    assert(libraryScan.response.ok, "library_scan action should return 200");
    assert(libraryScan.body.system.library.lastScan, "library_scan should return updated system state");

    const brightness = await request("/api/v1/system/actions", {
      method: "POST",
      body: JSON.stringify({ type: "brightness_set", value: 64 })
    });
    assert(brightness.response.ok, "brightness_set action should return 200");
    assert(brightness.body.system.display.brightnessPercent === 64, "brightness_set should update display brightness percent");

    const invalid = await request("/api/v1/playback/actions", {
      method: "POST",
      body: JSON.stringify({ type: "volume_set", value: 180 })
    });
    assert(invalid.response.status === 400, "invalid volume should return 400");
    assert(invalid.body.error === "BAD_REQUEST", "invalid action should return BAD_REQUEST");

    const invalidSystemAction = await request("/api/v1/system/actions", {
      method: "POST",
      body: JSON.stringify({ type: "factory_reset" })
    });
    assert(invalidSystemAction.response.status === 400, "invalid system action should return 400");
    assert(invalidSystemAction.body.error === "BAD_REQUEST", "invalid system action should return BAD_REQUEST");

    const invalidBrightness = await request("/api/v1/system/actions", {
      method: "POST",
      body: JSON.stringify({ type: "brightness_set", value: 180 })
    });
    assert(invalidBrightness.response.status === 400, "invalid brightness should return 400");
    assert(invalidBrightness.body.error === "BAD_REQUEST", "invalid brightness should return BAD_REQUEST");

    const invalidSource = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "vinyl" })
    });
    assert(invalidSource.response.status === 400, "invalid source should return 400");
    assert(invalidSource.body.error === "BAD_REQUEST", "invalid source should return BAD_REQUEST");

    const invalidRadioStation = await request("/api/v1/audio/source", {
      method: "POST",
      body: JSON.stringify({ target: "radio", radioStationId: "radio-missing" })
    });
    assert(invalidRadioStation.response.status === 400, "unknown radio station should return 400");
    assert(invalidRadioStation.body.error === "BAD_REQUEST", "unknown radio station should return BAD_REQUEST");

    const invalidRadioQuery = await request("/api/v1/audio/radios?limit=500");
    assert(invalidRadioQuery.response.status === 400, "invalid radio query should return 400");
    assert(invalidRadioQuery.body.error === "BAD_REQUEST", "invalid radio query should return BAD_REQUEST");

    console.log("api smoke passed");
  } finally {
    server.kill("SIGTERM");
    await new Promise((resolve) => providerServer.close(resolve));
    await rm(BLUETOOTH_SCENARIO_PATH, { force: true });
    await rm(BLUETOOTH_METADATA_PATH, { force: true });
    await rm(apiAssetsRoot, { recursive: true, force: true });
    await rm(apiStateRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

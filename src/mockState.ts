import type { AudioState, LyricsState, PlaybackSummary, RadioStationSummary, SourceSummary, SystemState, TikpalState } from "./types";

export const playback: PlaybackSummary = {
  state: "playing",
  source: "mpd",
  albumArtUrl: null,
  title: "Get Lucky (feat. Pharrell Williams)",
  artist: "Daft Punk",
  album: "Random Access Memories",
  elapsedSeconds: 84,
  durationSeconds: 369,
  timingDiagnostics: null,
  currentTrackIndex: 1,
  queueLength: 13,
  favorite: false,
  settings: {
    playMode: "sequence"
  },
  transportCapabilities: {
    playPause: true,
    play: true,
    pause: true,
    next: true,
    previous: true,
    seek: true,
    reason: null
  },
  queuePreview: [
    {
      id: "mock-queue-1",
      position: 1,
      title: "Get Lucky (feat. Pharrell Williams)",
      artist: "Daft Punk",
      album: "Random Access Memories",
      durationSeconds: 369,
      active: true
    },
    {
      id: "mock-queue-2",
      position: 2,
      title: "Instant Crush",
      artist: "Daft Punk",
      album: "Random Access Memories",
      durationSeconds: 337,
      active: false
    },
    {
      id: "mock-queue-3",
      position: 3,
      title: "Lose Yourself to Dance",
      artist: "Daft Punk",
      album: "Random Access Memories",
      durationSeconds: 353,
      active: false
    },
    {
      id: "mock-queue-4",
      position: 4,
      title: "Get Lucky (feat. Pharrell Williams)",
      artist: "Daft Punk",
      album: "Random Access Memories",
      durationSeconds: 369,
      active: false
    },
    {
      id: "mock-queue-5",
      position: 5,
      title: "Instant Crush",
      artist: "Daft Punk",
      album: "Random Access Memories",
      durationSeconds: 337,
      active: false
    }
  ]
};

export const systemState: SystemState = {
  network: {
    kind: "ethernet",
    label: "Ethernet",
    ip: "192.168.1.100",
    speed: "1Gbps"
  },
  display: {
    brightnessPercent: 72,
    controllable: true,
    transport: "mock"
  },
  outputDevice: {
    kind: "usb",
    label: "USB Audio",
    detail: "DAC: Gustard X26 Pro"
  },
  volume: {
    db: -32.5,
    percent: 58,
    muted: false
  },
  audioFormat: {
    codec: "PCM",
    bitDepth: 24,
    sampleRate: 96000,
    container: "FLAC"
  },
  sampleRate: 96000,
  bitDepth: 24,
  cpuTemp: 48,
  dspState: {
    enabled: true,
    preset: "Flat",
    presetId: "flat",
    presetLabel: "Flat",
    controllable: true,
    controlTransport: "mock",
    availablePresets: [
      { id: "flat", label: "Flat", intent: "Reference response", hifiVisualPresetId: "spectrum-bars" },
      { id: "warm", label: "Warm", intent: "Gentle low-mid lift", hifiVisualPresetId: "waveform" },
      { id: "vocal", label: "Vocal", intent: "Clearer midrange presence", hifiVisualPresetId: "dual-vu" }
    ]
  },
  roonBridge: {
    id: "roon",
    enabled: false,
    ready: false,
    active: false,
    serviceActive: false,
    label: "Roon Bridge",
    lastError: null,
    updatedAt: new Date().toISOString()
  },
  multiroom: {
    ecosystems: {
      roon: {
        id: "roon",
        enabled: false,
        ready: false,
        active: false,
        serviceActive: false,
        label: "Roon Bridge",
        lastError: null,
        updatedAt: new Date().toISOString()
      },
      lyrion: {
        id: "lyrion",
        enabled: false,
        ready: false,
        active: false,
        serviceActive: false,
        label: "Lyrion",
        lastError: null,
        updatedAt: new Date().toISOString()
      },
      tikpal: {
        id: "tikpal",
        enabled: false,
        ready: false,
        active: false,
        serviceActive: false,
        label: "Tikpal Multi-room",
        lastError: null,
        updatedAt: new Date().toISOString()
      },
      music_assistant: {
        id: "music_assistant",
        enabled: false,
        ready: false,
        active: false,
        serviceActive: false,
        label: "Music Assistant",
        lastError: "Coming soon",
        comingSoon: true,
        updatedAt: new Date().toISOString()
      }
    },
    activeEcosystemId: null,
    updatedAt: new Date().toISOString()
  },
  library: {
    source: "NAS",
    trackCount: 3265,
    lastScan: "Today 10:30",
    scanning: false
  },
  uptime: "2d 4h"
};

function buildSourceSummary(summary: SourceSummary): SourceSummary {
  return summary;
}

function buildRadioStation(summary: RadioStationSummary): RadioStationSummary {
  return summary;
}

export const audioState: AudioState = {
  currentSource: buildSourceSummary({
    id: "mpd",
    label: "Library",
    kind: "mpd",
    availability: "available",
    active: true,
    controllability: "switchable",
    armed: false,
    connectionState: "idle",
    connectedLabel: null,
    advertisedLabel: null,
    secondaryStatus: "Local queue ready"
  }),
  rememberedSource: {
    target: "mpd",
    localTrackPath: null,
    radioStationId: null,
    updatedAt: null
  },
  sources: [
    buildSourceSummary({
      id: "mpd",
      label: "Library",
      kind: "mpd",
      availability: "available",
      active: true,
      controllability: "switchable",
      armed: false,
      connectionState: "idle",
      connectedLabel: null,
      advertisedLabel: null,
      secondaryStatus: "Local queue ready"
    }),
    buildSourceSummary({
      id: "radio",
      label: "Radio",
      kind: "radio",
      availability: "available",
      active: false,
      controllability: "switchable",
      armed: false,
      connectionState: "idle",
      connectedLabel: null,
      advertisedLabel: null,
      secondaryStatus: "Browse 240 stations"
    }),
    buildSourceSummary({
      id: "audio",
      label: "Audio",
      kind: "audio",
      availability: "available",
      active: false,
      controllability: "switchable",
      armed: false,
      connectionState: "idle",
      connectedLabel: "USB Audio",
      advertisedLabel: null,
      secondaryStatus: "USB Audio / PCM 24bit 96 kHz"
    }),
    buildSourceSummary({
      id: "spotify",
      label: "Spotify Connect",
      kind: "spotify",
      availability: "waiting",
      active: false,
      controllability: "handoff",
      armed: false,
      connectionState: "blocked",
      connectedLabel: null,
      advertisedLabel: "Tikpal Speaker",
      secondaryStatus: "Closed until you open Spotify Connect as Tikpal Speaker"
    }),
    buildSourceSummary({
      id: "bluetooth",
      label: "Bluetooth",
      kind: "bluetooth",
      availability: "waiting",
      active: false,
      controllability: "switchable",
      armed: false,
      connectionState: "blocked",
      connectedLabel: null,
      advertisedLabel: "Tikpal Speaker",
      secondaryStatus: "Closed until you open pairing as Tikpal Speaker"
    }),
    buildSourceSummary({
      id: "airplay",
      label: "AirPlay",
      kind: "airplay",
      availability: "waiting",
      active: false,
      controllability: "switchable",
      armed: false,
      connectionState: "blocked",
      connectedLabel: null,
      advertisedLabel: "Tikpal Speaker",
      secondaryStatus: "Closed until you open AirPlay as Tikpal Speaker"
    }),
    buildSourceSummary({
      id: "upnp",
      label: "DLNA",
      kind: "upnp",
      availability: "waiting",
      active: false,
      controllability: "switchable",
      armed: false,
      connectionState: "blocked",
      connectedLabel: null,
      advertisedLabel: "Tikpal Speaker",
      secondaryStatus: "Closed until you open DLNA as Tikpal Speaker"
    })
  ]
};

const tikpalRadioStationRows: Array<{
  id: string;
  label: string;
  uri: string;
  genre: string;
  bitrateKbps: number;
  codec: string;
  category: string;
  categoryLabel: string;
  tags: string[];
  broadcaster: string;
  sortOrder: number;
}> = [
  { id: "radio-500", label: "Focus - Soma FM Cliqhop", uri: "http://ice1.somafm.com/cliqhop-128-mp3", genre: "Focus, IDM, Downtempo, Study Beats", bitrateKbps: 128, codec: "MP3", category: "focus", categoryLabel: "Focus", tags: ["IDM", "Downtempo"], broadcaster: "Soma FM", sortOrder: 500 },
  { id: "radio-501", label: "Focus - Soma FM Beat Blender", uri: "http://ice1.somafm.com/beatblender-128-mp3", genre: "Focus, Downtempo, Deep House, Study", bitrateKbps: 128, codec: "MP3", category: "focus", categoryLabel: "Focus", tags: ["Downtempo", "Deep House"], broadcaster: "Soma FM", sortOrder: 501 },
  { id: "radio-502", label: "Focus - Soma FM Groove Salad", uri: "http://ice1.somafm.com/groovesalad-128-aac", genre: "Focus, Electronica, Ambient, Down-Tempo", bitrateKbps: 128, codec: "AAC", category: "focus", categoryLabel: "Focus", tags: ["Electronica", "Ambient"], broadcaster: "Soma FM", sortOrder: 502 },
  { id: "radio-510", label: "Calm - Positively Meditation", uri: "https://streaming.positivity.radio/pr/posimeditation/icecast.audio", genre: "Calm, Meditation, Healing, Mindfulness", bitrateKbps: 128, codec: "MP3", category: "calm", categoryLabel: "Calm", tags: ["Meditation", "Healing"], broadcaster: "Positivity Radio", sortOrder: 510 },
  { id: "radio-511", label: "Calm - Soma FM Fluid", uri: "http://ice1.somafm.com/fluid-128-mp3", genre: "Calm, Ambient, Downtempo, Meditation", bitrateKbps: 128, codec: "MP3", category: "calm", categoryLabel: "Calm", tags: ["Ambient", "Downtempo"], broadcaster: "Soma FM", sortOrder: 511 },
  { id: "radio-512", label: "Calm - Soma FM Synphaera", uri: "http://ice1.somafm.com/synphaera-128-mp3", genre: "Calm, Ambient, Meditation, Space", bitrateKbps: 128, codec: "MP3", category: "calm", categoryLabel: "Calm", tags: ["Ambient", "Space"], broadcaster: "Soma FM", sortOrder: 512 },
  { id: "radio-520", label: "Sleep - Ambient Sleeping Pill", uri: "http://radio.stereoscenic.com/asp-h", genre: "Sleep, Ambient", bitrateKbps: 256, codec: "MP3", category: "sleep", categoryLabel: "Sleep", tags: ["Ambient"], broadcaster: "Stereoscenic", sortOrder: 520 },
  { id: "radio-521", label: "Sleep - Soma FM Drone Zone", uri: "http://ice1.somafm.com/dronezone-128-aac", genre: "Sleep, Electronica, Ambient, Texture", bitrateKbps: 128, codec: "AAC", category: "sleep", categoryLabel: "Sleep", tags: ["Ambient", "Texture"], broadcaster: "Soma FM", sortOrder: 521 },
  { id: "radio-522", label: "Sleep - Soma FM Deep Space One", uri: "http://ice1.somafm.com/deepspaceone-128-aac", genre: "Sleep, Electronica, Ambient, Space Music", bitrateKbps: 128, codec: "AAC", category: "sleep", categoryLabel: "Sleep", tags: ["Ambient", "Space"], broadcaster: "Soma FM", sortOrder: 522 },
  { id: "radio-530", label: "Jazz - Jazz24", uri: "https://knkx-live-a.edge.audiocdn.com/6285_256k", genre: "Jazz", bitrateKbps: 256, codec: "AAC", category: "jazz", categoryLabel: "Jazz", tags: [], broadcaster: "Jazz24.org", sortOrder: 530 },
  { id: "radio-531", label: "Jazz - The Jazz Groove", uri: "https://west-mp3-128.streamthejazzgroove.com/stream", genre: "Jazz", bitrateKbps: 128, codec: "MP3", category: "jazz", categoryLabel: "Jazz", tags: [], broadcaster: "The Jazz Groove", sortOrder: 531 },
  { id: "radio-532", label: "Jazz - Linn Jazz", uri: "http://linn.co.uk:8000/autodj", genre: "Jazz", bitrateKbps: 320, codec: "MP3", category: "jazz", categoryLabel: "Jazz", tags: [], broadcaster: "Linn", sortOrder: 532 },
  { id: "radio-590", label: "Classical - BR-Klassik", uri: "https://dispatcher.rndfnk.com/br/brklassik/live/mp3/high", genre: "Classical", bitrateKbps: 192, codec: "MP3", category: "classical", categoryLabel: "Classical", tags: [], broadcaster: "Bayern Radio", sortOrder: 590 },
  { id: "radio-591", label: "Classical - NPO Klassiek", uri: "http://icecast.omroep.nl/radio4-bb-mp3", genre: "Classical", bitrateKbps: 192, codec: "MP3", category: "classical", categoryLabel: "Classical", tags: [], broadcaster: "NPO", sortOrder: 591 },
  { id: "radio-592", label: "Classical - Linn Classical", uri: "http://linn.co.uk:8004/autodj", genre: "Classical", bitrateKbps: 320, codec: "MP3", category: "classical", categoryLabel: "Classical", tags: [], broadcaster: "Linn", sortOrder: 592 },
  { id: "radio-600", label: "News - NPR Program Stream", uri: "https://npr-ice.streamguys1.com/live.mp3", genre: "News, Public Radio, Talk", bitrateKbps: 128, codec: "MP3", category: "news", categoryLabel: "News", tags: ["Public Radio", "Talk"], broadcaster: "NPR", sortOrder: 600 },
  { id: "radio-601", label: "News - DR P1", uri: "http://live-icy.dr.dk/A/A03H.mp3", genre: "News, Talk", bitrateKbps: 128, codec: "MP3", category: "news", categoryLabel: "News", tags: ["Talk"], broadcaster: "DR", sortOrder: 601 },
  { id: "radio-602", label: "News - Radio SRF 4 News", uri: "http://streaming.swisstxt.ch/m/drs4news/mp3_128", genre: "News, Current Affairs", bitrateKbps: 128, codec: "MP3", category: "news", categoryLabel: "News", tags: ["Current Affairs"], broadcaster: "SRF", sortOrder: 602 },
  { id: "radio-610", label: "Hi-Fi - Radio Paradise FLAC", uri: "https://stream.radioparadise.com/flacm", genre: "Hi-Fi, Eclectic", bitrateKbps: 900, codec: "FLAC", category: "hifi", categoryLabel: "Hi-Fi", tags: ["Eclectic"], broadcaster: "Radio Paradise", sortOrder: 610 },
  { id: "radio-611", label: "Hi-Fi - Naim Radio", uri: "http://mscp3.live-streams.nl:8360/high.aac", genre: "Hi-Fi, Eclectic", bitrateKbps: 320, codec: "AAC", category: "hifi", categoryLabel: "Hi-Fi", tags: ["Eclectic"], broadcaster: "Naim", sortOrder: 611 },
  { id: "radio-612", label: "Hi-Fi - Linn Radio", uri: "http://linn.co.uk:8003/autodj", genre: "Hi-Fi, Eclectic", bitrateKbps: 320, codec: "MP3", category: "hifi", categoryLabel: "Hi-Fi", tags: ["Eclectic"], broadcaster: "Linn", sortOrder: 612 },
  { id: "radio-540", label: "Blues - 1.FM Blues Radio", uri: "http://strm112.1.fm/blues_mobile_mp3", genre: "Blues", bitrateKbps: 192, codec: "MP3", category: "blues", categoryLabel: "Blues", tags: [], broadcaster: "1.FM", sortOrder: 540 },
  { id: "radio-541", label: "Blues - WDCB Chicago Jazz & Blues", uri: "http://wdcb-ice.streamguys.org:80/wdcb128", genre: "Blues, Jazz", bitrateKbps: 128, codec: "MP3", category: "blues", categoryLabel: "Blues", tags: ["Jazz"], broadcaster: "DuPage College", sortOrder: 541 },
  { id: "radio-542", label: "Blues - WWOZ New Orleans", uri: "https://www.wwoz.org/listen/hi", genre: "Blues, Jazz, Funk", bitrateKbps: 128, codec: "MP3", category: "blues", categoryLabel: "Blues", tags: ["Jazz", "Funk"], broadcaster: "WWOZ", sortOrder: 542 },
  { id: "radio-550", label: "Rock - Radio Paradise Rock", uri: "https://stream.radioparadise.com/rock-flacm", genre: "Rock", bitrateKbps: 900, codec: "FLAC", category: "rock", categoryLabel: "Rock", tags: [], broadcaster: "Radio Paradise", sortOrder: 550 },
  { id: "radio-551", label: "Rock - Radio Caroline", uri: "http://sc3.radiocaroline.net:8030", genre: "Rock, Classic Rock", bitrateKbps: 96, codec: "MP3", category: "rock", categoryLabel: "Rock", tags: ["Classic Rock"], broadcaster: "Radio Caroline", sortOrder: 551 },
  { id: "radio-552", label: "Rock - Soma FM Digitalis", uri: "http://ice1.somafm.com/digitalis-128-aac", genre: "Rock, Indie", bitrateKbps: 128, codec: "AAC", category: "rock", categoryLabel: "Rock", tags: ["Indie"], broadcaster: "Soma FM", sortOrder: 552 },
  { id: "radio-560", label: "World - Radio Paradise World", uri: "https://stream.radioparadise.com/world-flacm", genre: "World, World Music", bitrateKbps: 900, codec: "FLAC", category: "world", categoryLabel: "World", tags: [], broadcaster: "Radio Paradise", sortOrder: 560 },
  { id: "radio-561", label: "World - Hi On Line World", uri: "http://mediaserv38.live-streams.nl:8027/live", genre: "World, World Music", bitrateKbps: 320, codec: "MP3", category: "world", categoryLabel: "World", tags: [], broadcaster: "Hi.Fine", sortOrder: 561 },
  { id: "radio-562", label: "World - Soma FM Suburbs of Goa", uri: "http://ice1.somafm.com/suburbsofgoa-128-aac", genre: "World, World Music, Desi", bitrateKbps: 128, codec: "AAC", category: "world", categoryLabel: "World", tags: ["Desi"], broadcaster: "Soma FM", sortOrder: 562 },
  { id: "radio-570", label: "Electronic - FluxFM ElectroFlux", uri: "https://channels.fluxfm.de/elektro-flux/stream.mp3", genre: "Electronic, Pop", bitrateKbps: 256, codec: "MP3", category: "electronic", categoryLabel: "Electronic", tags: ["Pop"], broadcaster: "FluxFM", sortOrder: 570 },
  { id: "radio-571", label: "Electronic - FluxFM Techno Underground", uri: "https://channels.fluxfm.de/techno-underground/stream.mp3", genre: "Electronic, Techno", bitrateKbps: 256, codec: "MP3", category: "electronic", categoryLabel: "Electronic", tags: ["Techno"], broadcaster: "FluxFM", sortOrder: 571 },
  { id: "radio-572", label: "Electronic - Soma FM PopTron", uri: "http://ice1.somafm.com/poptron-128-aac", genre: "Electronic, Electro-Pop", bitrateKbps: 128, codec: "AAC", category: "electronic", categoryLabel: "Electronic", tags: ["Electro-Pop"], broadcaster: "Soma FM", sortOrder: 572 },
  { id: "radio-580", label: "Podcast - BBC Radio 4", uri: "http://lsn.lv/bbcradio.m3u8?station=bbc_radio_fourfm&bitrate=96000", genre: "Podcast, Spoken Word, Talk", bitrateKbps: 96, codec: "AAC-LC", category: "podcast", categoryLabel: "Podcast", tags: ["Spoken Word", "Talk"], broadcaster: "BBC", sortOrder: 580 },
  { id: "radio-581", label: "Podcast - France Culture Live", uri: "http://direct.franceculture.fr/live/franceculture-midfi.mp3", genre: "Podcast, Spoken Word, Current Affairs", bitrateKbps: 128, codec: "MP3", category: "podcast", categoryLabel: "Podcast", tags: ["Spoken Word"], broadcaster: "Radio France", sortOrder: 581 },
  { id: "radio-582", label: "Podcast - NPR Program Stream", uri: "https://npr-ice.streamguys1.com/live.mp3", genre: "Podcast, Public Radio, Talk", bitrateKbps: 128, codec: "MP3", category: "podcast", categoryLabel: "Podcast", tags: ["Public Radio", "Talk"], broadcaster: "NPR", sortOrder: 582 }
];

export const radioStations: RadioStationSummary[] = [
  ...tikpalRadioStationRows.map((station) => buildRadioStation({
    ...station,
    logoUrl: null,
    catalogSource: "tikpal",
    secondaryStatus: [
      station.categoryLabel,
      station.broadcaster,
      `${station.bitrateKbps} kbps`,
      station.codec
    ].join(" · "),
    active: false
  })),
  buildRadioStation({
    id: "radio-1",
    label: "1.FM - Blues Radio",
    uri: "http://strm112.1.fm/blues_mobile_mp3",
    genre: "Blues",
    bitrateKbps: 192,
    codec: "MP3",
    category: null,
    categoryLabel: null,
    tags: ["Blues"],
    broadcaster: "1.FM",
    logoUrl: null,
    catalogSource: "moode",
    sortOrder: 1,
    secondaryStatus: "Blues · 192 kbps MP3",
    active: false
  })
];

export const lyricsState: LyricsState = {
  status: "ready",
  sourceScope: "local_playback",
  providerMode: "online",
  recognitionMode: "metadata",
  recognitionProvider: "lrclib",
  recognitionConfidence: null,
  trackKey: "mock:get-lucky:daft-punk",
  title: "Get Lucky (feat. Pharrell Williams)",
  artist: "Daft Punk",
  synced: true,
  timingStrategy: "provider_synced",
  activeLineIndex: null,
  lines: [
    { text: "Like the legend of the phoenix", startMs: 12000, endMs: 18000 },
    { text: "All ends with beginnings", startMs: 18000, endMs: 23500 },
    { text: "What keeps the planet spinning", startMs: 23500, endMs: 30000 },
    { text: "The force from the beginning", startMs: 30000, endMs: 36000 }
  ],
  message: null,
  updatedAt: new Date().toISOString()
};

export const fallbackTikpalState: TikpalState = {
  playback,
  system: systemState,
  runtime: {
    rendererType: "media",
    requestedRenderer: "media",
    renderProfile: "standard",
    kioskWindow: "2560x720",
    appVersion: "0.1.0",
    apiMode: "mock",
    updatedAt: new Date().toISOString()
  },
  audio: audioState,
  lyrics: lyricsState,
  preferences: {
    locale: "en",
    inputMethodId: "keyboard-us",
    fontTheme: "system",
    audioOutputProfile: "everyday",
    audioOutputCustomSettings: {
      pureDirect: false,
      volumeNormalization: true,
      smoothTransition: true,
      automaticSampleRate: true,
      dsdMode: false,
      playbackStability: true
    },
    audioOutputCapabilities: {
      purePath: "unknown",
      targetRateHz: null
    },
    mpdBitPerfectMode: "standard",
    displaySleepEnabled: true,
    displaySleepMinutes: 10,
    displaySleepStyle: "meteor_shower",
    updatedAt: null,
    warning: null
  }
};

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "--:--";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

export function formatSampleRate(rate: number | null): string {
  if (!rate) return "--";
  if (rate >= 1000) return `${Math.round(rate / 1000)}kHz`;
  return `${rate}Hz`;
}

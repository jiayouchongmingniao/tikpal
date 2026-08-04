import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { buildProxyConfig, buildProxyKey, normalizeProviderTextScale } from "../deploy/chromium/web-mode-extension/background.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const requiredFiles = [
  "server/index.mjs",
  "server/web.mjs",
  "docs/06-deployment/gentoo-kiosk-deploy-v1.md",
  "docs/06-deployment/raspberry-pi-kiosk-deploy-v1.md",
  "deploy/chromium/launch-tikpal-kiosk.sh",
  "deploy/chromium/start-tikpal-kiosk-devtools-proxy.sh",
  "deploy/chromium/start-tikpal-kiosk-display.sh",
  "deploy/chromium/start-tikpal-kiosk-session.sh",
  "deploy/chromium/start-tikpal-kiosk-viewer.sh",
  "deploy/chromium/onboard-scripts/tikpalImeToggle.py",
  "deploy/chromium/onboard-themes/Tikpal-Classic.colors",
  "deploy/chromium/tikpal-kiosk-healthcheck.sh",
  "deploy/chromium/tikpal-physical-display-prepare.sh",
  "deploy/chromium/tikpal-kiosk-viewerctl.sh",
  "deploy/chromium/tikpal-web-mode.sh",
  "deploy/chromium/tikpal-web-mode-guard.mjs",
  "deploy/chromium/tikpal-web-mode-qq-confirm.mjs",
  "deploy/chromium/web-mode-extension/manifest.json",
  "deploy/chromium/web-mode-extension/background.js",
  "deploy/chromium/web-mode-extension/content.js",
  "deploy/chromium/web-mode-extension/netease-audio-mirror.js",
  "deploy/chromium/chromium-flags.conf",
  "deploy/chromium/managed-policies.json",
  "deploy/chromium/env.kiosk.example",
  "deploy/turzx/install-turzx-evdi-display.sh",
  "deploy/turzx/README.md",
  "src/i18n.tsx",
  "deploy/moode/tikpal-audio-adapt.sh",
  "deploy/moode/tikpal-audio-output-profile.sh",
  "deploy/moode/tikpal-local-library-sync.sh",
  "deploy/moode/tikpal-library-sync.sh",
  "deploy/moode/tikpal-multiroom-state.sh",
  "deploy/moode/tikpal-mpd-bitperfect-profile.sh",
  "deploy/moode/tikpal-nas-mount.sh",
  "deploy/moode/tikpal-usb-library-sync.sh",
  "deploy/moode/tikpal-radio-presets-sync.sh",
  "deploy/moode/tikpal-upnp-ready.sh",
  "deploy/moode/tikpal-upnp-configure.sh",
  "deploy/moode/tikpal-upnp-enable.sh",
  "deploy/moode/tikpal-upnp-disable.sh",
  "deploy/moode/tikpal-upnp-label.sh",
  "deploy/moode/tikpal-upnp-metadata.sh",
  "public/web-mode-error.html",
  "public/web-mode-background.html",
  "deploy/moode/tikpal-alsa-loopback.sh",
  "deploy/moode/tikpal-airplay-enable.sh",
  "deploy/moode/tikpal-airplay-transport.sh",
  "deploy/moode/tikpal-output-volume.sh",
  "deploy/moode/tikpal-snd-aloop-enable.sh",
  "deploy/moode/tikpal-quiet-boot-enable.sh",
  "deploy/systemd/tikpal-audio-adapt.service",
  "deploy/systemd/tikpal-library-sync.service",
  "deploy/systemd/tikpal-api.service",
  "deploy/systemd/tikpal-web.service",
  "deploy/systemd/tikpal-kiosk-devtools.service",
  "deploy/systemd/tikpal-kiosk.service",
  "deploy/systemd/tikpal-kiosk-viewer.service",
  "deploy/systemd/tikpal-kiosk-watchdog.service",
  "deploy/systemd/tikpal-kiosk-watchdog.timer",
  "deploy/systemd/install-systemd-services.sh"
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertThrows(callback, message) {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error(message);
}

async function assertExecutable(file) {
  await access(path.join(ROOT, file), constants.X_OK);
}

async function getFreePorts(count) {
  const servers = Array.from({ length: count }, () => createNetServer());
  await Promise.all(servers.map((server) => new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  })));
  const ports = servers.map((server) => server.address().port);
  await Promise.all(servers.map((server) => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
  return ports;
}

function requestWeb(port, pathname = "/", method = "GET") {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method,
      headers: { Host: `192.0.2.10:${port}` }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    request.once("error", reject);
    request.end();
  });
}

async function waitForWeb(port) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await requestWeb(port);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`web server did not start on port ${port}`);
}

async function run() {
  for (const file of requiredFiles) {
    const info = await stat(path.join(ROOT, file));
    assert(info.isFile(), `${file} should be a file`);
  }

  assert(buildProxyConfig({ proxyEnabled: false }).mode === "direct", "extension should apply direct mode when the proxy is off");
  for (const [proxyUrl, expectedScheme] of [
    ["proxy.local:8080", "http"],
    ["http://proxy.local:8080", "http"],
    ["https://proxy.local:8443", "https"],
    ["socks5://proxy.local:1080", "socks5"]
  ]) {
    const config = buildProxyConfig({ proxyEnabled: true, proxyUrl });
    assert(config.mode === "fixed_servers", `${expectedScheme} proxy should use fixed_servers`);
    assert(config.rules.singleProxy.scheme === expectedScheme, `${expectedScheme} proxy should preserve its scheme`);
    assert(config.rules.bypassList.includes("localhost") && config.rules.bypassList.includes("127.0.0.1") && config.rules.bypassList.includes("<local>"), "extension proxy should bypass loopback hosts");
  }
  assert(buildProxyConfig({ proxyEnabled: true, proxyUrl: "http://proxy.local:8080" }, "qq_music").mode === "direct", "QQ Music should stay direct even when global Explore proxy is on");
  assert(buildProxyConfig({ proxyEnabled: true, proxyUrl: "http://proxy.local:8080" }, "netease_music").mode === "direct", "NetEase Cloud Music should stay direct even when global Explore proxy is on");
  assert(
    buildProxyKey({ proxyEnabled: true, proxyUrl: "http://proxy.local:8080" }, "qq_music")
      !== buildProxyKey({ proxyEnabled: true, proxyUrl: "http://proxy.local:8080" }, "spotify"),
    "provider-specific proxy mode should be part of the extension proxy key"
  );
  assertThrows(() => buildProxyConfig({ proxyEnabled: true, proxyUrl: "ftp://proxy.local:21" }), "extension should reject unsupported proxy protocols");
  assert(normalizeProviderTextScale(1.2) === 1.2 && normalizeProviderTextScale("1.10") === 1.1, "extension should normalize supported provider text scales");
  assert(normalizeProviderTextScale(1.05) === 1.1, "extension should keep provider text scale to the supported Small / Medium / Large values");
  assert(
    buildProxyKey({ proxyEnabled: true, proxyUrl: "http://proxy.local:8080", providerTextScale: 1 })
      === buildProxyKey({ proxyEnabled: true, proxyUrl: "http://proxy.local:8080", providerTextScale: 1.2 }),
    "provider text scale changes should not change the extension proxy key"
  );

  await assertExecutable("deploy/chromium/launch-tikpal-kiosk.sh");
  await assertExecutable("deploy/chromium/start-tikpal-kiosk-devtools-proxy.sh");
  await assertExecutable("deploy/chromium/start-tikpal-kiosk-display.sh");
  await assertExecutable("deploy/chromium/start-tikpal-kiosk-session.sh");
  await assertExecutable("deploy/chromium/start-tikpal-kiosk-viewer.sh");
  await assertExecutable("deploy/chromium/tikpal-kiosk-healthcheck.sh");
  await assertExecutable("deploy/chromium/tikpal-physical-display-prepare.sh");
  await assertExecutable("deploy/chromium/tikpal-kiosk-viewerctl.sh");
  await assertExecutable("deploy/chromium/tikpal-web-mode.sh");
  await assertExecutable("deploy/turzx/install-turzx-evdi-display.sh");
  await assertExecutable("deploy/moode/tikpal-audio-adapt.sh");
  await assertExecutable("deploy/moode/tikpal-audio-output-profile.sh");
  await assertExecutable("deploy/moode/tikpal-local-library-sync.sh");
  await assertExecutable("deploy/moode/tikpal-library-sync.sh");
  await assertExecutable("deploy/moode/tikpal-multiroom-state.sh");
  await assertExecutable("deploy/moode/tikpal-mpd-bitperfect-profile.sh");
  await assertExecutable("deploy/moode/tikpal-nas-mount.sh");
  await assertExecutable("deploy/moode/tikpal-usb-library-sync.sh");
  await assertExecutable("deploy/moode/tikpal-radio-presets-sync.sh");
  await assertExecutable("deploy/moode/tikpal-upnp-ready.sh");
  await assertExecutable("deploy/moode/tikpal-upnp-configure.sh");
  await assertExecutable("deploy/moode/tikpal-upnp-enable.sh");
  await assertExecutable("deploy/moode/tikpal-upnp-disable.sh");
  await assertExecutable("deploy/moode/tikpal-upnp-label.sh");
  await assertExecutable("deploy/moode/tikpal-upnp-metadata.sh");
  await assertExecutable("deploy/moode/tikpal-alsa-loopback.sh");
  await assertExecutable("deploy/moode/tikpal-airplay-transport.sh");
  await assertExecutable("deploy/moode/tikpal-output-volume.sh");
  await assertExecutable("deploy/moode/tikpal-snd-aloop-enable.sh");
  await assertExecutable("deploy/moode/tikpal-quiet-boot-enable.sh");
  await assertExecutable("deploy/moode/tikpal-locale-enable.sh");
  await assertExecutable("deploy/systemd/install-systemd-services.sh");

  const audioProfileHelperSource = await readFile(path.join(ROOT, "deploy/moode/tikpal-audio-output-profile.sh"), "utf8");
  assert(audioProfileHelperSource.includes("Tikpal Pure Listening"), "Audio Output helper should include Pure Listening");
  assert(audioProfileHelperSource.includes("Tikpal Everyday"), "Audio Output helper should include Everyday");
  assert(audioProfileHelperSource.includes("Tikpal Sleep Meditation"), "Audio Output helper should include Sleep / Meditation");
  assert(audioProfileHelperSource.includes("Tikpal Custom"), "Audio Output helper should include Custom profile");
  assert(audioProfileHelperSource.includes("TIKPAL_MPD_CUSTOM_PURE_DIRECT"), "Custom Audio Output helper should support Pure Direct");
  assert(audioProfileHelperSource.includes("TIKPAL_MPD_CUSTOM_VOLUME_NORMALIZATION"), "Custom Audio Output helper should support Volume Normalization");
  assert(audioProfileHelperSource.includes("TIKPAL_MPD_CUSTOM_SMOOTH_TRANSITION"), "Custom Audio Output helper should support Smooth Transition");
  assert(audioProfileHelperSource.includes("TIKPAL_MPD_CUSTOM_AUTOMATIC_SAMPLE_RATE"), "Custom Audio Output helper should support Automatic Sample Rate");
  assert(audioProfileHelperSource.includes("TIKPAL_MPD_CUSTOM_DSD_MODE") && audioProfileHelperSource.includes("dop"), "Custom Audio Output helper should support DSD DoP mode");
  assert(audioProfileHelperSource.includes("TIKPAL_MPD_CUSTOM_PLAYBACK_STABILITY") && audioProfileHelperSource.includes("buffer_time"), "Custom Audio Output helper should support Playback Stability");
  assert(audioProfileHelperSource.includes("${sleep_rate}:*:*"), "Sleep profile should use MPD format sample-rate wildcard semantics");
  assert(audioProfileHelperSource.includes("mixer_type=\"none\"") || audioProfileHelperSource.includes("mixer_type=\"none\""), "Pure profile should disable MPD mixer");
  const bitperfectWrapperSource = await readFile(path.join(ROOT, "deploy/moode/tikpal-mpd-bitperfect-profile.sh"), "utf8");
  assert(bitperfectWrapperSource.includes("exec \"$profile_helper\" pure"), "Legacy strict mode should map to Pure profile");
  assert(bitperfectWrapperSource.includes("exec \"$profile_helper\" everyday"), "Legacy standard mode should map to Everyday profile");
  const quickSettingsAudioSource = await readFile(path.join(ROOT, "src/components/QuickSettingsOverlay.tsx"), "utf8");
  assert(quickSettingsAudioSource.includes("data-audio-output-profile={choice.id}"), "Settings Audio Output should expose profile test hooks");
  assert(quickSettingsAudioSource.includes('id: "custom"'), "Settings Audio Output should show a Custom profile card");
  assert(quickSettingsAudioSource.includes("data-custom-audio-settings"), "Settings Audio Output should expose Custom switches when Custom is selected");
  assert(quickSettingsAudioSource.includes("data-custom-audio-warning"), "Custom Audio Output should show a visible caution line");
  assert(quickSettingsAudioSource.includes("data-custom-audio-toggle={choice.id}"), "Custom Audio Output switches should expose per-setting test hooks");
  assert(quickSettingsAudioSource.includes("is-custom-active"), "Custom Audio Output layout should use the compact profile rail");
  assert(quickSettingsAudioSource.includes("audio-output-header-dac"), "Audio Output detail should place DAC detail in the header");
  assert(quickSettingsAudioSource.includes("audio-output-diagnostics-chip"), "Audio Output detail should expose a touchable advanced-info hint");
  assert(quickSettingsAudioSource.includes('t("settings.openAudioOutput")'), "Preferences cards should use action-oriented Audio Output copy");
  assert(quickSettingsAudioSource.includes('t("settings.manageRooms")'), "Multi-room Settings card should use a concise management action");
  assert(quickSettingsAudioSource.includes('t("nas.checkSetupNext")'), "NAS setup errors should include a next-step hint");
  assert(!quickSettingsAudioSource.includes('mpdQualityError ?? (preferencesPending ? t("common.applying") : t("settings.mpdQualityMeta"))'), "Audio Output detail should not show redundant profile ids as the default footer");
  assert(!quickSettingsAudioSource.includes('settings-detail-note-grid" aria-label={t("settings.mpdQuality")}'), "Audio Output detail should not use boxed note cards beside profiles");
  assert(quickSettingsAudioSource.includes("audioDiagnostics"), "Audio Output should keep diagnostics behind a hidden detail");
  assert(quickSettingsAudioSource.includes("parseAudioDiagnosticsText"), "Audio Diagnostics should parse helper text into friendly groups");
  assert(quickSettingsAudioSource.includes('kind: "multiroom"'), "Settings should expose Multi-room Audio instead of a Roon-only card");
  assert(quickSettingsAudioSource.includes('multiroomEcosystemChoices: MultiroomEcosystemId[] = ["roon", "lyrion", "tikpal", "music_assistant"]'), "Settings Multi-room should show all four ecosystems in order");
  assert(quickSettingsAudioSource.includes("settings.multiroomComingSoon"), "Settings Multi-room should show a Coming soon placeholder");
  const multiroomHelperSource = await readFile(path.join(ROOT, "deploy/moode/tikpal-multiroom-state.sh"), "utf8");
  assert(multiroomHelperSource.includes("RoonBridge|RAATServer"), "Multi-room helper should detect Roon ALSA ownership");
  assert(multiroomHelperSource.includes("squeezelite"), "Multi-room helper should support Lyrion / Squeezelite");
  assert(multiroomHelperSource.includes("tikpal-multiroom|snapclient|snapserver"), "Multi-room helper should support Tikpal Multi-room ownership");
  assert(quickSettingsAudioSource.includes("data-audio-diagnostics-grid"), "Audio Diagnostics should expose a horizontal grid test hook");
  assert(quickSettingsAudioSource.includes("settings.audioDiagnosticsNoActiveStream"), "Audio Diagnostics should show a friendly empty stream state");
  const audioDiagnosticsStylesSource = await readFile(path.join(ROOT, "src/styles.css"), "utf8");
  assert(audioDiagnosticsStylesSource.includes(".audio-output-title-row"), "Audio Output should style the title/DAC row");
  assert(audioDiagnosticsStylesSource.includes('.settings-detail-panel[data-settings-detail="audio-output"].is-custom-active'), "Custom Audio Output should compact the full detail panel");
  assert(audioDiagnosticsStylesSource.includes(".audio-output-detail-body.is-custom-active .audio-profile-option"), "Custom Audio Output should compact the preset cards so all switches fit");
  assert(!quickSettingsAudioSource.includes("settings-diagnostics-chip-row"), "Audio Diagnostics should not duplicate summary chips above the cards");
  assert(audioDiagnosticsStylesSource.includes(".settings-diagnostics-raw"), "Audio Diagnostics should keep raw text folded separately");

  const outputVolumeTempDir = mkdtempSync(path.join(tmpdir(), "tikpal-output-volume-"));
  const outputVolumeBinDir = path.join(outputVolumeTempDir, "bin");
  const outputVolumeConfig = path.join(outputVolumeTempDir, "audioout.conf");
  const fakeAmixerLog = path.join(outputVolumeTempDir, "amixer.log");
  const fakeMpcLog = path.join(outputVolumeTempDir, "mpc.log");
  mkdirSync(outputVolumeBinDir);
  writeFileSync(path.join(outputVolumeBinDir, "amixer"), `#!/bin/sh\necho "$*" >> "$TIKPAL_FAKE_AMIXER_LOG"\nexit 1\n`, { mode: 0o755 });
  writeFileSync(path.join(outputVolumeBinDir, "mpc"), `#!/bin/sh\necho "$*" >> "$TIKPAL_FAKE_MPC_LOG"\nif [ "$1" = "volume" ]; then\n  echo "volume: $2%   repeat: off   random: off   single: off   consume: off"\n  exit 0\nfi\necho "volume:  27%   repeat: off   random: off   single: off   consume: off"\n`, { mode: 0o755 });
  writeFileSync(outputVolumeConfig, 'pcm._audioout { slave.pcm "default:CARD=Crimson" }\npcm.loop { slave.pcm "default:CARD=Loopback" }\n');
  const outputVolumeEnv = {
    ...process.env,
    PATH: `${outputVolumeBinDir}:${process.env.PATH}`,
    TIKPAL_OUTPUT_VOLUME_ALSA_CONFIGS: outputVolumeConfig,
    TIKPAL_FAKE_AMIXER_LOG: fakeAmixerLog,
    TIKPAL_FAKE_MPC_LOG: fakeMpcLog
  };
  const outputVolumeHelper = path.join(ROOT, "deploy/moode/tikpal-output-volume.sh");
  const outputVolumeGet = spawnSync("sh", [outputVolumeHelper, "get"], { env: outputVolumeEnv, encoding: "utf8" });
  assert(outputVolumeGet.status === 0 && outputVolumeGet.stdout.includes("[27%]"), "output volume helper should fall back to MPD software volume when ALSA has no mixer");
  const outputVolumeSet = spawnSync("sh", [outputVolumeHelper, "set", "46"], { env: outputVolumeEnv, encoding: "utf8" });
  assert(outputVolumeSet.status === 0, "output volume helper should set MPD software volume when ALSA has no mixer");
  const fakeAmixerOutput = await readFile(fakeAmixerLog, "utf8");
  const fakeMpcOutput = await readFile(fakeMpcLog, "utf8");
  assert(!fakeAmixerOutput.includes("CARD=Loopback"), "output volume helper should normalize default:CARD=Loopback before probing mixer cards");
  assert(fakeMpcOutput.includes("volume 46"), "output volume helper should issue mpc volume for mixerless USB DACs");

  const outputVolumeMixerDir = mkdtempSync(path.join(tmpdir(), "tikpal-output-volume-mixer-"));
  const outputVolumeMixerBinDir = path.join(outputVolumeMixerDir, "bin");
  const outputVolumeMixerConfig = path.join(outputVolumeMixerDir, "audioout.conf");
  const outputVolumeMixerLog = path.join(outputVolumeMixerDir, "amixer.log");
  mkdirSync(outputVolumeMixerBinDir);
  writeFileSync(path.join(outputVolumeMixerBinDir, "amixer"), `#!/bin/sh
echo "$*" >> "$TIKPAL_FAKE_AMIXER_LOG"
card=""
action=""
control=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -c) card="$2"; shift 2 ;;
    get|sset) action="$1"; control="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [ "$card" = "Mystery" ] && [ "$control" = "Master" ]; then
  echo "Front Left: Playback 74 [42%] [on]"
  exit 0
fi
exit 1
`, { mode: 0o755 });
  writeFileSync(outputVolumeMixerConfig, 'pcm._audioout { slave.pcm "plughw:CARD=Mystery,DEV=0" }\n');
  const outputVolumeMixerEnv = {
    ...process.env,
    PATH: `${outputVolumeMixerBinDir}:${process.env.PATH}`,
    TIKPAL_OUTPUT_VOLUME_ALSA_CONFIGS: outputVolumeMixerConfig,
    TIKPAL_FAKE_AMIXER_LOG: outputVolumeMixerLog
  };
  const outputVolumeMixerGet = spawnSync("sh", [outputVolumeHelper, "get"], { env: outputVolumeMixerEnv, encoding: "utf8" });
  assert(outputVolumeMixerGet.status === 0 && outputVolumeMixerGet.stdout.includes("[42%]"), "output volume helper should discover non-PCM mixer controls");
  const outputVolumeMixerSet = spawnSync("sh", [outputVolumeHelper, "set", "41"], { env: outputVolumeMixerEnv, encoding: "utf8" });
  assert(outputVolumeMixerSet.status === 0, "output volume helper should set non-PCM mixer controls");
  const outputVolumeMixerAmixer = await readFile(outputVolumeMixerLog, "utf8");
  assert(outputVolumeMixerAmixer.includes("-c Mystery sset Master 41%"), "output volume helper should set the discovered Master mixer");

  const audioAdaptTempDir = mkdtempSync(path.join(tmpdir(), "tikpal-audio-adapt-"));
  const audioAdaptBinDir = path.join(audioAdaptTempDir, "bin");
  mkdirSync(audioAdaptBinDir);
  writeFileSync(path.join(audioAdaptBinDir, "aplay"), `#!/bin/sh
if [ "$1" = "-l" ]; then
  printf '%s\\n' "$TIKPAL_FAKE_APLAY_CARDS"
  exit 0
fi
device=""
format=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -D) device="$2"; shift 2 ;;
    -f) format="$2"; shift 2 ;;
    *) shift ;;
  esac
done
case "$device" in
  dmix:CARD=Crimson,DEV=0)
    [ "$format" = "S24_3LE" ] || exit 1
    cat >/dev/null
    exit 0
    ;;
  *) cat >/dev/null; exit 0 ;;
esac
`, { mode: 0o755 });
  writeFileSync(path.join(audioAdaptBinDir, "amixer"), `#!/bin/sh
card=""
action=""
control=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -c) card="$2"; shift 2 ;;
    get|sset) action="$1"; control="$2"; shift 2 ;;
    *) shift ;;
  esac
done
case "$card:$control" in
  BT66:PCM) echo "Mono: Playback 89 [35%] [on]"; exit 0 ;;
  Mystery:Master) echo "Front Left: Playback 74 [42%] [on]"; exit 0 ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 });
  const audioAdaptHelper = path.join(ROOT, "deploy/moode/tikpal-audio-adapt.sh");
  const runAudioAdapt = (cards, args, extraEnv = {}) => spawnSync("bash", [audioAdaptHelper, ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      ...extraEnv,
      PATH: `${audioAdaptBinDir}:${process.env.PATH}`,
      TIKPAL_FAKE_APLAY_CARDS: cards,
      TIKPAL_AUDIO_BROWSER_PROBE_TIMEOUT_SECONDS: "1"
    },
    encoding: "utf8"
  });
  const bt66Card = "card 2: BT66 [BT66], device 0: USB Audio [USB Audio]";
  const crimsonCard = "card 1: Crimson [SPL Crimson], device 0: USB Audio [USB Audio]";
  const hdmiCard = "card 0: vc4hdmi0 [vc4-hdmi-0], device 0: MAI PCM i2s-hifi-0 [MAI PCM i2s-hifi-0]";
  const mysteryCard = "card 4: Mystery [Mystery USB DAC], device 0: USB Audio [USB Audio]";
  const otherCard = "card 5: Other [Other USB DAC], device 0: USB Audio [USB Audio]";
  const bt66Resolve = runAudioAdapt(`${hdmiCard}\n${crimsonCard}\n${bt66Card}`, ["resolve-browser"]);
  assert(bt66Resolve.status === 0 && bt66Resolve.stdout.trim() === "dmix:CARD=BT66,DEV=0", `audio adapter should prefer BT66 and use dmix:\n${bt66Resolve.stdout}\n${bt66Resolve.stderr}`);
  const crimsonResolve = runAudioAdapt(`${hdmiCard}\n${crimsonCard}`, ["resolve-browser"]);
  assert(crimsonResolve.status === 0 && crimsonResolve.stdout.trim() === "tikpal_browser_output", `audio adapter should use a shared conversion PCM for S24-only Crimson browser audio:\n${crimsonResolve.stdout}\n${crimsonResolve.stderr}`);
  const crimsonAudioout = runAudioAdapt(`${hdmiCard}\n${crimsonCard}`, ["resolve-audioout"]);
  assert(crimsonAudioout.status === 0 && crimsonAudioout.stdout.trim() === "plughw:CARD=Crimson,DEV=0", "audio adapter should use plughw for moOde audioout");
  const mysteryCheck = runAudioAdapt(`${hdmiCard}\n${mysteryCard}`, ["check"]);
  assert(mysteryCheck.status === 0 && mysteryCheck.stdout.includes("selectedCard=Mystery") && mysteryCheck.stdout.includes("volumeStrategy=alsa:Master"), `audio adapter should accept one unknown USB card and probe its mixer:\n${mysteryCheck.stdout}\n${mysteryCheck.stderr}`);
  const multipleUnknown = runAudioAdapt(`${hdmiCard}\n${mysteryCard}\n${otherCard}`, ["check"]);
  assert(multipleUnknown.status !== 0 && multipleUnknown.stderr.includes("TIKPAL_AUDIO_CARD_FORCE"), "audio adapter should reject multiple unknown USB cards without a forced card");
  const noUsb = runAudioAdapt(hdmiCard, ["check"]);
  assert(noUsb.status !== 0 && !noUsb.stdout.includes("vc4hdmi"), "audio adapter should not select HDMI as a fallback output");

  const audioAdaptUnit = await readFile(path.join(ROOT, "deploy/systemd/tikpal-audio-adapt.service"), "utf8");
  const librarySyncUnit = await readFile(path.join(ROOT, "deploy/systemd/tikpal-library-sync.service"), "utf8");
  const alsaLoopbackScript = await readFile(path.join(ROOT, "deploy/moode/tikpal-alsa-loopback.sh"), "utf8");
  const airplayEnableScript = await readFile(path.join(ROOT, "deploy/moode/tikpal-airplay-enable.sh"), "utf8");
  const sndAloopEnableScript = await readFile(path.join(ROOT, "deploy/moode/tikpal-snd-aloop-enable.sh"), "utf8");
  const apiUnit = await readFile(path.join(ROOT, "deploy/systemd/tikpal-api.service"), "utf8");
  const webUnit = await readFile(path.join(ROOT, "deploy/systemd/tikpal-web.service"), "utf8");
  const kioskDevtoolsUnit = await readFile(path.join(ROOT, "deploy/systemd/tikpal-kiosk-devtools.service"), "utf8");
  const kioskUnit = await readFile(path.join(ROOT, "deploy/systemd/tikpal-kiosk.service"), "utf8");
  const kioskViewerUnit = await readFile(path.join(ROOT, "deploy/systemd/tikpal-kiosk-viewer.service"), "utf8");
  const kioskWatchdogUnit = await readFile(path.join(ROOT, "deploy/systemd/tikpal-kiosk-watchdog.service"), "utf8");
  const kioskWatchdogTimer = await readFile(path.join(ROOT, "deploy/systemd/tikpal-kiosk-watchdog.timer"), "utf8");
  const systemdInstaller = await readFile(path.join(ROOT, "deploy/systemd/install-systemd-services.sh"), "utf8");
  const physicalDisplayPrepare = await readFile(path.join(ROOT, "deploy/chromium/tikpal-physical-display-prepare.sh"), "utf8");
  const deployDoc = await readFile(path.join(ROOT, "docs/06-deployment/raspberry-pi-kiosk-deploy-v1.md"), "utf8");
  assert(audioAdaptUnit.includes("tikpal-audio-adapt.sh apply"), "audio adapter unit should run the moOde adapter before services");
  assert(audioAdaptUnit.includes("Before=mpd.service tikpal-api.service tikpal-web.service tikpal-kiosk.service"), "audio adapter unit should order before playback and Tikpal services");
  assert(audioAdaptUnit.includes("/usr/sbin:/usr/bin:/sbin:/bin"), "audio adapter unit should include sbin paths so modprobe is available");
  assert(audioAdaptUnit.includes("grep -q Loopback") && audioAdaptUnit.includes("modprobe snd_aloop"), "audio adapter unit should preflight a real Loopback card before app services start");
  assert(librarySyncUnit.includes("tikpal-library-sync.sh apply") && librarySyncUnit.includes("Before=tikpal-api.service"), "library sync service should run before the API exposes library state");
  assert(apiUnit.includes("network.target"), "api unit should use network.target");
  assert(apiUnit.includes("tikpal-audio-adapt.service"), "api unit should pull the audio adapter before startup");
  assert(apiUnit.includes("tikpal-library-sync.service"), "api unit should pull the library sync before startup");
  assert(!apiUnit.includes("network-online.target"), "api unit should not wait for network-online.target");
  assert(webUnit.includes("server/web.mjs"), "web unit should use the production static server");
  assert(webUnit.includes("tikpal-audio-adapt.service"), "web unit should pull the audio adapter before startup");
  assert(webUnit.includes("TIKPAL_WEB_REMOTE_PORT=4174"), "web unit should expose portable remote control separately from the kiosk UI");
  assert(kioskDevtoolsUnit.includes("start-tikpal-kiosk-devtools-proxy.sh"), "kiosk DevTools unit should launch the LAN proxy");
  assert(kioskDevtoolsUnit.includes("PartOf=tikpal-kiosk.service"), "kiosk DevTools proxy should follow kiosk service lifecycle");
  assert(kioskUnit.includes("start-tikpal-kiosk-display.sh"), "kiosk unit should launch the display-mode wrapper");
  assert(kioskUnit.includes("tikpal-audio-adapt.service"), "kiosk unit should pull the audio adapter before startup");
  assert(!kioskUnit.includes("/usr/bin/startx"), "kiosk unit should leave physical versus virtual X startup to the wrapper");
  assert(kioskViewerUnit.includes("start-tikpal-kiosk-viewer.sh"), "kiosk viewer unit should launch the noVNC wrapper");
  assert(kioskViewerUnit.includes(".env.kiosk.viewer"), "kiosk viewer unit should load the viewer-only switch file");
  assert(kioskViewerUnit.includes("PartOf=tikpal-kiosk.service"), "kiosk viewer should follow kiosk service lifecycle");
  assert(kioskWatchdogUnit.includes("tikpal-kiosk-healthcheck.sh"), "kiosk watchdog unit should launch the healthcheck script");
  assert(kioskWatchdogUnit.includes("User=root"), "kiosk watchdog should run as root so it can restart the kiosk service");
  assert(!kioskWatchdogUnit.includes("PartOf=tikpal-kiosk.service"), "kiosk watchdog should survive kiosk restarts");
  assert(kioskWatchdogTimer.includes("OnUnitActiveSec=75s"), "kiosk watchdog timer should run inside the 60-90s cadence");
  assert(kioskWatchdogTimer.includes("tikpal-kiosk-watchdog.service"), "kiosk watchdog timer should target the watchdog service");
  assert(systemdInstaller.includes("tikpal-audio-adapt.service"), "systemd installer should install the audio adapter service");
  assert(systemdInstaller.includes("tikpal-library-sync.service"), "systemd installer should install the library sync service");
  assert(systemdInstaller.includes("tikpal-radio-presets-sync.sh") && systemdInstaller.includes("ensure_radio_presets"), "systemd installer should sync single-layer Radio presets");
  assert(systemdInstaller.includes("ensure_library_scan_env"), "systemd installer should keep Library Scan pointed at the combined sync helper");
  assert(systemdInstaller.includes("ensure_kiosk_audio_release_env") && systemdInstaller.includes("tikpal-release-kiosk-audio.sh"), "systemd installer should add the kiosk audio release hook on mpc Pi installs");
  assert(systemdInstaller.includes("systemctl restart tikpal-audio-adapt.service"), "systemd installer restart should run the audio adapter before app services");
  assert(systemdInstaller.indexOf("systemctl restart tikpal-library-sync.service") < systemdInstaller.indexOf("systemctl restart tikpal-api.service"), "systemd installer restart should sync MPD libraries before the API starts");
  assert(systemdInstaller.includes("tikpal-kiosk-watchdog.service"), "systemd installer should install the kiosk watchdog service");
  assert(systemdInstaller.includes("tikpal-kiosk-watchdog.timer"), "systemd installer should install and enable the kiosk watchdog timer");
  assert(
    systemdInstaller.includes("install_physical_display_prepare")
      && systemdInstaller.includes("/usr/local/sbin/tikpal-physical-display-prepare")
      && systemdInstaller.includes("Wants=display_turzx.service")
      && systemdInstaller.includes("After=display_turzx.service")
      && systemdInstaller.includes("ExecStartPre=+/usr/local/sbin/tikpal-physical-display-prepare wait-ready")
      && systemdInstaller.includes("systemd-run --quiet --collect --no-block --unit=tikpal-physical-display-kick")
      && systemdInstaller.includes("--setenv=HOME=/root")
      && systemdInstaller.includes("tikpal-physical-display-prepare delayed-soft-kick")
      && systemdInstaller.includes("tikpal-display-stability.service")
      && systemdInstaller.includes("tikpal-physical-display-prepare pci-stabilize"),
    "systemd installer should install the physical-display helper, boot wait, delayed soft-kick, and PCI stability unit"
  );
  assert(systemdInstaller.includes("tikpal-locale-enable.sh"), "systemd installer should normalize SSH locale handling on new Pi installs");
  assert(systemdInstaller.includes("KIOSK_PACKAGES=("), "systemd installer should own new-Pi kiosk package installation");
  assert(systemdInstaller.includes("xdotool"), "systemd installer should install xdotool for Explore provider window detection");
  assert(systemdInstaller.includes("TIKPAL_INSTALL_KIOSK_PACKAGES"), "systemd installer should expose an escape hatch for kiosk package installation");
  assert(systemdInstaller.includes('loginctl enable-linger "$SERVICE_USER"'), "systemd installer should keep the Onboard user service alive between API calls");
  assert(systemdInstaller.includes("install_onboard_scripts") && systemdInstaller.includes("tikpalImeToggle.py"), "systemd installer should install Tikpal's direct Onboard IME toggle script");
  assert(systemdInstaller.includes('rm -f "$policy_dir/tikpal-kiosk-managed.json"'), "systemd installer should remove the legacy Tikpal extension-blocking policy file");
  assert(kioskUnit.includes("TIKPAL_KIOSK_SKIP_ENV_SOURCE=1"), "kiosk unit should preserve systemd EnvironmentFile override order");
  assert(deployDoc.includes("install-systemd-services.sh --enable-kiosk") && deployDoc.includes("including `xdotool`"), "Pi deployment docs should route new kiosk dependencies through the installer");
  assert(deployDoc.includes("onboard wmctrl xdotool fcitx5"), "Pi Explore install docs should include xdotool for manual provider window detection setup");
  assert(deployDoc.includes("make sure `xdotool` is installed"), "Explore troubleshooting docs should call out missing xdotool when QQ only leaves the side panel");

  const webSmokeDir = mkdtempSync(path.join(tmpdir(), "tikpal-web-surfaces-"));
  writeFileSync(path.join(webSmokeDir, "index.html"), "<!doctype html><html><head></head><body>Tikpal</body></html>");
  const [kioskPort, remotePort, unusedApiPort] = await getFreePorts(3);
  const webProcess = spawn(process.execPath, ["server/web.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      TIKPAL_WEB_HOST: "127.0.0.1",
      TIKPAL_WEB_PORT: String(kioskPort),
      TIKPAL_WEB_REMOTE_PORT: String(remotePort),
      TIKPAL_WEB_DIST_DIR: webSmokeDir,
      TIKPAL_API_ORIGIN: `http://127.0.0.1:${unusedApiPort}`
    },
    stdio: "ignore"
  });

  try {
    await waitForWeb(kioskPort);
    const kioskPage = await requestWeb(kioskPort);
    const remotePage = await requestWeb(remotePort);
    assert(kioskPage.status === 200, "kiosk web port should serve the full UI to LAN hosts");
    assert(!kioskPage.body.includes("__TIKPAL_REMOTE_MODE__"), "kiosk web port should not inject portable remote mode");
    assert(remotePage.body.includes("__TIKPAL_REMOTE_MODE__=true"), "remote web port should inject portable remote mode");

    const kioskApi = await requestWeb(kioskPort, "/api/v1/system/state");
    const remoteApi = await requestWeb(remotePort, "/api/v1/system/state");
    const remoteWebModeAction = await requestWeb(remotePort, "/api/v1/web-mode/actions", "POST");
    const remoteHeartbeat = await requestWeb(kioskPort, "/api/v1/kiosk/heartbeat", "POST");
    assert(kioskApi.status === 502, "kiosk web port should allow the LAN full-UI API through to its configured origin");
    assert(remoteApi.status === 403, "remote web port should block the full kiosk API");
    assert(remoteWebModeAction.status === 403, "remote web port should keep direct Explore actions behind the portable facade");
    assert(remoteHeartbeat.status === 403, "LAN kiosk views should not overwrite the physical kiosk heartbeat");
  } finally {
    if (webProcess.exitCode === null) {
      webProcess.kill("SIGTERM");
      await new Promise((resolve) => webProcess.once("exit", resolve));
    }
  }

  const kioskEnv = await readFile(path.join(ROOT, "deploy/chromium/env.kiosk.example"), "utf8");
  assert(kioskEnv.includes("TIKPAL_KIOSK_REMOTE_DEBUG=0"), "kiosk env should default remote debugging off");
  assert(kioskEnv.includes("TIKPAL_KIOSK_VIEWER=none"), "kiosk env should default noVNC viewer off");
  assert(kioskEnv.includes("TIKPAL_KIOSK_DISPLAY_MODE=auto"), "kiosk env should document automatic physical/virtual display selection");
  assert(kioskEnv.includes("TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS=5"), "kiosk env should document bounded xset/xrandr commands");
  assert(
    kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_RESET_MODE=1280x720")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_SAFE_BRIGHTNESS=45")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_SAFE_CONTRAST=50")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_INPUT_SOURCE=")
      && kioskEnv.includes("TIKPAL_KIOSK_XRANDR_OUTPUT=auto")
      && kioskEnv.includes("TIKPAL_KIOSK_XRANDR_PRIMARY_PREFERRED_OUTPUTS=\"HDMI-1 HDMI-A-1\"")
      && kioskEnv.includes("TIKPAL_KIOSK_XRANDR_FALLBACK_TO_CONNECTED=1")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_DRM_CONNECTOR=auto")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_DRM_CONNECTORS=auto")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_DRM_FALLBACK_TO_CONNECTED=1")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_WAIT_READY_TIMEOUT_SECONDS=45")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_DELAYED_KICK_SECONDS=\"8 25\"")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_DISABLE_POWER_KEYS=1")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_PCI_POWER_DEVICES=")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_PCIE_ASPM_POLICY=")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_DRM_POLL=")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_NOUVEAU_PCI_ID=")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_NOUVEAU_REBIND_SETTLE_SECONDS=3"),
    "kiosk env should document safe physical display soft-kick and PCI fallback defaults"
  );
  assert(kioskEnv.includes("TIKPAL_KIOSK_WATCHDOG_ENABLED=1"), "kiosk env should default the display watchdog on");
  assert(kioskEnv.includes("TIKPAL_KIOSK_WATCHDOG_GPU_LOG_SCAN=1"), "kiosk env should enable GPU reset log scanning");
  assert(kioskEnv.includes("TIKPAL_KIOSK_WATCHDOG_PAGE_HEARTBEAT_ENABLED=1"), "kiosk env should enable page heartbeat scanning");
  assert(kioskEnv.includes("TIKPAL_KIOSK_WATCHDOG_PAGE_HEARTBEAT_URL=http://127.0.0.1:8787/api/v1/kiosk/heartbeat"), "kiosk env should point the watchdog at the loopback page heartbeat API");
  assert(kioskEnv.includes("TIKPAL_KIOSK_WATCHDOG_WEB_MODE_HEARTBEAT_BYPASS=1"), "kiosk env should not restart the kiosk for stale page heartbeat while Explore is active");
  assert(
    kioskEnv.includes("TIKPAL_KIOSK_PHYSICAL_DISPLAY_CHECK_ENABLED=0")
      && kioskEnv.includes("TIKPAL_KIOSK_PHYSICAL_DISPLAY_SOFT_KICK_BEFORE_RESTART=1")
      && kioskEnv.includes("TIKPAL_KIOSK_PHYSICAL_DISPLAY_GPU_REBIND_BEFORE_RESTART=0")
      && kioskEnv.includes("TIKPAL_KIOSK_PHYSICAL_DISPLAY_PREPARE_COMMAND=/usr/local/sbin/tikpal-physical-display-prepare"),
    "kiosk env should keep periodic physical xrandr probing off while preserving display recovery routing"
  );
  assert(kioskEnv.includes("TIKPAL_KIOSK_WATCHDOG_REBOOT_AFTER_RESTARTS=3"), "kiosk env should document persistent display-failure reboot escalation");
  assert(kioskEnv.includes("TIKPAL_KIOSK_RESET_WEB_MODE_ON_START=1"), "kiosk env should clear stale Explore runtime state when the physical kiosk starts");
  assert(kioskEnv.includes("TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE=auto"), "kiosk env should auto-detect the Chromium ALSA output");
  assert(!kioskEnv.includes("TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE=_audioout"), "kiosk env should not default Chromium Scene Sound to Loopback-backed _audioout");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE=auto"), "kiosk env should auto-detect the Explore ALSA output");
  assert(!kioskEnv.includes("BT66"), "kiosk env should not pin Pi audio to one ALSA card id");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT=9234"), "kiosk env should document the Explore provider local CDP port");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_PROVIDER_GUARD=1"), "kiosk env should enable the Explore provider guard by default");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_ERROR_PAGE_URL=http://127.0.0.1:4173/web-mode-error.html"), "kiosk env should point provider guard at the local friendly error page");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_BACKGROUND_URL=http://127.0.0.1:4173/web-mode-background.html"), "kiosk env should point Explore at the persistent branded background page");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_TRANSITION_URL=http://127.0.0.1:4173/web-mode-transition.html"), "kiosk env should point staged Explore switches at the local transition page");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_STAGE_POSITION=2560,0"), "kiosk env should stage provider windows offscreen");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS=2"), "kiosk env should bound Explore provider switch locking");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_QQ_AUTO_CONFIRM=1"), "kiosk env should enable safe QQ Music auto-confirm by default");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_EXTENSION_ENABLED=1"), "kiosk env should enable the dynamic Explore proxy extension by default");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_PROXY_APPLY_TIMEOUT_SECONDS=5"), "kiosk env should bound dynamic proxy confirmation");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_PROVIDER_BOOTSTRAP_TIMEOUT_SECONDS=7"), "kiosk env should bound provider bootstrap navigation");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_PROVIDER_WINDOW_TIMEOUT_SECONDS=30"), "kiosk env should bound provider window detection below the API open timeout");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_PROVIDER_TEXT_SCALE=1.10"), "kiosk env should default Explore provider text scale to 110%");
  const kioskLauncher = await readFile(path.join(ROOT, "deploy/chromium/launch-tikpal-kiosk.sh"), "utf8");
  const kioskSession = await readFile(path.join(ROOT, "deploy/chromium/start-tikpal-kiosk-session.sh"), "utf8");
  const watchdogSource = await readFile(path.join(ROOT, "deploy/chromium/tikpal-kiosk-healthcheck.sh"), "utf8");
  const webModeScript = await readFile(path.join(ROOT, "deploy/chromium/tikpal-web-mode.sh"), "utf8");
  const onboardImeToggleScript = await readFile(path.join(ROOT, "deploy/chromium/onboard-scripts/tikpalImeToggle.py"), "utf8");
  const onboardTheme = await readFile(path.join(ROOT, "deploy/chromium/onboard-themes/Tikpal-Classic.colors"), "utf8");
  const serverSource = await readFile(path.join(ROOT, "server/index.mjs"), "utf8");
  const webModeErrorPage = await readFile(path.join(ROOT, "public/web-mode-error.html"), "utf8");
  const webModeBackgroundPage = await readFile(path.join(ROOT, "public/web-mode-background.html"), "utf8");
  const webModeCrossfadeScript = await readFile(path.join(ROOT, "deploy/moode/tikpal-web-mode-crossfade.sh"), "utf8");
  const audioAdaptScript = await readFile(path.join(ROOT, "deploy/moode/tikpal-audio-adapt.sh"), "utf8");
  const localLibrarySyncScript = await readFile(path.join(ROOT, "deploy/moode/tikpal-local-library-sync.sh"), "utf8");
  const librarySyncScript = await readFile(path.join(ROOT, "deploy/moode/tikpal-library-sync.sh"), "utf8");
  const nasMountScript = await readFile(path.join(ROOT, "deploy/moode/tikpal-nas-mount.sh"), "utf8");
  const usbLibrarySyncScript = await readFile(path.join(ROOT, "deploy/moode/tikpal-usb-library-sync.sh"), "utf8");
  const quietBootScript = await readFile(path.join(ROOT, "deploy/moode/tikpal-quiet-boot-enable.sh"), "utf8");
  const extensionManifest = JSON.parse(await readFile(path.join(ROOT, "deploy/chromium/web-mode-extension/manifest.json"), "utf8"));
  const extensionContent = await readFile(path.join(ROOT, "deploy/chromium/web-mode-extension/content.js"), "utf8");
  const extensionBackground = await readFile(path.join(ROOT, "deploy/chromium/web-mode-extension/background.js"), "utf8");
  const i18nSource = await readFile(path.join(ROOT, "src/i18n.tsx"), "utf8");
  const sidePanelSource = await readFile(path.join(ROOT, "src/components/WebModeSidePanel.tsx"), "utf8");
  const quickSettingsSource = await readFile(path.join(ROOT, "src/components/QuickSettingsOverlay.tsx"), "utf8");
  const remoteControlSource = await readFile(path.join(ROOT, "src/components/RemoteControlApp.tsx"), "utf8");
  const ambientScreenSource = await readFile(path.join(ROOT, "src/components/AmbientScreen.tsx"), "utf8");
  const playerOverlaySource = await readFile(path.join(ROOT, "src/components/PlayerOverlay.tsx"), "utf8");
  const uiCopySource = await readFile(path.join(ROOT, "src/uiCopy.ts"), "utf8");
  const flameSceneSource = await readFile(path.join(ROOT, "src/components/FlameScene.tsx"), "utf8");
  const appSource = await readFile(path.join(ROOT, "src/App.tsx"), "utf8");
  const playbackTruthSource = await readFile(path.join(ROOT, "src/playbackTruth.ts"), "utf8");
  const stylesSource = await readFile(path.join(ROOT, "src/styles.css"), "utf8");
  assert(stylesSource.includes("--transport-play-icon") && stylesSource.includes("--transport-play-border"), "Transport play buttons should expose skin-aware icon and border tokens");
  assert(stylesSource.includes(".screen-saver-wake-hint"), "Screen sleep should include a subtle touch-to-wake hint");
  assert(stylesSource.includes(".audio-output-diagnostics-chip"), "Audio Output should style the advanced-info hint as a light chip");
  assert(stylesSource.includes(".nas-source-next-step"), "NAS source detail should reserve a separate next-step row");
  assert(stylesSource.includes(".settings-card-summary .settings-card-action"), "Settings cards should reduce low-value footer copy weight");
  assert(stylesSource.includes(".ambient-transport-play") && stylesSource.includes("color: var(--transport-play-icon);"), "Ambient play/pause button should follow the selected surface skin");
  assert(stylesSource.includes(".remote-play-button") && stylesSource.includes("background: var(--transport-play-bg);"), "Remote play/pause button should follow the selected surface skin");
  assert(!stylesSource.includes("linear-gradient(145deg, rgba(119, 215, 239, 0.28), rgba(242, 200, 101, 0.14))"), "Remote play/pause button should not keep a fixed cyan/gold gradient");
  const localSyncTempDir = mkdtempSync(path.join(tmpdir(), "tikpal-local-sync-"));
  const localSyncSourceRoot = path.join(localSyncTempDir, "source");
  const localSyncMpdRoot = path.join(localSyncTempDir, "mpd");
  const localSyncCodexRoot = path.join(localSyncMpdRoot, "Codex");
  const localSyncImportedTrack = path.join(localSyncCodexRoot, "USB Imports", "Session Disk", "Saved.flac");
  const localSyncStaleTrack = path.join(localSyncCodexRoot, "Stale.mp3");
  const localSyncRepoTrack = path.join(localSyncCodexRoot, "Focus", "Repo.mp3");
  mkdirSync(path.join(localSyncSourceRoot, "_metadata"), { recursive: true });
  mkdirSync(path.join(localSyncSourceRoot, "Focus"), { recursive: true });
  mkdirSync(path.dirname(localSyncImportedTrack), { recursive: true });
  mkdirSync(path.dirname(localSyncStaleTrack), { recursive: true });
  writeFileSync(path.join(localSyncSourceRoot, "_metadata", "library_manifest.json"), "[]\n");
  writeFileSync(path.join(localSyncSourceRoot, "Focus", "Repo.mp3"), "repo music\n");
  writeFileSync(localSyncImportedTrack, "copied usb music\n");
  writeFileSync(localSyncStaleTrack, "stale repo music\n");
  const localSyncResult = spawnSync(path.join(ROOT, "deploy/moode/tikpal-local-library-sync.sh"), ["apply"], {
    env: {
      ...process.env,
      TIKPAL_MPD_MUSIC_ROOT: localSyncMpdRoot,
      TIKPAL_LOCAL_LIBRARY_MPD_PREFIX: "Codex",
      TIKPAL_LOCAL_LIBRARY_SOURCE_ROOT: localSyncSourceRoot,
      TIKPAL_LOCAL_LIBRARY_IMPORTS_DIR_NAME: "USB Imports",
      TIKPAL_MPC_BIN: "/bin/true"
    },
    encoding: "utf8"
  });
  assert(localSyncResult.status === 0, `Local library sync helper should run against a fake MPD root:\n${localSyncResult.stdout}\n${localSyncResult.stderr}`);
  assert(spawnSync("test", ["-f", localSyncRepoTrack]).status === 0, "Local library sync should mirror repo-owned Local music");
  assert(spawnSync("test", ["-f", localSyncImportedTrack]).status === 0, "Local library sync should preserve copied USB Imports");
  assert(spawnSync("test", ["-f", localSyncStaleTrack]).status !== 0, "Local library sync should still prune stale repo-owned Local files");
  assert(extensionManifest.permissions.includes("proxy"), "Explore extension should declare the proxy permission");
  assert(extensionManifest.permissions.includes("tabs"), "Explore extension should declare tabs permission for provider bootstrap navigation");
  assert(extensionManifest.version !== "1.0.0", "Explore extension should bump its version when provider scaling behavior changes so Chromium refreshes cached service workers");
  assert(extensionManifest.key, "Explore extension should use a stable id for managed-policy allowlisting");
  assert(extensionManifest.host_permissions.includes("http://127.0.0.1:8787/*"), "Explore extension should only call the loopback API");
  assert(extensionManifest.host_permissions.includes("http://127.0.0.1:4173/*"), "Explore extension should be able to leave the local provider bootstrap page");
  assert(extensionManifest.host_permissions.includes("https://*.music.126.net/*") && extensionManifest.host_permissions.includes("https://*.music.163.com/*"), "Explore extension should allow NetEase audio fetch fallback domains only");
  assert(extensionManifest.background?.service_worker === "background.js" && extensionManifest.background?.type === "module", "Explore extension should use its MV3 module service worker");
  assert(extensionManifest.web_accessible_resources?.some((entry) => entry.resources?.includes("netease-audio-mirror.js") && entry.matches?.includes("https://music.163.com/*")), "Explore extension should expose the NetEase audio mirror to the page world");
  assert(extensionContent.includes("window.setInterval(() => void syncProxy(), 750)"), "provider pages should poll the proxy settings revision every 750ms");
  assert(extensionContent.includes("initialProxyKey") && !extensionContent.includes("initialRevision"), "provider pages should reload only when the proxy key changes");
  assert(extensionContent.includes("window.location.reload()"), "provider pages should refresh after a proxy revision change");
  assert(extensionContent.includes("window.location.replace(provider.url)"), "provider bootstrap should navigate only after proxy sync succeeds");
  assert(!extensionBackground.includes("setZoom(") && !extensionBackground.includes("setZoomSettings") && !extensionBackground.includes("getZoom"), "Explore extension should avoid Chrome tab zoom so the browser zoom bubble never appears");
  assert(extensionContent.includes("tikpal-provider-text-scale-style") && extensionContent.includes("scaleProviderTextElements") && extensionContent.includes("element.style.fontSize") && extensionContent.includes("window.__tikpalProviderTextScale"), "provider pages should apply text scale to detected text elements");
  assert(
    extensionBackground.includes("fontTheme: normalizeFontTheme(state.preferences?.fontTheme)")
      && extensionContent.includes("tikpal-provider-font-theme-style")
      && extensionContent.includes("applyProviderFontTheme")
      && extensionContent.includes("window.__tikpalProviderFontTheme")
      && extensionContent.includes("providerIconFontPattern"),
    "provider pages should inherit the device font theme without replacing icon fonts"
  );
  assert(extensionContent.includes('document.documentElement.style.zoom = ""') && !extensionContent.includes("zoom: var(--tikpal-provider-text-scale)") && !extensionContent.includes("nextLowerProviderTextScale"), "provider pages should avoid Chrome/page zoom and overflow fallback loops");
  assert(!extensionContent.includes("provider-zoom-overflow"), "provider pages should not round-trip overflow fallback through the background service worker");
  assert(extensionContent.includes("netease-audio-mirror.js"), "NetEase provider pages should inject the audio mirror into the page world");
  assert(extensionBackground.includes("isAllowedNeteaseAudioUrl") && extensionBackground.includes('message?.type === "fetch-audio"') && extensionBackground.includes("chrome.tabs.sendMessage"), "Explore extension background should proxy only allowed NetEase audio fetches in chunks");
  assert(extensionBackground.includes("DIRECT_PROXY_PROVIDER_IDS") && extensionBackground.includes('"qq_music"') && extensionBackground.includes('"netease_music"'), "Explore extension should keep QQ Music and NetEase direct even when global proxy is on");
  assert(extensionContent.includes("tikpal-netease-fetch-audio") && extensionContent.includes('chrome.runtime.sendMessage({ type: "fetch-audio"') && extensionContent.includes('message?.type !== "fetch-audio-result"'), "NetEase page script should be able to request chunked extension-backed audio bytes");
  assert(extensionContent.includes("providerHostIds") && extensionContent.includes('id: "qq_music"') && extensionContent.includes("inferProviderId"), "Explore provider pages should infer their provider id after bootstrap navigation");
  assert(extensionContent.includes('chrome.runtime.sendMessage({ type: "keyboard", enabled, force }'), "Explore extension should distinguish new input focus from keyboard hide requests");
  assert(extensionContent.includes("suno\\.com") && extensionContent.includes('event.type === "focusin" && !allowProgrammaticInputFocus'), "Suno should ignore page-driven autofocus until the user taps an input");
  assert(extensionContent.includes("editableTarget(document.activeElement)"), "Explore extension should hide Onboard after provider input focus ends");
  assert(extensionContent.includes("inputSessionActive") && extensionContent.includes("active || (inputSessionActive && lastEditable?.isConnected) || !outsidePointerDown"), "Explore extension should not hide Onboard when the keyboard takes focus from a provider input");
  assert(extensionContent.includes("endInputSession") && extensionContent.includes("if (outsidePointerDown)"), "Explore extension should end provider input sessions only on explicit outside provider taps or submits");
  assert(extensionContent.includes("const throttleMs = force ? 1000 : 250"), "Explore extension should throttle repeated forced keyboard show requests");
  assert(!extensionContent.includes("if (!document.hasFocus() || (!editableTarget(document.activeElement)"), "Explore extension should not hide Onboard on provider-window blur alone");
  assert(!extensionContent.includes("if (document.hasFocus() && editableTarget(document.activeElement)) requestKeyboard(true);"), "Explore extension should not reopen Onboard after its own close button hides it");
  assert(extensionBackground.includes("setKeyboardVisible"), "Explore extension background should forward keyboard actions to the loopback API");
  assert(extensionBackground.includes("chrome.tabs.update(sender.tab.id, { url: provider.url })"), "extension background should navigate the bootstrap tab after proxy sync");
  assert(!sidePanelSource.includes('sendWebModeAction({ type: "proxy"') && !sidePanelSource.includes("data-web-mode-proxy-toggle"), "Explore side panel should not hot-toggle Proxy from the resident provider pool");
  assert(sidePanelSource.includes("data-web-mode-proxy-status") && sidePanelSource.includes('"explore.proxyChangeInSettings"'), "Explore side panel should show Proxy On/Off as status and point users to Settings");
  assert(sidePanelSource.includes('sendWebModeAction({ type: "provider_text_scale"') && sidePanelSource.includes("data-web-mode-text-scale-option"), "Explore side panel should expose the provider text scale action");
  assert(sidePanelSource.includes("inferFailedProviderFromError") && sidePanelSource.includes('"common.failed"') && sidePanelSource.includes("is-failed"), "Explore side panel should show provider-open failures without marking the provider active");
  assert(sidePanelSource.includes('residentStatus === "check_proxy"') && sidePanelSource.includes('"common.needProxyOn"'), "Explore side panel should show Need Proxy On from live provider probe state");
  assert(sidePanelSource.includes("isProxyNeededError") && sidePanelSource.includes("needs proxy on"), "Explore side panel should show Need Proxy On for proxy-related provider failures");
  assert(sidePanelSource.includes('"common.proxyOn"') && sidePanelSource.includes('"common.proxyOff"') && !sidePanelSource.includes('"common.direct"'), "Explore proxy status should say Proxy On/Proxy Off instead of Direct");
  assert(stylesSource.includes(".web-mode-provider.is-failed"), "Explore side panel should style failed provider-open state separately from Active");
  assert(stylesSource.includes(".web-mode-provider.is-proxy-unavailable"), "Explore side panel should give proxy-unavailable providers their own visual state");
  assert(!sidePanelSource.includes("updateWebModeSettings"), "Explore side panel should not reopen the provider to switch proxy mode");
  assert(!sidePanelSource.includes("data-web-mode-keyboard-toggle") && !sidePanelSource.includes("toggleKeyboard"), "Explore side panel should rely on automatic input-focus keyboard behavior");
  assert((sidePanelSource.match(/onClick=\{\(\) => void closeWebMode\(\)\}/g) ?? []).length === 1, "Explore side panel should keep only the top-right Close button");
  assert(!quickSettingsSource.includes("handleWebModeKeyboard"), "Console should rely on input-focus keyboard behavior instead of a duplicate button");
  assert(quickSettingsSource.includes('detailView !== "webMode"'), "Console should only preload Onboard for the Explore Proxy settings detail");
  assert(quickSettingsSource.includes('sendWebModeAction({ type: "keyboard", preload: true })'), "Console Explore Proxy settings should preload resident Onboard before the first text-field tap");
  assert(["focus", "calm", "sleep", "hifi", "explore"].every((id) => quickSettingsSource.includes(`id: "${id}"`)), "Console should expose five room shortcuts");
  assert(quickSettingsSource.includes('data-room-shortcut={shortcut.id}') && quickSettingsSource.includes("disabled={pendingRoomShortcut !== null}"), "Console room shortcuts should expose state and lock while switching");
  assert(quickSettingsSource.includes('destination !== "explore" && destination === roomExperience.mode'), "Console should return immediately when the current room mode is selected");
  assert(quickSettingsSource.includes('await onExperienceAction({ type: "set_mode", mode: destination })'), "Console should reuse the room mode action");
  assert(quickSettingsSource.includes("await onOpenWebMode()"), "Console Explore shortcut should reuse the existing Explore flow");
  assert(quickSettingsSource.includes('data-room-shortcut="back"') && quickSettingsSource.includes("data-console-back-button") && quickSettingsSource.includes("onClick={handleReturnAmbient}"), "Console should expose a Close shortcut next to Explore");
  assert(
    quickSettingsSource.includes("PanelRightClose")
      && sidePanelSource.includes("PanelRightClose")
      && playerOverlaySource.includes("PanelRightClose")
      && ambientScreenSource.includes("PanelRightClose")
      && !quickSettingsSource.includes("LogOut")
      && !sidePanelSource.includes("LogOut")
      && !playerOverlaySource.includes("LogOut")
      && !ambientScreenSource.includes("LogOut")
      && !quickSettingsSource.includes("ArrowLeft"),
    "Close controls should share a panel-close icon without logout or plain-arrow semantics"
  );
  assert(
    i18nSource.includes('"common.online": "Online"')
      && i18nSource.includes('"settings.limited": "Limited"')
      && i18nSource.includes('"settings.savedOnDevice": "Music saved on this device"')
      && i18nSource.includes('"settings.addNasInSettings": "Add NAS in Settings"')
      && quickSettingsSource.includes('t("common.applying")')
      && quickSettingsSource.includes("nasPasswordVisible")
      && !quickSettingsSource.includes("Tikpal API")
      && !quickSettingsSource.includes("Manifest-backed music")
      && !quickSettingsSource.includes("Renderer:")
      && !quickSettingsSource.includes("Remote Admin")
      && !quickSettingsSource.includes("SMB/NFS")
      && !quickSettingsSource.includes("credentials"),
    "Console summary copy should avoid technical implementation labels"
  );
  assert(
    uiCopySource.includes("friendlyUiError")
      && uiCopySource.includes("dataSyncLabel")
      && uiCopySource.includes('"Nothing playing"')
      && uiCopySource.includes('"Unknown artist"')
      && uiCopySource.includes('"Source unknown"'),
    "friendly UI copy helpers should centralize fallback and error language"
  );
  assert(
    playerOverlaySource.includes('status.pending ? t("status.updating")')
      && playerOverlaySource.includes('t("status.live")')
      && playerOverlaySource.includes('t("status.offlineView")')
      && i18nSource.includes('"status.live": "Live"')
      && i18nSource.includes('"status.offlineView": "Offline view"')
      && i18nSource.includes('"status.updating": "Updating"')
      && playerOverlaySource.includes('t("source.openSpotify")')
      && playerOverlaySource.includes('t("source.openAirplay")')
      && playerOverlaySource.includes('t("source.pairPhone")')
      && playerOverlaySource.includes('t("source.openDlna")')
      && playerOverlaySource.includes('t("handoff.body")')
      && i18nSource.includes('"source.openSpotify": "Open Spotify"')
      && i18nSource.includes('"source.openAirplay": "Open AirPlay"')
      && i18nSource.includes('"source.pairPhone": "Pair phone"')
      && i18nSource.includes('"source.openDlna": "Open DLNA"')
      && i18nSource.includes('"handoff.body": "Connect from your phone. This returns when playback starts."')
      && !playerOverlaySource.includes("API Confirmed")
      && !playerOverlaySource.includes("Fallback Data")
      && !playerOverlaySource.includes("Enable Spotify")
      && !playerOverlaySource.includes("Enable AirPlay"),
    "Player source copy should use action-oriented labels and friendly sync state"
  );
  assert(stylesSource.includes("grid-template-columns: repeat(6, minmax(0, 1fr));") && stylesSource.includes(".console-room-back"), "Console room shortcuts should fit Explore plus Close on one row");
  assert(appSource.includes("VISIBLE_LISTENING_SOURCE_TARGETS"), "Hi-Fi entry should preserve the current visible listening source");
  assert(appSource.includes("isVisibleListeningSourceTarget(currentSourceId)"), "Hi-Fi remembered-source restore should not overwrite active Library/Radio/external sources");
  assert(
    playerOverlaySource.includes("data-player-now-playing-pane") && playerOverlaySource.includes("data-player-library-pane"),
    "Player should expose stable now-playing and library pane hooks for layout smoke"
  );
  assert(
    playerOverlaySource.includes("function isLibraryTrackPlaying")
      && playerOverlaySource.includes("data-library-track-current")
      && playerOverlaySource.includes("currentRow?.scrollIntoView")
      && playerOverlaySource.includes('playback.source !== "mpd"'),
    "Player Library should keep the current-track checkmark synced after previous/next playback changes"
  );
  assert(
    stylesSource.includes("-webkit-line-clamp: 3") && stylesSource.includes(".player-now-playing-pane") && stylesSource.includes(".player-overlay .overlay-backdrop"),
    "Player layout should clamp long titles and dim the ambient background behind the overlay"
  );
  assert(playbackTruthSource.includes('parsed.searchParams.set("fontTheme", fontTheme)'), "playback artwork URLs should carry the selected font theme");
  assert(serverSource.includes("GENERATED_ARTWORK_FONT_FAMILIES") && serverSource.includes('url.searchParams.get("fontTheme")'), "generated backend artwork should honor the requested font theme");
  assert(
    serverSource.includes("async function setMpcAndOutputVolumePercent")
      && serverSource.includes('await runMpc(["volume", String(normalized)])')
      && serverSource.includes("if (OUTPUT_VOLUME_SET_COMMAND_CONFIGURED)")
      && serverSource.includes("await setOutputVolumePercent(normalized)")
      && serverSource.includes("const effectivePercent")
      && serverSource.includes("await setMpcAndOutputVolumePercent(effectivePercent)"),
    "mpc library volume_set should mirror the configured output volume helper"
  );
  assert(
    serverSource.includes("TIKPAL_NAS_LIBRARY_ROOTS")
      && serverSource.includes("TIKPAL_NAS_LIBRARY_MPD_PREFIX")
      && serverSource.includes("TIKPAL_NAS_SOURCES_STATE_PATH")
      && serverSource.includes("TIKPAL_NAS_AUTO_MOUNT")
      && serverSource.includes("TIKPAL_NAS_AUTO_MOUNT_ATTEMPTS")
      && serverSource.includes("TIKPAL_NAS_AUTO_MOUNT_RETRY_DELAY_MS")
      && serverSource.includes("mountEnabledNasSourcesOnStartup")
      && serverSource.includes('status: "checking"')
      && serverSource.includes("/api/v1/nas/sources")
      && serverSource.includes("/api/v1/nas/discover")
      && serverSource.includes("async function readNasAudioLibraryTracks")
        && serverSource.includes("formatNasMountErrorForUser")
        && serverSource.includes("lastRawError")
        && serverSource.includes("Login failed. Check username, password, or Guest access.")
        && serverSource.includes("async function mountNasSource")
        && quickSettingsSource.includes("data-nas-detail-left")
        && quickSettingsSource.includes("data-nas-detail-right")
        && quickSettingsSource.includes("readableNasErrorMessage")
        && quickSettingsSource.includes("nasErrorRaw")
        && quickSettingsSource.includes("selectedSource.lastRawError")
        && quickSettingsSource.includes('t("nas.savedNas")')
        && quickSettingsSource.includes('t("nas.scanResults")')
        && quickSettingsSource.includes('t("nas.testFirst")')
        && i18nSource.includes('"nas.savedNas": "Saved NAS"')
        && i18nSource.includes('"nas.scanResults": "Scan Results"')
        && i18nSource.includes('"nas.testFirst": "Test first, then save."')
        && nasMountScript.includes("mount -t cifs")
      && nasMountScript.includes("mount --bind")
      && serverSource.includes("function isNasLibraryTrackPath")
      && serverSource.includes("isExternalLibraryTrackPath")
      && playerOverlaySource.includes('track.storage === "local" || track.storage === "nas" || track.storage === "usb"'),
    "NAS Library tracks should scan configured roots, expose MPD-visible NAS paths, and play from the Player Library"
  );
  assert(
    playerOverlaySource.includes("function localizedLibraryPlaybackHint")
      && playerOverlaySource.includes('t("library.playingFromNas")')
      && playerOverlaySource.includes('t("library.playingFromUsb")')
      && playerOverlaySource.includes('t("library.playingFromLocal")')
      && i18nSource.includes('"library.playingFromNas": "Playing from NAS."')
      && i18nSource.includes('"library.playingFromUsb": "Playing from USB."')
      && i18nSource.includes('"library.playingFromLocal": "Playing from Local."')
      && playerOverlaySource.includes("track.path, track.storage")
      && !playerOverlaySource.includes('if (storageId === "nas")'),
    "Library playback hints should identify Local, USB, and NAS tracks distinctly"
  );
  assert(
    ambientScreenSource.includes('onTouchStart={handleZoneTouchStart("volume")}') && ambientScreenSource.includes('startAdjust(channel, touch.identifier, touch.clientY, "touch")'),
    "ambient right-edge volume control should include a touch-event fallback for physical touchscreens"
  );
  assert(remoteControlSource.includes("data-remote-key") && !remoteControlSource.includes("window.prompt"), "portable remote should keep its key field visible instead of relying on a browser prompt");
  assert(remoteControlSource.includes("data-remote-volume-slider"), "portable remote should expose a stable volume slider hook");
  assert(!remoteControlSource.includes("Enter the Remote key before using controls") && remoteControlSource.includes("actionKey || undefined"), "portable remote should let the 4174 proxy/API decide remote-key validity instead of blocking actions locally");
  assert(
    remoteControlSource.includes("setActionError")
      && remoteControlSource.includes("setRefreshError")
      && remoteControlSource.includes("friendlyError")
      && remoteControlSource.includes('t("remote.accessKey")')
      && remoteControlSource.includes('t("remote.noKey")')
      && i18nSource.includes('"remote.accessKey": "Access key"')
      && i18nSource.includes('"remote.noKey": "No key"')
      && remoteControlSource.includes("PanelRightClose")
      && !remoteControlSource.includes("Remote key")
      && !remoteControlSource.includes("Back to Tikpal"),
    "portable remote should keep action errors visible with low-friction labels"
  );
  assert(!flameSceneSource.includes("video.load()"), "single-loop recovery should not leak Chromium media decoders by reloading the video element");
  assert(kioskLauncher.includes("TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS"), "kiosk launcher should expose an X command timeout");
  assert(kioskLauncher.includes("run_x_command xrandr"), "kiosk launcher should bound xrandr commands");
  assert(kioskLauncher.includes("run_x_command xset"), "kiosk launcher should bound xset commands");
  assert(kioskLauncher.includes("detect_non_hdmi_card_id"), "kiosk launcher should detect the actual non-HDMI ALSA card");
  assert(kioskLauncher.includes("tikpal-audio-adapt.sh") && kioskLauncher.includes("resolve-browser"), "kiosk launcher should use the shared audio adapter for auto ALSA output");
  assert(kioskLauncher.includes('TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE="$(resolve_physical_alsa_output_device'), "kiosk launcher should resolve auto ALSA output before launching Chromium");
  assert(kioskLauncher.includes("resolve_xrandr_primary_output") && kioskLauncher.includes("TIKPAL_KIOSK_XRANDR_FALLBACK_TO_CONNECTED"), "kiosk launcher should support HDMI-first, connected-output fallback");
  assert(
    physicalDisplayPrepare.includes("TIKPAL_PHYSICAL_DISPLAY_RESET_MODE:=1280x720")
      && physicalDisplayPrepare.includes("TIKPAL_PHYSICAL_DISPLAY_INPUT_SOURCE:=")
      && physicalDisplayPrepare.includes("TIKPAL_KIOSK_XRANDR_OUTPUT:=auto")
      && physicalDisplayPrepare.includes("TIKPAL_KIOSK_XRANDR_PRIMARY_PREFERRED_OUTPUTS:=HDMI-1 HDMI-A-1")
      && physicalDisplayPrepare.includes("TIKPAL_PHYSICAL_DISPLAY_DRM_CONNECTOR:=auto")
      && physicalDisplayPrepare.includes("TIKPAL_PHYSICAL_DISPLAY_DRM_CONNECTORS:=$TIKPAL_PHYSICAL_DISPLAY_DRM_CONNECTOR")
      && physicalDisplayPrepare.includes("TIKPAL_PHYSICAL_DISPLAY_DRM_FALLBACK_TO_CONNECTED:=1")
      && physicalDisplayPrepare.includes("TIKPAL_PHYSICAL_DISPLAY_DELAYED_KICK_SECONDS:=8 25")
      && physicalDisplayPrepare.includes("TIKPAL_PHYSICAL_DISPLAY_PCI_POWER_DEVICES:=")
      && physicalDisplayPrepare.includes("TIKPAL_PHYSICAL_DISPLAY_PCIE_ASPM_POLICY:=")
      && physicalDisplayPrepare.includes("TIKPAL_PHYSICAL_DISPLAY_DRM_POLL:=")
      && physicalDisplayPrepare.includes("TIKPAL_PHYSICAL_DISPLAY_NOUVEAU_PCI_ID:=")
      && physicalDisplayPrepare.includes("drm_connector_ready()")
      && physicalDisplayPrepare.includes("drm_connector_bases()")
      && physicalDisplayPrepare.includes("resolve_primary_output()")
      && physicalDisplayPrepare.includes("wait_for_drm_connector()")
      && physicalDisplayPrepare.includes("pci_stabilize()")
      && physicalDisplayPrepare.includes("drm_poll_stabilize()")
      && physicalDisplayPrepare.includes("nouveau_rebind()")
      && physicalDisplayPrepare.includes("setvcp D6 01")
      && physicalDisplayPrepare.includes("setvcp 10")
      && physicalDisplayPrepare.includes("setvcp 12")
      && physicalDisplayPrepare.includes("setvcp 60 \"$TIKPAL_PHYSICAL_DISPLAY_INPUT_SOURCE\"")
      && physicalDisplayPrepare.includes("xrandr --output \"$TIKPAL_KIOSK_XRANDR_OUTPUT\" --off")
      && physicalDisplayPrepare.includes("delayed_soft_kick()")
      && physicalDisplayPrepare.includes("XF86(PowerOff|Sleep|Suspend|Standby|Display|ScreenSaver)")
      && physicalDisplayPrepare.includes("xdotool search --onlyvisible --class Chromium-browser"),
    "physical display helper should wait for HDMI/USB display readiness, wake DDC safely, mode-reset the panel, stabilize PCI power, optionally rebind nouveau, block display power keys, and raise Chromium"
  );
  assert(kioskSession.includes("TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS"), "kiosk session should expose an X command timeout");
  assert(kioskSession.includes("run_x_command xset"), "kiosk session should bound xset commands");
  assert(kioskSession.includes("GTK_IM_MODULE=fcitx") && kioskSession.includes("XMODIFIERS=@im=fcitx"), "kiosk session should expose Fcitx5 to Chromium/X11");
  assert(kioskSession.includes("read_preferred_input_method") && kioskSession.includes("DefaultIM=$default_im") && kioskSession.includes("Name=keyboard-us") && kioskSession.includes("Name=pinyin") && kioskSession.includes("Name=keyboard-de") && kioskSession.includes("Name=keyboard-it") && kioskSession.includes("Name=hangul") && kioskSession.includes("Name=anthy") && kioskSession.includes("Name=keyboard-es"), "kiosk session should seed English, Chinese, German, Italian, Korean, Japanese, and Spanish input methods");
  assert(kioskSession.includes("0=F9") && kioskSession.includes("1=Control+space"), "kiosk session should configure touch and hardware input-method toggles without opening Chromium DevTools");
  assert(kioskSession.includes("ActiveByDefault=False") && kioskSession.includes("ShareInputState=All"), "kiosk input should start inactive while sharing the selected method across provider windows");
  assert(kioskSession.includes("fcitx_candidate_font()") && kioskSession.includes("Noto Sans CJK SC") && kioskSession.includes("Noto Sans CJK JP") && kioskSession.includes("Noto Sans CJK KR") && kioskSession.includes("Source Han Sans CN 16"), "Fcitx5 should render large CJK candidates with the best available locale-aware kiosk font");
  assert(kioskSession.includes("fcitx5 -d --replace"), "kiosk session should start Fcitx5 before Chromium");
  assert(kioskSession.includes("TIKPAL_KIOSK_RESET_WEB_MODE_ON_START") && kioskSession.includes('"$SCRIPT_DIR/tikpal-web-mode.sh" close'), "kiosk session should close Explore and clear provider state before launching the main kiosk");
  assert(webModeScript.includes("nohup \"$SCRIPT_DIR/tikpal-web-mode.sh\" guard"), "web mode should keep the window guard alive after the launcher exits");
  assert(webModeScript.includes("detect_non_hdmi_card_id"), "web mode should detect the actual non-HDMI ALSA card");
  assert(webModeScript.includes("tikpal-audio-adapt.sh") && webModeScript.includes("resolve-browser"), "web mode should use the shared audio adapter for auto ALSA output");
  assert(webModeScript.includes("resolve_web_mode_audio_devices()"), "web mode should lazily resolve auto ALSA output for provider windows");
  assert(webModeScript.includes("TIKPAL_WEB_MODE_PROVIDER_WINDOW_TIMEOUT_SECONDS") && webModeScript.includes("profile_window_timeout_attempts") && webModeScript.includes('wait_for_profile_window "$provider_profile" "$(profile_window_timeout_attempts "$TIKPAL_WEB_MODE_PROVIDER_WINDOW_TIMEOUT_SECONDS")"'), "web mode should bound provider window detection so failures can clean up before the API open timeout");
  assert(serverSource.includes("WEB_MODE_OPEN_COMMAND_TIMEOUT_MS") && serverSource.includes('action === "open" ? WEB_MODE_OPEN_COMMAND_TIMEOUT_MS : WEB_MODE_COMMAND_TIMEOUT_MS'), "API should let provider-open cleanup run longer than generic web mode commands");
  assert(serverSource.includes("TIKPAL_KIOSK_HEARTBEAT_HIDDEN_STALE_MS") && serverSource.includes("isHiddenPageHeartbeat") && serverSource.includes('ignoredReasons.push("event-loop-lag:hidden-page")') && serverSource.includes('ignoredReasons.push("heartbeat-stale:hidden-page")'), "API should not restart a hidden main kiosk for browser-throttled Explore heartbeat lag");
  assert(
    webModeScript.indexOf("resolve_web_mode_audio_devices", webModeScript.indexOf("open_provider()")) <
      webModeScript.indexOf("crossfade_available", webModeScript.indexOf("open_provider()")),
    "web mode should resolve auto ALSA output before opening providers"
  );
  assert(webModeCrossfadeScript.includes('configured_base_pcm="${TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE:-auto}"'), "Explore crossfade should default to auto ALSA output detection");
  assert(webModeCrossfadeScript.includes("resolve-browser") && webModeCrossfadeScript.includes("not safe for Explore softvol crossfade"), "Explore crossfade should use the adapter and decline non-dmix outputs");
  assert(!webModeCrossfadeScript.includes("BT66"), "Explore crossfade should not pin one ALSA card id");
  assert(audioAdaptScript.includes("TIKPAL_AUDIO_CARD_PRIORITY:=BT66,Crimson"), "audio adapter should prefer known USB cards in the configured order");
  assert(audioAdaptScript.includes("TIKPAL_AUDIO_ALLOW_UNKNOWN_SINGLE:=1"), "audio adapter should allow one unknown USB card by default");
  assert(audioAdaptScript.includes("multiple unknown non-HDMI audio cards detected"), "audio adapter should reject multiple unknown cards without a forced card");
  assert(audioAdaptScript.includes("resolve-browser") && audioAdaptScript.includes("resolve-audioout"), "audio adapter should expose browser and moOde PCM resolvers");
  assert(audioAdaptScript.includes("write_browser_output_config") && audioAdaptScript.includes("TIKPAL_AUDIO_BROWSER_SHARED_PCM"), "audio adapter should generate a shared conversion PCM for S24-only browser outputs");
  assert(audioAdaptScript.includes("printf 'snd_aloop\\n'") && audioAdaptScript.includes("snd_aloop is not visible after applying Loopback config"), "audio adapter apply should persist and verify the real snd_aloop module name");
  assert(audioAdaptScript.includes("wait_for_loopback_visible") && audioAdaptScript.includes("ensure_loopback_visible"), "audio adapter should wait for the real Loopback card after loading snd_aloop");
  assert(usbLibrarySyncScript.includes("USB_LIBRARY_AUTO_ROOTS") && usbLibrarySyncScript.includes("/media,/run/media"), "USB library sync should discover arbitrary mounted USB roots");
  assert(usbLibrarySyncScript.includes("USB_LIBRARY_AUTO_MOUNT") && usbLibrarySyncScript.includes("USB_LIBRARY_AUTO_MOUNT_WAIT_SECONDS") && usbLibrarySyncScript.includes("list_unmounted_usb_partitions") && usbLibrarySyncScript.includes("TRAN"), "USB library sync should optionally wait for and auto-mount removable USB partitions before scanning");
  assert(usbLibrarySyncScript.includes('USB_LIBRARY_AUTO_MOUNT="${TIKPAL_USB_LIBRARY_AUTO_MOUNT:-1}"') && systemdInstaller.includes("TIKPAL_USB_LIBRARY_AUTO_MOUNT=1"), "USB library auto-mount should default on for physical kiosks");
  assert(usbLibrarySyncScript.includes("skip_mount_name") && usbLibrarySyncScript.includes("rootfs"), "USB library sync should skip system partitions");
  assert(usbLibrarySyncScript.includes("MPC_UPDATE_TIMEOUT_SECONDS") && usbLibrarySyncScript.includes("update_mpd \"$USB_MPD_PREFIX\""), "USB library sync should time-bound MPD refresh after linking USB roots");
  assert(localLibrarySyncScript.includes("LOCAL_SOURCE_ROOT") && localLibrarySyncScript.includes("public/assets") && localLibrarySyncScript.includes("RSYNC_BIN") && localLibrarySyncScript.includes("--delete"), "Local library sync should mirror repo music into MPD's Codex directory");
  assert(localLibrarySyncScript.includes("LOCAL_IMPORTS_DIR_NAME") && localLibrarySyncScript.includes("--filter \"P /$safe_imports_dir/***\""), "Local library sync should protect copied USB Imports while pruning repo-owned Codex files");
  assert(localLibrarySyncScript.includes("MPC_UPDATE_TIMEOUT_SECONDS"), "Local library sync should time-bound MPD refresh after mirroring Codex");
  assert(localLibrarySyncScript.includes("TIKPAL_MPD_DEFAULT_QUEUE_PATH:-Codex") && localLibrarySyncScript.includes("unlink \"$target_dir\""), "Local library sync should replace the old inaccessible Codex symlink with a real MPD directory");
  assert(librarySyncScript.includes("tikpal-local-library-sync.sh") && librarySyncScript.includes("tikpal-usb-library-sync.sh"), "combined library sync should run both Local and USB helpers");
  assert(alsaLoopbackScript.includes("modprobe_command") && alsaLoopbackScript.includes("snd_aloop"), "ALSA Loopback helper should load the real snd_aloop module name through a resolved modprobe path");
  assert(airplayEnableScript.includes("TIKPAL_AIRPLAY_IGNORE_VOLUME_CONTROL:-no") && airplayEnableScript.includes("TIKPAL_AIRPLAY_DEFAULT_VOLUME_DB:-0.0"), "AirPlay enable should preserve phone volume control while avoiding Shairport's quiet default");
  assert(airplayEnableScript.includes("TIKPAL_AIRPLAY_VOLUME_RANGE_DB:-30") && airplayEnableScript.includes("TIKPAL_AIRPLAY_VOLUME_CONTROL_PROFILE:-flat"), "AirPlay enable should keep Shairport's software volume curve audible at mid phone volume");
  assert(sndAloopEnableScript.includes("printf 'snd_aloop\\n'") && sndAloopEnableScript.includes("exit 1"), "standalone Loopback enable script should persist snd_aloop and fail if Loopback stays hidden");
  assert(webModeScript.includes('open_provider "${2:-qq_music}"'), "web mode should default initial Explore launch to QQ Music");
  assert(webModeScript.includes("xdotool is required for Explore provider window detection"), "web mode --check should fail clearly when xdotool is missing");
  assert(webModeScript.includes("window-guard.pid"), "web mode should track the persistent window guard pid");
  assert(webModeScript.includes("TIKPAL_WEB_MODE_QQ_MV_AUTO_FULLSCREEN:=0"), "web mode should keep QQ MV auto fullscreen off by default");
  assert(webModeScript.includes('TIKPAL_WEB_MODE_QQ_MV_AUTO_FULLSCREEN="$TIKPAL_WEB_MODE_QQ_MV_AUTO_FULLSCREEN"'), "web mode should pass the QQ MV fullscreen switch to the provider guard");
  assert(webModeScript.includes("TIKPAL_WEB_MODE_QQ_MV_CINEMA_MODE:=1"), "web mode should enable QQ MV cinema mode by default");
  assert(webModeScript.includes('TIKPAL_WEB_MODE_QQ_MV_CINEMA_MODE="$TIKPAL_WEB_MODE_QQ_MV_CINEMA_MODE"'), "web mode should pass the QQ MV cinema switch to the provider guard");
  assert(webModeScript.includes("TIKPAL_WEB_MODE_QQ_MV_AUTO_PLAY:=1"), "web mode should enable conditional QQ MV auto play by default");
  assert(webModeScript.includes('TIKPAL_WEB_MODE_QQ_MV_AUTO_PLAY="$TIKPAL_WEB_MODE_QQ_MV_AUTO_PLAY"'), "web mode should pass the QQ MV auto-play switch to the provider guard");
  assert(webModeScript.includes("TIKPAL_WEB_MODE_NETEASE_AUTO_PLAY:=1"), "web mode should enable conditional NetEase auto play by default");
  assert(webModeScript.includes('TIKPAL_WEB_MODE_NETEASE_AUTO_PLAY="$TIKPAL_WEB_MODE_NETEASE_AUTO_PLAY"'), "web mode should pass the NetEase auto-play switch to the provider guard");
  assert(serverSource.includes("/api/v1/preferences") && serverSource.includes("UI_LOCALE_INPUT_METHODS"), "API should expose persisted UI language preferences and input-method mapping");
  assert(
    serverSource.includes("FONT_THEMES")
      && serverSource.includes("fontTheme")
      && serverSource.includes("UI_KEYBOARD_VISUAL_SYNC_COMMAND")
      && serverSource.includes("syncUiKeyboardVisual")
      && serverSource.includes("hasFontThemePatch"),
    "API should persist the selected font theme and sync Onboard keycap visuals"
  );
  assert(appSource.includes("updatePreferences({ fontTheme })"), "kiosk should sync the selected font theme to device preferences");
  assert(i18nSource.includes("document.documentElement.dataset.fontTheme = preferences.fontTheme"), "shared React roots should apply the persisted font theme to the document");
  assert(stylesSource.includes(".web-mode-panel") && stylesSource.includes("font-family: var(--app-font-family);"), "Explore side panel should use the shared Tikpal font family");
  assert(serverSource.includes("DISPLAY_SLEEP_STYLES") && serverSource.includes("meteor_shower") && serverSource.includes("signal"), "API should persist the selected screen sleep saver style");
  assert(i18nSource.includes('UiLocale = "en" | "zh-CN" | "de" | "it" | "ko" | "ja" | "es"') || i18nSource.includes('"zh-CN"'), "kiosk i18n should include the seven supported UI locales");
  assert(quickSettingsSource.includes('data-settings-detail="language"') && quickSettingsSource.includes("languageOptions"), "Settings Preferences should expose the Language detail first");
  assert(quickSettingsSource.includes("displaySleepStyleChoices") && quickSettingsSource.includes("settings.sleepStyle"), "Settings Display should expose compact screen saver style choices");
  assert(quickSettingsSource.includes("onPreviewScreenSaver") && quickSettingsSource.includes("settings.previewSleepStyle"), "Settings Display should expose a screen saver preview button");
  assert(!quickSettingsSource.includes("disabled={!sleepEnabled || preferencesPending}"), "Screen sleep style and time choices should remain editable while automatic sleep is off");
  assert(appSource.includes("data-screen-saver-style") && appSource.includes("screen-saver-now-playing") && appSource.includes("screen-saver-meteor-shower") && appSource.includes("screen-saver-signal"), "soft screen sleep should render selectable classic screen saver overlays");
  assert(appSource.includes("SCREEN_SAVER_PREVIEW_STYLES") && appSource.includes("data-screen-saver-preview"), "screen saver preview should cycle the available styles without changing preferences");
  assert(appSource.includes("setWebModeSleepSuppressed") && appSource.includes("webModeActiveRef.current") && appSource.includes("fetchWebModeState"), "Explore should suppress automatic screen sleep while a provider is active");
  assert(onboardImeToggleScript.includes("--set-locale") && onboardImeToggleScript.includes("--set-mode") && onboardImeToggleScript.includes('"ko": "hangul"'), "Onboard IME toggle should support locale and direct mode sync");
  assert(onboardImeToggleScript.includes("key-label-font") && onboardImeToggleScript.includes("FONT_THEME_FAMILIES") && onboardImeToggleScript.includes("ui-preferences.json") && onboardImeToggleScript.includes("TIKPAL_FONT_THEME"), "Onboard keycaps should read Tikpal font preference and apply key-label-font");
  assert(
    onboardImeToggleScript.includes("_sync_fcitx_default_im(mode)")
      && onboardImeToggleScript.includes("DefaultIM={mode_id}")
      && onboardImeToggleScript.indexOf('_remote("-s", str(mode["id"]))') < onboardImeToggleScript.indexOf('_remote("-o" if mode["active"] else "-c")'),
    "Onboard IME switches should persist Fcitx DefaultIM and activate only after selecting the target mode"
  );
  assert(
    onboardImeToggleScript.includes("onboard-ime-state.json")
      && onboardImeToggleScript.includes("_read_cycle_mode_id()")
      && onboardImeToggleScript.includes("_write_cycle_mode_id(str(mode[\"id\"]))"),
    "Onboard IME key should use its own cycle state instead of bouncing on transient Fcitx state"
  );
  assert(
    onboardImeToggleScript.includes("keep_visible: bool = False")
      && onboardImeToggleScript.includes("keep_visible=True")
      && onboardImeToggleScript.includes("org.onboard.Onboard.Keyboard.Show"),
    "Onboard IME key should keep the keyboard open without popping it during Settings preference sync"
  );
  assert(onboardImeToggleScript.includes("_refuse_root_session()") && onboardImeToggleScript.includes("TIKPAL_ALLOW_ROOT_IME_SYNC"), "Onboard IME sync should not start a root-owned Fcitx session by accident");
  assert(serverSource.includes("TIKPAL_FONT_THEME=%FONT_THEME%"), "API font changes should pass the active font theme to the Onboard visual sync command");
  assert(kioskSession.includes("read_preferred_input_method") && kioskSession.includes("ui-preferences.json") && kioskSession.includes("fcitx5-remote -s \"$default_im\""), "kiosk session should default Fcitx from persisted UI preferences");
  assert(kioskSession.includes('export TIKPAL_APP_DIR="${TIKPAL_APP_DIR:-$APP_DIR}"'), "kiosk session should expose the app dir so Onboard scripts can read UI preferences");
  assert(webModeScript.includes('export TIKPAL_APP_DIR="${TIKPAL_APP_DIR:-$APP_DIR}"'), "web mode should expose the app dir so Onboard scripts can read UI preferences");
  assert(webModeErrorPage.includes("/api/v1/preferences") && webModeErrorPage.includes('"zh-CN"') && webModeErrorPage.includes("applyLocale"), "Explore error page should localize itself from device preferences");
  assert(webModeScript.includes('node --experimental-websocket "$helper"'), "web mode should enable the Node 20 WebSocket API for the provider guard");
  assert(webModeScript.includes('flock -x -w "$TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS"'), "web mode should not wait forever on provider switch locks");
  assert(webModeScript.includes("9>&- &"), "web mode background children should not inherit the provider switch lock");
  assert(
    webModeScript.indexOf('export DBUS_SESSION_BUS_ADDRESS="$session_bus"') < webModeScript.indexOf('systemd-run --user --quiet --unit=tikpal-onboard'),
    "web mode should bind Onboard to the existing user DBus session before launch"
  );
  assert(webModeScript.includes('systemd-run --user --quiet --unit=tikpal-onboard'), "web mode should keep Onboard outside the API launcher process tree");
  assert(webModeScript.includes('systemctl --user start tikpal-onboard.service'), "web mode should reuse the resident Onboard user service");
  assert(webModeScript.includes("timeout 1 gdbus call"), "web mode should retry Onboard DBus calls while its service starts");
  assert(webModeScript.includes("Onboard.Keyboard.$method"), "web mode should share Onboard DBus Show and Hide calls");
  assert(webModeScript.includes("call_onboard_method Show"), "web mode should keep DBus Show as a fallback when xdotool map is not enough");
  assert(webModeScript.includes("call_onboard_method Hide"), "web mode should hide Onboard without terminating it");
  assert(!webModeScript.includes("windowunmap"), "web mode should not unmap Onboard because that terminates the resident process");
  assert(webModeScript.includes("Class: InputOnly"), "web mode should ignore Onboard's transparent input-only helper window");
  assert(webModeScript.includes('getwindowname "$window"'), "web mode should ignore Onboard's cold-start placeholder window");
  assert(webModeScript.includes("xdotool windowraise"), "web mode should raise Onboard above Chromium without relying on a window manager");
  assert(!webModeScript.slice(webModeScript.indexOf("keyboard)"), webModeScript.indexOf("proxy)")).includes("check_runtime"), "keyboard actions should skip the full Explore runtime check for responsive input");
  assert(!webModeScript.slice(webModeScript.indexOf("keyboard)"), webModeScript.indexOf("proxy)")).includes("with_web_mode_lock"), "keyboard actions should not wait for Explore provider switch locks");
  assert(!webModeScript.slice(webModeScript.indexOf("keyboard)"), webModeScript.indexOf("proxy)")).includes("resolve_web_mode_audio_devices"), "keyboard actions should not run Explore audio auto-detection");
  assert(webModeScript.includes("with_onboard_lock()"), "keyboard actions should use a dedicated Onboard lock instead of the provider switch lock");
  assert(webModeScript.includes("onboard_visible_windows"), "web mode should detect whether Onboard is already visible");
  assert(webModeScript.includes("xdotool windowfocus"), "web mode should still have a browser focus helper for fallback paths");
  assert(webModeScript.includes("focused_browser_window"), "web mode should recover browser focus even when X has no active window");
  assert(webModeScript.includes("window_uses_profile"), "web mode should return keyboard focus to the active provider window, not the kiosk window");
  assert(webModeScript.includes("read_runtime_active_provider"), "keyboard focus recovery should find the active provider window");
  assert(webModeScript.includes("TIKPAL_CHROMIUM_PROFILE_DIR") && webModeScript.includes("kiosk_browser_window"), "local kiosk keyboard focus recovery should target the main Chromium profile");
  assert(webModeScript.includes("TIKPAL_WEB_MODE_KEYBOARD_TARGET") && webModeScript.includes("restore_local_kiosk_keyboard_focus"), "keyboard show should restore X focus to the kiosk only for local Settings inputs");
  assert(webModeScript.includes("TIKPAL_WEB_MODE_ONBOARD_SUPPRESS_PATH"), "explicit keyboard hide should suppress periodic provider auto-show");
  assert(webModeScript.includes("show-force"), "new provider input focus should clear manual keyboard suppression");
  assert(webModeScript.includes("preload) with_onboard_lock preload_onboard"), "Console should be able to preload resident Onboard before the first text-field tap");
  assert(webModeScript.includes("show-force) with_onboard_lock force_onboard"), "keyboard requests should serialize cold Onboard startup without waiting for provider switches");
  assert(webModeScript.includes("move_onboard_if_requested"), "keyboard requests with local kiosk geometry should move Onboard away from focused Console fields");
  assert(webModeScript.includes("TIKPAL_WEB_MODE_ONBOARD_REQUESTED_POSITION"), "web mode should only move Onboard when the API explicitly supplies a per-focus position");
  assert(webModeScript.includes("TIKPAL_WEB_MODE_ONBOARD_ACTION_POSITION"), "web mode should preserve per-action Onboard coordinates after sourcing .env.kiosk");
  assert(!webModeScript.slice(webModeScript.indexOf("ensure_onboard()"), webModeScript.indexOf("hide_onboard()")).includes("focus_window"), "web mode should not change X focus while showing Onboard");
  assert(!webModeScript.includes('if [[ -z "$(onboard_visible_windows)" ]]; then\n    call_onboard_method Show'), "web mode should not skip DBus Show just because a stale Onboard X window is visible");
  assert(!webModeScript.slice(webModeScript.indexOf("ensure_onboard()"), webModeScript.indexOf("hide_onboard()")).includes("position_onboard"), "web mode should not xdotool-map Onboard while showing it");
  assert(webModeScript.includes("call_onboard_method Show || true\n  sleep 0.2\n  call_onboard_method Show || true"), "web mode should ask Onboard to show twice to unfold stale windows");
  assert(webModeScript.includes("call_onboard_method Show || true\n  sleep 0.1\n  raise_onboard"), "web mode should raise Onboard only after the second DBus Show");
  assert(webModeScript.includes("raise_onboard()"), "web mode should have a no-focus Onboard raise path");
  assert(webModeScript.indexOf("call_onboard_method Show || true", webModeScript.indexOf("ensure_onboard()")) < webModeScript.indexOf("raise_onboard", webModeScript.indexOf("ensure_onboard()")), "web mode should show Onboard before raising it above Chromium");
  assert(webModeScript.includes("raise_window_without_focus"), "web mode guard should raise provider and side-panel windows without stealing input focus");
  assert(webModeScript.includes('raise_window_without_focus "$window"'), "web mode guard should keep tiled provider windows above the full-screen kiosk");
  assert(webModeScript.includes("mark_window_above()") && webModeScript.includes("-b add,above"), "Explore provider and side-panel windows should use the above hint so fullscreen kiosk cannot cover them");
  assert(webModeScript.includes("clear_window_above()") && webModeScript.includes("-b remove,above"), "Explore background and inactive provider windows should not keep the above hint");
  assert(webModeScript.includes('while kill -0 "$pid"') && webModeScript.includes('kill -KILL "$pid"'), "provider guard shutdown should wait and force-kill stale guards before starting a replacement");
  assert(webModeScript.includes("TIKPAL_TILE_WINDOW_CHANGED=0"), "web mode guard should track whether a Chromium window actually needed retile");
  assert(webModeScript.includes('local force_raise="${3:-0}"'), "web mode guard should force a single provider raise when the guard first starts");
  assert(webModeScript.includes("stack_refresh_ticks") && webModeScript.includes('if [[ "$stack_refresh_ticks" -ge 4 ]]'), "web mode guard should periodically reassert provider stacking above the kiosk without doing it every tick");
  assert(webModeScript.includes('[[ "$did_restack" == "1" ]] && raise_onboard'), "web mode guard should not raise Onboard on every polling pass");
  assert(webModeScript.includes('pkill -KILL -f -- "--user-data-dir=$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"'), "Explore close should force-exit a side panel that ignores graceful shutdown");
  assert(webModeScript.includes("org.onboard.window force-to-top true"), "Onboard should enable its Always on Top setting");
  assert(webModeScript.includes("org.onboard.window window-state-sticky true"), "Onboard should keep its always-on-top window sticky");
  assert(webModeScript.includes("org.onboard.auto-show enabled false"), "Tikpal focus events should own Onboard visibility");
  assert(webModeScript.includes("org.onboard.auto-show hide-on-key-press false"), "Onboard should stay open while typing provider login fields");
  assert(webModeScript.includes("org.onboard.window enable-inactive-transparency false"), "Onboard should not become transparent while Chromium keeps input focus");
  assert(webModeScript.includes("org.onboard show-status-icon false"), "web mode should hide Onboard's status icon");
  assert(webModeScript.includes("org.onboard.icon-palette in-use false"), "web mode should hide Onboard's floating icon palette");
  assert(webModeScript.includes("configure_onboard"), "web mode should normalize Onboard settings on cold start");
  assert(webModeScript.includes("configure_onboard_visibility"), "web mode should reapply Onboard always-on-top settings on every show");
  assert(webModeScript.slice(webModeScript.indexOf("configure_onboard()"), webModeScript.indexOf("window_uses_profile()")).includes('export DBUS_SESSION_BUS_ADDRESS="$session_bus"'), "Onboard settings should use the kiosk user DBus session");
  assert(webModeScript.includes("org.onboard.keyboard input-event-source XInput"), "Onboard should use XInput events for Chromium provider login typing");
  assert(webModeScript.includes("org.onboard.keyboard key-synth XTest"), "Onboard should synthesize keys through XTest for Chromium provider typing");
  assert(webModeScript.indexOf("raise_onboard", webModeScript.indexOf("done < <(visible_chromium_windows)")) < webModeScript.indexOf("is_enabled \"$TIKPAL_WEB_MODE_SINGLE_PROVIDER_WINDOW\""), "window guard should restore Onboard above provider windows before early returns");
  assert(webModeScript.lastIndexOf("raise_onboard", webModeScript.indexOf("start_window_guard()")) > webModeScript.indexOf('raise_window_without_focus "$keep_window"'), "window guard should restore Onboard above the kept provider window");
  assert(webModeScript.includes("install_onboard_ime_toggle_script"), "web mode should install the direct Fcitx5 Onboard toggle script");
  assert(webModeScript.includes("install_onboard_ime_color_scheme"), "web mode should install Tikpal's Onboard IME color scheme");
  assert(webModeScript.includes('key.set("script", "tikpalImeToggle")'), "Onboard should use a direct script key for the Fcitx5 toggle instead of a swallowed hotkey");
  assert(webModeScript.includes('key.set("svg_id", "LWIN")'), "Onboard should keep the input-method toggle in the Compact Super key position");
  assert(webModeScript.includes('"ime_theme": "TIKPAL-IME-INACTIVE"') && webModeScript.includes('"ime_theme": "TIKPAL-IME-ACTIVE"'), "Onboard should use separate theme ids for inactive and active IME visuals");
  assert(webModeScript.includes('"ime_label": "EN"') && webModeScript.includes('"ime_label": "中文"') && webModeScript.includes('"ime_label": "DE"') && webModeScript.includes('"ime_label": "IT"') && webModeScript.includes('"ime_label": "한국어"') && webModeScript.includes('"ime_label": "日本語"') && webModeScript.includes('"ime_label": "ES"'), "Onboard should label the input-method key for all configured modes");
  assert(webModeScript.includes('"SPCE": "空格"') && webModeScript.includes('"SPCE": "Leertaste"') && webModeScript.includes('"SPCE": "Spazio"') && webModeScript.includes('"SPCE": "스페이스"') && webModeScript.includes('"SPCE": "変換"') && webModeScript.includes('"SPCE": "Espacio"'), "Onboard should localize main action labels for Chinese, German, Italian, Korean, Japanese, and Spanish");
  assert(webModeScript.includes('"RTRN": "↵"'), "Chinese Onboard return key should use a compact icon label instead of oversized text");
  assert(webModeScript.includes('"AE11": "ß ?"') && webModeScript.includes('"AD11": "Ü"') && webModeScript.includes('"AC10": "Ö"') && webModeScript.includes('"AC11": "Ä"'), "Onboard should show visible German keycap differences");
  assert(webModeScript.includes('"AE12": "ì ^"') && webModeScript.includes('"AD11": "è é"') && webModeScript.includes('"AC10": "ò ç"') && webModeScript.includes('"BKSL": "ù §"'), "Onboard should show visible Italian keycap differences");
  assert(webModeScript.includes('"AD01": "ㅂ"') && webModeScript.includes('"AC03": "ㅇ"') && webModeScript.includes('"AB07": "ㅡ"'), "Onboard should show Korean 2-beolsik keycap hints");
  assert(webModeScript.includes('"AC10": "Ñ"') && webModeScript.includes('"AE12": "¡ ¿"') && webModeScript.includes('"AC11": "´ ¨"') && webModeScript.includes('"BKSL": "Ç"'), "Onboard should show the visible Spanish keycap differences");
  assert(webModeScript.includes("Tikpal-Compact-Pinyin.onboard") && webModeScript.includes("Tikpal-Compact-German.onboard") && webModeScript.includes("Tikpal-Compact-Italian.onboard") && webModeScript.includes("Tikpal-Compact-Korean.onboard") && webModeScript.includes("Tikpal-Compact-Japanese.onboard") && webModeScript.includes("Tikpal-Compact-Spanish.onboard"), "Onboard should have separate visual layouts for every non-English mode");
  assert(webModeScript.includes("Tikpal-Classic.colors"), "Onboard should apply Tikpal's color scheme for the IME key");
  assert(webModeScript.includes("tikpalImeToggle.py --sync"), "Onboard should sync the IME key visual state when the keyboard is configured");
  assert(webModeScript.includes("sync_onboard_input_method_visual") && webModeScript.indexOf("sync_onboard_input_method_visual", webModeScript.indexOf("ensure_onboard()")) < webModeScript.indexOf("call_onboard_method Show", webModeScript.indexOf("ensure_onboard()")), "Onboard should reapply the IME color scheme after the Onboard process starts");
  assert(onboardImeToggleScript.includes('fcitx5-remote') && onboardImeToggleScript.includes('"id": "keyboard-us"') && onboardImeToggleScript.includes('"id": "pinyin"') && onboardImeToggleScript.includes('"id": "keyboard-de"') && onboardImeToggleScript.includes('"id": "keyboard-it"') && onboardImeToggleScript.includes('"id": "hangul"') && onboardImeToggleScript.includes('"id": "anthy"') && onboardImeToggleScript.includes('"id": "keyboard-es"'), "Onboard IME toggle script should cycle Fcitx5 directly through English, Chinese, German, Italian, Korean, Japanese, and Spanish");
  assert(onboardImeToggleScript.includes("Tikpal-Compact-Pinyin.onboard") && onboardImeToggleScript.includes("Tikpal-Compact-German.onboard") && onboardImeToggleScript.includes("Tikpal-Compact-Italian.onboard") && onboardImeToggleScript.includes("Tikpal-Compact-Korean.onboard") && onboardImeToggleScript.includes("Tikpal-Compact-Japanese.onboard") && onboardImeToggleScript.includes("Tikpal-Compact-Spanish.onboard") && onboardImeToggleScript.includes("Tikpal-Classic.colors"), "Onboard IME toggle script should update layout and color scheme after switching input methods");
  assert(onboardImeToggleScript.includes('"--sync"'), "Onboard IME toggle script should expose a visual-state sync mode");
  assert(onboardTheme.includes("TIKPAL-IME-ACTIVE") && onboardTheme.includes("#35d0ba"), "Tikpal Onboard theme should define a clear active color for the IME key");
  assert(onboardTheme.includes("TIKPAL-KEY-GERMAN") && onboardTheme.includes("TIKPAL-KEY-ITALIAN") && onboardTheme.includes("TIKPAL-KEY-KOREAN"), "Tikpal Onboard theme should define language key colors for German, Italian, and Korean layouts");
  assert(systemdInstaller.includes("fcitx5-anthy") && systemdInstaller.includes("fcitx5-hangul"), "systemd installer should request Japanese and Korean Fcitx5 engines on apt-based kiosks");
  assert(systemdInstaller.includes("install_onboard_themes") && systemdInstaller.includes("Tikpal-Classic.colors"), "systemd installer should install Tikpal's Onboard IME color scheme");
  assert(deployDoc.includes("tikpalImeToggle.py"), "Pi deployment docs should describe the direct Onboard IME toggle script");
  assert(webModeScript.includes("gsettings reset org.onboard layout"), "Onboard should fall back to its packaged Compact layout when Fcitx5 is unavailable");
  assert(webModeScript.includes("org.onboard.window.landscape x"), "Onboard should open at the Tikpal keyboard X position without a visible jump");
  assert(webModeScript.includes("org.onboard.window.landscape y"), "Onboard should open at the Tikpal keyboard Y position without a visible jump");
  assert(!webModeScript.slice(webModeScript.indexOf("hide_onboard()"), webModeScript.indexOf("toggle_onboard()")).includes("configure_onboard"), "web mode should not rewrite live Onboard settings while hiding it");
  assert(webModeScript.includes('"$((width - 1))" "$((height - 1))"'), "Onboard cold start should force one redraw before its final size");
  const mainSource = await readFile(path.join(ROOT, "src/main.tsx"), "utf8");
  assert(mainSource.includes("onboardInputSelector"), "local kiosk text inputs should share automatic Onboard activation");
  assert(mainSource.includes("onboardVisibleRequested"), "local kiosk inputs should avoid duplicate keyboard hide requests before a keyboard has been shown");
  assert(mainSource.includes("inputSessionActive") && mainSource.includes("lastKeyboardRequestMs"), "local kiosk inputs should keep an active input session and throttle repeated keyboard requests");
  assert(mainSource.includes("localKioskHosts.has(window.location.hostname)"), "automatic Onboard activation should stay on the physical kiosk host");
  assert(mainSource.includes("sendWebModeAction({") && mainSource.includes("keepAlive: true"), "local kiosk inputs should explicitly show, hide, and keep Onboard alive");
  assert(mainSource.includes("keyboardPlacementForTarget") && mainSource.includes("rectsOverlap"), "local kiosk inputs should choose a keyboard position that avoids the focused field");
  assert(mainSource.includes("keyboardPosition") && mainSource.includes("keyboardWindow"), "local kiosk inputs should send per-focus Onboard geometry to the API");
  assert(mainSource.includes('keyboardTarget: "kiosk"'), "local kiosk inputs should tell the keyboard helper to restore focus to the kiosk Chromium window");
  assert(mainSource.includes("lastKeyboardBounds") && mainSource.includes("pointerInsideOnboardKeyboard"), "local kiosk inputs should ignore underlying pointer events inside the Onboard window");
  assert(mainSource.includes("event.stopImmediatePropagation()"), "underlying Onboard pointer events should not leak into Player or Settings controls");
  assert(mainSource.includes("onboardStickyInputSelector") && mainSource.includes("pointerInsideStickyKeyboardZone"), "sticky kiosk inputs should survive Onboard key taps that land outside the exact keyboard bounds");
  assert(mainSource.includes("recentInputActivity") && mainSource.includes('document.addEventListener("compositionupdate"'), "local kiosk inputs should keep Onboard alive while text or IME composition is arriving");
  assert(mainSource.includes("keepTextInputFocus"), "local kiosk inputs should keep focus when Onboard appears");
  assert(mainSource.includes("outsidePointerDown"), "local kiosk inputs should still hide Onboard when the user taps outside");
  assert(mainSource.includes("markTextInputActivity(target)") && mainSource.includes('document.addEventListener("pointerdown"'), "local kiosk should start showing Onboard on pointerdown before focus settles");
  assert(mainSource.includes("inputSessionActive && lastTextInput?.isConnected && (!outsidePointerDown || stickyInputSessionActive() || recentInputActivity())"), "local kiosk focusout should not hide Onboard while an active or sticky text input session is still alive");
  assert(mainSource.includes("tikpal:keyboard-context-clear"), "local kiosk should clear input focus state when Settings closes");
  assert(mainSource.includes('document.addEventListener("focusout"'), "local kiosk inputs should hide Onboard after focus leaves text input");
  assert(playerOverlaySource.includes('data-library-search-input') && playerOverlaySource.includes('data-onboard-sticky="true"'), "Player Library search should keep Onboard open while typing filter text");
  assert(quickSettingsSource.includes("inputSessionStarted") && quickSettingsSource.includes("sendWebModeAction({ type: \"keyboard\", preload: true })"), "Console Explore Proxy preload should skip itself once the proxy input session starts");
  assert(serverSource.includes("normalizeWebModeKeyboardPosition") && serverSource.includes("normalizeWebModeKeyboardWindow"), "API should validate per-focus keyboard geometry before invoking the launcher");
  assert(serverSource.includes("runWebModeKeyboardCommand") && serverSource.includes("isWebModeSwitchingError"), "API should retry keyboard show requests that collide with Explore provider switching");
  assert(serverSource.includes("TIKPAL_WEB_MODE_ONBOARD_ACTION_POSITION") && serverSource.includes("TIKPAL_WEB_MODE_ONBOARD_ACTION_WINDOW"), "API should pass per-action keyboard geometry without relying on .env-overridable variables");
  assert(serverSource.includes("normalizeWebModeKeyboardTarget") && serverSource.includes("TIKPAL_WEB_MODE_KEYBOARD_TARGET"), "API should pass the local kiosk keyboard target to the launcher");
  assert(serverSource.includes("TIKPAL_WEB_MODE_ONBOARD_POSITION") && serverSource.includes("TIKPAL_WEB_MODE_ONBOARD_WINDOW"), "API should pass validated keyboard geometry to the launcher");
  const openProviderBody = webModeScript.slice(
    webModeScript.indexOf("open_provider()"),
    webModeScript.indexOf("check_runtime()")
  );
  assert(
    openProviderBody.indexOf("ensure_side_panel") >= 0 &&
      openProviderBody.indexOf("ensure_side_panel") < openProviderBody.indexOf("launch_transition_veil"),
    "web mode should show the right provider panel before the left loading veil"
  );
  assert(openProviderBody.includes('ensure_side_panel "$provider"'), "initial Explore should tell the side panel which provider is opening");
  assert(openProviderBody.includes('ensure_background_veil "$provider"'), "initial Explore should start a branded left background before provider switching");
  assert(openProviderBody.includes('launch_transition_veil "$provider"'), "the visible Explore veil should receive the target provider");
  assert(webModeScript.includes("ensure_background_veil()") && webModeScript.includes("close_background_veil"), "Explore should own a branded left background that closes with Explore");
  assert(webModeScript.includes("launch_error_veil()") && webModeScript.includes("recover_or_cover_provider_failure()"), "provider failures should keep a complete left Explore surface");
  assert(openProviderBody.includes("recover_or_cover_provider_failure") && openProviderBody.includes("close_error_veil"), "provider open failures should recover an old provider or show the friendly error veil");
  assert(webModeScript.includes("TIKPAL_WEB_MODE_PROXY_CONNECT_ERROR:=Proxy did not connect. Try again."), "proxy failures should use a short user-facing retry message");
  assert(webModeScript.includes('panel_url="$panel_url?opening=$opening_provider"'), "initial side panel URL should carry its pending provider");
  assert(webModeScript.includes('transition_url="$transition_url?provider=$provider"'), "transition veil URL should carry its provider identity");
  assert(webModeScript.includes('error_url="$TIKPAL_WEB_MODE_ERROR_PAGE_URL?provider=$provider_param&label=$label_param&reason=$reason_param&proxy=$proxy_param"'), "friendly Explore error pages should carry provider, reason, and proxy state");
  assert(openProviderBody.includes('launch_url="$TIKPAL_WEB_MODE_TRANSITION_URL?provider=$provider"'), "extension-enabled providers should start on the local bootstrap page");
  assert(webModeScript.includes("provider_uses_direct_bootstrap()") && webModeScript.includes("deezer) return 0") && openProviderBody.includes('if [[ "$proxy_enabled" == "1" && -n "$proxy_url" && ( "$extension_enabled" != "1" || "$launch_url" == "$url" ) ]]'), "command-line proxy switches should remain limited to extension-disabled fallback and explicit direct-bootstrap providers");
  assert(webModeScript.includes('target.type === "page"') && openProviderBody.includes("wait_for_real_provider_url"), "provider switches should wait for a real HTTPS page rather than a stale service worker");
  assert(webModeScript.includes("wait_for_proxy_applied"), "dynamic proxy actions should wait for extension confirmation");
  assert(webModeScript.includes('log "proxy applied without restarting $provider; provider pool prewarm restarted"'), "dynamic proxy actions should preserve the provider process and restart pool prewarm");

  const loopbackGuardDir = mkdtempSync(path.join(tmpdir(), "tikpal-loopback-guard-"));
  const hdmiLoopbackConfig = path.join(loopbackGuardDir, "_sndaloop-hdmi.conf");
  const externalLoopbackConfig = path.join(loopbackGuardDir, "_sndaloop-external.conf");
  writeFileSync(
    hdmiLoopbackConfig,
    'pcm.!_audioout {\n  type plug\n  slave.pcm {\n    type multi\n    slaves {\n      a { channels 2 pcm "default:vc4hdmi0" }\n      b { channels 2 pcm "hw:Loopback,0" }\n    }\n  }\n}\n'
  );
  writeFileSync(
    externalLoopbackConfig,
    'pcm.!_audioout {\n  type plug\n  slave.pcm {\n    type multi\n    slaves {\n      a { channels 2 pcm "hw:TikpalSpeaker,0" }\n      b { channels 2 pcm "hw:Loopback,0" }\n    }\n  }\n}\n'
  );
  const hdmiGuardCheck = spawnSync("sh", ["-c", ". ./deploy/moode/tikpal-alsa-loopback.sh; tikpal_validate_alsa_loopback_config \"$1\"", "sh", hdmiLoopbackConfig], {
    cwd: ROOT,
    encoding: "utf8"
  });
  assert(hdmiGuardCheck.status !== 0, "ALSA Loopback guard should reject HDMI-only physical output by default");
  assert(hdmiGuardCheck.stderr.includes("HDMI"), "ALSA Loopback guard should explain HDMI-only rejection");

  const externalGuardCheck = spawnSync("sh", ["-c", ". ./deploy/moode/tikpal-alsa-loopback.sh; tikpal_validate_alsa_loopback_config \"$1\"", "sh", externalLoopbackConfig], {
    cwd: ROOT,
    encoding: "utf8"
  });
  assert(externalGuardCheck.status === 0, `ALSA Loopback guard should accept non-HDMI physical output:\n${externalGuardCheck.stdout}\n${externalGuardCheck.stderr}`);

  const check = spawnSync("bash", ["deploy/chromium/launch-tikpal-kiosk.sh", "--check"], {
    cwd: ROOT,
    env: {
      ...process.env,
      TIKPAL_CHROMIUM_BIN: process.execPath,
      TIKPAL_CHROMIUM_PROFILE_DIR: path.join(ROOT, ".tikpal", "kiosk-smoke-profile"),
      TIKPAL_KIOSK_REMOTE_DEBUG: "1",
      TIKPAL_KIOSK_REMOTE_DEBUG_ADDRESS: "0.0.0.0",
      TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_PORT: "9223",
      TIKPAL_KIOSK_XRANDR_MODE: "none"
    },
    encoding: "utf8"
  });

  assert(check.status === 0, `launcher --check failed:\n${check.stdout}\n${check.stderr}`);
  assert(check.stdout.includes("check passed"), "launcher --check should report success");
  assert(check.stdout.includes("chromium window: 2560,720"), "launcher should normalize Chromium window size");
  assert(check.stdout.includes("window position: 0,0"), "launcher should pin Chromium to the top-left display origin");
  assert(check.stdout.includes("remote debug: 0.0.0.0:9222 -> 127.0.0.1:9223"), "launcher should report remote debugging proxy target");

  const overrideEnvDir = mkdtempSync(path.join(tmpdir(), "tikpal-kiosk-env-override-"));
  const overrideEnvFile = path.join(overrideEnvDir, ".env.kiosk");
  writeFileSync(overrideEnvFile, "TIKPAL_KIOSK_WINDOW=800x600\nTIKPAL_KIOSK_XRANDR_MODE=none\n");
  const skipEnvCheck = spawnSync("bash", ["deploy/chromium/launch-tikpal-kiosk.sh", "--check"], {
    cwd: ROOT,
    env: {
      ...process.env,
      TIKPAL_CHROMIUM_BIN: process.execPath,
      TIKPAL_CHROMIUM_PROFILE_DIR: path.join(ROOT, ".tikpal", "kiosk-smoke-profile"),
      TIKPAL_KIOSK_ENV_FILE: overrideEnvFile,
      TIKPAL_KIOSK_SKIP_ENV_SOURCE: "1",
      TIKPAL_KIOSK_WINDOW: "2560x720",
      TIKPAL_KIOSK_XRANDR_MODE: "2560x720"
    },
    encoding: "utf8"
  });
  assert(skipEnvCheck.status === 0, `launcher skip-env --check failed:\n${skipEnvCheck.stdout}\n${skipEnvCheck.stderr}`);
  assert(skipEnvCheck.stdout.includes("window: 2560x720"), "launcher should preserve systemd-provided window when env sourcing is skipped");

  const webModeCheckDir = mkdtempSync(path.join(tmpdir(), "tikpal-web-mode-check-"));
  const fakeXdoToolDir = mkdtempSync(path.join(tmpdir(), "tikpal-web-mode-bin-"));
  writeFileSync(path.join(fakeXdoToolDir, "xdotool"), "#!/usr/bin/env sh\nexit 0\n", { mode: 0o755 });
  const webModeCheck = spawnSync("bash", ["deploy/chromium/tikpal-web-mode.sh", "--check"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PATH: `${fakeXdoToolDir}:${process.env.PATH ?? ""}`,
      TIKPAL_CHROMIUM_BIN: process.execPath,
      TIKPAL_KIOSK_XRANDR_MODE: "none",
      TIKPAL_KIOSK_SKIP_ENV_SOURCE: "1",
      TIKPAL_WEB_MODE_EXTENSION_ENABLED: "1",
      TIKPAL_WEB_MODE_SETTINGS_PATH: path.join(webModeCheckDir, "settings.json"),
      TIKPAL_WEB_MODE_STATE_PATH: path.join(webModeCheckDir, "state.json")
    },
    encoding: "utf8"
  });
  assert(webModeCheck.status === 0, `web mode --check failed:\n${webModeCheck.stdout}\n${webModeCheck.stderr}`);
  assert(webModeCheck.stdout.includes("left: 0,0 1920,720"), "web mode should keep the provider window on the left");
  assert(webModeCheck.stdout.includes("panel: 1920,0 640,720"), "web mode should keep the Tikpal panel on the right");
  assert(webModeCheck.stdout.includes("single provider window: 1"), "web mode should guard against multiple visible provider windows");
  assert(webModeCheck.stdout.includes("popup blocking: 1"), "web mode should enable provider popup blocking by default");
  assert(webModeCheck.stdout.includes("extension: 1"), "web mode should enable the dynamic proxy extension by default");
  assert(webModeCheck.stdout.includes("proxy apply timeout: 5s"), "web mode should report its dynamic proxy confirmation timeout");
  assert(webModeCheck.stdout.includes("provider bootstrap timeout: 7s"), "web mode should report its provider bootstrap timeout");
  assert(webModeCheck.stdout.includes("provider debug: 127.0.0.1:9234"), "web mode should expose only a local provider CDP port");
  assert(webModeCheck.stdout.includes("provider debug stride: per-provider"), "web mode should avoid CDP port clashes during staged provider switches");
  assert(webModeCheck.stdout.includes("provider guard: 1"), "web mode should enable the provider guard by default");
  assert(webModeCheck.stdout.includes("provider hang monitor: 1"), "web mode should suppress provider unresponsive dialogs");
  assert(webModeCheck.stdout.includes("switch lock timeout: 2s"), "web mode should report the bounded provider switch lock timeout");
  assert(webModeCheck.stdout.includes(`xdotool: ${path.join(fakeXdoToolDir, "xdotool")}`), "web mode --check should report the xdotool it will use");
  assert(webModeCheck.stdout.includes("error page: http://127.0.0.1:4173/web-mode-error.html"), "web mode should report the friendly error page URL");
  assert(webModeCheck.stdout.includes("background page: http://127.0.0.1:4173/web-mode-background.html"), "web mode should report the branded Explore background page URL");
  assert(webModeCheck.stdout.includes("transition page: http://127.0.0.1:4173/web-mode-transition.html"), "web mode should report the staged switch transition page");
  assert(webModeCheck.stdout.includes("onboard: 500,420 900,280"), "web mode should place the full Onboard keyboard near provider login inputs");
  assert(webModeCheck.stdout.includes("onboard input focus: 1"), "web mode should enable input-focus keyboard activation");
  assert(webModeCheck.stdout.includes("qq scoped auto confirm: 1"), "web mode should keep QQ auto-confirm scoped inside the provider guard");
  assert(webModeCheck.stdout.includes("proxy: enabled http://127.0.0.1:7897"), "web mode should default to the HTTP development proxy");

  assert(!quickSettingsSource.includes("handleWebModeSettingsSave"), "Explore settings should auto-save without a Save button");
  assert(!quickSettingsSource.includes("handleWebModeProxyTest"), "Explore settings should not need a manual Test button");
  assert(
    quickSettingsSource.includes('t("settings.enterProxyUrl")')
      && i18nSource.includes('"settings.enterProxyUrl": "Enter a complete proxy URL"'),
    "Explore auto-save should wait for a complete proxy URL"
  );

  const providerGuardCheck = spawnSync(process.execPath, ["deploy/chromium/tikpal-web-mode-guard.mjs", "--check"], {
    cwd: ROOT,
    encoding: "utf8"
  });
  assert(providerGuardCheck.status === 0, `provider guard --check failed:\n${providerGuardCheck.stdout}\n${providerGuardCheck.stderr}`);
  assert(providerGuardCheck.stdout.includes("check passed"), "provider guard should report check passed");
  assert(providerGuardCheck.stdout.includes("kiosk interaction blocking: 1"), "provider guard should disable browser-like context gestures");
  assert(providerGuardCheck.stdout.includes("friendly error redirect: 1"), "provider guard should redirect Chromium error pages");
  assert(providerGuardCheck.stdout.includes("provider native failure redirect: 1"), "provider guard should redirect provider-native failure pages");
  assert(providerGuardCheck.stdout.includes("oauth navigation abort ignored: 1"), "provider guard should not redirect normal OAuth navigation aborts");
  assert(providerGuardCheck.stdout.includes("safe consent auto confirm: 1"), "provider guard should auto-confirm safe cookie consent prompts");
  assert(providerGuardCheck.stdout.includes("cookie accept-all auto confirm: 1"), "provider guard should prefer cookie accept-all prompts");
  assert(providerGuardCheck.stdout.includes("all-provider consent polling: 1"), "provider guard should poll consent prompts for every provider page");
  assert(providerGuardCheck.stdout.includes("spotify cookie close dismiss: 1"), "provider guard should close Spotify cookie-policy dismiss prompts");
  assert(providerGuardCheck.stdout.includes("trial upsell safe dismiss: 1"), "provider guard should dismiss visible free-trial upsells safely");
  assert(providerGuardCheck.stdout.includes("dangerous trial action blocked: 1"), "provider guard should not accept trial, subscription, login, or payment actions");
  assert(providerGuardCheck.stdout.includes("accept all cookies"), "provider guard should include English accept-all cookie labels");
  assert(providerGuardCheck.stdout.includes("全部接受"), "provider guard should include Chinese accept-all cookie labels");
  assert(providerGuardCheck.stdout.includes("input focus keyboard: 1"), "provider guard should raise Onboard when provider inputs receive focus");
  assert(providerGuardCheck.stdout.includes("empty page timeout: 18s"), "provider guard should redirect long-running blank provider pages");
  assert(providerGuardCheck.stdout.includes("取消"), "provider guard should include safe QQ cancel prompts");
  assert(providerGuardCheck.stdout.includes("youtube safe dismiss: 1"), "provider guard should dismiss safe YouTube prompts");
  assert(providerGuardCheck.stdout.includes("no, thanks"), "provider guard should include the YouTube no-thanks prompt");
  assert(providerGuardCheck.stdout.includes("关闭"), "provider guard should include safe QQ close prompts");
  assert(providerGuardCheck.stdout.includes("dismiss labels:"), "provider guard should allow safe dismiss prompts without accepting upsells");
  assert(providerGuardCheck.stdout.includes("duplicate player pruning: 1"), "provider guard should prune duplicate QQ player pages");
  assert(providerGuardCheck.stdout.includes("single pane navigation: 1"), "provider guard should keep QQ links in the left pane");
  assert(providerGuardCheck.stdout.includes("qq client prompt close/retry: 1"), "provider guard should close QQ client prompts before one playback retry");
  assert(providerGuardCheck.stdout.includes("qq login prompt preserve: 1"), "provider guard should preserve the QQ login-required prompt");
  assert(providerGuardCheck.stdout.includes("qq mv auto fullscreen: 0"), "provider guard should keep QQ Music MV auto fullscreen off by default");
  assert(providerGuardCheck.stdout.includes("qq mv cinema mode: 1"), "provider guard should enable QQ MV cinema mode by default");
  assert(providerGuardCheck.stdout.includes("qq mv auto play: 1"), "provider guard should enable conditional QQ MV auto play by default");
  assert(providerGuardCheck.stdout.includes("netease auto play: 1"), "provider guard should enable conditional NetEase auto play by default");
  assert(providerGuardCheck.stdout.includes("qq mv native fullscreen path: 0"), "provider guard should report the old QQ MV native fullscreen path as disabled");
  assert(providerGuardCheck.stdout.includes("qq mv playlist button: 1"), "provider guard should expose a manual QQ MV playlist return button");
  assert(providerGuardCheck.stdout.includes("qq mv replay button: 1"), "provider guard should expose the QQ MV replay button path");
  assert(providerGuardCheck.stdout.includes("qq mv cinema frame: 1"), "provider guard should expose the QQ MV cinema frame path");
  assert(providerGuardCheck.stdout.includes("qq mv touch target: 1"), "provider guard should enlarge tiny QQ MV touch targets");
  const providerGuardSource = await readFile(path.join(ROOT, "deploy/chromium/tikpal-web-mode-guard.mjs"), "utf8");
  assert(providerGuardSource.includes("querySelectorAll(\"iframe\")"), "provider guard should scan same-origin QQ modal iframes");
  assert(providerGuardSource.includes("consentAcceptAllLabels"), "provider guard should keep accept-all cookie labels separate from generic consent labels");
  assert(providerGuardSource.includes("rejectActionText"), "provider guard should skip cookie preference, reject, and settings actions");
  assert(providerGuardSource.includes("safeDismissPromptExpression"), "provider guard should keep safe prompt dismiss handling separate from consent acceptance");
  assert(providerGuardSource.includes("spotify") && providerGuardSource.includes("cookieContextText"), "provider guard should close Spotify cookie policy prompts only from cookie context");
  assert(providerGuardSource.includes("trialContextText") && providerGuardSource.includes("dangerousActionText"), "provider guard should require trial context and block dangerous trial actions");
  assert(providerGuardSource.includes('attr(element, "aria-label")'), "provider guard should read aria-label text from cookie buttons");
  assert(providerGuardSource.includes('attr(element, "title")'), "provider guard should read title text from cookie buttons");
  assert(providerGuardSource.includes("[class*='confirm']"), "provider guard should recognize QQ confirm-style modal containers");
  assert(providerGuardSource.includes("unsupported_browser"), "provider guard should classify unsupported-browser provider failures");
  assert(providerGuardSource.includes("region_unavailable"), "provider guard should classify region-blocked provider failures");
  assert(providerGuardSource.includes("Number(diagnostics?.visibleCount || 0) <= 3"), "provider guard should not classify a populated provider loading shell as empty");
  assert(providerGuardSource.includes("diagnostics?.resourceCount || 0"), "provider guard should reset the empty-page timeout while provider resources are still loading");
  assert(providerGuardSource.includes("__tikpalInputFocusGuardInstalled"), "provider guard should hot-install input focus handling on existing provider pages");
  assert(providerGuardSource.includes("input[type='search']"), "provider guard should recognize text-like inputs that need Onboard");
  assert(providerGuardSource.includes("const onboardInputSelector"), "provider focus polling should share one text-input selector");
  assert(providerGuardSource.includes("active.shadowRoot?.activeElement"), "provider focus polling should see focused text inputs inside shadow DOM");
  assert(providerGuardSource.includes('querySelectorAll?.("iframe")'), "provider focus polling should scan same-origin iframe focus");
  assert(providerGuardSource.includes("state.focused && !previous.focused"), "provider navigation should surface Onboard when text focus arrives before listener installation");
  assert(providerGuardSource.includes('const allowProgrammaticInputFocus = providerId !== "suno"'), "provider guard should suppress Suno page-driven autofocus");
  assert(providerGuardSource.includes("allowProgrammaticInputFocus && state.focused && !previous.focused"), "Suno polling should wait for an explicit input interaction before showing Onboard");
  assert(providerGuardSource.includes("keepEditableFocus"), "provider focus guard should keep Spotify-style inputs focused after Onboard opens");
  assert(providerGuardSource.includes("outsidePointerDown"), "provider focus guard should still hide Onboard when tapping outside inputs");
  assert(providerGuardSource.includes("lastOnboardActionMs"), "provider focus guard should throttle repeated keyboard show while inputs stay focused");
  assert(providerGuardSource.includes("const throttleMs = force ? 1000 : 250"), "provider focus guard should throttle repeated forced keyboard show requests");
  assert(providerGuardSource.includes("lastKeyboardEnabled === enabled && now - lastKeyboardRequestMs < throttleMs"), "provider focus guard should not spam duplicate keyboard requests");
  assert(providerGuardSource.includes("lastOnboardVisible === enabled && now - lastOnboardActionMs < throttleMs"), "provider poll fallback should not spam duplicate launcher actions");
  assert(providerGuardSource.includes("TIKPAL_WEB_MODE_QQ_MV_CINEMA_MODE"), "provider guard should expose a QQ MV cinema mode switch");
  assert(providerGuardSource.includes("qqMvTouchTargetExpression"), "provider guard should inject larger QQ MV hit targets without changing QQ layout");
  assert(providerGuardSource.includes("data-tikpal-qq-mv-touch-target"), "QQ MV hit targets should expose a test hook on the original link");
  assert(providerGuardSource.includes("__tikpalQqMvTouchTargetLinkAtPoint"), "QQ MV touch target should use page-local hit testing instead of a cross-window overlay");
  assert(providerGuardSource.includes("hitWidth = 72") && providerGuardSource.includes("hitHeight = 44"), "QQ MV touch target should be large enough for physical touch");
  assert(providerGuardSource.includes("await runQqMvTouchTargetFeatures(targets)"), "provider guard main loop should refresh QQ MV touch targets");
  assert(providerGuardSource.includes("qqMvCinemaExpression"), "provider guard should inject QQ MV cinema CSS/DOM");
  assert(providerGuardSource.includes("runQqMvCinemaFeatures"), "provider guard should run QQ MV cinema behavior");
  assert(providerGuardSource.includes("qqMvAutoPlayStates"), "provider guard should track per-MV auto-play attempts");
  assert(providerGuardSource.includes("claimQqMvAutoPlayAttempt"), "provider guard should gate QQ MV auto play before clicking");
  assert(providerGuardSource.includes("currentTime > qqMvAutoPlayMaxStartSeconds"), "QQ MV auto play should not resume progressed videos");
  assert(providerGuardSource.includes("state.clicked = true"), "QQ MV auto play should claim one attempt per MV key");
  assert(providerGuardSource.includes("qqMvAutoPlayExpression"), "QQ MV auto play should keep the playback action separate from cinema layout");
  assert(providerGuardSource.includes("await entry.video.play()"), "QQ MV auto play should start only the selected cinema video");
  assert(providerGuardSource.includes("QQ MV auto play") && providerGuardSource.includes("playback?.played"), "QQ MV auto play should report whether the one-shot start succeeded");
  assert(providerGuardSource.includes("await runQqMvCinemaFeatures(targets)"), "provider guard main loop should call QQ MV cinema behavior");
  assert(providerGuardSource.includes("neteaseAutoPlayStates"), "provider guard should track per-page NetEase auto-play attempts");
  assert(providerGuardSource.includes("claimNeteaseAutoPlayAttempt"), "provider guard should gate NetEase auto play before clicking");
  assert(providerGuardSource.includes("window.Howler?._howls"), "NetEase auto play should inspect Howler playback state");
  assert(providerGuardSource.includes("clickNeteasePlayButton"), "NetEase auto play should use a real X11 click for the selected play button");
  assert(providerGuardSource.includes("await runNeteaseAudioFeatures(targets)"), "provider guard main loop should call NetEase auto play behavior");
  assert(!providerGuardSource.includes("await runQqMvFullscreenFeatures(targets)"), "provider guard main loop should not call QQ MV native fullscreen behavior");
  assert(!providerGuardSource.includes("await runQqMvContinuationFeatures(targets)"), "provider guard main loop should not auto-continue QQ MV playback");
  assert(providerGuardSource.includes("data-tikpal-qq-mv-cinema"), "provider guard should mark QQ MV cinema mode on the document");
  assert(providerGuardSource.includes("data-tikpal-qq-mv-cinema-video"), "provider guard should mark the selected QQ MV video");
  assert(providerGuardSource.includes("tikpal-qq-mv-cinema-controls"), "provider guard should mount QQ MV icon controls in one container");
  assert(providerGuardSource.includes("tikpal-qq-mv-cinema-playlist-button"), "provider guard should inject the QQ MV playlist button");
  assert(providerGuardSource.includes("tikpal-qq-mv-cinema-replay-button"), "provider guard should inject the QQ MV replay button");
  assert(providerGuardSource.includes("dataset.tikpalQqMvCinemaFrame"), "provider guard should expose the cinema frame test hook");
  assert(providerGuardSource.includes("data-tikpal-qq-mv-letterbox"), "provider guard should expose computed letterbox regions");
  assert(providerGuardSource.includes("dataset.tikpalQqMvPlaylistButton"), "provider guard should expose the playlist button test hook");
  assert(providerGuardSource.includes("dataset.tikpalQqMvReplayButton"), "provider guard should expose the replay button test hook");
  assert(providerGuardSource.includes("object-fit: contain"), "QQ MV cinema video should avoid cropping the movie frame");
  assert(providerGuardSource.includes('setAttribute("aria-label", "播放列表")'), "QQ MV playlist icon should keep an accessible label");
  assert(providerGuardSource.includes('setAttribute("title", "播放列表")'), "QQ MV playlist icon should keep a localized tooltip hook");
  assert(providerGuardSource.includes('setAttribute("aria-label", "重播")'), "QQ MV replay icon should keep an accessible label");
  assert(providerGuardSource.includes('setAttribute("title", "重播")'), "QQ MV replay icon should keep a localized tooltip hook");
  assert(providerGuardSource.includes("playlistButton.innerHTML = playlistIcon"), "QQ MV playlist control should render an SVG icon instead of visible text");
  assert(providerGuardSource.includes("replayButton.innerHTML = replayIcon"), "QQ MV replay control should render an SVG icon instead of visible text");
  assert(providerGuardSource.includes("const syncReplayState = () =>"), "QQ MV replay control should use one state sync function");
  assert(providerGuardSource.includes('["play", "playing", "timeupdate", "seeking", "seeked", "ended", "pause", "loadedmetadata"]'), "QQ MV replay state should refresh on video playback events");
  assert(providerGuardSource.includes("entry.video.__tikpalQqMvReplaySync"), "QQ MV replay state sync should replace stale hot-injected listeners");
  assert(providerGuardSource.includes("const replayVisible = syncReplayState()"), "QQ MV replay diagnostics should use the synced visibility state");
  assert(providerGuardSource.includes("replayButton.hidden = true"), "QQ MV replay should hide immediately after tapping replay");
  assert(providerGuardSource.includes("entry.video.currentTime = 0"), "QQ MV replay control should seek to the beginning");
  assert(providerGuardSource.includes("await entry.video.play()"), "QQ MV replay control should start the current video after seeking");
  assert(!providerGuardSource.includes("rgba(105, 230, 255"), "QQ MV cinema letterbox should not render blue border lines");
  assert(!providerGuardSource.includes("rgba(69, 210, 255"), "QQ MV cinema letterbox should not render cyan glow");
  assert(!providerGuardSource.includes("border-right: 1px solid rgba(105, 230, 255"), "QQ MV cinema letterbox should not draw a right cyan edge");
  assert(!providerGuardSource.includes("border-left: 1px solid rgba(105, 230, 255"), "QQ MV cinema letterbox should not draw a left cyan edge");
  assert(!providerGuardSource.includes("border-top: 1px solid rgba(105, 230, 255"), "QQ MV cinema letterbox should not draw a top cyan edge");
  assert(!providerGuardSource.includes("border-bottom: 1px solid rgba(105, 230, 255"), "QQ MV cinema letterbox should not draw a bottom cyan edge");
  assert(!providerGuardSource.includes('button.textContent = "播放列表"'), "QQ MV cinema controls should not render visible Chinese button text");
  assert(providerGuardSource.includes("history.back()"), "QQ MV playlist button should return through provider page history");
  assert(providerGuardSource.includes('cleanup("playback-error"'), "QQ MV cinema should back out quietly on provider playback errors");
  assert(!providerGuardSource.includes("requestFullscreen"), "QQ MV cinema should not use browser-native fullscreen");
  assert(!providerGuardSource.includes('"F11"') && !providerGuardSource.includes("'F11'"), "QQ MV cinema should not use whole-window F11 fullscreen");
  assert(!providerGuardSource.includes("else if (anyFocused) setOnboardVisible(true)"), "provider focus guard should let Onboard stay closed until a new input interaction");
  assert(providerGuardSource.includes("__tikpalInputFocusSessionActive"), "provider focus guard should expose an active provider input session to the polling fallback");
  assert(providerGuardSource.includes("active || (window.__tikpalInputFocusSessionActive && lastEditable?.isConnected) || !outsidePointerDown"), "provider focus guard should keep Onboard visible when it takes X focus from a login input");
  assert(providerGuardSource.includes("shouldHide ||= state.hideRequest > previous.hideRequest && !state.sessionActive"), "provider polling should hide Onboard only after an explicit provider hide request outside an active input session");
  assert(!providerGuardSource.includes("previous.url !== target.url && !state.focused"), "provider polling should not hide Onboard just because OAuth navigation moved focus");
  assert(!providerGuardSource.includes("wasFocused && !anyFocused"), "provider polling should not hide Onboard just because X focus moved to the keyboard");
  assert(!providerGuardSource.includes("if (!doc?.hasFocus?.()) return false"), "provider focus polling should preserve active login inputs while Onboard has window focus");
  assert(providerGuardSource.includes("mode: \"no-cors\""), "provider focus guard should request local keyboard actions without cross-origin response access");
  assert(providerGuardSource.includes("text/plain;charset=UTF-8"), "provider focus guard should send a CORS-safelisted JSON text body");
  assert(providerGuardSource.includes("keyboardActionUrl"), "provider focus guard should use the loopback keyboard action as its primary path");
  assert(providerGuardSource.includes("__tikpalInputFocusHideRequest"), "provider input blur and submit should request Onboard Hide");
  assert(providerGuardSource.includes('force ? "show-force" : "show"'), "provider focus guard should distinguish new focus from periodic keyboard show actions");
  assert(providerGuardSource.includes("__tikpalQqClientPromptRetried"), "QQ client prompt retries should stop after one playback attempt");
  assert(providerGuardSource.includes('!text.includes("下载客户端体验更多内容")'), "QQ login-required prompt should stay visible for user login");
  assert(providerGuardSource.includes(".yqq-dialog-close"), "QQ client prompt handling should use the explicit close control");
  assert(webModeScript.includes('args+=("--disable-hang-monitor")'), "provider Chromium should not block Explore return on a page-unresponsive dialog");
  assert(webModeScript.includes('pkill -KILL -f -- "--user-data-dir=$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/"'), "Explore close should force-exit an unresponsive provider after the grace period");
  assert(webModeScript.includes('provider_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"'), "Explore should keep a stable per-provider Chromium profile for login state");
  assert(!webModeScript.includes('rm -rf "$provider_profile"'), "Explore provider switches should not delete the provider login profile");
  assert(webModeScript.includes('refresh_extension_script_cache "$provider_profile"') && webModeScript.includes("Default/Service Worker") && webModeScript.includes("service_worker_registration_info"), "Explore provider launch should refresh stale extension service-worker state without deleting login state");
  assert(webModeScript.indexOf('start_provider_guard "$provider" "$provider_profile" "$url" "$proxy_enabled" "$provider_port"') < webModeScript.indexOf('if ! wait_for_provider_ready "$provider_port" "$provider"; then'), "provider guard should start before the ready gate so cookie prompts can be accepted during entry");

  assert(webModeErrorPage.includes("did not respond"), "friendly Explore error page should avoid native Chromium error copy");
  assert(webModeErrorPage.includes("Change Proxy in Settings") && !webModeErrorPage.includes("Proxy switch") && !webModeErrorPage.includes("右侧切换代理"), "friendly Explore error page should point users to Settings instead of a side-panel proxy switch");
  assert(!webModeErrorPage.includes("sendKioskHeartbeat"), "friendly Explore error page should not post kiosk heartbeats");
  assert(webModeBackgroundPage.includes("/assets/tikpal-scene-logo.png") && webModeBackgroundPage.includes("Tikpal Explore Background"), "Explore background page should show a branded logo surface");
  assert(!webModeBackgroundPage.includes("sendKioskHeartbeat"), "Explore background page should not post kiosk heartbeats");
  assert(webModeScript.includes("background_windows") && webModeScript.includes('TIKPAL_WEB_MODE_STAGE_POSITION') && webModeScript.includes("windowlower"), "Explore window guard should park the branded background offscreen while an active provider is visible");
  const webModeTransitionPage = await readFile(path.join(ROOT, "public/web-mode-transition.html"), "utf8");
  assert(webModeTransitionPage.includes("Connecting"), "Explore transition page should show a concise connecting state");
  for (const providerId of ["suno", "spotify", "youtube_music", "apple_music", "tidal", "qobuz", "deezer", "amazon_music", "qq_music", "netease_music"]) {
    assert(webModeTransitionPage.includes(`${providerId}:`), `Explore transition page should map ${providerId}`);
  }
  assert(webModeTransitionPage.includes("tikpalSignalExpand"), "Explore transition page should use the center-out signal animation");
  assert(!webModeTransitionPage.includes("radial-gradient"), "Explore transition page should not use the old radial glow");
  assert(!webModeTransitionPage.includes("tikpalExplorePulse"), "Explore transition page should not use the old circular pulse");
  assert(!webModeTransitionPage.includes("sendKioskHeartbeat"), "Explore transition page should not post kiosk heartbeats");
  assert(sidePanelSource.includes('new URLSearchParams(window.location.search).get("opening")'), "Explore side panel should read its initial pending provider");
  assert(sidePanelSource.includes("providerStatusLabel"), "Explore side panel should centralize provider status labels");
  assert(sidePanelSource.includes('residentStatus === "prewarming"') && sidePanelSource.includes('residentStatus === "check_setup"') && sidePanelSource.includes('residentStatus === "check_proxy"'), "Explore side panel should show resident provider warm/check states");
  assert(webModeScript.includes('"prewarming"') && webModeScript.includes('"check_proxy"') && serverSource.includes('"prewarming", "ready", "active", "check_setup", "check_proxy"'), "Explore provider pool should expose distinct prewarming and check_proxy states end to end");
  assert(webModeScript.includes("TIKPAL_WEB_MODE_PROVIDER_POOL:=1"), "Explore provider pool should be enabled by default");
  assert(webModeScript.includes("TIKPAL_WEB_MODE_PROVIDER_PREWARM_DELAY_SECONDS:=0.75"), "Explore provider pool should use a short stagger for responsive prewarm");
  assert(webModeScript.includes("TIKPAL_WEB_MODE_PROVIDER_PREWARM_LOCK_TIMEOUT_SECONDS:=2"), "Explore provider prewarm should use a short launch-lock timeout");
  assert(webModeScript.includes("prewarm_provider_pool"), "Explore should prewarm resident providers after entry");
  assert(webModeScript.includes("seed_runtime_provider_pool_statuses") && webModeScript.includes('status: "prewarming"'), "Explore should seed queued resident providers as prewarming before their windows launch");
  assert(webModeScript.includes('const force = seedMode === "force"') && webModeScript.includes('start_provider_pool_prewarm "$provider" force'), "Explore proxy toggles should force resident providers back through prewarm");
  assert(webModeScript.includes("navigate_provider_target") && webModeScript.includes('TIKPAL_WEB_MODE_PROVIDER_PREWARM_FORCE=1') && webModeScript.includes('launch_provider_for_pool "$provider" 0 prewarm "$force_existing"'), "Forced provider prewarm should re-navigate existing resident pages after proxy changes");
  assert(webModeScript.includes("provider_direct_reachable") && webModeScript.includes("--noproxy '*'") && webModeScript.includes('"check_proxy"') && webModeScript.includes("needs Proxy On"), "Explore should probe direct provider reachability before marking Check proxy");
  assert(webModeScript.includes("provider_prefers_direct_proxy") && webModeScript.includes("effective_provider_proxy_enabled"), "Explore launcher should support direct-preferred providers such as QQ Music and NetEase");
  assert(webModeScript.includes("deezer|qq_music|netease_music"), "Explore should direct-launch QQ Music and NetEase instead of waiting on the transition bootstrap");
  assert(webModeScript.includes("wait_for_entry=1") && webModeScript.includes("wait_for_full_ready=1") && webModeScript.includes('launch_provider_for_pool "$provider" entry'), "Explore active opens should wait for provider entry without blocking on the full ready probe");
  assert(webModeScript.includes("setsid") && webModeScript.includes("TIKPAL_WEB_MODE_PROVIDER_PREWARM_FORCE=1"), "Explore provider prewarm should detach from the active open command");
  assert(webModeScript.includes('launch_provider_for_pool "$provider" 0 prewarm'), "Explore background prewarm should not block on slow provider readiness");
  assert(webModeScript.includes('pkill -TERM -f "$SCRIPT_DIR/tikpal-web-mode.sh prewarm"'), "Explore should stop stale prewarm queues before starting a new one");
  assert(providerGuardSource.includes("__tikpalProviderAudioGate"), "Explore provider guard should install resident provider audio gating");
  assert(providerGuardSource.includes("tikpal-provider-audio-muted") && extensionBackground.includes("provider-audio-muted"), "Explore provider gate should ask the extension to tab-mute inactive providers");
  assert(providerGuardSource.includes("version: 2"), "Explore provider audio gate should use the resumable v2 contract");
  assert(providerGuardSource.includes("previous.wasPlaying = previous.wasPlaying ||"), "Inactive provider audio polling should not forget playback that must resume");
  assert(providerGuardSource.includes("element.muted = false"), "Returning to a resident provider should unmute media elements");
  assert(providerGuardSource.includes("syncResidentProviderStatus") && providerGuardSource.includes("providerReadyHosts"), "Resident provider guards should clear stale check_setup once the provider reaches its real host");
  assert(stylesSource.includes("webModeProviderSignalTrace"), "Explore provider cards should use the short signal trace");
  assert(!stylesSource.includes("webModeProviderOpeningSpin"), "Explore provider cards should remove the full rotating border");

  const watchdogCheck = spawnSync("bash", ["deploy/chromium/tikpal-kiosk-healthcheck.sh", "--check"], {
    cwd: ROOT,
    env: {
      ...process.env,
      TIKPAL_KIOSK_WATCHDOG_STATE_DIR: mkdtempSync(path.join(tmpdir(), "tikpal-kiosk-watchdog-smoke-"))
    },
    encoding: "utf8"
  });
  assert(watchdogCheck.status === 0, `watchdog --check failed:\n${watchdogCheck.stdout}\n${watchdogCheck.stderr}`);
  assert(watchdogCheck.stdout.includes("watchdog enabled: 1"), "watchdog --check should report that it is enabled");
  assert(watchdogCheck.stdout.includes("page heartbeat enabled: 1"), "watchdog --check should report page heartbeat scanning");
  assert(watchdogCheck.stdout.includes("/api/v1/kiosk/heartbeat"), "watchdog --check should report the heartbeat endpoint");
  assert(watchdogCheck.stdout.includes("web mode profile root:"), "watchdog --check should report the Explore profile root used for heartbeat bypass");
  assert(watchdogCheck.stdout.includes("physical display check: 0"), "watchdog --check should report periodic physical display probing disabled by default");
  assert(watchdogCheck.stdout.includes("physical display prepare:"), "watchdog --check should report the physical display helper");
  assert(watchdogCheck.stdout.includes("check passed"), "watchdog --check should report success");
  assert(
    watchdogSource.includes("physical-display-unhealthy")
      && watchdogSource.includes("try_physical_display_soft_recover")
      && watchdogSource.includes("try_physical_display_gpu_rebind_recover")
      && watchdogSource.includes("soft-kick")
      && watchdogSource.includes("nouveau-rebind")
      && watchdogSource.includes("physical display recovered without restarting"),
    "watchdog should try physical-display soft-kick and optional GPU rebind before restarting the kiosk"
  );

  const heartbeatSmokeDir = mkdtempSync(path.join(tmpdir(), "tikpal-heartbeat-smoke-"));
  const heartbeatSmokePortFile = path.join(heartbeatSmokeDir, "port");
  const heartbeatSmokeServer = spawn(process.execPath, [
    "-e",
    `
      const fs = require("node:fs");
      const http = require("node:http");
      const server = http.createServer((_request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          ok: true,
          healthy: false,
          status: "unhealthy",
          reasons: ["pending-stuck:source:mpd"]
        }));
      });
      server.listen(0, "127.0.0.1", () => {
        fs.writeFileSync(process.argv[1], String(server.address().port));
      });
      process.on("SIGTERM", () => server.close(() => process.exit(0)));
    `,
    heartbeatSmokePortFile
  ], {
    stdio: "ignore"
  });
  try {
    let heartbeatSmokePort = "";
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        heartbeatSmokePort = (await readFile(heartbeatSmokePortFile, "utf8")).trim();
      } catch {
        // The child writes the port after listen().
      }
      if (heartbeatSmokePort) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert(/^[0-9]+$/.test(heartbeatSmokePort), "heartbeat smoke server should expose a port");
    const watchdogDryRun = spawnSync("bash", ["deploy/chromium/tikpal-kiosk-healthcheck.sh"], {
      cwd: ROOT,
      env: {
        ...process.env,
        TIKPAL_KIOSK_WATCHDOG_STATE_DIR: mkdtempSync(path.join(tmpdir(), "tikpal-kiosk-watchdog-dry-run-")),
        TIKPAL_KIOSK_WATCHDOG_DRY_RUN: "1",
        TIKPAL_KIOSK_WATCHDOG_X_DISPLAY_SCAN: "0",
        TIKPAL_KIOSK_WATCHDOG_CHROMIUM_PROCESS_SCAN: "0",
        TIKPAL_KIOSK_WATCHDOG_WEB_URL_SCAN: "0",
        TIKPAL_KIOSK_WATCHDOG_API_URL_SCAN: "0",
        TIKPAL_KIOSK_WATCHDOG_GPU_LOG_SCAN: "0",
        TIKPAL_KIOSK_WATCHDOG_PAGE_HEARTBEAT_URL: `http://127.0.0.1:${heartbeatSmokePort}/heartbeat`
      },
      encoding: "utf8"
    });
    assert(watchdogDryRun.status === 0, `watchdog dry-run unhealthy page smoke failed:\n${watchdogDryRun.stdout}\n${watchdogDryRun.stderr}`);
    assert(watchdogDryRun.stdout.includes("page-unhealthy:pending-stuck:source:mpd"), "watchdog dry-run should include the page-unhealthy reason");
    assert(watchdogDryRun.stdout.includes("dry-run restart suppressed"), "watchdog dry-run should suppress the real service restart");

    const webModeProfileRoot = mkdtempSync(path.join(tmpdir(), "tikpal-web-mode-profile-"));
    const fakeProvider = spawn(process.execPath, [
      "-e",
      "setTimeout(() => {}, 60000)",
      "--",
      `--user-data-dir=${path.join(webModeProfileRoot, "providers", "qq_music")}`
    ], {
      stdio: "ignore"
    });
    try {
      const watchdogWebModeBypass = spawnSync("bash", ["deploy/chromium/tikpal-kiosk-healthcheck.sh"], {
        cwd: ROOT,
        env: {
          ...process.env,
          TIKPAL_KIOSK_WATCHDOG_STATE_DIR: mkdtempSync(path.join(tmpdir(), "tikpal-kiosk-watchdog-web-mode-")),
          TIKPAL_KIOSK_WATCHDOG_DRY_RUN: "1",
          TIKPAL_KIOSK_WATCHDOG_X_DISPLAY_SCAN: "0",
          TIKPAL_KIOSK_WATCHDOG_CHROMIUM_PROCESS_SCAN: "0",
          TIKPAL_KIOSK_WATCHDOG_WEB_URL_SCAN: "0",
          TIKPAL_KIOSK_WATCHDOG_API_URL_SCAN: "0",
          TIKPAL_KIOSK_WATCHDOG_GPU_LOG_SCAN: "0",
          TIKPAL_KIOSK_WATCHDOG_PAGE_HEARTBEAT_URL: `http://127.0.0.1:${heartbeatSmokePort}/heartbeat`,
          TIKPAL_WEB_MODE_PROFILE_ROOT: webModeProfileRoot
        },
        encoding: "utf8"
      });
      assert(watchdogWebModeBypass.status === 0, `watchdog should bypass stale heartbeat while Explore provider is active:\n${watchdogWebModeBypass.stdout}\n${watchdogWebModeBypass.stderr}`);
      assert(!watchdogWebModeBypass.stdout.includes("page-unhealthy"), "watchdog should not report page-unhealthy while Explore provider is active");
      assert(!watchdogWebModeBypass.stdout.includes("dry-run restart suppressed"), "watchdog should not restart while Explore provider is active");
    } finally {
      fakeProvider.kill("SIGTERM");
      await new Promise((resolve) => fakeProvider.once("exit", resolve));
    }
  } finally {
    heartbeatSmokeServer.kill("SIGTERM");
    await new Promise((resolve) => heartbeatSmokeServer.once("exit", resolve));
  }

  const devtoolsCheck = spawnSync("bash", ["deploy/chromium/start-tikpal-kiosk-devtools-proxy.sh", "--check"], {
    cwd: ROOT,
    env: {
      ...process.env,
      TIKPAL_KIOSK_REMOTE_DEBUG: "1",
      TIKPAL_KIOSK_REMOTE_DEBUG_ADDRESS: "0.0.0.0",
      TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_PORT: "9223"
    },
    encoding: "utf8"
  });
  assert(devtoolsCheck.status === 0, `DevTools proxy --check failed:\n${devtoolsCheck.stdout}\n${devtoolsCheck.stderr}`);
  assert(devtoolsCheck.stdout.includes("public endpoint: 0.0.0.0:9222"), "DevTools proxy should report public endpoint");
  assert(devtoolsCheck.stdout.includes("chromium endpoint: 127.0.0.1:9223"), "DevTools proxy should report Chromium endpoint");

  const displayCheck = spawnSync("bash", ["deploy/chromium/start-tikpal-kiosk-display.sh", "--check"], {
    cwd: ROOT,
    env: {
      ...process.env,
      TIKPAL_KIOSK_DISPLAY_MODE: "virtual",
      TIKPAL_KIOSK_WINDOW: "2560x720"
    },
    encoding: "utf8"
  });
  assert(displayCheck.status === 0, `display wrapper --check failed:\n${displayCheck.stdout}\n${displayCheck.stderr}`);
  assert(displayCheck.stdout.includes("active display mode: virtual"), "display wrapper should expose virtual mode");
  assert(displayCheck.stdout.includes("virtual geometry: 2560x720x24"), "display wrapper should derive Xvfb geometry");

  const viewerCheck = spawnSync("bash", ["deploy/chromium/start-tikpal-kiosk-viewer.sh", "--check"], {
    cwd: ROOT,
    env: {
      ...process.env,
      TIKPAL_KIOSK_VIEWER: "novnc"
    },
    encoding: "utf8"
  });
  assert(viewerCheck.status === 0, `viewer wrapper --check failed:\n${viewerCheck.stdout}\n${viewerCheck.stderr}`);
  assert(viewerCheck.stdout.includes("viewer: novnc"), "viewer wrapper should report noVNC mode");
  assert(viewerCheck.stdout.includes("novnc: 0.0.0.0:6080"), "viewer wrapper should report noVNC endpoint");

  const viewerCtlCheck = spawnSync("bash", ["deploy/chromium/tikpal-kiosk-viewerctl.sh", "--check"], {
    cwd: ROOT,
    env: {
      ...process.env,
      TIKPAL_KIOSK_VIEWER_ENV_FILE: path.join(tmpdir(), "tikpal-kiosk-viewer-smoke.env")
    },
    encoding: "utf8"
  });
  assert(viewerCtlCheck.status === 0, `viewerctl --check failed:\n${viewerCtlCheck.stdout}\n${viewerCtlCheck.stderr}`);
  assert(viewerCtlCheck.stdout.includes("novnc endpoint: 0.0.0.0:6080"), "viewerctl should report the default noVNC endpoint");
  assert(viewerCtlCheck.stdout.includes("check passed"), "viewerctl --check should report success");

  const quietBootDir = mkdtempSync(path.join(tmpdir(), "tikpal-quiet-boot-"));
  const quietBootCmdline = path.join(quietBootDir, "cmdline.txt");
  writeFileSync(
    quietBootCmdline,
    "console=serial0,115200 console=tty1 root=PARTUUID=abc rootfstype=ext4 fsck.repair=yes rootwait\n"
  );
  const quietBootCheck = spawnSync("bash", [
    "deploy/moode/tikpal-quiet-boot-enable.sh",
    "--dry-run",
    "--cmdline",
    quietBootCmdline
  ], {
    cwd: ROOT,
    encoding: "utf8"
  });

  assert(quietBootCheck.status === 0, `quiet boot dry-run failed:\n${quietBootCheck.stdout}\n${quietBootCheck.stderr}`);
  const nextCmdline = quietBootCheck.stdout.match(/next cmdline: (.+)/)?.[1] ?? "";
  assert(!/\bconsole=tty[0-9]*\b/.test(nextCmdline), "quiet boot should remove visible tty consoles from the kernel cmdline");
  assert(nextCmdline.includes("systemd.show_status=false"), "quiet boot should hide systemd status lines");
  assert(nextCmdline.includes("vt.global_cursor_default=0"), "quiet boot should hide the text cursor");
  assert(quietBootCheck.stdout.includes("planned: mask getty@tty1.service"), "quiet boot should mask tty1 getty");
  assert(quietBootCheck.stdout.includes("planned: mask getty@tty2.service"), "quiet boot should mask tty2 getty");
  assert(quietBootCheck.stdout.includes("planned: mask getty@tty3.service"), "quiet boot should mask tty3 getty");

  const quietBootGrub = path.join(quietBootDir, "grub");
  writeFileSync(
    quietBootGrub,
    'GRUB_CMDLINE_LINUX_DEFAULT="console=tty1 rootfstype=ext4 systemd.show_status=true"\n'
  );
  const quietBootGrubCheck = spawnSync("bash", [
    "deploy/moode/tikpal-quiet-boot-enable.sh",
    "--dry-run",
    "--grub-default",
    quietBootGrub
  ], {
    cwd: ROOT,
    encoding: "utf8"
  });

  assert(quietBootGrubCheck.status === 0, `quiet boot grub dry-run failed:\n${quietBootGrubCheck.stdout}\n${quietBootGrubCheck.stderr}`);
  const nextGrubCmdline = quietBootGrubCheck.stdout.match(/next cmdline: (.+)/)?.[1] ?? "";
  assert(quietBootGrubCheck.stdout.includes("boot config type: grub"), "quiet boot should support Gentoo /etc/default/grub");
  assert(quietBootGrubCheck.stdout.includes("planned: set GRUB_TIMEOUT_STYLE=hidden and GRUB_TIMEOUT=0"), "quiet boot should hide the GRUB text menu on Gentoo");
  assert(!/\bconsole=tty[0-9]*\b/.test(nextGrubCmdline), "Gentoo quiet boot should remove visible tty consoles from GRUB defaults");
  assert(nextGrubCmdline.includes("rd.systemd.show_status=false"), "Gentoo quiet boot should hide dracut/systemd status lines");
  assert(quietBootScript.includes("GRUB_TIMEOUT_STYLE=hidden") && quietBootScript.includes("GRUB_TIMEOUT=0"), "quiet boot should persist hidden GRUB menu defaults");
  assert(!quietBootScript.includes("-v next="), "quiet boot should not use awk's builtin next as a variable name");

  console.log("kiosk package smoke passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

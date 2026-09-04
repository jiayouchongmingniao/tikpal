import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  "deploy/chromium/tikpal-explore-physical-acceptance.sh",
  "deploy/chromium/tikpal-explore-switch-acceptance.sh",
  "deploy/chromium/tikpal-x11-helper.c",
  "deploy/chromium/tikpal-web-mode.sh",
  "deploy/chromium/tikpal-web-mode-guard.mjs",
  "deploy/chromium/tikpal-web-mode-cdp-manager.mjs",
  "deploy/chromium/tikpal-web-mode-cdp-client.py",
  "deploy/systemd/tikpal-web-mode-cdp-manager.service",
  "scripts/tikpal-cdp-session-manager-smoke.mjs",
  "deploy/chromium/tikpal-web-mode-qq-confirm.mjs",
  "scripts/tikpal-initial-entry-fixture.sh",
  "deploy/chromium/web-mode-extension/manifest.json",
  "deploy/chromium/web-mode-extension/background.js",
  "deploy/chromium/web-mode-extension/content.js",
  "deploy/chromium/web-mode-extension/provider-audio-gate.js",
  "deploy/chromium/web-mode-extension/netease-audio-mirror.js",
  "deploy/chromium/chromium-flags.conf",
  "deploy/chromium/managed-policies.json",
  "deploy/chromium/env.kiosk.example",
  "deploy/turzx/install-turzx-evdi-display.sh",
  "deploy/turzx/README.md",
  "deploy/udev/70-tikpal-usb-audio-display-power.rules",
  "src/i18n.tsx",
  "src/exploreOpenVeil.ts",
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
  "deploy/moode/tikpal-upnp-capture-install.sh",
  "deploy/moode/tikpal-upnp-capture.sh",
  "deploy/moode/tikpal-moodeutl.sh",
  "public/web-mode-error.html",
  "public/web-mode-background.html",
  "public/web-mode-close-overlay.html",
  "src/components/OnboardingGuide.tsx",
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
  "deploy/systemd/tikpal-kiosk-x11-helper.conf",
  "deploy/systemd/tikpal-x11-helper.service",
  "deploy/systemd/install-systemd-services.sh",
  "public/web-mode-transition.html"
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
  await assertExecutable("deploy/chromium/tikpal-explore-physical-acceptance.sh");
  await assertExecutable("deploy/chromium/tikpal-explore-switch-acceptance.sh");
  await assertExecutable("deploy/chromium/tikpal-web-mode.sh");
  await assertExecutable("scripts/tikpal-initial-entry-fixture.sh");
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
  await assertExecutable("deploy/moode/tikpal-upnp-capture-install.sh");
  await assertExecutable("deploy/moode/tikpal-upnp-capture.sh");
  await assertExecutable("deploy/moode/tikpal-moodeutl.sh");
  await assertExecutable("deploy/moode/tikpal-alsa-loopback.sh");
  await assertExecutable("deploy/moode/tikpal-airplay-transport.sh");
  await assertExecutable("deploy/moode/tikpal-output-volume.sh");
  await assertExecutable("deploy/moode/tikpal-snd-aloop-enable.sh");
  await assertExecutable("deploy/moode/tikpal-quiet-boot-enable.sh");
  await assertExecutable("deploy/moode/tikpal-locale-enable.sh");
  await assertExecutable("deploy/systemd/install-systemd-services.sh");

  const moodeutlHelperSource = await readFile(path.join(ROOT, "deploy/moode/tikpal-moodeutl.sh"), "utf8");
  assert(
    /if command -v moodeutl >\/dev\/null 2>&1; then\s*moodeutl "\$@"/s.test(moodeutlHelperSource),
    "shared moodeutl helper should call moodeutl only when it is installed"
  );
  const moodeutlSyntax = spawnSync("sh", ["-n", path.join(ROOT, "deploy/moode/tikpal-moodeutl.sh")], { encoding: "utf8" });
  assert(moodeutlSyntax.status === 0, `shared moodeutl helper should pass sh syntax validation: ${moodeutlSyntax.stderr}`);
  const moodeutlInvocation = `. "${path.join(ROOT, "deploy/moode/tikpal-moodeutl.sh")}"; tikpal_moodeutl -Ro --airplay on`;
  const absentMoodeutl = spawnSync("/bin/sh", ["-c", moodeutlInvocation], { env: { PATH: "" }, encoding: "utf8" });
  assert(absentMoodeutl.status === 0, "shared moodeutl helper should be a successful no-op when moodeutl is absent");
  const moodeutlTestDir = mkdtempSync(path.join(tmpdir(), "tikpal-moodeutl-"));
  writeFileSync(path.join(moodeutlTestDir, "moodeutl"), "#!/bin/sh\nexit 23\n", { mode: 0o755 });
  const failingMoodeutl = spawnSync("/bin/sh", ["-c", moodeutlInvocation], { env: { PATH: moodeutlTestDir }, encoding: "utf8" });
  assert(failingMoodeutl.status === 23, "shared moodeutl helper should preserve a present moodeutl failure");
  const externalSourceHelpers = [
    "deploy/moode/tikpal-spotify-enable.sh",
    "deploy/moode/tikpal-spotify-disable.sh",
    "deploy/moode/tikpal-bluetooth-enable.sh",
    "deploy/moode/tikpal-bluetooth-disable.sh",
    "deploy/moode/tikpal-airplay-enable.sh",
    "deploy/moode/tikpal-airplay-disable.sh",
    "deploy/moode/tikpal-upnp-enable.sh",
    "deploy/moode/tikpal-upnp-disable.sh"
  ];
  for (const helper of externalSourceHelpers) {
    const source = await readFile(path.join(ROOT, helper), "utf8");
    const shell = helper.endsWith("airplay-enable.sh") || helper.endsWith("bluetooth-enable.sh") ? "sh" : "bash";
    const syntax = spawnSync(shell, ["-n", path.join(ROOT, helper)], { encoding: "utf8" });
    assert(syntax.status === 0, `${helper} should pass ${shell} syntax validation: ${syntax.stderr}`);
    assert(source.includes('tikpal-moodeutl.sh'), `${helper} should use the shared moodeutl helper`);
    assert(!/\bmoodeutl\s+-Ro\b/.test(source), `${helper} should not call moodeutl directly`);
  }
  const envExampleSource = await readFile(path.join(ROOT, ".env.example"), "utf8");
  assert(
    !/^TIKPAL_(SPOTIFY|BLUETOOTH|AIRPLAY|UPNP)_(ACTIVATE|ENABLE|DISABLE)_COMMAND=.*\bmoodeutl\b/m.test(envExampleSource),
    "default source commands should not invoke moodeutl directly"
  );
  for (const audioSrcSetting of [
    "TIKPAL_AUDIO_PREFER_SINGLE_USB=1",
    "TIKPAL_ALSA_RATE_CONVERTER=",
    "TIKPAL_MPD_RESAMPLER_PLUGIN=soxr",
    "TIKPAL_MPD_RESAMPLER_QUALITY=high",
    "TIKPAL_MPD_RESAMPLER_THREADS=0",
    "TIKPAL_MPD_PURE_PATH=unknown",
    "TIKPAL_MPD_PURE_TARGET_RATE=48000"
  ]) {
    assert(envExampleSource.includes(audioSrcSetting), `.env.example should include ${audioSrcSetting}`);
  }
  const gentooDeployDocSource = await readFile(path.join(ROOT, "docs/06-deployment/gentoo-kiosk-deploy-v1.md"), "utf8");
  assert(gentooDeployDocSource.includes("Gentoo 207 Hardware-free Audio and TURZX Staging") && gentooDeployDocSource.includes("src-apply") && gentooDeployDocSource.includes("=x11-drivers/evdi-1.14.16"), "Gentoo deployment docs should preserve the 207 hardware-free staging gate");
  assert(gentooDeployDocSource.includes("three cold boots") && gentooDeployDocSource.includes("S16_LE") && gentooDeployDocSource.includes("44.1/48/88.2/96 kHz"), "Gentoo deployment docs should preserve display/audio/final-DAC hardware acceptance gates");
  const gentooDeploySource = await readFile(path.join(ROOT, "deploy/deploy-gentoo.sh"), "utf8");
  assert(
    gentooDeploySource.includes("for env_file in .env .env.kiosk")
      && gentooDeploySource.includes("TIKPAL_(SPOTIFY|BLUETOOTH|AIRPLAY|UPNP)_(ACTIVATE|ENABLE|DISABLE)_COMMAND")
      && gentooDeploySource.includes("Gentoo deployment blocked"),
    "Gentoo deployment should block bare moodeutl source commands in both environment files"
  );
  assert(
    gentooDeploySource.includes("--local-preflight")
      && gentooDeploySource.includes("remoteActions=0")
      && gentooDeploySource.includes("broadDeployReady=0")
      && gentooDeploySource.includes("audioStagingManifest<<EOF")
      && gentooDeploySource.includes("--allow-dirty")
      && gentooDeploySource.indexOf("check_worktree_policy") < gentooDeploySource.indexOf("SSH_OPTS=("),
    "Gentoo deployment should offer a repository-only preflight and block dirty broad deploys before network setup"
  );
  assert(
    gentooDeployDocSource.includes("Local Deployment Preflight")
      && gentooDeployDocSource.includes("never calls SSH or rsync")
      && gentooDeployDocSource.includes("Do not use the broad deploy command for the 207 hardware-free gate"),
    "Gentoo deployment docs should separate local preflight from the scoped 207 staging path"
  );
  assert(
    gentooDeploySource.indexOf("--include='/.env.example'") < gentooDeploySource.indexOf("--exclude='.env.*'"),
    "Gentoo rsync should ship the tracked environment contract before excluding device-owned environment variants"
  );

  const onboardingGuideSource = await readFile(path.join(ROOT, "src/components/OnboardingGuide.tsx"), "utf8");
  for (const visibleHardcodedText of [
    'aria-label="Practice this gesture"',
    "Warm room · Ambient",
    ">Brightness<",
    ">Volume<",
    ">Player<",
    ">Try it here<",
    "wizard-preview-controls",
    "onBackgroundHiddenChange",
    "onSoundMutedChange"
  ]) {
    assert(!onboardingGuideSource.includes(visibleHardcodedText), `Onboarding guide should not expose ${visibleHardcodedText}`);
  }
  for (const onboardingKey of [
    "onboarding.previous",
    "onboarding.sampleAria",
    "onboarding.sampleTrack",
    "onboarding.sampleBrightness",
    "onboarding.sampleVolume",
    "onboarding.samplePlayer",
    "onboarding.sampleTry",
    "onboarding.scopeNote"
  ]) {
    assert(onboardingGuideSource.includes(`t("${onboardingKey}")`), `Onboarding guide should use ${onboardingKey}`);
  }
  const onboardingI18nSource = await readFile(path.join(ROOT, "src/i18n.tsx"), "utf8");
  for (const onboardingKey of [
    "onboarding.previous",
    "onboarding.sampleAria",
    "onboarding.sampleTrack",
    "onboarding.sampleBrightness",
    "onboarding.sampleVolume",
    "onboarding.samplePlayer",
    "onboarding.sampleTry",
    "onboarding.scopeNote"
  ]) {
    const localeCount = onboardingI18nSource.match(new RegExp(`"${onboardingKey.replace(".", "\\.")}"`, "g"))?.length ?? 0;
    assert(localeCount >= 7, `${onboardingKey} should be translated for all supported locales`);
  }

  const audioProfileHelperSource = await readFile(path.join(ROOT, "deploy/moode/tikpal-audio-output-profile.sh"), "utf8");
  const usbPowerRulesSource = await readFile(path.join(ROOT, "deploy/udev/70-tikpal-usb-audio-display-power.rules"), "utf8");
  assert(usbPowerRulesSource.includes('ATTR{idVendor}=="1a86"') && usbPowerRulesSource.includes('ATTR{idProduct}=="ad11"'), "USB power rules should target only the TURZX display id");
  assert(usbPowerRulesSource.includes('ATTR{idVendor}=="8087"') && usbPowerRulesSource.includes('ATTR{idProduct}=="1024"'), "USB power rules should target only the BT66 id");
  assert(usbPowerRulesSource.includes('ATTR{power/control}="on"') && usbPowerRulesSource.includes('ATTR{power/autosuspend_delay_ms}="-1"') && !usbPowerRulesSource.includes("usbcore.autosuspend="), "USB power rules should disable autosuspend per device without changing the global kernel policy");
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
  assert(audioProfileHelperSource.includes('"$audio_adapt_bin" resolve-hw') && !audioProfileHelperSource.includes("hw:0,0"), "Pure should use the shared hardware resolver and never fall back to hw:0,0");
  assert(audioProfileHelperSource.includes("Tikpal managed MPD resampler") && audioProfileHelperSource.includes("src-apply") && audioProfileHelperSource.includes("src-check"), "Audio Output helper should manage and verify an independent MPD resampler block");
  const bitperfectWrapperSource = await readFile(path.join(ROOT, "deploy/moode/tikpal-mpd-bitperfect-profile.sh"), "utf8");
  assert(bitperfectWrapperSource.includes("exec \"$profile_helper\" pure"), "Legacy strict mode should map to Pure profile");
  assert(bitperfectWrapperSource.includes("exec \"$profile_helper\" everyday"), "Legacy standard mode should map to Everyday profile");
  const quickSettingsAudioSource = await readFile(path.join(ROOT, "src/components/QuickSettingsOverlay.tsx"), "utf8");
  assert(quickSettingsAudioSource.includes("data-audio-output-profile={choice.id}"), "Settings Audio Output should expose profile test hooks");
  assert(quickSettingsAudioSource.includes("audioOutputCapabilities") && quickSettingsAudioSource.includes("pureTraitsResampled") && quickSettingsAudioSource.includes("pureTraitsNative") && quickSettingsAudioSource.includes("pureTraitsUnknown"), "Pure profile copy should follow the read-only output capability");
  for (const capabilityCopyKey of ["settings.audioProfile.pureTraitsResampled", "settings.audioProfile.pureTraitsNative", "settings.audioProfile.pureTraitsUnknown"]) {
    const localeCount = onboardingI18nSource.match(new RegExp(`"${capabilityCopyKey.replaceAll(".", "\\.")}"`, "g"))?.length ?? 0;
    assert(localeCount === 7, `${capabilityCopyKey} should be translated for all seven locales`);
  }
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
  writeFileSync(path.join(audioAdaptBinDir, "id"), `#!/bin/sh
if [ "$1" = "-u" ]; then echo 0; exit 0; fi
exec /usr/bin/id "$@"
`, { mode: 0o755 });
  writeFileSync(path.join(audioAdaptBinDir, "install"), `#!/bin/sh
set -- "$@"
filtered=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o|-g) shift 2 ;;
    *) filtered="$filtered $(printf '%s' "$1" | sed "s/'/'\\\\''/g" | sed "s/^/'/;s/$/'/")"; shift ;;
  esac
done
eval "exec /usr/bin/install $filtered"
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
  const pchCard = "card 3: PCH [HDA Intel PCH], device 0: ALC897 Analog [ALC897 Analog]";
  const analogCard = "card 7: Analog [Built-in Analog], device 0: Line Out [Line Out]";
  const sharedNameCardA = "card 8: SharedA [Studio DAC (USB)], device 0: USB Audio [USB Audio]";
  const sharedNameCardB = "card 9: SharedB [Studio DAC (USB)], device 0: USB Audio [USB Audio]";
  const loopbackCard = "card 6: Loopback [Loopback], device 0: Loopback PCM [Loopback PCM]";
  const bt66Resolve = runAudioAdapt(`${hdmiCard}\n${crimsonCard}\n${bt66Card}`, ["resolve-browser"], { TIKPAL_AUDIO_CARD_PRIORITY: "BT66,Crimson" });
  assert(bt66Resolve.status === 0 && bt66Resolve.stdout.trim() === "dmix:CARD=BT66,DEV=0", `audio adapter should honor an explicit device priority and use dmix:\n${bt66Resolve.stdout}\n${bt66Resolve.stderr}`);
  const crimsonResolve = runAudioAdapt(`${hdmiCard}\n${crimsonCard}`, ["resolve-browser"]);
  assert(crimsonResolve.status === 0 && crimsonResolve.stdout.trim() === "tikpal_browser_output", `audio adapter should use a shared conversion PCM for S24-only Crimson browser audio:\n${crimsonResolve.stdout}\n${crimsonResolve.stderr}`);
  const crimsonAudioout = runAudioAdapt(`${hdmiCard}\n${crimsonCard}`, ["resolve-audioout"]);
  assert(crimsonAudioout.status === 0 && crimsonAudioout.stdout.trim() === "plughw:CARD=Crimson,DEV=0", "audio adapter should use plughw for moOde audioout");
  const crimsonHw = runAudioAdapt(`${hdmiCard}\n${crimsonCard}`, ["resolve-hw"]);
  assert(crimsonHw.status === 0 && crimsonHw.stdout.trim() === "hw:CARD=Crimson,DEV=0", "MPD Pure should share the audio adapter's hardware resolver");
  const mysteryCheck = runAudioAdapt(`${hdmiCard}\n${mysteryCard}`, ["check"]);
  assert(mysteryCheck.status === 0 && mysteryCheck.stdout.includes("selectedCard=Mystery") && mysteryCheck.stdout.includes("volumeStrategy=alsa:Master"), `audio adapter should accept one unknown USB card and probe its mixer:\n${mysteryCheck.stdout}\n${mysteryCheck.stderr}`);
  const usbOverPch = runAudioAdapt(`${hdmiCard}\n${pchCard}\n${mysteryCard}`, ["resolve-hw"], { TIKPAL_AUDIO_CARD_PRIORITY: "" });
  assert(usbOverPch.status === 0 && usbOverPch.stdout.trim() === "hw:CARD=Mystery,DEV=0", "audio adapter should prefer one USB playback endpoint over an onboard PCH endpoint");
  const pchOnly = runAudioAdapt(`${hdmiCard}\n${pchCard}`, ["resolve-hw"], { TIKPAL_AUDIO_CARD_PRIORITY: "" });
  assert(pchOnly.status === 0 && pchOnly.stdout.trim() === "hw:CARD=PCH,DEV=0", "audio adapter should accept one non-HDMI playback endpoint when no USB endpoint exists");
  const forcedPch = runAudioAdapt(`${hdmiCard}\n${pchCard}\n${mysteryCard}`, ["resolve-hw"], { TIKPAL_AUDIO_CARD_FORCE: "PCH", TIKPAL_AUDIO_CARD_PRIORITY: "" });
  assert(forcedPch.status === 0 && forcedPch.stdout.trim() === "hw:CARD=PCH,DEV=0", "an explicit forced card should override USB preference");
  const invalidForce = runAudioAdapt(`${hdmiCard}\n${mysteryCard}`, ["resolve-hw"], { TIKPAL_AUDIO_CARD_FORCE: "missing", TIKPAL_AUDIO_CARD_PRIORITY: "" });
  assert(invalidForce.status !== 0 && invalidForce.stdout.trim() === "" && invalidForce.stderr.includes("was not detected"), "an invalid forced card should fail without emitting a fallback PCM");
  const ambiguousPriority = runAudioAdapt(`${hdmiCard}\n${sharedNameCardA}\n${sharedNameCardB}`, ["resolve-hw"], { TIKPAL_AUDIO_CARD_PRIORITY: "Studio DAC (USB)" });
  assert(ambiguousPriority.status !== 0 && ambiguousPriority.stdout.trim() === "" && ambiguousPriority.stderr.includes("matched multiple playback endpoints"), "a priority name shared by multiple cards should fail instead of selecting the first match");
  const forcedSharedName = runAudioAdapt(`${hdmiCard}\n${sharedNameCardA}\n${sharedNameCardB}`, ["resolve-hw"], { TIKPAL_AUDIO_CARD_FORCE: "9", TIKPAL_AUDIO_CARD_PRIORITY: "Studio DAC (USB)" });
  assert(forcedSharedName.status === 0 && forcedSharedName.stdout.trim() === "hw:CARD=SharedB,DEV=0" && forcedSharedName.stderr.trim() === "", "a unique card index should resolve cards whose labels contain spaces and parentheses or share a name");
  const multipleUnknown = runAudioAdapt(`${hdmiCard}\n${mysteryCard}\n${otherCard}`, ["check"]);
  assert(multipleUnknown.status !== 0 && multipleUnknown.stderr.includes("TIKPAL_AUDIO_CARD_FORCE"), "audio adapter should reject multiple unknown USB cards without a forced card");
  const multipleNonUsb = runAudioAdapt(`${hdmiCard}\n${pchCard}\n${analogCard}`, ["resolve-hw"], { TIKPAL_AUDIO_CARD_PRIORITY: "" });
  assert(multipleNonUsb.status !== 0 && multipleNonUsb.stdout.trim() === "" && multipleNonUsb.stderr.includes("ambiguous non-HDMI"), "audio adapter should reject multiple non-HDMI cards when none is a unique USB endpoint");
  const noUsb = runAudioAdapt(hdmiCard, ["resolve-hw"], { TIKPAL_AUDIO_CARD_PRIORITY: "" });
  assert(noUsb.status !== 0 && noUsb.stdout.trim() === "" && noUsb.stderr.includes("no non-HDMI"), "audio adapter should reject an empty candidate set without selecting HDMI or emitting a fallback PCM");

  const audioAdaptApplyDir = path.join(audioAdaptTempDir, "apply");
  mkdirSync(audioAdaptApplyDir);
  const audioAdaptApply = runAudioAdapt(`${hdmiCard}\n${bt66Card}\n${loopbackCard}`, ["apply"], {
    TIKPAL_ALSA_RATE_CONVERTER: "samplerate_best",
    TIKPAL_AUDIOOUT_CONFIG: path.join(audioAdaptApplyDir, "_audioout.conf"),
    TIKPAL_BROWSER_OUTPUT_CONFIG: path.join(audioAdaptApplyDir, "browser.conf"),
    TIKPAL_SNDALOOP_CONFIG: path.join(audioAdaptApplyDir, "loopback.conf"),
    TIKPAL_SND_ALOOP_MODULES_LOAD: path.join(audioAdaptApplyDir, "snd-aloop.conf"),
    TIKPAL_ALSA_BASE_CONFIG: path.join(audioAdaptApplyDir, "asound.conf"),
    TIKPAL_ALSA_LEGACY_LOOPBACK_CONFIG: path.join(audioAdaptApplyDir, "legacy.conf"),
    TIKPAL_MOODE_DB: path.join(audioAdaptApplyDir, "missing.db")
  });
  assert(audioAdaptApply.status === 0, `audio adapter should generate configured ALSA SRC nodes:\n${audioAdaptApply.stdout}\n${audioAdaptApply.stderr}`);
  const generatedBrowserPcm = await readFile(path.join(audioAdaptApplyDir, "browser.conf"), "utf8");
  const generatedLoopbackPcm = await readFile(path.join(audioAdaptApplyDir, "loopback.conf"), "utf8");
  assert(generatedBrowserPcm.includes('rate_converter "samplerate_best"'), "shared browser plug should use the configured ALSA rate converter");
  assert(generatedLoopbackPcm.includes('rate_converter "samplerate_best"'), "managed _audioout plug should use the configured ALSA rate converter");

  writeFileSync(path.join(audioAdaptBinDir, "systemctl"), `#!/bin/sh
case "$1" in
  cat) exit 0 ;;
  is-active) echo inactive; exit 0 ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });
  writeFileSync(path.join(audioAdaptBinDir, "mpc"), `#!/bin/sh
case "$1" in
  status) echo "volume: 30%   repeat: off   random: off   single: off   consume: off" ;;
  outputs) : ;;
esac
exit 0
`, { mode: 0o755 });
  writeFileSync(path.join(audioAdaptBinDir, "mpd"), `#!/bin/sh
echo "Music Player Daemon"
echo "Resampler plugins: internal libsamplerate soxr"
`, { mode: 0o755 });
  const mpdProfileConfig = path.join(audioAdaptTempDir, "mpd.conf");
  writeFileSync(mpdProfileConfig, `music_directory "/var/lib/mpd/music"

# Tikpal managed MPD resampler: start
resampler {
        plugin          "internal"
}
# Tikpal managed MPD resampler: end

# Tikpal managed MPD audio output: start
audio_output {
        type            "alsa"
        name            "Tikpal Everyday"
        device          "_audioout"
        mixer_type      "software"
        replay_gain_handler "software"
}
# Tikpal managed MPD audio output: end
`);
  const audioProfileHelper = path.join(ROOT, "deploy/moode/tikpal-audio-output-profile.sh");
  const mpdProfileEnv = {
    ...process.env,
    PATH: `${audioAdaptBinDir}:${process.env.PATH}`,
    TIKPAL_MPD_CONF: mpdProfileConfig,
    TIKPAL_MPD_BIN: "mpd",
    TIKPAL_MPD_RESAMPLER_PLUGIN: "soxr",
    TIKPAL_MPD_RESAMPLER_QUALITY: "high",
    TIKPAL_MPD_RESAMPLER_THREADS: "0",
    TIKPAL_AUDIO_CARD_PRIORITY: "BT66,Crimson",
    TIKPAL_FAKE_APLAY_CARDS: `${hdmiCard}\n${bt66Card}`
  };
  const librarySetup = spawnSync("bash", [audioProfileHelper, "bootstrap"], { cwd: ROOT, env: { ...mpdProfileEnv, TIKPAL_MPD_RESTART_ON_PROFILE_WRITE: "0" }, encoding: "utf8" });
  assert(librarySetup.status === 0 && librarySetup.stdout.includes("libraryManaged=1"), `MPD bootstrap should configure a persistent database:\n${librarySetup.stdout}\n${librarySetup.stderr}`);
  const librarySetupConfig = await readFile(mpdProfileConfig, "utf8");
  assert(
    librarySetupConfig.includes('music_directory "/var/lib/mpd/music"')
      && librarySetupConfig.includes('db_file "/var/lib/mpd/database"')
      && librarySetupConfig.includes('follow_outside_symlinks "yes"'),
    "MPD library setup should keep Tikpal music and removable-drive symlinks indexable"
  );
  const srcApply = spawnSync("bash", [audioProfileHelper, "src-apply"], { cwd: ROOT, env: mpdProfileEnv, encoding: "utf8" });
  assert(srcApply.status === 0 && srcApply.stdout.includes("srcManaged=1"), `MPD SRC apply should validate the managed SoXR block:\n${srcApply.stdout}\n${srcApply.stderr}`);
  const firstSrcConfig = await readFile(mpdProfileConfig, "utf8");
  const srcApplyAgain = spawnSync("bash", [audioProfileHelper, "src-apply"], { cwd: ROOT, env: mpdProfileEnv, encoding: "utf8" });
  const secondSrcConfig = await readFile(mpdProfileConfig, "utf8");
  assert(srcApplyAgain.status === 0 && secondSrcConfig === firstSrcConfig, `MPD SRC apply should be byte-stable on a second run:\n${srcApplyAgain.stdout}\n${srcApplyAgain.stderr}`);
  const srcCheck = spawnSync("bash", [audioProfileHelper, "src-check"], { cwd: ROOT, env: mpdProfileEnv, encoding: "utf8" });
  assert(srcCheck.status === 0 && srcCheck.stdout.includes("srcManaged=1"), `MPD SRC check should accept the idempotent managed block:\n${srcCheck.stdout}\n${srcCheck.stderr}`);
  const resampledPure = spawnSync("bash", [audioProfileHelper, "pure"], {
    cwd: ROOT,
    env: { ...mpdProfileEnv, TIKPAL_MPD_PURE_PATH: "resampled", TIKPAL_MPD_PURE_TARGET_RATE: "48000" },
    encoding: "utf8"
  });
  assert(resampledPure.status === 0, `resampled Pure profile should apply:\n${resampledPure.stdout}\n${resampledPure.stderr}`);
  const resampledPureConfig = await readFile(mpdProfileConfig, "utf8");
  assert(resampledPureConfig.includes('device          "hw:CARD=BT66,DEV=0"') && resampledPureConfig.includes('format          "48000:16:2"'), "BT66 Pure should use the shared resolver and fixed S16/48 kHz output");
  assert((resampledPureConfig.match(/# Tikpal managed MPD resampler: start/g) ?? []).length === 1 && resampledPureConfig.includes('plugin          "soxr"'), "profile switching should preserve exactly one managed resampler block");
  assert((resampledPureConfig.match(/# Tikpal managed MPD audio output: start/g) ?? []).length === 1, "profile switching should preserve exactly one managed audio output block");

  const nativePure = spawnSync("bash", [audioProfileHelper, "pure"], {
    cwd: ROOT,
    env: {
      ...mpdProfileEnv,
      TIKPAL_MPD_PURE_PATH: "native",
      TIKPAL_AUDIO_CARD_PRIORITY: "",
      TIKPAL_FAKE_APLAY_CARDS: `${hdmiCard}\n${mysteryCard}`
    },
    encoding: "utf8"
  });
  assert(nativePure.status === 0, `native Pure profile should apply:\n${nativePure.stdout}\n${nativePure.stderr}`);
  const nativePureConfig = await readFile(mpdProfileConfig, "utf8");
  assert(nativePureConfig.includes('device          "hw:CARD=Mystery,DEV=0"') && !nativePureConfig.includes('format          "48000:16:2"'), "native Pure should follow the resolved DAC without forcing a target rate");

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
  const x11HelperUnit = await readFile(path.join(ROOT, "deploy/systemd/tikpal-x11-helper.service"), "utf8");
  const x11HelperKioskDropIn = await readFile(path.join(ROOT, "deploy/systemd/tikpal-kiosk-x11-helper.conf"), "utf8");
  const x11HelperSource = await readFile(path.join(ROOT, "deploy/chromium/tikpal-x11-helper.c"), "utf8");
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
  assert(apiUnit.includes("EnvironmentFile=-@APP_DIR@/.env.kiosk"), "api unit should load device-local kiosk backend settings");
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
  assert(
    x11HelperUnit.includes("PartOf=tikpal-kiosk.service")
      && x11HelperUnit.includes("After=tikpal-kiosk.service")
      && x11HelperUnit.includes("RuntimeDirectory=tikpal")
      && x11HelperUnit.includes("--transaction-timeout-ms 250"),
    "the native X11 helper should follow kiosk/Xorg lifecycle with a private runtime socket"
  );
  assert(
    x11HelperSource.includes("SOCK_STREAM")
      && x11HelperSource.includes("htonl(")
      && x11HelperSource.includes("ntohl(")
      && x11HelperSource.includes("MAX_PACKET_BYTES 16384")
      && x11HelperSource.includes("SO_PEERCRED")
      && x11HelperSource.includes("TIKPAL_WEB_MODE_X11_HELPER_SOCKET")
      && x11HelperSource.includes("TIKPAL_WEB_MODE_X11_HELPER_CONNECT_TIMEOUT_MS")
      && x11HelperSource.includes("TIKPAL_WEB_MODE_X11_HELPER_RESPONSE_TIMEOUT_MS")
      && x11HelperSource.includes("xcb_poll_for_reply(state->connection")
      && x11HelperSource.includes("xcb_get_file_descriptor(state->connection)")
      && x11HelperSource.includes("xcb_translate_coordinates(")
      && x11HelperSource.includes("connection_epoch++")
      && x11HelperSource.includes("state->watch_valid = false")
      && x11HelperSource.includes('strcmp(operation, "switch") == 0')
      && x11HelperSource.includes("xcb_configure_window_checked(")
      && x11HelperSource.includes("xcb_change_property_checked(")
      && x11HelperSource.includes("xcb_get_input_focus(")
      && x11HelperSource.includes('"XCB_CHECK_NOT_READY_AFTER_FENCE"')
      && x11HelperSource.includes("verify_identity_unchanged(")
      && x11HelperSource.includes("request_matches_active_lease(")
      && x11HelperSource.includes("revoke_response(")
      && x11HelperSource.includes("run_owner_allows(")
      && x11HelperSource.includes('"mutationStartedMonotonicNs"')
      && x11HelperSource.includes('"fenceCompletedMonotonicNs"')
      && x11HelperSource.includes('"finalSnapshotCompletedMonotonicNs"')
      && x11HelperSource.includes('code = "FINAL_STATE_MISMATCH"')
      && x11HelperSource.includes('strcmp(argv[1], "monotonic-ns") == 0')
      && x11HelperSource.includes('strcmp(argv[index], "--all")')
      && x11HelperSource.includes('strcmp(argv[index], "--generation-file")')
      && x11HelperSource.includes('strcmp(argv[index], "--phase")')
      && x11HelperSource.includes('"OPERATION_DISABLED_PHASE0"')
      && x11HelperSource.includes('TIKPAL_X11_HELPER_PHASE')
      && x11HelperSource.includes('"REQUEST_ID_CONFLICT"')
      && x11HelperSource.includes("WINDOW_PID_REUSED")
      && x11HelperSource.includes("WINDOW_UID_MISMATCH")
      && x11HelperSource.includes("--user-data-dir")
      && x11HelperSource.includes("run_self_test(")
      && !x11HelperSource.includes("xcb_wait_for_reply(")
      && !x11HelperSource.includes("xcb_request_check("),
    "Phase 1 X11 helper should be framed, peer-checked, deadline-bounded, identity-safe, lease-safe, and checked-mutation capable"
  );
  assert(systemdInstaller.includes("tikpal-audio-adapt.service"), "systemd installer should install the audio adapter service");
  assert(systemdInstaller.includes('/usr/local/sbin/tikpal-alsa-loopback.sh'), "systemd installer should keep the installed audio adapter's ALSA loopback dependency beside it");
  assert(systemdInstaller.includes("tikpal-library-sync.service"), "systemd installer should install the library sync service");
  assert(systemdInstaller.includes("tikpal-radio-presets-sync.sh") && systemdInstaller.includes("ensure_radio_presets"), "systemd installer should sync single-layer Radio presets");
  assert(systemdInstaller.includes("ensure_library_scan_env"), "systemd installer should keep Library Scan pointed at the combined sync helper");
  assert(systemdInstaller.includes("ensure_kiosk_audio_release_env") && systemdInstaller.includes("tikpal-release-kiosk-audio.sh"), "systemd installer should add the kiosk audio release hook on mpc Pi installs");
  assert(systemdInstaller.includes("systemctl restart tikpal-audio-adapt.service"), "systemd installer restart should run the audio adapter before app services");
  assert(systemdInstaller.indexOf("systemctl restart tikpal-library-sync.service") < systemdInstaller.indexOf("systemctl restart tikpal-api.service"), "systemd installer restart should sync MPD libraries before the API starts");
  assert(systemdInstaller.includes("tikpal-kiosk-watchdog.service"), "systemd installer should install the kiosk watchdog service");
  assert(systemdInstaller.includes("tikpal-kiosk-watchdog.timer"), "systemd installer should install and enable the kiosk watchdog timer");
  assert(
    systemdInstaller.includes("--enable-x11-helper")
      && systemdInstaller.includes("pkg-config --exists xcb json-c")
      && systemdInstaller.includes("mktemp -d")
      && systemdInstaller.includes('"$temporary_binary" self-test')
      && systemdInstaller.includes("tikpal-x11-helper.service")
      && systemdInstaller.includes("tikpal-kiosk-x11-helper.conf")
      && x11HelperKioskDropIn.includes("Wants=tikpal-x11-helper.service"),
    "systemd installer should build the native helper and make the kiosk pull it in explicitly"
  );
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
  assert(kioskEnv.includes("TIKPAL_X11_HELPER_PHASE=0"), "kiosk env should default the native Helper to Phase 0 read-only");
  assert(kioskEnv.includes("TIKPAL_KIOSK_VIEWER=none"), "kiosk env should default noVNC viewer off");
  assert(kioskEnv.includes("TIKPAL_KIOSK_DISPLAY_MODE=auto"), "kiosk env should document automatic physical/virtual display selection");
  assert(kioskEnv.includes("TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS=5"), "kiosk env should document bounded xset/xrandr commands");
  assert(
    kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_RESET_MODE=1280x720")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_SAFE_BRIGHTNESS=45")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_SAFE_CONTRAST=50")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_INPUT_SOURCE=")
      && kioskEnv.includes("TIKPAL_KIOSK_XRANDR_OUTPUT=auto")
      && kioskEnv.includes("TIKPAL_KIOSK_XRANDR_DIRECT_OUTPUT_PATTERN=\"^(HDMI|DP|DisplayPort)-\"")
      && kioskEnv.includes("TIKPAL_KIOSK_XRANDR_PRIMARY_PREFERRED_OUTPUTS=")
      && kioskEnv.includes("TIKPAL_KIOSK_XRANDR_FALLBACK_TO_CONNECTED=1")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_DRM_CONNECTOR=auto")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_DRM_CONNECTORS=auto")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_DRM_PREFERRED_CONNECTORS=")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_DRM_FALLBACK_TO_CONNECTED=1")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_WAIT_READY_TIMEOUT_SECONDS=45")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_DELAYED_KICK_SECONDS=none")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_DISABLE_POWER_KEYS=1")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_PCI_POWER_DEVICES=")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_PCIE_ASPM_POLICY=")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_DRM_POLL=")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_NOUVEAU_PCI_ID=")
      && kioskEnv.includes("TIKPAL_PHYSICAL_DISPLAY_NOUVEAU_REBIND_SETTLE_SECONDS=3"),
    "kiosk env should keep delayed physical display resets disabled by default and document PCI fallback defaults"
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
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_BACKGROUND_URL=http://127.0.0.1:4173/web-mode-background.html"), "kiosk env should configure the resident Explore background fallback");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_TRANSITION_URL=http://127.0.0.1:4173/web-mode-transition.html"), "kiosk env should configure the reusable Explore transition veil");
  assert(!kioskEnv.includes("TIKPAL_WEB_MODE_EXIT_"), "kiosk env should not configure a separate Explore exit veil");
  assert(
      kioskEnv.includes("TIKPAL_WEB_MODE_RESIDENT_SWITCH_SETTLE_SECONDS=0.08") &&
      kioskEnv.includes("TIKPAL_WEB_MODE_RESIDENT_SWITCH_PAINT_TIMEOUT_SECONDS=0.6") &&
      kioskEnv.includes("TIKPAL_WEB_MODE_RESIDENT_SWITCH_PAINT_POLL_SECONDS=0.05") &&
      kioskEnv.includes("TIKPAL_WEB_MODE_PROVIDER_SWITCH_FADE_SECONDS=0.16") &&
      kioskEnv.includes("TIKPAL_WEB_MODE_TRANSITION_MIN_VISIBLE_SECONDS=0.5"),
    "kiosk env should make every provider switch fade briefly and hold the transition feedback"
  );
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_STAGE_POSITION=2560,0"), "kiosk env should stage provider windows offscreen");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS=2"), "kiosk env should bound Explore provider switch locking");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_QQ_AUTO_CONFIRM=1"), "kiosk env should enable safe QQ Music auto-confirm by default");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_EXTENSION_ENABLED=1"), "kiosk env should enable the dynamic Explore proxy extension by default");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_PROXY_APPLY_TIMEOUT_SECONDS=5"), "kiosk env should bound dynamic proxy confirmation");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_PROVIDER_BOOTSTRAP_TIMEOUT_SECONDS=7"), "kiosk env should bound provider bootstrap navigation");
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_PROVIDER_WINDOW_TIMEOUT_SECONDS=30"), "kiosk env should bound provider window detection below the API open timeout");
  assert(
    kioskEnv.includes("TIKPAL_WEB_MODE_PROVIDER_PREWARM_MAX_CONCURRENT_LAUNCHES=3") &&
      kioskEnv.includes("TIKPAL_WEB_MODE_BOOT_PREWARM_READY_TIMEOUT_SECONDS=30") &&
      kioskEnv.includes("TIKPAL_WEB_MODE_BOOT_PREWARM_INITIAL_DELAY_SECONDS=3"),
    "kiosk env should document balanced boot prewarm concurrency and readiness timing"
  );
  assert(kioskEnv.includes("TIKPAL_WEB_MODE_PROVIDER_TEXT_SCALE=1.10"), "kiosk env should default Explore provider text scale to 110%");
  const kioskLauncher = await readFile(path.join(ROOT, "deploy/chromium/launch-tikpal-kiosk.sh"), "utf8");
  const kioskSession = await readFile(path.join(ROOT, "deploy/chromium/start-tikpal-kiosk-session.sh"), "utf8");
  const watchdogSource = await readFile(path.join(ROOT, "deploy/chromium/tikpal-kiosk-healthcheck.sh"), "utf8");
  const webModeScript = await readFile(path.join(ROOT, "deploy/chromium/tikpal-web-mode.sh"), "utf8");
  const cdpManagerSource = await readFile(path.join(ROOT, "deploy/chromium/tikpal-web-mode-cdp-manager.mjs"), "utf8");
  const cdpManagerClient = await readFile(path.join(ROOT, "deploy/chromium/tikpal-web-mode-cdp-client.py"), "utf8");
  const initialEntryFixture = await readFile(path.join(ROOT, "scripts/tikpal-initial-entry-fixture.sh"), "utf8");
  assert(
    webModeScript.includes("x11_helper_prepare_switch()")
      && webModeScript.includes("x11_helper_begin_switch()")
      && webModeScript.includes("x11_helper_enter_fallback()")
      && webModeScript.includes("x11_helper_finish_success()")
      && webModeScript.includes("x11_helper_guard_may_write()")
      && webModeScript.includes("x11_helper_guard_may_recover_all()")
      && webModeScript.includes("guard_maintain_windows()")
      && webModeScript.includes("write_guard_window_list \"$provider_profile\"")
      && webModeScript.includes("window_guard_running_hot")
      && webModeScript.includes("guard-process-verify"),
    "Phase 1 switching should arbitrate exact Helper ownership while keeping an existing window Guard alive"
  );
  const realProviderUrlWaitStart = webModeScript.indexOf("wait_for_real_provider_url() {");
  const realProviderUrlWaitEnd = webModeScript.indexOf("\n}\n\nprovider_cdp_json_list()", realProviderUrlWaitStart);
  const realProviderUrlWaitBody = webModeScript.slice(realProviderUrlWaitStart, realProviderUrlWaitEnd);
  const cdpJsonListStart = webModeScript.indexOf("provider_cdp_json_list() {");
  const cdpJsonListEnd = webModeScript.indexOf("\n}\n\nprovider_has_real_provider_page()", cdpJsonListStart);
  const cdpJsonListBody = webModeScript.slice(cdpJsonListStart, cdpJsonListEnd);
  assert(
    cdpJsonListBody.includes("timeout 0.8 curl") &&
      cdpJsonListBody.includes("--connect-timeout 1 --max-time 1") &&
      webModeScript.includes('provider_cdp_json_list "$provider_port"'),
    "foreground provider readiness checks should bound a wedged local DevTools response"
  );
  assert(
    webModeScript.includes("TIKPAL_WEB_MODE_CDP_SESSION_MANAGER") &&
      webModeScript.includes("cdp_session_manager_requested()") &&
      webModeScript.includes("cdp_manager_response") &&
      cdpManagerSource.includes("Target.attachToTarget") &&
      cdpManagerSource.includes("Runtime.enable") &&
      cdpManagerSource.includes("sessionGeneration") &&
      cdpManagerSource.includes("documentGeneration") &&
      cdpManagerSource.includes("friendlyError") &&
      cdpManagerSource.includes("Page.loadingFailed") &&
      cdpManagerSource.includes("unreachableUrl") &&
      cdpManagerSource.includes("/json/version") &&
      !cdpManagerSource.includes("/json/list") &&
      cdpManagerClient.includes("CDP_IPC_UNAVAILABLE"),
    "Phase 4 should use one persistent browser CDP session per provider, publish friendly document failures, and preserve explicit IPC failures"
  );
  assert(
    realProviderUrlWaitBody.includes("deadline=$((SECONDS + TIKPAL_WEB_MODE_PROVIDER_BOOTSTRAP_TIMEOUT_SECONDS))") &&
      !realProviderUrlWaitBody.includes("attempts=$((TIKPAL_WEB_MODE_PROVIDER_BOOTSTRAP_TIMEOUT_SECONDS * 10))"),
    "provider bootstrap polling should have one total deadline rather than accumulating per-request timeouts"
  );
  assert(
      webModeScript.includes("provider_window_has_nonblank_x11_frame()") &&
      webModeScript.includes("wait_for_provider_window_nonblank_x11_frame()") &&
      webModeScript.includes("-f x11grab -window_id") &&
      webModeScript.includes("process.exit(max - min >= 18 ? 0 : 1)") &&
      !webModeScript.includes("deviation / count >= 3") &&
      webModeScript.includes('wait_for_provider_window_nonblank_x11_frame "$target_window"') &&
      webModeScript.includes('resident $provider did not paint and CDP confirms no real page; reopening'),
    "resident hot switching should reject flat X11 blank frames without rejecting sparse rendered page content"
  );
  const exploreAcceptanceScript = await readFile(path.join(ROOT, "deploy/chromium/tikpal-explore-switch-acceptance.sh"), "utf8");
  assert(
    exploreAcceptanceScript.includes("explore-ten-provider-switches.mp4") &&
      exploreAcceptanceScript.includes("/api/v1/web-mode/actions") &&
      exploreAcceptanceScript.includes("switches.tsv") &&
      exploreAcceptanceScript.includes("xdotool search --onlyvisible --class chromium"),
    "Explore acceptance should record the complete ten-provider lap with API timings and X11 geometry evidence"
  );
  const physicalExploreAcceptanceScript = await readFile(path.join(ROOT, "deploy/chromium/tikpal-explore-physical-acceptance.sh"), "utf8");
  assert(
    physicalExploreAcceptanceScript.includes('acceptance_mode="${1:-full}"')
      && physicalExploreAcceptanceScript.includes("switch_only_preflight()")
      && physicalExploreAcceptanceScript.includes('full|switch-only|switch-strict|switch-diagnostic)')
      && physicalExploreAcceptanceScript.includes("TIKPAL_EXPLORE_ACCEPTANCE_PROVIDER_SET")
      && physicalExploreAcceptanceScript.includes("configure_provider_scope()")
      && physicalExploreAcceptanceScript.includes("provider_scope_kind")
      && physicalExploreAcceptanceScript.includes("scoped_gate_passed")
      && physicalExploreAcceptanceScript.includes("const [baseText, targetProvider, ...scopeProviders]")
      && physicalExploreAcceptanceScript.includes("for item in \"${scoped_providers[@]}\"")
      && physicalExploreAcceptanceScript.includes("for ((pass=1;")
      && physicalExploreAcceptanceScript.includes('[[ "$surfaces" == "2" ]]')
      && physicalExploreAcceptanceScript.includes('click_provider_card "$target"')
      && physicalExploreAcceptanceScript.includes("events.jsonl")
      && physicalExploreAcceptanceScript.includes("rounds.csv")
      && physicalExploreAcceptanceScript.includes("summary.json")
      && physicalExploreAcceptanceScript.includes("report.md")
      && physicalExploreAcceptanceScript.includes("timeout 8s ffmpeg")
      && physicalExploreAcceptanceScript.includes("curl ffmpeg flock node sha256sum timeout xdotool")
      && physicalExploreAcceptanceScript.includes("switch_mode_is_strict()")
      && physicalExploreAcceptanceScript.includes('result="stable-over-5s"')
      && physicalExploreAcceptanceScript.includes('error_code="stable_over_5s"')
      && !physicalExploreAcceptanceScript.includes("/api/v1/web-mode/actions"),
    "physical Explore acceptance should offer strict and diagnostic 20-click modes with correlated artifacts while API and CDP remain read-only"
  );
  assert(
    physicalExploreAcceptanceScript.includes('click_kiosk_selector ".ambient-screen"')
      && physicalExploreAcceptanceScript.includes("click_kiosk_selector_when_ready '[data-ambient-source-option=\"web-mode\"]'")
      && physicalExploreAcceptanceScript.includes("click_kiosk_selector '[data-ambient-source-toggle]'")
      && physicalExploreAcceptanceScript.includes("click_kiosk_selector '[data-ambient-source-option=\"web-mode\"]'")
      && !physicalExploreAcceptanceScript.includes("xdotool mousemove --sync 700 360 click 1")
      && !physicalExploreAcceptanceScript.includes("xdotool mousemove --sync 1838 160 click 1"),
    "physical Explore entry should use DOM-derived centers for the ambient, source-toggle, and Explore controls"
  );
  const physicalAcceptanceExitContract = spawnSync(
    "bash",
    ["deploy/chromium/tikpal-explore-physical-acceptance.sh", "exit-contract-fixtures"],
    { cwd: ROOT, encoding: "utf8" }
  );
  assert(
    physicalAcceptanceExitContract.status === 0,
    `strict physical acceptance should preserve failures and reject a failed summary: ${physicalAcceptanceExitContract.stderr || physicalAcceptanceExitContract.stdout}`
  );
  const physicalAcceptanceSummaryContract = spawnSync(
    "bash",
    ["deploy/chromium/tikpal-explore-physical-acceptance.sh", "summary-contract-fixtures"],
    { cwd: ROOT, encoding: "utf8" }
  );
  assert(
    physicalAcceptanceSummaryContract.status === 0,
    `physical acceptance should gate one-shot and formal visible/stable timing independently: ${physicalAcceptanceSummaryContract.stderr || physicalAcceptanceSummaryContract.stdout}`
  );
  const physicalAcceptanceScopeFixtures = spawnSync(
    "bash",
    ["deploy/chromium/tikpal-explore-physical-acceptance.sh", "scope-fixtures"],
    { cwd: ROOT, encoding: "utf8" }
  );
  assert(
    physicalAcceptanceScopeFixtures.status === 0,
    `physical acceptance should validate explicit scoped Provider sets: ${physicalAcceptanceScopeFixtures.stderr || physicalAcceptanceScopeFixtures.stdout}`
  );
  const unwritableX11TraceCheck = spawnSync(
    "bash",
    ["deploy/chromium/tikpal-web-mode.sh", "--check"],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        TIKPAL_KIOSK_SKIP_ENV_SOURCE: "1",
        TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH: "/dev/null/tikpal-x11-trace.jsonl"
      }
    }
  );
  assert(
    unwritableX11TraceCheck.status !== 0 &&
      `${unwritableX11TraceCheck.stdout}\n${unwritableX11TraceCheck.stderr}`.includes("TRACE_NOT_WRITABLE"),
    "every Explore command should reject an unwritable X11 trace before it can enter a state or X11 transaction"
  );
  assert(
    webModeScript.includes("x11_helper_cleanup_active_transaction()")
      && webModeScript.includes("trap x11_helper_cleanup_on_exit EXIT")
      && webModeScript.includes("X11_TRACE_APPEND_FAILED")
      && webModeScript.includes("SWITCH_TRACE_APPEND_FAILED"),
    "Explore trace failures should remain diagnostic while Helper cleanup runs from an independent exit trap"
  );
  assert(
    webModeScript.includes("record_switch_trace_event()")
      && webModeScript.includes("target_resolve_started")
      && webModeScript.includes("guard_prepare_started")
      && webModeScript.includes("foreground_switch_started")
      && webModeScript.includes("runtime_geometry_verified")
      && webModeScript.includes("lock_released"),
    "Explore resident switching should emit correlated trace boundaries without changing the foreground action"
  );
  const reconcileSmokeDir = mkdtempSync(path.join(tmpdir(), "tikpal-reconcile-"));
  const reconcileStatePath = path.join(reconcileSmokeDir, "web-mode-state.json");
  const reconcileProfileRoot = path.join(reconcileSmokeDir, "profiles");
  mkdirSync(reconcileProfileRoot);
  writeFileSync(reconcileStatePath, JSON.stringify({
    activeProvider: "spotify",
    residentProviders: { spotify: { status: "active" } }
  }));
  const staleReconcile = spawnSync("bash", ["deploy/chromium/tikpal-web-mode.sh", "reconcile", "deezer", "0"], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      TIKPAL_KIOSK_SKIP_ENV_SOURCE: "1",
      TIKPAL_CHROMIUM_BIN: process.execPath,
      TIKPAL_WEB_MODE_PROFILE_ROOT: reconcileProfileRoot,
      TIKPAL_WEB_MODE_STATE_PATH: reconcileStatePath,
      TIKPAL_WEB_MODE_PROVIDER_POOL: "1",
      TIKPAL_WEB_MODE_PROVIDER_PREWARM_ENABLED: "1"
    }
  });
  assert(staleReconcile.status === 0, `stale resident reconcile should exit cleanly: ${staleReconcile.stderr || staleReconcile.stdout}`);
  const reconcileState = JSON.parse(await readFile(reconcileStatePath, "utf8"));
  assert(reconcileState.activeProvider === "spotify", "stale resident reconcile should not overwrite a newer activeProvider");
  const closeOwnershipStatePath = path.join(reconcileSmokeDir, "close-owned-state.json");
  writeFileSync(closeOwnershipStatePath, JSON.stringify({
    activeProvider: null,
    lastProvider: "spotify",
    closeRequestId: "close-owns-state",
    residentProviders: { spotify: { status: "active" } }
  }));
  const webModeDispatchIndex = webModeScript.indexOf('\ncase "$web_mode_action" in');
  const webModeFunctions = webModeScript.slice(0, webModeDispatchIndex >= 0 ? webModeDispatchIndex : webModeScript.indexOf('\ncase "${1:-open}" in'));
  const windowIdentityCachePath = path.join(reconcileSmokeDir, "dead-window.id");
  const switchTimingOncePath = path.join(reconcileSmokeDir, "switch-segment-timing.once");
  const panelMutationPath = path.join(reconcileSmokeDir, "panel-mutations.log");
  const guardPauseCallsPath = path.join(reconcileSmokeDir, "guard-pause-calls");
  const guardTickPath = path.join(reconcileSmokeDir, "guard-ticks.log");
  const guardActiveReadsPath = path.join(reconcileSmokeDir, "guard-active-reads");
  const windowIdentitySmoke = spawnSync("bash", ["-s"], {
    cwd: ROOT,
    input: `${webModeFunctions}
xdotool() { return 0; }
xdotool_probe() {
  if [[ "$*" == "getwindowpid 101 getwindowgeometry --shell 101" ]]; then
    printf '4242\\nWINDOW=101\\nWIDTH=1920\\nHEIGHT=720\\n'
    return 0
  fi
  return 1
}
process_tree_uses_profile() { [[ "$1" == "4242" && "$2" == "/profiles/spotify" ]]; }
profile_window_cache_path() { printf '%s\\n' "$TIKPAL_SMOKE_WINDOW_CACHE"; }
pgrep() { return 1; }
validate_profile_window_fast 101 /profiles/spotify
if validate_profile_window_fast 999 /profiles/spotify; then exit 11; fi
if validate_profile_window_fast 101 /profiles/deezer; then exit 12; fi
printf '101\\n' > "$TIKPAL_SMOKE_WINDOW_CACHE"
: > "$TIKPAL_WEB_MODE_SWITCH_SEGMENT_TIMING_ONCE_PATH"
[[ "$(first_window_for_profile /profiles/spotify 1 target)" == "101" ]]
grep -q 'switch_detail cache role=target profile=spotify .*outcome=cache_hit .*attempt1_result=ok' "$TIKPAL_WEB_MODE_SWITCH_SEGMENT_TIMING_ONCE_PATH.details"
rm -f "$TIKPAL_WEB_MODE_SWITCH_SEGMENT_TIMING_ONCE_PATH" "$TIKPAL_WEB_MODE_SWITCH_SEGMENT_TIMING_ONCE_PATH.details"
printf '999\\n' > "$TIKPAL_SMOKE_WINDOW_CACHE"
: > "$TIKPAL_WEB_MODE_SWITCH_SEGMENT_TIMING_ONCE_PATH"
if first_window_for_profile /profiles/spotify 1 target; then exit 13; fi
[[ ! -e "$TIKPAL_SMOKE_WINDOW_CACHE" ]]
grep -q 'outcome=not_found .*retry=1 recovery=1 .*attempt1_result=x11_failed .*attempt2_result=x11_failed' "$TIKPAL_WEB_MODE_SWITCH_SEGMENT_TIMING_ONCE_PATH.details"
rm -f "$TIKPAL_WEB_MODE_SWITCH_SEGMENT_TIMING_ONCE_PATH" "$TIKPAL_WEB_MODE_SWITCH_SEGMENT_TIMING_ONCE_PATH.details"
window_geometry_compact() { printf '%s\n' "$TIKPAL_SMOKE_PANEL_GEOMETRY"; }
tile_window_fast() { printf '%s\n' "$*" >> "$TIKPAL_SMOKE_PANEL_MUTATIONS"; }
: > "$TIKPAL_SMOKE_PANEL_MUTATIONS"
TIKPAL_SMOKE_PANEL_GEOMETRY=1920,0_640x720
[[ "$(keep_side_panel_visible_during_switch spotify 202 0)" == "202" ]]
[[ ! -s "$TIKPAL_SMOKE_PANEL_MUTATIONS" ]]
TIKPAL_SMOKE_PANEL_GEOMETRY=2560,0_640x720
[[ "$(keep_side_panel_visible_during_switch spotify 202 0)" == "202" ]]
grep -q '^202 1920,0 640x720$' "$TIKPAL_SMOKE_PANEL_MUTATIONS"
window_opacity_is_full unset
window_opacity_is_full 4294967295
window_opacity_is_full 0xffffffff
if window_opacity_is_full 0; then exit 14; fi
if window_opacity_is_full unreadable; then exit 15; fi
: > "$TIKPAL_SMOKE_GUARD_TICKS"
printf '0\n' > "$TIKPAL_SMOKE_GUARD_PAUSE_CALLS"
printf '0\n' > "$TIKPAL_SMOKE_GUARD_ACTIVE_READS"
TIKPAL_WEB_MODE_PROVIDER_POOL=1
x11_trace_control_event() { :; }
sleep() { command sleep 0.005; }
provider_switch_in_progress() {
  local calls
  calls="$(cat "$TIKPAL_SMOKE_GUARD_PAUSE_CALLS")"
  calls=$((calls + 1))
  printf '%s\n' "$calls" > "$TIKPAL_SMOKE_GUARD_PAUSE_CALLS"
  [[ "$calls" -le 2 ]]
}
read_runtime_active_provider() {
  local reads
  reads="$(cat "$TIKPAL_SMOKE_GUARD_ACTIVE_READS")"
  reads=$((reads + 1))
  printf '%s\n' "$reads" > "$TIKPAL_SMOKE_GUARD_ACTIVE_READS"
  [[ "$reads" -le 2 ]] && printf 'spotify\n'
  return 0
}
guard_run_tick() { printf 'tick\n' >> "$TIKPAL_SMOKE_GUARD_TICKS"; }
run_window_guard /profiles/spotify /profiles/side-panel
[[ "$(cat "$TIKPAL_SMOKE_GUARD_PAUSE_CALLS")" == 2 ]]
[[ ! -s "$TIKPAL_SMOKE_GUARD_TICKS" ]]
`,
    encoding: "utf8",
    env: {
      ...process.env,
      TIKPAL_KIOSK_SKIP_ENV_SOURCE: "1",
      TIKPAL_CHROMIUM_BIN: process.execPath,
      TIKPAL_SMOKE_WINDOW_CACHE: windowIdentityCachePath,
      TIKPAL_WEB_MODE_SWITCH_SEGMENT_TIMING_ONCE_PATH: switchTimingOncePath,
      TIKPAL_SMOKE_PANEL_MUTATIONS: panelMutationPath,
      TIKPAL_SMOKE_GUARD_PAUSE_CALLS: guardPauseCallsPath,
      TIKPAL_SMOKE_GUARD_TICKS: guardTickPath,
      TIKPAL_SMOKE_GUARD_ACTIVE_READS: guardActiveReadsPath,
      TIKPAL_WEB_MODE_PROFILE_ROOT: path.join(reconcileSmokeDir, "guard-pause-profiles"),
      TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH: ""
    }
  });
  assert(
    windowIdentitySmoke.status === 0,
    `Explore window identity should reject dead cached IDs and mismatched profiles: ${windowIdentitySmoke.stderr || windowIdentitySmoke.stdout}`
  );
  const providerGuardLifecycleDir = mkdtempSync(path.join(tmpdir(), "tikpal-provider-guard-lifecycle-"));
  const providerGuardProcRoot = path.join(providerGuardLifecycleDir, "proc");
  const providerGuardProfileRoot = path.join(providerGuardLifecycleDir, "profiles");
  const providerGuardProfile = path.join(providerGuardProfileRoot, "providers/qobuz");
  const providerGuardHelperPath = path.join(ROOT, "deploy/chromium/tikpal-web-mode-guard.mjs");
  const providerGuardKillLog = path.join(providerGuardLifecycleDir, "kills.tsv");
  mkdirSync(providerGuardProcRoot, { recursive: true });
  mkdirSync(providerGuardProfileRoot, { recursive: true });
  const writeProviderGuardProcess = (pid, argv, environment) => {
    const processDir = path.join(providerGuardProcRoot, String(pid));
    mkdirSync(processDir, { recursive: true });
    writeFileSync(path.join(processDir, "cmdline"), Buffer.from(`${argv.join("\0")}\0`));
    writeFileSync(path.join(processDir, "environ"), Buffer.from(`${environment.join("\0")}\0`));
  };
  const qobuzGuardEnvironment = [
    "TIKPAL_WEB_MODE_PROVIDER_ID=qobuz",
    `TIKPAL_WEB_MODE_PROVIDER_PROFILE=${providerGuardProfile}`,
    "TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT=9238",
    "TIKPAL_WEB_MODE_PROXY_MODE=proxy"
  ];
  writeProviderGuardProcess(101, ["node", "--experimental-websocket", providerGuardHelperPath], qobuzGuardEnvironment);
  writeProviderGuardProcess(102, ["node", "--experimental-websocket", providerGuardHelperPath], qobuzGuardEnvironment);
  writeProviderGuardProcess(103, ["node", "--experimental-websocket", providerGuardHelperPath], [
    ...qobuzGuardEnvironment.filter((entry) => !entry.startsWith("TIKPAL_WEB_MODE_PROVIDER_ID=")),
    "TIKPAL_WEB_MODE_PROVIDER_ID=deezer"
  ]);
  writeProviderGuardProcess(104, ["node", "--experimental-websocket", `${providerGuardHelperPath}.decoy`], qobuzGuardEnvironment);
  writeFileSync(path.join(providerGuardProfileRoot, "provider-guard-qobuz.pid"), "101\n");
  const providerGuardLifecycleSmoke = spawnSync("bash", ["-s"], {
    cwd: ROOT,
    input: `${webModeFunctions}
SCRIPT_DIR="$TIKPAL_SMOKE_SCRIPT_DIR"
kill() {
  local signal=TERM pid
  case "$1" in
    -0) signal=0; pid="$2" ;;
    -TERM) signal=TERM; pid="$2" ;;
    -KILL) signal=KILL; pid="$2" ;;
    *) pid="$1" ;;
  esac
  if [[ "$signal" == "0" ]]; then
    [[ -d "$TIKPAL_WEB_MODE_PROC_ROOT/$pid" ]]
    return
  fi
  printf '%s\t%s\n' "$signal" "$pid" >> "$TIKPAL_SMOKE_PROVIDER_GUARD_KILL_LOG"
  rm -rf "$TIKPAL_WEB_MODE_PROC_ROOT/$pid"
}
sleep() { :; }
[[ "$(provider_guard_matching_pids qobuz "$TIKPAL_SMOKE_PROVIDER_PROFILE" 1 9238)" == $'101\n102' ]]
stop_provider_guard_instances qobuz "$TIKPAL_SMOKE_PROVIDER_PROFILE" 1 9238
[[ ! -e "$TIKPAL_WEB_MODE_PROFILE_ROOT/provider-guard-qobuz.pid" ]]
[[ ! -d "$TIKPAL_WEB_MODE_PROC_ROOT/101" && ! -d "$TIKPAL_WEB_MODE_PROC_ROOT/102" ]]
[[ -d "$TIKPAL_WEB_MODE_PROC_ROOT/103" && -d "$TIKPAL_WEB_MODE_PROC_ROOT/104" ]]
[[ "$(sort "$TIKPAL_SMOKE_PROVIDER_GUARD_KILL_LOG")" == $'TERM\t101\nTERM\t102' ]]
printf '103\n' > "$TIKPAL_WEB_MODE_PROFILE_ROOT/provider-guard-qobuz.pid"
if provider_guard_process_matches qobuz "$TIKPAL_SMOKE_PROVIDER_PROFILE" 1 9238; then exit 21; fi
`,
    encoding: "utf8",
    env: {
      ...process.env,
      TIKPAL_KIOSK_SKIP_ENV_SOURCE: "1",
      TIKPAL_WEB_MODE_PROC_ROOT: providerGuardProcRoot,
      TIKPAL_WEB_MODE_PROFILE_ROOT: providerGuardProfileRoot,
      TIKPAL_SMOKE_SCRIPT_DIR: path.join(ROOT, "deploy/chromium"),
      TIKPAL_SMOKE_PROVIDER_PROFILE: providerGuardProfile,
      TIKPAL_SMOKE_PROVIDER_GUARD_KILL_LOG: providerGuardKillLog
    }
  });
  assert(
    providerGuardLifecycleSmoke.status === 0,
    `provider guard cleanup should remove canonical and orphan instances without touching mismatched processes: ${providerGuardLifecycleSmoke.stderr || providerGuardLifecycleSmoke.stdout}`
  );
  const activeCloseOwnershipStatePath = path.join(reconcileSmokeDir, "active-close-owned-state.json");
  writeFileSync(activeCloseOwnershipStatePath, JSON.stringify({
    activeProvider: "spotify",
    lastProvider: "spotify",
    closeRequestId: "active-close-owns-state"
  }));
  const activeCloseOwnership = spawnSync("bash", ["-s"], {
    cwd: ROOT,
    input: [
      webModeFunctions,
      "write_runtime_provider_state deezer"
    ].join("\n"),
    encoding: "utf8",
    env: {
      ...process.env,
      TIKPAL_KIOSK_SKIP_ENV_SOURCE: "1",
      TIKPAL_WEB_MODE_PROFILE_ROOT: reconcileProfileRoot,
      TIKPAL_WEB_MODE_STATE_PATH: activeCloseOwnershipStatePath
    }
  });
  assert(activeCloseOwnership.status === 0, "Close should own runtime state while the physically visible provider remains Active");
  const activeCloseOwnedState = JSON.parse(readFileSync(activeCloseOwnershipStatePath, "utf8"));
  assert(
    activeCloseOwnedState.activeProvider === "spotify" && activeCloseOwnedState.closeRequestId === "active-close-owns-state",
    "a delayed provider writer must not clear or replace Active before Close verifies every surface"
  );
  const activeCloseRequestCurrent = spawnSync("bash", ["-s"], {
    cwd: ROOT,
    input: [webModeFunctions, "runtime_close_request_is_current"].join("\n"),
    encoding: "utf8",
    env: {
      ...process.env,
      TIKPAL_KIOSK_SKIP_ENV_SOURCE: "1",
      TIKPAL_WEB_MODE_PROFILE_ROOT: reconcileProfileRoot,
      TIKPAL_WEB_MODE_STATE_PATH: activeCloseOwnershipStatePath,
      TIKPAL_WEB_MODE_CLOSE_REQUEST_ID: "active-close-owns-state"
    }
  });
  assert(activeCloseRequestCurrent.status === 0, "the matching Close request should remain current while Active is still physically visible");

  const closeSurfaceCountPath = path.join(reconcileSmokeDir, "close-surface-count");
  const closeSurfaceOperationsPath = path.join(reconcileSmokeDir, "close-surface-operations");
  const closeSurfaceMocks = [
    webModeFunctions,
    "web_mode_surface_windows_on_screen() {",
    "  local count=0",
    "  [[ -r \"$TIKPAL_SMOKE_COUNT\" ]] && count=\"$(sed -n '1p' \"$TIKPAL_SMOKE_COUNT\")\"",
    "  [[ \"$count\" =~ ^[0-9]+$ ]] || count=0",
    "  count=$((count + 1))",
    "  printf '%s\\n' \"$count\" > \"$TIKPAL_SMOKE_COUNT\"",
    "  if [[ \"$count\" == \"1\" ]]; then",
    "    printf '101\\tprovider\\n102\\tprovider\\n201\\tpanel\\n'",
    "  elif [[ \"$TIKPAL_SMOKE_RESIDUAL\" == \"1\" ]]; then",
    "    printf '202\\tpanel\\n'",
    "  fi",
    "}",
    "set_window_opacity() { printf 'hide\\t%s\\n' \"$1\" >> \"$TIKPAL_SMOKE_OPS\"; }",
    "tile_window_fast() { printf 'move\\t%s\\t%s\\t%s\\n' \"$1\" \"$2\" \"$3\" >> \"$TIKPAL_SMOKE_OPS\"; }",
    "clear_window_above() { printf 'lower-hint\\t%s\\n' \"$1\" >> \"$TIKPAL_SMOKE_OPS\"; }",
    "xdotool_safe() { printf 'lower\\t%s\\n' \"$2\" >> \"$TIKPAL_SMOKE_OPS\"; }"
  ];
  writeFileSync(closeSurfaceCountPath, "0\n");
  writeFileSync(closeSurfaceOperationsPath, "");
  const closeSurfaceSuccess = spawnSync("bash", ["-s"], {
    cwd: ROOT,
    input: [...closeSurfaceMocks, "park_web_mode_surfaces_for_reopen spotify"].join("\n"),
    encoding: "utf8",
    env: {
      ...process.env,
      TIKPAL_KIOSK_SKIP_ENV_SOURCE: "1",
      TIKPAL_SMOKE_COUNT: closeSurfaceCountPath,
      TIKPAL_SMOKE_OPS: closeSurfaceOperationsPath,
      TIKPAL_SMOKE_RESIDUAL: "0"
    }
  });
  assert(
    closeSurfaceSuccess.status === 0,
    "multi-window Explore close should park provider main, popup, and side panel: " + (closeSurfaceSuccess.stderr || closeSurfaceSuccess.stdout)
  );
  const closeSurfaceOperations = readFileSync(closeSurfaceOperationsPath, "utf8").trim().split("\n");
  assert(
    closeSurfaceOperations.slice(0, 3).every((operation) => operation.startsWith("hide\t"))
      && new Set(closeSurfaceOperations.slice(0, 3).map((operation) => operation.split("\t")[1])).size === 3
      && ["101", "102", "201"].every((window) => closeSurfaceOperations.some((operation) => operation.startsWith("move\t" + window + "\t"))),
    "every Explore surface should become transparent before any provider or panel window moves"
  );
  writeFileSync(closeSurfaceCountPath, "0\n");
  writeFileSync(closeSurfaceOperationsPath, "");
  const closeSurfaceResidual = spawnSync("bash", ["-s"], {
    cwd: ROOT,
    input: [...closeSurfaceMocks, "if park_web_mode_surfaces_for_reopen spotify; then exit 1; fi"].join("\n"),
    encoding: "utf8",
    env: {
      ...process.env,
      TIKPAL_KIOSK_SKIP_ENV_SOURCE: "1",
      TIKPAL_SMOKE_COUNT: closeSurfaceCountPath,
      TIKPAL_SMOKE_OPS: closeSurfaceOperationsPath,
      TIKPAL_SMOKE_RESIDUAL: "1"
    }
  });
  assert(closeSurfaceResidual.status === 0, "any provider or side-panel residual should make Explore close fail");

  const delayedOpenStateWrite = spawnSync("bash", ["-s"], {
    cwd: ROOT,
    input: `${webModeFunctions}\nwrite_runtime_provider_state deezer\n`,
    encoding: "utf8",
    env: {
      ...process.env,
      TIKPAL_KIOSK_SKIP_ENV_SOURCE: "1",
      TIKPAL_WEB_MODE_PROFILE_ROOT: reconcileProfileRoot,
      TIKPAL_WEB_MODE_STATE_PATH: closeOwnershipStatePath
    }
  });
  assert(delayedOpenStateWrite.status === 0, `close-owned state should ignore a delayed resident open: ${delayedOpenStateWrite.stderr || delayedOpenStateWrite.stdout}`);
  const closeOwnedState = JSON.parse(await readFile(closeOwnershipStatePath, "utf8"));
  assert(
    closeOwnedState.activeProvider === null && closeOwnedState.closeRequestId === "close-owns-state",
    "a delayed resident open must not reclaim state after Close owns it"
  );
  const staleResidentOpen = spawnSync("bash", ["-s"], {
    cwd: ROOT,
    input: `${webModeFunctions}\nif runtime_open_request_is_current; then exit 1; fi\nexit 0\n`,
    encoding: "utf8",
    env: {
      ...process.env,
      TIKPAL_KIOSK_SKIP_ENV_SOURCE: "1",
      TIKPAL_WEB_MODE_PROFILE_ROOT: reconcileProfileRoot,
      TIKPAL_WEB_MODE_STATE_PATH: closeOwnershipStatePath,
      TIKPAL_WEB_MODE_OPEN_EXPECTED_ACTIVE_PROVIDER: "deezer"
    }
  });
  assert(staleResidentOpen.status === 0, `a close-owned state should cancel a delayed resident open before it changes surfaces: ${staleResidentOpen.stderr || staleResidentOpen.stdout}`);
  const closeStatusSync = spawnSync("bash", ["-s"], {
    cwd: ROOT,
    input: `${webModeFunctions}
provider_ids() { printf 'spotify\\n'; }
profile_process_exists() { return 0; }
provider_has_real_provider_page() { return 0; }
wait_for_provider_ready() { return 1; }
provider_debug_port() { printf '9234\\n'; }
sync_runtime_provider_pool_process_statuses ""
`,
    encoding: "utf8",
    env: {
      ...process.env,
      TIKPAL_KIOSK_SKIP_ENV_SOURCE: "1",
      TIKPAL_WEB_MODE_PROFILE_ROOT: reconcileProfileRoot,
      TIKPAL_WEB_MODE_STATE_PATH: closeOwnershipStatePath,
      TIKPAL_WEB_MODE_CLOSE_REQUEST_ID: "close-owns-state"
    }
  });
  assert(closeStatusSync.status === 0, `close-owned resident status sync should exit cleanly: ${closeStatusSync.stderr || closeStatusSync.stdout}`);
  const closeSyncedState = JSON.parse(await readFile(closeOwnershipStatePath, "utf8"));
  assert(
    closeSyncedState.activeProvider === null &&
      closeSyncedState.closeRequestId === "close-owns-state" &&
      closeSyncedState.residentProviders.spotify?.status === "ready",
    "a close-owned sync should promote a real HTTPS page without waiting for full DOM readiness"
  );
  const startupResetStatePath = path.join(reconcileSmokeDir, "startup-reset-state.json");
  const startupResetProfileRoot = path.join(reconcileSmokeDir, "startup-reset-profiles");
  mkdirSync(startupResetProfileRoot);
  writeFileSync(startupResetStatePath, JSON.stringify({
    activeProvider: null,
    lastProvider: "spotify",
    closeRequestId: "stale-close-request",
    residentProviders: { spotify: { status: "active" } }
  }));
  writeFileSync(path.join(startupResetProfileRoot, "pool-warm.stamp"), "old pool\n");
  const startupResetFullClose = spawnSync("bash", ["-s"], {
    cwd: ROOT,
    input: `${webModeFunctions}
provider_ids() { printf 'spotify\\n'; }
close_legacy_exit_stage() { :; }
hide_onboard() { :; }
close_provider_windows() { :; }
close_side_panel() { :; }
write_audio_bus_state() { :; }
sync_runtime_provider_pool_process_statuses() { :; }
close_web_mode_full
[[ ! -e "$(pool_warm_stamp_file)" ]]
`,
    encoding: "utf8",
    env: {
      ...process.env,
      TIKPAL_KIOSK_SKIP_ENV_SOURCE: "1",
      TIKPAL_WEB_MODE_STARTUP_RESET: "1",
      TIKPAL_WEB_MODE_PROFILE_ROOT: startupResetProfileRoot,
      TIKPAL_WEB_MODE_STATE_PATH: startupResetStatePath
    }
  });
  assert(startupResetFullClose.status === 0, `startup reset should clear stale pool state: ${startupResetFullClose.stderr || startupResetFullClose.stdout}`);
  const startupResetState = JSON.parse(await readFile(startupResetStatePath, "utf8"));
  assert(
    startupResetState.activeProvider === null &&
      startupResetState.closeRequestId === null &&
      startupResetState.openingProvider === null &&
      startupResetState.openRequestId === null &&
      startupResetState.openStartedAt === null &&
      startupResetState.openXSessionGeneration === null,
    "startup reset must release a stale Close owner before boot prewarm starts"
  );
  const startupResetStatusSync = spawnSync("bash", ["-s"], {
    cwd: ROOT,
    input: `${webModeFunctions}
provider_ids() { printf 'spotify\\n'; }
profile_process_exists() { return 0; }
provider_has_real_provider_page() { return 0; }
wait_for_provider_ready() { return 0; }
provider_debug_port() { printf '9234\\n'; }
sync_runtime_provider_pool_process_statuses ""
`,
    encoding: "utf8",
    env: {
      ...process.env,
      TIKPAL_KIOSK_SKIP_ENV_SOURCE: "1",
      TIKPAL_WEB_MODE_PROFILE_ROOT: startupResetProfileRoot,
      TIKPAL_WEB_MODE_STATE_PATH: startupResetStatePath
    }
  });
  assert(startupResetStatusSync.status === 0, `startup prewarm status sync should exit cleanly: ${startupResetStatusSync.stderr || startupResetStatusSync.stdout}`);
  const startupResetSyncedState = JSON.parse(await readFile(startupResetStatePath, "utf8"));
  assert(startupResetSyncedState.residentProviders.spotify?.status === "ready", "a real provider page should become Ready after startup reset releases the stale Close owner");
  const proxyPolicySmoke = spawnSync("bash", ["-s"], {
    cwd: ROOT,
    input: `${webModeFunctions}
[[ "$(effective_provider_proxy_enabled spotify 1)" == "1" ]]
[[ "$(effective_provider_proxy_enabled spotify 0)" == "0" ]]
[[ "$(effective_provider_proxy_enabled qq_music 1)" == "0" ]]
[[ "$(effective_provider_proxy_enabled netease_music 1)" == "0" ]]
`,
    encoding: "utf8",
    env: { ...process.env, TIKPAL_KIOSK_SKIP_ENV_SOURCE: "1" }
  });
  assert(proxyPolicySmoke.status === 0, `boot prewarm proxy policy should honor Proxy On/Off and direct-provider exceptions: ${proxyPolicySmoke.stderr || proxyPolicySmoke.stdout}`);
  const onboardImeToggleScript = await readFile(path.join(ROOT, "deploy/chromium/onboard-scripts/tikpalImeToggle.py"), "utf8");
  const onboardTheme = await readFile(path.join(ROOT, "deploy/chromium/onboard-themes/Tikpal-Classic.colors"), "utf8");
  const serverSource = await readFile(path.join(ROOT, "server/index.mjs"), "utf8");
  assert(
    serverSource.includes("consumeWebModeSwitchTraceContext")
      && serverSource.includes('recordWebModeSwitchTraceEvent(trace, "api_received"')
      && serverSource.includes('recordWebModeSwitchTraceEvent(trace, "opening_provider_written"')
      && serverSource.includes('recordWebModeSwitchTraceEvent(trace, "runner_created"')
      && serverSource.includes('recordWebModeSwitchTraceEvent(trace, "runner_started"')
      && serverSource.includes("...webModeSwitchTraceEnv(trace)")
      && serverSource.includes("strictHelperTransaction")
      && serverSource.includes('TIKPAL_WEB_MODE_STRICT_HELPER_TRANSACTION: trace.strictHelperTransaction ? "1" : "0"'),
    "Explore API should correlate request preparation and runner timing with the physical switch trace"
  );
  const splitArtistSource = serverSource.match(/function splitArtistForLookup\(artist\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  const splitArtistForLookup = Function('"use strict"; ' + splitArtistSource + "; return splitArtistForLookup;")();
  assert(!serverSource.includes("\u0008"), "server source should not contain backspace control characters");
  assert(
    JSON.stringify(splitArtistForLookup("Daft Punk and Pharrell Williams feat. Nile Rodgers"))
      === JSON.stringify(["Daft Punk", "Pharrell Williams", "Nile Rodgers"]),
    "artist lookup splitting should use JavaScript word boundaries for English separators"
  );
  const prewarmProviderGuardSource = await readFile(path.join(ROOT, "deploy/chromium/tikpal-web-mode-guard.mjs"), "utf8");
  const webModeErrorPage = await readFile(path.join(ROOT, "public/web-mode-error.html"), "utf8");
  const webModeBackgroundPage = await readFile(path.join(ROOT, "public/web-mode-background.html"), "utf8");
  const webModeCloseOverlayPage = await readFile(path.join(ROOT, "public/web-mode-close-overlay.html"), "utf8");
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
  const providerAudioGateSource = await readFile(path.join(ROOT, "deploy/chromium/web-mode-extension/provider-audio-gate.js"), "utf8");
  const i18nSource = await readFile(path.join(ROOT, "src/i18n.tsx"), "utf8");
  const sidePanelSource = await readFile(path.join(ROOT, "src/components/WebModeSidePanel.tsx"), "utf8");
  const quickSettingsSource = await readFile(path.join(ROOT, "src/components/QuickSettingsOverlay.tsx"), "utf8");
  const remoteControlSource = await readFile(path.join(ROOT, "src/components/RemoteControlApp.tsx"), "utf8");
  const ambientScreenSource = await readFile(path.join(ROOT, "src/components/AmbientScreen.tsx"), "utf8");
  const sourceStatusSource = await readFile(path.join(ROOT, "src/sourceStatus.ts"), "utf8");
  const startupModeChooserSource = await readFile(path.join(ROOT, "src/components/StartupModeChooser.tsx"), "utf8");
  const appModeSource = await readFile(path.join(ROOT, "src/hooks/useAppMode.ts"), "utf8");
  const playerOverlaySource = await readFile(path.join(ROOT, "src/components/PlayerOverlay.tsx"), "utf8");
  const uiCopySource = await readFile(path.join(ROOT, "src/uiCopy.ts"), "utf8");
  assert(
    webModeErrorPage.includes('normalized === "proxy_unreachable"') &&
      webModeErrorPage.includes('normalized === "connection_timeout"') &&
      webModeErrorPage.includes("return dict.tryAgain;") &&
      !webModeErrorPage.includes("return value;"),
    "the local Explore error page should render stable Tikpal copy instead of raw Chromium error text"
  );
  const flameSceneSource = await readFile(path.join(ROOT, "src/components/FlameScene.tsx"), "utf8");
  const appSource = await readFile(path.join(ROOT, "src/App.tsx"), "utf8");
  const exploreCloseVeilSource = await readFile(path.join(ROOT, "src/exploreCloseVeil.ts"), "utf8");
  const exploreOpenVeilSource = await readFile(path.join(ROOT, "src/exploreOpenVeil.ts"), "utf8");
  const playbackTruthSource = await readFile(path.join(ROOT, "src/playbackTruth.ts"), "utf8");
  const stylesSource = await readFile(path.join(ROOT, "src/styles.css"), "utf8");
  assert(
    appSource.includes("EXPLORE_OPEN_OVERLAY_MAX_MS = 8_000")
      && appSource.includes("openRequestId: requestId")
      && appSource.includes('logExploreOpenVeil("timeout"')
      && appSource.includes('logExploreOpenVeil("remove_ignored"')
      && exploreOpenVeilSource.includes("if (this.requestId !== requestId) return false")
      && exploreOpenVeilSource.includes("if (this.timeout) clearTimeout(this.timeout)"),
    "Explore entry veil should have a short request-owned timeout that stale callbacks cannot remove"
  );
  assert(
    sidePanelSource.includes("await waitForExploreCloseCover(closeRequestId)")
      && sidePanelSource.includes('type: "cover-requested"')
      && sidePanelSource.includes('type: "closed"')
      && sidePanelSource.includes('type: "failed"')
      && !sidePanelSource.includes("await new Promise(r => setTimeout(r, 3050))"),
    "Explore close should wait for a request-owned main-window cover instead of the obsolete three-second delay"
  );
  assert(
    exploreCloseVeilSource.includes('EXPLORE_CLOSE_COVER_FALLBACK_MS = 1_100')
      && exploreCloseVeilSource.includes('type: "cover-ready"')
      && appSource.includes("onTransitionEnd")
      && appSource.includes("acknowledgeExploreCloseCover")
      && appSource.includes("releaseExploreCloseVeil")
      && stylesSource.includes("transition: opacity 250ms ease-out, visibility 0s linear 250ms;"),
    "Explore close should acknowledge an opaque cover, reject stale messages, and release it with a short fade after physical close"
  );
  assert(stylesSource.includes("--transport-play-icon") && stylesSource.includes("--transport-play-border"), "Transport play buttons should expose skin-aware icon and border tokens");
  assert(stylesSource.includes(".screen-saver-wake-hint"), "Screen sleep should include a subtle touch-to-wake hint");
  assert(stylesSource.includes(".audio-output-diagnostics-chip"), "Audio Output should style the advanced-info hint as a light chip");
  assert(stylesSource.includes(".nas-source-next-step"), "NAS source detail should reserve a separate next-step row");
  assert(stylesSource.includes(".settings-card-summary .settings-card-action"), "Settings cards should reduce low-value footer copy weight");
  assert(stylesSource.includes(".ambient-transport-play") && stylesSource.includes("color: var(--transport-play-icon);"), "Ambient play/pause button should follow the selected surface skin");
  assert(ambientScreenSource.includes("ambient-source-toggle is-source-primary") && ambientScreenSource.includes('aria-expanded={sourcePickerOpen}'), "Ambient source picker toggle should stay visually primary while aria-expanded only tracks the open shelf");
  assert(ambientScreenSource.includes("is-source-picker-open") && stylesSource.includes(".ambient-screen.is-source-picker-open::before"), "Ambient source picker should dim the room behind the options");
  assert(stylesSource.includes("backdrop-filter: blur(5px) saturate(0.82) brightness(0.72)"), "Ambient source picker dim layer should softly blur and darken the room");
  assert(ambientScreenSource.includes("if (ambientHudVisible)") && ambientScreenSource.includes("setSourcePickerOpen(true)") && !ambientScreenSource.includes("SOURCE_PICKER_AUTO_CLOSE_MS"), "Ambient and Hi-Fi source pickers should default open with the HUD and avoid the old auto-close timer");
  assert(
    ambientScreenSource.includes("HIFI_LYRICS_FAKE_CONTROLS_VISIBLE_MS = 3_000")
      && ambientScreenSource.includes('data-hifi-lyrics-fake-control="previous"')
      && ambientScreenSource.includes('data-hifi-lyrics-fake-control="play-pause"')
      && ambientScreenSource.includes('data-hifi-lyrics-fake-control="next"')
      && ambientScreenSource.includes("setHifiLyricsFakeControlsVisible(false)")
      && !ambientScreenSource.includes("data-hifi-lyrics-control-prompt"),
    "Hi-Fi lyrics wall should use temporary fake playback controls instead of the old prompt pill"
  );
  assert(
    stylesSource.includes(".hifi-lyrics-fake-controls.is-hidden")
      && stylesSource.includes("pointer-events: none")
      && stylesSource.includes(".hifi-lyrics-fake-control.is-primary"),
    "Hi-Fi fake playback controls should visually auto-hide without leaving clickable hit targets"
  );
  assert(
    ambientScreenSource.includes("AMBIENT_SOURCE_NOTIFICATION_VISIBLE_MS = 3_000")
      && ambientScreenSource.includes("data-ambient-source-notification-phase")
      && ambientScreenSource.includes("showAmbientSourceNotification(sourceId)")
      && ambientScreenSource.includes("dismissAmbientSourceNotification()")
      && !ambientScreenSource.includes("getAmbientSourcePillDetail")
      && stylesSource.includes(".ambient-source-status-pill.is-exiting"),
    "Ambient source feedback should be an explicit temporary notification rather than persistent playback metadata"
  );
  assert(
    stylesSource.includes(".quick-menu .overlay-backdrop") &&
      stylesSource.includes("backdrop-filter: blur(14px) saturate(0.52) brightness(0.56)") &&
      stylesSource.includes(".app-root.is-quick-menu-active .ambient-screen") &&
      stylesSource.includes("filter: blur(14px) saturate(0.6) brightness(0.72)") &&
      appSource.includes('mode === "quickMenu" ? "is-quick-menu-active" : ""'),
    "Quick Menu should visibly darken and blur the room behind the switches"
  );
  assert(
    startupModeChooserSource.includes('context: "startup"')
      && startupModeChooserSource.includes("data-room-mode-chooser-context={context}")
      && startupModeChooserSource.includes("videoReady: boolean")
      && startupModeChooserSource.includes("!videoReady")
      && !startupModeChooserSource.includes("explore-return")
      && !appSource.includes('setRoomModeChooserContext("explore-return")')
      && appSource.includes("returnAmbient();")
      && appSource.includes("onSceneVideoReadyChange={handleSceneVideoReadyChange}")
      && appSource.includes("roomModeSelectionPending")
      && appSource.includes("observedWebModeActiveRef"),
    "Explore close should return directly to Ambient after an observed active-to-idle transition; the room-mode chooser is startup-only"
  );
  assert(
    i18nSource.includes('const LOCALE_STORAGE_KEY = "tikpal.locale"')
      && i18nSource.includes("const [initialLocale] = useState<UiLocale | null>(readStoredLocale)")
      && i18nSource.includes("const [preferencesReady, setPreferencesReady] = useState(initialLocale !== null)")
      && i18nSource.includes("if (!preferencesReady) return null;")
      && i18nSource.includes("window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)"),
    "Saved UI locales should render before the first visible UI frame and cache every supported locale"
  );
  assert(
    !stylesSource.includes(".startup-mode-chooser.is-explore-return"),
    "Explore return-only room-mode chooser styles should be removed"
  );
  assert(appModeSource.includes("HUD_AUTO_HIDE_MS = 8000") && appModeSource.includes("HUD_SOURCE_PICKER_AUTO_HIDE_MS = 12000") && appModeSource.includes("hudAutoHidePaused"), "Ambient HUD should use 8s normally, 12s with the source picker, and pause auto-hide during pending work");
  assert(stylesSource.includes(".ambient-source-toggle.is-source-primary:not(:disabled)") && stylesSource.includes(".ambient-source-toggle.is-source-primary.is-active:not(:disabled)"), "Ambient source picker toggle should keep a skin-aware primary state after the shelf closes");
  assert(stylesSource.includes(".remote-play-button") && stylesSource.includes("background: var(--transport-play-bg);"), "Remote play/pause button should follow the selected surface skin");
  assert(!stylesSource.includes("linear-gradient(145deg, rgba(119, 215, 239, 0.28), rgba(242, 200, 101, 0.14))"), "Remote play/pause button should not keep a fixed cyan/gold gradient");
  assert(
    !ambientScreenSource.includes("ambient-transport-sound")
      && !ambientScreenSource.includes("onSceneSoundEnabledChange")
      && !remoteControlSource.includes("scene.sound_set")
      && remoteControlSource.includes("data-remote-lyrics-refresh")
      && remoteControlSource.includes('type: "lyrics.refresh"'),
    "customer-facing Ambient and Remote controls should not expose a Scene Sound switch"
  );
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
  assert(webModeScript.includes("prefs.profile.default_content_setting_values.notifications = 2;"), "Explore Chromium profiles should block notification prompts by default");
  assert(webModeScript.includes("helper_cdp_skip_paint"), "Helper resident reveals should use their verified CDP fast path when x11grab cannot read Chromium windows");
  const readinessFunction = webModeScript.slice(webModeScript.indexOf("wait_for_provider_ready()"), webModeScript.indexOf("wait_for_entry_provider_paint()"));
  assert(readinessFunction.includes("(async () => {") && readinessFunction.includes("})().catch(() => process.exit(1));"), "Provider readiness should not use top-level await when Node executes stdin as CommonJS");
  assert(extensionManifest.version !== "1.0.0", "Explore extension should bump its version when provider scaling behavior changes so Chromium refreshes cached service workers");
  assert(extensionManifest.key, "Explore extension should use a stable id for managed-policy allowlisting");
  assert(extensionManifest.host_permissions.includes("http://127.0.0.1:8787/*"), "Explore extension should only call the loopback API");
  assert(extensionManifest.host_permissions.includes("http://127.0.0.1:4173/*"), "Explore extension should be able to leave the local provider bootstrap page");
  assert(extensionManifest.host_permissions.includes("https://*.music.126.net/*") && extensionManifest.host_permissions.includes("https://*.music.163.com/*"), "Explore extension should allow NetEase audio fetch fallback domains only");
  assert(extensionManifest.background?.service_worker === "background.js" && extensionManifest.background?.type === "module", "Explore extension should use its MV3 module service worker");
  assert(extensionManifest.web_accessible_resources?.some((entry) => entry.resources?.includes("netease-audio-mirror.js") && entry.matches?.includes("https://music.163.com/*")), "Explore extension should expose the NetEase audio mirror to the page world");
  assert(extensionManifest.content_scripts?.some((entry) => entry.world === "MAIN" && entry.run_at === "document_start" && entry.js?.includes("provider-audio-gate.js")), "Explore extension should install the provider audio gate in the page world before provider scripts run");
  assert(extensionContent.includes('chrome.runtime.sendMessage({ type: "provider-audio-muted", muted: true }'), "Provider tabs should request browser-level mute at document start");
  assert(providerAudioGateSource.includes("active: false") && providerAudioGateSource.includes("__tikpalProviderAudioGatePlayPatched") && providerAudioGateSource.includes("rememberPlayingMedia") && providerAudioGateSource.includes("version: 3"), "Provider audio gate should default to silence and retain resumable v3 state");
  assert(extensionContent.includes("window.setInterval(() => void syncProxy(), 750)"), "provider pages should poll the proxy settings revision every 750ms");
  assert(extensionContent.includes("initialProxyKey") && !extensionContent.includes("initialRevision"), "provider pages should reload only when the proxy key changes");
  assert(extensionContent.includes("window.location.reload()"), "provider pages should refresh after a proxy revision change");
  assert(
    extensionContent.includes("clickSpotifyReloadPage")
      && extensionContent.includes("open\\.spotify\\.com")
      && extensionContent.includes('labels.includes("reload page")')
      && extensionContent.includes("lastSpotifyReloadClickMs < 3000")
      && extensionContent.includes("element.click()"),
    "Spotify should auto-click only a visible exact Reload page action without repeated clicks"
  );
  assert(!extensionContent.includes("window.location.replace(provider.url)"), "provider content script should not restore the removed bootstrap redirect");
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
  assert(extensionContent.includes('chrome.runtime.sendMessage({ type: "keyboard", enabled, force, dismissSticky }'), "Explore extension should distinguish new input focus from ordinary hides and explicit dismiss requests");
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
  assert(sidePanelSource.includes("data-web-mode-state={panelState}") && sidePanelSource.includes('pendingAction === "close" ? "closing"') && sidePanelSource.includes('panelState === "switching"') && sidePanelSource.includes("displayedOpeningProvider"), "Explore side panel should expose synchronized closing and opening-provider states");
  assert(sidePanelSource.includes("initialOpeningProviderRef") && sidePanelSource.includes("next.openingProvider !== initialOpeningProvider"), "Explore side panel should discard a stale startup opening hint when the API reports a different or idle request");
  assert(sidePanelSource.includes("inferFailedProviderFromError") && sidePanelSource.includes('"common.failed"') && sidePanelSource.includes("is-failed"), "Explore side panel should show provider-open failures without marking the provider active");
  assert(sidePanelSource.includes('residentStatus === "check_proxy"') && sidePanelSource.includes('"common.needProxyOn"'), "Explore side panel should show Need Proxy On from live provider probe state");
  assert(sidePanelSource.includes("isProxyNeededError") && sidePanelSource.includes("needs proxy(?: on)?"), "Explore side panel should show Need Proxy On for proxy-related provider failures");
  assert(sidePanelSource.includes('"common.proxyOn"') && sidePanelSource.includes('"common.proxyOff"') && !sidePanelSource.includes('"common.direct"'), "Explore proxy status should say Proxy On/Proxy Off instead of Direct");
  assert(stylesSource.includes(".web-mode-provider.is-failed"), "Explore side panel should style failed provider-open state separately from Active");
  assert(stylesSource.includes(".web-mode-provider.is-proxy-unavailable"), "Explore side panel should give proxy-unavailable providers their own visual state");
  assert(!sidePanelSource.includes("updateWebModeSettings"), "Explore side panel should not reopen the provider to switch proxy mode");
  assert(!sidePanelSource.includes("data-web-mode-keyboard-toggle") && !sidePanelSource.includes("toggleKeyboard"), "Explore side panel should rely on automatic input-focus keyboard behavior");
  assert((sidePanelSource.match(/onClick=\{\(\) => void closeWebMode\(\)\}/g) ?? []).length === 1, "Explore side panel should keep only the top-right Close button");
  assert(!quickSettingsSource.includes("handleWebModeKeyboard"), "Console should rely on input-focus keyboard behavior instead of a duplicate button");
  assert(quickSettingsSource.includes('detailView !== "webMode"'), "Console should only preload Onboard for the Explore Proxy settings detail");
  assert(quickSettingsSource.includes('sendWebModeAction({ type: "keyboard", preload: true })'), "Console Explore Proxy settings should preload resident Onboard before the first text-field tap");
  assert(!quickSettingsSource.includes("webModeProviderTextScale") && !quickSettingsSource.includes("webModeTextScaleChoices") && !quickSettingsSource.includes("data-web-mode-settings-scale"), "Console Explore settings should not expose provider text scale controls");
  assert(quickSettingsSource.includes("requestWebModeProxyChange") && quickSettingsSource.includes("data-web-mode-proxy-restart-confirm") && quickSettingsSource.includes('await onSystemAction("reboot")'), "Console Proxy toggles should require confirmation, save settings, and then request a reboot");
  assert(quickSettingsSource.includes('if (enabled && normalizeProxyUrl(webModeProxyUrl) === null)') && quickSettingsSource.includes("if (nextEnabled && normalizedProxyUrl === null)"), "Console Proxy should reject an invalid URL before confirmation and before saving Proxy On");
  assert(quickSettingsSource.includes("testWebModeProxy(candidateProxyUrl)") && quickSettingsSource.includes("checkWebModeProxy") && quickSettingsSource.includes("data-web-mode-proxy-test") && quickSettingsSource.includes("data-web-mode-proxy-validation") && quickSettingsSource.includes("disabled={proxyRestartDisabled}"), "Console Proxy should expose a manual candidate check and require validation before enabling its restart action");
  assert(quickSettingsSource.includes("proxyUrl: normalizedProxyUrl") && !quickSettingsSource.includes("proxyEnabled: webModeProxyEnabled"), "Console Proxy URL drafts should auto-save without hot-applying proxy state");
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
  assert(
    flameSceneSource.includes("function reloadSingleLoopVideo")
      && flameSceneSource.includes('waitForVideoEvent(video, "canplay", VIDEO_METADATA_SETTLE_MS)')
      && flameSceneSource.includes("if (video.readyState < 2 || video.seeking)"),
    "single-loop recovery should bound metadata-only and permanently-seeking video stalls through the watchdog"
  );
  assert(
    flameSceneSource.includes("function playVideoWithTimeout")
      && flameSceneSource.includes("VIDEO_PLAY_SETTLE_MS")
      && flameSceneSource.includes("if (!started || video.seeking) return false"),
    "single-loop recovery should return timed-out video.play() calls to the watchdog instead of waiting forever"
  );
  assert(kioskLauncher.includes("TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS"), "kiosk launcher should expose an X command timeout");
  assert(kioskLauncher.includes("run_x_command xrandr"), "kiosk launcher should bound xrandr commands");
  assert(kioskLauncher.includes("xrandr_rate_for_output()") && kioskLauncher.includes('XRANDR_ARGS+=(--rate "$XRANDR_RATE")'), "kiosk launcher should preserve the selected physical display refresh rate");
  assert(kioskLauncher.includes("run_x_command xset"), "kiosk launcher should bound xset commands");
  assert(kioskLauncher.includes("detect_non_hdmi_card_id"), "kiosk launcher should detect the actual non-HDMI ALSA card");
  assert(kioskLauncher.includes("tikpal-audio-adapt.sh") && kioskLauncher.includes("resolve-browser"), "kiosk launcher should use the shared audio adapter for auto ALSA output");
  assert(kioskLauncher.includes(': "${TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE:=auto}"'), "kiosk launcher should default Chromium audio to the physical adapter instead of ALSA default");
  assert(webModeScript.includes(': "${TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE:=auto}"'), "Explore should default Chromium audio to the physical adapter instead of ALSA default");
  assert(kioskLauncher.includes('TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE="$(resolve_physical_alsa_output_device'), "kiosk launcher should resolve auto ALSA output before launching Chromium");
  assert(
    kioskLauncher.includes("resolve_xrandr_primary_output")
      && kioskLauncher.includes("TIKPAL_KIOSK_XRANDR_DIRECT_OUTPUT_PATTERN")
      && kioskLauncher.includes('[[ "$output" =~ $TIKPAL_KIOSK_XRANDR_DIRECT_OUTPUT_PATTERN ]]')
      && kioskLauncher.includes("TIKPAL_KIOSK_XRANDR_FALLBACK_TO_CONNECTED"),
    "kiosk launcher should prefer a connected direct output before EVDI fallback"
  );
  assert(
    physicalDisplayPrepare.includes("TIKPAL_PHYSICAL_DISPLAY_RESET_MODE:=1280x720")
      && physicalDisplayPrepare.includes("TIKPAL_PHYSICAL_DISPLAY_INPUT_SOURCE:=")
      && physicalDisplayPrepare.includes("TIKPAL_KIOSK_XRANDR_OUTPUT:=auto")
      && physicalDisplayPrepare.includes("TIKPAL_KIOSK_XRANDR_DIRECT_OUTPUT_PATTERN:=^(HDMI|DP|DisplayPort)-")
      && physicalDisplayPrepare.includes("TIKPAL_KIOSK_XRANDR_PRIMARY_PREFERRED_OUTPUTS:=}")
      && physicalDisplayPrepare.includes("TIKPAL_PHYSICAL_DISPLAY_DRM_CONNECTOR:=auto")
      && physicalDisplayPrepare.includes("TIKPAL_PHYSICAL_DISPLAY_DRM_CONNECTORS:=$TIKPAL_PHYSICAL_DISPLAY_DRM_CONNECTOR")
      && physicalDisplayPrepare.includes("TIKPAL_PHYSICAL_DISPLAY_DRM_FALLBACK_TO_CONNECTED:=1")
      && physicalDisplayPrepare.includes("TIKPAL_PHYSICAL_DISPLAY_DELAYED_KICK_SECONDS:=none")
      && physicalDisplayPrepare.includes("TIKPAL_PHYSICAL_DISPLAY_PCI_POWER_DEVICES:=")
      && physicalDisplayPrepare.includes("TIKPAL_PHYSICAL_DISPLAY_PCIE_ASPM_POLICY:=")
      && physicalDisplayPrepare.includes("TIKPAL_PHYSICAL_DISPLAY_DRM_POLL:=")
      && physicalDisplayPrepare.includes("TIKPAL_PHYSICAL_DISPLAY_NOUVEAU_PCI_ID:=")
      && physicalDisplayPrepare.includes("drm_connector_ready()")
      && physicalDisplayPrepare.includes("drm_connector_bases()")
      && physicalDisplayPrepare.includes("resolve_primary_output()")
      && physicalDisplayPrepare.includes('[[ "$output" =~ $TIKPAL_KIOSK_XRANDR_DIRECT_OUTPUT_PATTERN ]]')
      && physicalDisplayPrepare.includes("xrandr_output_has_property()")
      && physicalDisplayPrepare.includes("apply_xrandr_property_if_supported()")
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
    "physical display helper should retain explicit recovery, while default delayed resets stay disabled"
  );
  const delayedKickDisabled = spawnSync("bash", ["deploy/chromium/tikpal-physical-display-prepare.sh", "delayed-soft-kick"], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      TIKPAL_KIOSK_SKIP_ENV_SOURCE: "1",
      TIKPAL_PHYSICAL_DISPLAY_DELAYED_KICK_SECONDS: "none"
    }
  });
  assert(delayedKickDisabled.status === 0, `disabled delayed soft-kick should exit cleanly: ${delayedKickDisabled.stderr || delayedKickDisabled.stdout}`);
  assert(delayedKickDisabled.stdout.includes("delayed soft-kick is disabled"), "disabled delayed soft-kick should not touch the display");
  assert(kioskSession.includes("TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS"), "kiosk session should expose an X command timeout");
  assert(kioskSession.includes("run_x_command xset"), "kiosk session should bound xset commands");
  assert(kioskSession.includes("GTK_IM_MODULE=fcitx") && kioskSession.includes("XMODIFIERS=@im=fcitx"), "kiosk session should expose Fcitx5 to Chromium/X11");
  assert(kioskSession.includes("read_preferred_input_method") && kioskSession.includes("DefaultIM=$default_im") && kioskSession.includes("Name=keyboard-us") && kioskSession.includes("Name=pinyin") && kioskSession.includes("Name=keyboard-de") && kioskSession.includes("Name=keyboard-it") && kioskSession.includes("Name=hangul") && kioskSession.includes("Name=anthy") && kioskSession.includes("Name=keyboard-es"), "kiosk session should seed English, Chinese, German, Italian, Korean, Japanese, and Spanish input methods");
  assert(kioskSession.includes("0=F9") && kioskSession.includes("1=Control+space"), "kiosk session should configure touch and hardware input-method toggles without opening Chromium DevTools");
  assert(kioskSession.includes("ActiveByDefault=False") && kioskSession.includes("ShareInputState=All"), "kiosk input should start inactive while sharing the selected method across provider windows");
  assert(kioskSession.includes("fcitx_candidate_font()") && kioskSession.includes("Noto Sans CJK SC") && kioskSession.includes("Noto Sans CJK JP") && kioskSession.includes("Noto Sans CJK KR") && kioskSession.includes("Source Han Sans CN 16"), "Fcitx5 should render large CJK candidates with the best available locale-aware kiosk font");
  assert(kioskSession.includes("fcitx5 -d --replace"), "kiosk session should start Fcitx5 before Chromium");
  assert(kioskSession.includes("TIKPAL_KIOSK_RESET_WEB_MODE_ON_START") && kioskSession.includes('"$SCRIPT_DIR/tikpal-web-mode.sh" close-full'), "kiosk session should fully clear stale Explore windows before launching the main kiosk");
  assert(
    kioskSession.includes("publish_x_session_generation")
      && kioskSession.includes("kiosk-x-session-generation")
      && kioskSession.includes('mv -f "$temporary_path" "$TIKPAL_KIOSK_X_SESSION_GENERATION_PATH"')
      && kioskSession.lastIndexOf("publish_x_session_generation\n") < kioskSession.indexOf("run_x_command xset"),
    "kiosk session should atomically publish an independent X-session generation before any X command"
  );
  assert(
    !webModeScript.includes("schedule_provider_pool_refill_after_close")
      && !webModeScript.includes("TIKPAL_WEB_MODE_CLOSE_REFILL_PROVIDER_POOL_ENABLED"),
    "Explore close should defer incomplete pool warmup until a later Explore open instead of refilling in Ambient"
  );
  assert(
    kioskLauncher.includes("TIKPAL_WEB_MODE_BOOT_PREWARM_ENABLED:=1") &&
      kioskLauncher.includes("TIKPAL_WEB_MODE_BOOT_PREWARM_READY_TIMEOUT_SECONDS:=30") &&
      kioskLauncher.includes("kiosk_profile_has_visible_window()") &&
      kioskLauncher.includes("wait_for_kiosk_profile_window") &&
      kioskLauncher.includes('"$SCRIPT_DIR/tikpal-web-mode.sh" warm-pool'),
    "kiosk launcher should prewarm the resident Explore pool after two visible main-profile samples"
  );
  assert(webModeScript.includes("nohup \"$SCRIPT_DIR/tikpal-web-mode.sh\" guard"), "web mode should keep the window guard alive after the launcher exits");
  const prewarmWorkerStart = webModeScript.indexOf("launch_provider_prewarm_worker() {");
  const prewarmWorkerEnd = webModeScript.indexOf("\n}\n\n# After the main prewarm queue", prewarmWorkerStart);
  const prewarmWorkerBody = webModeScript.slice(prewarmWorkerStart, prewarmWorkerEnd);
  assert(
    prewarmWorkerBody.includes('launch_provider_for_pool "$provider" entry prewarm')
      && !prewarmWorkerBody.includes("wait_for_provider_ready")
      && webModeScript.includes('if provider_has_real_provider_page "$provider_port"; then')
      && webModeScript.includes("provider_prewarm_queue_is_complete()")
      && webModeScript.includes('write_runtime_prewarm_complete 1'),
    "prewarm should finish workers at real HTTPS pages"
  );
  assert(
    prewarmProviderGuardSource.includes('spawn(launcherPath, ["provider-status", providerId, normalizedStatus]')
      && webModeScript.includes('if provider_has_real_provider_page "$(provider_debug_port "$provider_id")"; then'),
    "guard status promotion must require a real HTTPS page without blocking on full DOM readiness"
  );
  assert(
    serverSource.includes('prewarmComplete: raw.prewarmComplete === true')
      && ambientScreenSource.includes("isExplorePrewarmComplete(webModeState)")
      && sourceStatusSource.includes('status === "ready"')
      && sourceStatusSource.includes('status === "check_setup"'),
    "the source picker must wait until the queue reaches real pages or terminal provider states"
  );
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
  assert(audioAdaptScript.includes('TIKPAL_AUDIO_CARD_PRIORITY:=}'), "audio adapter should leave card priority empty until a deployment explicitly supplies one");
  assert(!audioAdaptScript.includes("TIKPAL_AUDIO_CARD_PRIORITY:=BT66,Crimson"), "audio adapter should not pin a browser output to historical card ids");
  assert(audioAdaptScript.includes("TIKPAL_AUDIO_PREFER_SINGLE_USB") && audioAdaptScript.includes("single-usb"), "audio adapter should prefer one unknown USB playback endpoint");
  assert(audioAdaptScript.includes("single-non-hdmi") && audioAdaptScript.includes("ambiguous non-HDMI playback endpoints detected"), "audio adapter should accept one non-HDMI endpoint and reject ambiguous endpoints");
  assert(audioAdaptScript.includes("resolve-browser") && audioAdaptScript.includes("resolve-audioout") && audioAdaptScript.includes("resolve-hw"), "audio adapter should expose browser, moOde, and raw hardware PCM resolvers");
  assert(audioAdaptScript.includes("write_browser_output_config") && audioAdaptScript.includes("TIKPAL_AUDIO_BROWSER_SHARED_PCM"), "audio adapter should generate a shared conversion PCM for S24-only browser outputs");
  assert(audioAdaptScript.includes("TIKPAL_ALSA_RATE_CONVERTER") && alsaLoopbackScript.includes("TIKPAL_ALSA_RATE_CONVERTER"), "browser and _audioout plug nodes should share the optional ALSA rate converter");
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
  assert(webModeScript.includes("TIKPAL_WEB_MODE_QQ_AUDIO_PRIME:=1") && webModeScript.includes('TIKPAL_WEB_MODE_QQ_AUDIO_PRIME="$TIKPAL_WEB_MODE_QQ_AUDIO_PRIME"'), "web mode should enable and pass QQ Music audio prime by default");
  assert(webModeScript.includes("TIKPAL_WEB_MODE_QQ_MUSIC_AUTO_PLAY:=0") && webModeScript.includes('TIKPAL_WEB_MODE_QQ_MUSIC_AUTO_PLAY="$TIKPAL_WEB_MODE_QQ_MUSIC_AUTO_PLAY"'), "web mode should keep QQ Music one-shot auto play opt-in while passing the device setting to the provider guard");
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
  assert(
    appSource.includes("const fontTheme = preferences.fontTheme")
      && appSource.includes("onFontThemeChange={setFontTheme}")
      && !appSource.includes("readInitialFontTheme")
      && !appSource.includes("updatePreferences({ fontTheme })"),
    "App should consume the shared font preference instead of owning a second startup font state"
  );
  assert(
    i18nSource.includes("readStoredFontTheme")
      && i18nSource.includes("useLayoutEffect(() => {")
      && i18nSource.includes("document.documentElement.dataset.fontTheme = preferences.fontTheme")
      && i18nSource.includes("setFontTheme: (theme: FontTheme) => Promise<UiPreferences>")
      && i18nSource.includes("const setFontTheme = useCallback(async"),
    "shared preferences should restore the cached font and apply it before the first visible kiosk frame"
  );
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
  assert(
    webModeScript.includes('flock -E 75 -o -x -w "$TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS"'),
    "web mode should bound its switch lock and keep its descriptor out of background children"
  );
  assert(
    webModeScript.includes('TIKPAL_WEB_MODE_X11_SEARCH_TIMEOUT_SECONDS:-0.35'),
    "resident window discovery should have a sub-second budget so a stalled X11 search cannot hold the switch lock"
  );
  assert(webModeScript.includes("9>&- &"), "web mode background children should not inherit the provider switch lock");
  assert(
    webModeScript.indexOf('export DBUS_SESSION_BUS_ADDRESS="$session_bus"') < webModeScript.indexOf('systemd-run --user --quiet --unit=tikpal-onboard'),
    "web mode should bind Onboard to the existing user DBus session before launch"
  );
  assert(webModeScript.includes('systemd-run --user --quiet --unit=tikpal-onboard'), "web mode should keep Onboard outside the API launcher process tree");
  assert(webModeScript.includes('systemctl --user start tikpal-onboard.service'), "web mode should reuse the resident Onboard user service");
  assert(webModeScript.includes('timeout "$timeout_seconds" gdbus call'), "web mode should retry Onboard DBus calls while its service starts");
  assert(webModeScript.includes("Onboard.Keyboard.$method"), "web mode should share Onboard DBus Show and Hide calls");
  assert(webModeScript.includes("call_onboard_method Show"), "web mode should keep DBus Show as a fallback when xdotool map is not enough");
  assert(webModeScript.includes("call_onboard_method Hide"), "web mode should hide Onboard without terminating it");
  assert(
    webModeScript.includes("onboard_running() {")
      && webModeScript.includes('pgrep -u "$(id -u)" -f -- "$onboard_bin"')
      && !webModeScript.includes('pgrep -u "$(id -u)" -x onboard'),
    "Onboard lifecycle should recognize Gentoo's Python console-script process by its installed executable"
  );
  assert(!webModeScript.includes("windowunmap"), "web mode should not unmap Onboard because that terminates the resident process");
  assert(webModeScript.includes("Class: InputOnly"), "web mode should ignore Onboard's transparent input-only helper window");
  assert(webModeScript.includes('getwindowname "$window"'), "web mode should ignore Onboard's cold-start placeholder window");
  assert(webModeScript.includes("xdotool_safe windowraise"), "web mode should time-bound and raise Onboard above Chromium without relying on a window manager");
  assert(!webModeScript.slice(webModeScript.indexOf("keyboard)"), webModeScript.indexOf("proxy)")).includes("check_runtime"), "keyboard actions should skip the full Explore runtime check for responsive input");
  assert(!webModeScript.slice(webModeScript.indexOf("keyboard)"), webModeScript.indexOf("proxy)")).includes("with_web_mode_lock"), "keyboard actions should not wait for Explore provider switch locks");
  assert(!webModeScript.slice(webModeScript.indexOf("keyboard)"), webModeScript.indexOf("proxy)")).includes("resolve_web_mode_audio_devices"), "keyboard actions should not run Explore audio auto-detection");
  assert(webModeScript.includes("with_onboard_lock()"), "keyboard actions should use a dedicated Onboard lock instead of the provider switch lock");
  assert(webModeScript.includes("onboard_visible_windows"), "web mode should detect whether Onboard is already visible");
  assert(webModeScript.includes("xdotool_safe windowfocus"), "web mode should keep a time-bounded browser focus helper for fallback paths");
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
  assert(webModeScript.includes("pids+=(\"$pid\")") && webModeScript.includes('kill -KILL "$pid"'), "provider guard shutdown should force-kill stale guards without waiting one second per resident provider");
  assert(webModeScript.includes("TIKPAL_TILE_WINDOW_CHANGED=0"), "web mode guard should track whether a Chromium window actually needed retile");
  assert(webModeScript.includes("guard_root_stack_order()") && webModeScript.includes("xwininfo -root -children"), "web mode guard should inspect root-child stacking before planning a repair");
  assert(!webModeScript.includes("stack_refresh_ticks"), "web mode guard should not periodically rewrite correct stacking state");
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
      openProviderBody.indexOf("ensure_side_panel") < openProviderBody.indexOf("begin_provider_switch_transition"),
    "web mode should show the right provider panel before starting the provider switch"
  );
  assert(openProviderBody.includes('ensure_side_panel "$provider"'), "initial Explore should tell the side panel which provider is opening");
  assert(
    !openProviderBody.includes('ensure_background_veil "$provider"')
      && webModeScript.includes("prepare_entry_surfaces()")
      && webModeScript.includes('ensure_side_panel "$provider" 0'),
    "initial Explore should prepare the final-position side panel without creating a provider-switch background"
  );
  assert(openProviderBody.includes('begin_provider_switch_transition "$current_profile" "$provider"'), "provider switches should use begin_provider_switch_transition to fade the current provider");
  assert(
    webModeScript.includes('result=legacy_selected reason=helper_mode_$TIKPAL_WEB_MODE_X11_HELPER_MODE')
      && webModeScript.includes("reason=legacy_reveal_failed")
      && webModeScript.includes("stage=$stage open_request_id=${TIKPAL_WEB_MODE_OPEN_REQUEST_ID:-legacy}")
      && webModeScript.includes("x_session_generation=${TIKPAL_WEB_MODE_OPEN_X_SESSION_GENERATION:-legacy}"),
    "Helper-disabled and legacy reveal paths should emit explicit request-correlated routing and failure reasons"
  );
  assert(webModeScript.includes("recover_or_cover_provider_failure()") && !webModeScript.match(/recover_or_cover_provider_failure\(\)[\s\S]*?launch_error_veil/), "provider failures should restore the previous provider or close Explore without an error veil");
  assert(webModeScript.includes("TIKPAL_WEB_MODE_PROXY_CONNECT_ERROR:=Proxy did not connect. Try again."), "proxy failures should use a short user-facing retry message");
  assert(webModeScript.includes('panel_url="$panel_url?opening=$opening_provider"'), "initial side panel URL should carry its pending provider");
  assert(
    webModeScript.includes("prepare_entry_surfaces()") &&
      webModeScript.includes('ensure_side_panel "$provider" 0') &&
      webModeScript.includes("park_prepared_entry_surfaces()") &&
      webModeScript.includes("prepare-entry)") &&
      webModeScript.includes("park-entry)"),
    "Explore should prepare and park its final-position side panel around the initial audio gate"
  );
  assert(
    serverSource.includes("prepareWebModeEntry(providerId, openRequestId, xSessionGeneration)") &&
      serverSource.includes("Promise.allSettled([") &&
      serverSource.indexOf("prepareWebModeEntry(providerId, openRequestId, xSessionGeneration)", serverSource.indexOf("async function applyWebModeAction")) <
        serverSource.indexOf('runWebModeCommand("open", providerId', serverSource.indexOf("async function applyWebModeAction")),
    "API should prepare entry surfaces alongside the initial audio release before opening a provider"
  );
  assert(
    serverSource.includes('logWebModeEntryStage("request_accepted"')
      && serverSource.includes("openStartedAt")
      && serverSource.includes("openXSessionGeneration")
      && serverSource.indexOf("openingProvider: providerId", serverSource.indexOf("async function applyWebModeAction")) <
        serverSource.indexOf("prepareWebModeEntry(providerId, openRequestId, xSessionGeneration)", serverSource.indexOf("async function applyWebModeAction")),
    "API should persist a correlated opening owner before initial entry preparation"
  );
  assert(openProviderBody.includes('launch_url="$url"') && !openProviderBody.includes('launch_url="$TIKPAL_WEB_MODE_TRANSITION_URL?provider=$provider"'), "extension-enabled providers should start directly on their provider page");
  assert(webModeScript.includes("provider_uses_direct_bootstrap()") && webModeScript.includes("deezer|qq_music|netease_music") && openProviderBody.includes('if [[ "$proxy_enabled" == "1" && -n "$proxy_url" ]]'), "command-line proxy switches should apply to all providers when proxy is enabled");
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

  const audiooutFixture = (name, source) => {
    const file = path.join(loopbackGuardDir, name);
    writeFileSync(file, source);
    return file;
  };
  const resolveAudiooutFixture = (file) => spawnSync(
    "sh",
    ["-c", ". ./deploy/moode/tikpal-alsa-loopback.sh; TIKPAL_ALSA_BASE_AUDIOOUT_CONFIG=\"$1\" tikpal_alsa_detect_playback_target", "sh", file],
    { cwd: ROOT, encoding: "utf8" }
  );
  const namedBt66Audioout = audiooutFixture(
    "asound-named-bt66.conf",
    'pcm.tikpal_bt66_dmix {\n  type dmix\n  slave.pcm "hw:CARD=BT66,DEV=0"\n}\npcm._audioout {\n  type plug\n  slave.pcm "tikpal_bt66_dmix"\n}\n'
  );
  const namedBt66Resolve = resolveAudiooutFixture(namedBt66Audioout);
  assert(namedBt66Resolve.status === 0 && namedBt66Resolve.stdout.trim() === "tikpal_bt66_dmix", `Loopback should follow the named _audioout target:\n${namedBt66Resolve.stdout}\n${namedBt66Resolve.stderr}`);

  const directPlughwAudioout = audiooutFixture(
    "asound-direct-plughw.conf",
    'pcm._audioout {\n  type plug\n  slave {\n    pcm "plughw:CARD=USB_DAC,DEV=0"\n  }\n}\n'
  );
  const directPlughwResolve = resolveAudiooutFixture(directPlughwAudioout);
  assert(directPlughwResolve.status === 0 && directPlughwResolve.stdout.trim() === "plughw:CARD=USB_DAC,DEV=0", `Loopback should accept a direct plughw _audioout target:\n${directPlughwResolve.stdout}\n${directPlughwResolve.stderr}`);

  const midFirstAudioout = audiooutFixture(
    "asound-mid-first.conf",
    'pcm.tikpal_bad { type plug slave.pcm "plughw:CARD=MID,DEV=0" }\npcm._audioout {\n  type plug\n  slave.pcm "hw:CARD=BT66,DEV=0"\n}\n'
  );
  const midFirstResolve = resolveAudiooutFixture(midFirstAudioout);
  assert(midFirstResolve.status === 0 && midFirstResolve.stdout.trim() === "hw:CARD=BT66,DEV=0", `Loopback must ignore unrelated MID definitions:\n${midFirstResolve.stdout}\n${midFirstResolve.stderr}`);

  const missingAudioout = audiooutFixture("asound-missing-audioout.conf", 'pcm.default { type null }\n');
  const missingAudiooutResolve = resolveAudiooutFixture(missingAudioout);
  assert(missingAudiooutResolve.status !== 0 && missingAudiooutResolve.stdout.trim() === "", "Loopback should refuse to guess a card when _audioout is missing");

  const hdmiAudioout = audiooutFixture("asound-hdmi.conf", 'pcm._audioout {\n  type plug\n  slave.pcm "default:vc4hdmi0"\n}\n');
  const hdmiAudiooutResolve = resolveAudiooutFixture(hdmiAudioout);
  assert(hdmiAudiooutResolve.status === 0 && hdmiAudiooutResolve.stdout.trim() === "default:vc4hdmi0", "Loopback should preserve the configured HDMI route for the HDMI guard to reject");

  const legacyLoopbackConfig = audiooutFixture(
    "_sndaloop-legacy.conf",
    '#########################################\n# This file is managed by Tikpal for moOde ALSA Loopback\n#########################################\npcm.!_audioout {\n  type plug\n  slave.pcm "plughw:CARD=MID,DEV=MID],"\n}\n'
  );
  const legacyConfigTargets = spawnSync("sh", ["-c", ". ./deploy/moode/tikpal-alsa-loopback.sh; tikpal_alsa_config_targets \"$1\"", "sh", legacyLoopbackConfig], {
    cwd: ROOT,
    encoding: "utf8"
  });
  assert(legacyConfigTargets.stdout.includes("plughw:CARD=MID,DEV=MID],"), "legacy malformed loopback fixtures should remain detectable for safe migration");
  assert(alsaLoopbackScript.includes("/etc/tikpal/alsa-loopback.conf") && alsaLoopbackScript.includes("TIKPAL_ALSA_POSTLOAD_BEGIN"), "Loopback should use a postloaded Tikpal-owned configuration instead of a preloaded conf.d override");
  assert(!alsaLoopbackScript.includes("aplay -l 2>/dev/null | awk"), "Loopback must not fall back to the first non-HDMI card");
  assert(airplayEnableScript.includes("shairport_config_path()") && airplayEnableScript.includes("--property=ExecStart") && airplayEnableScript.includes("nqptp_unit_available()"), "AirPlay should discover the configured Shairport path and skip absent nqptp units");

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
  assert(!webModeCheck.stdout.includes("background page:"), "web mode should not report a background veil");
  assert(!webModeCheck.stdout.includes("transition page:"), "web mode should not report a transition veil");
  assert(!webModeCheck.stdout.includes("exit page:"), "web mode should not report a separate room-return exit page");
  assert(webModeCheck.stdout.includes("onboard: 500,420 900,280"), "web mode should place the full Onboard keyboard near provider login inputs");
  assert(webModeCheck.stdout.includes("onboard input focus: 1"), "web mode should enable input-focus keyboard activation");
  assert(webModeCheck.stdout.includes("qq scoped auto confirm: 1"), "web mode should keep QQ auto-confirm scoped inside the provider guard");
  assert(webModeCheck.stdout.includes("proxy: enabled http://127.0.0.1:7897"), "web mode should default to the HTTP development proxy");

  const configuredProxyUrl = "http://proxy-settings.test:16005";
  writeFileSync(
    path.join(webModeCheckDir, "settings.json"),
    JSON.stringify({ proxyEnabled: true, proxyUrl: configuredProxyUrl })
  );
  const configuredProxyCheck = spawnSync("bash", ["deploy/chromium/tikpal-web-mode.sh", "--check"], {
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
  assert(
    configuredProxyCheck.status === 0 && configuredProxyCheck.stdout.includes(`proxy: enabled ${configuredProxyUrl}`),
    `web mode should read the Chromium proxy URL from settings: ${configuredProxyCheck.stderr || configuredProxyCheck.stdout}`
  );
  const providerProxyArgumentWrites = webModeScript.match(/args\+=\("--proxy-server=[^"]+"\)/g) ?? [];
  assert(
    providerProxyArgumentWrites.length === 2 &&
      providerProxyArgumentWrites.every((write) => write === 'args+=("--proxy-server=$proxy_url")'),
    "pool and non-pool provider Chromium launches should use only the proxy URL read from settings"
  );
  assert(
    !/--proxy-server=(?!\$proxy_url)[^"'\s)]+/.test(webModeScript),
    "provider Chromium launch arguments should not hard-code a proxy endpoint"
  );

  const providerStatusStatePath = path.join(webModeCheckDir, "provider-status-state.json");
  const providerStatusEnv = {
    ...process.env,
    TIKPAL_KIOSK_SKIP_ENV_SOURCE: "1",
    TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT: "19334",
    TIKPAL_WEB_MODE_PROFILE_ROOT: path.join(webModeCheckDir, "provider-status-profiles"),
    TIKPAL_WEB_MODE_STATE_PATH: providerStatusStatePath
  };
  writeFileSync(providerStatusStatePath, JSON.stringify({
    activeProvider: "spotify",
    residentProviders: {
      spotify: { status: "active", lastError: null },
      amazon_music: { status: "prewarming", lastError: null }
    }
  }));
  const inactiveReady = spawnSync("bash", ["deploy/chromium/tikpal-web-mode.sh", "provider-status", "amazon_music", "ready"], {
    cwd: ROOT,
    env: providerStatusEnv,
    encoding: "utf8"
  });
  assert(inactiveReady.status === 0, `inactive provider ready update failed:\n${inactiveReady.stdout}\n${inactiveReady.stderr}`);
  let providerStatusState = JSON.parse(readFileSync(providerStatusStatePath, "utf8"));
  assert(
    providerStatusState.residentProviders.amazon_music?.status === "prewarming" &&
      providerStatusState.residentProviders.spotify?.status === "active",
    "the locked provider-status action should keep an inactive card prewarming without a real HTTPS page"
  );
  providerStatusState.activeProvider = "amazon_music";
  providerStatusState.residentProviders.amazon_music.status = "active";
  writeFileSync(providerStatusStatePath, JSON.stringify(providerStatusState));
  const staleReady = spawnSync("bash", ["deploy/chromium/tikpal-web-mode.sh", "provider-status", "amazon_music", "ready"], {
    cwd: ROOT,
    env: providerStatusEnv,
    encoding: "utf8"
  });
  assert(staleReady.status === 0, `stale ready update failed:\n${staleReady.stdout}\n${staleReady.stderr}`);
  providerStatusState = JSON.parse(readFileSync(providerStatusStatePath, "utf8"));
  assert(providerStatusState.residentProviders.amazon_music?.status === "active", "a late ready update must not demote the active provider");
  providerStatusState.activeProvider = "spotify";
  providerStatusState.residentProviders.amazon_music.status = "ready";
  writeFileSync(providerStatusStatePath, JSON.stringify(providerStatusState));
  const staleActive = spawnSync("bash", ["deploy/chromium/tikpal-web-mode.sh", "provider-status", "amazon_music", "active"], {
    cwd: ROOT,
    env: providerStatusEnv,
    encoding: "utf8"
  });
  assert(staleActive.status === 0, `stale active update failed:\n${staleActive.stdout}\n${staleActive.stderr}`);
  providerStatusState = JSON.parse(readFileSync(providerStatusStatePath, "utf8"));
  assert(providerStatusState.residentProviders.amazon_music?.status === "ready", "a stale active guard must not claim the active provider or demote a confirmed Ready card");
  providerStatusState.activeProvider = "suno";
  providerStatusState.residentProviders.suno = { status: "active", activity: "active", lastError: null };
  writeFileSync(providerStatusStatePath, JSON.stringify(providerStatusState));
  const proxyFailure = spawnSync("bash", ["deploy/chromium/tikpal-web-mode.sh", "provider-status", "suno", "check_proxy", "Suno proxy unavailable"], {
    cwd: ROOT,
    env: providerStatusEnv,
    encoding: "utf8"
  });
  assert(proxyFailure.status === 0, `proxy failure status update failed:\n${proxyFailure.stdout}\n${proxyFailure.stderr}`);
  providerStatusState = JSON.parse(readFileSync(providerStatusStatePath, "utf8"));
  assert(
    providerStatusState.activeProvider === "suno" &&
      providerStatusState.residentProviders.suno?.status === "check_proxy" &&
      providerStatusState.residentProviders.suno?.activity === "active" &&
      providerStatusState.residentProviders.suno?.lastError === "Suno proxy unavailable",
    "a selected proxy failure should retain the visible provider while publishing Check Proxy instead of Active"
  );
  providerStatusState.activeProvider = "qq_music";
  providerStatusState.residentProviders.qq_music = { status: "active", activity: "active", lastError: null };
  writeFileSync(providerStatusStatePath, JSON.stringify(providerStatusState));
  const directFailure = spawnSync("bash", ["deploy/chromium/tikpal-web-mode.sh", "provider-status", "qq_music", "check_setup", "QQ Music connection unavailable"], {
    cwd: ROOT,
    env: providerStatusEnv,
    encoding: "utf8"
  });
  assert(directFailure.status === 0, `direct failure status update failed:\n${directFailure.stdout}\n${directFailure.stderr}`);
  providerStatusState = JSON.parse(readFileSync(providerStatusStatePath, "utf8"));
  assert(
    providerStatusState.activeProvider === "qq_music" &&
      providerStatusState.residentProviders.qq_music?.status === "check_setup" &&
      providerStatusState.residentProviders.qq_music?.lastError === "QQ Music connection unavailable",
    "a QQ direct failure should remain direct and never be reported as a proxy failure"
  );

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
  assert(providerGuardCheck.stdout.includes("spotify schedule fixtures: 1"), "provider guard should verify Spotify inactive, staged-active, reset, reuse, refresh, and non-Spotify scheduling fixtures");
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
  assert(providerGuardCheck.stdout.includes("qq start playback popup: 1"), "provider guard should enable the QQ start-playback popup handler");
  assert(providerGuardCheck.stdout.includes("qq reminder cancel: 1"), "provider guard should cancel the scoped QQ reminder dialog");
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
  assert(providerGuardSource.includes("if (frozen) {\n    await readTargets();\n    syncManagerFriendlyErrorStatus();\n    return;\n  }"), "frozen providers should still report Manager-owned friendly errors");
  assert(providerGuardSource.includes('child.once("exit", (code) => {\n    if (code !== 0) reportedManagerFriendlyError = "";\n  });'), "friendly-error status reporting should retry after a transient launcher failure");
  assert(providerGuardSource.includes("querySelectorAll(\"iframe\")"), "provider guard should scan same-origin QQ modal iframes");
  assert(providerGuardSource.includes("consentAcceptAllLabels"), "provider guard should keep accept-all cookie labels separate from generic consent labels");
  assert(providerGuardSource.includes("rejectActionText"), "provider guard should skip cookie preference, reject, and settings actions");
  assert(providerGuardSource.includes("safeDismissPromptExpression"), "provider guard should keep safe prompt dismiss handling separate from consent acceptance");
  assert(providerGuardSource.includes("spotify") && providerGuardSource.includes("cookieContextText"), "provider guard should close Spotify cookie policy prompts only from cookie context");
  assert(providerGuardSource.includes("trialContextText") && providerGuardSource.includes("dangerousActionText"), "provider guard should require trial context and block dangerous trial actions");
  const trialActionPattern = providerGuardSource.match(/const trialActionText = \/(.*?)\/i;/)?.[1] ?? "";
  const trialActionText = new RegExp(trialActionPattern, "i");
  assert(
    ["Try it free", "Try for free", "Start a trial", "免费试用", "開通"].every((label) => trialActionText.test(label))
      && providerGuardSource.includes("if (trialActionText.test(actionLabel)) continue;"),
    "provider guard should never click trial or subscription action labels even when their prompt has a Close affordance"
  );
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
  assert(providerGuardSource.includes("TIKPAL_WEB_MODE_QQ_AUDIO_PRIME") && providerGuardSource.includes("runQqAudioPrimeFeatures") && providerGuardSource.includes("qqAudioPrimeCooldownMs"), "provider guard should gently prime QQ Music audio when QQ is active and already playing");
  assert(providerGuardSource.includes("TIKPAL_WEB_MODE_QQ_MUSIC_AUTO_PLAY") && providerGuardSource.includes("runQqMusicAutoPlayFeatures") && providerGuardSource.includes("qqMusicAutoPlayMaxAttempts"), "provider guard should one-shot start a paused QQ Music player queue");
  assert(providerGuardSource.includes("stalled-global-play") && providerGuardSource.includes("listPlayButtons[0] || play") && providerGuardSource.includes("recentPlaybackResource"), "QQ Music one-shot start should prefer a real queue row when the global player shows a false playing state");
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
  assert(providerGuardSource.includes("qqReminderCancelExpression"), "QQ reminder cancellation should remain separate from client-prompt replay");
  assert(providerGuardSource.includes("qqStartPlaybackExpression"), "QQ start-playback handling should remain separate from generic prompt confirmation");
  assert(providerGuardSource.includes('textOf(element) === "开始播放"'), "QQ start-playback handling should click only the exact Start Playback action");
  assert(providerGuardSource.includes('qqStartPlaybackExpression, "foreground"'), "QQ start-playback handling should bypass Manager maintenance throttling without becoming replayable");
  const safePromptFeaturesOffset = providerGuardSource.indexOf("async function runSafePromptFeatures");
  assert(
    providerGuardSource.indexOf("qqStartPlaybackExpression", safePromptFeaturesOffset) < providerGuardSource.indexOf("qqReminderCancelExpression", safePromptFeaturesOffset),
    "QQ start-playback handling should run before reminder cancellation"
  );
  assert(providerGuardSource.includes('text.includes("QQ音乐提醒您")'), "QQ reminder cancellation should stay scoped to the actual reminder dialog");
  assert(providerGuardSource.includes('textOf(element) === "取消"'), "QQ reminder cancellation should click only Cancel");
  assert(providerGuardSource.includes('!text.includes("下载客户端体验更多内容")'), "QQ login-required prompt should stay visible for user login");
  assert(providerGuardSource.includes(".yqq-dialog-close"), "QQ client prompt handling should use the explicit close control");
  assert(webModeScript.includes('args+=("--disable-hang-monitor")'), "provider Chromium should not block Explore return on a page-unresponsive dialog");
  assert(webModeScript.includes('pkill -KILL -f -- "--user-data-dir=$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/"'), "Explore close should force-exit an unresponsive provider after the grace period");
  assert(webModeScript.includes('provider_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"'), "Explore should keep a stable per-provider Chromium profile for login state");
  assert(!webModeScript.includes('rm -rf "$provider_profile"'), "Explore provider switches should not delete the provider login profile");
  assert(webModeScript.includes('refresh_extension_script_cache "$provider_profile"') && webModeScript.includes("Default/Service Worker") && webModeScript.includes("service_worker_registration_info"), "Explore provider launch should refresh stale extension service-worker state without deleting login state");
  assert(webModeScript.includes("seed_profile_widevine_cdm()") && webModeScript.includes("libwidevinecdm.so"), "Explore should repair empty provider Widevine CDM directories without deleting login state");
  assert((webModeScript.match(/seed_profile_widevine_cdm "\$provider_profile"/g) || []).length >= 2, "Explore pool and direct provider launch paths should seed Widevine before Chromium starts");
  const launchProviderForPoolStart = webModeScript.indexOf("launch_provider_for_pool() {");
  const launchProviderForPoolEnd = webModeScript.indexOf("\n}\n\nprovider_prewarm_max_concurrent_launches()", launchProviderForPoolStart);
  const launchProviderForPoolBody = webModeScript.slice(launchProviderForPoolStart, launchProviderForPoolEnd);
  assert(launchProviderForPoolBody.indexOf('start_provider_guard "$provider" "$provider_profile" "$url" "$proxy_enabled" "$provider_port"') < launchProviderForPoolBody.indexOf('if ! wait_for_provider_ready "$provider_port" "$provider"; then'), "provider guard should start before the ready gate so cookie prompts can be accepted during entry");

  assert(webModeErrorPage.includes("did not respond"), "friendly Explore error page should avoid native Chromium error copy");
  assert(webModeErrorPage.includes("region_unavailable") && webModeErrorPage.includes("regionTail") && webModeErrorPage.includes("regionBody"), "friendly Explore error page should explain regional unavailability and point to a supported Proxy exit");
  assert(webModeErrorPage.includes("Change Proxy in Settings") && !webModeErrorPage.includes("Proxy switch") && !webModeErrorPage.includes("右侧切换代理"), "friendly Explore error page should point users to Settings instead of a side-panel proxy switch");
  assert(!webModeErrorPage.includes("sendKioskHeartbeat"), "friendly Explore error page should not post kiosk heartbeats");
  const logoAssetPattern = /\/assets\/tikpal-scene-logo\.png/g;
  assert(webModeBackgroundPage.includes("/assets/tikpal-scene-logo.png") && webModeBackgroundPage.includes("Tikpal Explore Background"), "Explore background page should show a branded logo surface");
  assert((webModeBackgroundPage.match(logoAssetPattern) ?? []).length === 1, "Explore background page should render one Tikpal logo layer");
  assert(!webModeBackgroundPage.includes("sendKioskHeartbeat"), "Explore background page should not post kiosk heartbeats");
  assert(webModeBackgroundPage.includes("logo-floor"), "Explore background page should keep a hidden logo-floor anchor for consistent markup");
  assert(!webModeBackgroundPage.includes("signal-rail"), "Explore background page should not draw signal rails");
  assert(!webModeBackgroundPage.includes("border-left"), "Explore background page should not draw a left vertical rail");
  assert(!webModeBackgroundPage.includes("repeating-linear-gradient"), "Explore background page should not draw repeated vertical texture lines");
  assert(!webModeBackgroundPage.includes("radial-gradient"), "Explore background page should avoid radial glow decoration");
  assert(webModeScript.includes("background_windows") && webModeScript.includes('TIKPAL_WEB_MODE_STAGE_POSITION') && webModeScript.includes("windowlower"), "Explore window guard should park the branded background offscreen while an active provider is visible");
  assert(!webModeScript.includes("ensure_entry_stage_veil") && !webModeScript.includes("close_entry_stage_veil"), "Explore initial entry should not retain the removed full-width branded veil");
  assert(webModeScript.includes("prepare_entry_surfaces()") && webModeScript.includes('ensure_side_panel "$provider" 0'), "Explore should prepare the final-position side panel before initial entry");
  assert(webModeScript.includes("TIKPAL_WEB_MODE_ENTRY_PROVIDER_PAINT_TIMEOUT_SECONDS") && webModeScript.includes("wait_for_entry_provider_paint"), "Explore initial entry should wait for the selected provider to paint or the short paint gate to expire");
  assert(
    webModeScript.includes("provider_resume_ms=$provider_resume_ms")
      && webModeScript.includes("target_resolve_ms=$target_resolve_ms")
      && webModeScript.includes("initial_entry_paint_check")
      && webModeScript.includes("initial_entry_reveal_completed"),
    "Explore initial entry should log frozen-page resume, target resolution, paint gate, and final X11 reveal timings"
  );
  assert(webModeScript.indexOf('wait_for_entry_provider_paint "$(provider_debug_port "$provider")" "$provider"') < webModeScript.indexOf('reveal_initial_entry_surfaces "$target_window"'), "Explore should wait for initial provider paint before revealing the provider and side panel");
  assert(
    webModeScript.includes("initial_entry_surface_plan()")
      && webModeScript.includes("initial_entry_step_started")
      && webModeScript.includes("initial_entry_step_completed")
      && webModeScript.includes("initial_entry_step_failed")
      && webModeScript.includes("initial_entry_aborted"),
    "Explore initial entry should emit a request-correlated result for every explicit X11 step"
  );
  const initialEntryPlanStart = webModeScript.indexOf("initial_entry_surface_plan() {");
  const initialEntryPlanEnd = webModeScript.indexOf("\n}\n\nreveal_initial_entry_surfaces()", initialEntryPlanStart);
  const initialEntryPlanBody = webModeScript.slice(initialEntryPlanStart, initialEntryPlanEnd);
  const initialEntryPrepareStart = webModeScript.indexOf("initial_entry_prepare_context() {");
  const initialEntryPrepareEnd = webModeScript.indexOf("\n}\n\ninitial_entry_pre_reveal_step()", initialEntryPrepareStart);
  const initialEntryPrepareBody = webModeScript.slice(initialEntryPrepareStart, initialEntryPrepareEnd);
  assert(
    initialEntryPrepareBody.includes("initial_entry_trace_require_writable")
      && initialEntryPlanBody.indexOf("initial_entry_prepare_context") < initialEntryPlanBody.indexOf("initial_entry_require_step 2")
      && initialEntryPlanBody.indexOf("initial_entry_verify_final_surfaces") < initialEntryPlanBody.indexOf("write_physical_reveal_stamp"),
    "Explore initial entry should fail trace preflight before X11 mutation and stamp only after final surface verification"
  );
  assert(
    webModeScript.includes("initial_entry_inspect_surfaces()")
      && webModeScript.includes('TIKPAL_WEB_MODE_X11_HELPER_RESPONSE_TIMEOUT_MS=450')
      && webModeScript.includes('.readOnly == true')
      && webModeScript.includes("initial_entry_reassert_surface_from_inspect")
      && webModeScript.includes("read_profile_window_cache_raw \"$panel_profile\"")
      && webModeScript.includes("initial_entry_expected_geometry()")
      && webModeScript.includes('if ((mutated)); then'),
    "Explore initial entry should use the bounded read-only Helper inspect before falling back to legacy X11 probes"
  );
  assert(
    initialEntryFixture.includes("Xvfb")
      && initialEntryFixture.includes("destroy_after_validation")
      && initialEntryFixture.includes("trace_loss")
      && initialEntryFixture.includes("target_move_fail")
      && initialEntryFixture.includes("target_resize_fail")
      && initialEntryFixture.includes("final_geometry_mismatch")
      && initialEntryFixture.includes("run_pool_pre_reveal")
      && initialEntryFixture.includes("proxy_settings_fail")
      && initialEntryFixture.includes("guard_stop_fail")
      && initialEntryFixture.includes("pre_reveal_trace_loss"),
    "the initial-entry fixture should inject real X11 destruction, pre-reveal proxy and Guard failures, final mismatch, and trace-loss cleanup"
  );
  assert(
    webModeScript.includes('if ! wait_for_provider_page_or_friendly_error "$provider_port"; then')
      && webModeScript.includes('write_provider_friendly_error_status "$provider" "$provider_port" && return 0'),
    "every foreground provider launch should confirm a real HTTPS page or an explicit local Tikpal failure page before it can reveal"
  );
  assert(!webModeScript.includes("TIKPAL_WEB_MODE_EXIT_"), "Explore close should not create a separate room-return veil");
  assert(webModeScript.includes("close_legacy_exit_stage") && !webModeScript.includes("ensure_exit_room_veil"), "Explore close should remove any legacy exit-stage window without creating one");
  assert(
    !webModeScript.includes("TIKPAL_WEB_MODE_CLOSE_OVERLAY_URL:=") &&
      !webModeScript.includes("TIKPAL_WEB_MODE_CLOSE_OVERLAY_POSITION:=") &&
      !webModeScript.match(/park_web_mode_surfaces_for_reopen\(\)[\s\S]*?launch_close_overlay_veil/),
    "Explore close should not configure or launch a close overlay"
  );
  assert(
    webModeScript.includes("close-overlay-veil.pid")
      && webModeScript.includes('close_overlay_process_matches "$_orphan_pid"')
      && !webModeScript.includes("launch_close_overlay_veil()"),
    "Explore may clean a legacy close-overlay PID but must not restore the removed veil launcher"
  );
  assert(serverSource.includes("await runWebModeCloseInBackground(closeRequestId, activeProvider)"), "Explore close should return only after its physical close transaction succeeds");
  assert(webModeScript.includes("TIKPAL_WEB_MODE_CLOSE_REQUEST_ID") && serverSource.includes("TIKPAL_WEB_MODE_CLOSE_REQUEST_ID: closeRequestId"), "Explore close should pass a close request id into the shell transaction");
  assert(webModeScript.includes("runtime_open_request_is_current") && serverSource.includes("TIKPAL_WEB_MODE_OPEN_EXPECTED_ACTIVE_PROVIDER: providerId"), "a delayed resident open should stop when Close owns the runtime state");
  assert(webModeScript.includes("TIKPAL_WEB_MODE_CLOSE_ACTIVE_PROVIDER") && webModeScript.includes('park_web_mode_surfaces_for_reopen "$active_provider"'), "Explore warm close should park the active provider before scanning resident providers");
  assert(serverSource.includes("webModeClosePromise") && serverSource.includes("webModeCloseRequestIsCurrent") && serverSource.includes("throw new Error(closeError)"), "Explore close should suppress duplicate transactions, preserve a newer owner, and return parking failures");
  assert(!serverSource.includes("activeProvider: null,\n      residentProviders: {},\n      lastError: null,\n      closeRequestId"), "Explore close should preserve resident provider state while clearing the visible active provider");
  assert(webModeScript.includes("TIKPAL_WEB_MODE_CLOSE_WARM_ENABLED:=1") && webModeScript.includes("TIKPAL_WEB_MODE_CLOSE_KEEP_RESIDENT:=1") && webModeScript.includes("TIKPAL_WEB_MODE_CLOSE_WARM_TTL_SECONDS:=45"), "Explore close should default to a resident warm pool for instant reopen");
  assert(!webModeScript.includes("schedule_provider_pool_refill_after_close"), "Explore close should not start provider pool refill after visual exit");
  assert(webModeScript.includes("close_web_mode_warm()") && webModeScript.includes("park_side_panel_for_reopen") && webModeScript.includes("park_provider_windows_for_reopen"), "Explore warm close should park the side panel and providers offscreen instead of cold-closing them");
  const surfaceEnumerationBody = webModeScript.match(/web_mode_surface_windows_on_screen\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  const processTreeBody = webModeScript.match(/process_tree_uses_profile\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  const parkAllSurfacesStart = webModeScript.indexOf("park_web_mode_surfaces_for_reopen() {");
  const parkAllSurfacesBody = webModeScript.slice(parkAllSurfacesStart, webModeScript.indexOf("\n}\n\nweb_mode_surface_kind_for_pid()", parkAllSurfacesStart));
  assert(
    surfaceEnumerationBody.includes("visible_chromium_windows")
      && surfaceEnumerationBody.includes("web_mode_surface_kind_for_pid")
      && processTreeBody.includes('"$depth" -lt 8'),
    "Explore close should enumerate every visible Chromium surface and trace window PIDs through multiple ancestor levels"
  );
  assert(
    parkAllSurfacesBody.includes("surfaces+=(\"$surface\")")
      && parkAllSurfacesBody.indexOf('set_window_opacity "$window" 0') < parkAllSurfacesBody.indexOf('tile_window_fast "$window"')
      && parkAllSurfacesBody.includes("web_mode_surface_windows_on_screen | grep -q ."),
    "Explore close should hide the complete snapshot before parallel parking and reject any on-screen residual"
  );
  const warmCloseStart = webModeScript.indexOf("close_web_mode_warm() {");
  const warmCloseEnd = webModeScript.indexOf("\n}\n\nclose_web_mode()", warmCloseStart);
  const warmCloseBody = webModeScript.slice(warmCloseStart, warmCloseEnd);
  assert(
    warmCloseBody.includes('park_web_mode_surfaces_for_reopen "$active_provider"') &&
      !warmCloseBody.includes("exit-stage") &&
      !warmCloseBody.includes("veil"),
    "Explore warm close should directly park provider and panel surfaces without a full-screen exit stage"
  );
  const fullCloseStart = webModeScript.indexOf("close_web_mode_full() {");
  const fullCloseEnd = webModeScript.indexOf("\n}\n\nclose_web_mode_warm()", fullCloseStart);
  const fullCloseBody = webModeScript.slice(fullCloseStart, fullCloseEnd);
  assert(
    fullCloseBody.indexOf("close_legacy_exit_stage") < fullCloseBody.indexOf("close_provider_windows &")
      && !fullCloseBody.includes("ensure_exit_room_veil"),
    "Explore full close should clear any legacy exit stage before shutting down visible surfaces"
  );
  const closeAudioGateStart = webModeScript.indexOf("mute_active_provider_for_close() {");
  const closeAudioGateEnd = webModeScript.indexOf("\n}\n\nactivate_target_provider_audio_gate", closeAudioGateStart);
  const closeAudioGateBody = webModeScript.slice(closeAudioGateStart, closeAudioGateEnd);
  assert(
    closeAudioGateBody.includes('pause_provider_media_via_cdp "$(provider_debug_port "$provider")" "" foreground 1')
      && closeAudioGateBody.includes("close_audio_gate provider=$provider result=inactive")
      && closeAudioGateBody.includes("close_audio_gate provider=$provider result=failed"),
    "Explore close should foreground-deactivate the active provider audio gate and log either result"
  );
  assert(
    warmCloseBody.includes('mute_active_provider_for_close "$active_provider"')
      && warmCloseBody.indexOf('mute_active_provider_for_close "$active_provider"') < warmCloseBody.indexOf('park_web_mode_surfaces_for_reopen "$active_provider"')
      && warmCloseBody.includes("stop_provider_pool_prewarm")
      && !warmCloseBody.includes("schedule_provider_pool_refill_after_close"),
    "Explore warm close should mute before parking, stop in-flight prewarm, and avoid Ambient pool refill"
  );
  assert(
    warmCloseBody.includes("runtime_close_request_is_current") &&
      warmCloseBody.indexOf("runtime_close_request_is_current") < warmCloseBody.indexOf("park_web_mode_surfaces_for_reopen") &&
      warmCloseBody.indexOf("park_web_mode_surfaces_for_reopen") < warmCloseBody.lastIndexOf("runtime_close_request_is_current") &&
      warmCloseBody.lastIndexOf("runtime_close_request_is_current") < warmCloseBody.indexOf('write_runtime_provider_state ""'),
    "Explore stale warm close should not park or clear a provider after a newer open starts"
  );
  assert(warmCloseBody.includes("sync_runtime_provider_pool_process_statuses"), "Explore warm close should sync resident provider statuses from surviving profile processes");
  const syncProviderStatusBody = webModeScript.slice(webModeScript.indexOf("sync_runtime_provider_pool_process_statuses() {"), webModeScript.indexOf("\n}\n\nstop_window_guard()", webModeScript.indexOf("sync_runtime_provider_pool_process_statuses() {")));
  assert(
    webModeScript.includes("provider_has_real_provider_page()") &&
      syncProviderStatusBody.includes("provider_has_real_provider_page") &&
      syncProviderStatusBody.includes('"check_setup"'),
    "Explore resident status sync should only mark real provider pages ready and downgrade stale bootstrap pages"
  );
  const parkSurfacesBody = webModeScript.slice(webModeScript.indexOf("park_web_mode_surfaces_for_reopen() {"), webModeScript.indexOf("\n}\n\nclose_web_mode_process_surfaces()", webModeScript.indexOf("park_web_mode_surfaces_for_reopen() {")));
  assert(
    !parkSurfacesBody.includes("launch_close_overlay_veil") &&
      !parkSurfacesBody.includes("wait_for_close_overlay_fade") &&
      !parkSurfacesBody.includes("close_close_overlay_veil") &&
      parkSurfacesBody.includes("surfaces+=(\"$surface\")") &&
      parkSurfacesBody.includes('set_window_opacity "$window" 0') &&
      parkSurfacesBody.includes('tile_window_fast "$window"') &&
      parkSurfacesBody.includes("park_pids") &&
      parkSurfacesBody.includes("web_mode_surface_windows_on_screen | grep -q ."),
    "Explore warm close should hide every provider and panel surface before parking them concurrently and reject residuals"
  );
  assert(
    fullCloseBody.includes("close_provider_windows &") &&
      fullCloseBody.includes("close_side_panel &") &&
      !fullCloseBody.includes("launch_close_overlay_veil") &&
      !fullCloseBody.includes("wait_for_close_overlay_fade"),
    "Explore full close should tear down both columns in parallel without a close overlay"
  );
  const parkLeftStart = webModeScript.indexOf("park_left_web_mode_surfaces_for_reopen() {");
  const parkLeftEnd = webModeScript.indexOf("\n}\n\npark_web_mode_surfaces_for_reopen()", parkLeftStart);
  const parkLeftBody = webModeScript.slice(parkLeftStart, parkLeftEnd);
  assert(
    parkLeftBody.includes('park_provider_windows_for_reopen "$active_provider"') &&
      !parkLeftBody.includes("raise_entry_stage_veil"),
    "Explore warm exit should park provider surfaces"
  );
  assert(webModeScript.includes("close_web_mode_process_surfaces()") && webModeScript.includes("close_provider_windows &") && webModeScript.includes("close_side_panel &"), "Explore full close should close provider and side-panel surfaces in parallel");
  assert(webModeScript.includes("cleanup-warm") && webModeScript.includes("cleanup_warm_web_mode") && webModeScript.includes("close-full"), "Explore should keep delayed/full cleanup as an explicit maintenance path");
  assert(webModeScript.includes("TIKPAL_WEB_MODE_CLOSE_AUDIO_GATE_SETTLE_SECONDS") && webModeScript.includes('if ! is_enabled "$TIKPAL_WEB_MODE_CLOSE_KEEP_RESIDENT"; then') && webModeScript.includes("stop_provider_guard"), "Explore warm close should keep provider guards alive in resident mode and only stop them for non-resident cleanup");
  assert(webModeScript.includes("TIKPAL_WEB_MODE_PROVIDER_IDLE_POOL_ENABLED:=1") && webModeScript.includes("warm_provider_pool()") && webModeScript.includes("TIKPAL_WEB_MODE_IDLE_POOL_WARMUP=1"), "Explore should support boot-time idle prewarming of provider windows");
  assert(
    webModeScript.includes("TIKPAL_WEB_MODE_PROVIDER_PREWARM_MAX_CONCURRENT_LAUNCHES:=3") &&
      webModeScript.includes("provider_prewarm_max_concurrent_launches()") &&
      webModeScript.includes("run_provider_prewarm_queue()") &&
      webModeScript.includes('while [[ "${#worker_pids[@]}" -ge "$maximum" ]]') &&
      webModeScript.includes('sleep "$delay"'),
    "Explore prewarm should use the shared bounded-concurrency queue with a stagger"
  );
  assert(webModeScript.includes("TIKPAL_WEB_MODE_PROVIDER_PREWARM_CONTINUE_AFTER_CLOSE:=0") && webModeScript.includes('log "provider prewarm paused because Explore closed"'), "Explore provider prewarm should stop when visible Explore closes");
  assert(webModeScript.includes('log "idle provider pool warmup paused because Explore is active"'), "Explore idle provider pool refill should stop if Explore reopens");
  assert(webModeScript.includes("warm-pool)") && webModeScript.includes("warm_provider_pool") && !webModeScript.includes("with_web_mode_lock warm_provider_pool"), "Explore boot prewarm should not hold the foreground web-mode lock");
  assert(
    webModeScript.includes("provider_state_lock_path()") &&
      webModeScript.includes("with_provider_state_lock") &&
      webModeScript.includes("write_runtime_provider_state_unlocked") &&
      webModeScript.includes("write_runtime_provider_status_unlocked") &&
      webModeScript.includes("seed_runtime_provider_pool_statuses_unlocked"),
    "concurrent prewarm workers should serialize provider runtime-state read-modify-write operations"
  );
  const startProviderPoolPrewarmBody = webModeScript.slice(webModeScript.indexOf("start_provider_pool_prewarm() {"), webModeScript.indexOf("\n}\n\nwarm_provider_pool()", webModeScript.indexOf("start_provider_pool_prewarm() {")));
  assert(
    startProviderPoolPrewarmBody.includes('! provider_pool_needs_prewarm "$active_provider"') &&
      startProviderPoolPrewarmBody.includes('sync_runtime_provider_pool_process_statuses "$active_provider"'),
    "Explore should refresh provider ready statuses even when all resident profiles are already running"
  );
  const proxyRetryStart = webModeScript.indexOf("retry_provider_proxy_friendly_error_for_foreground() {");
  const proxyRetryEnd = webModeScript.indexOf("\n}\n\ncrossfade_helper()", proxyRetryStart);
  const proxyRetryBody = webModeScript.slice(proxyRetryStart, proxyRetryEnd);
  const checkProxyOpenProviderPoolStart = webModeScript.indexOf("open_provider_pool() {");
  const checkProxyOpenProviderPoolEnd = webModeScript.indexOf("\n}\n\nopen_provider()", checkProxyOpenProviderPoolStart);
  const checkProxyOpenProviderPoolBody = webModeScript.slice(checkProxyOpenProviderPoolStart, checkProxyOpenProviderPoolEnd);
  assert(
    webModeScript.includes("provider_proxy_reachable() {")
      && webModeScript.includes('curl --proxy "$proxy_url"')
      && webModeScript.includes('navigate_provider_target_foreground() {')
      && webModeScript.includes('provider_cdp_command "$provider_port" Page.navigate "$params_json" \'\' \'\' foreground 1'),
    "Explore should recheck a provider route through the configured proxy and use the hot foreground CDP session for its single retry navigation"
  );
  assert(
    proxyRetryBody.includes('write_runtime_provider_status "$provider" "prewarming"')
      && proxyRetryBody.includes('wait_for_provider_page_or_friendly_error "$provider_port"')
      && proxyRetryBody.includes('wait_for_provider_ready "$provider_port" "$provider"')
      && proxyRetryBody.includes('case "$(read_runtime_provider_status "$provider")" in')
      && proxyRetryBody.includes('ready|active) ;;')
      && proxyRetryBody.includes('proxy_retry provider=$provider result=ready')
      && proxyRetryBody.includes('proxy_retry provider=$provider result=unreachable')
      && proxyRetryBody.includes('restore_provider_proxy_friendly_error'),
    "a recovered proxy card should wait for a real ready page while failed retries restore the friendly check_proxy page with bounded diagnostics"
  );
  assert(
    checkProxyOpenProviderPoolBody.includes('resident_status="$(read_runtime_provider_status "$provider")"')
      && checkProxyOpenProviderPoolBody.includes('friendly_error_reason="$(provider_friendly_error_reason "$provider_port")"')
      && checkProxyOpenProviderPoolBody.includes('friendly_error_reason" != "region_unavailable"')
      && checkProxyOpenProviderPoolBody.includes('! provider_prefers_direct_proxy "$provider"')
      && checkProxyOpenProviderPoolBody.includes('retry_provider_proxy_friendly_error_for_foreground "$provider"')
      && checkProxyOpenProviderPoolBody.indexOf('retry_provider_proxy_friendly_error_for_foreground "$provider"') < checkProxyOpenProviderPoolBody.indexOf('begin_provider_switch_guard')
      && checkProxyOpenProviderPoolBody.includes('recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_proxy" "$message"'),
    "only an explicitly selected proxy-friendly error should retry before switch ownership; a failed retry must retain a different current provider"
  );
  assert(webModeScript.includes("provider_friendly_error_reason()") && webModeScript.includes('friendly_error_reason="$(provider_friendly_error_reason "$provider_port")"'), "Explore prewarm should preserve an explicit region-unavailable page instead of misclassifying it as setup failure");
  assert(webModeScript.includes("wait_for_provider_page_or_friendly_error") && webModeScript.includes("write_provider_friendly_error_status"), "Explore should reveal a friendly terminal page without relabeling it as a successful provider page");
  assert(webModeScript.includes("fs.renameSync(temporaryPath, statePath)"), "Explore runtime-state writes should atomically replace the state file");
  const providerStatusWriterStart = providerGuardSource.indexOf("function writeResidentProviderStatus(status)");
  const providerStatusWriterEnd = providerGuardSource.indexOf("\n}\n\nfunction syncResidentProviderStatus", providerStatusWriterStart);
  const providerStatusWriter = providerGuardSource.slice(providerStatusWriterStart, providerStatusWriterEnd);
  assert(
    providerStatusWriter.includes('spawn(launcherPath, ["provider-status", providerId, normalizedStatus]') &&
      !providerStatusWriter.includes("writeFileSync") &&
      webModeScript.includes("provider-status)"),
    "provider guards should promote real pages through the launcher's locked provider-status action"
  );
  assert(
    webModeScript.includes('state.activeProvider === provider && (status === "active" || status === "ready")'),
    "a late ready update must retain active provider ownership under the provider-state lock"
  );
  assert(
    webModeScript.includes("sync-status)") &&
      webModeScript.includes("|sync-status|"),
    "Explore should expose an explicit resident status sync command for live recovery"
  );
  assert(
    webModeScript.includes("TIKPAL_WEB_MODE_X11_SYNC_WINDOW_OPS:=0")
      && webModeScript.includes('wmctrl_mutation geometry "$window"')
      && webModeScript.includes('windowmove "$window" "$x" "$y"'),
    "Explore hot window moves should default to traced async X11 operations instead of xdotool --sync"
  );
  assert(
    webModeScript.includes("x11_mutation_run() {")
      && webModeScript.includes('\\"writer_pid\\"')
      && webModeScript.includes('\\"writer_role\\"')
      && webModeScript.includes('\\"registry_generation\\"')
      && webModeScript.includes('\\"observed_geometry_after\\"')
      && webModeScript.includes("x11_trace_control_event helper_switch_finished")
      && webModeScript.includes("x11_trace_control_event helper_revoke_finished")
      && webModeScript.includes("x11_trace_control_event guard_registry_published")
      && webModeScript.includes("x11_helper_legacy_writer_may_write")
      && webModeScript.includes("reason=stale_generation")
      && webModeScript.includes("guard_generation_refreshed")
      && webModeScript.includes("mutation=skipped"),
    "Explore X11 writers should share one opt-in lifecycle trace across Shell, Guard, and Helper control events"
  );
  const x11TraceControlEventStart = webModeScript.indexOf("x11_trace_control_event() {");
  const x11TraceControlEventEnd = webModeScript.indexOf("\n}\n\nswitch_trace_enabled()", x11TraceControlEventStart);
  const x11TraceControlEventBody = webModeScript.slice(x11TraceControlEventStart, x11TraceControlEventEnd);
  assert(
    x11TraceControlEventBody.includes('observed_geometry="not_sampled_control"') &&
      !x11TraceControlEventBody.includes("x11_trace_observed_geometries"),
    "Explore control trace should not synchronously sample X11 geometry on the foreground path"
  );
  const tracedRunWindowGuardStart = webModeScript.indexOf("run_window_guard() {");
  const tracedRunWindowGuardEnd = webModeScript.indexOf("\n}\n\nstart_provider_guard()", tracedRunWindowGuardStart);
  const tracedRunWindowGuardBody = webModeScript.slice(tracedRunWindowGuardStart, tracedRunWindowGuardEnd);
  assert(
    tracedRunWindowGuardBody.includes("x11_trace_control_event guard_started 0"),
    "Explore no-click readiness should have a deterministic low-overhead window Guard startup event"
  );
  assert(
    webModeScript.includes("guard_inspect_windows() {") &&
      webModeScript.includes("guard_root_stack_order() {") &&
      webModeScript.includes("guard_apply_repair_plan() {") &&
      webModeScript.includes('x11_trace_control_event guard_tick_completed "$status"') &&
      webModeScript.includes("repair_required=$TIKPAL_GUARD_REPAIR_REQUIRED") &&
      webModeScript.includes("mutation_count=$TIKPAL_GUARD_MUTATION_COUNT"),
    "Explore window Guard should complete one inspect-plan-apply tick with a deterministic mutation count"
  );
  assert(
    !tracedRunWindowGuardBody.includes("stack_refresh_ticks") &&
      !tracedRunWindowGuardBody.includes("force_raise=1"),
    "Explore window Guard should inspect real stacking state instead of periodically forcing five legacy writes"
  );
  const veilOpenPoolStart = webModeScript.indexOf("open_provider_pool() {");
  const veilOpenPoolEnd = webModeScript.indexOf("\n}\n\nopen_provider()", veilOpenPoolStart);
  const veilOpenPoolBody = webModeScript.slice(veilOpenPoolStart, veilOpenPoolEnd);
  assert(
    (veilOpenPoolBody.match(/begin_provider_switch_transition "\$current_profile" "\$provider"/g) ?? []).length === 1 &&
      veilOpenPoolBody.includes("transition_shown_ms"),
    "resident switches should use one begin_provider_switch_transition call"
  );
  const tileVisibleWindowsBody = webModeScript.slice(webModeScript.indexOf("tile_visible_web_mode_windows() {"), webModeScript.indexOf("\n}\n\nstart_window_guard()", webModeScript.indexOf("tile_visible_web_mode_windows() {")));
  assert(
    webModeScript.includes("is_oauth_window_title()") &&
      tileVisibleWindowsBody.includes("oauth_provider_window") &&
      tileVisibleWindowsBody.includes('raise_window_without_focus "$preferred_provider_window"'),
    "Explore window guard should keep an OAuth window above its provider page instead of cycling both windows"
  );
  const beginTransitionStart = webModeScript.indexOf("begin_provider_switch_transition() {");
  const beginTransitionEnd = webModeScript.indexOf("\n}\n\nrecover_or_cover_provider_failure()", beginTransitionStart);
  const beginTransitionBody = webModeScript.slice(beginTransitionStart, beginTransitionEnd);
  assert(
      webModeScript.includes("TIKPAL_WEB_MODE_RESIDENT_SWITCH_SETTLE_SECONDS:=0.16") &&
      webModeScript.includes("TIKPAL_WEB_MODE_RESIDENT_SWITCH_PAINT_TIMEOUT_SECONDS:=0.6") &&
      veilOpenPoolBody.includes("begin_provider_switch_transition") &&
      beginTransitionBody.includes("fade_profile_window_for_provider_switch"),
    "Explore should fade the current provider during switch transition"
  );
  const commitVisibleProviderStateStart = webModeScript.indexOf("commit_visible_provider_state() {");
  const commitVisibleProviderStateEnd = webModeScript.indexOf("\n}\n\nall_chromium_windows()", commitVisibleProviderStateStart);
  const commitVisibleProviderStateBody = webModeScript.slice(commitVisibleProviderStateStart, commitVisibleProviderStateEnd);
  assert(
    webModeScript.includes("park_pointer_in_side_panel_async()")
      && commitVisibleProviderStateBody.includes("park_pointer_in_side_panel_async")
      && commitVisibleProviderStateBody.includes('write_runtime_provider_state "$provider"')
      && commitVisibleProviderStateBody.indexOf('write_runtime_provider_state "$provider"') < commitVisibleProviderStateBody.indexOf("park_pointer_in_side_panel_async"),
    "Explore should commit the physically visible provider before parking the pointer outside the critical path"
  );
  const stopProviderGuardBody = webModeScript.match(/stop_provider_guard\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert(!stopProviderGuardBody.includes("waited=0"), "Explore close should not wait one second per provider guard");
  assert(webModeScript.includes('ensure_side_panel "$provider" 0') && webModeScript.includes('tile_window_fast "$panel_window" "$TIKPAL_WEB_MODE_PANEL_POSITION"'), "Explore initial entry should place the side panel at its final geometry");
  assert(webModeScript.includes("reveal_initial_entry_surfaces") && webModeScript.includes("TIKPAL_WEB_MODE_ENTRY_REVEAL_SETTLE_SECONDS"), "Explore initial entry should reveal provider and side panel together after a short paint settle");
  assert(!webModeScript.includes("start_entry_stage_guard") && !webModeScript.includes("fade_entry_stage_veil"), "Explore should remove stale entry-veil guards and dissolves");
  const guardCloseBody = webModeScript.match(/close_web_mode_from_guard\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert(
    guardCloseBody.includes('is_enabled "$TIKPAL_WEB_MODE_CLOSE_KEEP_RESIDENT"') &&
      guardCloseBody.includes('park_web_mode_surfaces_for_reopen ""') &&
      guardCloseBody.includes("close_web_mode_full"),
    "Explore window guard should use the same concurrent-cover flow for resident and full closes"
  );
  assert(
    guardCloseBody.includes("close_legacy_exit_stage") &&
      !guardCloseBody.includes("ensure_exit_room_veil"),
    "Explore resident window-guard close should remove any stale legacy stage without showing a new one"
  );
  const revealResidentStart = webModeScript.indexOf("reveal_resident_provider_surfaces() {");
  const revealResidentEnd = webModeScript.indexOf("\n}\n\nlaunch_provider_for_pool()", revealResidentStart);
  const revealResidentBody = webModeScript.slice(revealResidentStart, revealResidentEnd);
  const revealResidentWindowStart = webModeScript.indexOf("reveal_resident_provider_window() {");
  const revealResidentWindowEnd = webModeScript.indexOf("\n}\n\nreassert_visible_provider_surfaces()", revealResidentWindowStart);
  const revealResidentWindowBody = webModeScript.slice(revealResidentWindowStart, revealResidentWindowEnd);
  const residentFastPathStart = revealResidentWindowBody.indexOf(
    'if [[ "$resident_page_ready" == "1" && -n "$provider_port" ]]; then',
    revealResidentWindowBody.lastIndexOf('TIKPAL_WEB_MODE_TRUSTED_PROVIDER_PAGE_PORT="$provider_port"')
  );
  const residentFastPathEnd = revealResidentWindowBody.indexOf("\n    return 0", residentFastPathStart);
  const residentFastPathBody = revealResidentWindowBody.slice(residentFastPathStart, residentFastPathEnd);
  const residentFallbackBody = revealResidentWindowBody.slice(residentFastPathEnd);
  const parkProfileWindowStart = webModeScript.indexOf("park_profile_windows_for_reopen() {");
  const parkProfileWindowEnd = webModeScript.indexOf("\n}\n\npark_side_panel_for_reopen()", parkProfileWindowStart);
  const parkProfileWindowBody = webModeScript.slice(parkProfileWindowStart, parkProfileWindowEnd);
  assert(
    residentFastPathBody.indexOf('tile_window_fast "$target_window"')
        < residentFastPathBody.indexOf('mark_window_above "$target_window"')
      && residentFastPathBody.indexOf('mark_window_above "$target_window"')
        < residentFastPathBody.indexOf('raise_window "$target_window"')
      && residentFastPathBody.includes('tile_window_fast "$previous_window" "$TIKPAL_WEB_MODE_STAGE_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"')
      && residentFastPathBody.includes('wait_for_window_position "$previous_window" "$TIKPAL_WEB_MODE_STAGE_POSITION"')
      && residentFallbackBody.indexOf("wait_for_provider_window_nonblank_x11_frame")
        < residentFallbackBody.indexOf('park_profile_windows_for_reopen "$previous_profile"')
      && residentFallbackBody.indexOf('park_profile_windows_for_reopen "$previous_profile"')
        < residentFallbackBody.lastIndexOf('raise_window "$target_window"')
      && parkProfileWindowBody.indexOf('set_window_opacity "$window" 0')
        < parkProfileWindowBody.indexOf('tile_window_fast "$window"'),
    "Explore resident reveal should tile before raise and park the known previous provider without re-running the Close helper"
  );
  const openProviderPoolStart = webModeScript.indexOf("open_provider_pool() {");
  const openProviderPoolEnd = webModeScript.indexOf("\n}\n\nopen_provider()", openProviderPoolStart);
  const openProviderPoolBody = webModeScript.slice(openProviderPoolStart, openProviderPoolEnd);
  const failedResidentRevealStart = openProviderPoolBody.indexOf('result=failed reason=resident_reveal_failed');
  const failedResidentRevealBody = openProviderPoolBody.slice(failedResidentRevealStart);
  const openProviderPoolInitBody = openProviderPoolBody.slice(0, openProviderPoolBody.indexOf('log_stage "open_pool_init'));
  const xdotoolProbeStart = webModeScript.indexOf("xdotool_probe() {");
  const xdotoolProbeEnd = webModeScript.indexOf("\n}\n\n# Cache hits", xdotoolProbeStart);
  const xdotoolProbeBody = webModeScript.slice(xdotoolProbeStart, xdotoolProbeEnd);
  const firstWindowForProfileStart = webModeScript.indexOf("first_window_for_profile() {");
  const firstWindowForProfileEnd = webModeScript.indexOf("\n}\n\nprofile_window_cache_path()", firstWindowForProfileStart);
  const firstWindowForProfileBody = webModeScript.slice(firstWindowForProfileStart, firstWindowForProfileEnd);
  const findWindowForPidStart = webModeScript.indexOf("find_window_for_pid() {");
  const findWindowForPidEnd = webModeScript.indexOf("\n}\n\nprovider_profile_for_pid()", findWindowForPidStart);
  const findWindowForPidBody = webModeScript.slice(findWindowForPidStart, findWindowForPidEnd);
  const writeGuardWindowListStart = webModeScript.indexOf("write_guard_window_list() {");
  const writeGuardWindowListEnd = webModeScript.indexOf("\n}\n\ntile_guard_windows_fast()", writeGuardWindowListStart);
  const writeGuardWindowListBody = webModeScript.slice(writeGuardWindowListStart, writeGuardWindowListEnd);
  const recoverGuardWindowListStart = webModeScript.indexOf("recover_guard_window_list_locked() {");
  const recoverGuardWindowListEnd = webModeScript.indexOf("\n}\n\nstart_window_guard()", recoverGuardWindowListStart);
  const recoverGuardWindowListBody = webModeScript.slice(recoverGuardWindowListStart, recoverGuardWindowListEnd);
  const guardMaintainWindowsStart = webModeScript.indexOf("guard_maintain_windows() {");
  const guardMaintainWindowsEnd = webModeScript.indexOf("\n}\n\nguard_close_web_mode()", guardMaintainWindowsStart);
  const guardMaintainWindowsBody = webModeScript.slice(guardMaintainWindowsStart, guardMaintainWindowsEnd);
  const runWindowGuardStart = webModeScript.indexOf("run_window_guard() {");
  const runWindowGuardEnd = webModeScript.indexOf("\n}\n\nstart_provider_guard()", runWindowGuardStart);
  const runWindowGuardBody = webModeScript.slice(runWindowGuardStart, runWindowGuardEnd);
  assert(
    xdotoolProbeBody.includes('timeout "$timeout_seconds" xdotool "$@"')
      && !xdotoolProbeBody.includes("|| true")
      && firstWindowForProfileBody.includes('validate_profile_window_fast "$cached_window" "$profile"')
      && firstWindowForProfileBody.includes('find_window_for_pid "$pid"')
      && findWindowForPidBody.includes("TIKPAL_WEB_MODE_X11_SEARCH_TIMEOUT_SECONDS=2")
      && findWindowForPidBody.includes('[[ "$best_area" -gt 100000 ]] && break')
      && !firstWindowForProfileBody.includes("cached_chromium_windows"),
    "Explore cached windows should preserve X11 failures, validate profile ownership, and stop target-PID discovery after finding a usable app window"
  );
  assert(
    openProviderPoolInitBody.includes('target_window="$(first_window_for_profile "$provider_profile" "$segment_timing_once" target || true)"')
      && !openProviderPoolInitBody.includes('profile_process_exists "$provider_profile"')
      && !openProviderPoolInitBody.includes('profile_process_exists "$current_profile"'),
    "resident hot-switch initialization should use validated window IDs before any target-profile process scan"
  );
  assert(
    writeGuardWindowListBody.includes('temporary_path="$list_path.$$.$RANDOM.tmp"')
      && writeGuardWindowListBody.includes('mv -f "$temporary_path" "$list_path"')
      && writeGuardWindowListBody.includes('kiosk_window="$(kiosk_browser_window || true)"')
      && writeGuardWindowListBody.includes("printf 'kiosk\\t%s\\t%s\\n'")
      && runWindowGuardBody.includes("guard_run_tick")
      && !runWindowGuardBody.includes("tile_visible_web_mode_windows")
      && !runWindowGuardBody.includes("visible_chromium_windows")
      && !runWindowGuardBody.includes("side_panel_window_visible")
      && guardMaintainWindowsBody.includes("x11_helper_guard_may_write")
      && guardMaintainWindowsBody.includes("tile_guard_windows_fast")
      && guardMaintainWindowsBody.includes("TIKPAL_GUARD_RECOVERY_REQUIRED")
      && webModeScript.includes("TIKPAL_GUARD_TICK_OUTCOME=inspect_failed")
      && guardMaintainWindowsBody.includes("recover_guard_window_list")
      && recoverGuardWindowListBody.includes('visible_chromium_windows > "$recovery_window_list"')
      && (recoverGuardWindowListBody.match(/x11_helper_guard_may_recover_all/g) || []).length >= 2
      && recoverGuardWindowListBody.includes('tile_visible_web_mode_windows "$provider_profile" "$panel_profile" 1 "$recovery_window_list"')
      && recoverGuardWindowListBody.includes("TIKPAL_WEB_MODE_GUARD_LOCKED=1"),
    "Explore guard should atomically use exact IDs and require locked, twice-checked all-surface ownership for recovery"
  );
  const keepPanelStart = webModeScript.indexOf("keep_side_panel_visible_during_switch() {");
  const keepPanelEnd = webModeScript.indexOf("\n}\n\nprepare_entry_surfaces()", keepPanelStart);
  const keepPanelBody = webModeScript.slice(keepPanelStart, keepPanelEnd);
  assert(
    keepPanelBody.includes('before_geometry="$(window_geometry_compact "$panel_window" || printf unreadable)"')
      && keepPanelBody.includes('[[ "$before_geometry" == "$expected_geometry" ]]')
      && keepPanelBody.includes("panel_mutation=skipped")
      && keepPanelBody.includes('restore_window_opacity "$panel_window"')
      && keepPanelBody.includes('tile_window_fast "$panel_window" "$TIKPAL_WEB_MODE_PANEL_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW"')
      && keepPanelBody.includes('mark_window_above "$panel_window"')
      && keepPanelBody.includes('raise_window_without_focus "$panel_window"')
      && !keepPanelBody.includes("TIKPAL_WEB_MODE_STAGE_POSITION")
      && !keepPanelBody.includes("close_side_panel"),
    "provider switches should keep the existing side panel opaque, in its right-column geometry, and never park or restart it"
  );
  assert(
    runWindowGuardBody.indexOf('if provider_switch_in_progress; then') >= 0
      && runWindowGuardBody.indexOf('if provider_switch_in_progress; then') < runWindowGuardBody.indexOf('guard_run_tick')
      && openProviderPoolBody.indexOf('guard_stop_ms=0') < openProviderPoolBody.indexOf('keep_side_panel_visible_during_switch "$provider"')
      && openProviderPoolBody.includes('previous_window="$(read_guard_window provider "$current_profile" || true)"')
      && openProviderPoolBody.includes('read_guard_window panel "$panel_profile"')
      && [...openProviderPoolBody.matchAll(/keep_side_panel_visible_during_switch "\$provider"/g)].length === 1
      && openProviderPoolBody.includes('if [[ "$switching_provider" != "1" ]] && ! ensure_side_panel "$provider" 0; then')
      && !residentFastPathBody.includes("panel_window"),
    "provider switching should orchestrate the side panel exactly once and must not fall back to side-panel setup"
  );
  assert(
    openProviderPoolBody.includes('pause_provider_media_via_cdp "$(provider_debug_port "$current_provider")"')
      && openProviderPoolBody.includes("previous_audio_gate_deactivated")
      && !openProviderPoolBody.includes('( pause_provider_media_via_cdp "$(provider_debug_port "$current_provider")" "$cdp_json_list"'),
    "resident switching should pause the old provider through its own CDP port and target list without blocking the reveal"
  );
  const residentRevealIndex = openProviderPoolBody.indexOf('reveal_resident_provider_surfaces "$target_window"');
  const residentHotRevealIndex = openProviderPoolBody.indexOf('reveal_resident_provider_window "$target_window"');
  const poolTransitionIndexes = [...openProviderPoolBody.matchAll(/begin_provider_switch_transition "\$current_profile" "\$provider"/g)].map((match) => match.index);
  assert(
    poolTransitionIndexes.length === 1 &&
      poolTransitionIndexes[0] < residentHotRevealIndex &&
      poolTransitionIndexes[0] < residentRevealIndex &&
      openProviderPoolBody.includes('if [[ "$switching_provider" == "1" ]]; then') &&
      openProviderPoolBody.includes("cdp_skip_fade=1"),
    "Explore provider switches should keep one reusable cold-transition path while fast residents skip its fade"
  );
  assert(
    !openProviderPoolBody.includes('[[ "$switching_provider" == "1" || "$entry_stage" == "1" ]]') &&
      openProviderPoolBody.includes('if [[ "$switching_provider" == "1" ]]; then'),
    "Explore initial entry should skip the switch transition because no provider is visible yet"
  );
  assert(
    poolTransitionIndexes[0] < openProviderPoolBody.indexOf("stop_provider_pool_prewarm") &&
      openProviderPoolBody.indexOf("stop_provider_pool_prewarm") < residentHotRevealIndex &&
      openProviderPoolBody.indexOf("stop_provider_pool_prewarm") < residentRevealIndex,
    "a foreground provider choice should cover the old page before it cancels prewarm, then reveal only after cleanup"
  );
  assert(
      openProviderPoolBody.includes("begin_provider_switch_guard") &&
      openProviderPoolBody.indexOf("begin_provider_switch_guard") < openProviderPoolBody.indexOf("stop_provider_pool_prewarm") &&
      openProviderPoolBody.indexOf('begin_provider_switch_transition "$current_profile" "$provider"') < openProviderPoolBody.indexOf("stop_provider_pool_prewarm") &&
      openProviderPoolBody.indexOf("guard_stop_ms=0") < openProviderPoolBody.indexOf("stop_provider_pool_prewarm") &&
      runWindowGuardBody.includes("if provider_switch_in_progress; then"),
    "Explore should pause the old Guard before cancelling prewarm, so neither it nor a slow worker exposes the old page"
  );
  assert(
    !openProviderBody.includes('if [[ "$switching_provider" == "1" ]] || ! provider_uses_direct_bootstrap "$provider"; then') &&
      openProviderBody.includes('if [[ "$switching_provider" == "1" ]]; then'),
    "non-pooled initial entry should also skip the switch transition"
  );
  assert(
    !openProviderPoolBody.includes("switch_cover") &&
      !webModeScript.includes("provider_needs_switch_cover()"),
    "Explore should not retain a Deezer-only switch-cover path"
  );
  const directTransitionIndex = openProviderBody.indexOf('begin_provider_switch_transition "$current_profile" "$provider"');
  const directRevealIndex = openProviderBody.indexOf('reveal_resident_provider_window "$target_window" "$current_profile" "$provider_profile" "$transition_shown_ms" "$provider_port"');
  const directCrossfadeIndex = openProviderBody.indexOf('crossfade_helper fade "$current_audio_bus" "$target_audio_bus" "$TIKPAL_WEB_MODE_AUDIO_CROSSFADE_MS"');
  const directProviderCleanupIndex = openProviderBody.indexOf('close_other_provider_profiles "$provider_profile"');
  assert(
    directTransitionIndex >= 0 &&
      [...openProviderBody.matchAll(/begin_provider_switch_transition "\$current_profile" "\$provider"/g)].length === 1 &&
      directRevealIndex > directTransitionIndex &&
      directCrossfadeIndex >= 0 &&
      directProviderCleanupIndex > directCrossfadeIndex &&
      directRevealIndex < directCrossfadeIndex,
    "Explore direct provider switching should keep the reusable cover through target reveal and retain audio until crossfade finishes"
  );
  assert(
    openProviderPoolBody.includes('provider_has_real_provider_page "$provider_port"') &&
      openProviderPoolBody.includes('wait_for_real_provider_url "$provider_port"') &&
      openProviderPoolBody.indexOf('stop_provider_pool_prewarm') <
        openProviderPoolBody.indexOf('wait_for_real_provider_url "$provider_port"') &&
      openProviderPoolBody.includes('write_runtime_provider_status "$provider" "check_setup"'),
    "Explore hot provider switches should retry a bounded real-page check while the current provider remains visible"
  );
  assert(
    openProviderPoolBody.includes('[[ "$fast_resident" != "1" ]] && profile_process_exists "$provider_profile"') &&
      openProviderPoolBody.includes('target_window=""') &&
      openProviderPoolBody.includes('close_provider_profile "$provider_profile"'),
    "Explore should initialize an absent target window and restart a stale target profile instead of reusing a failed bootstrap window"
  );
  const recoverProviderFailureBody = webModeScript.match(/recover_or_cover_provider_failure\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert(
    recoverProviderFailureBody.includes('stop_provider_guard "$failed_provider"') &&
      recoverProviderFailureBody.includes('park_profile_windows_for_reopen "$failed_profile"') &&
      recoverProviderFailureBody.includes("clear_provider_switch_guard"),
    "Explore failure recovery should park a late failed target and clear its switch marker before restoring the previous provider"
  );
  const profileProcessExistsBody = webModeScript.match(/profile_process_exists\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert(
    profileProcessExistsBody.includes('pgrep -f -- "--user-data-dir=$profile"') &&
      webModeScript.includes("profile_command_line_matches()") &&
      profileProcessExistsBody.includes('[[ "$command_line" == "$TIKPAL_CHROMIUM_BIN"* ]]') &&
      profileProcessExistsBody.includes("A guard is invoked with the profile") &&
      profileProcessExistsBody.includes('readlink -f "/proc/$pid/exe"'),
    "resident profile liveness should ignore a launcher guard whose command line merely names the profile"
  );
  const clearProviderSwitchGuardBody = webModeScript.match(/clear_provider_switch_guard\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert(
    clearProviderSwitchGuardBody.includes('[[ "$pid" == "$BASHPID" ]]') &&
      clearProviderSwitchGuardBody.includes("return 0"),
    "a stale provider switch marker should never fail an otherwise successful open"
  );
  assert(
    openProviderPoolBody.includes('elif [[ "$fast_resident" != "1" ]]; then') &&
      openProviderPoolBody.includes('if ! wait_for_provider_ready "$(provider_debug_port "$provider")" "$provider"; then') &&
      openProviderPoolBody.includes('recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_setup" "$message"'),
    "Explore cold or non-resident switches should retain the current provider until the target paints or failure recovery runs"
  );
  const reconcileProviderPoolStart = webModeScript.indexOf("reconcile_provider_pool() {");
  const reconcileProviderPoolEnd = webModeScript.indexOf("\n}\n\nstop_window_guard()", reconcileProviderPoolStart);
  const reconcileProviderPoolBody = webModeScript.slice(reconcileProviderPoolStart, reconcileProviderPoolEnd);
  assert(
    !reconcileProviderPoolBody.includes("transition_veil") &&
      !reconcileProviderPoolBody.includes("background_veil"),
    "background reconcile must not create, park, or close a veil"
  );
  assert(
    reconcileProviderPoolBody.includes("provider_switch_in_progress")
      && !reconcileProviderPoolBody.includes("reassert_visible_provider_surfaces"),
    "background reconcile should not repeat foreground provider or panel geometry orchestration"
  );
  assert(
    residentHotRevealIndex >= 0 &&
      residentHotRevealIndex <
      openProviderPoolBody.indexOf('commit_visible_provider_state "$provider"') &&
      openProviderPoolBody.indexOf('commit_visible_provider_state "$provider"') <
        openProviderPoolBody.indexOf('reconcile_provider_pool_in_background "$provider"'),
    "Explore resident hot switches should reveal, park, and commit activeProvider before background reconcile"
  );
  assert(
    webModeScript.includes("restore_window_opacity") &&
      webModeScript.includes("window_opacity_is_full") &&
      revealResidentWindowBody.includes('if window_opacity_is_full "$opacity_before"; then') &&
      revealResidentWindowBody.includes("opacity_mutation=skipped") &&
      openProviderPoolBody.indexOf('reveal_resident_provider_window "$target_window"') <
        openProviderPoolBody.indexOf('log_open_stage surface_plan_end "provider=$provider result=revealed target_window=$target_window reveal_ms=$reveal_ms"') &&
      openProviderPoolBody.indexOf('log_open_stage surface_plan_end "provider=$provider result=revealed target_window=$target_window reveal_ms=$reveal_ms"') <
        openProviderPoolBody.indexOf('commit_visible_provider_state "$provider"'),
    "Explore should restore the parked provider opacity and commit activeProvider only after visual reveal"
  );
  assert(
    openProviderPoolBody.includes("reveal_ms=") &&
      openProviderPoolBody.includes("command_return_ms=") &&
      webModeScript.includes("reconcile_ms=") &&
      webModeScript.includes('setsid "$SCRIPT_DIR/tikpal-web-mode.sh" reconcile "$active_provider" "$started_ms"'),
    "Explore should report reveal, command-return, and detached reconcile timings"
  );
  assert(
    reconcileProviderPoolBody.includes('sync_runtime_provider_pool_process_statuses "$active_provider" 0') &&
      reconcileProviderPoolBody.includes('[[ "$(read_runtime_active_provider)" == "$active_provider" ]]') &&
      reconcileProviderPoolBody.includes("abandoned=1"),
    "Explore reconcile should abandon stale work without clearing a newer active provider"
  );
  const providerGuardIdentityBody = webModeScript.match(/provider_guard_process_identity_matches\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  const providerGuardMatchingPidsBody = webModeScript.match(/provider_guard_matching_pids\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  const stopProviderGuardInstancesBody = webModeScript.match(/stop_provider_guard_instances\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  const startProviderGuardBody = webModeScript.match(/start_provider_guard\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  const providerGuardProcessMatchesBody = webModeScript.match(/provider_guard_process_matches\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  const ensureProviderGuardBody = webModeScript.match(/ensure_provider_guard\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert(
    reconcileProviderPoolBody.includes('ensure_provider_guard "$active_provider"') &&
      !reconcileProviderPoolBody.includes('start_provider_guard "$active_provider"') &&
      providerGuardProcessMatchesBody.includes('provider_guard_pid_file "$provider"') &&
      providerGuardProcessMatchesBody.includes("provider_guard_process_identity_matches") &&
      providerGuardIdentityBody.includes("TIKPAL_WEB_MODE_PROC_ROOT:-/proc") &&
      providerGuardIdentityBody.includes('[[ "$argument" == "$helper" ]]') &&
      providerGuardIdentityBody.includes('TIKPAL_WEB_MODE_PROVIDER_ID=$provider') &&
      providerGuardIdentityBody.includes('TIKPAL_WEB_MODE_PROVIDER_PROFILE=$provider_profile') &&
      providerGuardIdentityBody.includes('TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT=$provider_port') &&
      providerGuardIdentityBody.includes('TIKPAL_WEB_MODE_PROXY_MODE=$proxy_mode') &&
      providerGuardMatchingPidsBody.includes('"$proc_root"/[1-9]*') &&
      providerGuardMatchingPidsBody.includes("provider_guard_process_identity_matches") &&
      stopProviderGuardInstancesBody.includes("provider_guard_matching_pids") &&
      stopProviderGuardInstancesBody.includes('kill -TERM "$pid"') &&
      stopProviderGuardInstancesBody.includes('kill -KILL "$pid"') &&
      startProviderGuardBody.includes('stop_provider_guard_instances "$provider" "$provider_profile" "$proxy_enabled" "$provider_port"') &&
      !providerGuardIdentityBody.includes("pgrep") &&
      ensureProviderGuardBody.includes('start_provider_guard "$provider"'),
    "Explore provider guard lifecycle should reuse an exact canonical process and remove all exact orphan instances before restart"
  );
  const applyWebModeActionIndex = serverSource.indexOf("async function applyWebModeAction");
  const webModeOpenCommandIndex = serverSource.indexOf('await runWebModeCommand("open", providerId, webModeOpenCommandEnv', applyWebModeActionIndex);
  const webModeActiveCommitIndex = serverSource.indexOf("commitWebModeOpenRequestIfOwned(providerId, openRequestId, xSessionGeneration)", webModeOpenCommandIndex);
  assert(
    webModeOpenCommandIndex >= 0 &&
      !serverSource.slice(webModeOpenCommandIndex - 320, webModeOpenCommandIndex).includes("activeProvider: providerId") &&
      webModeActiveCommitIndex > webModeOpenCommandIndex,
    "Explore entry should keep the provider inactive until the launcher has completed its initial reveal"
  );
  assert(
      serverSource.includes('previousRuntimeState.activeProvider ?? previousRuntimeState.lastProvider ?? "qq_music"')
      && serverSource.includes("lastProvider: runtimeState.lastProvider ?? activeProvider ?? null")
      && appSource.includes('sendWebModeAction({ type: "open", openRequestId: requestId })')
      && webModeScript.includes("if (state.activeProvider) state.lastProvider = state.activeProvider;"),
    "Ambient and Hi-Fi Explore reopen should retain the last successful provider after activeProvider clears on close"
  );
  assert(
    serverSource.includes('runWebModeCommand("open", providerId, webModeOpenCommandEnv')
      && serverSource.includes('TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS: "25"'),
    "Explore open should retain its correlated generation while waiting for an in-flight close transaction to release the web-mode lock"
  );
  assert(
    residentHotRevealIndex >= 0 &&
      poolTransitionIndexes[0] < residentHotRevealIndex,
    "Explore resident hot reveal should raise the reusable cover before exposing the target"
  );
  const revealResidentProviderWindowBody = webModeScript.slice(
    webModeScript.indexOf("reveal_resident_provider_window() {"),
    webModeScript.indexOf("\n}\n\nreassert_visible_provider_surfaces()", webModeScript.indexOf("reveal_resident_provider_window() {"))
  );
  assert(
    revealResidentProviderWindowBody.includes("runtime_geometry_verified helper_final_snapshot")
      && !revealResidentProviderWindowBody.includes("x11_helper_postcheck")
      && !webModeScript.includes("resident_switch_surfaces_at_geometry()"),
    "Helper success should use its checked final snapshot and leave the independent geometry postcheck to acceptance"
  );
  const segmentSummary = 'switch_segments provider=$provider cached_xid_ms=$cached_xid_ms first_cdp_ms=$first_cdp_ms guard_stop_ms=$guard_stop_ms panel_retile_ms=$panel_retile_ms target_opacity_ms=$target_opacity_ms combined_x11_ms=$combined_x11_ms';
  assert(
    webModeScript.includes('TIKPAL_WEB_MODE_SWITCH_SEGMENT_TIMING_ONCE_PATH') &&
      webModeScript.includes(segmentSummary) &&
      webModeScript.includes('switch_detail cache role=$timing_role') &&
      webModeScript.includes('attempt1_x11_ms=$attempt1_x11_ms') &&
      webModeScript.includes('attempt2_x11_ms=$attempt2_x11_ms') &&
      webModeScript.includes('switch_detail panel known=1') &&
      webModeScript.includes('geometry_read_ms=$geometry_read_ms mutation_ms=$mutation_ms') &&
      webModeScript.includes('switch_detail reveal target=$target_window') &&
      webModeScript.includes('opacity_read_ms=$opacity_read_ms') &&
      webModeScript.includes('combined_mutation_ms=$combined_x11_ms') &&
      webModeScript.includes('stamp_write_ms=$stamp_write_ms') &&
      revealResidentProviderWindowBody.indexOf('write_physical_reveal_stamp "$provider_profile" "$target_window" "$previous_window" "$physical_ms"') <
        revealResidentProviderWindowBody.indexOf('log_switch_segment_summary_once "$segment_timing_once"') &&
      webModeScript.includes('rm -f "$detail_path" "$TIKPAL_WEB_MODE_SWITCH_SEGMENT_TIMING_ONCE_PATH"'),
    "one-shot resident switch timing should report cache, panel, opacity, grouped X11, stamp, and coarse segments only after the physical reveal stamp"
  );
  assert(
    revealResidentProviderWindowBody.includes('wait_for_provider_window_nonblank_x11_frame "$target_window"') &&
      revealResidentProviderWindowBody.includes('record_switch_trace_event helper_paint_gate failed paint_timeout') &&
      revealResidentProviderWindowBody.indexOf('wait_for_provider_window_nonblank_x11_frame "$target_window"') <
        revealResidentProviderWindowBody.indexOf('write_physical_reveal_stamp "$provider_profile" "$target_window" "$previous_window" "$physical_ms"') &&
      (revealResidentProviderWindowBody.match(/if \[\[ "\$resident_page_ready" == "1" && -n "\$provider_port" \]\]; then/g) || []).length >= 2,
    "Explore resident reveal should reuse its prior Manager/CDP confirmation while retaining the physical-frame fallback before stamping"
  );
  assert(
    failedResidentRevealStart >= 0 &&
      failedResidentRevealBody.indexOf("x11_helper_cleanup_active_transaction") <
        failedResidentRevealBody.indexOf("recover_or_cover_provider_failure"),
    "Explore failed Helper reveal should restore Shell ownership before legacy recovery mutations"
  );
  assert(
    webModeScript.includes("reassert_visible_provider_surfaces()") &&
      openProviderPoolBody.indexOf('start_window_guard "$provider_profile"') >
        openProviderPoolBody.indexOf('commit_visible_provider_state "$provider"'),
    "Explore should start the known-ID window guard only after activeProvider commits"
  );
  const webModeTransitionPage = await readFile(path.join(ROOT, "public/web-mode-transition.html"), "utf8");
  assert(webModeBackgroundPage.includes("/assets/tikpal-scene-logo.png") && !webModeTransitionPage.includes("/assets/tikpal-scene-logo.png"), "Explore transition page should not stack a second Tikpal logo above the background veil");
  assert(webModeTransitionPage.includes(".logo-floor") && webModeTransitionPage.includes("display: none"), "Explore transition page should not show the old left logo-floor rail");
  assert(webModeTransitionPage.includes("--provider-tone") && !webModeTransitionPage.includes("signal-track"), "Explore transition page should keep provider tone without drawing a line rail");
  assert(!webModeTransitionPage.includes("logo-floor::before") && !webModeTransitionPage.includes("repeating-linear-gradient"), "Explore transition page should not draw hidden floor edge lines or repeated vertical texture lines");
  assert(webModeTransitionPage.includes("Connecting") && webModeTransitionPage.includes('"zh-CN"') && webModeTransitionPage.includes("providerTextScale") && webModeTransitionPage.includes("data-font-theme"), "Explore transition page should use localized connecting text and shared font settings");
  for (const providerId of ["suno", "spotify", "youtube_music", "apple_music", "tidal", "qobuz", "deezer", "amazon_music", "qq_music", "netease_music"]) {
    assert(webModeTransitionPage.includes(`${providerId}:`), `Explore transition page should map ${providerId}`);
  }
  assert(!webModeTransitionPage.includes("tikpalSignalExpand"), "Explore transition page should not animate a visible signal line");
  assert(!webModeTransitionPage.includes("radial-gradient"), "Explore transition page should not use the old radial glow");
  assert(!webModeTransitionPage.includes("tikpalExplorePulse"), "Explore transition page should not use the old circular pulse");
  assert(!webModeTransitionPage.includes("sendKioskHeartbeat"), "Explore transition page should not post kiosk heartbeats");
  assert(sidePanelSource.includes('new URLSearchParams(window.location.search).get("opening")'), "Explore side panel should read its initial pending provider");
  assert(sidePanelSource.includes("providerStatusLabel"), "Explore side panel should centralize provider status labels");
  assert(sidePanelSource.includes('residentStatus === "prewarming"') && sidePanelSource.includes('residentStatus === "check_setup"') && sidePanelSource.includes('residentStatus === "check_proxy"') && sidePanelSource.includes('residentStatus === "region_unavailable"'), "Explore side panel should show resident provider warm/check and regional availability states");
  assert(webModeScript.includes('"prewarming"') && webModeScript.includes('"check_proxy"') && webModeScript.includes('"region_unavailable"') && serverSource.includes('"prewarming", "ready", "active", "check_setup", "check_proxy", "region_unavailable"'), "Explore provider pool should expose distinct prewarming, proxy, and regional availability states end to end");
  assert(webModeScript.includes("TIKPAL_WEB_MODE_PROVIDER_POOL:=1"), "Explore provider pool should be enabled by default");
  assert(webModeScript.includes("TIKPAL_WEB_MODE_PROVIDER_PREWARM_DELAY_SECONDS:=0.4"), "Explore provider pool should use a short stagger for responsive prewarm");
  assert(webModeScript.includes("TIKPAL_WEB_MODE_PROVIDER_PREWARM_LOCK_TIMEOUT_SECONDS:=2"), "Explore provider prewarm should use a short launch-lock timeout");
  assert(webModeScript.includes("prewarm_provider_pool"), "Explore should prewarm resident providers after entry");
  assert(webModeScript.includes("seed_runtime_provider_pool_statuses") && webModeScript.includes('status: "prewarming"'), "Explore should seed queued resident providers as prewarming before their windows launch");
  assert(webModeScript.includes('const force = seedMode === "force"') && webModeScript.includes('start_provider_pool_prewarm "$provider" force'), "Explore proxy toggles should force resident providers back through prewarm");
  assert(webModeScript.includes("navigate_provider_target") && webModeScript.includes('TIKPAL_WEB_MODE_PROVIDER_PREWARM_FORCE=1') && webModeScript.includes('launch_provider_for_pool "$provider" entry prewarm "$force_existing"'), "Forced provider prewarm should re-navigate existing resident pages after proxy changes");
  assert(
    webModeScript.includes('if ! wait_for_provider_page_or_friendly_error "$provider_port"; then')
      && webModeScript.includes('write_provider_friendly_error_status "$provider" "$provider_port" && return 0')
      && webModeScript.includes('write_runtime_provider_status "$provider" "ready"'),
    "Forced provider prewarm should preserve a friendly terminal page instead of writing Ready"
  );
  assert(webModeScript.includes("provider_direct_reachable") && webModeScript.includes("--noproxy '*'") && webModeScript.includes('"check_proxy"') && webModeScript.includes("needs proxy"), "Explore should probe direct provider reachability before marking Check proxy");
  assert(webModeScript.includes("provider_prefers_direct_proxy") && webModeScript.includes("effective_provider_proxy_enabled"), "Explore launcher should support direct-preferred providers such as QQ Music and NetEase");
  assert(webModeScript.includes("deezer|qq_music|netease_music"), "Explore should direct-launch Deezer, QQ Music, and NetEase instead of waiting on the transition bootstrap");
  assert(!webModeScript.includes('provider === "deezer" ? ["deezer.com", "www.deezer.com"]'), "Explore should wait for Deezer page paint instead of treating the Deezer URL alone as ready");
  assert(webModeScript.includes("wait_for_entry=1") && webModeScript.includes("wait_for_full_ready=1") && webModeScript.includes('launch_provider_for_pool "$provider" entry'), "Explore active opens should wait for provider entry without blocking on the full ready probe");
  assert(webModeScript.includes("setsid") && webModeScript.includes("TIKPAL_WEB_MODE_PROVIDER_PREWARM_FORCE=1"), "Explore provider prewarm should detach from the active open command");
  assert(webModeScript.includes('launch_provider_for_pool "$provider" entry prewarm'), "Explore background prewarm should stop at real HTTPS page readiness before it writes Ready");
  assert(
    webModeScript.includes("provider_prewarm_queue_pids()") &&
      webModeScript.includes('pgrep -f "[t]ikpal-web-mode.sh prewarm"') &&
      webModeScript.includes('pgrep -f "[t]ikpal-web-mode.sh warm-pool"') &&
      webModeScript.includes('"$pid" != "$$"') &&
      webModeScript.includes("stop_provider_pool_prewarm"),
    "Explore should stop stale prewarm and idle-warm queues before starting a new one"
  );
  assert(providerGuardSource.includes('readFileSync(') && providerGuardSource.includes('provider-audio-gate.js') && providerGuardSource.includes("__tikpalProviderAudioGate"), "Explore provider guard should inject the shared resident provider audio gate");
  assert(providerAudioGateSource.includes("tikpal-provider-audio-muted") && extensionBackground.includes("provider-audio-muted"), "Explore provider gate should ask the extension to tab-mute inactive providers");
  assert(providerAudioGateSource.includes("setAudioContextsActive(nextActive)") && providerAudioGateSource.includes("element.muted = false"), "Active provider audio polling should keep WebAudio contexts alive and unmute only on activation");
  const providerGuardOnceStart = providerGuardSource.indexOf("async function guardOnce() {");
  const providerGuardOnceEnd = providerGuardSource.indexOf("\n}\n\nif (process.argv.includes", providerGuardOnceStart);
  const providerGuardOnceBody = providerGuardSource.slice(providerGuardOnceStart, providerGuardOnceEnd);
  assert(
      providerGuardSource.includes("function providerGuardSchedule(currentProviderId, active, activePass)") &&
      providerGuardSource.includes("function runProviderGuardScheduleFixtures()") &&
      providerGuardSource.includes("function runKioskGuardInjectionFixtures()") &&
      providerGuardSource.includes("function providerAudioGateEnabled(opening)") &&
      providerGuardSource.includes("function providerAudioGateActive(active, deactivating)") &&
      providerGuardSource.includes("function providerRuntimeMaintenanceEnabled(currentProviderId, opening)") &&
      providerGuardSource.includes("let spotifyActivePass = 0") &&
      providerGuardOnceBody.includes("const runtimeState = readProviderRuntimeState()") &&
      providerGuardOnceBody.includes("const audioGateEnabled = providerAudioGateEnabled(opening)") &&
      providerGuardOnceBody.includes("const audioGateActive = providerAudioGateActive(active, deactivating)") &&
      providerGuardOnceBody.includes("const runtimeMaintenanceEnabled = providerRuntimeMaintenanceEnabled(providerId, opening)") &&
      providerGuardOnceBody.includes("if (!runtimeMaintenanceEnabled)") &&
      providerGuardOnceBody.indexOf("if (!runtimeMaintenanceEnabled)") < providerGuardOnceBody.indexOf("await installKioskGuard(target)") &&
      providerGuardOnceBody.includes("if (audioGateEnabled) await runProviderAudioGate(targets, audioGateActive)") &&
      providerGuardOnceBody.indexOf("if (audioGateEnabled) await runProviderAudioGate(targets, audioGateActive)") < providerGuardOnceBody.indexOf("if (schedule.consent) await runConsentFeatures(targets)") &&
      providerGuardOnceBody.includes("if (schedule.dismiss) await runSafeDismissFeatures(targets)") &&
      providerGuardOnceBody.includes("if (schedule.activeFeatures)"),
    "provider guards should mute the previous owner, yield opening-target audio to foreground, and keep Spotify Runtime handoff light"
  );
  assert(providerGuardSource.includes("__tikpalQqAudioPrime") && providerGuardSource.includes("persistent: true"), "QQ Music audio prime should keep ALSA alive while QQ is playing");
  assert(!providerGuardSource.includes("setTimeout(resolve, 180)"), "QQ Music audio prime should not fall back to a short pulse");
  assert(providerAudioGateSource.includes("previous.wasPlaying = previous.wasPlaying ||") && providerAudioGateSource.includes("rememberPlayingMedia"), "Inactive provider audio polling should not forget playback that must resume");
  assert(providerAudioGateSource.includes("element.muted = false"), "Returning to a resident provider should unmute media elements");
  assert(
      webModeScript.includes("set_provider_media_active_via_cdp()") &&
      webModeScript.includes("activate_target_provider_audio_gate()") &&
      webModeScript.includes("schedule_target_provider_audio_gate_after_commit()") &&
      webModeScript.includes("cdp_session_manager_requested") &&
      webModeScript.includes("timeout 2 python3 -c") &&
      webModeScript.includes("target_audio_gate_activation_started") &&
      webModeScript.includes("target_audio_gate_activated") &&
      webModeScript.includes("target_audio_gate_deferred"),
    "Explore should activate the revealed provider audio gate through a bounded, traced post-commit CDP call"
  );
  const poolTargetAudioGateIndexes = [...openProviderPoolBody.matchAll(/activate_target_provider_audio_gate "\$provider" "\$provider_port"/g)].map((match) => match.index);
  const poolDeferredAudioGateIndexes = [...openProviderPoolBody.matchAll(/schedule_target_provider_audio_gate_after_commit "\$provider" "\$provider_port"/g)].map((match) => match.index);
  const poolCommitIndexes = [...openProviderPoolBody.matchAll(/commit_visible_provider_state "\$provider"/g)].map((match) => match.index);
  const helperSwitchMarkerClearIndex = openProviderPoolBody.lastIndexOf('switch_marker_clear_started_ms="$(now_ms)"');
  const directTargetAudioGateIndex = openProviderBody.indexOf('activate_target_provider_audio_gate "$provider" "$provider_port"');
  const directCommitIndex = openProviderBody.indexOf('commit_visible_provider_state "$provider"');
  assert(
    poolTargetAudioGateIndexes.length === 1 &&
      poolDeferredAudioGateIndexes.length === 1 &&
      poolCommitIndexes.length === 2 &&
      residentHotRevealIndex < poolCommitIndexes[0] &&
      poolCommitIndexes[0] < poolDeferredAudioGateIndexes[0] &&
      poolDeferredAudioGateIndexes[0] < helperSwitchMarkerClearIndex &&
      residentRevealIndex < poolTargetAudioGateIndexes[0] &&
      poolTargetAudioGateIndexes[0] < poolCommitIndexes[1] &&
      openProviderBody.lastIndexOf("reassert_visible_provider_surfaces") < directTargetAudioGateIndex &&
      directTargetAudioGateIndex < directCommitIndex,
    "Explore should defer resident-helper audio activation until after state commit and X11 release, while fallback paths still activate only the revealed target before commit"
  );
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
  assert(watchdogCheck.stdout.includes("web mode state path:"), "watchdog --check should report the Explore runtime state used for heartbeat bypass");
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
  assert(
    watchdogSource.includes("TIKPAL_WEB_MODE_STATE_PATH")
      && watchdogSource.includes("activeProvider")
      && watchdogSource.includes("openingProvider")
      && watchdogSource.includes("openRequestId")
      && watchdogSource.includes("openXSessionGeneration")
      && watchdogSource.includes("closeRequestId")
      && !watchdogSource.includes('pgrep -af -- "--user-data-dir=$root/providers/"'),
    "watchdog should bypass heartbeats only for a correlated opening, active, or closing Explore transaction, not the resident warm pool"
  );
  assert(
    watchdogSource.includes("heartbeat decision=$decision")
      && watchdogSource.includes("scene_ready_state=$ready_state")
      && watchdogSource.includes("scene_current_time=$current_time")
      && watchdogSource.includes("scene_stalled=$stalled")
      && watchdogSource.includes("scene_not_ready=$not_ready"),
    "watchdog should journal its correlated Explore bypass or restart decision with complete scene-video diagnostics"
  );

  const heartbeatSmokeDir = mkdtempSync(path.join(tmpdir(), "tikpal-heartbeat-smoke-"));
  const heartbeatSmokePortFile = path.join(heartbeatSmokeDir, "port");
  const heartbeatSmokeServer = spawn(process.execPath, [
    "-e",
    `
      const fs = require("node:fs");
      const http = require("node:http");
      const server = http.createServer((request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        if (request.url === "/invalid") {
          response.end("{");
          return;
        }
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
        TIKPAL_WEB_MODE_STATE_PATH: path.join(mkdtempSync(path.join(tmpdir(), "tikpal-kiosk-watchdog-web-mode-state-")), "web-mode-state.json"),
        TIKPAL_KIOSK_WATCHDOG_PAGE_HEARTBEAT_URL: `http://127.0.0.1:${heartbeatSmokePort}/heartbeat`
      },
      encoding: "utf8"
    });
    assert(watchdogDryRun.status === 0, `watchdog dry-run unhealthy page smoke failed:\n${watchdogDryRun.stdout}\n${watchdogDryRun.stderr}`);
    assert(watchdogDryRun.stdout.includes("page-unhealthy:pending-stuck:source:mpd"), "watchdog dry-run should include the page-unhealthy reason");
    assert(watchdogDryRun.stdout.includes("dry-run restart suppressed"), "watchdog dry-run should suppress the real service restart");

    const invalidHeartbeatDryRun = spawnSync("bash", ["deploy/chromium/tikpal-kiosk-healthcheck.sh"], {
      cwd: ROOT,
      env: {
        ...process.env,
        TIKPAL_KIOSK_WATCHDOG_STATE_DIR: mkdtempSync(path.join(tmpdir(), "tikpal-kiosk-watchdog-invalid-heartbeat-")),
        TIKPAL_KIOSK_WATCHDOG_DRY_RUN: "1",
        TIKPAL_KIOSK_WATCHDOG_X_DISPLAY_SCAN: "0",
        TIKPAL_KIOSK_WATCHDOG_CHROMIUM_PROCESS_SCAN: "0",
        TIKPAL_KIOSK_WATCHDOG_WEB_URL_SCAN: "0",
        TIKPAL_KIOSK_WATCHDOG_API_URL_SCAN: "0",
        TIKPAL_KIOSK_WATCHDOG_GPU_LOG_SCAN: "0",
        TIKPAL_WEB_MODE_STATE_PATH: path.join(mkdtempSync(path.join(tmpdir(), "tikpal-kiosk-watchdog-invalid-state-")), "web-mode-state.json"),
        TIKPAL_KIOSK_WATCHDOG_PAGE_HEARTBEAT_URL: `http://127.0.0.1:${heartbeatSmokePort}/invalid`
      },
      encoding: "utf8"
    });
    assert(invalidHeartbeatDryRun.status === 0, `watchdog invalid heartbeat smoke failed:\n${invalidHeartbeatDryRun.stdout}\n${invalidHeartbeatDryRun.stderr}`);
    assert(/heartbeat decision=restart reason=heartbeat-invalid-json/.test(invalidHeartbeatDryRun.stdout), "watchdog should classify malformed heartbeat JSON as unhealthy");
    assert(/dry-run restart suppressed/.test(invalidHeartbeatDryRun.stdout), "watchdog should keep malformed-heartbeat recovery in dry-run mode");

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

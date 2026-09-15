# Debian 12 ARM64 core kiosk

The dedicated GDM **Tikpal Kiosk** session starts Chromium directly on X11.
It does not start KDE or a desktop panel. KDE remains installed as a recovery
session. Display size and X credentials are read at session startup; one active
monitor of at least 1280px width is required. Explore reserves 640px on the right,
or 56px when collapsed. Connecting a 2560×720 screen therefore requires no
hardcoded `:0` or 1440px configuration.

## Install

Use a pinned source revision plus reviewed migration patches. Install Git LFS
media before transfer; do not copy another device's profiles, credentials,
`.env.kiosk`, runtime state, dependencies or build output.

```sh
sudo bash deploy/debian/install-core.sh radxa
export PATH=/opt/tikpal/node-v24.21.0-linux-arm64/bin:$PATH
npm ci
npm run typecheck
npm run build
# For remote devices, confirm SSH will return after reboot:
systemctl is-enabled ssh
sudo systemctl reboot
```

The installer is for Debian 12 ARM64 with GDM already installed. It preserves
Radxa's browser, graphics stack and kernel, and stops if its package simulation
would replace them. Node is pinned and SHA-256 checked. The API, web server, CDP
manager, MPD, read-only X11 Helper and kiosk run as the same user. API and debug
ports listen on loopback; use SSH forwarding for diagnostics.

The first install writes `.env.kiosk`; later runs preserve it. PipeWire remains
the audio server. MPD uses the `pipewire` ALSA PCM and its `Master` mixer, so MPD
and browser volume use the same default output. Select a DAC using `wpctl
set-default ID`; WirePlumber saves the device name. No ALSA card number is pinned.
On Debian, inactive Explore residents use CDP lifecycle freeze plus process
suspension after the configured idle delay. The process is resumed before its
foreground switch, preserving the provider profile and login state while keeping
background browser CPU/GPU work away from the active player.
NetEase Cloud Music starts with a 48,000-frame Chromium output buffer on the
constrained Radxa profile. This absorbs intermittent page or scheduler stalls;
set `TIKPAL_WEB_MODE_NETEASE_MUSIC_AUDIO_BUFFER_SIZE=0` in `.env.kiosk` to use
Chromium's normal buffer. The setting applies when that provider's Chromium
process next starts.
The radio seed is copied only if `/var/lib/tikpal/radio.sqlite3` does not exist.
AirPlay, DLNA, Bluetooth reception and Spotify Connect are outside this installer.

The private xdotool adapter provides `windowlower` and tool-origin restacking;
all other commands go to `/usr/bin/xdotool`. Window geometry uses the same direct X11 path as the Gentoo kiosk. `tikpal-chromium` identifies only Tikpal windows. Helper mutation
mode stays disabled until its staged acceptance passes.

## Check

```sh
systemctl --user status tikpal-debian.target 'tikpal-debian-*.service'
mpc status
wpctl status
curl -fsS http://127.0.0.1:8787/api/v1/web-mode/state
bash scripts/debian-platform-fixture.sh
node scripts/debian-airplay-fixture.mjs
bash scripts/explore-panel-x11-fixture.sh
npm run test:initial-entry
```

Use actual X11 geometry and screen captures for window acceptance. Confirm audio
by listening separately. An available QQ login page is not a successful playback
test; DRM must also be tested separately from Spotify Connect.

## Roll back

The first version of each managed file is recorded in
`~/tikpal-migration/install-backup/manifest.tsv`; reruns preserve those backups.

```sh
sudo bash deploy/debian/rollback-core.sh radxa
sudo systemctl reboot
```

Rollback restores GDM and account session selection, restores/removes only managed
files, and stops Tikpal services. Source, browser profiles, radio/runtime data and
installed dependencies are retained. Do not use `apt autoremove` or remove shared
PipeWire packages as part of rollback.

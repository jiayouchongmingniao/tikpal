# ROCK 4D Debian 12 production release — Chromium 151

## Scope and fixed release inputs

This is the factory-release procedure for ROCK 4D / RK3576 Debian 12 ARM64.
It packages the verified Tikpal Chromium runtime, not a disk image. Every
device keeps its own Tikpal source checkout, browser profiles, radio database,
PipeWire route and provider credentials.

| Input | Release value |
| --- | --- |
| Git branch | `radxa` |
| Chromium archive | six Git parts at `artifacts/chromium/tikpal-chromium-151.0.7922.173-arm64-nv12-import.tar.gz.part-aa` through `part-af` |
| Archive SHA-256 | `6958fb0b40fbaa74890e7d886759223daa92ee792b6b609f03807ff8b093d2e7` |
| Installed directory | `/opt/tikpal-chromium-151.0.7922.173-arm64` |
| `chromium` SHA-256 | `74389d0fba011793c29abd1b17192d5d9acf0e9595391990288c090e318df6d6` |
| Browser version | `Chromium 151.0.7922.173` |
| Node | `24.21.0` ARM64, checked by `install-core.sh` |

The archive is kept in six ordinary Git parts, each below GitHub's 100 MiB
per-file limit. The installer reassembles them in a temporary file, then
verifies the archive SHA-256 before it extracts anything. The resulting archive
contains the ARM64 Chromium runtime, build provenance, runtime inventory and
checksums, but **no Widevine CDM** and no user profile. Widevine licensing and
provider login data must remain device-specific; do not copy them from 102 or
any other production unit.

The 102 production browser currently points at a separately named directory
with the same `chromium` SHA-256. The standard path above is the portable
factory path. It does not replace the Radxa kernel, Mesa, vendor browser,
PipeWire or WirePlumber.

## Confirmed 102 evidence

- The official 151 process, all `tikpal-debian` services, X11 and the real
  2560x720 display are active.
- Explore layout passed ten QQ collapse/expand rounds with a 30-second
  collapsed hold: expanded provider/panel `1920x720 + 640x720`; collapsed
  provider/control strip `2504x720 + 56x720`. In collapsed mode the panel's
  Chromium client remains `640x720` at `x=2504`, intentionally parking its
  hidden 584px off-screen and exposing the 56px control strip. XIDs and
  `timeOrigin` remained stable.
- The 36-station radio database is intact. A representative radio stream,
  pause/play, volume and provider-close audio release were verified. Physical
  sound on the USB BT66 output was confirmed on site.
- Spotify's existing profile reports accepted `com.widevine.alpha`; no profile
  or CDM is included in this release to reproduce that result elsewhere.
- Chromium translation UI is disabled in every provider profile. The persisted
  preference is needed in addition to the `Translate` feature flag on 151.

Not accepted: a clean uninterrupted 30-minute QQ run was intentionally skipped;
do not report it as passed. `node scripts/kiosk-package-smoke.mjs` has an
unchanged baseline failure at the Hi-Fi room-mode assertion. The same failure
reproduces from commit `273ee4c`; it is not a release pass.

### Controlled 102 activation record

The 102 source activation used the packaged `a530784` release and then applied
`2f41a4b` for the Debian session-launcher fix. The latter is required for
Explore: a direct Chromium launch leaves the API without an X-session
generation and correctly causes an Explore open to fail closed.

Before the directory activation, the staged Debian source passed `npm ci`,
`npm run typecheck`, `npm run build`, and
`bash scripts/debian-platform-fixture.sh`. The only source files changed after
the staged release were `deploy/debian/run-service.sh` and its package-smoke
assertion. The activation retained the device's `.env.kiosk`, web-mode settings,
Chromium profiles, radio database, PipeWire default sink, and installed 151
binary; none of those assets were copied from another device.

After the controlled kiosk restart, the session wrapper published a fresh
generation, QQ opened through the loopback Web Mode API, and QQ close/immediate
reopen retained its profile. The acceptance capture contains 26 X11 frames;
each checked the API state, provider and panel XIDs/geometries, and QQ
`performance.timeOrigin`. It recorded no panel bounce, unexpected document
reload, or service warning. The device reboot and fresh 30-minute playback
gates remain deliberately unaccepted.

### Explore parked-window safeguard

During the first QQ-to-NetEase switch on 102, the API had committed NetEase as
active while both provider windows were still at `0,0 1920x720`; the old QQ
window therefore obscured the selected provider. This X11 session does not
advertise the EWMH root properties that `wmctrl` normally relies on. Its
geometry command can exit successfully without moving a window.

Commit `7ba9d4c` verifies the requested geometry after every `wmctrl` move and
falls back to `xdotool` when it was not applied. A cold/resident switch also
requires the known previous provider window to reach the off-screen staging
geometry before it can commit the new active provider. This is intentionally a
window-lifecycle fix only: it does not modify Chromium 151, provider profiles,
PipeWire, the radio database, or user settings.

On 102, the prior files were preserved in
`/home/radxa/tikpal-migration/explore-park-fix-20260918T001000Z/`. Only
`deploy/chromium/tikpal-web-mode.sh` and
`scripts/kiosk-package-smoke.mjs` were synchronized. The deployed script hash
is `48c57386698c8c7231d128ed338ee62a9e8bbc072b950d9a07d0525f0d6f833a`.
The regular QQ-to-NetEase action then held for 30 seconds with API state
`netease_music active`, NetEase at `0,0 1920x720`, and QQ at
`2560,0 1920x720`. This fixes the observed return-to-QQ condition, but does
not replace the separate full-provider or 30-minute playback acceptance gates.

## Factory install

Run these steps on a new Debian 12 ARM64 device as the intended `radxa`-like
service user. Use an SSH key for normal administration. Do not clone, rsync or
restore another device's `.config/tikpal-web-mode`, Chromium profile,
`.env.kiosk`, `/run` state, `node_modules` or `/var/lib/tikpal/radio.sqlite3`.

```sh
git clone --branch radxa https://github.com/jiayouchongmingniao/tikpal.git ~/code/tikpal
cd ~/code/tikpal
git lfs install --local
git lfs pull
git lfs fsck

sudo bash deploy/debian/install-core.sh "$USER"
export PATH=/opt/tikpal/node-v24.21.0-linux-arm64/bin:$PATH
npm ci
npm run typecheck
npm run build

bash deploy/debian/install-chromium-151-artifact.sh --check
sudo bash deploy/debian/install-chromium-151-artifact.sh --install
/opt/tikpal-chromium-151.0.7922.173-arm64/chromium --version
```

The artifact installer is idempotent only for this exact release checksum. It
reassembles and validates the split Git parts before extraction, refuses to
overwrite a different directory, makes `chrome-sandbox` root-owned mode `4755`,
and does not restart services or edit configuration.

Set the binary in the new device's own `.env.kiosk` before its first Tikpal
session. Keep the existing profile paths separate and leave audio as `default`:

```sh
sudoedit ~/code/tikpal/.env.kiosk
# Set or replace only this line:
TIKPAL_CHROMIUM_BIN=/opt/tikpal-chromium-151.0.7922.173-arm64/chromium
```

For each provider, the launcher seeds only a missing CDM subtree from the
device's system Widevine installation. First verify that the local ARM64 CDM is
present; do not add it to Git or the artifact:

```sh
find -L /usr/lib/chromium/WidevineCdm \
  -path '*/_platform_specific/linux_arm64/libwidevinecdm.so' \
  -type f -size +1000000c -print -quit
```

An empty result is a DRM blocker, not a reason to copy a CDM or Spotify profile
from another unit. Provision a properly licensed ARM64 CDM through the
device's approved system path, then test EME and protected playback on that
device. Browser/CDM/profile changes are the only events that require repeating
the protected-content test.

Start the dedicated X11 session through the normal reboot path:

```sh
systemctl --user daemon-reload
systemctl --user restart tikpal-debian.target
systemctl --user is-active tikpal-debian.target 'tikpal-debian-*.service'
```

The actual GDM/X11 session obtains `DISPLAY` and `XAUTHORITY` dynamically. Do
not hardcode `:0`, a fixed panel resolution, PID, XID or runtime lock file.
The Debian `kiosk` service must run
`deploy/chromium/start-tikpal-kiosk-session.sh`, rather than calling the raw
Chromium launcher directly. That session wrapper atomically publishes the
current X-session generation before Chromium starts; Explore correctly rejects
an open when the generation is absent. The tracked
`deploy/debian/run-service.sh` already uses the wrapper.

## Constrained-provider resource guard

The default factory pool remains unchanged. On a thermally constrained ROCK 4D,
use the bounded pool below only after confirming that the user CDP manager
socket is live. It retains the visible provider and one immediately previous
provider; the latter is lifecycle-frozen after eight seconds. Any third,
unready, or proxy-failed provider exits normally while its browser profile and
login data stay on disk.

```sh
systemctl --user is-active tikpal-debian-cdp.service
test -S /run/user/<service-uid>/tikpal/cdp-session-manager.sock

sudoedit ~/code/tikpal/.env.kiosk
```

Add these device-local values, replacing `<service-uid>` with `id -u` for the
service user:

```sh
TIKPAL_WEB_MODE_PROVIDER_MAX_RESIDENT=2
TIKPAL_WEB_MODE_CDP_SESSION_MANAGER=1
TIKPAL_WEB_MODE_CDP_SESSION_MANAGER_SOCKET=/run/user/<service-uid>/tikpal/cdp-session-manager.sock
TIKPAL_WEB_MODE_PROVIDER_BACKGROUND_FREEZE_ENABLED=1
TIKPAL_WEB_MODE_PROVIDER_BACKGROUND_PROCESS_FREEZE_ENABLED=1
TIKPAL_WEB_MODE_PROVIDER_BACKGROUND_FREEZE_DELAY_SECONDS=8
TIKPAL_WEB_MODE_PROVIDER_THERMAL_PAUSE_MILLICELSIUS=85000
TIKPAL_WEB_MODE_PROVIDER_THERMAL_RESUME_MILLICELSIUS=80000
TIKPAL_WEB_MODE_PROVIDER_THERMAL_COOLDOWN_SECONDS=60
```

At or above 85°C, Tikpal stops background prewarm and releases inactive
providers; the currently audible provider continues. It will not resume
background work until all sampled CPU/GPU thermal zones stay below 80°C for 60
seconds. This guard does not modify CPU governors, fan policy, Chromium 151,
PipeWire, or the selected audio sink.

Capture an acceptance run without summing Chromium RSS (which double-counts
shared pages):

```sh
bash scripts/debian-resource-sample.sh --interval 5 --samples 360 \
  > ~/tikpal-migration/netease-resource-30m.tsv
```

The TSV records system load, available RAM, swap usage, thermal zones, Chromium
process counts and CPU ticks by provider profile, service cgroup memory/CPU,
and new PipeWire/MPD/kiosk/CDP error events. Keep the capture with the physical
listening result. A passing run has no swap use, no inactive Chromium provider
except the one frozen recent provider, no thermal sample at or above 85°C, and
no audible NetEase stall.

## Per-device audio and acceptance

Tikpal sends both MPD and Chromium to the PipeWire `default` sink. Select the
currently connected output on each device with PipeWire/WirePlumber, then
listen on the real hardware. Never write a transient PipeWire numeric node ID,
the BT66 name or an ALSA card number into source or the release configuration.
If the intended DAC changes, select the new device by its current stable sink
identity and verify it again.

Before handing a unit to production, record these results separately:

1. `bash scripts/debian-platform-fixture.sh`, typecheck and build.
2. Active target plus API, web, MPD, CDP, Helper and kiosk services; actual
   Chromium process uses the release path.
3. X11 screenshot and measured 2560x720 Explore geometry. Repeat ten
   collapse/expand rounds, then retain collapsed mode for at least 30 seconds.
4. 36 radio presets, one real stream, pause/play, volume, output switching and
   audio release after close. Record physical hearing separately from UI state.
5. QQ login handoff if needed; never import credentials. Check close/immediate
   reopen, controlled service recovery and reboot/login persistence.
6. At least 30 minutes of uninterrupted playback after a stable output is
   connected, with CPU, memory, temperature and MPD/PipeWire/Chromium errors.

The current 102 evidence is a baseline, not a substitute for these physical
checks on another screen, DAC or cooling arrangement.

## Rollback

Keep the release archive and the prior `.env.kiosk` value until acceptance is
complete. To revert only this browser selection, stop Tikpal, restore the
previous `TIKPAL_CHROMIUM_BIN` value, then start the target again:

```sh
systemctl --user stop tikpal-debian.target
sudoedit ~/code/tikpal/.env.kiosk
systemctl --user start tikpal-debian.target
```

If this release directory was newly installed and has not been selected by any
running service, it may be removed explicitly:

```sh
sudo rm -rf -- /opt/tikpal-chromium-151.0.7922.173-arm64
```

Do not remove the system Widevine path, browser profiles, radio database,
Node/runtime dependencies, PipeWire configuration, kernel or graphics stack as
part of this rollback. Use `deploy/debian/rollback-core.sh` only to reverse the
separate core-installer-managed services and configuration.

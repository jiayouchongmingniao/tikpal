# 136 Chromium hardware decode investigation — 2026-09-14 to 2026-09-16

## Status

The separately built Chromium 151.0.7922.173 package now runs as the default
main kiosk on 102. A 10-minute main-kiosk hardware-decode trial completed with
no crash: the 2560×720 H.264 scene used `V4L2VideoDecoder` and the GPU feature
status reported `video_decode=enabled`. The deployed service uses a separate
151 profile and flags file, preserving the vendor 126 profile and its original
configuration for rollback. No Mesa, kernel, PipeWire, or hardware configuration
was replaced.

The main-kiosk fallback was caused by two `--enable-features` switches: the
launcher's later `WebUIDarkMode` switch superseded the earlier
`AcceleratedVideoDecoder` switch. The launcher now combines requested features
into one argument, and the 151 configuration supplies
`AcceleratedVideoDecoder`; the final process contains
`--enable-features=AcceleratedVideoDecoder,WebUIDarkMode`.

The WCH touchscreen exposes both a direct multitouch device (`event3`) and a
mouse-emulation device (`event5`). The kiosk now disables only `event5` at
startup through `deploy/debian/disable-touch-mouse-emulation.sh`, controlled by
`TIKPAL_TOUCH_DISABLE_MOUSE_EMULATION=1`. Device discovery uses the stable
`/dev/input/by-id` symlink and current XInput device node rather than a volatile
XInput id. On 102, the direct device remains enabled and the emulation device
is disabled after a kiosk restart.

A source patch candidate is in
`deploy/chromium/patches/chromium-126-mesa-decoder-import.patch`. It is **not built
or deployed**. Binary interposition is evidence for the diagnosis, not acceptance
of that C++ patch or a production solution.

## Device and package baseline

- ROCK 4D / RK3576, Debian 12 ARM64, kernel 6.1.84-13-rk2410-nocsf.
- Vendor chromium-x11 126.0.6478.126; Mesa/Panfrost 25.0.7.
- librockchip-mpp1 1.5.0-1; libv4l-rkmpp 1.7.0-1.
- Source scene: Midnight-Library.mp4, H.264, 2560×720.
- Current repositories offer vendor 126 and generic Debian 152.0.7977.82;
  no vendor 151 build was verified. chromium-x11 conflicts with generic chromium.
  Upgrading a version number alone does not establish Rockchip decode support.

## Evidence

1. Downloaded and extracted rockchip-mpp-demos 1.5.0-1 under
   `/tmp/tikpal-mpp-probe`, without installing packages.
   FFmpeg copied the scene bitstream to Annex B without transcoding.
   `mpi_dec_test -i scene.h264 -t 7 -n 3 -o decoded.yuv` exited successfully and
   produced 8,294,400 bytes: three 2560×720 NV12 frames. This proves the native
   MPP decode path for this sample; it does not prove every codec/provider.
2. Original Chromium reports `FFmpegVideoDecoder`, platform decoder false.
   Its logs contain GBM plane export errors followed by failure to create the
   NV12 `MailboxVideoFrameConverter` SharedImage.
3. Mesa reports NV12 allocation unsupported on all six accessible DRM nodes,
   while XR24 allocation is supported. Chromium 126 checks allocation support
   before accepting an already allocated native decoder frame.
4. A test-only preload library uses Mesa's plane export API and temporarily
   allows the NV12/SCANOUT capability probe. In a separate profile and offscreen
   window this produces `V4L2VideoDecoder`, platform decoder true. An 8-second
   test recorded 198 frames and zero drops; screenshot inspection showed the
   expected scene. This temporary capability override must not be deployed.
5. A roughly 40-second test crossed the video loop boundary and resized the test
   window from 1280px to 1920px and 2504px wide (1440px high after resizing).
   Final count: 959 frames, one dropped (about 0.10%); the decoder remained V4L2.
   At the loop boundary one sample observed readyState 1/currentTime 0; subsequent
   samples resumed playback. This is not proof of seamless looping.
   These were CDP window resize requests, not Explore geometry acceptance.

Raw decoder and frame events are saved under `evidence/136-video-decode/`.
The normal kiosk and radio remained running during these isolated tests.
No physical sound, touch, DRM or complete-provider acceptance was performed.

## Short CPU comparison

Two sequential isolated runs used the same video and 1280×720 window, with a
2-second warmup and 15-second CPU measurement. Summed `/proc` CPU ticks for the
browser processes carrying the unique profile argument, with one fully occupied
core = 100%:

| Decode path | Browser process CPU | Frames / drops at final observation |
| --- | ---: | ---: |
| FFmpeg software | 90.65% | 424 / 0 |
| V4L2 hardware diagnostic | 52.69% | 425 / 1 |

The measured browser CPU reduction was about 42%. It excludes the kernel, Xorg
and other processes; this was one short comparison, not a repeated benchmark or
production thermal result. The normal kiosk continued running in both runs.
Two earlier CPU samples were discarded because the collector expected NUL-
separated arguments while this vendor browser rewrites cmdline using spaces;
the corrected collector matches the unique profile flag within cmdline.

## Newer Rockchip source path

The maintainer's `JeffyCN/meta-rockchip` repository does contain a Chromium
151.0.7922 patch set, including V4L2 decoder enablement and libv4l2 plugin support.
Its recipe enables `use-egl use-v4l2 use-v4lplugin proprietary-codecs`.
Inspected repository tree SHA: `b2393c23f16e6230025499015610d8c0018b1ea7`.
This is a source/build route, **not** a verified Debian ARM64 binary or proof that
151 fixes the NV12 import gate. It makes a maintained Rockchip-enabled upgrade
more concrete than installing generic Debian Chromium.

https://github.com/JeffyCN/meta-rockchip/tree/master/dynamic-layers/recipes-browser/chromium/chromium_151.0.7922

## Remaining delivery work

- Obtain the exact vendor Chromium source/build configuration, retaining V4L2/MPP
  support, or identify a maintained replacement package with equivalent support.
- Rebase and compile the candidate, then repeat the tests with the real binary
  and **without LD_PRELOAD**. The public radxa-pkg/chromium-x11 repository describes
  a prebuilt package rather than supplying a complete Chromium build tree.
- Test software fallback, other scenes/codecs, Explore and OAuth window lifecycle.
- Back up and deploy only after the replacement binary passes; preserve profiles.
- Measure production CPU/temperature and extended playback after deployment.
  Diagnostic short runs cannot establish thermal stability or eliminate cooling
  requirements. Do not disable thermal protection.

References:
- https://github.com/radxa-pkg/chromium-x11
- https://github.com/JeffyCN/libv4l-rkmpp
- https://chromium.googlesource.com/chromium/src/+/refs/tags/126.0.6478.126/ui/gfx/linux/gbm_wrapper.cc
- https://chromium.googlesource.com/chromium/src/+/refs/tags/126.0.6478.126/gpu/command_buffer/service/shared_image/ozone_image_backing_factory.cc

## Build preparation on the Mac / PSSD

On 2026-09-14, an isolated Ubuntu 22.04 x86_64 Lima VM was created on the Intel
Mac (32GiB host RAM). The VM has 8 CPUs and 20GiB RAM; its ext4 build disk is a
256GiB raw file on `/Volumes/PSSD/tikpal-chromium-build/build.raw`. Existing PSSD
files and device 136 were not modified. The first raw-disk flush took longer
than Lima's startup wait limit, but cloud-init subsequently completed; the VM
is usable. A host download timed out and its empty retry artifact was removed.
The replacement in-guest segmented download completed with checksum validation.

The official 151.0.7922.173 tarball SHA-256 is
`716e1b73f79911ac9a315642ebc989acd62c1cde366b11e7289f8500d4cd9120`.
The 18 Rockchip patches and our 151 import patch pass source application checks;
the reference tarball-build backport also applies. Source extraction, patching and strict GN generation have passed. Ninja is
compiling the browser (93,385 planned steps), so there is still no accepted
replacement browser package. Reproduction/configuration is documented in
`deploy/debian/chromium-build/README.md`.

## First compile failure and incremental recovery

The build stopped after 21,726 of 93,385 steps because Rockchip patch 0015's
intentional `true || modifiers.empty()` condition triggers Clang 23's
`-Werror,-Wunreachable-code`. Following the compiler diagnostic, the local 151
patch now parenthesizes `true`, preserving behavior and leaving warnings enabled.
The previously failing `gbm_wrapper.o` target then passed compilation and was
verified as an ARM aarch64 ELF object. The complete local patch passed reverse
application checking against the live source, and the source-ready manifest hash
was updated to the corrected inputs. Full incremental compilation was resumed;
no browser was deployed. The transcript retains the historical error before the
`Resuming after Clang compatibility correction` marker.

### 2026-09-15: V4L2 Clang compatibility correction

The resumed build stopped at 24,475/71,747 with two warning-as-error failures:
`kMaxNumRequests` was unused outside ChromeOS, and the restored HEVC splitter
constructed a span from a pointer/length without an unsafe-buffer annotation.
The local patch now guards the constant with the same ChromeOS condition as its
only user and annotates only that span construction. Both caller paths derive
the pointer and length from the same bounded input subspan. No global compiler
warning is disabled. The patch checksum and applied-source marker are updated;
previous errors remain in the append-only log. Device 136 is unchanged.

Both failed translation units passed targeted recompilation (2/2). Full Ninja
build resumed with six workers under caffeinate; packaging and device validation
remain pending.

### 2026-09-16: full build, packaging, isolated startup failure

The resumed full build completed all 47,272 remaining steps at 04:52 +0800.
A 267 MiB package containing all GN runtime dependencies was installed separately
at `/opt/tikpal-chromium-151.0.7922.173-arm64` on the same ROCK 4D, whose IP has
changed to `192.168.10.102`. All installed file hashes and `--version` passed.
The vendor Chromium 126 and production profiles remain unchanged.

The first isolated launch failed before playback: V8 context snapshot external
references for `atomic_pair_exchange` and `atomic_pair_store` were merged by
mold during snapshot generation but differ in the ARM64 binary. The context
snapshot generator's disable-ICF rule did not cover an explicit linker path.
The local patch now follows V8 mksnapshot's `use_lld || linker_path != ""` rule.
The failed test browser was stopped; incremental snapshot regeneration and
real decoder acceptance are pending. No diagnostic preload was used.

The two-step snapshot rebuild passed, and page/script initialization now works.
The first playback used software decoding because Chromium 151's V4L2 path needs
`--enable-features=AcceleratedVideoDecoder` (the older Vaapi feature name is not
the matching switch). With the correct feature enabled, Media reports
`V4L2VideoDecoder` and platform=true, but only two frames were produced before a
GPU/pipeline disconnect. This is a failed hardware playback test, not acceptance.

The built object has a weak `gbm_bo_get_fd_for_plane` reference, but the linked
browser has no dynamic reference to it despite the device library exporting it.
The local GBM patch resolves this optional API with `dlsym(RTLD_DEFAULT, ...)`,
retains the existing fallback for older libraries, and leaves failure checks
intact. This avoids using the incorrect device fd for KMSRO handles. Incremental
build and new playback validation are in progress.

The GBM runtime-symbol fix compiled and its package passed target checksums
(SHA-256 `046b1ee77fa7400eb9b7ed534f0ac3001676634497a698eb4d29279627a4d0fb`).
It removed the fd-export errors, but playback still stopped after four frames.
The next concrete failure is `CreateBufferFromHandle` rejecting NV12 via its
allocation-support query before calling `gbm_bo_import`. The new narrow patch
allows decoder-owned NV12 imports on Mesa with flags 0 when allocation is
unsupported; plane checks and actual import validation remain. Minigbm and
new allocation paths are unchanged. This is still pending runtime verification.

### 2026-09-16: real Chromium 151 hardware playback verified

The final incremental build passed all five steps. Package SHA-256:
`6958fb0b40fbaa74890e7d886759223daa92ee792b6b609f03807ff8b093d2e7`.
Host archive: `/Volumes/PSSD/tikpal-chromium-build/tikpal-chromium-151.0.7922.173-arm64-nv12-import.tar.gz`.
All target file checksums passed after separate installation. Earlier failed
candidates remain under `/opt` with `-before-gbm` and `-before-nv12` suffixes.

Without LD_PRELOAD, a fresh-profile test on `192.168.10.102` reported
`V4L2VideoDecoder`, platform=true, for Midnight-Library H.264 2560x720.
The short run produced 216 frames, 8 dropped, with no Media decoder errors.
A second run switched viewport widths 1920→2504→1920→2504 over 40 seconds:
980 total frames, 8 dropped (about 0.82%), no decoder errors, continuously
unpaused, including the loop at 29.67 seconds. The last two samples retained
the same dropped-frame count. Both screenshots show the expected library scene.
The test used an ordinary standalone window (633px content height), not the
production Explore window controller; this does not certify Explore lifecycle.

Use `--enable-features=AcceleratedVideoDecoder` with the tested ANGLE GLES/EGL
flags. The installed Playwright CDP attachment did not complete against 151's
new `browser_ui` targets, so evidence was collected with bounded raw CDP calls.
The retained harness requires the documented SSH control socket and test-port
forward; it must not be pointed at the production CDP port.

Temperature sampled during the loop reached 84.076°C. Thermal zone 2 lists an
85°C passive trip (critical trip 115°C). Tests were stopped normally and the
reading subsequently fell to 80.384°C. Long-duration and CPU/thermal acceptance
are deferred until cooling is clarified. The source-format error in the first
NV12 compile was fixed by including drm_fourcc.h; the successful incremental
log retains that earlier diagnostic.

### 2026-09-16: main kiosk activation trial and rollback

The main `tikpal-debian-kiosk.service` was trialled with
`/opt/tikpal-chromium-151.0.7922.173-arm64/chromium` at 2560×720 and an
independent profile. Its flags selected ANGLE GLES/EGL,
`--enable-accelerated-video-decode`, and the combined
`AcceleratedVideoDecoder,WebUIDarkMode` feature switch. The Contextual Tasks
features were disabled to avoid an unrelated DCHECK in the non-official build.

During the first activation, CDP Media reported `V4L2VideoDecoder` with
`kIsPlatformVideoDecoder=true` for a playing 2560×720 scene. The service then
exited with status 6/SIGABRT after about 7 minutes 51 seconds. Further 151
trials also aborted without a corresponding touch test; the journal did not
preserve a useful fatal assertion and Crashpad only recorded an ELF dynamic-tag
reader error. This is a stability failure, so the prior vendor-126 scripts,
profile and device configuration were restored from
`/home/radxa/.local/state/tikpal/hwdecode-151-20260916-001/activation-20260916-002045`.

The original 151 package, isolated playback evidence and activation backup are
retained for diagnosis. No 207 deployment, full Explore/provider lifecycle,
physical sound, DRM, or long-playback acceptance is claimed. All build and
isolated-test evidence is in `evidence/136-video-decode/chromium151-*`.

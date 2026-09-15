# 136 Chromium hardware decode investigation — 2026-09-14

## Status

Hardware decoding works in an isolated diagnostic Chromium process. The running
Tikpal browser is unchanged and still uses software decoding. No browser, Mesa,
kernel, service, production profile or launch flag was replaced.

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

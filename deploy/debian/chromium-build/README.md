# Isolated Chromium ARM64 builder

This builds a candidate browser for ROCK 4D; it does not install or activate it.
The script has prepared Chromium 151.0.7922.173 and passed GN generation with
`--fail-on-unused-args` (39,047 targets). Ninja compilation is running with
93,385 planned steps; a completed binary and device acceptance are still needed.

## Current build host

- Intel macOS 15.7.9, 32GiB RAM; Lima 2.2.0 installed with Homebrew.
- VM `tikpal-chromium-builder`: Ubuntu 22.04 x86_64, VZ, 8 CPUs, 20GiB RAM.
- VM system disk: 20GiB sparse image in `~/.lima/tikpal-chromium-builder`.
- Build disk: 256GiB raw image at
  `/Volumes/PSSD/tikpal-chromium-build/build.raw`, containing ext4.
- Lima's `~/.lima/_disks/tikpal-chromium-build/datadisk` is a symlink to that image;
  Lima metadata remains on the internal filesystem because PSSD is ExFAT.
- Guest build location: `/mnt/lima-tikpal-chromium-build/work`.
- No host directories or SSH agent are shared with the VM.

The external disk is not reformatted. ExFAT cannot store the source tree's Unix
metadata correctly, so source extraction and compilation take place inside ext4.
The raw image reserves 256GiB and its first writes can require lengthy zeroing.
Keep PSSD connected while the VM is running. Stop with:

```sh
limactl stop tikpal-chromium-builder
```

## Inputs and execution

`../../chromium/patches/chromium-151-sources.json` locks the official tarball,
Rockchip patches and tarball-build backport by SHA-256. The local NV12 import
patch is also hashed. `args.gn` selects Linux ARM64, X11, V4L2 plugin decoding,
H.264 codecs and a release build without debug symbols or ThinLTO.

Copy the `deploy/debian/chromium-build` and `deploy/chromium/patches` directories
into the VM preserving their relative paths. Then invoke:

```sh
bash inputs/deploy/debian/chromium-build/build.sh \
  /mnt/lima-tikpal-chromium-build/work \
  /mnt/lima-tikpal-chromium-build/work/chromium-151.0.7922.173.tar.xz
```

The script verifies the tarball, extracts into a new source directory, downloads
and verifies pinned patches, installs build dependencies **inside the VM**, and
runs GN and Ninja with six compile jobs. Output is appended to `work/build.log`.
Successful preparation is marked separately so compilation can be resumed.
A partial extraction or patch failure stops for inspection instead of silently
mixing source versions. Packaging is separate; device activation is not automated.

Before deployment, package the runtime separately from the vendor browser,
verify ARM64 ELF dependencies on Debian 12, and repeat decoder, resize, loop,
software fallback and Explore tests without the diagnostic preload library.
Back up browser profiles before opening them with a newer major version.

## Current execution logs

Host transcript: `/tmp/tikpal-chromium-build-session.log`.
Guest transcript: `/mnt/lima-tikpal-chromium-build/work/build.log`.
The host execution is wrapped in `caffeinate -i` for the lifetime of the build.
Full compilation finished on 2026-09-16. The first isolated ARM64 launch exposed
a V8 context snapshot ICF mismatch; runtime acceptance remains pending.

```sh
limactl shell tikpal-chromium-builder -- tail -30 \
  /mnt/lima-tikpal-chromium-build/work/build.log
```

## Runtime packaging

Chromium 151 moved its Linux installer inventory to
`chrome/installer/linux/common/installer.py`. Use its binary/resource inventory
and `gn desc out/Tikpal //chrome:chrome runtime_deps` together when staging the
candidate. Runtime dependencies include generated DevTools files; do not assume
that copying the executable alone produces a usable browser.

- Stage in a new versioned directory; keep vendor Chromium installed and keep
  staging separate from activation. Do not copy device profiles into a package.
- Include the ARM64 browser, crashpad handler, sandbox, ICU data, scale-specific
  resource packs, V8 snapshot, all built locales and built runtime libraries.
  Preserve relative library/resource paths. Check the generated dependency list
  for component data and Qt/ANGLE/SwiftShader libraries enabled by this build.
- The build target is `chrome_sandbox`; the installed filename is
  `chrome-sandbox`. Sandbox ownership/mode must be established on the target
  rather than silently disabling the sandbox to make a test pass.
- Record source manifest, local patch, GN arguments and per-file checksums in the
  package. Inspect every ELF architecture and needed shared library before
  starting it on ARM64 Debian 12. Do not execute ARM64 output on the x86 VM.
- Start isolated tests with a fresh profile and distinct CDP port, without the
  diagnostic preload. Keep production sessions running until controlled
  activation is ready. Back up profiles before any major-version migration.
- Validate hardware decoder identity, rendered frames, dropped frames, repeated
  resize/loop, software fallback, Explore extension/window behavior and audio.
  A successful link or `--version` does not establish hardware decode acceptance.

The runtime dependency inventory was generated successfully in the VM at
`/tmp/tikpal-chrome-runtime-deps.txt` during compilation. Regenerate after any GN
configuration change and verify all staged files against the completed build.

The current GN runtime inventory contains 5,171 entries (including generated
DevTools resources and duplicates), all relative to the build output directory.
It lists ANGLE, SwiftShader, Vulkan and both Qt shims. A copy is retained at
`docs/06-deployment/evidence/136-video-decode/chromium151-runtime-deps.txt`.
This inventory is a packaging input, not proof that compilation has produced all
of those files. The separate sandbox target must also be included.

`package.py WORK_DIR DESTINATION` stages all GN runtime dependencies and the
separate sandbox, strips copied ARM64 executables, records build provenance and
per-file hashes, and writes a gzip archive. It refuses to overwrite an existing
package. Run only after Ninja succeeds; packaging alone is not runtime acceptance.

The first package launched on ROCK 4D (now `192.168.10.102`) with a fresh profile,
but renderer initialization failed in V8 external-reference validation. The
context snapshot generator used mold with `--icf=all` because its disable-ICF
config only recognized `use_lld`. The local patch now recognizes an explicit
`linker_path`, matching V8's own mksnapshot rule. Keep this validation enabled;
do not bypass the runtime assertion. Regenerate the context snapshot and repeat
isolated playback tests before activating the browser.

## Current isolated acceptance (2026-09-16)

The V8 snapshot and Mesa GBM compatibility fixes are built and packaged.
The final `-nv12-import.tar.gz` candidate passed ARM64 target checksums and
40 seconds of real V4L2 hardware playback with loop and width changes, without
LD_PRELOAD. See `docs/06-deployment/136-chromium-hardware-decode.md` for hashes,
frame counts and evidence. Production remains on vendor 126; high temperature
means long-duration acceptance and activation are still pending.

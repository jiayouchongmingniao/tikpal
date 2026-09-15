# Chromium / Mesa decoder import candidate

`chromium-126-mesa-decoder-import.patch` is an **unbuilt source patch candidate**,
not a deployable browser fix. It is not consumed by any Tikpal installer.

Base: upstream Chromium tag `126.0.6478.126`. The installed Radxa package has the
same version number but includes vendor V4L2/MPP changes; its exact source tree
must be obtained and the patch rebased before building a replacement package.

Changes:

1. Export Mesa buffer planes through `gbm_bo_get_fd_for_plane` when available,
   preserving the old path for older GBM libraries. This lets Mesa use the actual
   allocation device instead of assuming that the display device owns the handle.
2. Do not require buffer **allocation** support for `NATIVE_PIXMAP` imports in
   Ozone. Preserve the GL import capability check and actual import validation.
   New allocations still require allocation support.

Validation so far: `git apply --check` against the two files from the upstream
base passed. C++ compilation and tests of a patched Chromium binary have **not**
run. The isolated binary-interposition experiment described in the deployment
report supports the diagnosis, but is not equivalent to validating this patch.

Do not globally override GBM format capabilities or install the diagnostic
`LD_PRELOAD` library in a production browser. Build with the existing Rockchip
V4L2/MPP integration, then verify real decoder events, video output, looping,
window resizing and software fallback before replacing the installed package.

See `docs/06-deployment/136-chromium-hardware-decode.md` for device evidence.

## Chromium 151 candidate

Preferred build candidate: `151.0.7922.173`, with the 18 Rockchip patches pinned
in `chromium-151-sources.json`, followed by
`chromium-151-mesa-decoder-import.patch`. All 18 patches apply sequentially to
upstream source files from that tag, including the CLD3 dependency revision from
DEPS; the local patch passes its application check after them. This only checks
patch application, not compilation or runtime behavior.

151 already calls Mesa's plane export API, so its runtime fix only needs the
Ozone import change from our 126 candidate. It also includes the compile-only
constant annotation described below. Its standard ARM64 sysroot is Debian Bullseye,
which avoids accidentally building against a newer-than-Bookworm glibc; actual
ELF dependencies still need verification on 136 before activation.

The reference meta-browser recipe is a source for platform flags, not a complete
standalone Debian build script. Do not blindly copy its Yocto-specific compiler
and sysroot overrides into a depot_tools build.

## Clang 23 compile compatibility correction

The first full compile stopped at `gbm_wrapper.o`: Rockchip patch 0015 uses
`if (true || modifiers.empty())`, which triggers `-Werror,-Wunreachable-code`
with the pinned Clang 23. The 151 local patch now parenthesizes the intentional
constant, as recommended by the compiler diagnostic. This preserves the vendor
modifier workaround and keeps warnings enabled. The source manifest hash was
updated with this correction; incremental builders must apply the correction
before updating their source-ready marker.

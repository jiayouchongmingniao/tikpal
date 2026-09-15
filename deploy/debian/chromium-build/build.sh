#!/usr/bin/env bash
# Dedicated Linux x86_64 builder only. Does not install or activate a browser.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_DIR="$(cd "$SCRIPT_DIR/../../chromium/patches" && pwd)"
WORK_DIR="${1:?Usage: build.sh WORK_DIR SOURCE_ARCHIVE}"
ARCHIVE="${2:?Usage: build.sh WORK_DIR SOURCE_ARCHIVE}"
[[ "$(uname -sm)" == 'Linux x86_64' ]] || { echo 'Linux x86_64 builder required' >&2; exit 1; }
mkdir -p "$WORK_DIR"
WORK_DIR="$(realpath "$WORK_DIR")"
ARCHIVE="$(realpath "$ARCHIVE")"
[[ "$(findmnt -n -o FSTYPE -T "$WORK_DIR")" == ext4 ]] || { echo 'Use the dedicated ext4 build disk' >&2; exit 1; }
cd "$WORK_DIR"
exec > >(tee -a "$WORK_DIR/build.log") 2>&1
date -u
SRC="$WORK_DIR/chromium-151.0.7922.173"
MANIFEST_HASH="$(sha256sum "$PATCH_DIR/chromium-151-sources.json" | cut -d ' ' -f 1)"
if [[ -f "$WORK_DIR/source.ready" ]]; then
  [[ "$(cat "$WORK_DIR/source.ready")" == "$MANIFEST_HASH" ]] || { echo 'Source manifest changed; use a new build directory' >&2; exit 1; }
else
  [[ ! -e "$SRC" && ! -e "$WORK_DIR/extract" ]] || { echo 'Partial source preparation exists; inspect before retrying' >&2; exit 1; }
  printf '%s  %s\n' 716e1b73f79911ac9a315642ebc989acd62c1cde366b11e7289f8500d4cd9120 "$ARCHIVE" | sha256sum -c -
  mkdir "$WORK_DIR/extract"
  tar -xJf "$ARCHIVE" -C "$WORK_DIR/extract"
  mv "$WORK_DIR/extract/chromium-151.0.7922.173" "$SRC"
  rmdir "$WORK_DIR/extract"
  python3 - "$PATCH_DIR" "$WORK_DIR" "$SRC" <<'PY'
import hashlib, json, pathlib, subprocess, sys
patch_dir, work, src = map(pathlib.Path, sys.argv[1:])
manifest = json.loads((patch_dir / 'chromium-151-sources.json').read_text())
downloads = work / 'patches'
downloads.mkdir(exist_ok=True)
def apply(path, digest):
    if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise RuntimeError(f'Patch checksum mismatch: {path.name}')
    subprocess.run(['git', 'apply', '--check', str(path)], cwd=src, check=True)
    subprocess.run(['git', 'apply', str(path)], cwd=src, check=True)
for item in manifest['rockchip_patches']:
    path = downloads / pathlib.Path(item['path']).name
    url = f"https://raw.githubusercontent.com/JeffyCN/meta-rockchip/{manifest['rockchip_commit']}/{item['path']}"
    subprocess.run(['curl', '-fsSL', '--retry', '3', '--connect-timeout', '20', '--max-time', '120', url, '-o', str(path)], check=True)
    apply(path, item['sha256'])
item = manifest['local_patch']
apply(patch_dir / item['file'], item['sha256'])
item = manifest['tarball_build_patch']
path = downloads / 'tarball-build.patch'
subprocess.run(['curl', '-fsSL', '--retry', '3', '--connect-timeout', '20', '--max-time', '120', item['url'], '-o', str(path)], check=True)
apply(path, item['sha256'])
PY
  printf '%s\n' "$MANIFEST_HASH" > "$WORK_DIR/source.ready"
fi
cd "$SRC"
if [[ ! -f "$WORK_DIR/dependencies.ready" ]]; then
  sudo python3 build/install-build-deps.py --no-prompt --no-arm --no-android --no-nacl --no-chromeos-fonts
  python3 build/linux/sysroot_scripts/install-sysroot.py --arch=amd64
  python3 build/linux/sysroot_scripts/install-sysroot.py --arch=arm64
  python3 tools/clang/scripts/update.py
  python3 tools/rust/update_rust.py
  touch "$WORK_DIR/dependencies.ready"
fi
mkdir -p out/Tikpal
cp "$SCRIPT_DIR/args.gn" out/Tikpal/args.gn
buildtools/linux64/gn gen out/Tikpal --fail-on-unused-args
third_party/ninja/ninja -C out/Tikpal -j6 chrome chrome_sandbox
file out/Tikpal/chrome
printf 'Compilation finished; packaging and device acceptance remain pending.\n'
date -u

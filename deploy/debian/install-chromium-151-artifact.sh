#!/usr/bin/env bash
# Install the checked-in ARM64 Chromium runtime without touching device state.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PACKAGE="tikpal-chromium-151.0.7922.173-arm64"
ARCHIVE_NAME="$PACKAGE-nv12-import.tar.gz"
PART_PREFIX="$APP_DIR/artifacts/chromium/$ARCHIVE_NAME.part-"
EXPECTED_PART_COUNT=6
EXPECTED_ARCHIVE_SHA256="6958fb0b40fbaa74890e7d886759223daa92ee792b6b609f03807ff8b093d2e7"
EXPECTED_CHROMIUM_SHA256="74389d0fba011793c29abd1b17192d5d9acf0e9595391990288c090e318df6d6"
TARGET="/opt/$PACKAGE"
MODE="${1:---check}"
ARCHIVE="${2:-}"
temporary_archive=""
temporary_install=""

cleanup() {
  [[ -z "$temporary_archive" ]] || rm -f -- "$temporary_archive"
  [[ -z "$temporary_install" ]] || rm -rf -- "$temporary_install"
}
trap cleanup EXIT

case "$MODE" in
  --check|--install) ;;
  *)
    printf 'Usage: %s [--check|--install] [archive]\n' "$0" >&2
    exit 64
    ;;
esac

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

if [[ -z "$ARCHIVE" ]]; then
  shopt -s nullglob
  parts=("$PART_PREFIX"[a-z][a-z])
  shopt -u nullglob
  [[ ${#parts[@]} == "$EXPECTED_PART_COUNT" ]] ||
    fail "Expected $EXPECTED_PART_COUNT LFS parts at $PART_PREFIX"
  temporary_archive="$(mktemp)"
  cat "${parts[@]}" > "$temporary_archive"
  ARCHIVE="$temporary_archive"
fi

[[ -f "$ARCHIVE" ]] || fail "Chromium archive is missing: $ARCHIVE"
[[ "$(sha256sum "$ARCHIVE" | awk '{print $1}')" == "$EXPECTED_ARCHIVE_SHA256" ]] ||
  fail "Chromium archive checksum does not match the 151 production release"
tar -tzf "$ARCHIVE" | grep -Fx "$PACKAGE/chromium" >/dev/null ||
  fail "Chromium archive is missing its launcher"
tar -tzf "$ARCHIVE" | grep -Fx "$PACKAGE/chrome-sandbox" >/dev/null ||
  fail "Chromium archive is missing its sandbox"
if tar -tzf "$ARCHIVE" | grep -Ei '(^|/)(WidevineCdm|libwidevinecdm\.so)(/|$)' >/dev/null; then
  fail "Production Chromium archive must not contain a Widevine CDM"
fi

if [[ -e "$TARGET" ]]; then
  [[ -x "$TARGET/chromium" ]] || fail "Existing target is not a Chromium runtime: $TARGET"
  [[ "$(sha256sum "$TARGET/chromium" | awk '{print $1}')" == "$EXPECTED_CHROMIUM_SHA256" ]] ||
    fail "Refusing to replace a different Chromium runtime at $TARGET"
  printf 'installed=%s\nchromium_sha256=%s\n' "$TARGET" "$EXPECTED_CHROMIUM_SHA256"
  exit 0
fi

if [[ "$MODE" == "--check" ]]; then
  printf 'archive_sha256=%s\nparts=%s\ntarget=%s\nstatus=ready-to-install\n' \
    "$EXPECTED_ARCHIVE_SHA256" "$EXPECTED_PART_COUNT" "$TARGET"
  exit 0
fi

[[ $(id -u) == 0 ]] || fail 'Run --install with sudo'
[[ "$(dpkg --print-architecture)" == "arm64" ]] || fail 'This runtime is ARM64 only'

temporary_install="$(mktemp -d /opt/.tikpal-chromium-install.XXXXXX)"
tar --no-same-owner --no-same-permissions -xzf "$ARCHIVE" -C "$temporary_install"
[[ -x "$temporary_install/$PACKAGE/chromium" ]] || fail 'Extracted Chromium launcher is missing'
[[ "$(sha256sum "$temporary_install/$PACKAGE/chromium" | awk '{print $1}')" == "$EXPECTED_CHROMIUM_SHA256" ]] ||
  fail 'Extracted Chromium checksum does not match the production release'
chown -R root:root "$temporary_install/$PACKAGE"
chmod 755 "$temporary_install/$PACKAGE/chromium"
chmod 4755 "$temporary_install/$PACKAGE/chrome-sandbox"
mv "$temporary_install/$PACKAGE" "$TARGET"
printf 'installed=%s\nchromium_sha256=%s\n' "$TARGET" "$EXPECTED_CHROMIUM_SHA256"

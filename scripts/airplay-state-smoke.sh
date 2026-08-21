#!/bin/sh
set -eu

workspace="$(mktemp -d)"
cleanup() {
  rm -rf "$workspace"
}
trap cleanup EXIT INT TERM

fake_bin="$workspace/bin"
mkdir -p "$fake_bin"

cat > "$fake_bin/busctl" <<'EOF'
#!/bin/sh
case "${TIKPAL_TEST_MPRIS_STATUS:-}" in
  Playing|Paused|Stopped) printf 's "%s"\n' "$TIKPAL_TEST_MPRIS_STATUS" ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$fake_bin/busctl"

cat > "$fake_bin/sqlite3" <<'EOF'
#!/bin/sh
case "$2" in
  *airplaysvc*) printf '%s\n' "${TIKPAL_TEST_AIRPLAY_READY:-0}" ;;
  *aplactive*) printf '%s\n' "${TIKPAL_TEST_AIRPLAY_ACTIVE:-0}" ;;
esac
EOF
chmod +x "$fake_bin/sqlite3"

cat > "$fake_bin/ss" <<'EOF'
#!/bin/sh
if [ "${TIKPAL_TEST_AIRPLAY_TCP:-0}" = "1" ]; then
  printf '%s\n' 'ESTAB 0 0 127.0.0.1:5000 127.0.0.1:50428'
fi
EOF
chmod +x "$fake_bin/ss"

state_script="$(cd "$(dirname "$0")/.." && pwd)/deploy/moode/tikpal-airplay-state.sh"

env PATH="$fake_bin:$PATH" TIKPAL_MOODE_SQLITE_DB="$workspace/moode.db" TIKPAL_TEST_MPRIS_STATUS=Playing TIKPAL_TEST_AIRPLAY_TCP=1 "$state_script" active
env PATH="$fake_bin:$PATH" TIKPAL_MOODE_SQLITE_DB="$workspace/moode.db" TIKPAL_TEST_MPRIS_STATUS=Paused TIKPAL_TEST_AIRPLAY_TCP=1 "$state_script" connected

if env PATH="$fake_bin:$PATH" TIKPAL_MOODE_SQLITE_DB="$workspace/moode.db" TIKPAL_TEST_MPRIS_STATUS=Playing TIKPAL_TEST_AIRPLAY_TCP=0 TIKPAL_TEST_AIRPLAY_ACTIVE=0 "$state_script" active; then
  printf '%s\n' 'expected MPRIS without a sender socket to be inactive' >&2
  exit 1
fi

if env PATH="$fake_bin:$PATH" TIKPAL_MOODE_SQLITE_DB="$workspace/moode.db" TIKPAL_TEST_MPRIS_STATUS=Stopped TIKPAL_TEST_AIRPLAY_TCP=1 TIKPAL_TEST_AIRPLAY_ACTIVE=0 "$state_script" active; then
  printf '%s\n' 'expected stopped MPRIS to be inactive' >&2
  exit 1
fi

env PATH="$fake_bin:$PATH" TIKPAL_MOODE_SQLITE_DB="$workspace/moode.db" TIKPAL_TEST_AIRPLAY_ACTIVE=1 "$state_script" active
env PATH="$fake_bin:$PATH" TIKPAL_MOODE_SQLITE_DB="$workspace/moode.db" TIKPAL_TEST_AIRPLAY_READY=1 "$state_script" ready

printf '%s\n' 'airplay state smoke passed'

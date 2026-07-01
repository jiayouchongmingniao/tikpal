#!/bin/sh
set -eu

metadata_file="${TIKPAL_AIRPLAY_METADATA_FILE:-/var/local/www/aplmeta.txt}"
metadata_json_file="${TIKPAL_AIRPLAY_METADATA_JSON_FILE:-/var/local/www/aplmeta.json}"
max_age_seconds="${TIKPAL_AIRPLAY_METADATA_MAX_AGE_SECONDS:-3600}"
artwork_max_lag_seconds="${TIKPAL_AIRPLAY_ARTWORK_MAX_LAG_SECONDS:-1}"
event_log="${TIKPAL_AIRPLAY_EVENT_LOG:-/var/log/moode_spsevent.log}"
metadata_clock_lead_ms="${TIKPAL_AIRPLAY_METADATA_CLOCK_LEAD_MS:-1000}"
clock_state_file="${TIKPAL_AIRPLAY_CLOCK_STATE_FILE:-/tmp/tikpal-airplay-clock-state}"
mpris_service="${TIKPAL_AIRPLAY_MPRIS_SERVICE:-org.mpris.MediaPlayer2.ShairportSync}"
mpris_path="${TIKPAL_AIRPLAY_MPRIS_PATH:-/org/mpris/MediaPlayer2}"
mpris_interface="${TIKPAL_AIRPLAY_MPRIS_INTERFACE:-org.mpris.MediaPlayer2.Player}"

now="$(date +%s)"
case "$max_age_seconds" in
  ''|*[!0-9]*) max_age_seconds=0 ;;
esac

active_started_at=0
active_stopped_at=0
has_event_clock=0
if [ -r "$event_log" ]; then
  last_started="$(awk '/Event: Run spspre.sh/ {stamp = $1 " " $2} END {print stamp}' "$event_log")"
  last_stopped="$(awk '/Event: Run spspost.sh/ {stamp = $1 " " $2} END {print stamp}' "$event_log")"
  if [ -n "$last_started$last_stopped" ]; then
    has_event_clock=1
  fi
  if [ -n "$last_started" ]; then
    active_started_at="$(printf '%s\n' "$last_started" | sed -E 's/^([0-9]{4})([0-9]{2})([0-9]{2}) ([0-9]{2})([0-9]{2})([0-9]{2})$/\1-\2-\3 \4:\5:\6/' | while read -r stamp; do date -d "$stamp" +%s 2>/dev/null || printf '0'; done)"
  fi
  if [ -n "$last_stopped" ]; then
    active_stopped_at="$(printf '%s\n' "$last_stopped" | sed -E 's/^([0-9]{4})([0-9]{2})([0-9]{2}) ([0-9]{2})([0-9]{2})([0-9]{2})$/\1-\2-\3 \4:\5:\6/' | while read -r stamp; do date -d "$stamp" +%s 2>/dev/null || printf '0'; done)"
  fi
fi
active_started_at="${active_started_at:-0}"
active_stopped_at="${active_stopped_at:-0}"

metadata_payload="$(
  python3 - "$metadata_file" "$metadata_json_file" "$max_age_seconds" "$artwork_max_lag_seconds" "$now" "$mpris_service" "$mpris_path" "$mpris_interface" <<'PY'
import json
import os
import subprocess
import sys

metadata_file, metadata_json_file, max_age, artwork_max_lag, now, mpris_service, mpris_path, mpris_interface = sys.argv[1:]
max_age = int(max_age)
try:
    artwork_max_lag = int(artwork_max_lag)
except ValueError:
    artwork_max_lag = 1
now = int(now)


def clean(value):
    return " ".join(str(value or "").split())


def comparable(value):
    return clean(value).casefold()


def same_track(left, right):
    if not left or not right:
        return False
    left_title = comparable(left.get("title"))
    right_title = comparable(right.get("title"))
    if not left_title or left_title != right_title:
        return False

    left_artist = comparable(left.get("artist"))
    right_artist = comparable(right.get("artist"))
    if left_artist and right_artist and left_artist != right_artist and left_artist not in right_artist and right_artist not in left_artist:
        return False
    return True


def supplement_payload(primary, fallback):
    if not primary or not same_track(primary, fallback):
        return primary
    for key in (
        "artist",
        "album",
        "duration_ms",
        "artwork_url",
        "artwork_path",
        "format",
        "status",
        "raw_position_ms",
    ):
        if not clean(primary.get(key)) and clean(fallback.get(key)):
            primary[key] = fallback.get(key)
    return primary


def stat_mtime(path):
    try:
        return int(os.stat(path).st_mtime)
    except OSError:
        return 0


def is_recent(path):
    mtime = stat_mtime(path)
    if mtime <= 0:
        return False
    return max_age <= 0 or now - mtime <= max_age


def valid_duration_ms(value):
    try:
        duration = float(value)
    except (TypeError, ValueError):
        return ""
    if duration >= 1000 and duration < 86400000:
        return str(int(duration))
    return ""


def web_artwork_url(path_or_url):
    value = clean(path_or_url)
    if value.startswith("file://"):
        value = value[7:]
    if value.startswith("/var/local/www/"):
        return "/" + value[len("/var/local/www/"):]
    if value.startswith("/"):
        return value
    return "/" + value if value else ""


def artwork_path(path_or_url):
    value = clean(path_or_url)
    if value.startswith("file://"):
        value = value[7:]
    if value.startswith("/var/local/www/"):
        return value
    if value.startswith("imagesw/"):
        return "/var/local/www/" + value
    if value.startswith("/imagesw/"):
        return "/var/local/www" + value
    return ""


def emit(fields):
    for key, value in fields:
        print(f"{key}={clean(value)}")


def with_fresh_artwork(payload):
    artwork = payload.get("artwork_path", "")
    source_mtime = int(payload.get("source_mtime") or 0)
    artwork_mtime = stat_mtime(artwork) if artwork else 0
    if artwork and (artwork_mtime <= 0 or (artwork_max_lag > 0 and source_mtime > 0 and artwork_mtime + artwork_max_lag < source_mtime)):
        payload["artwork_url"] = ""
        payload["artwork_path"] = ""
        artwork_mtime = 0
    payload["artwork_mtime_ms"] = str(artwork_mtime * 1000) if artwork_mtime > 0 else ""
    return payload


def read_txt_metadata():
    if not os.path.isfile(metadata_file) or os.path.getsize(metadata_file) == 0 or not is_recent(metadata_file):
        return None
    with open(metadata_file, "r", encoding="utf-8", errors="ignore") as handle:
        for line in handle:
            parts = line.rstrip("\n").split("~~~")
            if parts and clean(parts[0]):
                cover = parts[4] if len(parts) > 4 else ""
                return {
                    "title": parts[0],
                    "artist": parts[1] if len(parts) > 1 else "",
                    "album": parts[2] if len(parts) > 2 else "",
                    "duration_ms": valid_duration_ms(parts[3] if len(parts) > 3 else ""),
                    "artwork_url": web_artwork_url(cover),
                    "artwork_path": artwork_path(cover),
                    "format": parts[5] if len(parts) > 5 else "",
                    "status": "playing",
                    "source_mtime": stat_mtime(metadata_file),
                    "metadata_source": "txt",
                    "raw_position_ms": "",
                }
    return None


def busctl_json(property_name):
    try:
        completed = subprocess.run(
            [
                "busctl",
                "--json=short",
                "--system",
                "get-property",
                mpris_service,
                mpris_path,
                mpris_interface,
                property_name,
            ],
            check=True,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=1.5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    try:
        return json.loads(completed.stdout).get("data")
    except (json.JSONDecodeError, AttributeError):
        return None


def variant_value(metadata, key, default=""):
    value = metadata.get(key, {})
    if isinstance(value, dict):
        return value.get("data", default)
    return default


def read_mpris_metadata():
    metadata = busctl_json("Metadata")
    if not isinstance(metadata, dict):
        return None
    title = clean(variant_value(metadata, "xesam:title"))
    if not title:
        return None
    artists = variant_value(metadata, "xesam:artist", [])
    artist = ", ".join(clean(part) for part in artists if clean(part)) if isinstance(artists, list) else clean(artists)
    art = clean(variant_value(metadata, "mpris:artUrl"))
    local_artwork_path = artwork_path(art)
    source_mtime = stat_mtime(local_artwork_path) or now
    status = clean(busctl_json("PlaybackStatus")).lower() or "playing"
    position = busctl_json("Position")
    try:
        raw_position_ms = str(int(position) // 1000) if int(position) > 0 else ""
    except (TypeError, ValueError):
        raw_position_ms = ""
    try:
        duration_ms = str(int(variant_value(metadata, "mpris:length")) // 1000)
    except (TypeError, ValueError):
        duration_ms = ""
    return {
        "title": title,
        "artist": artist,
        "album": clean(variant_value(metadata, "xesam:album")),
        "duration_ms": duration_ms if duration_ms != "0" else "",
        "artwork_url": web_artwork_url(art),
        "artwork_path": local_artwork_path,
        "format": "",
        "status": status,
        "source_mtime": source_mtime,
        "metadata_source": "mpris",
        "raw_position_ms": raw_position_ms,
    }


def read_json_metadata():
    if not os.path.isfile(metadata_json_file) or not is_recent(metadata_json_file):
        return None
    with open(metadata_json_file, "r", encoding="utf-8", errors="ignore") as handle:
        metadata = json.load(handle)
    title = clean(metadata.get("title"))
    if not title:
        return None
    cover = clean(metadata.get("cover_url"))
    return {
        "title": title,
        "artist": clean(metadata.get("artist")),
        "album": clean(metadata.get("album")),
        "duration_ms": valid_duration_ms(metadata.get("duration")),
        "artwork_url": web_artwork_url(cover),
        "artwork_path": artwork_path(cover),
        "format": clean(metadata.get("sformat") or metadata.get("oformat")),
        "status": "playing",
        "source_mtime": stat_mtime(metadata_json_file),
        "metadata_source": "json",
        "raw_position_ms": "",
    }


payloads = []
for reader in (read_mpris_metadata, read_json_metadata, read_txt_metadata):
    try:
        payload = reader()
    except (OSError, json.JSONDecodeError):
        payload = None
    if payload:
        payloads.append(payload)

if payloads:
    payload = payloads[0]
    for fallback in payloads[1:]:
        payload = supplement_payload(payload, fallback)
    payload = with_fresh_artwork(payload)
    emit(
        [
            ("title", payload["title"]),
            ("artist", payload["artist"]),
            ("album", payload["album"]),
            ("durationMs", payload["duration_ms"]),
            ("artworkUrl", payload["artwork_url"]),
            ("artworkPath", payload["artwork_path"]),
            ("artworkMtimeMs", payload["artwork_mtime_ms"]),
            ("format", payload["format"]),
            ("status", payload["status"]),
            ("metadataSource", payload["metadata_source"]),
            ("metadataSourceMtimeSeconds", payload["source_mtime"]),
            ("rawPositionMs", payload["raw_position_ms"]),
        ]
    )
    raise SystemExit(0)

raise SystemExit(1)
PY
)" || exit 1

file_mtime="$(printf '%s\n' "$metadata_payload" | awk -F '=' '$1 == "metadataSourceMtimeSeconds" { print $2; exit }')"
file_mtime="${file_mtime:-0}"
raw_position_ms="$(printf '%s\n' "$metadata_payload" | awk -F '=' '$1 == "rawPositionMs" { print $2; exit }')"
if [ "$has_event_clock" -eq 1 ] && [ "$active_started_at" -lt "$active_stopped_at" ] && [ "$file_mtime" -le "$active_stopped_at" ]; then
  rm -f "$clock_state_file" >/dev/null 2>&1 || true
  exit 1
fi
metadata_key="$(
  printf '%s\n' "$metadata_payload" | awk -F '=' '
    $1 == "title" { title = substr($0, index($0, "=") + 1) }
    $1 == "artist" { artist = substr($0, index($0, "=") + 1) }
    $1 == "album" { album = substr($0, index($0, "=") + 1) }
    END {
      if (length(title) > 0) print title "\034" artist "\034" album;
    }
  '
)"
if [ -z "$metadata_key" ]; then
  exit 1
fi

if command -v sha1sum >/dev/null 2>&1; then
  metadata_key_hash="$(printf '%s' "$metadata_key" | sha1sum | awk '{print $1}')"
else
  metadata_key_hash="$(printf '%s' "$metadata_key" | cksum | awk '{print $1}')"
fi

position_ms=""
clock_start=0
clock_start_reason=""
clock_lead_ms=0
if [ "$active_started_at" -gt "$active_stopped_at" ]; then
  clock_start="$active_started_at"
  clock_start_reason="airplay_event"
fi

if [ "$file_mtime" -gt 0 ] && { [ "$clock_start" -eq 0 ] || [ "$file_mtime" -gt "$clock_start" ]; }; then
  clock_start="$file_mtime"
  clock_start_reason="metadata_mtime"
  if printf '%s\n' "$metadata_clock_lead_ms" | grep -Eq '^[0-9]+$'; then
    clock_lead_ms="$metadata_clock_lead_ms"
  fi
fi

if [ "$clock_start" -gt 0 ]; then
  state_key_hash=""
  state_clock_start=0
  state_started_at=0
  state_clock_reason=""
  if [ -r "$clock_state_file" ]; then
    read -r state_key_hash state_clock_start state_started_at state_clock_reason < "$clock_state_file" || true
  fi
  state_clock_start="${state_clock_start:-0}"
  state_started_at="${state_started_at:-0}"
  if [ "$metadata_key_hash" = "$state_key_hash" ] \
    && [ "$active_started_at" -eq "$state_started_at" ] \
    && [ "$state_clock_start" -gt 0 ] \
    && [ "$state_clock_start" -le "$now" ]; then
    clock_start="$state_clock_start"
    if [ "$state_clock_reason" = "metadata_mtime" ] || [ "$state_clock_reason" = "persisted_metadata_mtime" ]; then
      clock_start_reason="persisted_metadata_mtime"
    else
      clock_start_reason="${state_clock_reason:-persisted_metadata_mtime}"
    fi
    if printf '%s\n' "$metadata_clock_lead_ms" | grep -Eq '^[0-9]+$' \
      && [ "$clock_start_reason" != "airplay_event" ]; then
      clock_lead_ms="$metadata_clock_lead_ms"
    fi
  elif [ -n "$metadata_key_hash" ]; then
    printf '%s %s %s %s\n' "$metadata_key_hash" "$clock_start" "$active_started_at" "$clock_start_reason" > "$clock_state_file" 2>/dev/null || true
  fi

  if [ "$clock_start" -gt 0 ] && [ "$now" -ge "$clock_start" ]; then
    position_ms=$(((now - clock_start) * 1000 + clock_lead_ms))
  fi
fi

if printf '%s\n' "$raw_position_ms" | grep -Eq '^[0-9]+$' && [ "$raw_position_ms" -gt 0 ]; then
  position_ms="$raw_position_ms"
fi

printf '%s\n' "$metadata_payload" | awk -F '=' '
  $1 != "metadataSourceMtimeSeconds" && $1 != "rawPositionMs" { print }
'
printf 'positionMs=%s\n' "$position_ms"
printf 'metadataMtimeMs=%s\n' "$((file_mtime * 1000))"
printf 'airplayStartedAtMs=%s\n' "$((active_started_at * 1000))"
printf 'airplayStoppedAtMs=%s\n' "$((active_stopped_at * 1000))"
printf 'clockStartMs=%s\n' "$((clock_start * 1000))"
printf 'clockStartReason=%s\n' "$clock_start_reason"
printf 'clockLeadMs=%s\n' "$clock_lead_ms"
printf 'effectiveClockStartMs=%s\n' "$((clock_start * 1000 - clock_lead_ms))"

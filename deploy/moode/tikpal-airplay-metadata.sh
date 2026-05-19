#!/bin/sh
set -eu

metadata_file="${TIKPAL_AIRPLAY_METADATA_FILE:-/var/local/www/aplmeta.txt}"
max_age_seconds="${TIKPAL_AIRPLAY_METADATA_MAX_AGE_SECONDS:-3600}"
event_log="${TIKPAL_AIRPLAY_EVENT_LOG:-/var/log/moode_spsevent.log}"
metadata_clock_lead_ms="${TIKPAL_AIRPLAY_METADATA_CLOCK_LEAD_MS:-1000}"
clock_state_file="${TIKPAL_AIRPLAY_CLOCK_STATE_FILE:-/tmp/tikpal-airplay-clock-state}"

if [ ! -s "$metadata_file" ]; then
  exit 1
fi

file_mtime=0
now="$(date +%s)"
if command -v stat >/dev/null 2>&1; then
  file_mtime="$(stat -c %Y "$metadata_file" 2>/dev/null || printf '0')"
  if [ "$file_mtime" -gt 0 ] && [ "$max_age_seconds" -gt 0 ] && [ $((now - file_mtime)) -gt "$max_age_seconds" ]; then
    exit 1
  fi
fi

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

if [ "$has_event_clock" -eq 1 ] && [ "$active_started_at" -le "$active_stopped_at" ]; then
  rm -f "$clock_state_file" >/dev/null 2>&1 || true
  exit 1
fi

metadata_key="$(
  awk -F '~~~' 'NF >= 1 && length($1) > 0 { print $1 "\034" $2 "\034" $3; exit }' "$metadata_file"
)"
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
  if [ "$file_mtime" -gt "$clock_start" ]; then
    clock_start="$file_mtime"
    clock_start_reason="metadata_mtime"
    if printf '%s\n' "$metadata_clock_lead_ms" | grep -Eq '^[0-9]+$'; then
      clock_lead_ms="$metadata_clock_lead_ms"
    fi
  fi

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
  elif [ -n "$metadata_key_hash" ] && [ "$clock_start" -gt 0 ]; then
    printf '%s %s %s %s\n' "$metadata_key_hash" "$clock_start" "$active_started_at" "$clock_start_reason" > "$clock_state_file" 2>/dev/null || true
  fi

  if [ "$clock_start" -gt 0 ] && [ "$now" -ge "$clock_start" ]; then
    position_ms=$(((now - clock_start) * 1000 + clock_lead_ms))
  fi
fi

awk -F '~~~' '
  NF >= 1 && length($1) > 0 {
    duration_ms = "";
    if ($4 ~ /^[0-9]+([.][0-9]+)?$/ && ($4 + 0) >= 1000 && ($4 + 0) < 86400000) {
      duration_ms = int($4 + 0);
    }
    print "title=" $1;
    print "artist=" $2;
    print "album=" $3;
    print "positionMs=" position_ms;
    print "durationMs=" duration_ms;
    print "metadataMtimeMs=" metadata_mtime_ms;
    print "airplayStartedAtMs=" airplay_started_at_ms;
    print "airplayStoppedAtMs=" airplay_stopped_at_ms;
    print "clockStartMs=" clock_start_ms;
    print "clockStartReason=" clock_start_reason;
    print "clockLeadMs=" clock_lead_ms;
    print "effectiveClockStartMs=" effective_clock_start_ms;
    print "artworkUrl=/" $5;
    print "format=" $6;
    print "status=playing";
    found = 1;
  }
  END {
    if (!found) exit 1;
  }
' \
  position_ms="$position_ms" \
  metadata_mtime_ms="$((file_mtime * 1000))" \
  airplay_started_at_ms="$((active_started_at * 1000))" \
  airplay_stopped_at_ms="$((active_stopped_at * 1000))" \
  clock_start_ms="$((clock_start * 1000))" \
  clock_start_reason="$clock_start_reason" \
  clock_lead_ms="$clock_lead_ms" \
  effective_clock_start_ms="$((clock_start * 1000 - clock_lead_ms))" \
  "$metadata_file"

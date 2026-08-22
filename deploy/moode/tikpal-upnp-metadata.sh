#!/usr/bin/env bash
set -euo pipefail

metadata_json_file="${TIKPAL_UPNP_METADATA_JSON_FILE:-/var/local/www/upnpmeta.json}"
metadata_file="${TIKPAL_UPNP_METADATA_FILE:-/var/local/www/upnpmeta.txt}"
max_age_seconds="${TIKPAL_UPNP_METADATA_MAX_AGE_SECONDS:-600}"
journal_command="${TIKPAL_UPNP_METADATA_JOURNAL_COMMAND:-journalctl -u upmpdcli.service -n 320 -o short-unix --no-pager}"
now="$(date +%s)"

case "$max_age_seconds" in
  ''|*[!0-9]*) max_age_seconds=0 ;;
esac

python3 - "$metadata_json_file" "$metadata_file" "$max_age_seconds" "$now" "$journal_command" <<'PY'
import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

json_path, text_path, max_age, now, journal_command = sys.argv[1:]
max_age = int(max_age)
now = int(now)


def clean(value):
    return " ".join(str(value or "").split())


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


def parse_time_ms(value):
    value = clean(value)
    if not value:
        return ""
    if re.fullmatch(r"\d+(?:\.\d+)?", value):
        number = float(value)
        return str(int(number if number >= 1000 else number * 1000))
    match = re.fullmatch(r"(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.\d+)?", value)
    if not match:
        return ""
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2))
    seconds = int(match.group(3))
    return str(((hours * 60 + minutes) * 60 + seconds) * 1000)


def first_value(payload, keys):
    if not isinstance(payload, dict):
        return ""
    lowered = {str(key).lower(): value for key, value in payload.items()}
    for key in keys:
        if key.lower() in lowered:
            value = lowered[key.lower()]
            if isinstance(value, list):
                value = ", ".join(clean(entry) for entry in value if clean(entry))
            if clean(value):
                return clean(value)
    for value in payload.values():
        if isinstance(value, dict):
            found = first_value(value, keys)
            if found:
                return found
    return ""


def remote_artwork_url(value):
    value = clean(value)
    if value.startswith(("http://", "https://", "data:image/")):
        return value
    return ""


def parse_didl(value):
    value = clean(value)
    if not value or "<" not in value:
        return {}
    if " qq=" in value and "xmlns:qq=" not in value:
        value = value.replace(" qq=", " xmlns:qq=", 1)
    try:
        root = ET.fromstring(value)
    except ET.ParseError:
        return {}

    def local_name(tag):
        return tag.rsplit("}", 1)[-1].lower()

    result = {}
    for element in root.iter():
        name = local_name(element.tag)
        text = clean(element.text)
        if name in ("title", "originaltracktitle") and text and not result.get("title"):
            result["title"] = text
        elif name in ("artist", "creator", "performer") and text and not result.get("artist"):
            result["artist"] = text
        elif name == "album" and text and not result.get("album"):
            result["album"] = text
        elif name == "albumarturi" and text and not result.get("artworkUrl"):
            result["artworkUrl"] = remote_artwork_url(text)
        elif name == "res" and not result.get("durationMs"):
            duration = parse_time_ms(element.attrib.get("duration"))
            if duration:
                result["durationMs"] = duration
    return result


def read_json_payload():
    if not os.path.isfile(json_path) or not is_recent(json_path):
        return {}
    try:
        with open(json_path, "r", encoding="utf-8", errors="ignore") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {}

    didl = parse_didl(first_value(payload, [
        "CurrentTrackMetaData",
        "currentTrackMetaData",
        "metadata",
        "trackMetaData",
        "TrackMetaData",
    ]))
    result = {
        **didl,
        "title": first_value(payload, ["title", "dc:title", "upnp:originalTrackTitle", "originalTrackTitle", "track", "name"]) or didl.get("title", ""),
        "artist": first_value(payload, ["artist", "upnp:artist", "upnp:performer", "creator", "dc:creator"]) or didl.get("artist", ""),
        "album": first_value(payload, ["album", "upnp:album"]) or didl.get("album", ""),
        "artworkUrl": remote_artwork_url(first_value(payload, [
            "albumArtURI",
            "upnp:albumArtURI",
            "artworkUrl",
            "artwork_url",
            "coverUrl",
            "cover_url",
            "artUrl",
        ])) or didl.get("artworkUrl", ""),
        "durationMs": parse_time_ms(first_value(payload, [
            "durationMs",
            "duration_ms",
            "duration",
            "CurrentTrackDuration",
            "currentTrackDuration",
        ])) or didl.get("durationMs", ""),
        "positionMs": parse_time_ms(first_value(payload, [
            "positionMs",
            "position_ms",
            "position",
            "RelTime",
            "relTime",
            "relativeTimePosition",
        ])),
        "status": first_value(payload, ["status", "state", "transportState", "PlaybackStatus"]),
        "metadataMtimeMs": str(stat_mtime(json_path) * 1000),
    }
    return result


def read_text_payload():
    if not os.path.isfile(text_path) or not is_recent(text_path):
        return {}
    result = {}
    try:
        with open(text_path, "r", encoding="utf-8", errors="ignore") as handle:
            for line in handle:
                match = re.match(r"^([A-Za-z][A-Za-z0-9_-]*)=(.*)$", line.rstrip("\n"))
                if match:
                    result[match.group(1)] = clean(match.group(2))
    except OSError:
        return {}
    if result:
        result.setdefault("metadataMtimeMs", str(stat_mtime(text_path) * 1000))
    return result


def parse_journal_timestamp(line):
    match = re.match(r"^(\d+(?:\.\d+)?)\s+", line)
    if not match:
        return now
    try:
        return int(float(match.group(1)))
    except ValueError:
        return now


def read_journal_payload():
    if not journal_command:
        return {}
    try:
        completed = subprocess.run(
            journal_command,
            shell=True,
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=2,
        )
    except Exception:
        return {}

    latest = {}
    latest_seen_at = 0
    for line in completed.stdout.splitlines():
        if "metadata [" not in line or "DIDL-Lite" not in line:
            continue
        seen_at = parse_journal_timestamp(line)
        if max_age > 0 and now - seen_at > max_age:
            continue
        match = re.search(r"metadata \[(<\?xml.*)\]\s*$", line)
        if not match:
            match = re.search(r"metadata \[(<.*DIDL-Lite.*)\]\s*$", line)
        if not match:
            continue
        didl = parse_didl(match.group(1))
        if not didl.get("title"):
            continue
        rejected_stream = "unsupported format" in line or "resource has no protocolinfo" in line
        latest = {
            **didl,
            "status": "stopped" if rejected_stream else "playing",
            "metadataSource": "upmpdcli_journal",
            "metadataMtimeMs": str(seen_at * 1000),
            "metadataOnly": "true" if rejected_stream else "",
            "streamAvailable": "false" if rejected_stream else "",
        }
        latest_seen_at = seen_at

    if latest and not latest.get("metadataMtimeMs") and latest_seen_at:
        latest["metadataMtimeMs"] = str(latest_seen_at * 1000)
    return latest


def normalized_status(value):
    value = clean(value).lower()
    if value in ("playing", "play", "transport_playing"):
        return "playing"
    if value in ("paused", "pause", "paused_playback", "transport_paused"):
        return "paused"
    if value in ("stopped", "stop", "no_media_present", "transport_stopped"):
        return "stopped"
    return value


payload = read_json_payload() or read_text_payload() or read_journal_payload()
title = clean(payload.get("title") or payload.get("Title"))
if not title:
    sys.exit(0)

position_ms = parse_time_ms(payload.get("positionMs") or payload.get("position_ms") or payload.get("position"))
duration_ms = parse_time_ms(payload.get("durationMs") or payload.get("duration_ms") or payload.get("duration"))
position_confidence = "trusted" if position_ms and int(position_ms) > 0 else "none"

fields = {
    "title": title,
    "artist": clean(payload.get("artist") or payload.get("Artist")),
    "album": clean(payload.get("album") or payload.get("Album")),
    "status": normalized_status(payload.get("status") or payload.get("state") or payload.get("transportState")) or "playing",
    "positionMs": position_ms,
    "durationMs": duration_ms,
    "artworkUrl": remote_artwork_url(payload.get("artworkUrl") or payload.get("artwork_url") or payload.get("coverUrl") or payload.get("cover_url")),
    "metadataSource": clean(payload.get("metadataSource") or payload.get("metadata_source")) or "upmpdcli",
    "metadataMtimeMs": clean(payload.get("metadataMtimeMs") or payload.get("metadata_mtime_ms")),
    "metadataOnly": clean(payload.get("metadataOnly") or payload.get("metadata_only")),
    "streamAvailable": clean(payload.get("streamAvailable") or payload.get("stream_available")),
    "positionTrusted": "true" if position_confidence == "trusted" else "false",
    "positionConfidence": position_confidence,
}

for key, value in fields.items():
    value = clean(value)
    if value:
        print(f"{key}={value}")
PY

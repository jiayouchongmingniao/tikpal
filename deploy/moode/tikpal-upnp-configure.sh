#!/usr/bin/env bash
set -euo pipefail

config_file="${TIKPAL_UPNP_CONFIG_FILE:-/etc/upmpdcli.conf}"
description_file="${TIKPAL_UPNP_DESCRIPTION_FILE:-/usr/share/upmpdcli/description.xml}"
friendly_name="${TIKPAL_UPNP_FRIENDLY_NAME:-$(hostname) UPNP}"
av_friendly_name="${TIKPAL_UPNP_AV_FRIENDLY_NAME:-${friendly_name}-UPnP/AV}"
check_content_format="${TIKPAL_UPNP_CHECK_CONTENT_FORMAT:-0}"
restart="${TIKPAL_UPNP_CONFIGURE_RESTART:-1}"

run_root() {
  if [[ "$(id -u)" == "0" ]]; then
    "$@"
    return
  fi
  if command -v sudo >/dev/null 2>&1; then
    sudo -n "$@"
    return
  fi
  "$@"
}

set_config_value() {
  local key="$1"
  local value="$2"
  run_root python3 - "$config_file" "$key" "$value" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
line = f"{key} = {value}"
lines = path.read_text().splitlines()
for index, current in enumerate(lines):
    stripped = current.strip()
    if stripped.startswith(f"{key} ") or stripped.startswith(f"{key}="):
        lines[index] = line
        break
else:
    lines.append(line)
path.write_text("\n".join(lines).rstrip() + "\n")
PY
}

patch_description_template() {
  [[ -f "$description_file" ]] || return 0
  run_root python3 - "$description_file" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
text = path.read_text()
replacements = {
    "manufacturer": "JF Light Industries",
    "manufacturerURL": "https://framagit.org/medoc92",
    "modelDescription": "UPnP front-end to MPD",
    "modelName": "UpMPD",
    "modelNumber": "42",
}
for tag, value in replacements.items():
    text = re.sub(fr"<{tag}>.*?</{tag}>", f"<{tag}>{value}</{tag}>", text, count=1, flags=re.S)
path.write_text(text)
PY
}

set_config_value "friendlyname" "$friendly_name"
set_config_value "avfriendlyname" "$av_friendly_name"
set_config_value "upnpav" "1"
set_config_value "openhome" "0"
set_config_value "checkcontentformat" "$check_content_format"
set_config_value "ohproductroom" "$friendly_name"
patch_description_template

if [[ "$restart" == "1" ]]; then
  run_root systemctl restart upmpdcli.service avahi-daemon.service
fi

printf 'friendlyname=%s\n' "$friendly_name"
printf 'avfriendlyname=%s\n' "$av_friendly_name"
printf 'checkcontentformat=%s\n' "$check_content_format"

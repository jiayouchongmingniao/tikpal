#!/usr/bin/env bash
set -euo pipefail

SQLITE_BIN="${TIKPAL_SQLITE_BIN:-sqlite3}"
SQLDB="${TIKPAL_MOODE_SQLITE_DB:-/var/local/www/db/moode-sqlite3.db}"
FORCE="${TIKPAL_RADIO_PRESETS_FORCE:-0}"
SQL_FILE=""

cleanup() {
  [[ -z "${SQL_FILE:-}" ]] || rm -f "$SQL_FILE"
}
trap cleanup EXIT

rows=(
  "500|https://channels.fluxfm.de/chillhop/stream.mp3|Focus - FluxFM ChillHop|r|local|Focus, Lo-fi, Chillhop, Study Beats|FluxFM|German|Germany|Europe|256|MP3|No||No"
  "501|http://ice1.somafm.com/beatblender-128-mp3|Focus - Soma FM Beat Blender|r|local|Focus, Downtempo, Deep House, Study|Soma FM|English|United States|North America|128|MP3|No||No"
  "502|http://ice1.somafm.com/groovesalad-128-aac|Focus - Soma FM Groove Salad|r|local|Focus, Electronica, Ambient, Down-Tempo|Soma FM|English|United States|North America|128|AAC|No||No"
  "510|https://streaming.positivity.radio/pr/posimeditation/icecast.audio|Calm - Positively Meditation|r|local|Calm, Meditation, Healing, Mindfulness|Positivity Radio|English|United Kingdom|Europe|128|MP3|No||No"
  "511|https://channels.fluxfm.de/chillout-radio/stream.mp3|Calm - FluxFM Chillout|r|local|Calm, Chill Out, Laidback|FluxFM|German|Germany|Europe|256|MP3|No||No"
  "512|http://ice1.somafm.com/synphaera-128-mp3|Calm - Soma FM Synphaera|r|local|Calm, Ambient, Meditation, Space|Soma FM|English|United States|North America|128|MP3|No||No"
  "520|http://radio.stereoscenic.com/asp-h|Sleep - Ambient Sleeping Pill|r|local|Sleep, Electronica, Ambient|Stereoscenic|English|United States|North America|256|MP3|No||No"
  "521|http://ice1.somafm.com/dronezone-128-aac|Sleep - Soma FM Drone Zone|r|local|Sleep, Electronica, Ambient, Texture|Soma FM|English|United States|North America|128|AAC|No||No"
  "522|http://ice1.somafm.com/deepspaceone-128-aac|Sleep - Soma FM Deep Space One|r|local|Sleep, Electronica, Ambient, Space Music|Soma FM|English|United States|North America|128|AAC|No||No"
  "530|https://knkx-live-a.edge.audiocdn.com/6285_256k|Jazz - Jazz24|r|local|Jazz|Jazz24.org|English|United States|North America|256|AAC|No||No"
  "531|https://west-mp3-128.streamthejazzgroove.com/stream|Jazz - The Jazz Groove|r|local|Jazz|The Jazz Groove|English|United States|North America|128|MP3|No||No"
  "532|http://linn.co.uk:8000/autodj|Jazz - Linn Jazz|r|local|Jazz|Linn|English|United Kingdom|Europe|320|MP3|No||No"
  "540|https://dispatcher.rndfnk.com/br/brklassik/live/mp3/high|Classical - BR-Klassik|r|local|Classical|Bayern Radio|German|Germany|Europe|192|MP3|No||No"
  "541|http://icecast.omroep.nl/radio4-bb-mp3|Classical - NPO Klassiek|r|local|Classical|NPO|Dutch|Netherlands|Europe|192|MP3|No||No"
  "542|http://linn.co.uk:8004/autodj|Classical - Linn Classical|r|local|Classical|Linn|English|United Kingdom|Europe|320|MP3|No||No"
  "550|https://npr-ice.streamguys1.com/live.mp3|News - NPR Program Stream|r|local|News, Public Radio, Talk|NPR|English|United States|North America|128|MP3|No||No"
  "551|http://live-icy.dr.dk/A/A03H.mp3|News - DR P1|r|local|News, Talk|DR|Danish|Denmark|Europe|128|MP3|No||No"
  "552|http://streaming.swisstxt.ch/m/drs4news/mp3_128|News - Radio SRF 4 News|r|local|News, Current Affairs|SRF|German|Switzerland|Europe|128|MP3|No||No"
  "560|https://stream.radioparadise.com/flacm|Hi-Fi - Radio Paradise FLAC|r|local|Hi-Fi, Eclectic|Radio Paradise|English|United States|North America|900|FLAC|No||No"
  "561|http://mscp3.live-streams.nl:8360/high.aac|Hi-Fi - Naim Radio|r|local|Hi-Fi, Eclectic|Naim|English|United Kingdom|Europe|320|AAC|No||No"
  "562|http://linn.co.uk:8003/autodj|Hi-Fi - Linn Radio|r|local|Hi-Fi, Eclectic|Linn|English|United Kingdom|Europe|320|MP3|No||No"
)

usage() {
  cat <<USAGE
Usage: $0 check|apply

Environment:
  TIKPAL_MOODE_SQLITE_DB       moOde sqlite DB path (default: /var/local/www/db/moode-sqlite3.db)
  TIKPAL_SQLITE_BIN            sqlite binary (default: sqlite3)
  TIKPAL_RADIO_PRESETS_FORCE   set to 1 to overwrite occupied target ids
USAGE
}

sql_quote() {
  local value="${1//\'/\'\'}"
  printf "'%s'" "$value"
}

target_ids_csv() {
  local ids=()
  local row id
  for row in "${rows[@]}"; do
    IFS='|' read -r id _ <<<"$row"
    ids+=("$id")
  done
  local IFS=,
  printf "%s" "${ids[*]}"
}

target_names_sql() {
  local names=()
  local row id station name rest
  for row in "${rows[@]}"; do
    IFS='|' read -r id station name rest <<<"$row"
    names+=("$(sql_quote "$name")")
  done
  local IFS=,
  printf "%s" "${names[*]}"
}

require_db() {
  command -v "$SQLITE_BIN" >/dev/null 2>&1 || {
    echo "sqlite3 is unavailable: $SQLITE_BIN" >&2
    exit 1
  }
  [[ -f "$SQLDB" ]] || {
    echo "moOde sqlite DB not found: $SQLDB" >&2
    exit 1
  }
  "$SQLITE_BIN" "$SQLDB" "SELECT 1 FROM cfg_radio LIMIT 1;" >/dev/null
}

print_conflicts() {
  "$SQLITE_BIN" -separator '|' "$SQLDB" \
    "SELECT id, name FROM cfg_radio WHERE id IN ($(target_ids_csv)) AND name NOT IN ($(target_names_sql)) AND name NOT LIKE 'Tikpal %' AND name NOT LIKE 'Focus - %' AND name NOT LIKE 'Calm - %' AND name NOT LIKE 'Sleep - %' AND name NOT LIKE 'Jazz - %' AND name NOT LIKE 'Classical - %' AND name NOT LIKE 'News - %' AND name NOT LIKE 'Hi-Fi - %' ORDER BY id;"
}

check_presets() {
  require_db
  local conflicts
  conflicts="$(print_conflicts)"
  if [[ -n "$conflicts" ]]; then
    echo "target id conflicts:"
    echo "$conflicts"
    return 2
  fi

  local missing=0
  local category count
  for category in Focus Calm Sleep Jazz Classical News Hi-Fi; do
    local category_sql
    category_sql="$(printf "%s" "$category" | sed "s/'/''/g")"
    count="$("$SQLITE_BIN" "$SQLDB" \
      "SELECT COUNT(*) FROM cfg_radio WHERE id IN ($(target_ids_csv)) AND name LIKE '${category_sql} - %' AND (genre = '${category_sql}' OR genre LIKE '${category_sql},%');")"
    if [[ "$count" -lt 1 ]]; then
      echo "missing category: $category"
      missing=1
    else
      echo "$category: $count"
    fi
  done
  return "$missing"
}

apply_presets() {
  require_db
  local conflicts
  conflicts="$(print_conflicts)"
  if [[ -n "$conflicts" && "$FORCE" != "1" ]]; then
    echo "refusing to overwrite non-Tikpal target ids; set TIKPAL_RADIO_PRESETS_FORCE=1 to force:" >&2
    echo "$conflicts" >&2
    exit 2
  fi

  SQL_FILE="$(mktemp)"

  {
    echo "BEGIN IMMEDIATE;"
    echo "DELETE FROM cfg_radio WHERE id >= 500 AND name LIKE 'Tikpal %';"
    local row id station name type logo genre broadcaster language country region bitrate format geo_fenced home_page monitor
    for row in "${rows[@]}"; do
      IFS='|' read -r id station name type logo genre broadcaster language country region bitrate format geo_fenced home_page monitor <<<"$row"
      printf "INSERT OR REPLACE INTO cfg_radio (id, station, name, type, logo, genre, broadcaster, language, country, region, bitrate, format, geo_fenced, home_page, monitor) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s);\n" \
        "$id" \
        "$(sql_quote "$station")" \
        "$(sql_quote "$name")" \
        "$(sql_quote "$type")" \
        "$(sql_quote "$logo")" \
        "$(sql_quote "$genre")" \
        "$(sql_quote "$broadcaster")" \
        "$(sql_quote "$language")" \
        "$(sql_quote "$country")" \
        "$(sql_quote "$region")" \
        "$(sql_quote "$bitrate")" \
        "$(sql_quote "$format")" \
        "$(sql_quote "$geo_fenced")" \
        "$(sql_quote "$home_page")" \
        "$(sql_quote "$monitor")"
    done
    echo "COMMIT;"
  } > "$SQL_FILE"

  "$SQLITE_BIN" "$SQLDB" < "$SQL_FILE"
  check_presets
}

case "${1:-}" in
  check)
    check_presets
    ;;
  apply)
    apply_presets
    ;;
  -h|--help|"")
    usage
    ;;
  *)
    echo "unknown command: $1" >&2
    usage >&2
    exit 1
    ;;
esac

#!/bin/sh
set -eu

moodeutl -Ro --airplay on

if [ -d /var/local/www/imagesw/airplay-covers ]; then
  chown -R shairport-sync:shairport-sync /var/local/www/imagesw/airplay-covers >/dev/null 2>&1 || true
  chmod 775 /var/local/www/imagesw/airplay-covers >/dev/null 2>&1 || true
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl start shairport-sync.service >/dev/null 2>&1 || true
fi

if command -v pgrep >/dev/null 2>&1 && command -v renice >/dev/null 2>&1; then
  for pid in $(pgrep -f 'aplmeta-reader.sh|shairport-sync-metadata-reader|/var/www/util/aplmeta.py' 2>/dev/null || true); do
    renice 15 -p "$pid" >/dev/null 2>&1 || true
  done
fi

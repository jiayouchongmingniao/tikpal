#!/usr/bin/env bash
set +e

pkill -f '[a]udio.mojom.AudioService' 2>/dev/null || true
exit 0

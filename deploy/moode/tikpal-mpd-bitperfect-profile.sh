#!/usr/bin/env bash
set -euo pipefail

mode="${1:-status}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -n "${TIKPAL_AUDIO_OUTPUT_PROFILE_HELPER:-}" ]]; then
  profile_helper="$TIKPAL_AUDIO_OUTPUT_PROFILE_HELPER"
elif [[ -x "$script_dir/tikpal-audio-output-profile" ]]; then
  profile_helper="$script_dir/tikpal-audio-output-profile"
else
  profile_helper="$script_dir/tikpal-audio-output-profile.sh"
fi

case "$mode" in
  strict)
    exec "$profile_helper" pure
    ;;
  standard)
    exec "$profile_helper" everyday
    ;;
  status)
    profile="$("$profile_helper" status)"
    case "$profile" in
      pure) printf 'strict\n' ;;
      *) printf 'standard\n' ;;
    esac
    ;;
  *)
    exec "$profile_helper" "$mode"
    ;;
esac

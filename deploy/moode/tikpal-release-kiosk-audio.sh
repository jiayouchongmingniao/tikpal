#!/usr/bin/env bash
set +e

# Explore providers stay resident across exit. Killing their audio services
# leaves MediaSource players showing "playing" with AUDIO_RENDERER_ERROR.
# Release only the main kiosk's service, using the launcher's profile setting.
kiosk_profile="${TIKPAL_CHROMIUM_PROFILE_DIR:-$HOME/.config/tikpal-chromium-kiosk}"
while IFS= read -r audio_pid; do
  [[ "$audio_pid" =~ ^[1-9][0-9]*$ && -r "/proc/$audio_pid/cmdline" ]] || continue
  # Chromium can flatten argv into a single process title on this device.
  audio_command=" $(tr '\0' ' ' < "/proc/$audio_pid/cmdline" 2>/dev/null) "
  [[ "$audio_command" == *" --utility-sub-type=audio.mojom.AudioService "* &&
     "$audio_command" == *" --user-data-dir=$kiosk_profile "* ]] || continue
  kill -TERM "$audio_pid" 2>/dev/null || true
done < <(pgrep -f '[a]udio.mojom.AudioService' 2>/dev/null)
exit 0

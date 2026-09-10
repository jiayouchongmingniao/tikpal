# 207 Explore stability and gesture guide update — 2026-09-11

## Included changes

- Provider text scaling/font updates batch layout reads before writes, skip
  deferred invisible content, and avoid rewriting unchanged style sheets.
  Spotify's reload-button search avoids reading every button's rendered text.
- The shared provider audio gate uses system volume ownership, including detached
  media and Howler. Foreground recovery has priority over CDP maintenance limits,
  preventing login/reload from leaving the active provider blocked from playing.
- Google/Apple login child windows follow their verified provider opener through
  activation, offscreen parking and closure. This uses Browser-domain CDP because
  extension bounds validation prevents offscreen parking on the 207 kiosk.
- TIDAL's specifically identified View plans upsell is closed through its Close
  control. Preview/subscription limits are unchanged.
- Existing workspace UI changes are included: the gesture guide has six actions
  with separate explanations, two columns on wide screens and one on narrow
  screens; help/gesture labels and translations are updated. Frozen resident
  providers are labelled Standby rather than exposing the lifecycle term.

## Verification and limits

On 192.168.10.207, Qobuz login-child round trips to Suno and back passed native
window geometry checks; closing the child restored the Qobuz album page. The
user subsequently verified logout and login manually. The later playback failure
was traced to the foreground audio gate remaining inactive under maintenance
throttling. After the shared fix, native play/pause responded and preview progress
advanced from 00:14 to 00:25. Reloading Qobuz also restored the active gate and
playback. Login profiles and the current volume were preserved.

The audio-gate regression covers all ten provider IDs under simulated maintenance
throttling. This is not a claim that all ten real login/DRM/subscription flows were
individually tested. Earlier Google 400 screenshots came from an incomplete test
login URL; those test children were closed. Detailed evidence and deployment
requirements are in [OAuth windows](explore-oauth-windows-v1.md) and
[unified volume](explore-unified-volume-v1.md).

Checks for this snapshot:

- `npm run build` (TypeScript and production frontend build).
- `node scripts/provider-audio-gate-fixture.mjs`.
- `node scripts/provider-text-style-fixture.mjs`.
- `node scripts/provider-volume-browser-fixture.mjs`.
- `node scripts/oauth-windows-fixture.mjs`.
- `node scripts/tidal-dismiss-upsell-fixture.mjs`.
- `node scripts/kiosk-package-smoke.mjs` passed after the final guard change in
  the preceding repair verification.
- `git diff --check`.

The gesture-guide changes are included from the existing workspace; this
submission checks their build but does not add a new device gesture acceptance.
GitHub publication does not itself deploy these frontend changes to the device.

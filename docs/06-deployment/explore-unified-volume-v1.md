# Explore unified volume — phase 1

Explore uses the Tikpal output-volume control as the listening-volume control.
The provider audio gate sets foreground HTML media volume to 1, and sets exposed
Howler global, howl and sound volumes to 1. It does not copy the output percentage
into the website, which would attenuate audio twice. A saved website volume of
zero is intentionally replaced by unity gain. Website volume controls are not
independent listening-volume controls under this policy.

The gate corrects HTML volume on activation, playback and volumechange, with an
equality check to avoid event loops. Media started outside the DOM is tracked
until ended so it can also pause and resume across provider switches. Exposed
Howler volumes are corrected by the existing audio-gate polling; no new polling
loop or audio processor is added. Background playback remains muted and paused.

Deployment requires loading the new document-start script in resident browsers;
syncing the file alone does not update already-running page closures. Keep
profiles and cookies, and expect browser reloads to interrupt playback. Raising
previously attenuated website gain to unity can increase perceived volume at the
same system setting.

Validation:

- `node scripts/provider-audio-gate-fixture.mjs`: reactive Apple-style mute,
  foreground unity gain, detached media, background isolation, Howler gain,
  and existing QQ guard scheduling checks.
- `node scripts/provider-volume-browser-fixture.mjs`: Chromium volumechange
  behavior, background silence, restoration and bounded event count.
- `node scripts/kiosk-package-smoke.mjs`.

This phase does not implement loudness normalization, limiting or a new audio
service. It does not rewrite arbitrary Web Audio gain nodes, whose purpose may
be effects or mixing. Login/region/DRM-blocked pages cannot establish full music
playback acceptance; verify those with accessible accounts and content.

207 verification (2026-09-10): all ten resident providers reported
`volumePolicy: system` after browser reload. Suno and TIDAL foreground media
reported volume 1. Apple preview playback passed Apple → Suno → Apple: background
paused/muted, then foreground resumed with volume 1 and advancing playback time.
Other providers' full playback was not accepted by this configuration check.
The device was returned to TIDAL; the right-side system volume remained 59%.

TIDAL preview upsell (2026-09-10): the separate `tidal-dismiss-upsell.js` content
script clicks only the Close button in an open `UPSELL` dialog containing the
observed `dialog-upsell` / `continue-button` markup and exact `View plans` text.
It does not alter preview limits. Browser fixtures cover repeated opens,
non-TIDAL hosts and other confirmation text. On 207, two real Preview-button
opens produced two automatic Close clicks and no remaining open upsell dialog.

Foreground gate recovery (2026-09-11): after Qobuz logout/login, the active
page's gate remained `active:false`. Fresh documents default to blocked playback;
ordinary guard maintenance could repeatedly consume the CDP maintenance slot
before audio ownership was restored. All providers now use foreground priority
for active audio ownership, retaining the existing switching exclusion and QQ
background policy. This changes scheduling only, not gain or autoplay policy.
The throttled-manager regression first failed for Qobuz and now passes for all
ten providers. On 207, Qobuz recovered without a profile reset, native play/pause
responded, and screenshots showed preview progress advancing from 00:14 to 00:25.
A subsequent Qobuz page reload also restored `active:true` automatically.
Other providers' actual login flows were not individually repeated in this check.

Qobuz initial-load recovery (2026-09-11): only `play.qobuz.com` arms a 15-second
one-shot timer for HTTPS media sources from playback/loading events on observed media, including detached
Audio elements. It retries `load()` and `play()` once per source URL per document
only while foregrounded and visible, at time zero, with no buffered data, no
media error, readyState 0 and networkState 2. Pause, foreground deactivation,
playing/canplay, end, error and emptied cancel the timer. Source changes are
checked again before retry. Ordinary playback has no periodic recovery work;
other providers do not install recovery listeners or timers. This does not
recover mid-track stalls, expired authorization or repeated failures, and it
preserves the existing user-selected source and volume.

`qobuz-stall-recovery-fixture.mjs` covers eligibility, cancellation, source changes,
retry limits and provider isolation. `qobuz-stall-recovery-browser-fixture.mjs`
uses a real Chromium Audio element with a deliberately stalled first request and
a playable second response. Recovery does not perform separate network probes.

207 deployment: the restarted Qobuz page reported the recovery hook loaded.
The foreground subsequently showed QQ Music and was left unchanged. No artificial
network stall was injected on the physical device; recovery timing and retry
count were verified in the isolated Chromium browser fixture.

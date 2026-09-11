# Provider playback audit and native reload confirmation

Field target: 192.168.10.207, 2026-09-11. This follow-up starts from commit
`f980694`. Preserve login profiles and the 35% listening volume. Use existing
playback where available; only normal music controls were clicked. No ads,
subscription offers or account recovery actions were selected.

## Field findings

| Provider | Observation | Result / limit |
| --- | --- | --- |
| Suno | Resumed from standby; timeline advanced from 87 to 108 seconds and Chromium reported audible | Current song worked; an old, paused auxiliary element still had an audio renderer error |
| Spotify | Existing song resumed, Pause visible, Chromium reported audible | Short playback/switch observation passed; DOM audio selector was empty |
| Apple Music | Existing player stuck at zero with `AUDIO_RENDERER_ERROR`; site requested refresh | Refresh and normal preview selection restored progress and audible output; Qobuz -> Apple return also resumed without another Play click |
| Qobuz | Detached preview advanced to 23 seconds with readyState 4 and no media error; tab audible | No zero-second stall in this observation |
| TIDAL | Existing preview progressed and next preview started without error | Captured browser stream RMS became nonzero (max approximately 0.00113); this is not microphone acceptance |
| YouTube Music | Site explicitly said unavailable in this area | Playback cannot be accepted under the current site/region response; no forced retry |
| Amazon Music | Account-status page explicitly said account locked temporarily | Account restriction, not a detected player stall; no login/reset/retry attempted |
| QQ Music | Existing song and Pause state restored; tab audible | Short playback/switch observation passed; uses Web Audio rather than DOM audio |
| NetEase Cloud Music | Existing song restored; tab audible | Short playback/switch observation passed |
| Deezer | On return, current preview stopped at 14.037 seconds with media error 2 (`PIPELINE_ERROR_READ`) while still marked unpaused/playing | Confirmed additional recovery gap, fixed below |

Warm provider switches in this pass completed in roughly 1.6-2.2 seconds from
API request to settled state. These are not touch-to-audio or physical reveal
measurements. The final clean Deezer browser launch took 7.611 seconds and
settled on Deezer without the former cold-entry fallback to QQ. No claim of
one-second cold entry is made.

## Automatic native refresh confirmation

The persistent CDP manager now accepts `Page.javascriptDialogOpening` only when:

- the type is `beforeunload`;
- the event belongs to the currently attached provider page session;
- the target is a top-level page, not a child window;
- the source is HTTPS, has the same origin as that page, and matches the
  provider's explicit music-site hostname list.

The response is sent directly on the original session, bypassing queued renderer
operations that the dialog itself may block. It is never replayed into a new
session. No polling, DOM scan, added browser permission or setting is needed.
Alerts, confirms, prompts, cross-origin authentication and child-window dialogs
are not automatically accepted. This addresses the browser's Reload/Leave
confirmation; it is not a universal browser-popup or OS-dialog suppressor.

A controlled native beforeunload confirmation on the actual Apple Music page
was automatically accepted in 12 milliseconds, followed by a responsive page
and a screenshot with no remaining dialog. The test helper did not answer the
dialog; the deployed manager did. This proves automatic dismissal, not an
absolute guarantee that no compositor frame can ever show a transient prompt.
Evidence on 207: `/tmp/provider-dialog-controlled.log`,
`/tmp/provider-dialog-after.png`, and the manager's `[provider-dialog]` log.

## Deezer nonzero-position read failure

Previously, a positive playback position plus an unpaused flag could incorrectly
count as recovery even when the element had a terminal read error. Recovery now
requires the same preview's timeline to advance after the retry. Audio-gate
status excludes errored elements from playingCount. The existing per-element
listeners additionally forward error events, and foreground return reports an
error on a previously playing element. These callbacks are inert without the
Deezer recovery object.

Only media error 2 on the exact current Deezer preview CDN MP3 is eligible.
Decode/unsupported errors and unrelated media are excluded. Site play intent,
foreground ownership, no audio advertisement, manual-interaction cancellation,
one retry and the existing three-skips-per-two-minutes limit still apply. This
does not enable auto-skip for another provider or alter preview/subscription rules.

The new module was first applied to the actually failed live element (no
synthetic error). It moved queue index 45 -> 46 at about 4 seconds; playback
advanced by about 5 seconds and Chromium subsequently reported audible. Evidence:
`/tmp/deezer-read-recovery-live.log`. Deezer alone was then re-opened to load the
updated document-start listeners and module cleanly. Other provider browser
processes, profiles and volume were preserved.

## Validation and deployment

Manager smoke covers beforeunload acceptance, ordinary dialog/auth/stale-session
exclusion, and acceptance while a renderer evaluation is blocked. Gate tests
cover excluding failed elements and forwarding a read error both on occurrence
and on foreground return. Deezer tests cover a stuck nonzero position, actual
progress, unrelated preview sources, and excluded decode/unsupported failures.
The Qobuz recovery fixture remains passing.

Runtime backups are in
`/home/moode/code/tikpal.deploy-backups/20260911-provider-dialog/`.
Only the manager service, Deezer guard/browser and the explicitly refreshed
Apple page were restarted/reloaded. Browser-stream evidence and a short stability
window do not establish long-term or physical acoustic acceptance for all sites.
No GitHub commit or push is part of this follow-up.

The full `npm run test:kiosk` passed after both changes, including lifecycle,
manager, gate and Deezer fixtures (the Linux process-only fixture is explicitly
skipped on macOS). `git diff --check` passed. The clean Deezer document was
inspected and contains the new read-error listener, ended listener and recovery
module. A normal Flow Play control was used to resume listening after the browser
reload; no automatic account/offer selection was introduced.
Final clean-page samples showed Deezer preview progress advancing from 18.16 to
22.72 seconds with `playing=true`, `paused=false`, and Chromium `audible=true`.
The three deployed runtime source hashes matched the workspace. Gate and Deezer
fixtures also passed directly on 207. The manager smoke additionally verifies
that a same-origin child-window beforeunload prompt is not accepted.

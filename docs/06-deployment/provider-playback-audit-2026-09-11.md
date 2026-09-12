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

## Follow-up: code 4 with the confirmed Deezer error dialog

A later field incident showed the current preview at zero, no audible output,
and media error 4 with an empty message. The exact site dialog read `Error / An
error occurred, please try again later / OK`. This is a site modal, not Chromium's
beforeunload prompt, and code 4 alone does not prove HTTP 403 or a temporary
network error.

Recovery now remembers an error-4 event only for the current preview CDN MP3.
For up to 15 seconds, the existing event-triggered timer looks for one visible
role=dialog whose complete normalized text matches that confirmed message and
which has one visible, enabled OK button. It clicks that real button, then uses
the existing single Play attempt and bounded Next action. A matching modal that
reappears during the failed attempt is closed before Next. Unknown text, missing
or disabled/ambiguous controls, unrelated media and decode errors are retained.
No modal CSS hiding, full-page observer, permanent polling, network probing or
new permission was added. User interaction cancels pending recovery. After three
skips in two minutes, the last site error remains visible and recovery stops.

The module was applied to the actual failed live element. The modal disappeared
by the one-second sample and the playlist advanced 19 -> 20 at four seconds.
Subsequent previews also failed; it advanced through 21 to 22 and stopped with
the error dialog retained. This confirms the cap and does not mean the upstream
media was repaired. Evidence: `/tmp/deezer-code4-live.log` and the follow-up
incident inspection on 207. A single operator refresh was then performed to
request a fresh page; it is not an added automatic-refresh loop. Chromium's
beforeunload confirmation was automatically accepted in 21ms.

The module file is deployed persistently and loaded on new documents by the
restarted CDP manager. The already-open page received the same module after its
old recovery timers were stopped, without resetting the provider profile or
volume. Backup: `tikpal.deploy-backups/20260911-deezer-code4/`.
The full kiosk suite passed. Additional fixture checks cover delayed modal
insertion, absent/unknown dialogs, disabled OK, unrelated previews, cancellation
before and after dismissal, and keeping the last error visible at the skip cap.
After the single refresh, normal playlist playback reached 12.37 seconds with
Chromium audible=true. The newly loaded document reported the code-4 handler
present and no visible error dialog. Deployed module SHA-256 matched the
workspace. The side panel was restored to its original collapsed state; login
and 35% volume were retained. No GitHub commit/push was performed in this fix.

## Follow-up: expired Deezer preview signatures

The recurring code-4 incident was traced to an expired `hdnea` signature on the
current CDN preview URL. Its expiry was 2026-09-11 23:24:04 Asia/Shanghai; recovery
skips occurred at 23:24:32–23:24:52. A read-only range fetch of the same URL returned
HTTP 403, content-type text/html, and an edge error page. The separate
TRACK_TOKEN_EXPIRE was still in the future. Retrying an old preview or skipping
through a cached queue does not refresh those signed media URLs. No signature,
credential, or complete signed URL was printed or persisted by the repair.

For a failed current preview with an explicitly expired signature, recovery now
performs one normal page reload instead of retrying cached tracks. Code 4 still
requires the exact confirmed error dialog before its real OK button is clicked.
Session storage retains only timestamp, song ID, and context ID/type. It limits
reloads to one per two minutes across navigation. If storage cannot be used, the
operation stops. There is no signature rewriting or access restriction bypass.

For up to 30 seconds after reload, the existing bounded timer waits for the same
context and a fresh preview URL for the original song in the site's track list,
then calls the site's normal playTrackAtIndex path, which checks license/ad
requirements. Reload can reset the selection to the first track; matching the
original ID avoids playing that first track by accident. A changed context,
manual input, loss of provider ownership, or timeout cancels restoration. No
permanent polling, new permissions, or cross-provider recovery rule was added.

207 validation: the actual expired failure triggered a page refresh; a fresh
signature appeared and the error dialog disappeared. The first implementation
correctly refused to play when Deezer selected a different first song. After
adding same-context queue lookup, a controlled continuation ticket for the
original incident song restored it at its new index (39), with position reaching
12.95692 seconds and Chromium audible=true. This was a split field verification
of refresh and restoration, not a second natural-expiry end-to-end incident;
physical listening and the next natural-expiry cycle remain to be observed.

The existing provider profile, login, volume, and panel were not reset. Only the
Deezer recovery module was replaced and the CDP manager restarted; the current
page received the same module. Backup: /home/moode/code/tikpal.deploy-backups/
20260911-deezer-expiry/. Deployed SHA-256 matches the workspace:
ab5940564a21e86d0d043db6bfbdf648703da818dc65580e8f44d581fe056d14.

Fixtures cover expired URL refresh, absence of secrets in stored state, fresh
same-song recovery, selection reset, context change, manual/ownership
cancellation, timeout, and the cross-navigation reload budget, alongside the
previous failure and dialog cases. Other providers may have similar URL expiry,
but have not been confirmed to share this cause or refresh contract; this change
is restricted to Deezer. No GitHub commit/push is included in this deployment.
Final validation: npm run test:kiosk passed (Linux /proc-only fixture skipped on
macOS as expected), node --check and git diff --check passed. A later playback
sample remained playing at 28.519055 seconds without loading.

## 2026-09-12 P0: Deezer startup Loading with no recovery action

The audit's persistent Loading was still present at the next inspection. This
sample is distinct from the expired preview failure above: `playing`, `paused`,
and `loading` were all false; the player type was `triton_ads`; the connected
`audio[data-testid="jinglePlayer"]` had no source, readyState/networkState 0,
and the main Play button was disabled. There was no matching preview 403 or
media error. React audio-break state reported a VAST audio advertisement. The
source-less jingle is a bootstrap placeholder, not proof that an actual ad has
finished or that all third-party ad requests have failed. The deeper cause of
the ad bootstrap delay remains unconfirmed.

One ordinary page reload and a normal track selection eventually restored
music: position 24.17 seconds, a detached media element readyState 4, and
Chromium audible=true. This does not establish a reliable startup latency or
physical listening acceptance. Login/profile and the output volume were not
reset. No advertising links, payments, or ad completion events were triggered.

The recovery module now provides a bounded failure exit for this exact state.
A jingle play event (or first provider activation with an existing jingle) arms
one 20-second timer. If the same connected, source-less element and the exact
inactive-music/triton state remain, a nonmodal status message offers a normal
user-requested page reload and points to Explore provider switching. There is
no automatic reload, audio-ad skip, replacement media URL, forced Play, or
synthetic ad completion. The reload rechecks provider ownership and the same
failure state before acting. The user starts playback again normally.

A MutationObserver exists only while the message is shown, checks the retained
element/player state rather than scanning the page, and removes the message
when the bootstrap disappears or changes. Media progress/error/pause and
provider deactivation also clear it. No perpetual polling or network probe was
added. Copy follows the Deezer document language with seven locale variants
and an English fallback. The button has at least 48px height and preserves the
browser focus treatment; the panel's existing switching/exit controls remain
available. This is containment of an unbounded startup failure, not a claim
that the third-party advertising service has been repaired.

Validation: `scripts/deezer-startup-recovery-fixture.mjs` exercises the production
script in Chromium with a controlled clock: 20-second threshold, no automatic
reload after two minutes, real user reload, normal media/source/paused/type
exclusions, removed bootstrap, inactive ownership, cleanup, and touch target.
Existing preview recovery and audio gate regressions are retained.

Deployment: only the Deezer recovery module was atomically replaced; backup is
`/home/moode/code/tikpal.deploy-backups/20260912-deezer-startup-p0/`.
The CDP manager was restarted to register the current source for future pages;
the existing Deezer document received the same module after cancelling the old
recovery timers. Other provider browser processes were not restarted. Local
and remote SHA-256 both equal
`f7a481277f1579f15ffcf7fb1ab9f51d114845c77b5c3b67406e791961f8f32f`.
`npm run test:kiosk`, the new Chromium startup fixture, syntax check and
`git diff --check` passed; the existing Linux /proc test skips on macOS.
No frontend bundle or application API changed, so no frontend build was needed.

Post-deployment: playing at 19.91 seconds with audible=true; a later track
sample remained playing at 21.75 seconds with audible=true. The real device
screenshot retains the expanded sidebar and 23% volume. The new timeout notice
was visually checked in the isolated Chromium fixture, not induced artificially
on the now-playing device. Its next natural occurrence and physical touch/
speaker acceptance remain pending. No GitHub commit or push was performed.

## 2026-09-12 follow-up: stopped after automatic preview refresh

The next user-reported stop had an enabled Play button, no current media and
playing=false. Navigation timing showed a reload roughly 73 seconds earlier;
the saved preview-reload ticket had been reduced to its timestamp. The manager
logged accepting Deezer's beforeunload at the matching refresh time. This is a
separate state from the triton bootstrap Loading described above.

A deterministic regression found that document-start gate initialization called
recovery.setActive(false), which erased a pending refresh continuation before
the backend activated the page. The gate now marks only its initial muted setup
with `{initializing:true}`. Deezer retains the continuation during that setup,
but stays silent until ordinary foreground ownership is confirmed. Explicit
false calls, user input, context mismatch, and the existing 30-second ticket
limit still cancel continuation. Other providers retain the same gate/mute
behavior. No automatic playing=false-to-play retry was added, so normal user
pause and the end of a queue are not treated as faults.

The new fixture failed before this change (ticket resume became undefined),
then passed with the change. Gate fixtures verify initialization is tagged and
an explicit subsequent close is not. Existing provider, preview and startup
notice fixtures continue to pass. The exact clear reason was not logged in the
original field incident; the initialization conflict is established by source
and reproduction rather than claiming an unavailable historical trace.

The user clarified the sequence: playback worked for a while after refreshing,
then stopped. A bounded live trace reproduced that sequence: normal automatic
transitions from queue index 0 through 22, then a natural expired-preview
refresh at 09:37:46.990 Asia/Shanghai. The pending original track was 10686127.
The next document still initialized with the OLD gate function, despite updated
files and a restarted CDP manager: the resident Deezer Guard had cached and
registered the old gate source. The continuation disappeared during startup
and the page remained at index 0 with Play enabled. This run was a failed
runtime deployment verification, not a passing test of the updated gate.

Only Deezer's exact provider Guard and browser root were then stopped and
reopened with the existing profile, via the regular launch script. Other
provider processes were kept resident. Inspection of the actual page's
setActive function confirmed the new initialization parameter. Future gate
changes must refresh the provider Guard's cached source and verify the function
in a new document; file hashes alone do not establish runtime deployment.
Backup for both source files: `tikpal.deploy-backups/20260912-deezer-resume-init/`.

After refreshing the actual runtime, a controlled continuation ticket used the
same failed track (10686127) and playlist, followed by an ordinary page reload.
The ticket survived initialization in the new document; the normal site
playTrackAtIndex path restored that original track. Media reached 17.30 seconds,
readyState 4, and Chromium audible=true. Subsequent automatic track transition
and an ordinary audio-ad break completed without manually pressing Play; a
post-ad sample reached 22.33 seconds with playing=true and audible=true. This
is a real controlled refresh/restoration test, not a second natural-expiry
cycle on the updated runtime. Physical listening is still a separate check.

Both script-order permutations (gate first and recovery first) pass in real
Chromium fixtures. An explicit close before the first activation still cancels
continuation. `npm run test:kiosk`, focused preview/gate/startup fixtures, and
`git diff --check` passed. Source hashes match the device:
- Deezer recovery: 7c61dbb48a71ff3286882ba1d4ff61d7e2a082d972238fe9c5e54663ba234545
- Audio gate: 9f96a26c2d4602114e95cffab5655796d09b9d985ce9f771bfa7fba5ba1e0caf

The deployed change preserves the seven-language timeout notice from the prior
fix, profile/login, expanded sidebar and 23% displayed volume. Only Deezer was
reopened. No GitHub commit/push. Diagnostic watchers were bounded and completed;
no persistent diagnostic polling was installed. Local evidence is retained at
`/Users/pom/Documents/Codex/2026-09-12/deezer-stop-fix/`.

## 2026-09-12 follow-up: ready next preview remains paused without ended

The next report was a different, preserved failure: no intervening reload,
queue index 37 (Is This Love?), valid preview signatures with about six minutes
remaining, site playing=true/paused=false/position=0, but all inspected media
paused and Chromium audible=false. Two detached preview elements were readyState
4. Previous transition traces did not contain native ended events during normal
track changes. The old bounded next-track recovery was only armed by ended or
foreground activation, so it could miss this site-managed transition.

The Deezer recovery module now observes only #page_player while foreground.
Control replacement, disabled/data-testid changes and track href changes can
arm the existing 15-second recovery window when the visible enabled Play
control contradicts site play intent at zero position with no playing media.
It invokes the normal license-checked site resume once for that track. Repeated
DOM updates for the same stuck track do not repeatedly rearm it; trusted user
input cancels recovery and marks that track handled. Paused/loading/ad states
and inactive ownership remain excluded. Progress text and the rest of the page
are not observed; deactivation disconnects the observer. No new steady timer or
network request was introduced.

Chromium fixtures cover a missing-ended transition, duplicate mutations,
next-track href changes, deliberate pause, active media, and ownership loss.
After injection into the actual stalled page, its position advanced to 5.86
seconds and Chromium audible=true without a manual Play click or page reload.
Only the recovery module and manager registration changed this time; no gate,
provider browser, login, or volume reset was needed.

This run also completed the previously pending natural-expiry check. At
09:58:24 Asia/Shanghai the real expiring preview triggered automatic reload.
The new document retained the ticket for track 906585 / playlist 8403360702,
then restored index 43 via the site's normal playback path. Progress reached
25.75 seconds with Chromium audible=true, without a user Play click or a
synthetic continuation ticket. This establishes one natural expiry → reload →
original-track continuation cycle on the updated runtime, in addition to the
actual zero-position stall recovered earlier in this run.

The module's local/remote SHA-256 is
e09b00ead99bc72d223aec5ae647341aec1cb3f887e0354cf1c74688a8ab9adb.
Backup: `tikpal.deploy-backups/20260912-deezer-transition/`. Kiosk regression and
focused Chromium tests passed. Login, expanded sidebar, and 23% volume remain
intact; no GitHub commit/push. One successful cycle is not a guarantee against
all future provider failures, and physical listening remains separate from the
recorded digital audio evidence.
Post-refresh observation continued through index 48 with automatic playback.
The bounded diagnostic session completed and removed its temporary hooks.
Evidence: `/Users/pom/Documents/Codex/2026-09-12/deezer-transition-fix/`.

## 2026-09-12 Suno orphan videos after queue end

Field inspection found the song had ended, but four detached short video elements
remained unpaused and unmuted. Pausing only those videos changed Chromium audible
from true to false. The user independently reported sound while Play was shown.
The shared gate previously unmuted all media and resumed remembered detached videos.
The correction is scoped to Suno VIDEO elements: retain the pre-gate mute value,
leave their gain to the page, and pause/release detached videos during gate changes.
Detached AUDIO remains supported for providers such as Qobuz. No polling is added.
Fixtures cover muted video, repeated activation, orphan non-resume and ordinary
audio recovery. Gate and Deezer preview/startup fixtures passed.

207 source backup: `/home/moode/tikpal.deploy-backups/20260912-suno-video/`.
Only the gate file was replaced; CDP manager restarted and Suno browser reopened
with its existing profile. The first shell open failed readiness; subsequent normal
API open reached ready and the actual screen displayed Suno. A source-free muted
video probe in the live document retained mute=true and volume=0.4 across gate
transitions, confirming the updated behavior loaded. Long-play validation remains
pending; the original audio-only monitor missed detached videos and is not proof
of uninterrupted music or silence.

## 2026-09-12 Queue semantics and long-play acceptance snapshot

Stopping at the end of a non-repeating queue is expected. Do not enable repeat,
shuffle or forcibly restart playback as a generic recovery action. In Qobuz,
40 tracks (24 album tracks plus 16 recommendations) were exhausted with repeat
off and no remaining autoplay candidates. Replaying the last track reproduced
its transition to the first track in a paused state. This explains the observed
zero-second paused snapshot; it is not evidence of a media request failure.
The agent temporarily enabled repeat during diagnosis; the user subsequently
clarified that normal queue completion must be respected. This is not a new
product default, and the tests do not authorize changing user playback modes.

Deezer's disabled repeat/shuffle buttons were confirmed in the site's React
props (`playerUI.repeat`/`playerUI.shuffle` availability), not caused by Tikpal
advertisement CSS. The underlying account/mode restriction was not established;
no controls were forcibly enabled.

Long-play results at commit preparation (2026-09-12):

| Provider | Evidence | Acceptance status |
| --- | --- | --- |
| Apple Music | Existing 30.019-second preview played with Chromium audible=true, then stopped normally; 90-second observation | Full continuous 20-minute path not completed under this preview path |
| Suno | Existing queue played about seven minutes and ended; autoplay was enabled but no further recommendation started. Detached videos continued sounding and were separately identified and paused | Original run failed silence consistency. Scoped fix deployed and short play/pause/gate-cycle checks passed; post-fix long-run acceptance remains pending |
| Spotify | Valid 20-minute sampling in progress; at the latest checked point, 12m41s of sampling, current track progressing at 187.39/240.54s and Chromium audible=true | In progress, not yet a completed 20-minute pass |
| TIDAL | Scheduled after Spotify | Not yet tested in this long-play round |

A first Spotify diagnostic attempt included a prototype object in queryObjects
and returned invalid snapshots. It was removed and restarted with real AUDIO/VIDEO
filtering; invalid samples are excluded. The revised bounded monitor includes
video, connection and mute state. Browser audible, element progress and media
metadata are complementary evidence; none alone proves physical listening or
correct ownership. Standalone logs/screenshots are retained locally under
`/Users/pom/Documents/Codex/2026-09-12/provider-long/`; the continuation task will
record final results separately rather than treating this snapshot as completion.

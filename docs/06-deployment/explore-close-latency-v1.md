# Explore immediate audio stop and direct exit

The 2026-09-11 update removes the full-screen exit cover at the user's request.
Both Side Panel Exit controls dispatch immediately, retain busy/accessibility
feedback, show delayed progress after one second and expose a retry hint on
failure. Opening Explore keeps its existing transition. Legacy cover requests
are acknowledged immediately for compatibility; they no longer draw an overlay.

## Audio and ownership

`close` accepts an optional `closeRequestId` and the existing panel session and
X-session identity fields. Calls without these optional fields remain supported.
The server reserves Close before awaiting layout work and rejects new layout,
open, reset and proxy actions while closing. It runs `close-audio` before waiting
for an already-running panel layout, then closes windows under the existing lock.
The current provider/session is rechecked before the visual close is committed.

`tikpal-close-audio.mjs` writes a session-scoped marker adjacent to runtime state
(`.close-audio.json`). Guard, direct activation and CDP Manager activation paths
honor it; the Manager rechecks ownership immediately before sending a command,
including replay. Markers from older sessions do not suppress a new session.
No new resident process, interval or user setting is introduced.

The helper uses the existing Manager socket with a 500ms total response deadline
and no retry. It confirms the audio gate is inactive, media are paused and known
AudioContexts are no longer running. A missing gate, failed response or timeout
triggers exact-profile process-tree termination: TERM, a bounded wait, then KILL
if needed. PID start times and session ownership are checked again before signals.
Unidentified or surviving processes cause failure, not a false silent-success.
Other provider profiles and stored login/volume data are preserved. A terminated
provider reloads on the next entry.

Only confirmed audio shutdown allows visual close and the existing local-source
handoff. The old fixed 350ms settle and synchronous pool-wide status scan are
removed from warm close; existing idle freeze/cleanup remain asynchronous and
normal entry reconciles pool status. On failure, the API does not clear the
active provider in a finally block. UI requests and timers are request-owned.

## Window cost and verification

Window enumeration first rejects surfaces outside the physical screen, using
configured base geometry even when the panel is collapsed. Profile classification
reads each process ancestor once rather than repeating the entire ancestry walk
for each provider. All matching surfaces are still hidden before parking, and
absence from the physical screen is still checked before state is cleared.

Checks:
- `npm run build` (TypeScript and production bundle).
- `npm run test:explore-panel`: session/API ordering, audio-before-layout,
  failed close, stale request after re-entry, X11 regressions and seven locales.
- `node scripts/explore-close-audio-fixture.mjs`: gate success/missing gate,
  deadline, stale session, exact profile/descendant selection and failed signals.
- `node scripts/explore-close-audio-process-fixture.mjs`: Linux-only real dummy
  process termination while a similarly named neighboring profile survives.
- `npm run test:cdp-manager`: suppress reactivation and reject stale mute requests.
- `npm run test:kiosk`: packaging, audio gates and Explore lifecycle regressions.

207 backup: `/home/moode/code/tikpal.deploy-backups/20260911-explore-close/before.tar.gz`.
Assets were published before the index; old assets were retained. API and CDP
Manager were restarted, provider guards refreshed, and the main page and Side
Panel refreshed to load the new frontend. Login profiles and volume were not
reset. No ad controls were clicked. This iteration does not include GitHub push.

Baseline Suno stream sampling observed continued nonzero audio at 4.5 seconds
after Exit. The first measured new-version playing case reached zero stream
samples and paused/muted media at 264ms (roughly 100ms sampling resolution).
Backend audio confirmation was 349ms. This is browser audio-stream evidence,
not an acoustic microphone measurement. Initial window completion was 3.85s;
that finding motivated the enumeration optimization described above. Final
field timings are recorded below after the optimized rollout.

## Final 207 acceptance

Native clicks were tested on both the expanded header and collapsed rail. Suno
had a verified nonzero captured audio stream before each accepted run. The
first silent samples occurred at 210ms and 240ms respectively (sampling around
100ms); all media were paused/muted and the gate was inactive. Backend audio
confirmation took 320ms / 345ms, and complete window-close command confirmation
1732ms / 1816ms. These are small-sample results, not percentile guarantees.
The <=1s complete-exit target remains unmet; actual acoustic output and physical
touch latency are not inferred from browser stream or native pointer tests.

15fps X11 recordings and post-exit native geometry confirmed direct return to
the main screen without a full-screen cover, and both provider/panel parked at
x=2560. The main UI then performed its existing playback/metadata update. No
remaining Explore window was visible in the accepted runs.

An intermediate enumeration optimization incorrectly assumed NUL-separated
Chromium arguments; this device rewrites its argv into a single process title.
That run's API close result was rejected after screenshots showed surviving
windows. Classification and termination now support both representations with
exact profile boundaries, including canonical paths. A Linux fixture covers
flattened titles, child ancestry, offscreen filtering and close card status;
the real process-termination fixture also rewrites argv and verifies that a
similarly named neighboring process survives.

The stopped provider's card is updated from the confirmed helper outcome in the
existing state write: paused residents become parked/ready; terminated residents
are removed for normal discovery on the next entry. This preserves idle-freeze
eligibility without restoring the synchronous all-provider status scan.

Evidence request IDs: `close-22a4f7ca-c64d-4b6d-b75c-aa2b388fef10` (expanded),
`close-d4a8cba4-86f8-4417-82fa-aac9d200ac9b` (collapsed). Recordings are
`/tmp/explore-close-expanded-final.mkv` and
`/tmp/explore-close-collapsed-final.mkv` on 207; browser stream samples are
`/tmp/explore-close-expanded-final.log` and
`/tmp/explore-close-collapsed-final.log` in the development workspace host.

One later lifecycle-suite run failed with a local Undici socket-close error;
the isolated lifecycle suite passed on rerun. No device failure was inferred
from that local harness error. Build retains the existing large-chunk warning.

## Suno re-entry regression follow-up (2026-09-11)

Field reproduction found `PipelineStatus::AUDIO_RENDERER_ERROR` on the paused
Suno music element after Exit, before re-entry. Re-entry opened the audio gate,
unmuted the media and showed Pause, but playback time stayed fixed. The legacy
`deploy/moode/tikpal-release-kiosk-audio.sh` used a global AudioService `pkill`:
returning to local playback could therefore kill resident providers' audio
services along with the main kiosk service. Reloading a MediaSource element is
not a safe workaround (its blob source may no longer be reusable).

The helper now matches both the AudioService utility subtype and the exact main
kiosk profile, using the launcher's existing `TIKPAL_CHROMIUM_PROFILE_DIR` or
`$HOME/.config/tikpal-chromium-kiosk` default. It accepts normal NUL-separated
arguments and Chromium's flattened process title. It preserves provider audio
services, neighboring profile names and non-audio utilities. No gate, provider
resume, freeze, login or volume code changes were needed for this fix.

`node scripts/kiosk-audio-release-fixture.mjs` exercises real dummy Linux
processes, including flattened titles, profile paths with spaces, two provider
profiles, a neighboring profile and another utility. It passed on 207 and is
included in `test:kiosk`; non-Linux runs explicitly skip the `/proc` fixture.
Shell syntax, audio-gate fixture and kiosk package smoke also passed.

Only the release helper needed runtime deployment; no service/browser restart
was required. Its backup is
`tikpal.deploy-backups/20260911-explore-close/tikpal-release-kiosk-audio.before-reentry.sh`.
A normal song selection replaced the already-damaged playback for verification.
Subsequent exits preserved Suno AudioService PID 1641379. Both re-entry after a
completed close and re-entry after the resident card became frozen resumed the
song without another music-control click. The main music element had no error,
its timeline advanced and captured stream RMS was nonzero in both cases.
An inactive auxiliary media element retained an error from before deployment;
no blanket media reload was used to hide that observation.

A final native header Exit test reached zero captured audio at 208ms (around
100ms sampling resolution), with the gate inactive and media paused/muted.
After close completed, re-entry again produced nonzero audio without a Play
click. This is browser stream evidence, not microphone/listening acceptance.
A request issued while Close was still busy was rejected; full close completion
can still exceed the original one-second goal and was not optimized here.
Evidence on 207: `/tmp/reentry-before.log`, `/tmp/reentry-immediate.log`,
`/tmp/reentry-frozen.log`, `/tmp/reentry-close-fixed.log`, `/tmp/reentry-final.log`.
No GitHub commit or push was performed.
The final full `npm run test:kiosk` run passed, including Explore open lifecycle.
The deployed release-helper SHA-256 matched the workspace source. No frontend
source changed in this follow-up, so a new frontend build was unnecessary.

## 2026-09-11 entry overhead and Deezer preview recovery

The 207 initial-entry diagnostic path had remained enabled. Its per-step window
snapshots and trace formatting added substantial overhead before the page became
interactive. The non-tracing path now invokes each existing operation directly,
retaining mutation tracking, failure status and final verification. The detailed
trace path is still available when explicitly enabled. The device's
`TIKPAL_WEB_MODE_INITIAL_ENTRY_TRACE_PATH` is now empty; the old trace file and
configuration were retained in the backup. One Suno entry measured 6.480 seconds
before and 4.495 seconds after (not a one-second entry acceptance result).

Deezer inspection identified a preview CDN HTTP 403 with the site still showing
playing at position zero, no active media, and an active/unmuted audio gate.
Audio elements are detached from the DOM, so an empty audio-element selector is
not evidence of stopped playback. Closed Web Audio capability-probe contexts
were also observed during working playback and are not treated as failures.

The CDP manager enables network events only for Deezer and forwards only HTTPS
403 responses from the exact preview CDN MP3 path, without signed query strings.
The page recovery checks the current preview, foreground audio ownership, site
play intent and absence of audio advertisements. It requests normal Play once;
if the same preview remains unavailable after 2.5 seconds, it requests normal
Next. At most three skips are allowed in two minutes. User pointer/keyboard
interaction cancels pending recovery; paused/background sessions cannot skip.
Failed preloads are bounded to 32 paths retained for five minutes. The one-second
check exists only while those failures or a short transition watch remain;
there is no permanent polling or DOM scan. Normal end/foreground transitions
also allow one normal Play request within 15 seconds if the next preview is
still at zero despite site play intent. No signed URLs, licenses, preview limits,
audio advertisements, login state or volume settings are modified.

Fixtures cover retry success, skip, cancellation, inactive/paused sessions,
preloaded failures, bounded skips, transition resumption and provider isolation.
The kiosk suite and CDP-manager smoke pass. Linux Xvfb entry validation passed
2 success scenarios, 19 injected failures, 2 trace-loss cleanups and 1 preflight
failure. Fixture fault injection was corrected to target the actual entry-step
wrappers; lifecycle mock-process defaults allow five seconds for shell startup,
while timeout-specific tests retain their explicit short deadlines.

Runtime backups for this follow-up are under
`/home/moode/code/tikpal.deploy-backups/20260911-entry-fast-path/`.

Cold-launch validation additionally exposed an existing shell error: several
trace predicates were written as strings inside `[[ ... ]]`, making them always
true, and the traced paint-check wrapper received no arguments. A fresh Deezer
launch then failed with `$1: unbound variable` and fell back to QQ Music. The
predicates now invoke the function, and the traced paint check receives its
port, provider and XID. The isolated Linux entry fixture passed again after this
correction. This affects common provider cold entry, not Deezer song selection.

The manager also accepts an exact preview URL on a page `Log.entryAdded` network
error reporting status 403, covering the page error reporting path observed in
the original incident. Dispatch fixtures exercise both Network and Log events,
exclude other sessions/providers, opening/closing ownership, JavaScript log
messages and unrelated hosts, and verify signed queries are not forwarded.

Final field recovery validation used an explicitly simulated failure at the
recovery boundary: a currently playing detached preview was made unavailable,
then the rejected-current-preview notification was delivered to the deployed
module. At approximately 4 seconds the queue changed from index 8 to 9; by
5 seconds the next track's timeline advanced. Subsequent samples continued to
advance and Chromium reported the tab audible and unmuted. This proves the
real player retry/Next/recovery path, not physical acoustic acceptance or an
end-to-end naturally recurring HTTP 403. Earlier page-level Fetch fault attempts
did not intercept the actual audio request and are NOT counted as 403 passes.
All temporary Fetch/cache/service-worker overrides were removed. Evidence:
`/tmp/deezer-recovery-boundary.log` and `/tmp/deezer-fault-network.log` on 207.
The new ended hook and recovery object were verified in the re-opened Deezer
page. Login and volume (35%) were retained; other provider browsers were not
restarted. Runtime file hashes matched the workspace; only the CDP manager and
Deezer browser needed restart. No GitHub commit/push was performed.

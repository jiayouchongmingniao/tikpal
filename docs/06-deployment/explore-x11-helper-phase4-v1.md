# Explore X11 Helper Phase 4 v1

## Status

Phase 4 uses the existing independent-Provider Chromium pool. Production
rollout completed on 2026-09-03 and
`TIKPAL_WEB_MODE_X11_HELPER_MODE=auto` is enabled. Its scoped production gate
covers `suno, spotify, apple_music, tidal, qobuz, deezer, amazon_music,
qq_music, netease_music`; YouTube Music may remain resident but is not a
scoped gate.

Each Provider has one persistent browser-level CDP WebSocket and one attached
page session owned by `tikpal-web-mode-cdp-manager.service`. Launcher, Provider
Guard and acceptance use `/run/tikpal/cdp-session-manager.sock` rather than
discovering `/json/list` and creating a page WebSocket on the foreground path.
The Manager records browser/session/document generations and permits exactly
one transparent replay only for `Page.bringToFront`, audio-gate `setActive`,
layout wake, and read-only query commands. It never replays clicks, playback,
authorization, navigation, or prompt dismissal.

The completed field sequence was one `Suno -> Spotify` canary, then 20
switches from Spotify: the nine scoped Providers twice, then Suno and Apple
Music. Each run allows at most one successful Manager recovery; a failed
recovery or a second recovery fails the scoped gate. The passing physical run
met all strict timing, geometry, audio, Helper, lifecycle, and Manager gates.

The Suno/Spotify single-window Tab v2 work remains an isolated A/B POC. It
does not replace the production pool, profiles, audio buses, or external Side
Panel.

The Guard pause marker is runtime coordination only and lives at
`/run/tikpal/provider-switch.pid`. It must not share the Provider profile's
storage path: a stalled profile-filesystem write can otherwise delay the
foreground process before it reaches the Helper transaction.

## Strict transaction contract

Formal acceptance modes (`switch-once`, `switch-only`, and `switch-strict`)
now pass `strict_helper_transaction: true` through the trace context, API, and
launcher environment.

An ambiguous Helper result remains terminal: the launcher never starts a
second visible mutation after a timeout or transport error that might have
reached X11. There is one narrow exception before any mutation begins: an
`X11_REPLY_TIMEOUT` response may reconnect and retry once only when the Helper
proves `fallbackRecommended=true`, `leaseReleased=true`, `inFlight=false`, and
`mutationStarted=false`. Every other timeout, transport error, or second
attempt remains a failure.

The acceptance summary requires one canonical successful Helper switch for a
round, a Helper foreground completion, no CDP fallback, and one successful
ordered target audio-gate event. A permitted safe pre-mutation reconnect is
recorded separately as `helper_pre_mutation_*`; it is not a second visual
switch. These fields are emitted in `rounds.csv`, `summary.json`, and
`report.md`; failure of either gate fails the strict run. Helper transaction
time is also a hard gate: the canary must be `<250ms`, and the 20-round run
must have `median<=90ms`, `p95<175ms`, and `max<250ms`. These bounds cover the
complete identity-checked transaction, including its mandatory final X11 fence
and snapshot; the former 30ms median was below that unavoidable fence on the
field device.

## Local verification

Completed on the source tree:

- `bash -n deploy/chromium/tikpal-web-mode.sh deploy/chromium/tikpal-explore-physical-acceptance.sh scripts/tikpal-x11-helper-phase1-smoke.sh`
- `bash deploy/chromium/tikpal-explore-physical-acceptance.sh summary-contract-fixtures` (29 cases)
- `bash deploy/chromium/tikpal-explore-physical-acceptance.sh stamp-fixtures`
- `bash deploy/chromium/tikpal-explore-physical-acceptance.sh exit-contract-fixtures` (13 cases)
- `bash scripts/tikpal-x11-helper-phase1-smoke.sh`, including the strict
  timeout fixture and a fresh Shell owner generation
- `npm run test:cdp-manager`
- `npm run typecheck`
- `npm run build`
- `git diff --check`

## 115 deployment and acceptance snapshot

On 2026-09-03 the Phase 4 Manager, Helper/client updates, Guard IPC, service
unit, and validation tools were atomically deployed to 115 with exact backups
under `/root/tikpal-phase4-backups/phase4-cdp-manager-20260903-015205`. The
Manager and Helper were restarted to establish their new control plane; only
the API was restarted for the final promotion. Chromium and the kiosk were not
restarted.

The final evidence directory is:

```text
/home/moode/code/tikpal/.tikpal/phase4-cdp-manager-formal20-final-20260903-0517/
```

Its summary recorded all 20 rounds as correct for Manager, lifecycle, Helper,
audio, performance, and physical-visible/stable gates, with
`scoped_gate_passed=true`, zero CDP session recoveries, and no anomalies.
`gate_passed=false` in that file is expected because its legacy full-scope
meaning still includes the explicitly excluded YouTube Music target.

Visible-time median/p95/max were 878/1472/1577 ms; stable-time values were
1510/2759/3017 ms. One final-run `X11_REPLY_TIMEOUT` took the allowed safe
pre-mutation reconnect path (`mutationStarted=false`); the canonical 20
visible mutations still completed without a duplicated reveal.

After the passing run, the API environment was promoted to
`TIKPAL_WEB_MODE_X11_HELPER_MODE=auto`. The post-promotion read-only check
found the Manager sessions ready at generation 1/document generation 1, no
stale switch lock or marker, and no follow-up browser click.

## Runtime ownership self-check and repair

Explore runtime commands must run as `moode`. Root is reserved for deployment,
systemd installation, and the narrow repair helper. If `tikpal-web-mode.sh` is
mistakenly started as root for a mutating action, it immediately re-execs as
`moode`; only `--check` and `guard-state` stay root-readable.

`/usr/local/sbin/tikpal-web-mode-owner-repair` has two fixed modes:

- `check` reports ownership mismatches without changing state.
- `repair` changes ownership only on the fixed runtime-file allowlist and only
  when a lock file is currently unlocked. It never recursively changes a
  directory and never follows a symlink. It can terminate only a root-owned,
  PPID-1 `tikpal-web-mode-guard.mjs` process that is absent from the registered
  Provider Guard PID files.

The installer provisions `tikpal-web-mode-owner-repair.service` as an enabled
one-shot service. At every system boot it runs before the API, kiosk, and X11
Helper services, so ordinary users do not need to change file ownership by
hand. A matching Settings action, **Explore self-check & repair**, exposes the
same limited repair to the kiosk user through a narrowly scoped sudo rule; it
does not grant arbitrary `chown`, shell, or service-control access.

## Follow-up boundary

The completed scoped Phase 4 gate does not change the legacy full-scope
`gate_passed` definition and does not promote Tab v2. Any future Tab v2 A/B
must separately prove same-window kiosk geometry, no browser chrome, target
activation, first meaningful frame, physical visibility, and its explicitly
limited single-output audio behavior before a profile, proxy, audio, or Shell
redesign is considered.

# Explore X11 Helper Phase 0

Status: Phase 0 completed on 115 and the controlled Phase 1 two-Canary promotion passed on 2026-09-01. The Helper now runs with `TIKPAL_X11_HELPER_PHASE=1` and Shell mode `switch`; the 20-round Phase 1 run remains explicitly out of scope.

**2026-09-01 final Phase 0/1 record:** after a fresh Phase 0 Helper restart, 20 stable three-window batches passed with client socket p95 `0.750 ms` and daemon p95 `0.486 ms`. The competition sampler then observed the single YouTube Music → Spotify resident switch with 20 identity-checked, read-only batches: client socket p95 was `25.892 ms`, below the required `100 ms`; connection epoch was unchanged and timeout, reconnect, inspect-failure, and mutation counts remained zero. The first preparation switch exposed a stale, pre-deployment Window Guard that restored Spotify after the new state had committed. `reload-guard youtube_music` replaced it with one current Guard and restored the expected YouTube Music/Spotify/Panel geometry before the competition switch. This was a Guard lifecycle repair, not a Helper failure.

The configuration change was atomic and retained `.env.kiosk` owner/mode. Only the Helper and API were restarted; kiosk PID `2403755` stayed unchanged. The Phase 1 Helper then completed Spotify → YouTube Music and YouTube Music → Spotify Canaries with visible/stable timings `834/3259 ms` and `830/3069 ms`, respectively. Both acceptance summaries passed correctness, performance, and lifecycle gates. Final Helper health recorded `switchRequests=2`, `switchFailures=0`, `mutationRequests=2`, `revokeRequests=2`, `xcbTimeouts=0`, `reconnects=0`, with no in-flight lease. Raw field evidence is retained on 115 in `.tikpal/phase0-gate-20260901-0900/` and `.tikpal/phase1-enable-20260901-0908/`.

**2026-09-01 update:** the stable-period evidence below is no longer an active Phase 0 pass. A subsequent read-only Guard inspection on 115 timed out, reset the Helper connection, and reconnected. Do not deploy the competition sampler or begin Phase 1 until the display-stack interference is understood and a new complete Phase 0 period passes.

**2026-09-01 second invalidation:** a fresh Phase 0 Helper initially completed 20 serial three-window inspections with daemon p95 `0.534 ms`, socket p95 `0.867 ms`, and zero errors. Before any Provider click, its Guard then timed out at `00:31:30 +08:00` (`500.880 ms` total; epoch `1 -> 2 -> 3`; one timeout/failure/reconnect). The planned strict physical preflight was aborted before `rounds.tsv` recorded a round or the active Spotify provider changed, because its unbounded `ffmpeg x11grab` frame capture also blocked. The acceptance capture is now bounded to eight seconds so a preflight failure remains a failure rather than an unbounded process. The associated 115 evidence is `.tikpal/phase0-drm-baseline-20260901-002251/`; the device remains `phase=0`, `mode=disabled`, with no Phase 1 attempt.

**2026-09-01 collector repair (local validation):** the timeout has an independently valid libxcb failure mechanism: the prior collector drained events with `xcb_poll_for_event()`, which may read the X socket and queue a reply internally after the reply scan reported no progress. It now drains only already-queued events with `xcb_poll_for_queued_event()`, performs one final reply scan before declaring a deadline/poll timeout, and reports distinct timeout, XCB connection, poll, and helper-stopping outcomes. Responses and request logs retain bounded collector diagnostics (connection error, poll errno/revents, pending/completed counts, final-scan state, and unfinished reply metadata). The unchanged 500 ms inspect deadline and the genuine frozen-X-server timeout fixture remain in force. The repair has passed local Xvfb, final-scan, interruption, transaction, sequence-rollover, and Phase 0 smoke coverage; its field result is recorded below and does not reactivate the invalidated Phase 0 evidence.

**2026-09-01 collector field result:** commit `0001474` was deployed atomically to 115 with only `tikpal-x11-helper.service` restarted; API and kiosk PIDs were unchanged, and the fresh Helper started at epoch `1` with zero timeout, reconnect, inspection-failure, and mutation counters. Twenty three-window read-only inspections spaced three seconds apart passed with daemon p95 `0.568 ms`, socket p95 `0.893 ms`, and reply-wait p95 `0.174 ms`; the new instance and epoch remained constant. The required Phase 0 preparation switch `Spotify -> YouTube Music` then completed without Helper errors, but the physical stamp was `5710 ms` after the input, exceeding the strict `5000 ms` visible deadline. Its trace attributes the elapsed time to the legacy Guard/foreground sequence before the stamp, not to the bounded post-stamp frame capture. The state is now YouTube Music with a free lock and one disabled, Phase 0 Helper; do not retry, reverse-switch, arm the competition sampler, or enter Phase 1 from this run. Evidence is retained at `.tikpal/phase0-collector-repair-20260901-010231/` on 115.

## Boundary

The native Helper defaults to daemon Phase 0. It serves only `health` and `inspect`; `switch` and `revoke` fail before any X11 connection or mutation with `OPERATION_DISABLED_PHASE0`.

`health` is the authoritative capability report:

- `phase: 0`
- `readOnly: true`
- `mutationsAllowed: false`
- `supportedOperations: ["health", "inspect"]`

The device-local setting is `TIKPAL_X11_HELPER_PHASE=0` in `.env.kiosk`. The command-line form `--phase 0|1` exists for controlled fixtures and staged service changes. Invalid values fail startup. Shell orchestration remains independently disabled with `TIKPAL_WEB_MODE_X11_HELPER_MODE=disabled`.

## Local gate

`scripts/tikpal-x11-helper-phase1-smoke.sh` proves the default daemon rejects both mutation operations, then starts isolated `--phase 1` daemons for the existing transaction, timeout, and cleanup regression tests. `scripts/tikpal-x11-late-writer-fixture.sh` also opts its mutation fixture into `--phase 1` explicitly.

At the time this document was first written, Phase 0 rollout was limited to the Helper binary/configuration, a Helper restart, and read-only health/inspect evidence while Shell mode remained disabled. The dated final record above supersedes that historical boundary for the completed two-Canary promotion only.

## 115 stable-period evidence

On 2026-08-31, only the Helper source/binary and `.env.kiosk` were atomically updated on 115. The API, kiosk, Chromium processes, and the existing Guard PID were not restarted. The runtime source SHA-256 is `c2f4e02f47b438a6b38cc5eb4f4c51dd6059aa5dbad7ea29a86740faaf1fd760`; the Gentoo-built binary SHA-256 is `4bfdb6633902b75438b088253ceccfa04dd6aa9b26b3230b98d2ec3efb0dbc20`.

The Helper reports Phase 0 with only `health` and `inspect`; API Shell mode remains disabled. Twenty serial batch inspections of Spotify, parked Qobuz, and the Side Panel kept the same daemon instance and epoch. Daemon p95 was `0.412 ms`, socket p95 was `0.645 ms`, and mutation, timeout, reconnect, and inspect-failure counts were zero. Evidence is retained on 115 at `.tikpal/x11-helper-phase0-stable-20260831-221727/`.

Do not synthesize the remaining competition period by opening or switching a provider. It must observe 20 batch samples during an existing production resident switch with the same read-only assertions and p95 below `100 ms`; only then can Phase 1 be considered.

## Field gate invalidation

At `2026-08-31 22:39:54 +08:00`, the unchanged read-only Helper instance `b2355fa3-c7e1-4874-99cc-d9fc33bf1b61` timed out a Window Guard `inspect` batch for Spotify (`71303171`), Side Panel (`23068675`), and kiosk (`8388611`). The reply wait was `500.850 ms`; the Helper recorded `X11_REPLY_TIMEOUT`, connection reset `1 -> 2`, and the next Guard tick reconnected `2 -> 3` at `22:39:55`. It performed no mutation and did not restart Chromium, API, kiosk, or the Guard.

Kernel logs immediately around that request repeatedly report `evdi` connector/EDID updates and nouveau DDC-without-EDID messages. That is a time correlation to investigate in the X server/EVDI display stack, not a proven root cause. The current Helper counters retain one inspect failure, one timeout, and one reconnect, so they cannot satisfy a new Phase 0 sampling gate. The Phase 0 competition sampler is atomically staged on 115, but has never been armed or used to create a switch.

## Competition-period sampler

`deploy/chromium/tikpal-x11-helper-phase0-competition.sh` is the only Phase 0 observer for the remaining gate. It must be started by the kiosk service user while a Provider is already active and no request is opening. It writes `armed.json` before waiting for the next existing resident switch; it never calls the API, `switch`, `revoke`, X11 mutation commands, the Guard, or Chromium.

For the next normal switch, create one new evidence directory and arm the sampler first:

```bash
sudo -u moode /home/moode/code/tikpal/deploy/chromium/tikpal-x11-helper-phase0-competition.sh \
  --output-dir /home/moode/code/tikpal/.tikpal/x11-helper-phase0-competition-<utc>
```

After `armed.json` is present, allow exactly one already-authorized production resident switch to proceed. Do not use this command to create a switch. The sampler detects its persisted `openingProvider`, reads the cached target, previous, and Panel XIDs once, and makes 20 serial read-only `inspect` batches. It records the raw response for every batch, including client/socket, daemon queue, XCB batch-send, reply-wait, `/proc` identity, and total timings.

It passes only when the daemon instance, `connectionEpoch`, target/previous/Panel process identity and start-time stay constant; every surface has a matched viewable profile and no XCB error; and Helper mutation, timeout, reconnect, failure, and mutation-operation counters remain zero. `summary.json` calculates nearest-rank p95 for all timing dimensions and rejects any competition p95 at or above `100 ms`. A failure leaves the output directory and exits immediately; it does not retry, change state, or mutate X11.

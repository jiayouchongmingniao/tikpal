# Explore X11 Helper Phase 0

Status: local validation and the 115 stable read-only deployment passed; the required 20-sample real-switch competition period remains pending. This is the plan-defined Phase 0 gate; it is distinct from the earlier disabled-Helper initial-entry diagnostic.

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

No Phase 1 canary, Shell duplicate-read removal, or provider switch is authorized by this document. Field Phase 0 rollout is limited to the Helper binary/configuration, a Helper restart, and read-only health/inspect evidence while Shell mode remains disabled.

## 115 stable-period evidence

On 2026-08-31, only the Helper source/binary and `.env.kiosk` were atomically updated on 115. The API, kiosk, Chromium processes, and the existing Guard PID were not restarted. The runtime source SHA-256 is `c2f4e02f47b438a6b38cc5eb4f4c51dd6059aa5dbad7ea29a86740faaf1fd760`; the Gentoo-built binary SHA-256 is `4bfdb6633902b75438b088253ceccfa04dd6aa9b26b3230b98d2ec3efb0dbc20`.

The Helper reports Phase 0 with only `health` and `inspect`; API Shell mode remains disabled. Twenty serial batch inspections of Spotify, parked Qobuz, and the Side Panel kept the same daemon instance and epoch. Daemon p95 was `0.412 ms`, socket p95 was `0.645 ms`, and mutation, timeout, reconnect, and inspect-failure counts were zero. Evidence is retained on 115 at `.tikpal/x11-helper-phase0-stable-20260831-221727/`.

Do not synthesize the remaining competition period by opening or switching a provider. It must observe 20 batch samples during an existing production resident switch with the same read-only assertions and p95 below `100 ms`; only then can Phase 1 be considered.

## Competition-period sampler

`deploy/chromium/tikpal-x11-helper-phase0-competition.sh` is the only Phase 0 observer for the remaining gate. It must be started by the kiosk service user while a Provider is already active and no request is opening. It writes `armed.json` before waiting for the next existing resident switch; it never calls the API, `switch`, `revoke`, X11 mutation commands, the Guard, or Chromium.

For the next normal switch, create one new evidence directory and arm the sampler first:

```bash
sudo -u moode /home/moode/code/tikpal/deploy/chromium/tikpal-x11-helper-phase0-competition.sh \
  --output-dir /home/moode/code/tikpal/.tikpal/x11-helper-phase0-competition-<utc>
```

After `armed.json` is present, allow exactly one already-authorized production resident switch to proceed. Do not use this command to create a switch. The sampler detects its persisted `openingProvider`, reads the cached target, previous, and Panel XIDs once, and makes 20 serial read-only `inspect` batches. It records the raw response for every batch, including client/socket, daemon queue, XCB batch-send, reply-wait, `/proc` identity, and total timings.

It passes only when the daemon instance, `connectionEpoch`, target/previous/Panel process identity and start-time stay constant; every surface has a matched viewable profile and no XCB error; and Helper mutation, timeout, reconnect, failure, and mutation-operation counters remain zero. `summary.json` calculates nearest-rank p95 for all timing dimensions and rejects any competition p95 at or above `100 ms`. A failure leaves the output directory and exits immediately; it does not retry, change state, or mutate X11.

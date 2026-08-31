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

Do not synthesize the remaining competition period by opening or switching a provider. It must observe 20 existing production switch windows with the same read-only assertions and p95 below `100 ms`; only then can Phase 1 be considered.

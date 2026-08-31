# Explore X11 Helper Phase 0

Status: local implementation and Xvfb validation passed; field Phase 0 rollout remains pending. This is the plan-defined Phase 0 gate; it is distinct from the earlier disabled-Helper initial-entry diagnostic.

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

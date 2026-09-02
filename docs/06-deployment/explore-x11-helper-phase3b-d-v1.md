# Explore X11 Helper Phase 3B–3D v1

Status: local implementation and Xvfb regression coverage, plus a transient scoped 115 verification on 2026-09-02 after the Phase-3A 20-round observer comparison passed. The test used a separate Phase-3 sidecar and restored the normal production Phase-1 Helper and `mode=switch` Guard afterward. It did not persist a Phase-3 service or change the device configuration.

The scoped field evidence established the following:

- 3B: an exact Panel lease repaired geometry, opacity, and a lowered-stack/geometry perturbation with zero failures and no concurrent Shell Panel write; the Panel remained `IsViewable` at `1920,0 640x720` with full opacity.
- 3C: an exact active Suno, off-screen YouTube Music, and Panel lease repaired simultaneous geometry/opacity/stack perturbations in 384 ms (six scoped mutations, zero failures, no concurrent Shell write). Advancing the sidecar generation invalidated the lease, dropped stale events, performed zero further Helper mutations, and let the Shell Guard restore the active surface.
- 3D: with a deliberately injected `mode=watch` Guard and a renewed short provider lease, the Guard recorded `helper_watch_healthy` and made no managed-surface write while the Helper repaired the drift. After lease expiry, the same Guard fell back to its normal Shell geometry repair. The test Guard was then reloaded with the normal Phase-1 `mode=switch` configuration.

These results are X11/runtime evidence only. They do not yet prove a real close/switch/fallback/new-XID handoff, human-visible interactivity, or audio correctness under a durable Phase-3 lifecycle owner; those remain required before any permanent rollout.

## 3B: exact Panel lease

`watch` stays observation-only unless its caller opts into `repairScope: "panel"`. That request must name exactly one Panel XID, a verified Chromium profile, target geometry `1920,0 640x720`, and full opacity. The Helper identity-checks it before subscription and only corrects this Panel's geometry, opacity, and proven-root-stack mismatch. It does not map, unmap, discover, or touch any other window.

Destroy, PID/class changes, unexpected Panel unmap, generation/epoch/lease mismatch, or an unresolvable re-check invalidates the lease. Invalid means no further Helper repair; the caller must explicitly `unwatch`/`revoke` before returning write ownership to Shell.

## 3C: full Provider lease

`repairScope: "provider"` requires one distinct, profile-verified set:

| Role | Required target |
| --- | --- |
| `active` | `0,0 1920x720`, full opacity |
| `previous` | `2560,0 1920x720`, no opacity target |
| `panel` | `1920,0 640x720`, full opacity |

The Helper touches only these three XIDs: it parks `previous`, restores active/Panel geometry and opacity, and raises active/Panel only when the relative root stack order is wrong. Repairs are dispatched by the daemon event loop only after a client reply completes; event bursts are coalesced and actual writes are checked and followed by a bounded final snapshot.

Destroy, PID/class changes, active/Panel unmap, lease/generation/epoch changes, query/parent/mutation failures, or final mismatch fail closed. The Helper does not enumerate or replace windows, and never repairs inactive non-leased Providers. A new switch needs a new lease for the new XIDs.

`health` includes `watchRepairScope`, `watchRepairPending`, `watchSurfaces`, plus `watchRepairRequests`, `watchRepairMutations`, and `watchRepairFailures`. The default observe scope remains read-only; a valid scoped repair lease is the only Phase-3 write capability.

## 3D: default-disabled Guard downshift

`TIKPAL_WEB_MODE_X11_HELPER_WATCH_DOWNSHIFT=0` is the default, so existing Guard cadence and writes are unchanged. An explicit experiment additionally needs `mode=watch` or `mode=auto` and a healthy Phase-3C lease which names the same active and Panel XIDs as `guard-windows.tsv`. Only then does the Guard skip that tick's managed X queries/mutations and sleep `TIKPAL_WEB_MODE_X11_HELPER_WATCH_INTERVAL_SECONDS` (default `2`). It does not create, renew, or revoke leases.

Any absent, invalid, mismatched, pending, or non-provider health result falls through to the existing Shell Guard: immediate repair with its normal `4 × 250 ms` then `1 s` cadence. This is a downshift gate, not a rollout mechanism.

## Local verification

```bash
bash scripts/tikpal-x11-helper-phase3-smoke.sh
bash scripts/tikpal-x11-helper-phase1-smoke.sh
```

The Phase-3 smoke starts a real daemon on Xvfb. It verifies the original 3A observe-only no-mutation path, perturbs and repairs an exact Panel lease, perturbs and repairs all three Provider surfaces, then unmaps the active surface and proves invalidation stops further repair. The Phase-1 suite remains the transaction, ownership, collector, sequence, and watcher regression gate.

These are local tests, not physical display acceptance. The scoped 115 experiment above was separately authorized and was reverted after completion; it does not authorize a permanent mode change, Provider switch, click, or `auto` rollout.

## Required field order

1. Complete an independently authorized 3A 20-round observer comparison with zero Helper mutations. (Completed as the scoped 115 run above.)
2. Run a fresh 3B Panel-only experiment with visibility, interactivity, lifecycle, counter, and event-loop evidence. (Scoped X11 repair evidence is complete; human-visible interaction remains open.)
3. Run a fresh 3C three-surface experiment, including close/switch/fallback/epoch invalidation and a new-XID handoff. (The scoped geometry/identity/generation-invalid case is complete; real lifecycle handoff remains open.)
4. Only after every prior gate passes, authorize the 3D cadence comparison and prove invalidation restores one Shell Guard without Helper counter drift. (The transient lease-expiry fallback is complete; no durable owner has been enabled.)

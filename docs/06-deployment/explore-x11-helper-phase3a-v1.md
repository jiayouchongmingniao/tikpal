# Explore X11 Helper Phase 3A v1

Status: local implementation and Xvfb regression coverage are complete. The required scoped 20-round observer-versus-Shell comparison was run on 115 on 2026-09-02 using a transient Phase-3 sidecar; all 20 rounds passed. The sidecar was then stopped and the production Helper/Guard remained at Phase 1. This proves the X11 observation and repair-boundary behavior below; it is not a human physical-display, audio, or Provider-lifecycle acceptance.

## Scope and safety boundary

Phase 3A adds a native, leased event observer to the Helper. It runs only when the Helper daemon is explicitly started with `--phase 3`; Phase 1 remains the only phase that accepts `switch`.

The observer selects these event masks for its own X client:

- each leased surface: `StructureNotifyMask | PropertyChangeMask`;
- root: `SubstructureNotifyMask`.

It never selects `SubstructureRedirectMask`. Selecting a client's event mask is the observation setup required by X11; Phase 3A performs no geometry, opacity, stacking, map, unmap, discovery, or repair request. `mutationStarted` stays false and `mutationRequests` stays zero. The Shell Window Guard retains every existing write path.

The production unit and `TIKPAL_WEB_MODE_X11_HELPER_MODE` are intentionally unchanged. In particular, do not set `mode=watch` or `--phase 3` on 115 from this change alone: the Shell has not yet been authorized to start or renew a field watch lease.

## Protocol

With `--phase 3`, `health` advertises:

```json
["health", "inspect", "watch", "renew-watch", "unwatch", "revoke"]
```

`watch`, `renew-watch`, `unwatch`, and Phase-3 `revoke` require the `daemonInstanceId`, `connectionEpoch`, `generation`, and `leaseId` bound to that lease. A new `watch` must use the current generation; `unwatch` may use the already-invalidated lease binding solely to remove its subscriptions. A new `watch` also supplies one to eight distinct `{role, xid}` surfaces and a lease duration no greater than 5 seconds. The default watch lease is 5 seconds; a future Guard integration would renew it on a separate authorized cadence.

For example, the local fixture sends a request shaped as follows:

```json
{
  "version": 1,
  "requestId": "phase3-watch",
  "operation": "watch",
  "daemonInstanceId": "...",
  "connectionEpoch": 1,
  "generation": 1,
  "leaseId": "...",
  "leaseDurationMs": 3000,
  "surfaces": [{"role": "provider", "xid": 12345}]
}
```

The daemon records `ConfigureNotify`, `MapNotify`, `UnmapNotify`, `DestroyNotify`, `PropertyNotify`, and `ReparentNotify`, including root-forwarded substructure events. `PropertyNotify` is actionable only for `_NET_WM_PID`, `WM_CLASS`, and `_NET_WM_WINDOW_OPACITY`; other properties are counted as unrelated. The bounded `watchEvents` history and `counters` returned by `health` make the later Shell-versus-Helper comparison auditable.

`wouldRepair: true` means that an existing Shell Guard would evaluate the event; it never causes a Helper write in 3A. Repeated direct/root copies of the same X event are de-duplicated. A watched-window destroy, lease expiry, XCB epoch change, async XCB error, or generation advance invalidates the watch. Invalid events are counted in `watchEventsStaleDropped` and cannot re-enable the watch. `unwatch` removes this client's subscriptions; it is idempotent after the lease is already released.

## Local verification

Run both native gates:

```bash
bash scripts/tikpal-x11-helper-phase1-smoke.sh
bash scripts/tikpal-x11-helper-phase3-smoke.sh
```

The first includes the C-level Xvfb watcher test for managed and unmanaged property events, renewal, stale-generation discard, and unwatch. The second starts a real Phase-3 daemon in a separate Xvfb, verifies the `health` contract, sends a `watch` request, changes the fixture window geometry, confirms a `ConfigureNotify` `wouldRepair` record with zero repair mutations, advances generation, and confirms stale-event rejection before `unwatch`. It then runs the separate 3B/3C exact-XID fixtures described in [the follow-on record](explore-x11-helper-phase3b-d-v1.md).

These tests are local-only. They do not authorize a 115 copy, restart, phase/mode change, lease request, click, provider switch, Guard reload, or field acceptance.

## 115 field result and gate for Phase 3B

An explicitly authorized 3A field run must use a fresh provider/direction, lock, Helper instance/epoch, generation, Guard PID/start time and registry, surface geometry, audio, marker, and counter baseline. Over at least 20 normal Shell-maintained rounds, the retained evidence must show all of the following:

- every Shell repair has a corresponding Helper observation;
- no Helper observation is a false repair candidate;
- no event feedback loop occurs;
- no old generation or epoch event is accepted;
- Helper repair mutation counters remain zero; and
- teardown leaves no active watch and the Shell still has all write authority.

The 115 run used one active Suno XID (`81788931`) and 20 independent, five-second observe leases. On every round a controlled one-pixel geometry drift was visible to the observer and the existing Shell Guard restored `0,0 1920x720`. Every lease reported exactly one new `wouldRepair` record and zero Phase-3 mutations; the Shell trace recorded the permitted generation-521 geometry repair. Restore time was 188–3709 ms (mean 1320.5 ms). The final sidecar health was `UNWATCHED`, with zero `mutationRequests`, `watchRepairRequests`, `watchRepairMutations`, and `watchRepairFailures` for the Phase-3A path.

The retained device evidence is `/root/tikpal-phase3-backups/phase3a-20260902-0820/phase3a-final-20rounds-20260902.tsv`. It is a device-local field artifact, not a replacement for physical visual/audio acceptance. The scoped comparison satisfies the 3A prerequisite for a separately controlled 3B experiment; it does not change the durable Helper phase or enable `auto`.

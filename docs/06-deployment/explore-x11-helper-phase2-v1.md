# Explore X11 Helper Phase 2 v1

Status: local implementation and regression coverage are complete. The controlled Phase 2 scoped one-shot passed on 115 on 2026-09-02. It is not a claim that the separate full ten-provider, 20-round acceptance has passed.

## Scope

Phase 2 keeps the native Helper in Phase 1 and Shell mode `switch`. It shortens the resident-switch hot path without weakening the physical contract: the target and previous provider, Side Panel, state owner, lock release, audio transition, and composited pixels must still agree before a round is accepted.

This is not permission to begin a multi-provider loop. Each field run still requires an explicit authorization and a new preflight of the provider/direction, lock, Helper generation/owner/lease, Guard PID/starttime/registry, X11 geometry, audio gates, visible-frame proof, and Helper counters.

## Hot-path changes

- The Shell creates a short-lived `provider-switch.pid` marker before a foreground resident switch. While it exists, the Helper returns `GUARD_PAUSED_FOR_SWITCH` to a Window Guard inspection instead of allowing advisory work to occupy the single-threaded X11 daemon. The Guard then resumes only after the foreground state and registry name the new surfaces.
- The foreground path retains a verified Guard where possible. `guard-process-verify` validates its PID, start time, command shape, effective user, and uniqueness; an operational, stale-identity, or duplicate result fails closed instead of starting another Guard. The systemd runtime directory is preserved so the Helper generation fence is not discarded during a service restart.
- Hot-path control traces and advisory provider-state reconciliation no longer perform synchronous X11 sampling or queue per-provider state writers ahead of the physical reveal. The mandatory initial-entry trace remains fail-closed. The runtime handoff file remains an atomic serialized write, with trace boundaries for queue, read, and write time.
- A ready resident page can use the Helper's already-verified foreground snapshot rather than wait on an off-screen compositor wake. Deferred audio/DevTools work is post-commit evidence; it cannot move the physical reveal timestamp.
- Chromium provider profiles now set `profile.default_content_setting_values.notifications = 2`, blocking notification permission prompts for every provider origin by default.

## Native Helper and observer changes

`screen-probe` is a Phase 1 read-only Helper operation. It samples the composed root with bounded XCB `GetImage` replies and returns independent pixel ranges for the `1920 x 720` provider region and `640 x 720` Side Panel. The physical acceptance observer uses that probe first; only an older staged Helper falls back to a bounded raw `ffmpeg` capture. A probe is paused during a foreground switch and never mutates X11.

The Helper also bounds an incomplete local client frame to 50 ms and exposes `guardPausedRequests` and `protocolFrameTimeouts` in `health`. A reply timeout, XCB connection error, or poll error remains a failure and resets the XCB connection; it is not treated as a visible frame.

The acceptance collector now uses Helper `inspect` for its three-surface geometry check, keeps transient trace events outside retained evidence, and separates trace-confirmed runtime/audio/lifecycle completion from the physical stamp. An explicitly scoped provider run may exit successfully only for its scoped gate; its summary must retain `provider_scope_kind: "scoped"` and `gate_passed: false`, so it cannot be represented as full Phase 2 acceptance.

## Local verification

The repository checks cover the native frame protocol, Guard pause behavior, Phase 1 timeout retry, late-writer audit, profile notification default, guard injection retry, initial-entry lifecycle, and static kiosk contracts. Run the relevant local gates before a deployment:

```bash
bash scripts/tikpal-x11-helper-phase1-smoke.sh
npm run test:initial-entry
npm run test:kiosk
npm run typecheck
```

These checks do not prove a physical reveal on 115. They do not authorize a deployment, service restart, Guard reload, click, reverse switch, or a 20-round run.

## 2026-09-02 controlled field acceptance

The final controlled `switch-once` run was Amazon Music -> Deezer. Its provider scope was the nine declared profiles `suno`, `spotify`, `apple_music`, `tidal`, `qobuz`, `deezer`, `amazon_music`, `qq_music`, and `netease_music`. It completed one round with:

- physical `visible_ms`: `1348`;
- stable completion: `4206 ms`;
- correctness, performance, and lifecycle: `1/1` each;
- observed free lock, no anomaly, and `scoped_gate_passed: true`.

The retained evidence is `.tikpal/explore-physical-acceptance-phase2-deezer-baseline-final-20260902T0132/` on 115. Its summary deliberately keeps `gate_passed: false` because the run is scoped and has one round; that field protects against representing a controlled Phase 2 pass as the full ten-provider, 20-round result.

## Subsequent extension boundary

A later attempt to extend this into a scoped 20-round sequence stopped at round 6 when Spotify -> Apple Music reached stable completion in `7660 ms`. It is separate diagnostic evidence and does not invalidate the controlled one-shot pass above, but it also cannot be counted as multi-provider acceptance. A stale Qobuz registry versus Spotify Guard was likewise detected in a later fresh preflight and stopped before action.

Any later full run must start from a newly checked provider/direction, lock, Helper generation/owner/lease, Guard PID/starttime/registry, geometry, frame, audio, marker, and counter baseline. If any gate differs, stop before the first click.

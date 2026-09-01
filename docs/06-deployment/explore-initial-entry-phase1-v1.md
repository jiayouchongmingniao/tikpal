# Explore Initial-entry Phase 1 v1

Status: the disabled-Helper initial-entry diagnostic and lifecycle baseline completed on the Gentoo kiosk. It later supplied the evidence needed for the separately recorded native-Helper Phase 1 two-Canary promotion; it does not authorize a provider-switch loop.

## Purpose

An Explore open with no active provider must turn a resident provider into the visible `1920 x 720` surface, restore the Side Panel at `640 x 720`, and commit active-provider state only after that physical reveal succeeds. Previously, the shared legacy X11 path could return early from a failing command without recording the failing operation. A ready HTTPS page alone was therefore not sufficient proof of a visible surface.

The Phase 1 implementation keeps `TIKPAL_WEB_MODE_X11_HELPER_MODE=disabled` and adds an opt-in JSONL trace for that initial-entry path. It preserves the existing Shell mutation route while making the physical sequence observable and fail-safe.

## Initial-entry contract

Before any mutation, the trace destination must already exist and be writable. If that precondition fails, the request stops before a reveal, state commit, `opened` event, or physical stamp.

For a successful resident reveal, the trace records these numbered physical steps in order:

1. cached target XID read and identity validation;
2. Side Panel map state;
3. Side Panel geometry restore;
4. Side Panel opacity restore;
5. target map;
6. target opacity restore;
7. target move;
8. target resize;
9. target raise;
10. kiosk lower/stack repair;
11. foreground reassert;
12. final surface geometry and visibility snapshot;
13. physical stamp write.

Resident preparation can precede this list: request ownership, Onboard hide, Side Panel preparation, proxy checks, Guard stop, and the target-window wait are independently traced. Provider launch, paint wait, and prewarm steps appear only when that request actually needs them.

Each record includes the request ID, provider, phase, step number/name, XIDs, Helper/process generation, caller PID, monotonic start/end timestamps, command type, expected geometry, bounded stdout/stderr, mutation-started flag, exit status, and before/after snapshots. The event names are `initial_entry_step_started`, `initial_entry_step_completed`, `initial_entry_step_failed`, and `initial_entry_aborted`.

## Failure and cleanup rules

- Commands are run with explicit status capture, rather than relying on `set -e`, so a failed X11 operation is logged before the pre-existing failure status is returned.
- An `ensure_side_panel` child that uses `exit` is contained in a subshell; the parent can trace the failure and release its lock.
- Trace append failure before mutation fails closed. After mutation begins, trace loss never changes the X11 command's status or prevents state restoration, lock release, or cleanup.
- Stdout and stderr are capped at 2048 bytes per record to keep the hot path bounded.
- `xdotool getwindowmapstate` is used where supported; an `xwininfo` fallback keeps map-state validation available on older Gentoo `xdotool` builds.
- Geometry interpolation uses explicit `${x}`, `${y}`, `${width}`, and `${height}` delimiters. This avoids a nounset expansion such as `$y_` being mistaken for a variable.

## Fixture coverage

`npm run test:initial-entry` runs the real Shell path under Xvfb and validates a complete `activeProvider=null` success plus targeted failures for Panel placement, target destruction after validation, map, opacity, move, resize, raise, reassert, final geometry mismatch, primary-and-fallback failure, and trace loss.

The fixture asserts that every injected failure names one unique step/error, produces no `opened` event or physical stamp, leaves `activeProvider=null`, releases the lock, and creates no extra Guard or registry entry. The map-state compatibility path uses an Xvfb client and `xwininfo` stub rather than a string-only assertion.

The Phase 1 suite also retains the Helper smoke, Guard lifecycle, late-writer, acceptance summary/exit, kiosk smoke, TypeScript build, Shell/Node syntax, and whitespace checks.

## Field acceptance record

The approved single traced initial-entry request on the Gentoo kiosk completed with the native Helper still disabled:

- the request returned HTTP 200 and committed Spotify as the active provider;
- the trace contained 42 records, all completed successfully, including the complete physical sequence and physical stamp;
- Spotify was `IsViewable` at `1920 x 720`; the Side Panel was `IsViewable` at `640 x 720`; both had restored full opacity;
- the web-mode lock was free after the transaction, and exactly one Guard process owned the Spotify and Side Panel registry;
- Helper health showed no mutation request, XCB timeout, or reconnect increment for this disabled-mode path.

This is device-side physical-surface evidence (stamp, map state, geometry, opacity, and Guard ownership). It is not a substitute for a separately requested visual or interaction acceptance session.

## Follow-on boundary

The native-Helper Phase 1 two-Canary promotion is recorded in [Explore X11 Helper Phase 0](explore-x11-helper-phase0-v1.md). Do not use this initial-entry result or that promotion to start a multi-provider/20-round run without a fresh explicit authorization, service/X-session/lock/owner preflight, and retained first-request trace.

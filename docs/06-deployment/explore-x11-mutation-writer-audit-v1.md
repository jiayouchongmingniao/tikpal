# Explore X11 Mutation Writer Audit

Status: local static audit, pre-fix Xvfb reproduction, and post-fix stale-writer rejection. This document does not authorize a 115 deployment or canary.

## Mutation transport inventory

All `tikpal-web-mode.sh` X11 commands now emit through the opt-in `TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH` JSONL wrapper:

- `xdotool_safe`: move, size, raise/lower, activate/focus, map/unmap, close, and pointer movement;
- `wmctrl_mutation`: geometry, fullscreen/maximize state, and `above` state;
- `xprop_mutation`: `_NET_WM_WINDOW_OPACITY` writes;
- `xsetroot_mutation`: root background writes;
- native Helper: switch/revoke control events plus request, mutation, fence, and final-snapshot monotonic timestamps.

Chromium's own `--window-position` / `--window-size` processing is not a Shell X11 request. It is correlated by the later Shell tile event and the Chromium PID/profile identity.

## Writer classification

| Writer/call path | Lock and arbitration | Background lifetime | Can retain old active/generation? | Risk for the observed inversion |
| --- | --- | --- | --- | --- |
| `guard_maintain_windows` -> `tile_guard_windows_fast` | Holds `web-mode.lock`; exact registry XIDs; `owner-allows` is checked before mutation while the lock remains held; the bottom wrapper also requires current all-writer permission | No background mutation is launched | A Guard that observes a newer current registry generation refreshes its token and skips one mutation tick | Low for a check/exec gap in the current code; still traced by PID/role/generation |
| `recover_guard_window_list_locked` -> `tile_visible_web_mode_windows` | Holds `web-mode.lock`; `owner-allows --all`, read-only enumeration, second `--all`, then mutation | No background mutation is launched | Fails closed on malformed/missing generation in Helper mode | Low; covered by the Phase 1 recovery fixtures |
| foreground `open` / resident reveal -> `position_resident_switch_windows_fast`, tile/opacity/restack helpers | Top-level `with_web_mode_lock`; Helper takeover and Shell fallback run under that lock | Old-media CDP pause is background, but it is not X11 | Foreground state is current-request checked | Low for a second Shell geometry writer while the top-level lock is held |
| `close` / `close-full` -> parallel surface parking | Top-level `with_web_mode_lock`; parent waits for every parking child before returning | Yes, but children are joined before the lock owner exits | Close request ownership is checked before state commit | Low for a post-lock late write; trace proves child completion and geometry |
| `prewarm` / `warm-pool` -> `launch_provider_prewarm_worker` -> `launch_provider_for_pool` -> final `tile_window` | The provider launch lock remains, and every bottom-level surface mutation now separately acquires `web-mode.lock`, compares its process generation with the current generation, checks all-writer owner permission, executes/observes, then releases | Yes; queue and workers can wait on Chromium/CDP before reaching the gate | It can retain an old token, but generation mismatch returns 76 before X11 | High pre-fix candidate; locally blocked by the lifecycle gate |
| `reconcile_provider_pool_in_background` -> `start_provider_pool_prewarm` | Reconcile remains detached; all X11 effects of the later worker pass through the lifecycle gate | Yes | Its initial active-provider argument can become stale, but the later X11 write cannot cross a generation | Origin for the pre-fix writer class; locally contained by the bottom gate |
| `ensure_side_panel` -> background `launch_side_panel` -> final `tile_window` | Background child is not joined, but its eventual XID mutation acquires `web-mode.lock` and validates current generation/all-writer permission | Yes | An old launch can survive, but its final tile is blocked after generation advance | Medium pre-fix Panel risk; locally contained by the bottom gate |
| `recover_or_cover_provider_failure` -> full visible-window retile | Reached from a foreground open/failure transaction that holds `web-mode.lock`; no detached X11 child | It restarts guards after synchronous repair | Uses current/failed provider parameters from the foreground transaction | Medium if called from a future unlocked entry point; not currently a detached post-Helper writer |
| Onboard/focus helpers | `onboard.lock`, not `web-mode.lock`; no Helper owner/generation check | Some keyboard lifecycle is independent | It can restack/focus but does not assign provider left/stage geometry | Not a match for the two-provider geometry inversion |

## Reproduction result

`scripts/tikpal-x11-late-writer-fixture.sh` uses Xvfb, the real Helper transaction, independent surface clients, an independent legacy mutation client, and a FIFO barrier. Its first pass preserves the pre-fix lifecycle and reproduces:

1. generation 1 legacy writer passes `owner-allows` and pauses before its X11 command;
2. generation 2 Helper publishes ownership, switches Qobuz left / Apple Music staged, fences, and returns the correct final snapshot;
3. runtime state and generation-tagged Guard registry commit, Helper revoke succeeds, and owner returns to Shell;
4. the generation 1 writer resumes and reverses Qobuz / Apple Music;
5. a generation 2 Guard writer converges the geometry again.

The trace assertion attributes the reversing command to its exact Shell PID, command PID, role, old owner/generation/active provider/registry generation, and its post-command geometry. This proves the failure mechanism and trace attribution. It does not prove which 115 process produced the preserved canary inversion; that requires preserved field trace or one separately approved traced canary after the protocol fix.

The second pass enables the production lifecycle gate for the same paused writer. After generation 3 Helper success, runtime/registry commit, revoke, and Shell-owner restoration, the stale generation 2 writer acquires `web-mode.lock`, returns status 76 with `reason=stale_generation`, executes no X11 command, and leaves the Helper geometry unchanged.

## Minimum repair applied locally

The repair is at the shared bottom writer rather than only at one prewarm caller. In Helper `switch`/`auto` mode, every XID mutation now acquires or inherits `web-mode.lock`, compares its process generation with the current generation, requires `owner-allows --all`, waits for command completion, performs the optional read-only geometry observation, and only then releases the lock. Missing `flock`, lock timeout, stale generation, and Helper ownership are fail-closed. Generation changes update the foreground token; a long-lived Guard adopts a newly published current registry generation but skips its first mutation tick.

This is local evidence only. Remote source/binary drift must be repaired before any installer use, and the change still requires a narrow disabled deployment plus no-click health validation before requesting another non-Spotify canary.

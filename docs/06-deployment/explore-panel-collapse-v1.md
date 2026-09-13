# Explore collapsible Side Panel

The full Side Panel remains the default on every Explore entry and provider
switch. Users can explicitly collapse it to a 56px rail with a centered Expand
button and a bottom Exit Explore button. The centered Expand target is 48x88px;
the bottom Exit target is 48x48px. Both use lightweight icons without a resting
background, border or shadow. Expanded mode places the 48x48px Collapse button
in the header action group and uses the ordinary 16px content inset, without a
separate toggle gutter. Pressed feedback, focus outlines and disabled states
remain available. All seven
UI languages include action labels, accessible names, and failure copy.

## Geometry and ownership

On the 2560x720 layout, expanded windows are Provider `0,0 1920x720` and
Side Panel `1920,0 640x720`. Collapsed windows are Provider `0,0 2504x720` and
Side Panel `2504,0 640x720`. Only the panel's leftmost 56px remain onscreen.
The panel is never resized to 56px: the native Helper rejects small surfaces.
No browser is created, reloaded, navigated, or audio-gated by a layout action.

`tikpal-web-mode-panel.mjs` validates and derives geometry from the configured
left/panel regions. `tikpal-web-mode-panel.sh` keeps immutable base geometry
separate from effective runtime geometry. Capability is enabled on an Open
only after checking one active monitor, a matching root size, adjacent regions,
matching heights, and valid Helper-sized windows. Unsupported configurations
keep the original layout and do not show Collapse.

The launcher sources the module for all operations. Foreground commands refresh
geometry after acquiring `web-mode.lock`; the persistent Guard does so inside
its locked inspection/recovery. The shared mutation gate rejects geometry
prepared before a panel-mode change, including when the Helper is disabled.

The layout action takes the existing window lock with the API's bounded caller
timeout, verifies profile identities and the current session, and revokes the
prior Helper lease/watch before publishing Shell ownership. It
updates the Guard registry generation, places and raises the existing windows,
then independently verifies identity, geometry, map state, opacity and stacking.
Only then does it atomically commit panel mode under `provider-state.lock`.
The Shell Guard owns steady-state layout afterward; the next Provider switch
uses the existing Helper lifecycle. There is no new native Helper operation.

A partial failure gets one verified rollback while window ownership is retained.
Rollback never writes a stale runtime snapshot. If rollback fails, a verified
Side Panel is returned to its visible expanded position as a recovery surface,
and the operation reports failure. It does not claim the viewport is correct.

## API and runtime state

`WebModeState` adds backward-compatible fields:

- `panelMode`: `expanded` or `collapsed`, default expanded.
- `panelLayoutSupported`: whether this device's last Open validated the layout.
- `panelSessionId`, `panelXSessionGeneration`: the completed Open's identity.

`POST /api/v1/web-mode/actions` accepts:

```json
{
  "type": "panel_mode",
  "panelMode": "collapsed",
  "panelSessionId": "<current panelSessionId>",
  "panelXSessionGeneration": "<current panelXSessionGeneration>"
}
```

The shell command is `tikpal-web-mode.sh panel-mode expanded|collapsed`, with
expected provider/session/generation supplied by the API. It cannot operate on
closed Explore, a pending switch, or a stale session. Repeated target modes are
idempotent and still verify the actual layout.

The API blocks concurrent layout/open/reset/proxy requests during the layout
operation. Close is accepted and waits for the current bounded layout command
before closing; further layout requests are rejected while Close is pending.
API runtime writers wait for the layout command and then re-read state, avoiding
clobbering the shell's state-lock-protected commit. Layout commands run in their
own process group; timeout kills the whole group so descendants cannot commit
late. The client re-reads state after a failed/uncertain response.

Mode is runtime-only: page refresh retains it, Close and new Open reset it,
and kiosk startup uses the existing startup-reset cleanup. Other runtime fields
are preserved. The OAuth coordinator already copies the current parent-window
bounds, so a login popup follows either width without covering the rail; no
OAuth behavior changes are needed.

## Guard-lock contention

Panel-mode is a user-visible layout request. The API supplies
`TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS=5` when it invokes `panel-mode`; the
`panel-mode` launcher branch must preserve that value rather than forcing a
zero-second lock timeout. This allows a request to wait briefly for a Guard
inspection that already holds `web-mode.lock`, instead of failing immediately
and making the client reconcile back to the previous panel state.

The existing provider, session and X-session-generation checks still run after
the lock is acquired. A request that becomes stale therefore fails safely; this
change does not open, reload, navigate or audio-gate a provider. While the
request is pending, the client stays busy and cannot issue another panel action.

## Local verification

Run `npm run test:explore-panel` for geometry/session/API tests, Xvfb tests, and
seven-language browser checks. The Xvfb fixture compiles the existing native
client/Helper and uses XCB adapters for tools absent on macOS. It checks actual
window geometry, Helper watch revocation, Guard stability, stale writes, partial
failure rollback and destroyed windows. Browser tests cover button reachability,
hidden controls, refresh reconciliation, error recovery and Exit.

Also run `npm run build`, `npm run test:kiosk`, the X11 late-writer and Helper
Phase 3 fixtures, plus the existing OAuth fixture. These are local proofs;
Xvfb adapter timing is not kiosk performance or physical touch acceptance.

The local verification run passed the panel suite, typecheck/build, kiosk
lifecycle/audio regressions, Helper Phase 3, late-writer and OAuth fixtures.
One instrumented Xvfb run took 2885ms to collapse (including Helper revocation)
and 1067ms to expand. The <=1s target has not been demonstrated. Expansion keeps
the rail visible until the server confirms the new layout so Exit remains
reachable during the transition.

For the Guard-lock change, `npm run typecheck`,
`node scripts/explore-panel-fixture.mjs`,
`bash scripts/explore-panel-x11-fixture.sh`, and
`node scripts/kiosk-package-smoke.mjs` passed. The API fixture verifies the
five-second panel lock timeout and the package smoke test prevents the launcher
from overriding it with zero. `scripts/explore-panel-browser-fixture.mjs` still
stops at its existing Exit error-status assertion; it was not changed as part of
the lock fix.

## 207 rollout and physical acceptance (not performed by local implementation)

1. Inspect current display, Helper mode, window profiles/XIDs, service state and
   deployed hashes. Preserve any other ongoing changes and device-local config.
2. Back up the launcher, both panel modules, API and front-end bundle/index.
   Deploy exactly these inputs and the changed front-end sources. Publish assets
   before index, preserve old assets for rollback, and verify hashes.
3. Update the API and the resident Window Guard through the existing service and
   `reload-guard` paths. A front-end-only deploy is insufficient. Avoid deploying
   unrelated CDP Manager/extension changes. Close/reopen Explore to establish the
   new session capability; preserve profiles and login data.
4. On one provider, perform 10 collapse/expand cycles, then hold collapsed for at
   least 30 seconds. Verify real X11 geometry, visible rail, touch targets and no
   Guard/watch snap-back. Record click-to-confirmation timings; target <=1s.
5. Repeat on all ten providers. Record login/network blockers per provider.
   Verify no navigation, reload, media pause, track change, or loss of login.
   Audibility and physical touch require device observation.
6. Check external Provider switches, login popups, error pages, rail Exit and
   immediate re-entry. Stop on the first reproducible geometry bounce, lost
   recovery control, persistent flicker or playback interruption.

For rollback, first close Explore using the version that knows the collapsed
geometry, restore the backed-up API/launcher/modules/index, update API/Guard,
and reopen. Do not restore an old runtime-state file over a newer session.

## 207 deployment — 2026-09-11

Deployed to `192.168.10.207` (`gentoo-nvme-207`). Verified one HDMI-0 monitor,
2560x720, original Provider 1920x720 and panel 640x720. API, launcher, both panel
modules and the built index match local SHA-256 hashes. Restarted only API and
replaced the resident Guard; web and kiosk services remain active. Refreshed the
Side Panel and verified the new collapse/Exit controls in a real screen capture.
The API reports expanded mode and `panelLayoutSupported: true`.

Backup: `/home/moode/code/tikpal.deploy-backups/20260911-panel-collapse/before.tar.gz`.
The archive reported changing asset-directory timestamps during publication;
the archived old API, launcher and index hashes were independently verified
against the pre-deploy values. Existing assets were retained on the device.

Initial Deezer re-entry reported a window-resolution error, after
which the UI fell back to QQ Music. A subsequent Deezer switch completed. An
external TIDAL switch was then observed, so automated switching/layout acceptance
was paused to avoid concurrent device control. No claim is made for ten-cycle,
30-second hold, all-provider, audio-continuity, latency or physical-touch
acceptance. Device remained on TIDAL with the full panel visible and one Guard.

## Entry control visual refinement — 2026-09-11

Moved Collapse into the header and removed the 64px toggle gutter. The collapsed
rail remains 56px wide with a centered 48x88px Expand target and a bottom 48x48px
Exit target. Only component placement and CSS changed; API, state, native
geometry, locks and provider switching are unchanged by this refinement.

`npm run build` passed TypeScript and the production build (the existing large
chunk warning remains). `npm run test:explore-panel` passed geometry/API, X11 and
seven-language browser regressions. Browser checks verify the header controls,
16px content inset, exact target rectangles, keyboard focus, busy states,
failure recovery and Exit.

Published front-end assets before the index on 207, retaining old assets and
backing up the previous index to `/tmp/index-before-panel-visual.html`. Refreshed
only the Side Panel. Native pointer clicks and screen captures confirmed rail
expansion, header collapse without the old gutter, and bottom Exit returning to
the ambient screen. State reports no error and no active provider after Exit.
No music or advertisement controls were clicked; login profiles and volume were
not reset. Physical touchscreen feel still requires user acceptance. No GitHub
commit was made for this refinement.

## 207 Guard-lock deployment — 2026-09-13

Deployed the API and `tikpal-web-mode.sh` lock-timeout correction to 207 and
restarted `tikpal-api`; `tikpal-web`, kiosk, kiosk-viewer and the resident CDP
manager remained active. The device copies were backed up before replacement and
their SHA-256 hashes matched the deployed sources.

An API/X11 controlled check held the real `web-mode.lock` for three seconds,
then requested collapse. It completed collapse after 3951ms, remained collapsed
until explicitly expanded, and completed the full collapse/expand sequence in
5842ms. Apple Music remained the active provider and no music, login, ad, or
navigation control was used. This confirms bounded contention recovery on the
device; it does not replace a physical touchscreen or noVNC acceptance check.

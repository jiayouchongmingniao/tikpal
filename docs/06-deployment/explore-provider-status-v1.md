# Explore provider status and Reload v1

Status: current implementation and Radxa 102 field check completed on 2026-09-15.

## Card state contract

The Side Panel presents one provider state derived from the existing API state; it
does not add a second API contract.

| Visible label | Source of truth | Card behaviour |
| --- | --- | --- |
| Current | `activeProvider` when there is no provider error | Selected foreground treatment. |
| Opening | `openingProvider`, or resident status `opening` | Target is in progress; the prior foreground remains Current. |
| Prewarming | Resident status `prewarming` | Background startup is in progress. |
| Ready | Verified resident status `ready` or `active` for a background provider | Available in the parked resident pool. |
| Waiting | No resident state | Has not started yet. |
| Standby | Resident status `frozen` | Parked and intentionally inactive. |
| Error text | `check_setup`, `check_proxy`, region failure, inferred page error, or reload failure | Overrides the visible label. A foreground error retains the Current selected treatment so the user can still identify the left pane. |

`Active` remains an internal resident lifecycle value and is never a provider
card label. The mapping is a pure Side Panel function shared by card text,
classes, ARIA state, and the footer to prevent contradictory UI.

## Switching and Reload

`activeProvider` is the sole foreground fact. A switch response from
`POST /api/v1/web-mode/actions` can be accepted while the old provider is still
visible, so it must not be rendered as a completed switch. The panel waits for
the target to be active and lifecycle-ready before it becomes Current; the old
provider then becomes Ready.

Each card exposes an independently clickable, localized Reload button with an
accessible name. Reloading the current provider refreshes its CDP page in place.
Reloading another provider uses the same switch lifecycle first, waits for that
provider to become actual foreground, then refreshes its page. The operation
keeps the browser profile, login cookies, and proxy settings. Its request token
and session generation are checked after every asynchronous step, so an old
operation cannot reopen or overwrite a panel after Close.

The button shows progress, locks duplicate provider and Reload actions, leaves
Close usable, and keeps the Side Panel visible. A successful refresh command is
not sufficient: normal readiness checks run again. Their existing bounded timeout
returns a localized reload error and unlocks Retry without moving to another
provider.

## Validation

Local checks passed for the final implementation:

- `npm run typecheck`
- `npm run build`
- `npm run test:explore-panel` (all seven supported UI languages)
- `npm run test:explore-reload`
- `npm run test:kiosk`; the Linux-only audio-release subcheck was skipped on the
  macOS development host as designed.

The general interaction smoke reached its unrelated Hi-Fi lyrics fallback
assertion before the Side Panel section; the isolated panel, reload, lifecycle,
and kiosk checks above cover this change.

## Radxa 102 field deployment

Only the Side Panel frontend artifact was deployed to `192.168.10.102`; the API
process, provider profiles, cookies, and current provider data were retained.
The Side Panel was refreshed in place. Field state was inspected through the
local API and X11 geometry after each settled transition:

1. NetEase was foreground and displayed Current; Suno and Spotify were Ready.
2. NetEase → Suno → Spotify → Suno → NetEase each held the old provider as
   Current while the target displayed Opening.
3. Each transition was accepted only after the target became active and ready.
   The final state was NetEase foreground, Suno/Spotify/QQ Music parked Ready,
   no opening provider, and no lifecycle error.

The final X11 layout placed NetEase in the left `0,0` pane, the Side Panel at
`1920,0`, and Suno/Spotify parked offscreen at `2560,0`. This proves the visible
provider and Side Panel state agreed after settling. It does not replace physical
listening acceptance for protected-media playback.

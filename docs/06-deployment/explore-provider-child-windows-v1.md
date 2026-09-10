# Provider child-window policy v1

The persistent CDP manager reuses Target creation and URL-change events to inspect
provider child pages. Initial discovery also checks existing children, so a known
advertising window can be cleaned up without clicking an ad again. There are no
new timers, browser extensions, permissions, or API endpoints.

Only Deezer is enabled: direct children opened by a verified deezer.com page
that reach grainger.com (including subdomains) are closed. Deezer-owned offers
children are also closed only when their localized /offers path has all three
observed markers: utm_source=autopromo, utm_medium=audio, utm_content=conversion.
Unmarked offers and account pages remain untouched. Domain matching uses
parsed hostnames and label boundaries. The main player, ordinary same-site navigation,
children without a live verified opener, nested children and other providers
are not closed. Unknown external destinations stay open; logs contain only
provider, source hostname and destination hostname, never full URLs or queries.
Repeated observations of the same child hostname are deduplicated.

Observed Google/Apple account targets remain protected through subsequent URL
changes for that manager process lifetime. This is a narrow known-destination
rule, not a universal authentication detector; do not broaden it to block all
external hosts. Authentication history from before manager startup is not
reconstructed. Additional provider/domain rules require separate field evidence
and login/navigation regression checks.

A successful close restores focus only if Deezer is still active, no switch is
opening, the original parent still exists, and its native bounds are visible.
State is checked again after fetching bounds to reduce handoff races. A failed
close or disappearing target does not trigger a retry loop. This post-creation
cleanup may briefly display or load the destination; it is not network blocking.
It does not stop in-page advertisements, audio/video ads, or same-tab redirects.
The policy depends on the CDP manager being enabled and connected.

Validation:
- `node scripts/provider-child-windows-fixture.mjs`: verified parent, spoofed
  hostname, unknown URL logging, protected login navigation, background/handoff,
  parked parent, failed close, duplicate events and other-provider isolation.
- `node scripts/provider-child-windows-browser-fixture.mjs`: real Chromium Target
  events with entirely intercepted local fixtures; known child closes, login and
  unknown child stay open, and the original player survives.
- `node scripts/tikpal-cdp-session-manager-smoke.mjs` and
  `node scripts/kiosk-package-smoke.mjs` passed.

207 deployment: copy the manager and adjacent policy module, then restart only
`tikpal-web-mode-cdp-manager.service`. Provider browsers and profiles remain in
place. The existing Grainger child was automatically closed; the journal recorded
`closed provider=deezer source=www.deezer.com destination=www.grainger.com`.
Target inventory retained the original Deezer target and a fresh X11 screenshot
showed the normal player restored. No advertising link was clicked and no new
advertising page was opened for field validation. Other-provider policies remain
disabled. No GitHub commit/push is part of this change.

A second field report identified an audio-promotion child at /en/offers/ on
www.deezer.com. The original domain-only policy intentionally allowed it. The
narrow promotion-marker rule now has positive and negative unit tests, real
Chromium mocked-window coverage, and a protected-login-chain regression.
The new offers child was automatically closed on 207; target inventory retained
only the original Deezer player. The user clarified that clicking the blank area
of the displayed ad triggered this child, not an intentional subscription-button
click. The policy is independent of click position; it does not remove the ad's
click-capture layer or promise to prevent all unknown popups before creation.

# Explore OAuth popup ownership

A provider launched offscreen can leave a new Google/Apple login popup outside
of the display. The X11 fast guard owns registered main surfaces and does not
necessarily discover login child windows.

`deploy/chromium/tikpal-oauth-window-layout.mjs` runs in the provider guard. It
recognizes HTTPS Google Accounts (including the immediate myaccount redirect)
and Apple Account targets only with a verified provider opener in that browser
profile. It retains ownership through callback navigation until the child closes.
It does not change URLs, cookies, credentials, callbacks or opener relationships.

The child follows the main window's bounds using CDP Browser commands, including
offscreen parking. Chromium's extension windows.update API rejects offscreen
bounds, and minimize does not work on this device without a window manager; that
initial extension implementation was withdrawn. Main window placement remains
owned by the existing X11 helper.

During opening/deactivation, layout follows the parent without requesting focus.
An active visible child is activated once; closing it restores its opener.
Background close does not request focus. Browser-domain reconciliation also runs
while the parent renderer is frozen. Existing active polling (250 ms) continues
while a child is tracked; without a child the existing idle schedule remains.
Recognition on idle providers can take the normal idle polling interval.
The visibility check assumes the current left pane at x=0 and parking to its right.

Validation: `node scripts/oauth-windows-fixture.mjs`, Node syntax checking, and
`node scripts/kiosk-package-smoke.mjs`. The fixture covers verified discovery,
unrelated windows, unchanged-state no-op, handoff parking, switch-back, callback
navigation, Google/Apple hosts, and foreground/background close behavior.

207 field verification (2026-09-10): a Google child followed Qobuz at x=0,
1920x720; switching to Suno moved both Qobuz and its child to x=2560, confirmed
with native X11 window geometry. Switching back restored the child at x=0 and
focused it. A second round trip also passed after the Google account-home
redirect. Closing that foreground child left only the focused Qobuz main window;
a fresh X11 screenshot confirmed the logged-in album page and side panel were
restored. This validates window ownership, not OAuth authorization itself.
An earlier incomplete-parameter test displayed Google error 400; it was a test
artifact, not evidence of a failed Qobuz login. Test windows must be closed after
verification, restoring the existing logged-in Qobuz page.

Deploy both the guard and the adjacent module, then run `refresh-guards` as the
kiosk user. No profile reset is needed. Removing the earlier extension prototype
also requires restarting Explore browsers once to unload its background code.

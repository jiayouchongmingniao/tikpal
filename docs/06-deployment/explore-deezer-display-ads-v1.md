# Deezer display ads and Premium offer dismissal

The Deezer-only CSS content-script entry hides `#adslot1.ads-top` and
`#companion_banner`, observed on 207. It applies at document start and to dynamic
insertions without a JavaScript observer or timer. No new permission is needed.
It hides display slots, not their network traffic. It does not hide generic
modals, backdrops, cookie UI, navigation or playback controls.

The existing provider guard additionally recognizes the observed Premium offer
by `premium_offer_title` within an aria-modal dialog and the presence of
`premium_offer_primary_cta`. Only its visible enabled Close button with the
observed Chakra close-button class is clicked. This narrow check runs during the
existing foreground Deezer dismissal pass, with foreground CDP priority to avoid
maintenance throttling. Unknown dialogs retain the existing generic safe-close
behavior. No new polling loop is introduced.

Audio/video playback ads, subscription restrictions, sidebar upgrade cards and
the separate full-length-tracks promotion banner are not hidden by these rules.

Validation: `node scripts/deezer-hide-ads-fixture.mjs` checks static/dynamic slots,
selector specificity, retained player/navigation/login/error/cookie/backdrop UI,
Deezer manifest scope, repeated Premium offers, and hidden/incomplete dialogs.
`node scripts/kiosk-package-smoke.mjs` checks packaging and existing guard rules.

207 field observations: both display slots report display:none on Explore and
Home. Native navigation reached Home; no visible modal remained. The user stated
that they manually clicked the popup X, so this does NOT establish automatic
popup closure on the device. That behavior is covered by the browser fixture
and remains pending a fresh real popup. A simulated CDP touch on Flow began a
playback ad; this does not establish physical touchscreen or full music playback
acceptance. The ad remains in scope of Deezer's normal player behavior.

Deployment copies the manifest, CSS and guard; restarts only the Deezer browser
with its existing profile, and refreshes provider guards to load the narrow
close rule. Login data and volume are retained. Existing uncommitted Qobuz
recovery changes are preserved. No GitHub submission is included.

The sequential Deezer → Amazon Music → Deezer round trip completed. A fresh X11
screenshot then showed the normal Home page, no modal overlay, hidden display
slots and the song Pookie playing at 00:28 of a 00:30 preview. This establishes
preview progression and rendered switch-back recovery, not full subscription
playback or physical touchscreen acceptance.

## Ad-layer click guard

`deezer-ad-click-guard.js` is a Deezer-only document-start content script. On 207,
playback ads use `#adContainer` with `iframe[title="Advertisement"]`; the frame
can be cross-origin, so parent event cancellation alone cannot intercept its
clicks. The script marks only those frames inert, preventing pointer/keyboard
interaction while leaving media and frame loading running. Capture listeners
cancel activation events in that verified ad container, including its blank area.
Normal navigation, player controls and login UI outside it remain interactive.
Controls inside the advertising frame also become noninteractive; ad completion
continues to be owned by Deezer. This does not skip or mute the advertisement.

A MutationObserver examines added subtrees and iframe title changes; there is no
interval, layout polling or network probe. Deezer's observed lifecycle removes
the container after advertising. Reuse of an inert ad iframe as non-ad UI has
not been observed or accepted by this implementation. Existing known-child-window
closure remains a fallback; no global window.open override is installed.

`node scripts/deezer-ad-click-guard-fixture.mjs` passed with fully intercepted
local fixtures and real Chromium mouse/touch input: cross-origin ad and blank
area cannot open a popup; dynamic ads are protected; player/login controls work;
removal restores ordinary page interaction; non-Deezer pages are untouched.
The display-ad fixture and kiosk package smoke passed as well.

The 207 manifest/script were updated without restarting/navigating the browser.
CDP installed the same script in the current Deezer document and for subsequent
documents of that existing target; normal future browser launches use the
manifest. Read-only inspection confirmed the hook loaded and the normal Pause
button was outside inert content. No ad frame was present at that inspection,
so physical ad-click prevention remains untested; no field ad click was made.

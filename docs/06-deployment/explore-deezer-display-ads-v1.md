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

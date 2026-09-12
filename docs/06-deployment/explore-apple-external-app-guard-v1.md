# Apple Music external-app and trial-entry guard

On 207, Chrome displayed the operating-system prompt **Open xdg-open?** with
the source `https://music.apple.com`. This is not a page dialog and cannot be
reliably dismissed with CDP. The prompt is prevented at its confirmed Apple
Music page entry points instead.

The Explore extension now applies two document-start rules only to
`https://music.apple.com/*`:

- CSS hides the native **Open in Music** CTA (`native-cta`), the exact
  `data-test="upsell-personal-cta"` free-trial CTA, the personal-upsell
  student-plan link (`data-test="upsell-personal-student"`), and the entire
  bottom `data-test="upsell-banner"` trial banner so no empty promotion strip
  remains after its CTA is hidden.
- A MAIN-world capture listener cancels mouse, touch, keyboard activation and
  programmatic `click()` for those exact elements, including later SPA inserts.

There is no observer, timer, global `window.open` override, protocol handler
policy, or new extension permission. Apple ID login, player controls, search,
ordinary Apple Music links, and every other provider remain outside this guard.
The user-selected policy hides these trial and student-plan entries without
replacement text. The selectors are independent of the displayed Apple Music
language. It does not close general web popups, hide subscriptions elsewhere,
or change playback and account restrictions.

`node scripts/apple-external-app-guard-fixture.mjs` validates manifest scope,
static and dynamic CTA hiding, seven student-plan labels, mouse/touch/keyboard/
programmatic interception, normal Apple controls, and non-Apple isolation.
`node scripts/kiosk-package-smoke.mjs`
checks the deployed extension asset list and document-start registration.

On 207, the pre-deploy screenshot showed **Open xdg-open?** with the exact
`https://music.apple.com` source. The unchecked **Always allow** box was left
unchanged and only **Cancel** was selected. The runtime backup is
`/home/moode/code/tikpal.deploy-backups/20260912-apple-external-app-guard/`.
The manifest, shared `content.js`, and the two Apple assets were atomically
replaced with matching hashes; only the Apple Music profile was restarted.
The other provider-process PID set, login profile, and 32% volume stayed intact.

The first restarted extension service worker reported version `1.1.5` and the
two Apple document-start registrations. A follow-up field inspection identified
the locale-neutral student-plan host as `data-test="upsell-personal-student"`
and the bottom trial action as
`[data-test="upsell-banner"] [data-test="cta-button"]`. Version `1.1.6`
atomically added both rules and reloaded only the Apple Music profile. Version
`1.1.7` hides the whole locale-neutral banner host after field feedback showed
that hiding only its CTA left an empty banner visible.

After the `1.1.7` Apple-only reload, a 207 `/cn/new` field sample contained
the bottom `cwc-upsell-banner[data-test="upsell-banner"]` node, including its
Chinese free-trial copy, but its computed `display` was `none`. Normal music
cards, navigation and the player remained visible. This verifies that an
already-rendered banner leaves no empty promotion strip; no trial, student-plan
or external-app action was activated during the check.

On the final 207 home-page sample, the page guard reported marker `1`; native
CTA containers, the personal free-trial CTA, and the Chinese student-plan link
all had computed `display: none`. Eleven ordinary navigation links remained
visible, and the Home and New-discovery samples showed no system external-app
prompt. The bottom banner was not rendered during this final discovery-page
sample, so the real site could not provide a second live banner measurement;
the browser fixture covers both its static and later dynamic form. No trial,
external-app, student-plan, or login action was activated in the field.

Local type checking, production build, the Apple fixture, and the existing
Deezer guard fixtures passed. `kiosk-package-smoke` still fails on its unrelated
pre-existing assertion that expects `element.muted = false` in `content.js`;
the unchanged audio-gate source contains the behavior instead. This does not
exercise or invalidate the new Apple packaging checks, but it prevents claiming
the aggregate smoke suite passed.

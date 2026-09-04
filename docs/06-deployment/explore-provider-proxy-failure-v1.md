# Explore Provider Proxy Failure v1

## Status

Current reference for the Gentoo kiosk provider pool. It documents the local
Tikpal error surface used when a web provider cannot load, and the distinction
between a bad Proxy path and a provider that is genuinely unavailable.

The change was field-verified on the 207 kiosk on 2026-09-04. The persisted
Proxy setting remained unchanged during that verification; correcting an
unreachable Proxy endpoint is an operator action, not an automatic recovery.

## Scope and provider policy

The resident provider pool has ten providers:

- Proxy-eligible: Suno, Spotify, YouTube Music, Apple Music, TIDAL, Qobuz,
  Deezer, and Amazon Music.
- Direct exceptions: QQ Music and NetEase Cloud Music. Global Proxy On must
  not put either exception through the Proxy.

The current settings file is `.tikpal/web-mode-settings.json`. The Shell reads
`proxyEnabled` and `proxyUrl` through `read_proxy_settings()` for each launch;
the source defaults are only fallbacks. A failed Proxy must not be silently
disabled, substituted, or changed by the Guard/Manager.

## User-visible contract

When Chromium fails to reach a provider, the user sees the local
`/web-mode-error.html` Tikpal surface instead of a Chromium network page. The
page states the provider name, whether Proxy is on, and one friendly next step:
change Proxy in Settings, choose another provider, or try later.

The UI never exposes a raw Chromium `ERR_*`, DNS, CDP, or socket error. The
runtime reduces those details to this stable, internal vocabulary:

| Internal reason | User-facing outcome |
| --- | --- |
| `proxy_unreachable` | Proxy did not connect. |
| `connection_timeout` | Proxy did not connect when Proxy is active; otherwise try again. |
| `site_unreachable`, `load_failed` | Try again. |
| `region_unavailable` | Explain that the current Proxy exit does not support the service. |

An error page is a terminal resident state, not a successful provider page:

- Proxy providers report `check_proxy`.
- Direct providers report `check_setup`.
- A regional block reports `region_unavailable`.
- Revealing an error page makes it physically active without rewriting its
  terminal status to `active` or `ready`.

This lets the Side Panel keep the failure visible while preserving truthful
runtime state. `ready` still requires the normal full provider readiness
checks.

## Font and locale continuity

The friendly page fetches `/api/v1/preferences` with `cache: "no-store"`. It
uses the same `locale` and `fontTheme` values as the application and writes the
font setting to `data-font-theme` on the document root.

Supported themes are `system`, `hardware`, `precision`, `sans`, `serif`, and
`mono`. The page carries the same font stacks used by Tikpal-owned surfaces, so
the error screen remains visually continuous with Settings even though it is a
standalone static page.

This applies to every Provider's local friendly error page and to other
Tikpal-owned surfaces. It intentionally does not restyle a successfully loaded
official provider website: Spotify, Suno, and the other providers keep their
own brand CSS and fonts. Injecting a forced system font into those third-party
pages is outside this contract because it can break provider login, playback,
or a later page update.

## Runtime control path

1. The Provider Guard arms the persistent CDP Manager with the local error-page
   URL and the appropriate terminal status.
2. A document `loadingFailed` event or a `chrome-error://` root navigation is
   normalized to a stable reason.
3. The Manager performs one navigation to the local Tikpal page per document
   generation and publishes `friendlyError` in its session snapshot.
4. The Guard consumes that snapshot and asks the Shell to write only the
   corresponding terminal provider status.
5. The Shell treats the local page as a revealable resident surface, while
   retaining its terminal status. A later real HTTPS provider page clears the
   prior `friendlyError`.

The Manager deliberately accepts its own local friendly page as an attachable
target after a target detach. Without that rule the error page could be visible
while the Manager stayed in discovery and the Guard lost the authoritative
failure state.

For the active QQ Music page only, the Guard may click the visible exact
`开始播放` browser-autoplay acknowledgement. This command is foreground
priority and non-replayable: it bypasses the Manager's background-maintenance
throttle but cannot be transparently repeated. It does not automate login,
membership, payment, authorization, download, or native-client prompts.

## Build and deployment

`public/web-mode-error.html` is copied into `dist/` by `npm run build`. The
running Node web service serves `dist/`, not `public/`; deploying only the
source file does not update a device. For this change, deploy the Manager plus
both copies of the page, preserving owner and mode, then restart only
`tikpal-web-mode-cdp-manager.service` and reload the local error-page target.
No kiosk, API, or Proxy-setting restart is required for the page content.

Before a field update, take a timestamped backup of the deployed Manager and
both error-page paths. Verify the device copies by SHA-256 and verify the page
from the serving endpoint, rather than trusting the source-tree copy:

```sh
npm run build
curl -fsS http://127.0.0.1:4173/web-mode-error.html | grep -q normalizeFontTheme
```

After an error-path deployment, use the Manager target state and an X11 capture
as separate evidence. A DOM/CDP query proves the local page and its computed
`fontFamily`; an X11 capture proves that the visible kiosk surface actually
contains the packaged Tikpal message.

## Verification record: 207, 2026-09-04

The 207 kiosk had Proxy enabled with an unreachable configured endpoint. Suno
opened the friendly local page and remained `check_proxy`; the other seven
Proxy-eligible providers also remained `check_proxy`. QQ Music and NetEase
Cloud Music stayed `ready` and `frozen` under their direct policy.

The rendered X11 surface showed the packaged Tikpal message rather than
Chromium's network error. A document query confirmed `fontTheme="serif"` and
the matching serif font stack after the preferences fetch. This is field proof
of the error presentation only; the Proxy itself remains unresolved until an
operator supplies a reachable endpoint.

## Local regression checks

Run these before delivery:

```sh
npm run build
npm run test:cdp-manager
npm run test:kiosk
node scripts/explore-open-lifecycle-smoke.mjs
git diff --check
```

The CDP Manager smoke covers timeout normalization, one redirect per document,
publication of `friendlyError`, reattachment to a friendly page after a detach,
and clearing the state after a real provider navigation.

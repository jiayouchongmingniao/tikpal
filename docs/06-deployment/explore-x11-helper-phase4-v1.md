# Explore X11 Helper Phase 4 v1

## Status

Phase 4 is **blocked before the Spotify canary**. It has not run a
`YouTube Music -> Spotify` click, the formal 20-round sequence, or changed the
default Helper mode to `auto`.

The block is a real runtime prerequisite, not a missing state marker: the
resident YouTube Music page at `http://127.0.0.1:9235/json` is reachable but
reports `YouTube Music is not available in your area`. The configured proxy is
`http://192.168.10.123:16005`; its egress country is US but it returns the
same page. Direct egress is CN and its request was reset. Therefore the
required YouTube Music runtime/audio start state cannot be accepted for the
canary.

## Strict transaction contract

Formal acceptance modes (`switch-once`, `switch-only`, and `switch-strict`)
now pass `strict_helper_transaction: true` through the trace context, API, and
launcher environment.

On a retryable Helper timeout in this mode, the launcher:

1. safely revokes the completed lease and publishes a fresh Shell generation;
2. returns the first nonzero Helper status; and
3. does not issue a second Helper switch or use a legacy Shell X11 fallback.

The acceptance summary also requires exactly one successful Helper client
attempt, a Helper foreground completion, no Helper retry, no CDP fallback, and
one successful ordered target audio-gate event. These fields are emitted in
`rounds.csv`, `summary.json`, and `report.md`; failure of either gate fails the
strict run. Helper transaction time is also a hard gate: the canary must be
`<250ms`, and the 20-round run must have `median<=30ms`, `p95<100ms`, and
`max<250ms`.

This closes the false-success path observed during the earlier preparation,
where a first `X11_REPLY_TIMEOUT` was followed by a second Helper transaction.
That preparation is not Phase 4 evidence.

## Local verification

Completed on the source tree:

- `bash -n deploy/chromium/tikpal-web-mode.sh deploy/chromium/tikpal-explore-physical-acceptance.sh scripts/tikpal-x11-helper-phase1-smoke.sh`
- `bash deploy/chromium/tikpal-explore-physical-acceptance.sh summary-contract-fixtures` (26 cases)
- `bash deploy/chromium/tikpal-explore-physical-acceptance.sh stamp-fixtures`
- `bash deploy/chromium/tikpal-explore-physical-acceptance.sh exit-contract-fixtures` (13 cases)
- `bash scripts/tikpal-x11-helper-phase1-smoke.sh`, including the strict
  timeout fixture that proves a single Helper switch and a fresh Shell owner
  generation
- `npm run test:kiosk`
- `git diff --check`

## 115 deployment snapshot

On 2026-09-02, the three narrow runtime files were backed up at
`/root/tikpal-phase4-backups/phase4-strict-transaction-20260902-100014` and
atomically replaced with their owner and mode preserved. The subsequent
transaction-metric-only acceptance-script update is backed up at
`/root/tikpal-phase4-backups/phase4-acceptance-metrics-20260902-101011`:

| File | SHA-256 | Owner/mode |
| --- | --- | --- |
| `deploy/chromium/tikpal-explore-physical-acceptance.sh` | `5c6a8863003b297e83221046391a441d87f6b230bbfe19363060c732b2b45357` | `moode:moode 0755` |
| `deploy/chromium/tikpal-web-mode.sh` | `ee3f3f5be37af5e21615f38c27e8871b661aa9406ca9a3dc44a279fee438f6fe` | `moode:moode 0755` |
| `server/index.mjs` | `32b04d4deb02ecf6ea90f1e630dcb9b7e247f3ce8487a877f140b957eed27e78` | `moode:moode 0644` |

Only `tikpal-api.service` was restarted. `tikpal-kiosk.service` and
`tikpal-x11-helper.service` remained active without restart.

The current live baseline is read from `/run/tikpal`, not the stale source-tree
mirror state. At the blocker snapshot it had `activeProvider=youtube_music`,
no opening request, a free lock, exactly one Window Guard, 10 Provider Guards,
10 resident Chromium roots, and socket mode `moode:moode 0600`.

The Helper remains `phase=1` / `mode=switch`, with no lease in flight. Its
existing timeout/reconnect counters are historical evidence from the rejected
preparation; they must be reset to a fresh zero-error baseline before another
formal Phase 4 click.

## Resume gate

Before retrying, provide or restore a verified YouTube Music route/account
that renders a real playable page. Then restart the Helper only to establish a
new zero-error baseline, rerun the complete read-only preflight, and execute
exactly one `YouTube Music -> Spotify` canary. Only a passing canary may enter
the fixed 20-round sequence; `auto` remains prohibited until all 20 rounds
pass.

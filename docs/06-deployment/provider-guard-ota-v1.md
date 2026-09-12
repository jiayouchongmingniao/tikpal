# Provider Guard OTA v1

Provider Guard OTA updates only the browser safety layer: the MV3 extension,
the document-start page Guard, and the QQ confirmation helper. It does not
update the CDP manager, audio handoff, window manager, systemd units, provider
profiles, cookies, login state, volume, or any device-specific service code.

Every Tikpal device uses the same stable channel:

```text
https://updates.tikpal.ai/guard/v1/channels/stable.json
```

The channel does not include a device ID, address, model, portable API key, or
Cloudflare credential. 207 is only the first field-validation device.

## Device contract

The ordinary Tikpal deployment installs the updater, its systemd service and
timer, a local `.tikpal/guard-ota` state directory, and the app-bundled Guard as
the safe initial version. The timer starts seven minutes after boot, then checks
every hour with up to ten minutes of random delay.

Checks only download and verify a candidate. They never restart Explore, pause
music, clear profiles, or change the selected provider. When Explore is fully
closed, the local API starts an activation-only runner. It retakes the existing
Explore lock, checks that no open, switch, or close request is active, then
atomically switches the `current` release link.

The next provider launch must expose the document-start extension version marker.
A missing marker rolls back that one Guard release and retries once. Provider
HTTP failures, expiring media URLs, geo restrictions, subscription limits,
login errors, and audio failures do not trigger a Guard rollback.

The device retains its two verified Guard versions:

```text
.tikpal/guard-ota/
  current -> releases/1.2.3
  previous -> releases/1.2.2
  releases/
  staging/
  state.json
```

`state.json` contains versions, times, stage names, and short non-sensitive
error codes. It never contains a Cloudflare token, signing key, URL query
credential, provider cookie, or portable remote key.

## One-time setup for each deployed device

Create an Ed25519 release key outside the repository. Keep the private key only
in GitHub Actions; copy only the public key to deployed devices.

```bash
openssl genpkey -algorithm ED25519 -out tikpal-guard-ota-private.pem
openssl pkey -in tikpal-guard-ota-private.pem -pubout -out tikpal-guard-ota-public.pem
```

During normal application deployment, install the public key and enable the
channel in the device's `.env.kiosk`:

```bash
install -d -m 0700 /home/moode/code/tikpal/.tikpal
install -m 0644 tikpal-guard-ota-public.pem /home/moode/code/tikpal/.tikpal/guard-ota-public-key.pem
```

```ini
TIKPAL_GUARD_OTA_ENABLED=1
TIKPAL_GUARD_OTA_CHANNEL=stable
TIKPAL_GUARD_OTA_CHANNEL_URL=https://updates.tikpal.ai/guard/v1/channels/stable.json
TIKPAL_GUARD_OTA_ROOT=/home/moode/code/tikpal/.tikpal/guard-ota
TIKPAL_GUARD_OTA_PUBLIC_KEY_PATH=/home/moode/code/tikpal/.tikpal/guard-ota-public-key.pem
TIKPAL_GUARD_OTA_MAX_ARCHIVE_BYTES=16777216
```

The normal systemd installer creates the bootstrap release and enables the
timer. No special 207 branch, IP, model, or device-key setting is involved.
OTA stays disabled by default until its public key is installed, so a device
never trusts an unsigned public endpoint accidentally.

## R2 and DNS

Create the public R2 bucket `tikpal-guard-releases` in the Cloudflare account
that manages `tikpal.ai`. In R2 bucket settings, connect the custom domain
`updates.tikpal.ai` and allow public access on that custom domain. Do not use the
`r2.dev` development URL in production. The authoritative setup is Cloudflare's
[public bucket documentation](https://developers.cloudflare.com/r2/buckets/public-buckets/).

No Worker is used. Devices make ordinary HTTPS `GET` requests to the custom
domain and verify every downloaded byte with their Ed25519 public key. Configure
the GitHub token with only R2 object permissions for this bucket; it needs no
Worker, DNS, Account-administration, or device-management permission.

Add these GitHub repository secrets:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Account containing `tikpal-guard-releases` |
| `CLOUDFLARE_R2_GUARD_RELEASES_TOKEN` | Least-privilege R2 object-write token for this bucket |
| `TIKPAL_GUARD_OTA_ED25519_PRIVATE_KEY` | PEM private key used only to sign releases |

`TIKPAL_PORTABLE_API_KEY` remains separate. It authorizes the current local
portable remote API; it is neither an OTA credential nor a future App
credential. A native remote App needs pairing and revocable tokens.

## Publish a stable Guard

1. Change the MV3 extension version and matching Guard files in one commit.
2. Run `npm run test:ota:guard`, `npm run test:kiosk`, `npm run typecheck`, and
   `npm run build`.
3. Create and push an immutable tag such as `guard-v1.2.3`.
4. `.github/workflows/publish-guard-ota.yml` verifies the tag against the MV3
   version and fixed extension-key fingerprint. It builds the archive, hashes
   every allowed file, signs `release.json` and the stable pointer, uploads the
   immutable release first, then publishes `stable.json` and its signature.

Testing uses a distinct channel name and URL on test devices, for example
`TIKPAL_GUARD_OTA_CHANNEL=test` with
`https://updates.tikpal.ai/guard/v1/channels/test.json`. Build that pointer with
`node scripts/build-guard-ota-release.mjs ... --channel test`. The test channel
uses the same public key and release validation, but it cannot change devices
that remain on `stable`.

The signed release manifest has schema, version, minimum updater version,
archive byte count and SHA-256, every allowed file path/hash/size, MV3 version,
and the SHA-256 fingerprint of the Chromium extension key. Devices reject unsafe
paths, symlinks, unexpected archive entries, unsafe origins, wrong signatures,
incompatible updater versions, oversized archives, changed extension identities,
downgrades, and hash mismatches.

Only this content can appear in a Guard archive:

```text
web-mode-extension/**
tikpal-web-mode-guard.mjs
tikpal-web-mode-qq-confirm.mjs
```

The extension identity is pinned in
`deploy/chromium/guard-ota-extension-key.sha256`. A key change is an explicit
base-application bootstrap migration, never an OTA release.

## Local status and recovery

Device Settings displays installed and candidate versions, check state, and a
local **Provider Guard updates** button in English, Chinese, German, Italian,
Korean, Japanese, and Spanish. **Explore self-check & repair** is in the same
Device section. These maintenance actions are intentionally absent from the
portable controller. The kiosk UI uses:

```text
GET  /api/v1/system/guard-ota
POST /api/v1/system/guard-ota/actions
{ "type": "check" }
```

This endpoint returns no release URL, signing material, or device credential. It
is not a remote-App contract. A paired, revocable authorization layer is needed
before any future app reads it or requests a check.

Useful local commands, run as the service user:

```bash
./deploy/chromium/tikpal-guard-ota.mjs status
./deploy/chromium/tikpal-guard-ota.mjs check
./deploy/chromium/tikpal-guard-ota.mjs rollback manual_recovery
systemctl status tikpal-guard-ota.timer
```

`rollback` swaps only the two local verified Guard directories and retains all
provider profiles. If there is no previous release, restore the base Guard with
the normal Tikpal deployment, then investigate the release manifest and logs.

## Acceptance boundary

The automated fixture verifies signing, hashes, downgrade rejection, staging,
atomic activation state, one-version rollback, tamper rejection, and profile
retention. It does not prove physical touchscreen behavior, provider playback,
or actual R2/DNS configuration. First acceptance needs 207 and another normally
deployed device to independently stage an update, activate only after Explore
closes, confirm the next provider marker, and retain their existing login and
volume state.

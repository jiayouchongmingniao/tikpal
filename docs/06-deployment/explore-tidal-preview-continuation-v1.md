# TIDAL preview continuation decision

TIDAL can leave its player labelled **Pause** after a 30-second preview has
ended, although the media element is ended and there is no audio output. On 207,
the visible native Next control moved the player to a different track and a new
30-second preview started.

An automatic TIDAL Next rule was evaluated, then withdrawn. Its proposed
behavior would have created a repeatable UI-click cadence after every preview
end. During the same validation window, TIDAL served a
`geo.captcha-delivery.com` verification iframe after a rapid reload, prewarm,
and reopen sequence. That does not prove a single cause—the automatic Next rule
had not run on the CAPTCHA page—but it establishes that further automated page
actions would be inappropriate for this provider.

## Production policy

- TIDAL has no automatic Next, Play, reload, login, trial, or offer clicks.
- At a natural preview end, the user may use TIDAL's visible native Next
  control. The existing TIDAL layout and exact offer-dismiss rules remain
  separate from playback automation.
- Provider reloads are not used as a playback-recovery tactic. A normal
  Explore open is the only supported navigation path, and it must not be
  repeated while the provider is showing a verification page.
- No CAPTCHA, login, subscription, or trial control is automated or bypassed.

## 207 quarantine record (2026-09-12)

TIDAL was closed through the normal Explore close API to stop further page
requests. The TIDAL-specific auto-Next script was removed, and the extension
manifest was atomically restored to version `1.1.7`. The former `1.1.8`
manifest and script were retained under
`/home/moode/code/tikpal.deploy-backups/20260912-161500-tidal-preview-quarantine`.
TIDAL was not reopened, and no profile, login state, volume setting, CAPTCHA,
or offer was touched.

If continuous TIDAL playback is needed later, it requires a provider-supported
queue or playback contract that does not synthesize repeated webpage controls.
Any future experiment must be isolated from the 207 profile and must use a
human-paced, provider-approved flow before it is considered for deployment.

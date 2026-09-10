# Explore 207 update — 2026-09-11

This submission includes all pending Explore changes on branch `207`, following
the user's request to publish the complete worktree to GitHub. Earlier notes
that excluded a GitHub submission describe the scope at that earlier stage.

## Included changes

- Collapsible Side Panel: session-checked API and native window layout handling,
  bounded rollback, a 56px collapsed rail, seven-language labels and regression
  fixtures. The final visual refinement moves Collapse into the header, removes
  the 64px gutter and uses lightweight 48x88px Expand / 48x48px Exit targets.
- Deezer: narrowly intercept the observed advertising container and its iframe;
  close verified advertising child destinations through the existing CDP
  manager. Ordinary player/account navigation remains outside those rules.
- TIDAL: static, domain-scoped CSS lets the home feed, album and Mix modules fill
  the available width after panel resizing. Existing padding, cover sizes and
  navigation/player layout are preserved. Unmatched routes retain site styles.
- Packaging checks and browser, API, X11 and CDP fixtures for the above changes.

## Verification and limits

The preceding implementation passed `npm run build` (including TypeScript) and
`npm run test:explore-panel`, including all seven UI languages. The production
build retains the existing large-chunk warning. Before this submission, the
Deezer display/click-guard, provider-child-window unit/browser and TIDAL layout
fixtures were rerun successfully. Browser advertising tests use intercepted
fixtures and do not open real advertising destinations.
`npm run test:kiosk`, `npm run test:cdp-manager` and `git diff --check` also
passed before submission.

207 frontend hashes matched the local production output. Only the Side Panel
was refreshed for the visual rollout. Native pointer operations and screenshots
confirmed expansion, header collapse and bottom Exit back to ambient. No music
or ad controls were clicked, and login profiles and volume were not reset.
Physical touchscreen feel, audio continuity and broad all-provider acceptance
are not established by these checks. The reported intermittent Deezer playback
failure has not been reproduced or claimed fixed by this submission.

Detailed behavior and deployment history are in
`explore-panel-collapse-v1.md`, `explore-deezer-display-ads-v1.md` and
`explore-provider-child-windows-v1.md` in this directory.

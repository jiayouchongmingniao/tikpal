(() => {
  if (!/(^|\.)deezer\.com$/.test(location.hostname) || window.__tikpalDeezerPreviewRecovery) return;
  const failures = new Map();
  const unsupported = new Set();
  let timer, pending, skips = [], revision = 0, watchUntil = 0, active = false;
  const pathOf = value => { try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'cdnt-preview.dzcdn.net' && /^\/api\/1\/.*\.mp3$/.test(u.pathname) ? u.pathname : ''; } catch { return ''; } };
  const foreground = () => document.visibilityState === 'visible' && window.__tikpalProviderAudioGate?.status().active;
  const cancel = () => { clearTimeout(timer); timer = undefined; pending = undefined; watchUntil = 0; failures.clear(); unsupported.clear(); revision++; };
  // Any deliberate interaction cancels pending recovery, including Pause and
  // manual track selection. Never compete with the user's next action.
  for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, e => { if (e.isTrusted) cancel(); }, true);
  const schedule = () => { if (!timer && (failures.size || watchUntil > Date.now()) && foreground()) timer = setTimeout(check, 1000); };
  const errorCloseButton = () => {
    const matches = [...document.querySelectorAll('[role="dialog"]')].filter(dialog =>
      dialog.getClientRects().length && dialog.innerText.replace(/\s+/g, ' ').trim()
        === 'Error An error occurred, please try again later OK');
    if (matches.length !== 1) return null;
    const buttons = [...matches[0].querySelectorAll('button')].filter(button =>
      button.getClientRects().length && !button.disabled && button.innerText.trim() === 'OK');
    return buttons.length === 1 ? buttons[0] : null;
  };
  function check() {
    timer = undefined;
    if (!foreground()) { pending = undefined; revision++; return; }
    const now = Date.now();
    for (const [path, until] of failures) if (until < now) { failures.delete(path); unsupported.delete(path); }
    const player = window.dzPlayer;
    const song = player?.getCurrentSong?.();
    const previews = (song?.MEDIA || []).filter(m => m.TYPE === 'preview').map(m => pathOf(m.HREF)).filter(Boolean);
    const path = previews.find(p => failures.has(p));
    const playing = player?.playing === true && !player.paused && !player.loading && !player.audioAds;
    const gate = window.__tikpalProviderAudioGate.status();
    if (!path || !playing) {
      pending = undefined;
      // After an ended preview or foreground return, Deezer can show playing
      // while the next loaded preview never receives play(). Resume once via
      // its normal control, only while the site still expresses play intent.
      if (!path && playing && previews.length && watchUntil > now && gate.playingCount === 0 && player.position === 0) {
        watchUntil = 0;
        try { Promise.resolve(player.control?.play?.()).catch(() => {}); } catch {}
      }
      schedule(); return;
    }
    if (unsupported.has(path)) {
      skips = skips.filter(t => now - t < 120000);
      // Leave the site's error visible when the recovery budget is exhausted.
      if (skips.length >= 3) { cancel(); console.warn('[tikpal-deezer-preview] recovery stopped after repeated unavailable tracks'); return; }
      if (!pending || pending.path !== path || pending.id !== String(song.SNG_ID)) {
        const close = errorCloseButton();
        if (!close) { schedule(); return; }
        close.click();
      }
    }
    if (pending?.path === path && pending.id === String(song.SNG_ID)
        && gate.playingCount > 0 && player.position > pending.position + 0.05) {
      failures.delete(path); unsupported.delete(path); pending = undefined; schedule(); return;
    }
    const id = String(song.SNG_ID);
    if (!pending || pending.id !== id || pending.path !== path) {
      if (typeof player.control?.play !== 'function') { failures.delete(path); return; }
      pending = { id, path, since: now, position: Number(player.position) || 0 };
      const currentRevision = revision;
      // Use the site's own license-checked playback flow; never change tokens,
      // subscription rules, preview duration or the requested media URL.
      try { Promise.resolve(player.control.play()).catch(() => {}).finally(() => {
        if (currentRevision === revision) schedule();
      }); } catch {}
      schedule();
      return;
    }
    if (now - pending.since < 2500) { schedule(); return; }
    if (unsupported.has(path)) errorCloseButton()?.click();
    failures.delete(path);
    unsupported.delete(path);
    pending = undefined;
    skips = skips.filter(t => now - t < 120000);
    if (skips.length >= 3 || typeof player.control?.nextSong !== 'function') {
      cancel();
      console.warn('[tikpal-deezer-preview] recovery stopped after repeated unavailable tracks');
      return;
    }
    skips.push(now);
    try { Promise.resolve(player.control.nextSong()).catch(() => {}); } catch {}
    console.info('[tikpal-deezer-preview] skipped unavailable preview');
    schedule();
  }
  window.__tikpalDeezerPreviewRecovery = {
    rejected(value) {
      const path = pathOf(value);
      if (!path || !foreground() || failures.size >= 32) return;
      // Preloaded previews may fail before they become the current song. Keep
      // a bounded, event-triggered watch; only small player fields are read.
      failures.set(path, Date.now() + 300000);
      schedule();
    },
    mediaError(element) {
      const code = element?.error?.code;
      if (![2, 4].includes(code) || !foreground()) return;
      const path = pathOf(element.currentSrc || element.src);
      const song = window.dzPlayer?.getCurrentSong?.();
      if (!path || !(song?.MEDIA || []).some(m => m.TYPE === 'preview' && pathOf(m.HREF) === path)) return;
      if (code === 4) {
        // The site may insert its dialog after the media error event. Wait
        // briefly for that exact confirmation; unsupported media alone is
        // insufficient to authorize closing a dialog or skipping a track.
        if (failures.size >= 32) return;
        unsupported.add(path);
        failures.set(path, Date.now() + 15000);
        schedule();
      } else this.rejected(element.currentSrc || element.src);
    },
    afterEnded() { if (foreground()) { watchUntil = Date.now() + 15000; schedule(); } },
    setActive(nextActive) {
      if (nextActive) { if (!active) watchUntil = Date.now() + 15000; schedule(); }
      else { clearTimeout(timer); timer = undefined; pending = undefined; watchUntil = 0; revision++; }
      active = nextActive;
    }
  };
})();

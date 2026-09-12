(() => {
  if (!/(^|\.)deezer\.com$/.test(location.hostname) || window.__tikpalDeezerPreviewRecovery) return;
  const reloadKey = '__tikpalDeezerPreviewReload';
  let resume;
  try {
    const saved = JSON.parse(sessionStorage.getItem(reloadKey) || 'null');
    if (saved?.resume && saved.at <= Date.now() && Date.now() - saved.at < 30000) resume = saved;
  } catch {}
  const expiryOf = value => {
    try {
      if (!pathOf(value)) return 0;
      const match = (new URL(value).searchParams.get('hdnea') || '').match(/(?:^|~)exp=(\d+)(?:~|$)/);
      return match ? Number(match[1]) * 1000 : 0;
    } catch { return 0; }
  };
  const clearResume = () => {
    resume = undefined;
    try {
      const saved = JSON.parse(sessionStorage.getItem(reloadKey) || 'null');
      if (saved) sessionStorage.setItem(reloadKey, JSON.stringify({ at: saved.at }));
    } catch {}
  };
  const failures = new Map();
  const unsupported = new Set();
  let timer, pending, skips = [], revision = 0, watchUntil = 0, active = false;
  const pathOf = value => { try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'cdnt-preview.dzcdn.net' && /^\/api\/1\/.*\.mp3$/.test(u.pathname) ? u.pathname : ''; } catch { return ''; } };
  const foreground = () => document.visibilityState === 'visible' && window.__tikpalProviderAudioGate?.status().active;
  let observedStartKey, playbackRoot, playbackObserver;
  const startKey = () => String(window.dzPlayer?.getCurrentSong?.()?.SNG_ID || '');
  const cancel = () => { observedStartKey = startKey(); clearResume(); clearTimeout(timer); timer = undefined; pending = undefined; watchUntil = 0; failures.clear(); unsupported.clear(); revision++; };
  // The site's audio-break bootstrap can leave a source-less jingle playing
  // and disable Play indefinitely. This is not a rejected music preview.
  // Offer a user-controlled reload; never synthesize ad completion or auto-skip.
  let startupTimer, startupNotice, startupObserver;
  const clearStartup = () => {
    clearTimeout(startupTimer); startupTimer = undefined;
    startupObserver?.disconnect(); startupObserver = undefined;
    startupNotice?.remove(); startupNotice = undefined;
  };
  const startupBlocked = element => {
    const player = window.dzPlayer;
    return foreground() && element?.isConnected && element.matches?.('audio[data-testid="jinglePlayer"]')
      && !element.paused && !element.ended && !element.error && element.readyState === 0
      && element.networkState === 0 && !element.currentSrc && !element.getAttribute('src')
      && !element.querySelector('source[src]') && player?.getPlayerType?.() === 'triton_ads'
      && player.playing === false && player.paused === false && player.loading === false;
  };
  const armStartup = element => {
    if (startupTimer || startupNotice || !foreground()
        || !element?.matches?.('audio[data-testid="jinglePlayer"]')) return;
    startupTimer = setTimeout(() => {
      startupTimer = undefined;
      if (!startupBlocked(element)) return;
      const language = (document.documentElement.lang || 'en').split('-')[0];
      const messages = {
        en: ['Deezer is taking longer to start. Reload and try again, or choose another service in Explore.', 'Reload Deezer'],
        zh: ['Deezer 启动播放等待过久。可重新加载后再试，或在 Explore 中切换其他音乐服务。', '重新加载 Deezer'],
        de: ['Deezer braucht länger zum Starten. Neu laden oder in Explore einen anderen Dienst wählen.', 'Deezer neu laden'],
        fr: ['Deezer met du temps à démarrer. Rechargez ou choisissez un autre service dans Explore.', 'Recharger Deezer'],
        ko: ['Deezer 재생 시작이 지연되고 있습니다. 다시 로드하거나 Explore에서 다른 서비스를 선택하세요.', 'Deezer 다시 로드'],
        ja: ['Deezer の再生開始に時間がかかっています。再読み込みするか、Explore で別のサービスを選んでください。', 'Deezer を再読み込み'],
        es: ['Deezer tarda en iniciar. Recarga o elige otro servicio en Explore.', 'Recargar Deezer']
      };
      const [message, action] = messages[language] || messages.en;
      const notice = document.createElement('div');
      notice.id = 'tikpal-deezer-startup-notice';
      notice.setAttribute('role', 'status');
      notice.style.cssText = 'position:fixed;z-index:2147483646;left:16px;right:16px;bottom:100px;display:flex;align-items:center;gap:16px;padding:16px;background:#202024;color:#fff;border:1px solid #888;border-radius:12px;font:16px/1.5 sans-serif;box-shadow:0 4px 20px #0008;';
      const text = document.createElement('span');
      text.textContent = message; text.style.flex = '1';
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = action;
      button.style.cssText = 'min-height:48px;padding:8px 16px;flex-shrink:0;background:#fff;color:#111;border:1px solid #fff;border-radius:8px;font:inherit;cursor:pointer;';
      button.addEventListener('click', () => {
        if (!startupBlocked(element)) { clearStartup(); return; }
        button.disabled = true;
        clearStartup(); cancel();
        console.info('[tikpal-deezer-preview] user reloaded stalled startup');
        location.reload();
      });
      notice.append(text, button); document.body.append(notice); startupNotice = notice;
      startupObserver = new MutationObserver(() => { if (!startupBlocked(element)) clearStartup(); });
      startupObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
      console.warn('[tikpal-deezer-preview] startup stalled; reload available');
    }, 20000);
  };
  document.addEventListener('play', event => armStartup(event.target), true);
  for (const type of ['playing', 'ended', 'error', 'pause']) document.addEventListener(type, event => {
    if (event.target?.matches?.('audio[data-testid="jinglePlayer"]')) clearStartup();
  }, true);
  // Any deliberate interaction cancels pending recovery, including Pause and
  // manual track selection. Never compete with the user's next action.
  for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, e => { if (e.isTrusted && !startupNotice?.contains(e.target)) cancel(); }, true);
  const schedule = () => { if (!timer && (resume || failures.size || watchUntil > Date.now()) && foreground()) timer = setTimeout(check, 1000); };
  const observePlayback = () => {
    const root = document.querySelector?.('#page_player');
    if (!root || playbackRoot === root) return;
    playbackObserver?.disconnect(); playbackRoot = root;
    const inspect = () => {
      const player = window.dzPlayer;
      const button = root.querySelector('[data-testid="play_button_play"]');
      const key = startKey();
      if (!foreground() || !key || key === observedStartKey || !button?.getClientRects().length
          || button.disabled || player?.playing !== true || player.paused || player.loading
          || player.audioAds || player.position !== 0
          || window.__tikpalProviderAudioGate.status().playingCount !== 0) return;
      observedStartKey = key;
      watchUntil = Date.now() + 15000;
      schedule();
    };
    // Deezer can replace/reset media during a track transition without ended.
    // Watch only the mini-player's control changes, never the page or progress text.
    playbackObserver = new MutationObserver(inspect);
    playbackObserver.observe(root, {childList:true,subtree:true,attributes:true,attributeFilter:['data-testid','disabled','href']});
    inspect();
  };
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
    if (resume) {
      watchUntil = 0;
      const context = player?.getContext?.();
      const sameContext = context && String(context.ID) === resume.contextId && context.TYPE === resume.contextType;
      const tracks = sameContext ? player.getTrackList?.() || [] : [];
      const index = tracks.findIndex(track => String(track.SNG_ID) === resume.id);
      const current = tracks[index]?.MEDIA?.find(m => m.TYPE === 'preview');
      if (now - resume.at >= 30000 || (context?.ID && !sameContext)) clearResume();
      else if (index >= 0 && expiryOf(current?.HREF) > now
          && !player.loading && !player.audioAds && typeof player.playTrackAtIndex === 'function') {
        clearResume();
        // Reload can select the first track. Restore only the original song in
        // the same context, through the site's license/ad-checked start path.
        try { Promise.resolve(player.playTrackAtIndex(index)).catch(() => {}); } catch {}
      }
      schedule(); return;
    }
    const failedPreview = (song?.MEDIA || []).find(m => m.TYPE === 'preview' && pathOf(m.HREF) === path);
    if (path && playing && expiryOf(failedPreview?.HREF) > 0 && expiryOf(failedPreview.HREF) <= now) {
      // An expired signed URL cannot be repaired by retrying or skipping cached
      // tracks. Refresh via the site, with a budget that survives navigation.
      const close = errorCloseButton();
      if (unsupported.has(path) && !close) { schedule(); return; }
      try {
        const saved = JSON.parse(sessionStorage.getItem(reloadKey) || 'null');
        if (saved && now - saved.at < 120000) { cancel(); return; }
        const context = player.getContext?.();
        if (!context?.ID || !context.TYPE || typeof player.getTrackList !== 'function') { cancel(); return; }
        sessionStorage.setItem(reloadKey, JSON.stringify({ at: now, id: String(song.SNG_ID), contextId: String(context.ID), contextType: context.TYPE, resume: true }));
      } catch { cancel(); return; }
      clearTimeout(timer); timer = undefined; pending = undefined; failures.clear(); unsupported.clear(); watchUntil = 0;
      close?.click();
      console.info('[tikpal-deezer-preview] refreshing expired preview URLs');
      location.reload();
      return;
    }
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
    setActive(nextActive, { initializing = false } = {}) {
      if (nextActive) { observePlayback(); if (!active) { watchUntil = Date.now() + 15000; armStartup(document.querySelector?.('audio[data-testid="jinglePlayer"]')); } schedule(); }
      else { playbackObserver?.disconnect(); playbackObserver = undefined; playbackRoot = undefined; clearStartup(); if (!initializing) clearResume(); clearTimeout(timer); timer = undefined; pending = undefined; watchUntil = 0; revision++; }
      active = nextActive;
    }
  };
})();

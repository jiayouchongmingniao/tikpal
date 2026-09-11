(() => {
  if (window.__tikpalProviderAudioGate?.version >= 3) return;

  const state = {
    active: false,
    media: new WeakMap(),
    playedMedia: new Set(),
    observedMedia: new WeakSet(),
    howlerSounds: [],
    audioContexts: new Set(),
    suspendedContexts: new Set()
  };
  const mediaElements = () => Array.from(new Set([
    ...document.querySelectorAll("audio,video"), ...state.playedMedia
  ]));
  // Provider gain is unity; the Tikpal output mixer owns listening volume.
  const unifyMediaVolume = (element) => {
    if (element.volume !== 1) element.volume = 1;
  };
  const rememberPlayingMedia = (element) => {
    const previous = state.media.get(element) || { wasPlaying: false };
    previous.wasPlaying = true;
    state.media.set(element, previous);
  };
  const nativeAudioContext = window.AudioContext || window.webkitAudioContext;

  if (nativeAudioContext && !window.__tikpalNativeAudioContext) {
    window.__tikpalNativeAudioContext = nativeAudioContext;
    const PatchedAudioContext = function (...args) {
      const context = new nativeAudioContext(...args);
      state.audioContexts.add(context);
      if (!state.active && context?.state === "running") {
        state.suspendedContexts.add(context);
        context.suspend?.().catch?.(() => {});
      }
      return context;
    };
    PatchedAudioContext.prototype = nativeAudioContext.prototype;
    Object.setPrototypeOf(PatchedAudioContext, nativeAudioContext);
    window.AudioContext = PatchedAudioContext;
    if (window.webkitAudioContext) window.webkitAudioContext = PatchedAudioContext;
  }

  // Qobuz can leave a detached audio request loading indefinitely at 0 seconds.
  // One timer per loading element; no polling or page/network probes.
  const qobuzRecovery = window.location?.hostname === "play.qobuz.com";
  const recoveryTimers = new Map();
  const retriedSources = new Set();
  const cancelRecovery = (element) => {
    clearTimeout(recoveryTimers.get(element));
    recoveryTimers.delete(element);
  };
  const armRecovery = (element) => {
    if (!qobuzRecovery || recoveryTimers.has(element)) return;
    const source = element.currentSrc || element.src;
    if (!source?.startsWith("https://") || retriedSources.has(source) || !state.active || element.paused
      || element.ended || element.error || element.currentTime !== 0
      || element.readyState !== 0 || element.buffered.length) return;
    recoveryTimers.set(element, setTimeout(() => {
      recoveryTimers.delete(element);
      if (!state.active || document.visibilityState !== "visible" || element.paused
        || element.ended || element.error || element.currentTime !== 0
        || element.readyState !== 0 || element.networkState !== 2
        || element.buffered.length || (element.currentSrc || element.src) !== source
        || retriedSources.has(source)) return;
      retriedSources.add(source);
      element.load();
      element.play().catch(() => {});
    }, 15000));
  };

  const nativeMediaPlay = window.HTMLMediaElement?.prototype?.play;
  if (typeof nativeMediaPlay === "function" && !window.__tikpalProviderAudioGatePlayPatched) {
    window.__tikpalProviderAudioGatePlayPatched = true;
    window.HTMLMediaElement.prototype.play = function (...args) {
      state.playedMedia.add(this);
      if (!state.observedMedia.has(this)) {
        state.observedMedia.add(this);
        this.addEventListener("volumechange", () => {
          if (state.active) unifyMediaVolume(this);
        });
        this.addEventListener("ended", () => {
          state.playedMedia.delete(this);
          window.__tikpalDeezerPreviewRecovery?.afterEnded();
        });
        this.addEventListener("error", () => window.__tikpalDeezerPreviewRecovery?.mediaError(this));
        if (qobuzRecovery) {
          for (const event of ["pause", "ended", "playing", "canplay", "error", "emptied"]) {
            this.addEventListener(event, () => cancelRecovery(this));
          }
          for (const event of ["waiting", "stalled", "loadstart"]) {
            this.addEventListener(event, () => armRecovery(this));
          }
        }
      }
      if (state.active) unifyMediaVolume(this);
      if (!state.active) {
        rememberPlayingMedia(this);
        this.muted = true;
      }
      const result = nativeMediaPlay.apply(this, args);
      armRecovery(this);
      if (!state.active) {
        Promise.resolve(result).then(() => {
          if (!state.active) {
            try { this.pause(); } catch {}
          }
        }).catch(() => {});
      }
      return result;
    };
  }

  const setMediaActive = (active) => {
    for (const element of mediaElements()) {
      if (!(element instanceof HTMLMediaElement)) continue;
      const previous = state.media.get(element) || { wasPlaying: false };
      if (!active) {
        previous.wasPlaying = previous.wasPlaying || (!element.paused && !element.ended);
        state.media.set(element, previous);
        element.muted = true;
        try { element.pause(); } catch {}
      } else {
        element.muted = false;
        unifyMediaVolume(element);
        if (previous.wasPlaying && element.error) window.__tikpalDeezerPreviewRecovery?.mediaError(element);
        if (previous.wasPlaying && element.paused && !element.ended) {
          element.play().catch(() => {});
        }
        state.media.set(element, { wasPlaying: false });
      }
    }
  };

  const setHowlerActive = (active) => {
    const howler = window.Howler;
    const howls = Array.isArray(howler?._howls) ? howler._howls : [];
    if (!howler || !howls.length) return;
    if (!active) {
      for (const howl of howls) {
        const sounds = Array.isArray(howl?._sounds) ? howl._sounds : [];
        for (const sound of sounds) {
          if (sound?._paused || sound?._id === undefined) continue;
          if (!state.howlerSounds.some(([knownHowl, knownId]) => knownHowl === howl && knownId === sound._id)) {
            state.howlerSounds.push([howl, sound._id]);
          }
        }
      }
      try { howler.mute(true); } catch {}
      for (const [howl, id] of state.howlerSounds) {
        try { howl.pause(id); } catch {}
      }
    } else {
      try {
        if (howler.volume?.() !== 1) howler.volume?.(1);
        howler.mute(false);
        for (const howl of howls) {
          if (howl.volume?.() !== 1) howl.volume?.(1);
          for (const sound of howl._sounds || []) {
            if (sound._volume !== 1) howl.volume?.(1, sound._id);
          }
        }
      } catch {}
      for (const [howl, id] of state.howlerSounds.splice(0)) {
        try { howl.play(id); } catch {}
      }
    }
  };

  const setAudioContextsActive = (active) => {
    const contexts = Array.from(state.audioContexts);
    if (!active) {
      for (const context of contexts) {
        if (context?.state === "running") {
          state.suspendedContexts.add(context);
          context.suspend?.().catch?.(() => {});
        }
      }
    } else {
      for (const context of contexts) {
        if (context?.state === "suspended") context.resume?.().catch?.(() => {});
      }
      state.suspendedContexts.clear();
    }
  };

  const status = () => ({
    volumePolicy: "system",
    active: state.active,
    mediaCount: mediaElements().length,
    playingCount: mediaElements().filter((element) => !element.paused && !element.ended && !element.error).length,
    contextCount: state.audioContexts.size,
    contextStates: Array.from(state.audioContexts).map((context) => context?.state || "unknown")
  });

  const setActive = (active) => {
    const nextActive = active === true;
    try {
      window.postMessage({ type: "tikpal-provider-audio-muted", muted: !nextActive }, window.location.origin);
    } catch {}
    state.active = nextActive;
    window.__tikpalDeezerPreviewRecovery?.setActive(nextActive);
    if (!nextActive) for (const element of recoveryTimers.keys()) cancelRecovery(element);
    setMediaActive(nextActive);
    setHowlerActive(nextActive);
    setAudioContextsActive(nextActive);
    return status();
  };

  document.addEventListener("play", (event) => {
    const element = event.target;
    if (!(element instanceof HTMLMediaElement)) return;
    if (state.active) {
      unifyMediaVolume(element);
      return;
    }
    rememberPlayingMedia(element);
    element.muted = true;
    setTimeout(() => {
      if (!state.active) {
        try { element.pause(); } catch {}
      }
    }, 0);
  }, true);

  document.addEventListener("volumechange", (event) => {
    if (state.active && event.target instanceof HTMLMediaElement) {
      unifyMediaVolume(event.target);
    }
  }, true);

  window.__tikpalProviderAudioGate = { version: 3, setActive, status };
  setActive(false);
})();

(() => {
  if (window.__tikpalProviderAudioGate?.version >= 3) return;

  const state = {
    active: false,
    media: new WeakMap(),
    howlerSounds: [],
    audioContexts: new Set(),
    suspendedContexts: new Set()
  };
  const mediaElements = () => Array.from(document.querySelectorAll("audio,video"));
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

  const nativeMediaPlay = window.HTMLMediaElement?.prototype?.play;
  if (typeof nativeMediaPlay === "function" && !window.__tikpalProviderAudioGatePlayPatched) {
    window.__tikpalProviderAudioGatePlayPatched = true;
    window.HTMLMediaElement.prototype.play = function (...args) {
      if (!state.active) {
        rememberPlayingMedia(this);
        this.muted = true;
      }
      const result = nativeMediaPlay.apply(this, args);
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
        if (previous.wasPlaying && element.paused && !element.ended) {
          element.play().catch(() => {});
        }
        state.media.set(element, { ...previous, wasPlaying: false });
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
      try { howler.mute(false); } catch {}
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
    active: state.active,
    mediaCount: mediaElements().length,
    playingCount: mediaElements().filter((element) => !element.paused && !element.ended).length,
    contextCount: state.audioContexts.size,
    contextStates: Array.from(state.audioContexts).map((context) => context?.state || "unknown")
  });

  const setActive = (active) => {
    const nextActive = active === true;
    try {
      window.postMessage({ type: "tikpal-provider-audio-muted", muted: !nextActive }, window.location.origin);
    } catch {}
    state.active = nextActive;
    setMediaActive(nextActive);
    setHowlerActive(nextActive);
    setAudioContextsActive(nextActive);
    return status();
  };

  document.addEventListener("play", (event) => {
    if (state.active) return;
    const element = event.target;
    if (!(element instanceof HTMLMediaElement)) return;
    rememberPlayingMedia(element);
    element.muted = true;
    setTimeout(() => {
      if (!state.active) {
        try { element.pause(); } catch {}
      }
    }, 0);
  }, true);

  window.__tikpalProviderAudioGate = { version: 3, setActive, status };
  setActive(false);
})();

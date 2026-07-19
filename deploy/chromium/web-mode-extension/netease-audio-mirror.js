(() => {
  if (window.__tikpalNeteaseAudioMirror?.version === 2) return;
  if (!/(^|\.)music\.163\.com$/i.test(window.location.hostname)) return;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const clampVolume = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? clamp(number, 0, 1) : 1;
  };

  const state = {
    version: 2,
    ctx: null,
    current: null,
    buffers: new Map(),
    loading: new Map(),
    lastError: null,
    lastPlayErrorAt: 0,
    lastDecodedAt: 0,
    lastFetchMode: null
  };

  window.__tikpalNeteaseAudioMirror = state;

  const getContext = async () => {
    if (!state.ctx) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) throw new Error("AudioContext is unavailable");
      state.ctx = new AudioContextCtor();
    }
    if (state.ctx.state !== "running") await state.ctx.resume();
    return state.ctx;
  };

  const getActiveSound = () => {
    const howls = Array.isArray(window.Howler?._howls) ? window.Howler._howls : [];
    for (const howl of howls) {
      const sounds = Array.isArray(howl?._sounds) ? howl._sounds : [];
      for (const sound of sounds) {
        const node = sound?._node;
        if (!node || typeof node.play !== "function") continue;
        if (sound._paused || node.paused || node.ended) continue;
        return { howl, sound, node };
      }
    }
    return null;
  };

  const sourceUrl = (node) => node?.currentSrc || node?.src || "";

  const pageMuted = (howl, sound) => Boolean(window.Howler?._muted || howl?._muted || sound?._muted);

  const pageVolume = (howl, sound) => {
    if (pageMuted(howl, sound)) return 0;
    const howlerVolume = typeof window.Howler?.volume === "function" ? window.Howler.volume() : window.Howler?._volume;
    const howlVolume = sound?._volume ?? howl?._volume;
    return clampVolume(howlerVolume) * clampVolume(howlVolume);
  };

  const playbackRate = (node, sound) => {
    const nodeRate = Number(node?.playbackRate);
    const soundRate = Number(sound?._rate);
    if (Number.isFinite(nodeRate) && nodeRate > 0) return nodeRate;
    if (Number.isFinite(soundRate) && soundRate > 0) return soundRate;
    return 1;
  };

  const rememberBuffer = (src, buffer) => {
    state.buffers.set(src, buffer);
    while (state.buffers.size > 2) {
      const oldest = state.buffers.keys().next().value;
      state.buffers.delete(oldest);
    }
    return buffer;
  };

  const loadBuffer = (src) => {
    if (state.buffers.has(src)) return Promise.resolve(state.buffers.get(src));
    if (state.loading.has(src)) return state.loading.get(src);

    const job = (async () => {
      const ctx = await getContext();
      let data = null;
      try {
        const response = await fetch(src, { mode: "cors", credentials: "omit" });
        if (!response.ok) throw new Error(`NetEase audio fetch failed: ${response.status}`);
        data = await response.arrayBuffer();
        state.lastFetchMode = "page";
      } catch {
        data = await fetchThroughExtension(src);
        state.lastFetchMode = "extension";
      }
      const buffer = await ctx.decodeAudioData(data.slice(0));
      state.lastDecodedAt = Date.now();
      return rememberBuffer(src, buffer);
    })();

    state.loading.set(src, job);
    job.catch((error) => {
      state.lastError = String(error);
    }).finally(() => {
      state.loading.delete(src);
    });
    return job;
  };

  const base64ToArrayBuffer = (base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
  };

  const fetchThroughExtension = (src) => new Promise((resolve, reject) => {
    const id = `tikpal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const chunks = [];
    let total = null;
    let settled = false;
    const onMessage = (event) => {
      if (event.source !== window) return;
      const message = event.data;
      if (message?.type !== "tikpal-netease-fetch-audio-result" || message.id !== id) return;
      if (!message.ok) {
        settled = true;
        window.removeEventListener("message", onMessage);
        reject(new Error(message.error || "NetEase extension audio fetch failed"));
        return;
      }
      if (typeof message.chunk === "string" && Number.isInteger(message.index)) {
        total = Number.isInteger(message.total) ? message.total : total;
        chunks[message.index] = message.chunk;
        if (total && chunks.filter((chunk) => typeof chunk === "string").length < total) return;
      } else if (typeof message.base64 === "string") {
        total = 1;
        chunks[0] = message.base64;
      } else {
        return;
      }
      settled = true;
      window.removeEventListener("message", onMessage);
      try {
        resolve(base64ToArrayBuffer(chunks.join("")));
      } catch (error) {
        reject(error);
      }
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ type: "tikpal-netease-fetch-audio", id, url: src }, window.location.origin);
    window.setTimeout(() => {
      if (settled) return;
      window.removeEventListener("message", onMessage);
      reject(new Error("NetEase extension audio fetch timed out"));
    }, 30000);
  });

  const stopCurrent = (restoreNode = true) => {
    const current = state.current;
    if (!current) return;
    try {
      current.source.onended = null;
      current.source.stop();
    } catch {
      // A stopped source cannot be stopped again.
    }
    if (restoreNode && current.node) current.node.muted = false;
    state.current = null;
  };

  const startDecoded = async ({ howl, sound, node, src, buffer }) => {
    const ctx = await getContext();
    stopCurrent(false);

    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const rate = playbackRate(node, sound);
    const offset = clamp(Number(node.currentTime) || 0, 0, Math.max(0, buffer.duration - 0.05));

    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.setValueAtTime(pageVolume(howl, sound), ctx.currentTime);
    source.connect(gain).connect(ctx.destination);
    source.onended = () => {
      if (state.current?.source === source) state.current = null;
    };
    source.start(0, offset);
    node.muted = true;

    state.current = {
      src,
      node,
      howl,
      sound,
      source,
      gain,
      offset,
      rate,
      startedAt: ctx.currentTime,
      duration: buffer.duration
    };
  };

  const currentDecodedTime = (current) => {
    if (!current || !state.ctx) return 0;
    return current.offset + (state.ctx.currentTime - current.startedAt) * current.rate;
  };

  const sync = async () => {
    try {
      const active = getActiveSound();
      if (!active) {
        stopCurrent();
        return;
      }

      const { howl, sound, node } = active;
      const src = sourceUrl(node);
      if (!src) {
        stopCurrent();
        return;
      }

      const current = state.current;
      if (current?.src === src && current.node === node) {
        const volume = pageVolume(howl, sound);
        current.gain.gain.setTargetAtTime(volume, state.ctx.currentTime, 0.04);
        current.source.playbackRate.value = playbackRate(node, sound);
        node.muted = true;

        const nodeTime = Number(node.currentTime) || 0;
        const decodedTime = currentDecodedTime(current);
        if (Math.abs(decodedTime - nodeTime) > 0.6 || decodedTime >= current.duration - 0.1) {
          const buffer = state.buffers.get(src);
          if (buffer) await startDecoded({ howl, sound, node, src, buffer });
        }
        return;
      }

      const buffer = state.buffers.get(src);
      if (buffer) {
        await startDecoded({ howl, sound, node, src, buffer });
        return;
      }

      void loadBuffer(src).then((loadedBuffer) => {
        const latest = getActiveSound();
        if (!latest || sourceUrl(latest.node) !== src) return;
        return startDecoded({ ...latest, src, buffer: loadedBuffer });
      }).catch((error) => {
        state.lastError = String(error);
      });
    } catch (error) {
      state.lastPlayErrorAt = Date.now();
      state.lastError = String(error);
    }
  };

  window.setInterval(() => {
    void sync();
  }, 500);
  document.addEventListener("pointerdown", () => window.setTimeout(() => void sync(), 80), true);
  document.addEventListener("keydown", () => window.setTimeout(() => void sync(), 80), true);
  window.addEventListener("beforeunload", () => stopCurrent(false));
  void sync();
})();

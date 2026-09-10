(() => {
  if (!/(^|\.)deezer\.com$/.test(location.hostname) || window.__tikpalDeezerAdClickGuard) return;
  window.__tikpalDeezerAdClickGuard = true;
  const frameSelector = 'iframe[title="Advertisement"]';
  const protect = (container) => {
    if (!container || container.id !== 'adContainer') return;
    // Cross-origin frame events cannot bubble to this document. Inert prevents
    // pointer and keyboard activation inside the frame without stopping media.
    for (const frame of container.querySelectorAll(frameSelector)) frame.inert = true;
  };
  const inspect = (node) => {
    if (!(node instanceof Element)) return;
    protect(node.closest('#adContainer'));
    for (const container of node.querySelectorAll('#adContainer')) protect(container);
  };
  protect(document.getElementById('adContainer'));
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') inspect(record.target);
      else for (const node of record.addedNodes) inspect(node);
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] });
  const block = (event) => {
    const container = event.target instanceof Element ? event.target.closest('#adContainer') : null;
    if (!container?.querySelector(frameSelector)) return;
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  for (const type of ['click', 'auxclick', 'dblclick', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'keydown']) {
    window.addEventListener(type, block, { capture: true, passive: false });
  }
})();

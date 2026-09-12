(() => {
  if (window.location.hostname !== "music.apple.com") return;

  const protectedSelector = [
    '[data-testid="native-cta"]',
    '[data-testid="native-cta-button"]',
    ".native-cta",
    ".navigation__native-cta",
    '[data-test="upsell-personal-cta"]',
    '[data-test="upsell-personal-student"]',
    '[data-test="upsell-banner"] [data-test="cta-button"]'
  ].join(",");

  const isProtectedActivation = (event) => {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
    return path.some((node) => node instanceof Element && (
      node.matches(protectedSelector) || node.closest(protectedSelector)
    ));
  };

  const blockActivation = (event) => {
    if (!isProtectedActivation(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  for (const type of ["pointerdown", "mousedown", "mouseup", "touchstart", "touchend", "click", "auxclick"]) {
    document.addEventListener(type, blockActivation, true);
  }
  for (const type of ["keydown", "keyup"]) {
    document.addEventListener(type, (event) => {
      if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") blockActivation(event);
    }, true);
  }

  window.__tikpalAppleExternalAppGuard = "1";
})();

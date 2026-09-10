(() => {
  if (!/(^|\.)tidal\.com$/i.test(location.hostname) || window.__tikpalTidalDismissUpsell) return;
  window.__tikpalTidalDismissUpsell = true;

  const dismiss = () => {
    for (const dialog of document.querySelectorAll('dialog#UPSELL[open]')) {
      const plans = dialog.querySelector('[data-test="dialog-upsell"] [data-test="continue-button"]');
      if (plans?.textContent.trim().replace(/\s+/g, ' ').toLowerCase() !== 'view plans') continue;
      const close = dialog.querySelector('button[data-test="dialog-close"][aria-label="Close"]');
      if (!close || close.disabled || close.getAttribute('aria-disabled') === 'true' || !close.checkVisibility()) continue;
      close.click();
    }
  };
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; dismiss(); }, 50);
  };
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['open']
  });
  dismiss();
})();

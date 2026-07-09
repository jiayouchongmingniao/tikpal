(() => {
  const retarget = (root = document) => {
    root.querySelectorAll?.('a[target="_blank"]').forEach((link) => {
      link.target = "_self";
    });
  };

  document.addEventListener(
    "click",
    (event) => {
      const link = event.target?.closest?.('a[href][target="_blank"]');
      if (!link) return;
      event.preventDefault();
      event.stopPropagation();
      window.location.assign(link.href);
    },
    true
  );

  if (document.documentElement) retarget();
  document.addEventListener("DOMContentLoaded", () => {
    retarget();
    new MutationObserver(() => retarget()).observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  });
})();

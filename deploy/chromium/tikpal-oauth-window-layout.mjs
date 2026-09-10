const loginHost = (value) => {
  try { const url = new URL(value); return url.protocol === 'https:' && ['accounts.google.com', 'myaccount.google.com', 'appleid.apple.com', 'account.apple.com'].includes(url.hostname); } catch { return false; }
};
const keys = ['left', 'top', 'width', 'height'];

// Browser-domain CDP permits offscreen parking on a kiosk without a window
// manager. Extension windows.update rejects those bounds; minimize also needs a WM.
export function createOAuthWindowLayout() {
  const children = new Map();
  return {
    hasWindows: () => children.size > 0,
    async sync(targets, command, isProviderTarget, runtime) {
      if (!children.size && !targets.some(target => loginHost(target.url))) return;
      const { targetInfos = [] } = await command('Target.getTargets');
      const byId = new Map(targetInfos.map(target => [target.targetId, target]));
      for (const target of targetInfos) {
        const opener = byId.get(target.openerId);
        if (!children.has(target.targetId) && target.type === 'page' && loginHost(target.url) && opener && isProviderTarget(opener)) {
          children.set(target.targetId, { openerId: opener.targetId, shown: false });
        }
      }
      for (const [id, child] of children) {
        const opener = byId.get(child.openerId);
        if (!opener || !isProviderTarget(opener)) { children.delete(id); continue; }
        const active = runtime.active && !runtime.opening && !runtime.deactivating;
        if (!byId.has(id)) {
          children.delete(id);
          if (child.shown && active) await command('Target.activateTarget', { targetId: child.openerId });
          continue;
        }
        try {
          const parent = await command('Browser.getWindowForTarget', { targetId: child.openerId });
          const popup = await command('Browser.getWindowForTarget', { targetId: id });
          if (parent.windowId === popup.windowId) { children.delete(id); continue; }
          const bounds = Object.fromEntries(keys.map(key => [key, parent.bounds[key]]));
          const visible = active && bounds.left >= 0 && bounds.left < bounds.width;
          if (keys.some(key => popup.bounds[key] !== bounds[key])) {
            await command('Browser.setWindowBounds', { windowId: popup.windowId, bounds });
          }
          if (visible && !child.shown) await command('Target.activateTarget', { targetId: id });
          child.shown = visible;
        } catch {
          // A popup can close during a bounds query. Reconcile next tick.
        }
      }
    }
  };
}

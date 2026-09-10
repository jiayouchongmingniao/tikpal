// Rules are provider-specific: unknown destinations remain untouched.
const policies = { deezer: { hosts: ['deezer.com'], blocked: ['grainger.com'] } };
const authHosts = ['accounts.google.com', 'myaccount.google.com', 'appleid.apple.com', 'account.apple.com'];
const matches = (host, domain) => host === domain || host.endsWith(`.${domain}`);
function hostOf(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.hostname : ''; }
  catch { return ''; }
}

function isDeezerAudioPromotion(value) {
  try {
    const url = new URL(value);
    return ['deezer.com', 'www.deezer.com'].includes(url.hostname)
      && /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?offers\/?$/i.test(url.pathname)
      && url.searchParams.get('utm_source') === 'autopromo'
      && url.searchParams.get('utm_medium') === 'audio'
      && url.searchParams.get('utm_content') === 'conversion';
  } catch { return false; }
}

export function createProviderChildWindows({ provider, targets, command, readState, log = console.log }) {
  const protectedTargets = new Set();
  const pending = new Set();
  const reported = new Map();
  const policy = policies[provider];
  const foreground = () => {
    try { const state = readState(); return state.activeProvider === provider && !state.openingProvider; }
    catch { return false; }
  };
  return {
    forget(id) { protectedTargets.delete(id); reported.delete(id); },
    async inspect(info) {
      if (!policy || info?.type !== 'page') return;
      const host = hostOf(info.url);
      if (authHosts.includes(host)) protectedTargets.add(info.targetId);
      if (!info.openerId || !host || protectedTargets.has(info.targetId)) return;
      const opener = targets().get(info.openerId);
      // Only direct children of the provider page; never touch its main page,
      // nested login children, or children whose opener can no longer be verified.
      if (!opener || opener.type !== 'page' || opener.openerId
        || !policy.hosts.some(domain => matches(hostOf(opener.url), domain))) return;
      const promotion = provider === 'deezer' && isDeezerAudioPromotion(info.url);
      if (!promotion && policy.hosts.some(domain => matches(host, domain))) return;
      if (!promotion && !policy.blocked.some(domain => matches(host, domain))) {
        if (reported.get(info.targetId) !== host) {
          reported.set(info.targetId, host);
          log(`[provider-child-window] observed provider=${provider} source=${hostOf(opener.url)} destination=${host}`);
        }
        return;
      }
      if (pending.has(info.targetId)) return;
      pending.add(info.targetId);
      try {
        const result = await command('Target.closeTarget', { targetId: info.targetId });
        if (!result?.success) return;
        log(`[provider-child-window] closed provider=${provider} source=${hostOf(opener.url)} destination=${host}`);
        if (!foreground() || !targets().has(opener.targetId)) return;
        const parent = await command('Browser.getWindowForTarget', { targetId: opener.targetId });
        // A switch can park the main window before the active state commits.
        if (parent.bounds.left < 0 || parent.bounds.left >= parent.bounds.width || !foreground()) return;
        await command('Target.activateTarget', { targetId: opener.targetId });
      } catch {
        // Target closure/navigation races are harmless; never retry in a loop.
      } finally { pending.delete(info.targetId); }
    }
  };
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../deploy/chromium/deezer-preview-recovery.js', import.meta.url), 'utf8');
function fixture(hostname = 'www.deezer.com') {
  let now = 0, nextId = 0, plays = 0, skips = 0;
  const timers = new Map(), listeners = new Map();
  const url = 'https://cdnt-preview.dzcdn.net/api/1/1/abc.mp3';
  let song = { SNG_ID: '1', MEDIA: [{ TYPE: 'preview', HREF: url }] };
  const gate = { active: true, playingCount: 0 };
  const player = { playing: true, paused: false, loading: false, position: 0, audioAds: null,
    getCurrentSong: () => song, control: { play: () => { plays++; }, nextSong: () => { skips++; } } };
  const document = { visibilityState: 'visible', addEventListener: (type, fn) => listeners.set(type, fn) };
  const window = { dzPlayer: player, __tikpalProviderAudioGate: { status: () => gate } };
  vm.runInNewContext(source, { window, document, location: { hostname }, URL, Map, Promise, console,
    Date: { now: () => now }, setTimeout: (fn, ms) => { timers.set(++nextId, { fn, at: now + ms }); return nextId; }, clearTimeout: id => timers.delete(id) });
  return { window, player, gate, document, url, timers, listeners, counts: () => ({ plays, skips }),
    song: s => { song = s; }, async advance(ms) { const end = now + ms; for (;;) { const next = [...timers].sort((a,b) => a[1].at-b[1].at)[0]; if (!next || next[1].at > end) break; now = next[1].at; timers.delete(next[0]); next[1].fn(); await Promise.resolve(); await Promise.resolve(); } now = end; } };
}
const a = fixture();a.window.__tikpalDeezerPreviewRecovery.rejected(a.url);await a.advance(5000);
assert.deepEqual(a.counts(), { plays: 1, skips: 1 });assert.equal(a.timers.size, 0);
const b = fixture();b.window.__tikpalDeezerPreviewRecovery.rejected(b.url);await b.advance(1000);b.gate.playingCount=1;b.player.position=2;await b.advance(4000);assert.deepEqual(b.counts(),{plays:1,skips:0});
for (const change of [f=>f.listeners.get('pointerdown')({isTrusted:true}), f=>{f.gate.active=false;f.window.__tikpalDeezerPreviewRecovery.setActive(false);}, f=>{f.player.paused=true;}, f=>f.song({SNG_ID:'2',MEDIA:[]})]) {
 const f=fixture();f.window.__tikpalDeezerPreviewRecovery.rejected(f.url);await f.advance(1000);change(f);await f.advance(6000);assert.equal(f.counts().skips,0);
}
const c=fixture();c.window.__tikpalDeezerPreviewRecovery.rejected('https://ads.example/a.mp3');await c.advance(5000);assert.deepEqual(c.counts(),{plays:0,skips:0});
const d=fixture();for(let i=0;i<4;i++){d.window.__tikpalDeezerPreviewRecovery.rejected(d.url);await d.advance(5000);}assert.equal(d.counts().skips,3);
const e=fixture();e.song({SNG_ID:'0',MEDIA:[]});e.window.__tikpalDeezerPreviewRecovery.rejected(e.url);await e.advance(10000);assert.equal(e.counts().skips,0);e.song({SNG_ID:'1',MEDIA:[{TYPE:'preview',HREF:e.url}]});await e.advance(5000);assert.equal(e.counts().skips,1);
const f=fixture();f.window.__tikpalDeezerPreviewRecovery.afterEnded();await f.advance(16000);assert.deepEqual(f.counts(),{plays:1,skips:0});assert.equal(f.timers.size,0);
const g=fixture();g.player.paused=true;g.window.__tikpalDeezerPreviewRecovery.afterEnded();await g.advance(16000);assert.equal(g.counts().plays,0);
const h=fixture();h.window.__tikpalDeezerPreviewRecovery.setActive(true);await h.advance(2000);h.window.__tikpalDeezerPreviewRecovery.setActive(true);await h.advance(2000);assert.equal(h.counts().plays,1);
assert.equal(fixture('suno.com').window.__tikpalDeezerPreviewRecovery,undefined);
console.log('Deezer preview recovery passed: retry, skip, cancellation, preload, limit and provider isolation');
// Exercise the real manager event dispatch without starting a browser/service.
const managerSource = fs.readFileSync(new URL('../deploy/chromium/tikpal-web-mode-cdp-manager.mjs', import.meta.url), 'utf8');
const dispatchBody = managerSource.split('  onEvent(method, params, sessionId) {')[1].split('    if (method === "Target.targetCreated")')[0];
let runtime = { activeProvider: 'deezer' }, closing = false;
const dispatch = new Function('readFileSync', 'readCloseAudioOwner', 'deezerPreviewRecovery', 'process', 'method', 'params', 'sessionId', dispatchBody);
const sent = [];
const owner = { id: 'deezer', sessionId: 'current', sendSession: (method, params) => { sent.push(params.expression); return Promise.resolve(); } };
const emit = (method, params, session = 'current') => dispatch.call(owner, () => JSON.stringify(runtime), () => closing, source, { env: {} }, method, params, session);
const signed = a.url + '?secret=must-not-forward';
emit('Network.responseReceived', { response: { status: 403, url: signed } });
emit('Log.entryAdded', { entry: { source: 'network', text: 'Failed to load resource: the server responded with a status of 403 ()', url: signed } });
assert.equal(sent.length, 2);assert.ok(sent.every(s => !s.includes('secret=must-not-forward')));
emit('Network.responseReceived', { response: { status: 403, url: signed } }, 'old');
emit('Network.responseReceived', { response: { status: 403, url: 'https://ads.example/ad.mp3' } });
emit('Log.entryAdded', { entry: { source: 'javascript', text: 'status of 403', url: signed } });
runtime = { activeProvider: 'suno' };emit('Network.responseReceived', { response: { status: 403, url: signed } });
runtime = { activeProvider: 'deezer', openingProvider: 'suno' };emit('Network.responseReceived', { response: { status: 403, url: signed } });
runtime = { activeProvider: 'deezer' };closing = true;emit('Network.responseReceived', { response: { status: 403, url: signed } });
assert.equal(sent.length, 2);
console.log('Deezer manager dispatch passed: Network/Log 403, session ownership and URL redaction');

const midTrack = fixture();midTrack.player.position=14;midTrack.gate.playingCount=1;
midTrack.window.__tikpalDeezerPreviewRecovery.mediaError({error:{code:2},currentSrc:midTrack.url});
await midTrack.advance(5000);assert.deepEqual(midTrack.counts(),{plays:1,skips:1},'a stuck nonzero position is not successful recovery');
const progressing=fixture();progressing.player.position=14;progressing.gate.playingCount=1;
progressing.window.__tikpalDeezerPreviewRecovery.mediaError({error:{code:2},src:progressing.url});
await progressing.advance(1000);progressing.player.position=15;await progressing.advance(5000);
assert.deepEqual(progressing.counts(),{plays:1,skips:0});
for(const error of [{code:3},{code:4}]){const f=fixture();f.window.__tikpalDeezerPreviewRecovery.mediaError({error,src:f.url});await f.advance(5000);assert.equal(f.counts().plays,0);}
const otherMedia=fixture();otherMedia.window.__tikpalDeezerPreviewRecovery.mediaError({error:{code:2},src:'https://cdnt-preview.dzcdn.net/api/1/other.mp3'});await otherMedia.advance(5000);assert.equal(otherMedia.counts().plays,0);
console.log('Deezer media read recovery passed: current preview only, progress required, decode/unsupported excluded');

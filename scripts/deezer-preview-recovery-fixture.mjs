import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../deploy/chromium/deezer-preview-recovery.js', import.meta.url), 'utf8');
function fixture(hostname = 'www.deezer.com', storage = new Map(), start = 0) {
  let now = start, nextId = 0, plays = 0, skips = 0, reloads = 0;
  const timers = new Map(), listeners = new Map();
  const url = 'https://cdnt-preview.dzcdn.net/api/1/1/abc.mp3';
  let song = { SNG_ID: '1', MEDIA: [{ TYPE: 'preview', HREF: url }] };
  const gate = { active: true, playingCount: 0 };
  const player = { playing: true, paused: false, loading: false, position: 0, audioAds: null,
    getContext: () => ({ID:1,TYPE:"playlist"}), getTrackList: () => [song], getIndexSong: () => 0, playTrackAtIndex: () => { plays++; }, getCurrentSong: () => song, control: { play: () => { plays++; }, nextSong: () => { skips++; } } };
  const document = { querySelectorAll: () => [], visibilityState: 'visible', addEventListener: (type, fn) => listeners.set(type, fn) };
  const window = { dzPlayer: player, __tikpalProviderAudioGate: { status: () => gate } };
  vm.runInNewContext(source, { window, document, location: { hostname, reload: () => { reloads++; } }, sessionStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v) }, URL, Map, Promise, console,
    Date: { now: () => now }, setTimeout: (fn, ms) => { timers.set(++nextId, { fn, at: now + ms }); return nextId; }, clearTimeout: id => timers.delete(id) });
  return { window, player, gate, document, url, timers, listeners, reloads: () => reloads, counts: () => ({ plays, skips }),
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
console.log('Deezer media read recovery passed: current preview only, progress required, decode and unconfirmed unsupported errors excluded');

function errorDialog(f, text='Error\nAn error occurred, please try again later\nOK') {
 let clicks=0, shown=true;
 const button={innerText:'OK',disabled:false,getClientRects:()=>[{}],click(){clicks++;shown=false;}};
 const dialog={innerText:text,getClientRects:()=>shown?[{}]:[],querySelectorAll:()=>[button]};
 f.document.querySelectorAll=()=>[dialog];
 return {clicks:()=>clicks,show:()=>{shown=true;},button};
}
const unsupported=fixture(), popup=errorDialog(unsupported);
unsupported.window.__tikpalDeezerPreviewRecovery.mediaError({error:{code:4},src:unsupported.url});
await unsupported.advance(5000);assert.deepEqual(unsupported.counts(),{plays:1,skips:1});assert.equal(popup.clicks(),1);
for(const change of [f=>f.player.paused=true,f=>f.gate.active=false,f=>f.listeners.get('pointerdown')({isTrusted:true})]){
 const f=fixture(),p=errorDialog(f);f.window.__tikpalDeezerPreviewRecovery.mediaError({error:{code:4},src:f.url});change(f);await f.advance(16000);assert.equal(p.clicks(),0);assert.equal(f.counts().skips,0);
}
const unknown=fixture(),other=errorDialog(unknown,'Error Please log in OK');unknown.window.__tikpalDeezerPreviewRecovery.mediaError({error:{code:4},src:unknown.url});await unknown.advance(16000);assert.equal(other.clicks(),0);assert.equal(unknown.counts().plays,0);assert.equal(unknown.timers.size,0);
const delayed=fixture();delayed.window.__tikpalDeezerPreviewRecovery.mediaError({error:{code:4},src:delayed.url});await delayed.advance(2000);const late=errorDialog(delayed);await delayed.advance(5000);assert.equal(late.clicks(),1);assert.equal(delayed.counts().skips,1);
const capped=fixture(),capPopup=errorDialog(capped);for(let i=0;i<4;i++){capPopup.show();capped.window.__tikpalDeezerPreviewRecovery.mediaError({error:{code:4},src:capped.url});await capped.advance(5000);}assert.equal(capped.counts().skips,3);assert.equal(capPopup.clicks(),3,'last error remains visible after recovery limit');
console.log('Deezer code 4 dialog recovery passed: exact dialog, delayed insertion, cancellation and visible failure at cap');
const interrupted=fixture(),interruptedPopup=errorDialog(interrupted);interrupted.window.__tikpalDeezerPreviewRecovery.mediaError({error:{code:4},src:interrupted.url});await interrupted.advance(1000);interrupted.listeners.get('pointerdown')({isTrusted:true});await interrupted.advance(5000);assert.equal(interruptedPopup.clicks(),1);assert.equal(interrupted.counts().skips,0);
const unrelated=fixture(),unrelatedPopup=errorDialog(unrelated);unrelated.window.__tikpalDeezerPreviewRecovery.mediaError({error:{code:4},src:'https://cdnt-preview.dzcdn.net/api/1/unrelated.mp3'});await unrelated.advance(16000);assert.equal(unrelatedPopup.clicks(),0);
const disabled=fixture(),disabledPopup=errorDialog(disabled);disabledPopup.button.disabled=true;disabled.window.__tikpalDeezerPreviewRecovery.mediaError({error:{code:4},src:disabled.url});await disabled.advance(16000);assert.equal(disabledPopup.clicks(),0);assert.equal(disabled.counts().skips,0);

const reloadStorage = new Map();
const expired = fixture('www.deezer.com', reloadStorage, 100000), expiredPopup = errorDialog(expired);
expired.song({SNG_ID:'1',MEDIA:[{TYPE:'preview',HREF:expired.url+'?hdnea=exp=99~acl=test~hmac=secret'}]});
expired.window.__tikpalDeezerPreviewRecovery.mediaError({error:{code:4},src:expired.url});
await expired.advance(2000);assert.equal(expired.reloads(),1);assert.equal(expiredPopup.clicks(),1);assert.deepEqual(expired.counts(),{plays:0,skips:0});
assert.ok(!JSON.stringify([...reloadStorage]).includes('secret'));
const resumed=fixture('www.deezer.com',reloadStorage,103000);
resumed.song({SNG_ID:'1',MEDIA:[{TYPE:'preview',HREF:resumed.url+'?hdnea=exp=200~hmac=x'}]});
resumed.window.__tikpalDeezerPreviewRecovery.setActive(true);await resumed.advance(2000);assert.equal(resumed.counts().plays,1);
resumed.song({SNG_ID:'1',MEDIA:[{TYPE:'preview',HREF:resumed.url+'?hdnea=exp=99~hmac=x'}]});errorDialog(resumed);
resumed.window.__tikpalDeezerPreviewRecovery.mediaError({error:{code:4},src:resumed.url});await resumed.advance(5000);assert.equal(resumed.reloads(),0);assert.equal(resumed.counts().skips,0);
for(const change of [f=>f.listeners.get('pointerdown')({isTrusted:true}),f=>f.window.__tikpalDeezerPreviewRecovery.setActive(false),f=>f.song({SNG_ID:'2',MEDIA:[]})]){
 const storage=new Map([['__tikpalDeezerPreviewReload',JSON.stringify({at:100000,id:'1',contextId:'1',contextType:'playlist',resume:true})]]);
 const f=fixture('www.deezer.com',storage,101000);f.window.__tikpalDeezerPreviewRecovery.setActive(true);change(f);await f.advance(31000);assert.equal(f.counts().skips,0);assert.equal(f.counts().plays,0);
}
const stale=fixture('www.deezer.com',new Map([['__tikpalDeezerPreviewReload',JSON.stringify({at:100000,id:'1',contextId:'1',contextType:'playlist',resume:true})]]),101000);
stale.window.__tikpalDeezerPreviewRecovery.setActive(true);await stale.advance(31000);assert.equal(stale.counts().plays,0);assert.equal(stale.timers.size,0);
console.log('Deezer expired URLs passed: one refresh, fresh same-track resume, navigation budget, manual/ownership cancellation and timeout');
const restoreList=fixture('www.deezer.com',new Map([['__tikpalDeezerPreviewReload',JSON.stringify({at:100000,id:'2',contextId:'1',contextType:'playlist',resume:true})]]),101000);
let restoredIndex;
restoreList.player.getTrackList=()=>[{SNG_ID:'1'}, {SNG_ID:'2',MEDIA:[{TYPE:'preview',HREF:restoreList.url+'?hdnea=exp=200~hmac=x'}]}];
restoreList.player.playTrackAtIndex=index=>{restoredIndex=index;};
restoreList.window.__tikpalDeezerPreviewRecovery.setActive(true);await restoreList.advance(2000);assert.equal(restoredIndex,1);
const movedContext=fixture('www.deezer.com',new Map([['__tikpalDeezerPreviewReload',JSON.stringify({at:100000,id:'1',contextId:'2',contextType:'playlist',resume:true})]]),101000);
movedContext.window.__tikpalDeezerPreviewRecovery.setActive(true);await movedContext.advance(31000);assert.equal(movedContext.counts().plays,0);

// The document-start audio gate starts muted before backend ownership arrives.
// That initialization must not erase a refresh continuation ticket.
const initializingStorage = new Map([['__tikpalDeezerPreviewReload', JSON.stringify({at:100000,id:'1',contextId:'1',contextType:'playlist',resume:true})]]);
const initializing = fixture('www.deezer.com', initializingStorage, 101000);
initializing.song({SNG_ID:'1',MEDIA:[{TYPE:'preview',HREF:initializing.url+'?hdnea=exp=200'}]});
initializing.gate.active = false;
initializing.window.__tikpalDeezerPreviewRecovery.setActive(false, {initializing:true});
await initializing.advance(2000);
assert.equal(initializing.counts().plays,0);
assert.equal(JSON.parse(initializingStorage.get('__tikpalDeezerPreviewReload')).resume,true);
initializing.gate.active = true;
initializing.window.__tikpalDeezerPreviewRecovery.setActive(true);
await initializing.advance(2000);
assert.equal(initializing.counts().plays,1);

const closedBeforeActivation = fixture('www.deezer.com', new Map([['__tikpalDeezerPreviewReload', JSON.stringify({at:100000,id:'1',contextId:'1',contextType:'playlist',resume:true})]]),101000);
closedBeforeActivation.song({SNG_ID:'1',MEDIA:[{TYPE:'preview',HREF:closedBeforeActivation.url+'?hdnea=exp=200'}]});
closedBeforeActivation.gate.active=false;
closedBeforeActivation.window.__tikpalDeezerPreviewRecovery.setActive(false,{initializing:true});
closedBeforeActivation.window.__tikpalDeezerPreviewRecovery.setActive(false);
closedBeforeActivation.gate.active=true;
closedBeforeActivation.window.__tikpalDeezerPreviewRecovery.setActive(true);
closedBeforeActivation.player.playing=false;
await closedBeforeActivation.advance(31000);
assert.equal(closedBeforeActivation.counts().plays,0,'an actual close before first activation still cancels continuation');

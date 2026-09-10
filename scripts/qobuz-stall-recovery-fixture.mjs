import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../deploy/chromium/web-mode-extension/provider-audio-gate.js',import.meta.url),'utf8');
function setup(host='play.qobuz.com') {
  const timers=new Map();let next=0;
  class Media extends EventTarget {
    constructor(){super();Object.assign(this,{paused:true,ended:false,currentTime:0,readyState:0,networkState:2,buffered:{length:0},src:'https://audio.example/one',currentSrc:'',volume:1,loads:0});}
    play(){this.paused=false;return Promise.resolve();}
    pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}
    load(){this.loads++;this.dispatchEvent(new Event('emptied'));this.paused=true;}
  }
  const document={visibilityState:'visible',querySelectorAll:()=>[],addEventListener(){}};
  const window={location:{hostname:host,origin:`https://${host}`},HTMLMediaElement:Media,postMessage(){}};
  vm.runInNewContext(source,{window,document,HTMLMediaElement:Media, setTimeout(fn,ms){assert.equal(ms,15000);timers.set(++next,fn);return next},clearTimeout(id){timers.delete(id)}});
  window.__tikpalProviderAudioGate.setActive(true);
  return {media:new Media(),gate:window.__tikpalProviderAudioGate,document,timers,fire(){for(const [id,fn] of [...timers]){timers.delete(id);fn()}}};
}
let t=setup();await t.media.play();assert.equal(t.timers.size,1);t.fire();assert.equal(t.media.loads,1);assert.equal(t.timers.size,0);
t.media.dispatchEvent(new Event('waiting'));await t.media.play();t.fire();assert.equal(t.media.loads,1,'same source retries once');
for(const stop of [t=>t.media.pause(),t=>t.gate.setActive(false),t=>{t.media.readyState=4;t.media.dispatchEvent(new Event('playing'))},t=>{t.media.src='https://audio.example/two';t.media.dispatchEvent(new Event('emptied'))}]) {
 t=setup();await t.media.play();stop(t);assert.equal(t.timers.size,0);t.fire();assert.equal(t.media.loads,0);
}
for(const change of [t=>t.document.visibilityState='hidden',t=>t.media.currentTime=1,t=>t.media.buffered.length=1,t=>t.media.error={code:4},t=>t.media.networkState=1,t=>t.media.src='https://audio.example/two']) {
 t=setup();await t.media.play();change(t);t.fire();assert.equal(t.media.loads,0);
}
t=setup();await t.media.play();t.media.src='https://audio.example/two';t.media.dispatchEvent(new Event('emptied'));await t.media.play();t.fire();assert.equal(t.media.loads,1,'new source can recover');
t=setup('open.spotify.com');await t.media.play();assert.equal(t.timers.size,0,'other providers have no timers');
t=setup();t.media.readyState=4;await t.media.play();assert.equal(t.timers.size,0,'normal playback has no timer');
console.log('[qobuz-stall-recovery-fixture] passed');

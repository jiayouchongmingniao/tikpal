import assert from 'node:assert/strict';
import { createOAuthWindowLayout } from '../deploy/chromium/tikpal-oauth-window-layout.mjs';
let targets = [
  {targetId:'main',type:'page',url:'https://www.qobuz.com/login'},
  {targetId:'login',type:'page',openerId:'main',url:'https://accounts.google.com/signin'},
  {targetId:'ad',type:'page',openerId:'main',url:'https://ads.example.com'},
  {targetId:'unowned',type:'page',url:'https://accounts.google.com/signin'}
];
const windows = new Map(['main','login','ad','unowned'].map(id=>[id,{windowId:id,bounds:{left:id==='main'?0:2560,top:0,width:1920,height:720}}]));
const writes=[];
const command=async(method,p={})=>{
  if(method==='Target.getTargets')return {targetInfos:targets};
  if(method==='Browser.getWindowForTarget')return structuredClone(windows.get(p.targetId));
  writes.push({method,...p});
  if(method==='Browser.setWindowBounds')windows.get(p.windowId).bounds=p.bounds;
};
const manager=createOAuthWindowLayout();
const isProvider=t=>t.url.startsWith('https://www.qobuz.com/');
let runtime={active:true,opening:false,deactivating:false};
const sync=()=>manager.sync(targets,command,isProvider,runtime);
await sync();
assert.equal(windows.get('login').bounds.left,0);
assert.equal(windows.get('ad').bounds.left,2560);
assert.equal(windows.get('unowned').bounds.left,2560);
assert.equal(writes.at(-1).targetId,'login');
const initial=writes.length;await sync();assert.equal(writes.length,initial,'no repeated focus or geometry writes');
runtime.deactivating=true;windows.get('main').bounds.left=2560;
await sync();assert.equal(windows.get('login').bounds.left,2560,'park during handoff');
assert.equal(writes.at(-1).method,'Browser.setWindowBounds','handoff must not steal focus');
runtime={active:false,frozen:true};await sync();assert.equal(windows.get('login').bounds.left,2560);
runtime={active:true};windows.get('main').bounds.left=0;await sync();assert.equal(writes.at(-1).targetId,'login');
targets.find(t=>t.targetId==='login').url='https://www.qobuz.com/signin/google';await sync();
targets=targets.filter(t=>t.targetId!=='login');await sync();assert.equal(writes.at(-1).targetId,'main','close returns to opener');
targets.push({targetId:'apple',type:'page',openerId:'main',url:'https://appleid.apple.com/auth/authorize'});
windows.set('apple',{windowId:'apple',bounds:{left:2560,top:0,width:600,height:600}});await sync();assert.equal(windows.get('apple').bounds.left,0);
targets.find(t=>t.targetId==='apple').url='https://myaccount.google.com/';await sync();
runtime={active:false};windows.get('main').bounds.left=2560;await sync();const n=writes.length;
targets=targets.filter(t=>t.targetId!=='apple');await sync();assert.equal(writes.length,n,'background close must not steal focus');
assert.equal(manager.hasWindows(),false);
console.log('[oauth-windows-fixture] passed');

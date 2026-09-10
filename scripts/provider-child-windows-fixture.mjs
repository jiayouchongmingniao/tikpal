import assert from 'node:assert/strict';
import {createProviderChildWindows} from '../deploy/chromium/tikpal-provider-child-windows.mjs';
function setup(provider='deezer') {
 const main={targetId:'main',type:'page',url:'https://www.deezer.com/en/'};
 const child={targetId:'child',type:'page',openerId:'main',url:'https://www.grainger.com/?secret=private'};
 const targets=new Map([['main',main],['child',child]]);const calls=[],logs=[];
 const state={activeProvider:'deezer',openingProvider:null};
 const env={main,child,targets,calls,logs,state,left:0,closeSuccess:true};
 env.guard=createProviderChildWindows({provider,targets:()=>targets,readState:()=>state,log:s=>logs.push(s),command:async(method,p)=>{
  calls.push({method,...p});
  if(method==='Target.closeTarget'){env.onClose?.();return {success:env.closeSuccess}}
  if(method==='Browser.getWindowForTarget')return {bounds:{left:env.left,width:1920}};
 }});
 return env;
}
let t=setup();await t.guard.inspect(t.child);assert.deepEqual(t.calls.map(c=>c.method),['Target.closeTarget','Browser.getWindowForTarget','Target.activateTarget']);assert.equal(t.calls[0].targetId,'child');assert.equal(t.calls[2].targetId,'main');assert.ok(t.logs.every(s=>!s.includes('secret')&&!s.includes('private')));
for(const change of [t=>delete t.child.openerId,t=>t.targets.delete('main'),t=>t.main.openerId='login',t=>t.main.url='https://unrelated.example',t=>t.child.url='https://grainger.com.evil.example/',t=>t.child.url='https://www.deezer.com/album/1',t=>t.child.url='about:blank']){
 t=setup();change(t);await t.guard.inspect(t.child);assert.equal(t.calls.length,0);
}
for(const host of ['accounts.google.com','myaccount.google.com','appleid.apple.com','account.apple.com']){
 t=setup();t.child.url=`https://${host}/login`;await t.guard.inspect(t.child);t.child.url='https://www.grainger.com/callback';await t.guard.inspect(t.child);assert.equal(t.calls.length,0,'observed login chain remains protected');
}
t=setup();t.child.url='https://help.example/?secret=x';await t.guard.inspect(t.child);await t.guard.inspect(t.child);assert.equal(t.logs.length,1);assert.equal(t.calls.length,0);assert.ok(!t.logs[0].includes('secret'));
for(const change of [t=>t.state.activeProvider='spotify',t=>t.state.openingProvider='suno',t=>t.left=2560,t=>t.onClose=()=>t.state.activeProvider='suno',t=>t.closeSuccess=false]){
 t=setup();change(t);await t.guard.inspect(t.child);assert.ok(!t.calls.some(c=>c.method==='Target.activateTarget'));
}
t=setup('spotify');await t.guard.inspect(t.child);assert.equal(t.calls.length,0);
t=setup();await Promise.all([t.guard.inspect(t.child),t.guard.inspect(t.child)]);assert.equal(t.calls.filter(c=>c.method==='Target.closeTarget').length,1);
const promo='https://www.deezer.com/en/offers/?utm_source=autopromo&utm_medium=audio&utm_content=conversion';
t=setup();t.child.url=promo;await t.guard.inspect(t.child);assert.equal(t.calls[0]?.method,'Target.closeTarget');
for(const url of ['https://www.deezer.com/en/offers/',promo.replace('autopromo','account'),promo.replace('/offers/','/login/'),promo.replace('www.deezer.com','deezer.com.evil.example')]){
 t=setup();t.child.url=url;await t.guard.inspect(t.child);assert.equal(t.calls.length,0,'ordinary site/account or unverified offer retained');
}
t=setup();t.child.url='https://accounts.google.com/login';await t.guard.inspect(t.child);t.child.url=promo;await t.guard.inspect(t.child);assert.equal(t.calls.length,0,'login chain retained');
console.log('[provider-child-windows-fixture] passed');

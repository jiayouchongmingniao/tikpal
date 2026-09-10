import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createProviderChildWindows} from '../deploy/chromium/tikpal-provider-child-windows.mjs';
const browser=await chromium.launch({headless:true});
try {
 const context=await browser.newContext();
 await context.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Local window policy fixture</title>'}));
 const main=await context.newPage();await main.goto('https://www.deezer.com/');
 const cdp=await browser.newBrowserCDPSession();const targets=new Map();const logs=[];const work=new Set();
 const policy=createProviderChildWindows({provider:'deezer',targets:()=>targets,command:(m,p)=>cdp.send(m,p),readState:()=>({activeProvider:'deezer'}),log:s=>logs.push(s)});
 const update=({targetInfo:t})=>{targets.set(t.targetId,t);const p=policy.inspect(t);work.add(p);p.finally(()=>work.delete(p));};
 cdp.on('Target.targetCreated',update);cdp.on('Target.targetInfoChanged',update);cdp.on('Target.targetDestroyed',({targetId})=>{targets.delete(targetId);policy.forget(targetId)});
 await cdp.send('Target.setDiscoverTargets',{discover:true});
 await main.evaluate(()=>window.open('https://www.grainger.com/?tracking=not-logged','_blank'));
 for(let i=0;i<100&&!logs.some(l=>l.includes('closed'));i++)await new Promise(r=>setTimeout(r,25));
 assert.ok(logs.some(l=>l.includes('closed')));assert.ok(logs.every(l=>!l.includes('tracking')));assert.equal(main.isClosed(),false);
 const closedBefore=logs.filter(l=>l.includes('closed')).length;
 await main.evaluate(()=>window.open('https://www.deezer.com/en/offers/?utm_source=autopromo&utm_medium=audio&utm_content=conversion','_blank'));
 for(let i=0;i<100&&logs.filter(l=>l.includes('closed')).length===closedBefore;i++)await new Promise(r=>setTimeout(r,25));
 assert.equal(logs.filter(l=>l.includes('closed')).length,closedBefore+1,'audio promotion child closes');
 const popupPromise=context.waitForEvent('page');await main.evaluate(()=>window.open('https://accounts.google.com/','_blank'));const login=await popupPromise;await login.waitForLoadState();
 await login.goto('https://www.grainger.com/callback');await Promise.all([...work]);assert.equal(login.isClosed(),false,'login navigation preserved');
 const helpPromise=context.waitForEvent('page');await main.evaluate(()=>window.open('https://help.example/','_blank'));const help=await helpPromise;await help.waitForLoadState();await Promise.all([...work]);assert.equal(help.isClosed(),false);
 console.log('[provider-child-windows-browser-fixture] passed: mocked destinations, real CDP events');
} finally {await browser.close()}

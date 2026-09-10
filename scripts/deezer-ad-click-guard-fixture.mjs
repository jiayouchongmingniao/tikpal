import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const source=await readFile(new URL('../deploy/chromium/web-mode-extension/deezer-ad-click-guard.js',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true});
try {
 const context=await browser.newContext({hasTouch:true});await context.addInitScript({content:source});
 await context.route('**/*',r=>r.fulfill({contentType:'text/html',body:new URL(r.request().url()).hostname==='ads.example'
 ? '<button style="width:100%;height:100px" onclick="window.open(\'https://destination.example/\')">Ad click</button>'
 : '<!doctype html><div id="adContainer" style="width:400px;height:160px" onclick="window.opens++"><iframe title="Advertisement" src="https://ads.example/" style="width:350px;height:100px"></iframe></div><button id="play" onclick="window.plays++">Play</button><div id="login"><button onclick="window.logins++">Login</button></div><script>window.opens=0;window.plays=0;window.logins=0</script>'}));
 const page=await context.newPage();await page.goto('https://www.deezer.com/');
 await page.waitForFunction(()=>document.querySelector('iframe').inert);
 let popups=0;context.on('page',()=>popups++);
 await page.mouse.click(50,50);await page.touchscreen.tap(50,50);await page.mouse.click(380,130);await page.touchscreen.tap(380,130);
 assert.equal(await page.evaluate(()=>opens),0,'ad frame and blank area activation blocked');assert.equal(popups,0);
 await page.locator('#play').click();await page.locator('#login button').click();assert.deepEqual(await page.evaluate(()=>[plays,logins]),[1,1]);
 await page.evaluate(()=>{document.querySelector('#adContainer').remove();const e=document.createElement('div');e.id='adContainer';e.innerHTML='<iframe title="Advertisement" src="https://ads.example/"></iframe>';document.body.append(e)});
 await page.waitForFunction(()=>document.querySelector('#adContainer iframe').inert);
 await page.evaluate(()=>document.querySelector('#adContainer').remove());await page.locator('#play').tap();assert.equal(await page.evaluate(()=>plays),2,'controls work after ad ends');
 await page.goto('https://open.spotify.com/');assert.equal(await page.locator('iframe').evaluate(e=>e.inert),false,'other providers unchanged');
 console.log('[deezer-ad-click-guard-fixture] passed: mouse/touch, cross-origin frame, dynamic insertion and normal controls');
} finally {await browser.close()}

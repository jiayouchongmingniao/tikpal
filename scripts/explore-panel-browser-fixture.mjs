import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();
const url=`http://127.0.0.1:${server.httpServer.address().port}/side-panel`;
const browser=await chromium.launch();const screenshots=mkdtempSync(path.join(tmpdir(),'tikpal-panel-browser-'));
try {
for(const locale of ['en','zh-CN','de','it','ko','ja','es']){
 const context=await browser.newContext({viewport:{width:640,height:720}});const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let mode='expanded',failed=false,supported=true;const actions=[];
 const state=()=>({activeProvider:'netease_music',openingProvider:null,activationPhase:'ready',panelMode:mode,panelLayoutSupported:supported,panelSessionId:'s1',panelXSessionGeneration:'x1',providers:[],residentProviders:{netease_music:{status:'active'}},settings:{providerTextScale:1.1,proxyEnabled:false},lastError:null,updatedAt:new Date().toISOString()});
 await page.addInitScript(locale=>localStorage.setItem('tikpal.locale',locale),locale);
 await page.route('**/api/v1/**',async route=>{
  const u=new URL(route.request().url());let body={};
  if(u.pathname.endsWith('/web-mode/state'))body=state();
  else if(u.pathname.endsWith('/system/state'))body={system:{volume:{percent:50}}};
  else if(u.pathname.endsWith('/ui/preferences')){await route.fulfill({status:503,json:{}});return;}
  else if(u.pathname.endsWith('/web-mode/actions')){
   const action=route.request().postDataJSON();actions.push(action);
   if(action.type==='panel_mode'){
    await new Promise(r=>setTimeout(r,300));
    if(failed){await route.fulfill({status:400,json:{error:'PANEL_BUSY_OR_STALE'}});return;}
    mode=action.panelMode;
   }
   body=state();
  }
  await route.fulfill({json:body});
 });
 await page.goto(url);const collapse=page.locator('[data-panel-collapse]');await collapse.waitFor();
 await page.locator('header strong').filter({hasText:'NetEase Cloud Music'}).waitFor();
 await page.waitForTimeout(160);
 const label=await collapse.getAttribute('aria-label');assert.ok(label&&!label.includes('explore.'));
 const toggleBox=await collapse.boundingBox();assert.equal(toggleBox.width,48);assert.equal(toggleBox.height,48);assert.ok(await collapse.evaluate(e=>!!e.closest(".web-mode-header-actions")));
 assert.equal(await collapse.locator('svg').getAttribute('width'),'28');
 await collapse.focus();assert.ok(await collapse.evaluate(el=>el.matches(':focus-visible')));
 const layout=await page.locator('.web-mode-panel').evaluate(el=>({
   sections:[...el.querySelectorAll(':scope > header,:scope > section,:scope > footer')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,right:r.right,bottom:r.bottom};}),
   headerOverlap:el.querySelector('header > div').getBoundingClientRect().right>el.querySelector('.web-mode-header-actions').getBoundingClientRect().left,
   clipped:[...el.querySelectorAll('header strong, .web-mode-provider strong')].filter(e=>e.scrollWidth>e.clientWidth).map(e=>e.textContent)
 }));
 assert.ok(layout.sections.every(r=>r.x===16&&r.right===624&&r.bottom<=720),`${locale} content bounds`);
 assert.equal(layout.headerOverlap,false,`${locale} header overlap`);assert.deepEqual(layout.clipped,[],`${locale} clipped labels`);
 const full=await page.locator('[data-web-mode-panel]').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,buttons:[...el.querySelectorAll('header button')].map(b=>{const r=b.getBoundingClientRect();return {x:r.x,right:r.right,bottom:r.bottom};})}));
 assert.equal(full.scroll,full.width,`${locale} full panel overflow`);assert.ok(full.buttons.every(b=>b.x>=0&&b.right<=640&&b.bottom<=720),`${locale} header clipped`);
 await page.screenshot({path:path.join(screenshots,`${locale}-expanded.png`)});
 await collapse.click();await page.locator('[data-panel-expand]:enabled').waitFor();
 assert.deepEqual(await page.locator('[data-panel-expand]').boundingBox(),{x:4,y:316,width:48,height:88});
 assert.deepEqual(await page.locator('[data-panel-exit]').boundingBox(),{x:4,y:656,width:48,height:48});
 assert.equal(await page.locator('[data-panel-expand] svg').getAttribute('width'),'28');
 assert.equal(actions.filter(a=>a.type==='panel_mode').length,1);
 assert.equal(await page.locator('[data-web-mode-provider]').count(),0,'hidden provider controls unmounted');
 let boxes=await page.locator('[data-web-mode-panel] button').evaluateAll(buttons=>buttons.map(b=>{const r=b.getBoundingClientRect();return {x:r.x,right:r.right,width:r.width,height:r.height};}));
 assert.equal(boxes.length,2);assert.ok(boxes.every(r=>r.x>=0&&r.right<=56&&r.width>=48&&r.height>=48));
 await page.locator('[data-panel-expand]').focus();await page.keyboard.press('Tab');assert.ok(await page.locator('[data-panel-exit]').evaluate(e=>e===document.activeElement));
 await page.screenshot({path:path.join(screenshots,`${locale}-collapsed.png`),clip:{x:0,y:0,width:56,height:720}});
 await page.reload();await page.locator('[data-panel-expand]:enabled').waitFor();
 failed=true;await page.locator('[data-panel-expand]').click();await page.locator('.web-mode-rail-error').waitFor();assert.equal(await page.locator('[data-panel-expand]').count(),1,'failed expansion reconciles to collapsed');
 failed=false;await page.locator('[data-panel-expand]').click();
 assert.ok(await page.locator('[data-panel-expand]').isDisabled());
 const pendingExit=await page.locator('[data-panel-exit]').boundingBox();
 assert.ok(pendingExit.x+pendingExit.width<=56,'exit remains onscreen during expansion');
 assert.ok(await page.locator('[data-panel-exit]').isEnabled());
 await collapse.waitFor();
 await collapse.click();await page.locator('[data-panel-expand]:enabled').waitFor();await page.locator('[data-panel-exit]').click();
 for(let i=0;i<80&&actions.at(-1)?.type!=='close';i++)await page.waitForTimeout(50);assert.equal(actions.at(-1).type,'close');assert.deepEqual(errors,[]);
 supported=false;mode='expanded';await page.reload();await page.locator('.web-mode-panel-header').waitFor();
 assert.equal(await collapse.count(),0);assert.equal((await page.locator('.web-mode-panel-header').boundingBox()).x,16);
 console.log('PASS panel UI',locale);await context.close();
}
console.log('Screenshots:',screenshots);
} finally {await browser.close();await server.close();}

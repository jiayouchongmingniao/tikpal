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
 let mode='expanded',failed=false,supported=true,failClose=false,slowOpen=false,resolveSlowOpen=null,slowReload=false,failReload=false,reloadFailureAfterActivation=false,activeProvider='netease_music',resolveReload=null,residentOverrides={};const actions=[];
 const resident=(id,inactiveStatus='ready')=>residentOverrides[id]??{status:slowOpen&&id==='spotify'?'opening':activeProvider===id?'active':inactiveStatus,activity:activeProvider===id?'active':'parked'};
 const state=()=>({activeProvider,openingProvider:slowOpen?'spotify':null,activationPhase:slowOpen?'pending':'ready',panelMode:mode,panelLayoutSupported:supported,panelSessionId:'s1',panelXSessionGeneration:'x1',providers:[],residentProviders:{netease_music:resident('netease_music'),spotify:resident('spotify'),...residentOverrides},settings:{providerTextScale:1.1,proxyEnabled:false},lastError:null,updatedAt:new Date().toISOString()});
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
   if(action.type==='reload'){if(slowReload)await new Promise(r=>{resolveReload=r;});if(failReload){if(reloadFailureAfterActivation)activeProvider='spotify';await route.fulfill({status:400,json:{error:'Reload failed'}});return;}}
   if(action.type==='close') {
    if(failClose){await new Promise(r=>setTimeout(r,1100));await route.fulfill({status:500,json:{error:'CLOSE_AUDIO_TIMEOUT'}});return;}
    if(slowOpen){slowOpen=false;resolveSlowOpen?.();resolveSlowOpen=null;}
    await route.fulfill({json:{...state(),activeProvider:null}});return;
   }
   if(action.type==='open'&&slowOpen){await new Promise(resolve=>{resolveSlowOpen=resolve;});}
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
 if(locale==='en'){
  const card=async id=>page.locator(`[data-web-mode-provider="${id}"]`).evaluate(el=>({status:el.dataset.webModeProviderStatus,label:el.querySelector('em')?.textContent,current:el.classList.contains('is-current'),failed:el.classList.contains('is-failed'),busy:el.getAttribute('aria-busy'),ariaCurrent:el.getAttribute('aria-current')}));
  assert.deepEqual(await card('netease_music'),{status:'current',label:'Current',current:true,failed:false,busy:'false',ariaCurrent:'true'});
  assert.deepEqual(await card('spotify'),{status:'ready',label:'Ready',current:false,failed:false,busy:'false',ariaCurrent:null});
  assert.equal((await card('suno')).status,'waiting');assert.equal((await card('suno')).label,'Waiting');
  residentOverrides={suno:{status:'prewarming',activity:'parked'},spotify:{status:'opening',activity:'parked'},tidal:{status:'ready',activity:'frozen'}};
  await page.reload();await collapse.waitFor();
  assert.deepEqual(await card('suno'),{status:'prewarming',label:'Prewarming',current:false,failed:false,busy:'true',ariaCurrent:null});
  assert.deepEqual(await card('spotify'),{status:'opening',label:'Opening',current:false,failed:false,busy:'true',ariaCurrent:null});
  assert.deepEqual(await card('tidal'),{status:'standby',label:'Standby',current:false,failed:false,busy:'false',ariaCurrent:null});
  residentOverrides={netease_music:{status:'check_setup',activity:'active'},suno:{status:'check_proxy',activity:'parked'},spotify:{status:'region_unavailable',activity:'parked'}};
  await page.reload();await collapse.waitFor();
  assert.deepEqual(await card('netease_music'),{status:'error',label:'Check setup',current:true,failed:true,busy:'false',ariaCurrent:'true'});
  assert.equal((await card('suno')).label,'Needs proxy');assert.equal((await card('spotify')).label,'Region unavailable');
  assert.equal((await page.locator('.web-mode-panel-footer').textContent()).trim(),'Check setup NetEase Cloud Music');
  residentOverrides={};await page.reload();await collapse.waitFor();
 }
 await page.screenshot({path:path.join(screenshots,`${locale}-expanded.png`)});
 const reload=page.locator('[data-provider-reload="spotify"]');
 assert.equal(await page.locator('[data-provider-reload]').count(),10);
 assert.ok(!(await reload.getAttribute('aria-label')).includes('explore.'));
 assert.ok(await reload.evaluate(el=>el.parentElement.tagName==='DIV'&&!el.parentElement.closest('button')));
 const overlaps=await page.locator('.web-mode-provider-card').evaluateAll(cards=>cards.some(card=>{
   const reload=card.querySelector('[data-provider-reload]').getBoundingClientRect();
   return [...card.querySelectorAll('strong,em')].some(el=>el.getBoundingClientRect().right>reload.left);
 }));assert.equal(overlaps,false,`${locale} reload overlaps text`);
 let before=actions.length;await reload.click();await page.locator('[data-provider-reload="spotify"]:enabled').waitFor();
 assert.deepEqual(actions.slice(before).map(a=>a.type),['reload'],'reload must not also open provider');
 failReload=true;await reload.click();await page.locator('[data-provider-reload="spotify"]:enabled').waitFor();
 assert.ok(await page.locator('[data-web-mode-provider="spotify"]').evaluate(el=>el.classList.contains('is-failed')));
 if(locale==='en')assert.match(await page.locator('[data-web-mode-provider="spotify"]').getAttribute('aria-label'),/Reload failed\. Retry\./);
 failReload=false;await reload.click();await page.locator('[data-provider-reload="spotify"]:enabled').waitFor();
 failReload=true;reloadFailureAfterActivation=true;await reload.click();await page.locator('[data-provider-reload="spotify"]:enabled').waitFor();
 assert.equal(await page.locator('[data-web-mode-provider="spotify"]').evaluate(el=>el.classList.contains('is-failed')),false,'a confirmed active provider clears stale reload failure');
 failReload=false;reloadFailureAfterActivation=false;activeProvider='netease_music';
 if(locale==='en'){
   slowReload=true;before=actions.length;await reload.click();
   await page.locator('[data-provider-reload="spotify"][aria-busy="true"]').waitFor();
   assert.equal(await page.locator('[data-web-mode-provider="spotify"]').getAttribute('aria-busy'),'true');
   assert.ok(await reload.isDisabled());
   assert.ok(await page.locator('[data-web-mode-provider="tidal"]').isDisabled());
   const exit=page.locator('[data-web-mode-top-back]');assert.ok(await exit.isEnabled());
   await exit.click();await page.waitForTimeout(100);
   assert.deepEqual(actions.slice(before).map(a=>a.type),['reload','close']);
   resolveReload();slowReload=false;await page.waitForTimeout(100);
   assert.equal(await reload.getAttribute('aria-busy'),'false','late reload response stays cancelled');
 }

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
 await collapse.click();await page.locator('[data-panel-expand]:enabled').waitFor();if(locale==='en') {
  failClose=true;const before=actions.filter(a=>a.type==='close').length;const started=Date.now();
  await page.locator('[data-panel-exit]').evaluate(e=>{e.click();e.click();});
  for(let i=0;i<30&&actions.filter(a=>a.type==='close').length===before;i++)await page.waitForTimeout(10);
  assert.ok(Date.now()-started<300,'no main window/cover acknowledgement is required');
  assert.equal(actions.filter(a=>a.type==='close').length,before+1,'duplicate clicks suppressed');
  await page.locator('[data-panel-exit]:enabled').waitFor();
  assert.ok(await page.locator('[data-panel-rail-error]').count());failClose=false;
 }
 await page.locator('[data-panel-exit]').click();
 for(let i=0;i<80&&actions.at(-1)?.type!=='close';i++)await page.waitForTimeout(50);assert.equal(actions.at(-1).type,'close');assert.deepEqual(errors,[]);
 if(locale==='en') {
  await page.locator('[data-panel-expand]').click();await page.locator('[data-web-mode-provider="spotify"]').waitFor();
  slowOpen=true;const opensBefore=actions.filter(a=>a.type==='open').length,closesBefore=actions.filter(a=>a.type==='close').length;
  await page.locator('[data-web-mode-provider="spotify"]').click();
  await page.locator('[data-web-mode-provider="spotify"][data-web-mode-provider-status="opening"]').waitFor();
  assert.equal(await page.locator('[data-web-mode-provider="netease_music"] em').textContent(),'Current','previous foreground stays Current while the target opens');
  assert.equal(await page.locator('[data-web-mode-provider="spotify"]').getAttribute('aria-current'),null,'Opening target is not announced as Current');
  const exitDuringOpen=page.locator('[data-web-mode-top-back]');await exitDuringOpen.waitFor({state:'visible'});assert.ok(await exitDuringOpen.isEnabled(),'exit stays enabled while opening');
  await exitDuringOpen.click();
  for(let i=0;i<40&&actions.filter(a=>a.type==='close').length===closesBefore;i++)await page.waitForTimeout(25);
  assert.equal(actions.filter(a=>a.type==='open').length,opensBefore+1);
  assert.equal(actions.filter(a=>a.type==='close').length,closesBefore+1,'exit cancels an in-flight provider open');
  await page.locator('[data-web-mode-top-back]:enabled').waitFor();
 }
 supported=false;mode='expanded';await page.reload();await page.locator('.web-mode-panel-header').waitFor();
 assert.equal(await collapse.count(),0);assert.equal((await page.locator('.web-mode-panel-header').boundingBox()).x,16);
 console.log('PASS panel UI',locale);await context.close();
}
console.log('Screenshots:',screenshots);
} finally {await browser.close();await server.close();}

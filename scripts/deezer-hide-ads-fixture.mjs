import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const base=new URL('../deploy/chromium/web-mode-extension/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.json',base),'utf8'));
const rule=manifest.content_scripts.find(s=>s.css?.includes('deezer-hide-ads.css'));
assert.deepEqual(rule.matches,['https://deezer.com/*','https://*.deezer.com/*']);
assert.equal(rule.js,undefined,'static CSS needs no runtime script');
const css=await readFile(new URL('deezer-hide-ads.css',base),'utf8');
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();
 await page.setContent('<div id="adslot1" class="ads ads-top">ad</div><a id="companion_banner">ad</a><button id="player">play</button><nav>navigation</nav><div id="modal">login</div><div class="modal-backdrop">backdrop</div><div id="cookie-banner-deezer">cookies</div><div role="alert">error</div>');
 await page.addStyleTag({content:css});
 for(const id of ['adslot1','companion_banner'])assert.equal(await page.locator('#'+id).isVisible(),false);
 for(const selector of ['#player','nav','#modal','.modal-backdrop','#cookie-banner-deezer','[role=alert]'])assert.equal(await page.locator(selector).isVisible(),true,selector);
 await page.evaluate(()=>{document.querySelector('#adslot1').remove();const e=document.createElement('div');e.id='adslot1';e.className='ads ads-top';e.textContent='dynamic ad';document.body.append(e)});
 assert.equal(await page.locator('#adslot1').isVisible(),false,'dynamic insertion');
 await page.evaluate(()=>document.querySelector('#adslot1').className='music-card');
 assert.equal(await page.locator('#adslot1').isVisible(),true,'require confirmed slot class');
 await page.locator('#player').click();
 const guard=await readFile(new URL('../deploy/chromium/tikpal-web-mode-guard.mjs',import.meta.url),'utf8');
 const literal=guard.match(/const deezerPremiumDismissExpression = (`[\s\S]*?`);/)[1];
 const expression=vm.runInNewContext(literal);
 await page.route('https://www.deezer.com/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));
 await page.goto('https://www.deezer.com/');
 const offer='<section role="dialog" aria-modal="true"><h2 data-testid="premium_offer_title">Try Premium</h2><a data-testid="premium_offer_primary_cta">Try free</a><button class="chakra-modal__close-btn" aria-label="Close">X</button></section>';
 for(let i=0;i<2;i++){
  await page.setContent(offer);
  await page.evaluate(()=>document.querySelector('button').onclick=()=>document.querySelector('section').remove());
  assert.equal((await page.evaluate(expression)).clicked,true);
  assert.equal(await page.locator('[role=dialog]').count(),0);
 }
 await page.setContent(offer.replace('premium_offer_title','login_title'));
 assert.equal((await page.evaluate(expression)).clicked,false,'login dialog preserved');
 await page.setContent(offer.replace('premium_offer_primary_cta','error_action'));
 assert.equal((await page.evaluate(expression)).clicked,false,'incomplete offer preserved');
 await page.setContent(offer.replace('<section','<section style="display:none"'));
 assert.equal((await page.evaluate(expression)).clicked,false,'hidden dialog preserved');
 console.log('[deezer-hide-ads-fixture] passed');
} finally {await browser.close()}

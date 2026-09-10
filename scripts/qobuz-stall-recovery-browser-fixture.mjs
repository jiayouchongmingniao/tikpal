import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const source=await readFile(new URL('../deploy/chromium/web-mode-extension/provider-audio-gate.js',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
try {
 const page=await browser.newPage();await page.addInitScript({content:source});
 await page.route('https://play.qobuz.com/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Qobuz recovery fixture</title>'}));
 const wav=Buffer.alloc(44+16000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(16000,40);
 let requests=0;await page.route('**/fixture.wav',r=>{requests++;if(requests===1)return;return r.fulfill({contentType:'audio/wav',body:wav})});
 await page.goto('https://play.qobuz.com/');
 await page.evaluate(()=>{window.__tikpalProviderAudioGate.setActive(true);window.audio=new Audio('/fixture.wav');audio.play().catch(()=>{});});
 await page.waitForFunction(()=>audio.readyState>=2,{},{timeout:22000});
 assert.equal(requests,2,'one stalled request plus one retry');
 console.log('[qobuz-stall-recovery-browser-fixture] passed: one real stalled request recovered');
} finally {await browser.close()}

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const source = await readFile(new URL('../deploy/chromium/web-mode-extension/provider-audio-gate.js', import.meta.url), 'utf8');
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage();
  await page.goto('about:blank');
  await page.evaluate(source);
  const result = await page.evaluate(async () => {
    const gate = window.__tikpalProviderAudioGate;
    const media = new Audio(); document.body.append(media);
    gate.setActive(true);
    let events = 0;
    media.addEventListener('volumechange', () => events++);
    media.volume = 0.2;
    await new Promise(r => setTimeout(r, 100));
    const foreground = media.volume;
    gate.setActive(false);
    media.volume = 0;
    await new Promise(r => setTimeout(r, 100));
    const background = {volume:media.volume, muted:media.muted};
    gate.setActive(true);
    await new Promise(r => setTimeout(r, 100));
    return {foreground, background, resumed:media.volume, events};
  });
  assert.equal(result.foreground, 1);
  assert.deepEqual(result.background, {volume:0,muted:true});
  assert.equal(result.resumed, 1);
  assert.ok(result.events < 15, 'volume enforcement must settle without an event loop');
  console.log('[provider-volume-browser-fixture] passed', result);
} finally { await browser.close(); }

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const source = await readFile(new URL('../deploy/chromium/web-mode-extension/tidal-dismiss-upsell.js', import.meta.url), 'utf8');
const browser = await chromium.launch({headless:true});
try {
  for (const host of ['tidal.com', 'listen.tidal.com', 'example.com']) {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({contentType:'text/html',body:`<dialog id="UPSELL"><button data-test="dialog-close" aria-label="Close">x</button><section data-test="dialog-upsell"><button data-test="continue-button">View plans</button></section></dialog>`}));
    await page.goto(`https://${host}`);
    await page.evaluate(() => {
      window.closeCount = 0; window.planCount = 0;
      document.querySelector('[data-test="dialog-close"]').onclick = () => { window.closeCount++; document.querySelector('dialog').close(); };
      document.querySelector('[data-test="continue-button"]').onclick = () => window.planCount++;
    });
    await page.evaluate(source);
    for (let round = 0; round < 2; round++) {
      await page.evaluate(() => document.querySelector('dialog').showModal());
      await page.waitForTimeout(150);
    }
    assert.equal(await page.evaluate(() => window.closeCount), host === 'example.com' ? 0 : 2);
    assert.equal(await page.evaluate(() => window.planCount), 0);
    await page.evaluate(() => { document.querySelector('[data-test="continue-button"]').textContent = 'Confirm payment'; document.querySelector('dialog').showModal(); });
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => document.querySelector('dialog').open), true, 'other dialogs must remain open');
    await page.close();
  }
  console.log('[tidal-dismiss-upsell-fixture] passed');
} finally { await browser.close(); }

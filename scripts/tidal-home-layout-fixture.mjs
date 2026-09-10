import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = new URL('../deploy/chromium/web-mode-extension/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
const rule = manifest.content_scripts.find(entry => entry.css?.includes('tidal-home-layout.css'));
assert.deepEqual(rule.matches, ['https://tidal.com/*', 'https://*.tidal.com/*']);
assert.equal(rule.run_at, 'document_start');
assert.equal(rule.js, undefined);
const css = await readFile(new URL('tidal-home-layout.css', base), 'utf8');
// Observed TIDAL feed declarations, including its fixed 1500px page width.
const siteCss = `
  body { margin: 0; --pageWidth: 1500px; --resonancePageMaxWidth: 2303.68px; --sidebarWidth: 240px; }
  nav { position: fixed; width: 240px; height: 100vh; }
  main { margin-left: 240px; }
  .feed { box-sizing: content-box; gap: 32px;
    max-width: calc(var(--resonancePageMaxWidth) - var(--sidebarWidth) - var(--playQueueWidth, 0px));
    padding: 20px; width: var(--pageWidth); flex-direction: column;
    margin-left: auto; margin-right: auto; display: flex; }
  .cards { display: flex; gap: 12px; overflow-x: auto; }
  img { width: 180px; height: 180px; flex-shrink: 0; object-fit: cover; }
  footer { position: fixed; bottom: 0; width: 100%; height: 80px; }
  @media (max-width: 900px) {
    .feed { max-width: calc(100% - 32px); padding: 16px; }
  }
`;
const home = `<div class="feed" data-test="home-page-feed"><h2>Custom mixes</h2><div class="cards">${'<img alt="Cover" src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'180\' height=\'180\'/%3E">'.repeat(8)}</div></div>`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 2504, height: 720 } });
  await page.setContent(`<style>${siteCss}</style><nav>Navigation</nav><main>${home}</main><footer>Player</footer>`);
  const before = await page.locator('.feed').boundingBox();
  assert.equal(before.width, 1540);
  assert.equal(before.x, 602, 'reproduces 362px empty margin beside the sidebar');
  await page.addStyleTag({ content: css });
  // Later site styles must not restore the fixed width.
  await page.addStyleTag({ content: siteCss });
  for (const width of [1920, 2504, 800, 2504, 1920]) {
    await page.setViewportSize({ width, height: 720 });
    const geometry = await page.evaluate(() => {
      const feed = document.querySelector('.feed'), cards = document.querySelector('.cards');
      const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, width: r.width, height: r.height }; };
      return { feed: rect(feed), main: rect(document.querySelector('main')), nav: rect(document.querySelector('nav')),
        footer: rect(document.querySelector('footer')), padding: getComputedStyle(feed).paddingLeft,
        covers: [...document.querySelectorAll('img')].map(rect), overflow: document.documentElement.scrollWidth,
        carousel: { client: cards.clientWidth, scroll: cards.scrollWidth } };
    });
    assert.equal(geometry.feed.x, geometry.main.x);
    assert.equal(geometry.feed.width, geometry.main.width);
    assert.equal(geometry.padding, width <= 900 ? '16px' : '20px');
    assert.equal(geometry.nav.width, 240);
    assert.equal(geometry.footer.width, width);
    assert.equal(geometry.overflow, width);
    assert.ok(geometry.covers.every(cover => cover.width === 180 && cover.height === 180));
    if (width === 800) assert.ok(geometry.carousel.scroll > geometry.carousel.client);
  }
  // A route without the stable home marker retains the site's layout.
  await page.locator('main').evaluate(el => { el.innerHTML = '<div class="feed" data-test="album-page">Album</div>'; });
  assert.equal((await page.locator('.feed').boundingBox()).width, 1540);
  await page.locator('main').evaluate((el, html) => { el.innerHTML = html; }, home);
  assert.equal((await page.locator('.feed').boundingBox()).width, 1680, 'SPA home remount adapts without script');
  await page.addStyleTag({ content: `
    [data-type="page"] { --pageHorizontalMargin: 28px; --pageBottomMargin: 48px; --pageMaxWidth: calc(1500px - 28px); }
    .module { box-sizing: content-box; max-width: var(--pageMaxWidth); padding: 0 var(--pageHorizontalMargin);
      width: calc(100% - var(--pageBottomMargin) * 2); margin: 0 auto var(--pageBottomMargin); }
    .module .cover { width: 240px; height: 240px; }
    .sticky { box-sizing: border-box; position: fixed; left: var(--sidebarWidth); top: 0;
      width: calc(100vw - var(--sidebarWidth) - var(--playQueueWidth, 0px));
      padding: 80px max(var(--pageHorizontalMargin), calc((100vw - var(--resonancePageMaxWidth)) / 2),
        calc((100vw - var(--sidebarWidth) - var(--playQueueWidth, 0px) - var(--pageWidth)) / 2)) 24px; }
    table { width: 100%; table-layout: fixed; }
  ` });
  for (const header of ['ALBUM_HEADER', 'MIX_HEADER', 'ARTIST_HEADER']) {
    const items = header === 'ALBUM_HEADER' ? 'ALBUM_ITEMS' : 'TRACK_LIST';
    await page.locator('main').evaluate((el, { header, items }) => { el.innerHTML = `<div data-type="page">
      <div class="module" data-test-module-type="${header}"><img class="cover" alt="Cover"><h1>Title</h1><div class="sticky">Title</div></div>
      <div class="module" data-test-module-type="${items}"><table><tr><td>Track title</td><td>Artist</td><td>Duration</td></tr></table></div>
    </div>`; }, { header, items });
    for (const width of [2504, 1920, 800]) {
      await page.setViewportSize({ width, height: 720 });
      const box = await page.locator('.module').first().boundingBox();
      if (header === 'ARTIST_HEADER') {
        if (width === 2504) assert.equal(box.width, 1528, 'unrelated page retains original cap');
        continue;
      }
      assert.equal(box.x, 240);
      assert.equal(box.width, width - 240);
      assert.equal((await page.locator('table').boundingBox()).width, width - 240 - 56);
      assert.equal(await page.locator('.sticky').evaluate(el => getComputedStyle(el).paddingLeft), '28px');
      assert.equal(await page.locator('.module').first().evaluate(el => getComputedStyle(el).marginBottom), '48px');
      assert.equal((await page.locator('.cover').boundingBox()).width, 240);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    }
  }
  console.log('[tidal-home-layout-fixture] home, album, Mix, sticky header, resize, padding, covers and route scope passed');
} finally {
  await browser.close();
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const source = await readFile(process.argv[2] || new URL("../deploy/chromium/web-mode-extension/content.js", import.meta.url), "utf8");
const browser = await chromium.launch({ headless: true });
try {
  for (const host of ["open.spotify.com", "music.apple.com"]) {
    const page = await browser.newPage();
    await page.route("**/*", (route) => route.fulfill({ contentType: "text/html", body: `<style>p {font-size:16px}</style><button id="play">Play</button><button id="reload">Reload page</button>${"<p>Provider text</p>".repeat(250)}<section style="content-visibility:auto;contain-intrinsic-size:500px;margin-top:100000px"><p id="deferred">Deferred text</p></section>` }));
    await page.goto(`https://${host}/`);
    await page.evaluate(() => {
      window.fixtureSettings = { ok: true, providerTextScale: 1.1, fontTheme: "serif", proxyKey: "same" };
      window.fixtureTicks = [];
      window.setInterval = (fn) => { window.fixtureTicks.push(fn); return 1; };
      window.chrome = { runtime: { sendMessage: (_message, callback) => callback(window.fixtureSettings), onMessage: { addListener() {} } } };
      Object.defineProperty(document.querySelector("#play"), "innerText", { get() { throw new Error("ordinary button must not require a layout text read"); } });
      window.fixtureReloadClicks = 0;
      document.querySelector("#reload").onclick = () => { window.fixtureReloadClicks += 1; };
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const layouts = async () => (await cdp.send("Performance.getMetrics")).metrics.find((item) => item.name === "LayoutCount").value;
    const before = await layouts();
    await page.addScriptTag({ content: source });
    await page.waitForFunction(() => document.querySelector("p").dataset.tikpalFontThemeApplied === "1");
    assert.equal(await page.evaluate(() => window.fixtureReloadClicks), host === "open.spotify.com" ? 1 : 0, "Reload page automation must remain Spotify-only");
    const count = await layouts() - before;
    assert(count < 20, `text styling must batch layout reads before writes, got ${count} layouts`);
    assert.equal(await page.locator("p").first().evaluate((el) => getComputedStyle(el).fontSize), "17.6px");
    assert.equal(await page.locator("#deferred").evaluate((el) => el.dataset.tikpalTextScaleBaseFontSize), undefined, "deferred subtrees must remain unstyled until rendered");
    await page.evaluate(() => {
      window.fixtureStyleWrites = 0;
      new MutationObserver((records) => { window.fixtureStyleWrites += records.length; }).observe(document.head, { childList: true, subtree: true, characterData: true });
      window.fixtureTicks.forEach((tick) => tick());
    });
    await page.waitForTimeout(30);
    assert.equal(await page.evaluate(() => window.fixtureStyleWrites), 0, "unchanged settings must not rewrite stylesheets");
    await page.evaluate(() => {
      window.fixtureSettings.providerTextScale = 1;
      window.fixtureTicks.forEach((tick) => tick());
    });
    await page.waitForFunction(() => getComputedStyle(document.querySelector("p")).fontSize === "16px");
    assert.equal(await page.locator("p").first().evaluate((el) => el.dataset.tikpalTextScaleBaseFontSize), undefined);
    await page.locator("#deferred").scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector("#deferred").checkVisibility({ contentVisibilityAuto: true }));
    await page.evaluate(() => {
      window.fixtureSettings.providerTextScale = 1.2;
      window.fixtureSettings.fontTheme = "mono";
      window.fixtureTicks.forEach((tick) => tick());
    });
    await page.waitForFunction(() => document.querySelector("#deferred").dataset.tikpalFontThemeApplied === "1");
    assert.equal(await page.locator("#deferred").evaluate((el) => getComputedStyle(el).fontSize), "19.2px");
    console.log(`Provider text style fixture passed for ${host} (${count} layouts for 250 text elements)`);
    await page.close();
  }
} finally {
  await browser.close();
}

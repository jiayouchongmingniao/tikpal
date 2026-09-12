import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const base = new URL("../deploy/chromium/web-mode-extension/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", base), "utf8"));
const css = await readFile(new URL("apple-hide-external-ctas.css", base), "utf8");
const source = await readFile(new URL("apple-external-app-guard.js", base), "utf8");
const cssRule = manifest.content_scripts.find((entry) => entry.css?.includes("apple-hide-external-ctas.css"));
const guardRule = manifest.content_scripts.find((entry) => entry.js?.includes("apple-external-app-guard.js"));

assert.deepEqual(cssRule.matches, ["https://music.apple.com/*"]);
assert.equal(cssRule.run_at, "document_start");
assert.deepEqual(guardRule.matches, ["https://music.apple.com/*"]);
assert.equal(guardRule.run_at, "document_start");
assert.equal(guardRule.world, "MAIN");

const studentLabels = [
  "查看学生方案",
  "See student plans",
  "学生プランを見る",
  "학생 요금제 보기",
  "Voir les offres étudiantes",
  "Studententarife ansehen",
  "Ver planes para estudiantes"
];
const studentCtas = studentLabels.map((label, index) =>
  `<cwc-link-with-chevron id="student-${index}" data-test="upsell-personal-student">${label}</cwc-link-with-chevron>`
).join("");
const pageHtml = `<!doctype html>
  <button id="play">Play</button>
  <button id="login">Sign in</button>
  <a id="search" href="/cn/search">Search</a>
  <div data-testid="native-cta"><button id="native" data-testid="native-cta-button">Open in Music</button></div>
  <cwc-upsell-personal><button id="trial" data-test="upsell-personal-cta">Start</button></cwc-upsell-personal>
  ${studentCtas}
  <cwc-upsell-banner data-test="upsell-banner"><cwc-button data-test="cta-button"><button id="banner-trial">Start free trial</button></cwc-button></cwc-upsell-banner>
  <script>
    window.nativeActivations = 0;
    window.trialActivations = 0;
    window.studentActivations = 0;
    window.bannerActivations = 0;
    window.plays = 0;
    window.logins = 0;
    window.searches = 0;
    document.querySelector('#native').onclick = () => window.nativeActivations++;
    document.querySelector('#trial').onclick = () => window.trialActivations++;
    document.querySelectorAll('[data-test="upsell-personal-student"]').forEach((element) => { element.onclick = () => window.studentActivations++; });
    document.querySelector('#banner-trial').onclick = () => window.bannerActivations++;
    document.querySelector('#play').onclick = () => window.plays++;
    document.querySelector('#login').onclick = () => window.logins++;
    document.querySelector('#search').onclick = (event) => { event.preventDefault(); window.searches++; };
  </script>`;

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ hasTouch: true });
  await context.addInitScript({ content: source });
  const pageWithDocumentStartCss = pageHtml.replace("<!doctype html>", `<!doctype html><style>${css}</style>`);
  await context.route("**/*", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: pageWithDocumentStartCss }));
  const page = await context.newPage();
  await page.goto("https://music.apple.com/cn/home");

  assert.equal(await page.evaluate(() => window.__tikpalAppleExternalAppGuard), "1");
  for (const selector of [
    "[data-testid='native-cta']",
    "[data-testid='native-cta-button']",
    "[data-test='upsell-personal-cta']",
    "[data-test='upsell-personal-student']",
    "[data-test='upsell-banner']"
  ]) {
    const elements = page.locator(selector);
    for (let index = 0; index < await elements.count(); index += 1) {
      assert.equal(await elements.nth(index).evaluate((element) => getComputedStyle(element).display), "none", `${selector} should be hidden`);
    }
  }
  assert.deepEqual(
    await page.locator("[data-test='upsell-personal-student']").allTextContents(),
    studentLabels,
    "the locale-neutral student selector should cover every supported label"
  );
  for (const selector of ["#play", "#login", "#search"]) {
    assert.equal(await page.locator(selector).isVisible(), true, `${selector} should remain visible`);
  }

  await page.evaluate(() => {
    const dynamic = document.createElement("button");
    dynamic.id = "dynamic-trial";
    dynamic.setAttribute("data-test", "upsell-personal-cta");
    dynamic.onclick = () => window.trialActivations++;
    document.body.append(dynamic);
    const student = document.createElement("cwc-link-with-chevron");
    student.id = "dynamic-student";
    student.setAttribute("data-test", "upsell-personal-student");
    student.textContent = "Ver planes para estudiantes";
    student.onclick = () => window.studentActivations++;
    document.body.append(student);
    const banner = document.createElement("cwc-upsell-banner");
    banner.setAttribute("data-test", "upsell-banner");
    banner.innerHTML = '<cwc-button data-test="cta-button"><button id="dynamic-banner-trial">Start free trial</button></cwc-button>';
    banner.querySelector("button").onclick = () => window.bannerActivations++;
    document.body.append(banner);
  });
  assert.equal(await page.locator("#dynamic-trial").evaluate((element) => getComputedStyle(element).display), "none", "dynamic trial CTA should be hidden");
  assert.equal(await page.locator("#dynamic-student").evaluate((element) => getComputedStyle(element).display), "none", "dynamic student CTA should be hidden");
  assert.equal(
    await page.locator("#dynamic-banner-trial").evaluate((element) => getComputedStyle(element.closest("[data-test='upsell-banner']")).display),
    "none",
    "the whole dynamic trial banner should be hidden"
  );

  await page.evaluate(() => {
    const activate = (element) => {
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true }));
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, composed: true }));
      element.dispatchEvent(new Event("touchstart", { bubbles: true, cancelable: true, composed: true }));
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, composed: true }));
      element.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true, cancelable: true, composed: true }));
      element.click();
    };
    activate(document.querySelector("#native"));
    activate(document.querySelector("#trial"));
    activate(document.querySelector("#dynamic-trial"));
    activate(document.querySelector("#student-0"));
    activate(document.querySelector("#dynamic-student"));
    activate(document.querySelector("#banner-trial"));
    activate(document.querySelector("#dynamic-banner-trial"));
  });
  assert.deepEqual(
    await page.evaluate(() => [window.nativeActivations, window.trialActivations, window.studentActivations, window.bannerActivations]),
    [0, 0, 0, 0],
    "native, trial, student and banner activations should be intercepted"
  );

  await page.locator("#play").click();
  await page.locator("#login").tap();
  await page.locator("#search").click();
  assert.deepEqual(await page.evaluate(() => [window.plays, window.logins, window.searches]), [1, 1, 1], "normal player, login and site navigation controls should remain usable");

  const other = await context.newPage();
  await other.goto("https://example.com/");
  await other.setContent('<button id="trial" data-test="upsell-personal-cta" onclick="window.activations = (window.activations || 0) + 1">Start</button><button id="student" data-test="upsell-personal-student" onclick="window.activations = (window.activations || 0) + 1">Student</button>');
  await other.locator("#trial").click();
  await other.locator("#student").click();
  assert.equal(await other.evaluate(() => window.activations), 2, "non-Apple providers should be unchanged");
  await other.close();
  console.log("[apple-external-app-guard-fixture] passed: seven-locale student CTA and static/dynamic native, trial and banner CTA hiding; mouse/touch/keyboard/programmatic interception; normal Apple controls and non-Apple isolation");
} finally {
  await browser.close();
}

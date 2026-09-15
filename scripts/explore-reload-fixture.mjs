import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = mkdtempSync(path.join(tmpdir(), 'tikpal-reload-'));
const source = readFileSync(new URL('../deploy/chromium/tikpal-web-mode.sh', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('runtime_reload_session_is_current() {'), source.indexOf('wait_for_entry_provider_paint() {'));
const statePath = path.join(root, 'state.json'), generationPath = path.join(root, 'generation');
const current = { activeProvider: 'spotify', lastOpenedRequestId: 's1', lastOpenedXSessionGeneration: 'x1' };
writeFileSync(statePath, JSON.stringify(current));writeFileSync(generationPath, 'x1');
const server = createServer();await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;await new Promise(r => server.close(r));
const browser = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });
function shell(script, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', `${functions}\n${script}`], { env: { ...process.env,
      TIKPAL_WEB_MODE_STATE_PATH: statePath, TIKPAL_KIOSK_X_SESSION_GENERATION_PATH: generationPath,
      TIKPAL_RELOAD_SESSION_ID: 's1', TIKPAL_RELOAD_X_SESSION_GENERATION: 'x1', TIKPAL_RELOAD_CHECK: '1', ...env
    } });
    let output = '';child.stdout.on('data', c => output += c);child.stderr.on('data', c => output += c);
    child.on('error', reject);child.on('close', code => resolve({ code, output }));
  });
}
try {
  const page = await browser.newPage();
  await page.route('https://reload.test/**', route => route.fulfill({ contentType: 'text/html', body: '<main>Provider page</main><button>Play</button><button>Albums</button><button>Sign in</button>' }));
  await page.goto('https://reload.test/album');
  await page.evaluate(() => { window.__tikpalReloadPending = true; });
  let result = await shell(`wait_for_provider_ready ${port} spotify 1`);
  assert.equal(result.code, 1, 'old document must not satisfy reload readiness');
  await page.reload();
  result = await shell(`wait_for_provider_ready ${port} spotify 3`);
  assert.equal(result.code, 0, result.output);
  await page.evaluate(() => { window.__tikpalReloadPending = true; });
  const pending = shell(`wait_for_provider_ready ${port} spotify 5`);
  await new Promise(r => setTimeout(r, 300));
  writeFileSync(statePath, JSON.stringify({ ...current, activeProvider: null, closeRequestId: 'close-1' }));
  result = await pending;assert.equal(result.code, 1, 'close cancels readiness');
  result = await shell(`provider_debug_port() { echo ${port}; }
reload_provider_document spotify`);
  assert.notEqual(result.code, 0, 'closed session cannot reload');
  writeFileSync(statePath, JSON.stringify(current));writeFileSync(generationPath, 'x2');
  result = await shell('runtime_reload_session_is_current spotify');
  assert.equal(result.code, 1, 'old desktop generation cannot reload');
  writeFileSync(generationPath, 'x1');
  const mocks = `
provider_debug_port() { echo ${port}; }
provider_cdp_command() { echo "cdp:$2:$3"; }
provider_has_real_provider_page() { return 0; }
provider_friendly_error_reason() { :; }
provider_url() { echo https://open.spotify.com/; }
navigate_provider_target_foreground() { echo "navigate:$2"; }
`;
  result = await shell(`${mocks}\nreload_provider_document spotify`);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Page.reload:\{"ignoreCache":false\}/);
  assert.ok(!result.output.includes('navigate:'), 'normal reload preserves current location');
  result = await shell(`${mocks}\nprovider_friendly_error_reason() { echo load_failed; }\nreload_provider_document spotify`);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /navigate:https:\/\/open.spotify.com\//);
  assert.ok(!result.output.includes('Page.reload'), 'local error page retries provider URL');
  await page.close();
  const sunoContext = await browser.newContext();
  await sunoContext.addInitScript(() => {
    Object.defineProperty(Document.prototype, 'readyState', { configurable: true, get: () => 'interactive' });
  });
  const sunoPage = await sunoContext.newPage();
  await sunoPage.route('https://suno.test/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<main>Suno Explore generated music library and discovery feed</main><nav>Explore</nav><button>Play</button><button>Create</button><button>Library</button>'
  }));
  await sunoPage.goto('https://suno.test/explore', { waitUntil: 'domcontentloaded' });
  for (const provider of ['suno', 'spotify']) {
    result = await shell(`wait_for_provider_ready ${port} ${provider} 1`, { TIKPAL_RELOAD_CHECK: '0' });
    assert.equal(result.code, 0, `${provider} interactive page with visible controls should be ready`);
  }
  await sunoContext.close();
  const loadingPage = await browser.newPage();
  await loadingPage.route('https://loading.test/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<main>Visible but still loading</main><button>Play</button><button>Create</button><button>Library</button>'
  }));
  await loadingPage.goto('https://loading.test/explore');
  await loadingPage.evaluate(() => Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'loading' }));
  result = await shell(`wait_for_provider_ready ${port} spotify 1`, { TIKPAL_RELOAD_CHECK: '0' });
  assert.equal(result.code, 1, 'loading document must not be ready even with visible controls');
  await loadingPage.close();
  console.log('PASS reload document readiness, interactive provider readiness, error-page recovery, close and session fencing');
} finally { await browser.close();rmSync(root, { recursive: true, force: true }); }

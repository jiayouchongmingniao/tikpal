import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const source = fs.readFileSync(new URL('../deploy/chromium/deezer-preview-recovery.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route('https://www.deezer.com/**', route => route.fulfill({ contentType: 'text/html', body: '<html lang="en"><body><button id="music">Music</button><audio data-testid="jinglePlayer"></audio></body></html>' }));
  const setup = async () => {
    await page.goto('https://www.deezer.com/');
    await page.clock.install({ time: new Date('2026-09-12T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-09-12T00:00:01Z'));
    await page.evaluate(() => {
      const element = document.querySelector('audio');
      Object.defineProperty(element, 'paused', { configurable: true, value: false });
      window.__tikpalProviderAudioGate = { status: () => ({ active: true, playingCount: 1 }) };
      window.dzPlayer = { playing: false, paused: false, loading: false, getPlayerType: () => 'triton_ads' };
    });
    await page.evaluate(source);
    await page.evaluate(() => document.querySelector('audio').dispatchEvent(new Event('play')));
  };
  await setup();
  await page.clock.fastForward(19999);
  assert.equal(await page.locator('#tikpal-deezer-startup-notice').count(), 0);
  await page.clock.fastForward(1);
  assert.equal(await page.getByRole('button', { name: 'Reload Deezer' }).count(), 1);
  if (process.env.TIKPAL_FIXTURE_SCREENSHOT) await page.screenshot({path: process.env.TIKPAL_FIXTURE_SCREENSHOT});
  const box = await page.getByRole('button', { name: 'Reload Deezer' }).boundingBox();
  assert.ok(box.height >= 48);
  assert.equal(await page.locator('#music').isEnabled(), true);
  // No automatic reload or fake playback/ad completion, even after a long wait.
  await page.evaluate(() => window.fixtureDocument = true);
  await page.clock.fastForward(120000);
  assert.equal(await page.evaluate(() => window.fixtureDocument), true);
  assert.equal(await page.evaluate(() => dzPlayer.playing), false);
  await Promise.all([page.waitForEvent('domcontentloaded'), page.getByRole('button', { name: 'Reload Deezer' }).click()]);
  assert.equal(await page.evaluate(() => window.fixtureDocument), undefined);
  for (const change of [
    () => { dzPlayer.playing = true; },
    () => { dzPlayer.paused = true; },
    () => { dzPlayer.getPlayerType = () => 'track'; },
    () => { document.querySelector('audio').src = 'https://example.test/ad.mp3'; },
    () => { document.querySelector('audio').remove(); },
    () => { __tikpalProviderAudioGate.status = () => ({active: false}); __tikpalDeezerPreviewRecovery.setActive(false); }
  ]) {
    await setup(); await page.evaluate(change); await page.clock.fastForward(20000);
    assert.equal(await page.locator('#tikpal-deezer-startup-notice').count(), 0);
  }
  await setup(); await page.clock.fastForward(20000);
  await page.evaluate(() => document.querySelector('audio').remove());
  assert.equal(await page.locator('#tikpal-deezer-startup-notice').count(), 0, 'remove notice after the bootstrap finishes');
  await setup(); await page.clock.fastForward(20000);
  await page.evaluate(() => { __tikpalProviderAudioGate.status = () => ({active: false}); });
  await page.getByRole('button', {name: 'Reload Deezer'}).click();
  assert.equal(await page.evaluate(() => !!window.__tikpalDeezerPreviewRecovery), true, 'late click cannot reload an inactive provider');
  // A ready-but-paused next track may never emit a native ended event.
  for (const scenario of ['stalled', 'manual-pause', 'inactive', 'playing-media', 'duplicate']) {
    await page.goto('https://www.deezer.com/');
    await page.clock.install({time:new Date('2026-09-12T00:00:00Z')});
    await page.clock.pauseAt(new Date('2026-09-12T00:00:01Z'));
    await page.evaluate(() => {
      sessionStorage.clear();
      document.body.innerHTML = '<div id="page_player"><a href="/track/first">Track</a><button data-testid="play_button_play">Play</button></div>';
      window.fixturePlays=0; window.fixtureId='first';
      window.__tikpalProviderAudioGate={status:()=>({active:true,playingCount:0})};
      window.dzPlayer={playing:true,paused:false,loading:false,position:0,getCurrentSong:()=>({SNG_ID:fixtureId,MEDIA:[{TYPE:'preview',HREF:'https://cdnt-preview.dzcdn.net/api/1/fixture.mp3'}]}),control:{play:()=>{fixturePlays++;}}};
    });
    await page.evaluate(source);
    await page.evaluate(() => __tikpalDeezerPreviewRecovery.setActive(true));
    if (scenario === 'manual-pause') {
      await page.getByRole('button',{name:'Play',exact:true}).click();
      await page.evaluate(() => {dzPlayer.paused=true;});
    }
    if (scenario === 'inactive') await page.evaluate(() => {__tikpalProviderAudioGate.status=()=>({active:false,playingCount:0});__tikpalDeezerPreviewRecovery.setActive(false);});
    if (scenario === 'playing-media') await page.evaluate(() => {__tikpalProviderAudioGate.status=()=>({active:true,playingCount:1});dzPlayer.position=2;});
    await page.clock.runFor(16000);
    assert.equal(await page.evaluate(() => fixturePlays),['stalled','duplicate'].includes(scenario)?1:0,scenario);
    if (scenario === 'duplicate') {
      await page.evaluate(() => {const b=document.querySelector('button');b.disabled=true;b.disabled=false;});
      await page.clock.runFor(16000);
      assert.equal(await page.evaluate(() => fixturePlays),1,'same stuck track is not retried indefinitely');
      await page.evaluate(() => {fixtureId='next';document.querySelector('#page_player a').setAttribute('href','/track/next');});
      await page.clock.runFor(16000);
      assert.equal(await page.evaluate(() => fixturePlays),2,'next track transition can recover without ended');
    }
  }
  const gateSource = fs.readFileSync(new URL('../deploy/chromium/web-mode-extension/provider-audio-gate.js', import.meta.url), 'utf8');
  for (const gateFirst of [false, true]) {
    await page.goto('https://www.deezer.com/');
    await page.clock.install({time: new Date('2026-09-12T00:00:00Z')});
    await page.clock.pauseAt(new Date('2026-09-12T00:00:01Z'));
    await page.evaluate(() => {
      const song = {SNG_ID:'fixture-track',MEDIA:[{TYPE:'preview',HREF:'https://cdnt-preview.dzcdn.net/api/1/fixture.mp3?hdnea=exp='+Math.floor(Date.now()/1000+120)}]};
      sessionStorage.setItem('__tikpalDeezerPreviewReload', JSON.stringify({at:Date.now(),id:song.SNG_ID,contextId:'fixture',contextType:'playlist',resume:true}));
      window.fixturePlays = 0;
      window.dzPlayer = {playing:false,paused:false,loading:false,getCurrentSong:()=>song,getContext:()=>({ID:'fixture',TYPE:'playlist'}),getTrackList:()=>[song],playTrackAtIndex:()=>{window.fixturePlays++;}};
    });
    for (const script of gateFirst ? [gateSource, source] : [source, gateSource]) await page.evaluate(script);
    await page.clock.fastForward(2000);
    assert.equal(await page.evaluate(() => fixturePlays),0,'initial mute never plays');
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('__tikpalDeezerPreviewReload')).resume),true,'real document-start gate preserves ticket in both script orders');
    await page.evaluate(() => __tikpalProviderAudioGate.setActive(true));
    await page.clock.fastForward(2000);
    assert.equal(await page.evaluate(() => fixturePlays),1,'verified foreground restores once');
  }
  console.log('Deezer startup passed: bounded notice, normal user reload, media/ownership exclusions, cleanup and 48px action');
} finally { await browser.close(); }

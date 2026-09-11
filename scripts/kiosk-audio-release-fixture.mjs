import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';

if (process.platform !== 'linux') {
  console.log('[kiosk-audio-release] SKIP: requires Linux /proc');
  process.exit(0);
}
const root = await mkdtemp(path.join(tmpdir(), 'kiosk-audio-release-'));
const profile = path.join(root, 'main kiosk');
const script = path.join(root, 'dummy.mjs');
await writeFile(script, `if (process.argv[2] === 'flat') process.title = 'chrome ' + process.argv.slice(3).join(' '); process.send('ready'); setInterval(() => {}, 1000);`);
const children = [];
async function start(mode, targetProfile, audio = true) {
  const child = spawn(process.execPath, [script, mode,
    '--utility-sub-type=' + (audio ? 'audio.mojom.AudioService' : 'network.mojom.NetworkService'),
    '--user-data-dir=' + targetProfile], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  children.push(child);
  await new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); });
  return child;
}
try {
  const targets = [await start('flat', profile), await start('argv', profile)];
  const survivors = [await start('flat', profile + '-neighbor'), await start('argv', path.join(root, 'providers/suno')),
    await start('flat', path.join(root, 'providers/spotify')), await start('argv', profile, false)];
  const exited = targets.map(child => new Promise(resolve => child.once('exit', resolve)));
  await promisify(execFile)('bash', [path.resolve('deploy/moode/tikpal-release-kiosk-audio.sh')], {
    env: { ...process.env, TIKPAL_CHROMIUM_PROFILE_DIR: profile }
  });
  await Promise.race([Promise.all(exited), new Promise((_, reject) => setTimeout(() => reject(new Error('main kiosk services survived')), 2000).unref())]);
  for (const child of survivors) { assert.equal(child.exitCode, null); assert.equal(child.signalCode, null); process.kill(child.pid, 0); }
  console.log('[kiosk-audio-release] passed: main service released; providers, neighboring profile and other utility preserved');
} finally {
  for (const child of children) child.kill('SIGKILL');
  await rm(root, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../server/index.mjs', import.meta.url), 'utf8');
const body = source.match(/async function ensureAirplayReceiverState\(enabled\) \{([\s\S]*?)\n\}/)?.[1];
assert.ok(body);
let installed = false, active = false;
const mutations = [];
const fn = new Function('commandSucceeds', 'runCommand', 'AIRPLAY_RECEIVER_ACTIVE_COMMAND',
  `return async function(enabled) {${body}\n}`)(
    async command => command.startsWith('systemctl cat ') ? installed : active,
    async command => mutations.push(command), 'receiver-active');
await fn(false); await fn(true);
assert.equal(mutations.length, 0, 'Absent AirPlay never requests system-unit mutations');
installed = true; active = true;
await fn(true); assert.equal(mutations.length, 0, 'Already active receiver is preserved');
await fn(false); assert.ok(mutations[0].includes('systemctl stop'));
active = false; await fn(true); assert.ok(mutations[1].includes('systemctl start'));
console.log('Debian AirPlay fixture passed: absent, active, stop and start paths');

import fs from 'node:fs';
import path from 'node:path';
import { createConnection } from 'node:net';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export function closeAudioOwner(state, marker) {
  return Boolean(marker?.requestId && state.activeProvider === marker.provider
    && (state.lastOpenedRequestId || '') === marker.session
    && (state.lastOpenedXSessionGeneration || '') === marker.generation);
}
export function readCloseAudioOwner(statePath, provider) {
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const marker = JSON.parse(fs.readFileSync(`${statePath}.close-audio.json`, 'utf8'));
    return marker.provider === provider && closeAudioOwner(state, marker) ? marker : null;
  } catch { return null; }
}
export function exactProfileProcess(args, profile) {
  const title = ` ${args.join(' ')} `;
  return title.includes(` --user-data-dir=${profile} `) && !/\s--type=/.test(title);
}
function processes() {
  return fs.readdirSync('/proc').filter(id => /^\d+$/.test(id)).flatMap(id => {
    try {
      const stat = fs.readFileSync(`/proc/${id}/stat`, 'utf8').split(') ').at(-1).split(' ');
      if (stat[0] === 'Z') return [];
      return [{pid:Number(id), ppid:Number(stat[1]), stamp:stat[19], args:fs.readFileSync(`/proc/${id}/cmdline`, 'utf8').split('\0')}];
    } catch { return []; }
  });
}
function command(socketPath, provider, requestId, budgetMs) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = '';
    const timer = setTimeout(() => finish(new Error('CLOSE_AUDIO_TIMEOUT')), budgetMs);
    function finish(error, result) { clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(result); }
    socket.on('error', error => finish(error));
    socket.on('connect', () => socket.write(JSON.stringify({provider, op:'command', priority:'foreground', retryable:false,
      closeRequestId:requestId, method:'Runtime.evaluate', params:{expression:'(async () => { const gate = window.__tikpalProviderAudioGate; if (!gate) return null; gate.setActive(false); await new Promise(r => setTimeout(r, 20)); return gate.status(); })()', awaitPromise:true, returnByValue:true}})+'\n'));
    socket.on('data', data => {
      buffer += data;
      if (!buffer.includes('\n')) return;
      try {
        const response = JSON.parse(buffer.split('\n')[0]);
        const value = response.result?.result?.value;
        if (!response.ok || value?.active !== false || value.playingCount !== 0 || value.contextStates?.includes('running')) throw new Error('CLOSE_AUDIO_UNCONFIRMED');
        finish(null, value);
      } catch(error) { finish(error); }
    });
  });
}
export async function closeAudio({statePath, profileRoot, socketPath, provider, requestId, session, generation, deadline = Date.now()+500, processList = processes, signalProcess = process.kill, wait = delay}) {
  const marker = {provider, requestId, session, generation};
  const current = () => closeAudioOwner(JSON.parse(fs.readFileSync(statePath, 'utf8')), marker);
  if (!current()) throw new Error('CLOSE_AUDIO_STALE');
  const temporary = `${statePath}.close-audio.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(marker), {mode:0o600});
  fs.renameSync(temporary, `${statePath}.close-audio.json`);
  const started = performance.now();
  const log = stage => {
    if (stage === 'close_audio_confirmed' || stage === 'close_audio_process_stopped') {
      if (!current()) throw new Error('CLOSE_AUDIO_STALE');
      fs.writeFileSync(temporary, JSON.stringify({...marker, outcome:stage}), {mode:0o600});
      fs.renameSync(temporary, `${statePath}.close-audio.json`);
    }
    console.log(JSON.stringify({stage, requestId, provider, elapsedMs:Math.round(performance.now()-started)}));
  };
  try { await command(socketPath, provider, requestId, Math.max(1, Math.min(500, Number(deadline)-Date.now()) || 1)); if (!current()) throw new Error('CLOSE_AUDIO_STALE'); log('close_audio_confirmed'); return; }
  catch(error) { if (!current()) throw new Error('CLOSE_AUDIO_STALE'); log('close_audio_fallback'); }
  const profile = path.join(profileRoot, 'providers', provider);
  const canonical = fs.existsSync(profile) ? fs.realpathSync(profile) : profile;
  const snapshot = processList();
  const selected = new Map(snapshot.filter(p => exactProfileProcess(p.args, profile) || exactProfileProcess(p.args, canonical)).map(p => [p.pid,p]));
  for (let changed = true; changed;) {
    changed = false;
    for (const p of snapshot) if (selected.has(p.ppid) && !selected.has(p.pid)) { selected.set(p.pid,p); changed = true; }
  }
  if (!selected.size) throw new Error('CLOSE_AUDIO_PROCESS_UNIDENTIFIED');
  const alive = () => processList().filter(p => selected.get(p.pid)?.stamp === p.stamp);
  const signal = sig => {
    if (!current()) throw new Error('CLOSE_AUDIO_STALE');
    for (const p of alive()) { try { signalProcess(p.pid, sig); } catch(error) { if (error.code !== 'ESRCH') throw error; } }
  };
  signal('SIGTERM');
  for (let i=0;i<5 && alive().length;i++) await wait(50);
  if (alive().length) signal('SIGKILL');
  for (let i=0;i<10 && alive().length;i++) await wait(50);
  if (alive().length || processList().some(p => exactProfileProcess(p.args, profile) || exactProfileProcess(p.args, canonical))) throw new Error('CLOSE_AUDIO_PROCESS_STILL_ALIVE');
  log('close_audio_process_stopped');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [statePath, profileRoot, socketPath, provider, requestId, session, generation, deadline] = process.argv.slice(2);
  closeAudio({statePath, profileRoot, socketPath, provider, requestId, session, generation, ...(deadline ? {deadline:Number(deadline)} : {})}).catch(error => {console.error(error.message); process.exitCode=1;});
}

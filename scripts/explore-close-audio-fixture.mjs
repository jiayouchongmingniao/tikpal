import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:net';
import {closeAudio, closeAudioOwner, readCloseAudioOwner, exactProfileProcess} from '../deploy/chromium/tikpal-close-audio.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'close-audio-'));
const statePath=path.join(root,'state'), socketPath=path.join(root,'socket'), profileRoot=path.join(root,'profiles');
const state={activeProvider:'suno',lastOpenedRequestId:'open-1',lastOpenedXSessionGeneration:'x-1'};
const marker={provider:'suno',requestId:'close-1',session:'open-1',generation:'x-1'};
let mode='success';const peers=new Set();
const server=createServer(socket=>{peers.add(socket);socket.on('close',()=>peers.delete(socket));socket.on('data',()=>{
 if(mode==='timeout') return;
 if(mode==='stale')fs.writeFileSync(statePath,JSON.stringify({...state,lastOpenedRequestId:'open-2'}));
 socket.end(JSON.stringify({ok:true,result:{result:{value:mode==='missing'?null:{active:false,playingCount:0,contextStates:['suspended']}}}})+'\n');
});});
await new Promise(r=>server.listen(socketPath,r));
const reset=()=>fs.writeFileSync(statePath,JSON.stringify(state));
const options={statePath,profileRoot,socketPath,...marker};
try {
 assert.ok(closeAudioOwner(state,marker));
 for(const patch of [{activeProvider:'qq_music'},{lastOpenedRequestId:'open-2'},{lastOpenedXSessionGeneration:'x-2'}])assert.equal(closeAudioOwner({...state,...patch},marker),false);
 assert.ok(exactProfileProcess(['chrome','--user-data-dir=/p/suno'],'/p/suno'));
 assert.equal(exactProfileProcess(['chrome','--user-data-dir=/p/suno-extra'],'/p/suno'),false);
 assert.ok(exactProfileProcess(['chrome --user-data-dir=/p/suno --other-flag'],'/p/suno'));
 assert.equal(exactProfileProcess(['chrome --type=utility --user-data-dir=/p/suno'],'/p/suno'),false);
 reset();await closeAudio({...options,processList:()=>{throw Error('normal close must not enumerate processes');}});
 assert.equal(readCloseAudioOwner(statePath,'suno').requestId,'close-1');
 mode='stale';await assert.rejects(closeAudio(options),/STALE/);
 assert.equal(readCloseAudioOwner(statePath,'suno'),null);
 for(mode of ['missing','timeout']) {
  reset();let ps=[{pid:11,ppid:1,stamp:'a',args:['chrome',`--user-data-dir=${profileRoot}/providers/suno`]},
   {pid:12,ppid:11,stamp:'b',args:['chrome','--type=utility']},
   {pid:13,ppid:1,stamp:'c',args:['chrome',`--user-data-dir=${profileRoot}/providers/suno-other`]}];
  const killed=[];await closeAudio({...options,processList:()=>ps,signalProcess:(pid,sig)=>{killed.push([pid,sig]);ps=ps.filter(p=>p.pid!==pid);},wait:async()=>{}});
  assert.deepEqual(killed,[[11,'SIGTERM'],[12,'SIGTERM']]);assert.deepEqual(ps.map(p=>p.pid),[13]);
 }
 mode='missing';reset();await assert.rejects(closeAudio({...options,processList:()=>[],wait:async()=>{}}),/UNIDENTIFIED/);
 reset();const ps=[{pid:11,ppid:1,stamp:'a',args:['chrome',`--user-data-dir=${profileRoot}/providers/suno`]}];
 await assert.rejects(closeAudio({...options,processList:()=>ps,signalProcess:()=>{},wait:async()=>{}}),/STILL_ALIVE/);
 console.log('[explore-close-audio-fixture] gate success, missing gate, deadline, stale session, scoped process tree and failed termination passed');
} finally {for(const peer of peers)peer.destroy();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}

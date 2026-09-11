import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as wait} from 'node:timers/promises';
import {closeAudio} from '../deploy/chromium/tikpal-close-audio.mjs';
if(process.platform!=='linux'){console.log('SKIP process fixture requires Linux /proc');process.exit(0);}
const root=fs.mkdtempSync(path.join(os.tmpdir(),'close-process-'));
const script=path.join(root,'dummy.mjs');fs.writeFileSync(script,'process.title = `chrome ${process.argv[2]}`; setInterval(()=>{},1000);');
const statePath=path.join(root,'state');fs.writeFileSync(statePath,JSON.stringify({activeProvider:'suno',lastOpenedRequestId:'s1',lastOpenedXSessionGeneration:'x1'}));
const profile=path.join(root,'providers/suno');
const target=spawn(process.execPath,[script,`--user-data-dir=${profile}`],{stdio:'ignore'});
const other=spawn(process.execPath,[script,`--user-data-dir=${profile}-other`],{stdio:'ignore'});
try{
 await wait(150);
 await closeAudio({statePath,profileRoot:root,socketPath:path.join(root,'missing-socket'),provider:'suno',requestId:'c1',session:'s1',generation:'x1'});
 await wait(20);assert.ok(target.exitCode!==null || target.signalCode);assert.equal(other.exitCode,null);process.kill(other.pid,0);
 console.log('[explore-close-audio-process-fixture] real Linux exact-profile termination passed; neighbor survived');
}finally{target.kill('SIGKILL');other.kill('SIGKILL');fs.rmSync(root,{recursive:true,force:true});}

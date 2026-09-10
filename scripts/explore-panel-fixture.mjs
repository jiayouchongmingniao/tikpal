import assert from 'node:assert/strict';
import { panelGeometry, panelSnapshot, panelCommit } from '../deploy/chromium/tikpal-web-mode-panel.mjs';
import { createOAuthWindowLayout } from '../deploy/chromium/tikpal-oauth-window-layout.mjs';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as wait } from 'node:timers/promises';

assert.deepEqual(panelGeometry('0,0','1920x720','1920,0','640x720','collapsed'), {
  leftPosition:'0,0',leftSize:'2504x720',panelPosition:'2504,0',panelSize:'640x720',screen:'2560 720'
});
assert.equal(panelGeometry('0,0','1400x1080','1400,0','520x1080','collapsed').leftSize,'1864x1080');
for (const args of [['0,0','1920x720','1900,0','640x720'],['0,0','1920x720','1920,0','640x800'],['1,0','1920x720','1921,0','640x720'],['0,0','1920x720','1920,0','56x720']]) assert.equal(panelGeometry(...args),null);
const base={activeProvider:'spotify',lastOpenedRequestId:'open-1',lastOpenedXSessionGeneration:'x-1',panelLayoutSupported:true};
const expected={provider:'spotify',session:'open-1',generation:'x-1'};
const snapshot=panelSnapshot(base,'x-1',expected);
assert.equal(panelCommit(base,snapshot,'x-1','collapsed').panelMode,'collapsed');
for(const patch of [{closeRequestId:'close-1'},{activeProvider:'qobuz'},{lastOpenedRequestId:'open-2'},{openingProvider:'qobuz'},{panelMode:'collapsed'}]) assert.throws(()=>panelCommit({...base,...patch},snapshot,'x-1','collapsed'));
assert.throws(()=>panelCommit(base,snapshot,'x-2','collapsed'));
assert.throws(()=>panelSnapshot(base,'x-1',{...expected,session:'old'}));
assert.throws(()=>panelSnapshot({...base,openingProvider:'qobuz'},'x-1',expected));
// Login windows track the parent's actual expanded width, never the screen edge.
const oauth=createOAuthWindowLayout();let width=2504;const calls=[];
const targets=[{targetId:'main',type:'page',url:'https://open.spotify.com/'},{targetId:'login',type:'page',url:'https://accounts.google.com/',openerId:'main'}];
const command=async(method,args)=>{calls.push({method,args});if(method==='Target.getTargets')return {targetInfos:targets};if(method==='Browser.getWindowForTarget')return {windowId:args.targetId==='main'?1:2,bounds:{left:0,top:0,width:args.targetId==='main'?width:640,height:720}};return {};};
for(width of [2504,1920]){await oauth.sync(targets,command,t=>t.targetId==='main',{active:true});assert.equal(calls.filter(c=>c.method==='Browser.setWindowBounds').at(-1).args.bounds.width,width);}

const root=mkdtempSync(path.join(tmpdir(),'tikpal-panel-api-'));
const statePath=path.join(root,'state.json'), generationPath=path.join(root,'generation');
const commandPath=path.join(root,'command.mjs');
writeFileSync(generationPath,'x-1');
writeFileSync(commandPath,`import fs from 'node:fs';\nimport {setTimeout as wait} from 'node:timers/promises';\nconst file=process.env.TIKPAL_WEB_MODE_STATE_PATH;\nfs.appendFileSync(${JSON.stringify(path.join(root,'calls'))},process.argv[2]+'\\n');\nif(process.argv[2]==='panel-mode'){\n await wait(fs.existsSync(${JSON.stringify(path.join(root,'slow'))})?1600:180);\n if(fs.existsSync(${JSON.stringify(path.join(root,'fail'))}))process.exit(1);\n const s=JSON.parse(fs.readFileSync(file));s.panelMode=process.argv[3];fs.writeFileSync(file,JSON.stringify(s));\n}\nif(process.argv[2]==='close'){const s=JSON.parse(fs.readFileSync(file));s.activeProvider=null;s.panelMode='expanded';fs.writeFileSync(file,JSON.stringify(s));}\n`);
const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
const child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,TIKPAL_PLAYER_BACKEND:'mock',TIKPAL_API_HOST:'127.0.0.1',TIKPAL_API_PORT:String(port),TIKPAL_WEB_MODE_COMMAND_TIMEOUT_MS:'700',TIKPAL_WEB_MODE_COMMAND:`${process.execPath} ${commandPath}`,TIKPAL_WEB_MODE_STATE_PATH:statePath,TIKPAL_KIOSK_X_SESSION_GENERATION_PATH:generationPath,TIKPAL_WEB_MODE_SETTINGS_PATH:path.join(root,'settings.json'),TIKPAL_WEB_MODE_HANDOFF_STATE_PATH:path.join(root,'handoff.json'),TIKPAL_UI_PREFERENCES_STATE_PATH:path.join(root,'ui.json'),TIKPAL_ROOM_EXPERIENCE_STATE_PATH:path.join(root,'room.json'),TIKPAL_AUDIO_SOURCE_MEMORY_STATE_PATH:path.join(root,'source.json')},stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);
const get=()=>fetch(`http://127.0.0.1:${port}/api/v1/web-mode/state`).then(r=>r.json());
const post=async body=>{const response=await fetch(`http://127.0.0.1:${port}/api/v1/web-mode/actions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
const action={type:'panel_mode',panelMode:'collapsed',panelSessionId:'open-1',panelXSessionGeneration:'x-1'};
try {
  let ready=false;for(let i=0;i<100;i++){try{await get();ready=true;break;}catch{await wait(30);}}assert.ok(ready,output);
  writeFileSync(statePath,JSON.stringify(base));
  assert.equal((await get()).panelMode,'expanded');
  assert.equal((await post({...action,panelMode:'invalid'})).status,400);
  assert.notEqual((await post({...action,panelSessionId:'old'})).status,200);
  let result=await post(action);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.panelMode,'collapsed');
  assert.equal((await post(action)).body.panelMode,'collapsed');
  writeFileSync(path.join(root,'fail'),'1');result=await post({...action,panelMode:'expanded'});assert.notEqual(result.status,200);assert.equal((await get()).panelMode,'collapsed');rmSync(path.join(root,'fail'));
  writeFileSync(path.join(root,'slow'),'1');result=await post({...action,panelMode:'expanded'});assert.notEqual(result.status,200);await wait(1800);assert.equal((await get()).panelMode,'collapsed','timed-out command cannot commit later');rmSync(path.join(root,'slow'));
  const first=post({...action,panelMode:'expanded'});await wait(50);
  assert.notEqual((await post(action)).status,200,'concurrent layout rejected');
  assert.notEqual((await post({type:'open',provider:'qobuz'})).status,200,'switch cannot queue behind layout');
  const close=post({type:'close'});await first;await close;
  for(let i=0;i<100&&(await get()).activeProvider;i++)await wait(30);
  assert.equal((await get()).activeProvider,null);assert.equal((await get()).panelMode,'expanded');
  assert.notEqual((await post(action)).status,200,'closed Explore rejects layout');
  writeFileSync(statePath,JSON.stringify({...base,lastOpenedRequestId:'open-2'}));assert.notEqual((await post(action)).status,200,'old request rejected after re-entry');
  console.log('[explore-panel-fixture] geometry, sessions, API concurrency/failure/close, OAuth passed');
} finally {child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));rmSync(root,{recursive:true,force:true});}

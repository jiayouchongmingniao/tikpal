import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const ssh=cmd=>execFileSync('ssh',['-S','/tmp/tikpal102-hwdecode.sock','radxa@192.168.10.102',cmd],{encoding:'utf8'});
const dir=ssh('mktemp -d /tmp/tikpal151-smoke.XXXXXX').trim();
const args=['--user-data-dir='+dir+'/profile','--remote-debugging-address=127.0.0.1','--remote-debugging-port=9433','--no-first-run','--no-default-browser-check','--autoplay-policy=no-user-gesture-required','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--window-position=2700,0','--window-size=1280,720','--use-gl=angle','--use-angle=gles-egl','--enable-accelerated-video-decode','--enable-features=AcceleratedVideoDecoder','--ignore-gpu-blocklist','--enable-logging=stderr','--vmodule=*v4l2*=3,*video_decoder*=2,*gpu_video*=2','--app=about:blank'];
ssh('env -u LD_PRELOAD DISPLAY=:0 XAUTHORITY=/run/user/1000/gdm/Xauthority nohup /opt/tikpal-chromium-151.0.7922.173-arm64/chromium '+args.map(quote).join(' ')+' > '+quote(dir+'/browser.log')+' 2>&1 < /dev/null & echo $! > '+quote(dir+'/pid'));
console.log('Test directory: '+dir);

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let ws;let id=0;const pending=new Map();let props=[],errors=[];
try {
 let version;
 for(let i=0;i<30;i++){try {version=await(await fetch('http://127.0.0.1:19473/json/version')).json();break;}catch{await sleep(500);}}
 if(!version)throw new Error('No CDP endpoint');
 ws=new WebSocket(version.webSocketDebuggerUrl.replace('127.0.0.1:9433','127.0.0.1:19473'));
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}}else if(m.method==='Media.playerPropertiesChanged')props.push(m.params);else if(m.method==='Media.playerErrorsRaised')errors.push(m.params);};
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{let k=++id;const timer=setTimeout(()=>{pending.delete(k);reject(new Error('CDP timeout '+method));},10000);pending.set(k,{resolve,reject,timer});ws.send(JSON.stringify({id:k,method,params,sessionId}));});
 const gpu=await send('SystemInfo.getInfo');fs.writeFileSync('/tmp/tikpal151-gpu.json',JSON.stringify(gpu,null,2));
 const targets=await send('Target.getTargets');console.log(JSON.stringify(targets));
 const target=targets.targetInfos.find(t=>t.type==='page');
 const {sessionId}=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
 await send('Media.enable',{},sessionId);await send('Page.enable',{},sessionId);
 await send('Page.navigate',{url:'http://localhost:4173/assets/scenes/Midnight-Library.mp4'},sessionId);await sleep(3000);
 const evaluate=expression=>send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);
 console.log(JSON.stringify(await evaluate('document.body.innerText')));
 await evaluate('(()=>{const v=document.querySelector("video");v.muted=true;v.loop=true;return v.play();})()');const samples=[];
 const {windowId}=await send('Browser.getWindowForTarget',{targetId:target.targetId});
 for(const width of [1920,2504,1920,2504]){
   await send('Browser.setWindowBounds',{windowId,bounds:{width,height:720,windowState:'normal'}});
   await sleep(10000);
   const sample=await evaluate('(()=>{const v=document.querySelector("video");return {time:v.currentTime,paused:v.paused,error:v.error?.message,frames:v.getVideoPlaybackQuality().totalVideoFrames,dropped:v.getVideoPlaybackQuality().droppedVideoFrames,width:innerWidth,height:innerHeight};})()');
   samples.push(sample);console.log(JSON.stringify({sample}));
 }
 fs.writeFileSync('/tmp/tikpal151-loop-samples.json',JSON.stringify(samples,null,2));
 const state=await evaluate('(()=>{const v=document.querySelector("video");return {time:v.currentTime,ready:v.readyState,width:v.videoWidth,height:v.videoHeight,frames:v.getVideoPlaybackQuality().totalVideoFrames,dropped:v.getVideoPlaybackQuality().droppedVideoFrames};})()');
 const shot=await send('Page.captureScreenshot',{},sessionId);fs.writeFileSync('/tmp/tikpal151-loop.png',Buffer.from(shot.data,'base64'));
 const result={dir,version,state,props,errors};fs.writeFileSync('/tmp/tikpal151-loop.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 if(errors.length || state.result.value.frames < 100) throw new Error('Playback acceptance failed: decoder errors or too few frames');
}finally{if(ws)ws.close();ssh('kill -TERM '+ssh('cat '+quote(dir+'/pid')).trim());}

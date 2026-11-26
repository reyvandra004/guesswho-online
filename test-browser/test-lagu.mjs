// test-lagu.mjs — buktiin pemutar klip mode LAGU (fetch /media/*.mp3 ->
// decodeAudioData -> Web Audio) beneran bunyi dari TAP beneran di browser,
// dengan klien baru (media via HTTP, bukan data URI lagi).
import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
const EXE='/home/hatch/workspace/explainer-skripsi/tools/chrome-headless-shell/linux-158.0.8127.88/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT=3197, BASE=`http://localhost:${PORT}`;
const OUT='/home/hatch/workspace/game-guesswho-online/test-browser/shots/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let fails=0;
const check=(name,ok,extra='')=>{console.log((ok?'OK  ':'FAIL')+' '+name+(extra?' | '+extra:'')); if(!ok) fails++;};

const srv=spawn('node',['server/server.js'],{cwd:'/home/hatch/workspace/game-guesswho-online',
  env:{...process.env,PORT:String(PORT)},stdio:'ignore'});
await sleep(900);
const browser=await puppeteer.launch({executablePath:EXE,args:['--no-sandbox','--disable-gpu']});
async function newPage(){
  const p=await browser.newPage();
  await p.emulate({viewport:{width:390,height:844,deviceScaleFactor:2,isMobile:true,hasTouch:true},
    userAgent:'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'});
  p.on('pageerror',e=>console.log('[pageerror]',e.message.slice(0,160)));
  return p;
}
async function tap(p,sel){
  const el=await p.$(sel); if(!el) throw new Error('tidak ketemu '+sel);
  const box=await el.boundingBox(); if(!box) throw new Error('tidak ada box '+sel);
  await p.touchscreen.tap(box.x+box.width/2, box.y+box.height/2); await sleep(350);
}
try{
  const A=await newPage();
  await A.goto(BASE,{waitUntil:'load'}); await sleep(500);
  await A.type('#inp-name','BosLagu');
  await tap(A,'#create-modes .modebtn[data-mode="lagu"]');
  await tap(A,'#btn-create');
  await A.waitForFunction(()=>document.getElementById('view-lobby').classList.contains('on'),{timeout:8000});
  const code=await A.evaluate(()=>document.getElementById('room-code').textContent.trim());
  const B=await newPage();
  await B.goto(BASE+'/?room='+code,{waitUntil:'load'}); await sleep(500);
  await B.type('#inp-name','TemanLagu');
  await tap(B,'#btn-join');
  await B.waitForFunction(()=>document.getElementById('view-lobby').classList.contains('on'),{timeout:8000});
  await sleep(600);
  await tap(A,'#btn-start');
  for(const p of [A,B]) await p.waitForFunction(()=>document.getElementById('view-game').classList.contains('on'),{timeout:8000});
  // soal lagu pertama: audiobox tampil, src foto tidak dipakai, label klip benar
  const abVisible=await A.evaluate(()=>document.getElementById('audiobox').style.display==='flex');
  check('audiobox tampil di soal lagu', abVisible);
  const label0=await A.evaluate(()=>document.getElementById('alabel').textContent);
  check('label klip 10 detik + sisa putar 3x', /10 detik/.test(label0)&&/3×/.test(label0), label0);
  // TAP tombol play beneran -> audio harus jalan + berenergi
  await tap(A,'#playbtn');
  await sleep(1800);
  const st=await A.evaluate(()=>({pos:window.__waPos(), playing:window.__waPlaying(), energy:window.__waEnergy(), mode:window.__waMode(),
    label:document.getElementById('alabel').textContent}));
  check('setelah tap: mode WebAudio', st.mode==='wa', st.mode);
  check('setelah tap: klip berputar', st.playing===true, 'playing='+st.playing);
  check('setelah tap: posisi maju', st.pos>0.5, 'pos='+st.pos.toFixed(2));
  check('setelah tap: energi audio > 0 (bunyi beneran)', st.energy>0.01, 'energy='+st.energy.toFixed(3));
  check('jatah putar berkurang jadi 2x', /2×/.test(st.label), st.label);
  await A.screenshot({path:OUT+'lagu-playing.png'});
  // jawab di dua HP -> reveal
  await tap(A,'#opts .opt:nth-child(1)');
  await tap(B,'#opts .opt:nth-child(2)');
  for(const p of [A,B]) await p.waitForFunction(()=>document.getElementById('revealinfo').style.display==='block',{timeout:20000});
  check('reveal soal lagu muncul di 2 HP', true);
  await A.close(); await B.close();
}catch(e){ fails++; console.log('ERROR BESAR:', e.message); }
await browser.close(); srv.kill();
console.log(fails===0?'\nSEMUA TEST LAGU BROWSER LULUS':`\n${fails} KEGAGALAN`);
process.exit(fails===0?0:1);

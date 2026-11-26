// test-public.mjs — test 2 halaman headless Chrome LEWAT URL PUBLIK tunnel:
// host buat room, tamu gabung via link undangan, main 2 soal K-Pop, reveal
// konsisten. Chrome diarahkan lewat egress proxy sandbox (env http_proxy,
// tokennya rotasi jadi dibaca segar dari env saat jalan).
// Pakai: node test-browser/test-public.mjs https://<host-tunnel>/
import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
const EXE='/home/hatch/workspace/explainer-skripsi/tools/chrome-headless-shell/linux-158.0.8127.88/chrome-headless-shell-linux64/chrome-headless-shell';
const BASE=(process.argv[2]||'').replace(/\/$/,'');
if(!BASE.startsWith('https://')){ console.error('usage: node test-browser/test-public.mjs https://<host>/'); process.exit(2); }
const HOST=new URL(BASE).hostname;
const OUT='/home/hatch/workspace/game-guesswho-online/test-browser/shots/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let fails=0;
const check=(name,ok,extra='')=>{console.log((ok?'OK  ':'FAIL')+' '+name+(extra?' | '+extra:'')); if(!ok) fails++;};

// Chrome tidak bisa proxy ber-credential dari --proxy-server, dan forward
// raw-TCP socat dijawab 502 oleh edge tunnel. Jadi Chrome diarahkan ke
// proxy relay lokal (test-browser/proxy-relay.js) yang melakukan CONNECT
// ber-auth ke egress proxy sandbox — pola yang sama dengan curl.
const relay=spawn('node',['test-browser/proxy-relay.js','18080'],
  {cwd:'/home/hatch/workspace/game-guesswho-online',stdio:'ignore'});
await sleep(800);
const browser=await puppeteer.launch({executablePath:EXE,
  args:['--no-sandbox','--disable-gpu','--proxy-server=http://127.0.0.1:18080']});
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
const overflow=p=>p.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
try{
  const A=await newPage();
  await A.goto(BASE,{waitUntil:'load',timeout:60000}); await sleep(800);
  await A.type('#inp-name','BosPub');
  await tap(A,'#create-modes .modebtn[data-mode="kpop"]');
  await tap(A,'#btn-create');
  await A.waitForFunction(()=>document.getElementById('view-lobby').classList.contains('on'),{timeout:30000});
  const code=await A.evaluate(()=>document.getElementById('room-code').textContent.trim());
  check('host masuk lobby lewat publik, kode room', /^[A-Z0-9]{6}$/.test(code), code);
  await A.screenshot({path:OUT+'public-lobby-host.png'});

  const B=await newPage();
  await B.goto(BASE+'/?room='+code,{waitUntil:'load',timeout:60000}); await sleep(800);
  const prefilled=await B.evaluate(()=>document.getElementById('inp-code').value);
  check('link undangan publik prefill kode', prefilled===code, prefilled);
  const homeErr=await B.evaluate(()=>{ const e=document.getElementById('home-err'); return e.style.display==='block' ? e.textContent : ''; });
  check('TIDAK ada popup error palsu di halaman tamu', homeErr==='', homeErr);
  await B.type('#inp-name','TemanPub');
  await tap(B,'#btn-join');
  await B.waitForFunction(()=>document.getElementById('view-lobby').classList.contains('on'),{timeout:30000});
  const plist=await B.evaluate(()=>document.getElementById('plist').innerText);
  check('lobby tamu lihat 2 pemain', plist.includes('BosPub')&&plist.includes('TemanPub'), plist.replace(/\n/g,' / '));
  await sleep(800);
  await tap(A,'#btn-start');
  for(const p of [A,B]) await p.waitForFunction(()=>document.getElementById('view-game').classList.contains('on'),{timeout:30000});
  for(let q=1;q<=2;q++){
    const [ta,tb]=await Promise.all([A,B].map(p=>p.evaluate(()=>document.getElementById('qtext').textContent)));
    check(`soal ${q} identik di 2 HP (publik)`, ta===tb && ta.length>0, ta.slice(0,50));
    if(q===1) check('overflow soal A', (await overflow(A))===0);
    await tap(A,'#opts .opt:nth-child(1)');
    await tap(B,'#opts .opt:nth-child(2)');
    for(const p of [A,B]) await p.waitForFunction(()=>document.getElementById('revealinfo').style.display==='block',{timeout:40000});
    check(`reveal soal ${q} muncul di 2 HP (publik)`, true);
    if(q<2) await sleep(3200);
  }
  await A.close(); await B.close();
}catch(e){ fails++; console.log('ERROR BESAR:', e.message); }
await browser.close(); relay.kill();
console.log(fails===0?'\nSEMUA TEST BROWSER PUBLIK LULUS':`\n${fails} KEGAGALAN BROWSER PUBLIK`);
process.exit(fails===0?0:1);

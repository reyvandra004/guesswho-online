import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
const EXE='/home/hatch/workspace/explainer-skripsi/tools/chrome-headless-shell/linux-158.0.8127.88/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT=3198, BASE=`http://localhost:${PORT}`;
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
const overflow=p=>p.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
const visible=(p,id)=>p.evaluate(i=>{const e=document.getElementById(i);return e&&e.classList.contains('on');},id);

try{
  // --- Host buat room mode K-Pop ---
  const A=await newPage();
  await A.goto(BASE,{waitUntil:'load'}); await sleep(500);
  await A.type('#inp-name','BosA');
  await tap(A,'#create-modes .modebtn[data-mode="kpop"]');
  await tap(A,'#btn-create');
  await A.waitForFunction(()=>document.getElementById('view-lobby').classList.contains('on'),{timeout:8000});
  const code=await A.evaluate(()=>document.getElementById('room-code').textContent.trim());
  check('host masuk lobby, kode room', /^[A-Z0-9]{6}$/.test(code), code);
  check('overflow lobby A', (await overflow(A))===0);
  await A.screenshot({path:OUT+'lobby-host.png'});

  // --- Tamu gabung via link undangan ---
  const B=await newPage();
  await B.goto(BASE+'/?room='+code,{waitUntil:'load'}); await sleep(500);
  const prefilled=await B.evaluate(()=>document.getElementById('inp-code').value);
  check('link undangan prefill kode', prefilled===code, prefilled);
  await B.type('#inp-name','TemanB');
  await tap(B,'#btn-join');
  await B.waitForFunction(()=>document.getElementById('view-lobby').classList.contains('on'),{timeout:8000});
  const plist=await B.evaluate(()=>document.getElementById('plist').innerText);
  check('lobby tamu lihat 2 pemain', plist.includes('BosA')&&plist.includes('TemanB'), plist.replace(/\n/g,' / '));
  await sleep(600);
  const canStart=await A.evaluate(()=>!document.getElementById('btn-start').disabled);
  check('tombol MULAI host aktif', canStart);

  // --- Mulai game K-Pop, jawab 2 soal di kedua HP ---
  await tap(A,'#btn-start');
  for(const p of [A,B]) await p.waitForFunction(()=>document.getElementById('view-game').classList.contains('on'),{timeout:8000});
  for(let q=1;q<=2;q++){
    const [ta,tb]=await Promise.all([A,B].map(p=>p.evaluate(()=>document.getElementById('qtext').textContent)));
    check(`soal ${q} identik di 2 HP`, ta===tb && ta.length>0, ta.slice(0,50));
    if(q===1){ check('overflow soal A', (await overflow(A))===0); await A.screenshot({path:OUT+'question-host.png'}); }
    await tap(A,'#opts .opt:nth-child(1)');
    await tap(B,'#opts .opt:nth-child(2)');
    for(const p of [A,B]) await p.waitForFunction(()=>document.getElementById('revealinfo').style.display==='block',{timeout:20000});
    const [ra,rb]=await Promise.all([A,B].map(p=>p.evaluate(()=>document.getElementById('revealinfo').innerText)));
    check(`reveal soal ${q} muncul di 2 HP`, ra.length>0&&rb.length>0);
    check(`reveal soal ${q} jawaban benar sama`, ra.split('\n')[1]===rb.split('\n')[1], (ra.split('\n')[1]||'').slice(0,40));
    if(q===1) await B.screenshot({path:OUT+'reveal-guest.png'});
    if(q<2) await sleep(3200); // jeda reveal server 2.5s -> soal berikutnya
  }
  check('overflow reveal B', (await overflow(B))===0);
  await A.close(); await B.close();
}catch(e){ fails++; console.log('ERROR BESAR:', e.message); }
await browser.close(); srv.kill();
console.log(fails===0?'\nSEMUA TEST BROWSER LULUS':`\n${fails} KEGAGALAN BROWSER`);
process.exit(fails===0?0:1);

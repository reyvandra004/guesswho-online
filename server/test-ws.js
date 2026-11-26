// test-ws.js — test otomatis 2 klien WebSocket buat GUESS WHO ONLINE.
// Jalanin server sendiri di port 3199 (Q_MS dipendekkan), lalu main 3 mode
// (drama, kpop, lagu) masing-masing 20 soal dengan 2 klien, dan assert:
// payload soal identik di kedua klien, tidak ada index jawaban sebelum reveal,
// skor konsisten, final + pemenang benar.
const { spawn, execFileSync } = require('child_process');
const WebSocket = require('ws');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3199;
const BASE = `http://localhost:${PORT}`;
let failures = 0;
function ok(cond, label) {
  if (cond) console.log('  PASS', label);
  else { failures++; console.log('  FAIL', label); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Client {
  constructor(name) { this.name = name; this.inbox = []; this.waiters = []; }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(`ws://localhost:${PORT}`);
      this.ws.on('open', res); this.ws.on('error', rej);
      this.ws.on('message', raw => {
        const m = JSON.parse(raw);
        let consumed = false;
        this.waiters = this.waiters.filter(w => { const hit = w(m); if (hit) consumed = true; return !hit; });
        if (!consumed) this.inbox.push(m);
      });
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  waitFor(type, timeout = 30000) {
    const found = this.inbox.find(m => m.type === type);
    if (found) { this.inbox.splice(this.inbox.indexOf(found), 1); return Promise.resolve(found); }
    return new Promise((res, rej) => {
      const w = m => { if (m.type === type) { res(m); return true; } return false; };
      this.waiters.push(w);
      setTimeout(() => rej(new Error(this.name + ' timeout menunggu ' + type)), timeout);
    });
  }
  // ambil pesan question berikutnya (dengan nomor n)
  async nextQuestion(n) {
    while (true) {
      const m = await this.waitFor('question', 30000);
      if (m.n === n) return m;
    }
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

async function playMode(mode, { withTimeoutQ = false, withHint = false } = {}) {
  console.log(`\n== MODE ${mode.toUpperCase()} ==`);
  const A = new Client('Host' + mode), B = new Client('Tamu' + mode);
  await A.connect(); await B.connect();
  A.send({ type: 'create', name: A.name, mode });
  const wa = await A.waitFor('welcome');
  ok(wa.code && wa.code.length === 6, 'room code 6 char: ' + wa.code);
  ok(typeof wa.token === 'string' && wa.token.length >= 16, 'welcome berisi resume token');
  B.send({ type: 'join', name: B.name, code: wa.code });
  await B.waitFor('welcome');
  let lob = await A.waitFor('lobby');
  while (!lob.canStart) lob = await A.waitFor('lobby');
  ok(lob.canStart === true, 'lobby canStart saat 2 pemain');
  ok(lob.mode === mode, 'mode room = ' + mode);
  A.send({ type: 'start' });

  let scoreA = 0, scoreB = 0, audioChecked = false;
  for (let n = 1; n <= 20; n++) {
    const [qa, qb] = await Promise.all([A.nextQuestion(n), B.nextQuestion(n)]);
    const core = q => JSON.stringify({ badge: q.badge, qtext: q.qtext, clueText: q.clueText,
      options: q.options, hasPhoto: !!q.photo, hasAudio: !!q.audio, deadline: q.deadline });
    ok(core(qa) === core(qb), `Q${n} payload identik di 2 klien`);
    ok(!('correct' in qa) && !('correctIndex' in qa) && !('correct' in qb), `Q${n} tanpa index jawaban`);
    ok(qa.options.length === 4, `Q${n} 4 opsi`);
    ok(JSON.stringify(qa).length < 3000, `Q${n} payload WS kecil (${JSON.stringify(qa).length} byte, media via HTTP)`);
    if (qa.photo) ok(/^\/media\/[a-f0-9]+\.jpg$/.test(qa.photo), `Q${n} foto berupa URL /media/*.jpg`);
    if (mode === 'lagu') {
      ok(!!qa.audio && /^\/media\/[a-z0-9-]+\.mp3$/.test(qa.audio), `Q${n} klip audio berupa URL /media/*.mp3`);
      if (!audioChecked) {
        audioChecked = true;
        const resp = await fetch(BASE + qa.audio);
        ok(resp.ok && (resp.headers.get('cache-control') || '').includes('immutable'), 'media klip keambil via HTTP + header cache immutable');
        const buf = Buffer.from(await resp.arrayBuffer());
        const tmp = path.join(os.tmpdir(), 'gw-clip-test.mp3');
        fs.writeFileSync(tmp, buf);
        try {
          const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', tmp]).toString().trim();
          const d = parseFloat(out);
          ok(d > 9 && d < 11, `durasi klip lagu ≈10s (aktual ${d.toFixed(2)}s)`);
        } catch (e) { ok(false, 'ffprobe klip lagu jalan'); }
      }
    }
    if (withTimeoutQ && n === 3) {
      // dua-duanya diam: reveal harus datang sendiri setelah deadline
      const [ra, rb] = await Promise.all([A.waitFor('reveal', 20000), B.waitFor('reveal', 20000)]);
      ok(ra.results.every(r => r.choice === null && r.points === 0), 'timeout: choice null, poin 0');
      ok(JSON.stringify(ra.scores) === JSON.stringify(rb.scores), 'timeout: skor konsisten');
      continue;
    }
    if (withHint && n === 2) {
      A.send({ type: 'hint' });
      const h = await A.waitFor('hint');
      ok(!!h.text && h.hintsLeft === 2, 'hint terkirim, stok 3->2');
    }
    A.send({ type: 'answer', choice: n % 4 });
    B.send({ type: 'answer', choice: (n + 1) % 4 });
    const [ra, rb] = await Promise.all([A.waitFor('reveal'), B.waitFor('reveal')]);
    ok(ra.correctIndex >= 0 && ra.correctIndex <= 3, `Q${n} reveal punya correctIndex`);
    ok(ra.correctIndex === rb.correctIndex, `Q${n} correctIndex sama di 2 klien`);
    for (const r of ra.results) {
      const myChoice = r.name === A.name ? n % 4 : (n + 1) % 4;
      ok(r.choice === myChoice, `Q${n} choice ${r.name} tercatat benar`);
      ok(r.correct === (r.choice === ra.correctIndex), `Q${n} flag correct ${r.name} konsisten`);
      if (r.correct) ok(r.points >= 10 && r.points <= 100 + 5 * 5, `Q${n} poin ${r.name} dalam rumus (${r.points})`);
      else ok(r.points === 0, `Q${n} poin salah = 0`);
      if (withHint && n === 2 && r.name === A.name) ok(r.hintUsed === true, 'hintUsed tercatat di reveal');
    }
    const sA = ra.scores.find(x => x.name === A.name).score;
    const sB = ra.scores.find(x => x.name === B.name).score;
    scoreA = sA; scoreB = sB;
    const rbA = rb.scores.find(x => x.name === A.name).score;
    ok(sA === rbA && sB === rb.scores.find(x => x.name === B.name).score, `Q${n} skor sama di 2 klien`);
  }
  const [fa, fb] = await Promise.all([A.waitFor('final'), B.waitFor('final')]);
  const stA = fa.standings.find(x => x.name === A.name), stB = fa.standings.find(x => x.name === B.name);
  ok(stA.score === scoreA && stB.score === scoreB, 'final: total skor = akumulasi reveal');
  ok(JSON.stringify(fa.standings) === JSON.stringify(fb.standings), 'final: standings identik');
  const expectWinner = scoreA === scoreB ? null : (scoreA > scoreB ? A.name : B.name);
  ok(fa.winner === expectWinner && fa.draw === (expectWinner === null), 'final: pemenang benar (' + fa.winner + ')');
  A.close(); B.close();
}

(async () => {
  const srv = spawn('node', ['server/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), Q_MS: '4000', REVEAL_MS: '200' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stderr.on('data', d => process.stderr.write('[server] ' + d));
  try {
    for (let i = 0; i < 40; i++) {
      try { const r = await fetch(BASE + '/health'); if (r.ok) break; } catch (e) {}
      await sleep(250);
    }
    await playMode('drama', { withTimeoutQ: true, withHint: true });
    await playMode('kpop', {});
    await playMode('lagu', {});
  } catch (e) {
    failures++;
    console.log('ERROR BESAR:', e.message);
  } finally {
    srv.kill();
  }
  console.log(failures === 0 ? '\nSEMUA TEST WS LULUS' : `\n${failures} KEGAGALAN`);
  process.exit(failures === 0 ? 0 : 1);
})();

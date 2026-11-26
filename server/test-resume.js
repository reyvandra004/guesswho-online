// test-resume.js — test ketahanan koneksi GUESS WHO ONLINE.
// Skenario 1 (resume di tengah game): pemain B putus paksa (terminate) di
// tengah soal, A dapat opponentAway (bukan game over), B reconnect pakai
// resume token dalam masa tenggang -> dapat resync soal yang sama (index sama,
// skor utuh, status kunci pulih), lalu game dimainkan sampai final.
// Skenario 2 (grace habis): pemain putus dan tidak kembali sampai GRACE_MS
// lewat -> lawan dapat opponentLeft, room balik lobby, resume token lama
// ditolak SESSION_GONE.
const { spawn } = require('child_process');
const WebSocket = require('ws');
const path = require('path');

const PORT = 3200;
const BASE = `http://localhost:${PORT}`;
let failures = 0;
function ok(cond, label) {
  if (cond) console.log('  PASS', label);
  else { failures++; console.log('  FAIL', label); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
process.on('unhandledRejection', e => console.log('  (unhandledRejection diabaikan di test:', e.message + ')'));

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
  waitFor(type, timeout = 20000) {
    const found = this.inbox.find(m => m.type === type);
    if (found) { this.inbox.splice(this.inbox.indexOf(found), 1); return Promise.resolve(found); }
    return new Promise((res, rej) => {
      const w = m => { if (m.type === type) { res(m); return true; } return false; };
      this.waiters.push(w);
      setTimeout(() => rej(new Error(this.name + ' timeout menunggu ' + type)), timeout);
    });
  }
  async nextQuestion(n) {
    while (true) {
      const m = await this.waitFor('question', 20000);
      if (m.n === n) return m;
    }
  }
  terminate() { try { this.ws.terminate(); } catch (e) {} }
  close() { try { this.ws.close(); } catch (e) {} }
}

async function scenarioResume() {
  console.log('\n== SKENARIO 1: RESUME DI TENGAH GAME ==');
  const A = new Client('HostResume');
  let B = new Client('TamuResume');
  await A.connect(); await B.connect();
  A.send({ type: 'create', name: A.name, mode: 'drama' });
  const wa = await A.waitFor('welcome');
  B.send({ type: 'join', name: B.name, code: wa.code });
  const wb = await B.waitFor('welcome');
  ok(!!wb.token, 'B dapat resume token');
  let lob = await A.waitFor('lobby');
  while (!lob.canStart) lob = await A.waitFor('lobby');
  A.send({ type: 'start' });

  // Q1: B jawab duluan, lalu putus paksa.
  const [q1a] = await Promise.all([A.nextQuestion(1), B.nextQuestion(1)]);
  ok(q1a.n === 1, 'Q1 jalan');
  B.send({ type: 'answer', choice: 1 });
  await A.waitFor('locked');
  B.terminate();
  const away = await A.waitFor('opponentAway');
  ok(away.name === B.name, 'A dapat opponentAway (bukan game over)');
  // A jawab -> dua-duanya tercatat -> reveal tetap jalan buat A.
  A.send({ type: 'answer', choice: 2 });
  const r1 = await A.waitFor('reveal');
  const bScoreAfterQ1 = r1.scores.find(x => x.name === B.name).score;
  const aScoreAfterQ1 = r1.scores.find(x => x.name === A.name).score;
  ok(true, 'reveal Q1 tetap jalan walau B putus (skor B=' + bScoreAfterQ1 + ', A=' + aScoreAfterQ1 + ')');

  // Q2 tiba di A. B reconnect + resume -> resync Q2.
  await A.nextQuestion(2);
  const B2 = new Client(B.name);
  await B2.connect();
  B2.send({ type: 'resume', code: wa.code, token: wb.token });
  const wres = await B2.waitFor('welcome');
  ok(wres.resumed === true && wres.playerId === wb.playerId, 'resume diterima, playerId sama');
  await A.waitFor('opponentBack');
  ok(true, 'A dapat opponentBack');
  const q2resync = await B2.waitFor('question');
  ok(q2resync.n === 2, 'resync: nomor soal sama (2)');
  ok(!('correct' in q2resync) && !('correctIndex' in q2resync), 'resync: tetap tanpa index jawaban');
  ok(q2resync.scores.you === bScoreAfterQ1, 'resync: skor B utuh (' + q2resync.scores.you + ')');
  ok(q2resync.scores.opp === aScoreAfterQ1, 'resync: skor A utuh (' + q2resync.scores.opp + ')');
  ok(q2resync.youLocked === false, 'resync: B belum terkunci di Q2');

  // B2 jawab Q2 lalu putus lagi -> resume kedua harus pulihkan status kunci.
  B2.send({ type: 'answer', choice: 1 });
  await A.waitFor('locked');
  B2.terminate();
  await A.waitFor('opponentAway');
  const B3 = new Client(B.name);
  await B3.connect();
  B3.send({ type: 'resume', code: wa.code, token: wb.token });
  await B3.waitFor('welcome');
  const q2lock = await B3.waitFor('question');
  ok(q2lock.n === 2 && q2lock.youLocked === true && q2lock.yourChoice === 1,
     'resync kedua: status kunci pulih (youLocked, yourChoice=1)');
  await A.waitFor('opponentBack');
  B = B3;

  // Main sampai final.
  A.send({ type: 'answer', choice: 2 });
  let lastScores = null;
  const r2 = await A.waitFor('reveal');
  const r2b = await B.waitFor('reveal'); // konsumsi reveal Q2 di B juga, biar inbox sejajar
  ok(JSON.stringify(r2.scores) === JSON.stringify(r2b.scores), 'reveal Q2 konsisten di 2 klien');
  lastScores = r2.scores;
  for (let n = 3; n <= 20; n++) {
    const [qa, qb] = await Promise.all([A.nextQuestion(n), B.nextQuestion(n)]);
    ok(qa.n === n && qb.n === n, 'Q' + n + ' sinkron setelah resume');
    A.send({ type: 'answer', choice: n % 4 });
    B.send({ type: 'answer', choice: (n + 1) % 4 });
    const [ra, rb] = await Promise.all([A.waitFor('reveal'), B.waitFor('reveal')]);
    ok(JSON.stringify(ra.scores) === JSON.stringify(rb.scores), 'Q' + n + ' skor konsisten');
    lastScores = ra.scores;
  }
  const [fa, fb] = await Promise.all([A.waitFor('final'), B.waitFor('final')]);
  const totA = lastScores.find(x => x.name === A.name).score;
  const totB = lastScores.find(x => x.name === B.name).score;
  ok(fa.standings.find(x => x.name === A.name).score === totA &&
     fa.standings.find(x => x.name === B.name).score === totB,
     'final setelah resume: total = akumulasi reveal');
  ok(JSON.stringify(fa.standings) === JSON.stringify(fb.standings), 'final identik di 2 klien');
  A.close(); B.close();
}

async function scenarioGraceExpiry() {
  console.log('\n== SKENARIO 2: GRACE HABIS ==');
  const C = new Client('HostGrace');
  const D = new Client('TamuGrace');
  await C.connect(); await D.connect();
  C.send({ type: 'create', name: C.name, mode: 'kpop' });
  const wc = await C.waitFor('welcome');
  D.send({ type: 'join', name: D.name, code: wc.code });
  const wd = await D.waitFor('welcome');
  let lob = await C.waitFor('lobby');
  while (!lob.canStart) lob = await C.waitFor('lobby');
  C.send({ type: 'start' });
  await Promise.all([C.nextQuestion(1), D.nextQuestion(1)]);
  D.terminate();
  await C.waitFor('opponentAway');
  ok(true, 'C dapat opponentAway');
  const left = await C.waitFor('opponentLeft', 15000);
  ok(left.name === D.name, 'setelah grace habis C dapat opponentLeft');
  const lob2 = await C.waitFor('lobby');
  ok(lob2.players.length === 1, 'room balik lobby dengan 1 pemain');
  const D2 = new Client(D.name);
  await D2.connect();
  D2.send({ type: 'resume', code: wc.code, token: wd.token });
  const err = await D2.waitFor('error');
  ok(err.code === 'SESSION_GONE', 'resume token lama ditolak SESSION_GONE');
  C.close(); D2.close();
}

(async () => {
  const srv = spawn('node', ['server/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), Q_MS: '8000', REVEAL_MS: '200', GRACE_MS: '4000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stderr.on('data', d => process.stderr.write('[server] ' + d));
  try {
    for (let i = 0; i < 40; i++) {
      try { const r = await fetch(BASE + '/health'); if (r.ok) break; } catch (e) {}
      await sleep(250);
    }
    await scenarioResume();
    await scenarioGraceExpiry();
  } catch (e) {
    failures++;
    console.log('ERROR BESAR:', e.message);
  } finally {
    srv.kill();
  }
  console.log(failures === 0 ? '\nSEMUA TEST RESUME LULUS' : `\n${failures} KEGAGALAN`);
  process.exit(failures === 0 ? 0 : 1);
})();

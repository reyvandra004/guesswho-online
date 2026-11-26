// test-public.js — main SATU game penuh mode LAGU (payload terberat) lewat
// URL PUBLIK tunnel, bukan localhost. Bukti tunnel sanggup bawa game asli.
// Pakai: node server/test-public.js https://<host-tunnel>/
// Koneksi WS: coba langsung dulu; kalau egress VM memblokir, otomatis lewat
// forward socat + HTTP CONNECT proxy (SNI tetap host tunnel).
const { execFileSync } = require('child_process');
const http = require('http');
const https = require('https');
const tls = require('tls');
const WebSocket = require('ws');

const BASE = (process.argv[2] || '').replace(/\/$/, '');
if (!BASE.startsWith('https://')) { console.error('usage: node server/test-public.js https://<host>/'); process.exit(2); }
const HOST = new URL(BASE).hostname;
const WSURL = 'wss://' + HOST;

// Agent HTTP CONNECT sederhana buat narik koneksi WS keluar lewat egress
// proxy sandbox (env http_proxy). Jalur socat TERBUKTI merusak upgrade WS
// di lingkungan ini (502/hang), jalur CONNECT murni ini yang dipakai curl.
class ConnectAgent extends https.Agent {
  createConnection(opts, cb) {
    const purl = new URL(process.env.https_proxy || process.env.http_proxy || '');
    const auth = 'Basic ' + Buffer.from(
      decodeURIComponent(purl.username) + ':' + decodeURIComponent(purl.password)).toString('base64');
    const req = http.request({ host: purl.hostname, port: purl.port, method: 'CONNECT',
      path: opts.host + ':' + (opts.port || 443),
      headers: { Host: opts.host + ':' + (opts.port || 443), 'Proxy-Authorization': auth } });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); cb(new Error('proxy CONNECT status ' + res.statusCode)); return; }
      const tlsSock = tls.connect({ socket, servername: opts.host }, () => cb(null, tlsSock));
      tlsSock.on('error', cb);
    });
    req.on('error', cb);
    req.end();
  }
}

let failures = 0, disconnects = 0, gameDone = false;
function ok(cond, label) {
  if (cond) console.log('  PASS', label);
  else { failures++; console.log('  FAIL', label); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function curlOk(url) {
  try {
    const out = execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '25', url]).toString();
    return out.trim();
  } catch (e) { return 'ERR'; }
}

const wsEndpoint = WSURL, wsOpts = { agent: new ConnectAgent() };
async function prepareTransport() {
  console.log('transport: WS lewat HTTP CONNECT proxy ke', WSURL);
}

class Client {
  constructor(name) { this.name = name; this.inbox = []; this.waiters = []; this.closed = false; }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(wsEndpoint, wsOpts);
      this.ws.on('open', res); this.ws.on('error', rej);
      this.ws.on('close', () => { this.closed = true; if (!gameDone) disconnects++; });
      this.ws.on('message', raw => {
        const m = JSON.parse(raw);
        let consumed = false;
        this.waiters = this.waiters.filter(w => { const hit = w(m); if (hit) consumed = true; return !hit; });
        if (!consumed) this.inbox.push(m);
      });
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  waitFor(type, timeout = 60000) {
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
      const m = await this.waitFor('question', 60000);
      if (m.n === n) return m;
    }
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

(async () => {
  const t0 = Date.now();
  try {
    ok(curlOk(BASE + '/') === '200', 'GET / lewat URL publik = 200');
    ok(curlOk(BASE + '/health') === '200', 'GET /health lewat URL publik = 200');
    await prepareTransport();

    const A = new Client('PublikHost'), B = new Client('PublikTamu');
    await A.connect(); await B.connect();
    A.send({ type: 'create', name: A.name, mode: 'lagu' });
    const wa = await A.waitFor('welcome');
    ok(!!wa.code, 'room dibuat lewat publik: ' + wa.code);
    B.send({ type: 'join', name: B.name, code: wa.code });
    await B.waitFor('welcome');
    let lob = await A.waitFor('lobby');
    while (!lob.canStart) lob = await A.waitFor('lobby');
    A.send({ type: 'start' });

    let maxPayload = 0, mediaFetched = false, scoreA = 0, scoreB = 0;
    for (let n = 1; n <= 20; n++) {
      const [qa, qb] = await Promise.all([A.nextQuestion(n), B.nextQuestion(n)]);
      maxPayload = Math.max(maxPayload, JSON.stringify(qa).length);
      ok(qa.audio && /^\/media\/[a-z0-9-]+\.mp3$/.test(qa.audio), `Q${n} audio URL media`);
      ok(qa.qtext === qb.qtext && JSON.stringify(qa.options) === JSON.stringify(qb.options), `Q${n} identik di 2 klien`);
      if (!mediaFetched) {
        mediaFetched = true;
        const code = curlOk(BASE + qa.audio);
        ok(code === '200', 'file klip Q1 keambil via HTTP publik (' + code + ')');
      }
      A.send({ type: 'answer', choice: n % 4 });
      B.send({ type: 'answer', choice: (n + 1) % 4 });
      const [ra] = await Promise.all([A.waitFor('reveal', 60000), B.waitFor('reveal', 60000)]);
      scoreA = ra.scores.find(x => x.name === A.name).score;
      scoreB = ra.scores.find(x => x.name === B.name).score;
      if (A.closed || B.closed) { ok(false, `koneksi putus di Q${n}`); break; }
    }
    const [fa, fb] = await Promise.all([A.waitFor('final', 60000), B.waitFor('final', 60000)]);
    ok(fa.standings.find(x => x.name === A.name).score === scoreA &&
       fa.standings.find(x => x.name === B.name).score === scoreB, 'final: skor = akumulasi reveal');
    ok(JSON.stringify(fa.standings) === JSON.stringify(fb.standings), 'final identik');
    gameDone = true; // close setelah ini disengaja, bukan disconnect
    A.close(); B.close();
    await sleep(300);
    ok(disconnects === 0, `nol disconnect selama game publik (disconnects=${disconnects})`);
    console.log(`payload soal terbesar: ${maxPayload} byte | durasi game: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    failures++;
    console.log('ERROR BESAR:', e.message);
  }
  console.log(failures === 0 ? '\nTEST PUBLIK LULUS' : `\n${failures} KEGAGALAN`);
  process.exit(failures === 0 ? 0 : 1);
})();

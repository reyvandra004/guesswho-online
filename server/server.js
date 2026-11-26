// GUESS WHO ONLINE — server WebSocket multiplayer 2 pemain (head-to-head).
// Satu port: HTTP menyajikan client + file media, WebSocket buat game.
// SERVER-AUTHORITATIVE: soal dibuat server, index jawaban benar TIDAK PERNAH
// dikirim ke klien sebelum reveal. Skor dihitung server.
// KETAHANAN KONEKSI: tiap pemain dapat resume token. Soket putus TIDAK langsung
// mengakhiri game: slot pemain ditahan GRACE_MS (default 60 detik) dan klien
// bisa resume buat dapat state resync penuh. Media (foto/klip) disajikan lewat
// HTTP /media/<file> dengan cache panjang, payload WS hanya teks/opsi.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { buildQuestions, MODES, counts } = require('./questions');
const { MEDIA_DIR, mediaCounts } = require('./media');

const PORT = process.env.PORT || 3188;
const CLIENT = path.join(__dirname, '..', 'client', 'index.html');
const Q_MS = +(process.env.Q_MS || 15000);          // durasi tiap soal
const REVEAL_MS = +(process.env.REVEAL_MS || 2500);  // jeda reveal sebelum soal berikutnya
const GRACE_MS = +(process.env.GRACE_MS || 60000);   // masa tenggang resume setelah putus
const TOTAL_Q = 20;

const MIME = { '.jpg': 'image/jpeg', '.png': 'image/png', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4' };

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') {
    fs.readFile(CLIENT, (err, data) => {
      if (err) { res.writeHead(500); res.end('client tidak ditemukan'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else if (url.startsWith('/media/')) {
    const name = path.basename(url); // cegah path traversal
    const file = path.join(MEDIA_DIR, name);
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('media tidak ditemukan'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(name)] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable' });
      res.end(data);
    });
  } else if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, counts, media: mediaCounts }));
  } else { res.writeHead(404); res.end('not found'); }
});

const wss = new WebSocketServer({ server });
const rooms = new Map();
let nextPlayerId = 1;

function makeCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (rooms.has(code));
  return code;
}
function send(ws, obj) { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); } catch (e) {} } }
function sendErr(ws, code, message) { send(ws, { type: 'error', code, message }); }
const opp = (room, me) => room.players.find(p => p !== me);

function newPlayer(ws, name) {
  return { id: nextPlayerId++, name: String(name || 'Pemain').slice(0, 20) || 'Pemain',
           ws, token: crypto.randomBytes(18).toString('hex'),
           score: 0, right: 0, hints: 3, awaySince: null, graceTimer: null };
}

function lobbyState(room) {
  return { type: 'lobby', code: room.code, mode: room.mode, phase: room.phase,
    players: room.players.map(p => ({ id: p.id, name: p.name, isHost: p.id === room.hostId, connected: !!p.ws })),
    canStart: room.phase === 'lobby' && room.players.length === 2 && room.players.every(p => p.ws) };
}
function broadcastLobby(room) { room.players.forEach(p => send(p.ws, lobbyState(room))); }

function publicQuestion(room, me) {
  const q = room.questions[room.idx];
  const o = opp(room, me);
  const myAns = room.answers.get(me.id);
  const hintUsed = room.hintUsed.has(me.id);
  return { type: 'question', n: room.idx + 1, total: TOTAL_Q,
    badge: q.badge, bcls: q.bcls, qtext: q.qtext, clueText: q.clueText,
    photo: q.photo, audio: q.audio, audioSid: q.audioSid || null,
    options: q.options, deadline: room.deadline, dur: Q_MS,
    hintsLeft: me.hints,
    // field resync (dipakai klien saat resume di tengah soal; saat soal baru
    // nilainya selalu false/null)
    youLocked: !!myAns, yourChoice: myAns ? myAns.choice : null,
    oppLocked: o ? room.answers.has(o.id) : false,
    hintUsedQ: hintUsed, yourHint: hintUsed ? q.hint : null,
    scores: { you: me.score, opp: o ? o.score : 0 },
    oppName: o ? o.name : '', myName: me.name };
}

function startGame(room) {
  room.questions = buildQuestions(room.mode);
  room.idx = 0;
  room.players.forEach(p => { p.score = 0; p.right = 0; p.hints = 3; });
  room.phase = 'playing';
  room.lastReveal = null; room.finalData = null;
  nextQuestion(room);
}

function nextQuestion(room) {
  if (room.idx >= TOTAL_Q) return finishGame(room);
  room.answers = new Map(); // playerId -> {choice, at}
  room.hintUsed = new Set();
  room.deadline = Date.now() + Q_MS;
  room.phase = 'playing';
  clearTimeout(room.timer);
  room.timer = setTimeout(() => reveal(room), Q_MS + 150);
  room.players.forEach(p => send(p.ws, publicQuestion(room, p)));
}

function reveal(room) {
  if (room.phase !== 'playing') return;
  room.phase = 'reveal';
  clearTimeout(room.timer);
  const q = room.questions[room.idx];
  const results = room.players.map(p => {
    const a = room.answers.get(p.id);
    const hintUsed = room.hintUsed.has(p.id);
    let pts = 0, correct = false;
    if (a && a.choice === q.correct) {
      correct = true;
      const left = Math.max(0, (room.deadline - a.at) / 1000);
      pts = 100 + Math.round(left) * 5 - (hintUsed ? 25 : 0);
      if (pts < 10) pts = 10;
      p.score += pts; p.right++;
    }
    return { playerId: p.id, name: p.name, choice: a ? a.choice : null,
             correct, points: pts, hintUsed };
  });
  room.lastReveal = { type: 'reveal', n: room.idx + 1,
    correctIndex: q.correct, correctLabel: q.correctLabel, correctSub: q.correctSub,
    results, scores: room.players.map(p => ({ playerId: p.id, name: p.name, score: p.score, right: p.right })) };
  room.players.forEach(p => send(p.ws, room.lastReveal));
  room.idx++;
  clearTimeout(room.revealTimer);
  room.revealTimer = setTimeout(() => { if (rooms.has(room.code)) nextQuestion(room); }, REVEAL_MS);
}

function finalMsg(room, me) {
  const fd = room.finalData;
  return { type: 'final', standings: fd.standings, winner: fd.winner,
    youWin: fd.winner !== null && fd.winner === me.name, draw: fd.winner === null };
}
function finishGame(room) {
  room.phase = 'over';
  const st = room.players.map(p => ({ playerId: p.id, name: p.name, score: p.score, right: p.right }));
  let winner = null;
  if (st.length === 2 && st[0].score !== st[1].score) winner = st[0].score > st[1].score ? st[0].name : st[1].name;
  room.finalData = { standings: st, winner };
  room.players.forEach(p => send(p.ws, finalMsg(room, p)));
}

// Kirim ulang state terkini ke pemain yang baru resume, sesuai fase room.
function resync(room, me) {
  if (room.phase === 'lobby') { send(me.ws, lobbyState(room)); return; }
  if (room.phase === 'playing') { send(me.ws, publicQuestion(room, me)); return; }
  if (room.phase === 'reveal') {
    if (room.lastReveal) send(me.ws, room.lastReveal);
    // revealTimer server tetap jalan: soal berikutnya tiba seperti biasa.
    return;
  }
  if (room.phase === 'over') { if (room.finalData) send(me.ws, finalMsg(room, me)); return; }
}

// Lepas pemain dari room secara permanen (keluar sukarela / grace habis).
function removePlayer(room, me) {
  if (me.graceTimer) { clearTimeout(me.graceTimer); me.graceTimer = null; }
  const wasInGame = room.phase === 'playing' || room.phase === 'reveal' || room.phase === 'over';
  room.players = room.players.filter(p => p !== me);
  if (!room.players.length) {
    clearTimeout(room.timer); clearTimeout(room.revealTimer);
    rooms.delete(room.code);
    return;
  }
  if (room.hostId === me.id) {
    const rest = room.players.find(p => p.ws) || room.players[0];
    if (rest) room.hostId = rest.id;
  }
  if (wasInGame) {
    clearTimeout(room.timer); clearTimeout(room.revealTimer);
    room.phase = 'lobby'; room.questions = null; room.idx = 0; room.lastReveal = null; room.finalData = null;
    room.players.forEach(p => send(p.ws, { type: 'opponentLeft', name: me.name }));
  }
  broadcastLobby(room);
}

wss.on('connection', ws => {
  let me = null, room = null, explicitLeave = false;

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }

    if (m.type === 'ping') { send(ws, { type: 'pong' }); return; }

    if (m.type === 'create') {
      if (me) { sendErr(ws, 'ALREADY_IN_ROOM', 'Kamu sudah di dalam room.'); return; }
      const mode = MODES.includes(m.mode) ? m.mode : 'drama';
      room = { code: makeCode(), players: [], phase: 'lobby', mode, hostId: null,
               questions: null, idx: 0, deadline: 0, answers: new Map(), hintUsed: new Set(),
               timer: null, revealTimer: null, lastReveal: null, finalData: null };
      me = newPlayer(ws, m.name);
      room.players.push(me); room.hostId = me.id;
      rooms.set(room.code, room);
      send(ws, { type: 'welcome', playerId: me.id, code: room.code, isHost: true, token: me.token });
      broadcastLobby(room);
    }
    else if (m.type === 'join') {
      if (me) { sendErr(ws, 'ALREADY_IN_ROOM', 'Kamu sudah di dalam room.'); return; }
      const r = rooms.get(String(m.code || '').toUpperCase().trim());
      if (!r) { sendErr(ws, 'ROOM_NOT_FOUND', 'Kode room tidak ditemukan. Cek lagi kode dari host.'); return; }
      if (r.phase !== 'lobby') { sendErr(ws, 'GAME_RUNNING', 'Game di room ini sudah berjalan.'); return; }
      if (r.players.length >= 2) { sendErr(ws, 'ROOM_FULL', 'Room sudah penuh (2 pemain).'); return; }
      room = r; me = newPlayer(ws, m.name);
      room.players.push(me);
      send(ws, { type: 'welcome', playerId: me.id, code: room.code, isHost: false, token: me.token });
      broadcastLobby(room);
    }
    else if (m.type === 'resume') {
      if (me) return; // koneksi ini sudah terikat ke pemain
      const r = rooms.get(String(m.code || '').toUpperCase().trim());
      const p = r && r.players.find(x => x.token && x.token === String(m.token || ''));
      if (!r || !p) { sendErr(ws, 'SESSION_GONE', 'Sesi sebelumnya sudah tidak ada.'); return; }
      if (p.ws && p.ws !== ws) { try { p.ws.close(); } catch (e) {} }
      if (p.graceTimer) { clearTimeout(p.graceTimer); p.graceTimer = null; }
      p.ws = ws; p.awaySince = null;
      room = r; me = p;
      send(ws, { type: 'welcome', playerId: me.id, code: room.code,
                 isHost: room.hostId === me.id, token: me.token, resumed: true });
      const o = opp(room, me);
      if (o) send(o.ws, { type: 'opponentBack', name: me.name });
      resync(room, me);
      if (room.phase === 'lobby') broadcastLobby(room);
    }
    else if (!room || !me) { sendErr(ws, 'NOT_IN_ROOM', 'Belum masuk room.'); }
    else if (m.type === 'mode') {
      if (room.phase !== 'lobby' || room.hostId !== me.id) return;
      if (MODES.includes(m.mode)) { room.mode = m.mode; broadcastLobby(room); }
    }
    else if (m.type === 'start') {
      if (room.phase !== 'lobby' || room.hostId !== me.id) return;
      if (!(room.players.length === 2 && room.players.every(p => p.ws))) {
        sendErr(ws, 'NEED_TWO_PLAYERS', 'Butuh 2 pemain yang terhubung buat mulai.'); return; }
      startGame(room);
    }
    else if (m.type === 'answer') {
      if (room.phase !== 'playing') return;
      if (room.answers.has(me.id)) return;
      const choice = Number.isInteger(m.choice) ? m.choice : -1;
      if (choice < 0 || choice > 3) return;
      room.answers.set(me.id, { choice, at: Date.now() });
      const o = opp(room, me);
      if (o) send(o.ws, { type: 'locked', who: 'opp' });
      send(me.ws, { type: 'locked', who: 'you' });
      // Reveal begitu SEMUA slot pemain sudah jawab. Pemain yang lagi away
      // tidak memicu reveal lebih awal: dia dinilai timeout di deadline.
      if (room.answers.size >= room.players.length) reveal(room);
    }
    else if (m.type === 'hint') {
      if (room.phase !== 'playing') return;
      if (room.hintUsed.has(me.id)) return;
      if (me.hints <= 0) { sendErr(ws, 'NO_HINTS', 'Clue tambahan habis.'); return; }
      me.hints--; room.hintUsed.add(me.id);
      const q = room.questions[room.idx];
      send(me.ws, { type: 'hint', text: q.hint, hintsLeft: me.hints });
    }
    else if (m.type === 'rematch') {
      if (room.phase !== 'over' || room.hostId !== me.id) return;
      if (!(room.players.length === 2 && room.players.every(p => p.ws))) return;
      startGame(room);
    }
    else if (m.type === 'leave') {
      explicitLeave = true;
      ws.close();
    }
  });

  ws.on('close', () => {
    if (!room || !me) return;
    const r = room, p = me;
    me = null; room = null;
    if (p.ws && p.ws !== ws) return; // soket basi: pemain sudah resume di soket lain
    p.ws = null;
    if (explicitLeave) { removePlayer(r, p); return; }
    // Putus biasa: tahan slot selama GRACE_MS, kasih tau lawan, tunggu resume.
    p.awaySince = Date.now();
    const o = opp(r, p);
    if (o) send(o.ws, { type: 'opponentAway', name: p.name });
    if (r.phase === 'lobby') broadcastLobby(r);
    if (p.graceTimer) clearTimeout(p.graceTimer);
    p.graceTimer = setTimeout(() => {
      p.graceTimer = null;
      if (p.ws) return;             // sudah resume
      if (!rooms.has(r.code)) return;
      removePlayer(r, p);
    }, GRACE_MS);
  });
});

server.listen(PORT, () => console.log(`GUESS WHO ONLINE jalan di http://localhost:${PORT} | dataset:`, counts, '| media:', mediaCounts));

// questions.js — pembangun soal GUESS WHO ONLINE.
// Port setia dari logika v7 offline (buildQuestions/nextQDrama, buildKpopQuestions/makeKpopQ,
// buildSongQuestions/makeSongQ). Bedanya: jalan di SERVER, dan tiap soal menyimpan
// `correct` (index) yang TIDAK PERNAH dikirim ke klien sebelum reveal.
const { DS, urlFor } = require('./media');

const DATA = DS.drama, KPGROUPS = DS.kpgroups, KPIDOLS = DS.kpidols, SONGS = DS.songs;

function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function prefPick(arr, scoreFn) {
  return shuffle(arr.map(x => ({ x, s: scoreFn(x) + Math.random() })))
    .sort((a, b) => b.s - a.s).slice(0, 3).map(o => o.x);
}
// options internal: [{label, sub?, ok}] -> soal internal {options:[{label,sub}], correct}
function finishQ(q) {
  q.correct = q.options.findIndex(o => o.ok);
  q.options = q.options.map(o => ({ label: o.label, sub: o.sub || null }));
  return q;
}

// ================= K-DRAMA =================
function buildDramaQuestions() {
  const byDrama = {};
  DATA.forEach(e => { (byDrama[e.drama] = byDrama[e.drama] || []).push(e); });
  const dramas = shuffle(Object.keys(byDrama)).slice(0, 20);
  const entries = dramas.map(d => pick(byDrama[d]));
  const types = shuffle(['A','A','A','A','A','A','A','A','A','A','B','B','B','B','B','B','B','B','B','B']);
  return entries.map((e, i) => makeDramaQ(e, types[i]));
}
function makeDramaQ(e, type) {
  const isA = type === 'A';
  const others = shuffle(DATA.filter(d => d.id !== e.id && d.drama !== e.drama)).slice(0, 3);
  const opts = shuffle([e, ...others]);
  return finishQ({
    badge: isA ? 'TEBAK FOTO' : 'TEBAK CLUE', bcls: isA ? 'foto' : 'clue',
    photo: isA ? urlFor(e.img) : null, audio: null, clueText: isA ? null : e.clue,
    qtext: isA ? 'Siapakah aktor/aktris di foto ini, sebagai karakter apa dia tampil di sini?'
               : 'Siapakah karakter yang dimaksud clue di atas?',
    options: opts.map(o => ({ label: o.char, sub: o.drama, ok: o.id === e.id })),
    hint: e.extra,
    correctLabel: e.char + ' – ' + e.drama, correctSub: 'diperankan oleh ' + e.name,
  });
}

// ================= K-POP =================
const kpGroup = id => KPGROUPS.find(g => g.id === id);
const kpIdol = id => KPIDOLS.find(x => x.id === id);
const kpIdolsOf = gid => KPIDOLS.filter(x => x.group === gid);

function buildKpopQuestions() {
  const targets = shuffle(['A','A','A','A','A','A','A','B','B','B','B','B','B','B','C','C','C','C','C','C']);
  const elig = (g, t) => t === 'C' ? !!g.photo : kpIdolsOf(g.id).length > 0;
  const pool = shuffle(KPGROUPS), used = new Set(), qs = [];
  for (const t of targets) {
    const g = pool.find(x => !used.has(x.id) && elig(x, t));
    if (!g) continue;
    used.add(g.id);
    const idols = kpIdolsOf(g.id);
    qs.push({ gid: g.id, iid: idols.length ? pick(idols).id : null, type: t });
  }
  for (const g of pool) {
    if (qs.length >= 20) break;
    if (used.has(g.id)) continue;
    used.add(g.id);
    const idols = kpIdolsOf(g.id);
    qs.push({ gid: g.id, iid: idols.length ? pick(idols).id : null, type: idols.length ? 'A' : 'C' });
  }
  return shuffle(qs.slice(0, 20)).map(makeKpopQ);
}
function makeKpopQ(item) {
  const g = kpGroup(item.gid);
  const gw = g.gender === 'girl' ? 'girl group' : 'boy group';
  if (item.type === 'A') {
    const idol = kpIdol(item.iid);
    const variants = [];
    if (idol.role) {
      variants.push('Aku adalah ' + idol.role + ' di ' + gw + ' dengan lagu terkenal "' + pick(g.songs) + '", siapakah aku?');
      variants.push('Aku adalah ' + idol.role + ' di ' + gw + ' naungan ' + g.agency + ' yang debut tahun ' + g.year + ', siapakah aku?');
      variants.push('Aku adalah ' + idol.role + ' di ' + gw + ' generasi ke-' + g.gen + ' yang debut tahun ' + g.year + ', siapakah aku?');
    }
    if (idol.fact) variants.push(idol.fact + ', siapakah aku?');
    const distract = prefPick(KPIDOLS.filter(x => x.group !== g.id),
      x => { const og = kpGroup(x.group); return (og.gender === g.gender ? 2 : 0) + (og.gen === g.gen ? 1 : 0); });
    const options = shuffle([idol, ...distract]).map(x => ({ label: x.name + ' – ' + kpGroup(x.group).name, ok: x.id === idol.id }));
    return finishQ({ badge: 'CLUE IDOL', bcls: 'ka', photo: null, audio: null, clueText: pick(variants),
      qtext: 'Siapakah aku?', options, hint: idol.hint,
      correctLabel: idol.name + ' – ' + g.name,
      correctSub: gw + ' ' + g.name + ', generasi ke-' + g.gen + ' (' + g.year + ')' });
  }
  if (item.type === 'B') {
    const idol = kpIdol(item.iid);
    if (Math.random() < 0.5) {
      const distract = prefPick(KPGROUPS.filter(x => x.id !== g.id),
        x => (x.gender === g.gender ? 2 : 0) + (x.gen === g.gen ? 1 : 0));
      const options = shuffle([g, ...distract]).map(x => ({ label: x.name, ok: x.id === g.id }));
      return finishQ({ badge: 'FOTO SOLO', bcls: 'kb', photo: urlFor(idol.img), audio: null, clueText: null,
        qtext: 'Aku dari grup mana?', options, hint: idol.hint,
        correctLabel: g.name,
        correctSub: gw + ' generasi ke-' + g.gen + ', debut ' + g.year + ', naungan ' + g.agency });
    }
    const agencies = [...new Set(KPGROUPS.map(x => x.agency))].filter(a => a !== g.agency);
    const options = shuffle([g.agency, ...shuffle(agencies).slice(0, 3)]).map(a => ({ label: a, ok: a === g.agency }));
    return finishQ({ badge: 'FOTO SOLO', bcls: 'kb', photo: urlFor(idol.img), audio: null, clueText: null,
      qtext: 'Aku dari agensi mana?', options, hint: idol.hint,
      correctLabel: g.agency, correctSub: 'agensi dari ' + g.name });
  }
  const variant = pick(['nama', 'gen', 'lagu']);
  if (variant === 'nama') {
    const distract = prefPick(KPGROUPS.filter(x => x.id !== g.id),
      x => (x.gender === g.gender ? 2 : 0) + (x.gen === g.gen ? 1 : 0));
    const options = shuffle([g, ...distract]).map(x => ({ label: x.name, ok: x.id === g.id }));
    return finishQ({ badge: 'FOTO GRUP', bcls: 'kc', photo: urlFor(g.photo), audio: null, clueText: null,
      qtext: 'Apa nama grup di foto ini?', options,
      hint: 'Salah satu lagu terkenal mereka adalah "' + g.songs[0] + '". Mereka ' + gw + ' generasi ke-' + g.gen + '.',
      correctLabel: g.name, correctSub: gw + ' generasi ke-' + g.gen + ', debut ' + g.year });
  }
  if (variant === 'gen') {
    const others = shuffle([1, 2, 3, 4, 5].filter(n => n !== g.gen)).slice(0, 3);
    const options = [g.gen, ...others].sort((a, b) => a - b).map(n => ({ label: 'Generasi ' + n, ok: n === g.gen }));
    return finishQ({ badge: 'FOTO GRUP', bcls: 'kc', photo: urlFor(g.photo), audio: null, clueText: null,
      qtext: 'Grup di foto ini debut di generasi ke berapa?', options,
      hint: 'Mereka debut tahun ' + g.year + ' di bawah naungan ' + g.agency + '.',
      correctLabel: 'Generasi ' + g.gen, correctSub: g.name + ' debut tahun ' + g.year });
  }
  const distract = prefPick(KPGROUPS.filter(x => x.id !== g.id),
    x => (x.gen === g.gen ? 2 : 0) + (x.gender === g.gender ? 1 : 0));
  const options = shuffle([{ label: g.songs[0], ok: true },
    ...distract.map(x => ({ label: x.songs[0], ok: false }))]);
  return finishQ({ badge: 'FOTO GRUP', bcls: 'kc', photo: urlFor(g.photo), audio: null, clueText: null,
    qtext: 'Apa lagu terkenal dari grup di foto ini?', options,
    hint: 'Mereka adalah ' + gw + ' naungan ' + g.agency + ' yang debut tahun ' + g.year + '.',
    correctLabel: g.songs[0], correctSub: 'lagu terkenal ' + g.name });
}

// ================= LAGU KOREA =================
const sgSong = id => SONGS.find(x => x.id === id);
function buildSongQuestions() {
  const byArtist = {};
  SONGS.forEach(x => { (byArtist[x.akey] = byArtist[x.akey] || []).push(x); });
  const keys = shuffle(Object.keys(byArtist)).slice(0, 20);
  const types = shuffle(['T','T','T','T','T','T','T','T','T','T','A','A','A','A','A','A','A','A','A','A']);
  return shuffle(keys.map((k, i) => ({ sid: pick(byArtist[k]).id, type: types[i] }))).map(makeSongQ);
}
function makeSongQ(item) {
  const sg = sgSong(item.sid);
  const sub = sg.type === 'ost' ? ('OST drama ' + sg.link + ' • ' + sg.year) : ('Lagu ' + sg.link + ' • ' + sg.year);
  if (item.type === 'A') {
    const pool = [...new Map(SONGS.filter(x => x.type === sg.type && x.akey !== sg.akey)
      .map(x => [x.akey, x.artist])).values()];
    const distract = shuffle(pool).slice(0, 3);
    const options = shuffle([sg.artist, ...distract]).map(a => ({ label: a, ok: a === sg.artist }));
    return finishQ({ badge: 'DENGAR LAGU', bcls: 'la', photo: null, audio: urlFor(sg.clip), audioSid: sg.id, clueText: null,
      qtext: 'Siapa yang menyanyikan lagu ini?', options, hint: sg.hint,
      correctLabel: sg.artist, correctSub: 'penyanyi "' + sg.title + '" (' + sg.year + ')' });
  }
  const distract = prefPick(SONGS.filter(x => x.id !== sg.id),
    x => (x.type === sg.type ? 2 : 0) + (Math.abs(x.year - sg.year) <= 6 ? 1 : 0));
  const options = shuffle([{ label: sg.title + ' – ' + sg.artist, ok: true },
    ...distract.map(x => ({ label: x.title + ' – ' + x.artist, ok: false }))]);
  return finishQ({ badge: 'DENGAR LAGU', bcls: 'la', photo: null, audio: urlFor(sg.clip), audioSid: sg.id, clueText: null,
    qtext: 'Lagu apa ini?', options, hint: sg.hint,
    correctLabel: sg.title + ' – ' + sg.artist, correctSub: sub });
}

const BUILDERS = { drama: buildDramaQuestions, kpop: buildKpopQuestions, lagu: buildSongQuestions };
const MODES = Object.keys(BUILDERS);
function buildQuestions(mode) { return BUILDERS[mode](); }

module.exports = { buildQuestions, MODES, counts: {
  dramaEntries: DATA.length, dramas: new Set(DATA.map(e => e.drama)).size,
  groups: KPGROUPS.length, idols: KPIDOLS.length,
  songs: SONGS.length, artists: new Set(SONGS.map(x => x.akey)).size } };

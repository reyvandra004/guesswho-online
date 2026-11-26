// media.js — ekstrak media (foto JPG + klip MP3) dari data/dataset.json jadi
// file statis di server/media/ supaya payload WebSocket kecil: soal cuma kirim
// URL /media/<hash>.<ext>, browser yang ambil medianya lewat HTTP (dan cache).
// Idempoten: file yang sudah ada tidak ditulis ulang. Dataset asli tidak diubah.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const MEDIA_DIR = path.join(__dirname, 'media');
const DS = require('../data/dataset.json');

// Klip lagu di dataset 64kbps (~80KB/10 detik). Buat versi online di-encode
// ulang ke 40kbps mono (~50KB) supaya tunnel gratis tidak cepat jebol;
// kualitasnya lebih dari cukup buat game tebak lagu. Hasil encode di-cache
// sebagai file <hashInput>-40k.mp3, jadi restart server tidak encode ulang.
function shrinkClip(buf) {
  const inHash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
  const name = inHash + '-40k.mp3';
  const file = path.join(MEDIA_DIR, name);
  if (fs.existsSync(file)) return { file, name, buf: fs.readFileSync(file) };
  const tmpIn = path.join(os.tmpdir(), 'gw-clip-' + inHash + '.mp3');
  const tmpOut = path.join(os.tmpdir(), 'gw-clip-' + inHash + '-40k.mp3');
  fs.writeFileSync(tmpIn, buf);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', tmpIn, '-ac', '1', '-ar', '22050', '-b:a', '40k', tmpOut]);
  const out = fs.readFileSync(tmpOut);
  fs.writeFileSync(file, out);
  fs.unlinkSync(tmpIn); fs.unlinkSync(tmpOut);
  return { file, name, buf: out };
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a' };
const urlByUri = new Map();
let fileCount = 0, byteCount = 0;

function urlFor(uri) {
  if (!uri) return null;
  const hit = urlByUri.get(uri);
  if (hit) return hit;
  const m = /^data:([^;,]+);base64,(.+)$/.exec(uri);
  if (!m) return uri; // bukan data URI (mis. sudah URL) -> pakai apa adanya
  const ext = EXT[m[1]] || 'bin';
  let buf = Buffer.from(m[2], 'base64');
  let name;
  if (m[1] === 'audio/mpeg') {
    const shrunk = shrinkClip(buf);
    name = shrunk.name; buf = shrunk.buf;
  } else {
    name = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '.' + ext;
    const file = path.join(MEDIA_DIR, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
  }
  fileCount++; byteCount += buf.length;
  const url = '/media/' + name;
  urlByUri.set(uri, url);
  return url;
}

fs.mkdirSync(MEDIA_DIR, { recursive: true });
// Sentuh semua field media yang dikenal supaya file + map lengkap sejak start.
for (const e of DS.drama) urlFor(e.img);
for (const g of DS.kpgroups) urlFor(g.photo);
for (const i of DS.kpidols) urlFor(i.img);
for (const s of DS.songs) urlFor(s.clip);

module.exports = { DS, urlFor, MEDIA_DIR,
  mediaCounts: { files: fileCount, bytes: byteCount, urls: urlByUri.size } };

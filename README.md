# GUESS WHO ONLINE

Versi online 2 pemain dari game GUESS WHO (K-Drama × K-Pop × Lagu Korea).
Dua pemain main head-to-head dari HP masing-masing lewat **kode room 6 karakter**
atau **link undangan**. File offline `guess-who-kdrama-v7.html` TIDAK terpengaruh
dan tetap bisa dimainkan sendiri seperti biasa.

**URL publik saat ini: https://13329cf7b5cc02.app.lhr.life**
(tunnel localhost.run, dibuat 25 Nov 2026 malam setelah perbaikan di bawah.
URL bisa rotasi kalau tunnel di-restart; cek `lhr.log` buat URL terakhir.)

## Cara jalanin (server)

```bash
cd ~/workspace/game-guesswho-online
nohup node server/server.js > server.log 2>&1 &   # port default 3188 (env PORT)
```

Buka `http://localhost:3188/`. Endpoint cek: `GET /health`.
Env opsional: `Q_MS` (durasi soal, default 15000), `REVEAL_MS` (default 2500),
`GRACE_MS` (masa tenggang resume, default 60000).

## Cara restart tunnel publik (localhost.run)

Egress VM wajib lewat HTTP proxy yang **tokennya rotasi tiap sesi**, jadi
perintah tunnel HARUS menyusun ProxyCommand dari `$http_proxy` yang segar
dalam satu perintah yang sama. SSH juga wajib menunjuk key secara eksplisit
(`-i /home/hatch/.ssh/id_ed25519`), kalau tidak autentikasi localhost.run
ditolak ("Permission denied") karena ssh membaca `~/.ssh` yang salah.

```bash
cd ~/workspace/game-guesswho-online
P="$http_proxy"
USERPASS=$(echo "$P" | sed -E 's|https?://([^@]+)@.*|\1|')
PROXYHOST=$(echo "$P" | sed -E 's|https?://[^@]+@([^:/]+):[0-9]+.*|\1|')
PROXYPORT=$(echo "$P" | sed -E 's|https?://[^@]+@[^:/]+:([0-9]+).*|\1|')
nohup ssh -i /home/hatch/.ssh/id_ed25519 -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 \
  -o ExitOnForwardFailure=yes -o RequestTTY=no \
  -o "ProxyCommand=socat - PROXY:${PROXYHOST}:ssh.localhost.run:22,proxyport=${PROXYPORT},proxyauth=${USERPASS}" \
  -R 80:localhost:3188 ssh.localhost.run > lhr.log 2>&1 &
grep -ao "[a-z0-9]*\.app\.lhr\.life" lhr.log | head -1   # URL publik baru
```

Catatan jalur tunnel (hasil uji 25 Nov 2026): cloudflared quick tunnel gagal
di VM ini (POST ke api.trycloudflare.com tidak lolos proxy). serveo tembus
buat HTTP tapi upgrade WebSocket selalu dijawab **502**. pinggy tembus buat
HTTP tapi koneksi WebSocket digantung/diputus. localhost.run satu-satunya
yang membawa WebSocket sampai 101 dan game penuh. Peringatan "bursting above
the free tier / being slowed" di `lhr.log` masih muncul di tier gratis
(localhost.run menunda, bukan memutus); payload game sekarang sudah ringan
dan ada resume, jadi game tetap bisa jalan.

## Cara main

1. Pemain 1 isi nama, pilih mode (K-DRAMA / K-POP / LAGU), klik **BUAT ROOM**.
2. Di lobby, klik **SALIN LINK UNDANGAN** (format: `https://<host>/?room=KODE6`)
   dan kirim ke temen, ATAU kasih kode room-nya aja.
3. Pemain 2 buka link (kode otomatis terisi), isi nama, klik **GABUNG ROOM**.
   Bisa juga buka halaman utama lalu ketik kode manual.
4. Host klik **MULAI**. 20 soal jalan barengan di dua HP: tiap soal dua-duanya
   jawab, reveal muncul begitu dua-duanya sudah jawab atau waktu habis (15 detik).
5. Skor: benar = **100 + sisa detik ×5**, clue "?" = **−25** (maks 3× per pemain
   per game). Di akhir ada hasil head-to-head + tombol MAIN LAGI (host).

## Ketahanan koneksi (perbaikan 25 Nov 2026 malam)

Kejadian awal: tunnel gratis localhost.run kena throttling "burst" karena
payload soal lama membawa foto/klip base64 lewat WebSocket; koneksi kolaps
di tengah game dan game lama tidak punya reconnect, jadi satu putus = tamat.
Ditambah popup error kode room palsu (lihat bawah). Perbaikannya:

- **Media lewat HTTP, bukan WebSocket.** `server/media.js` mengekstrak semua
  foto/klip dari `data/dataset.json` jadi file di `server/media/`
  (124 file, ±2,7 MB; klip lagu di-encode ulang 40kbps mono ±50KB dari
  aslinya 64kbps ±80KB, khusus salinan online). Payload soal sekarang cuma
  teks + URL `/media/<file>` (±600 byte), disajikan dengan
  `Cache-Control: public, max-age=31536000, immutable` jadi rematch dan
  pindah soal nyaris tanpa unduh ulang. Pemutar lagu klien mengambil klip
  via `fetch()` lalu `decodeAudioData` (tetap di dalam tap, seperti v7).
- **Resume token + masa tenggang 60 detik.** Saat buat/gabung room, server
  memberi tiap pemain token resume (cuma ke pemain itu). Klien menyimpannya
  di `sessionStorage` bersama kode + nama. Kalau soket putus, slot pemain
  DITAHAN 60 detik: lawan dapat pesan "lawan terputus, menunggu reconnect…"
  (bukan game over), timer soal tetap jalan di server (yang putus dinilai
  timeout kalau tidak sempat jawab). Klien auto-reconnect dengan backoff
  (1s, 2s, 4s, … maks 10×) sambil menampilkan banner "Menyambung ulang…",
  lalu mengirim `resume`; server mengikat soket baru ke slot lama dan
  mengirim state lengkap: lobby, ATAU soal berjalan (tanpa index jawaban,
  sisa waktu dari deadline yang sama, status kunci + clue yang sudah
  dipakai dipulihkan), ATAU reveal terakhir, ATAU hasil final. Room baru
  benar-benar berakhir kalau masa tenggang habis atau pemain menekan
  KELUAR (itu langsung, tanpa tenggang). Klien juga mengirim ping
  tiap 20 detik biar jalur tunnel tetap hangat.
- **Popup "kode room salah" palsu dimatikan di sumbernya.** Penyebab lama:
  (1) tiap klik BUAT/GABUNG membuat WebSocket BARU dan menimpa yang lama,
  jadi klik dobel/klik saat koneksi lambat mengirim join dua kali dari dua
  soket; (2) handler error klien mengecat SEMUA pesan error server ke kotak
  merah + toast tanpa konteks, termasuk jawaban atas percobaan duplikat
  itu; (3) room bisa terhapus di server saat soket host putus sesaat,
  sehingga percobaan berikutnya menjawab "tidak ditemukan" padahal undangan
  valid. Sekarang: satu soket persisten dipakai ulang, klik dijaga flag
  pending (tombol nonaktif selama proses), server mengirim error BERKODE
  (`ROOM_NOT_FOUND`, `ROOM_FULL`, `GAME_RUNNING`, `SESSION_GONE`, …) dan
  klien hanya menampilkan error gabung/buat room kalau memang sedang
  menjawab klik sengaja user — dengan teks sesuai sebab sebenarnya
  (gagal transport dibilang gagal tersambung, bukan kode salah). Sesi yang
  masih hidup di tab yang sama disambung ulang otomatis lewat resume,
  bukan dilempar ke form gabung.

## Arsitektur

- `server/server.js` — HTTP (client + `/media/`) + WebSocket satu port.
  **Server-authoritative**: soal dibuat server, index jawaban benar tidak
  pernah dikirim ke klien sebelum reveal, skor dihitung server.
- `server/questions.js` — port setia pembangun soal v7:
  K-Drama 20 drama berbeda (foto/clue), K-Pop 20 grup berbeda
  (CLUE IDOL / FOTO SOLO / FOTO GRUP), Lagu 20 artis berbeda
  (semua soal dengar klip: tebak judul / tebak penyanyi).
- `server/media.js` — ekstrak + sajikan media (lihat atas).
- `client/index.html` — satu halaman (home → lobby → game → final),
  mobile-first, palet elegan v7 + font Archivo Black subset yang sama.
- `data/dataset.json` — dataset hasil ekstrak dari v7 (`data/extract.py`):
  30 entri K-Drama (23 drama), 33 grup + 30 idol K-Pop, 33 lagu (30 artis).

## Test

```bash
node server/test-ws.js                          # 3 mode × 20 soal, 2 klien WS (841 assert)
node server/test-resume.js                      # putus paksa + resume + grace habis (55 assert)
node server/test-public.js https://<host>/      # 1 game LAGU penuh lewat URL PUBLIK
node test-browser/test-browser.mjs              # 2 halaman Chrome lokal (K-Pop)
node test-browser/test-lagu.mjs                 # tap play beneran, klip bunyi (energi terukur)
node test-browser/test-public.mjs https://<host>/  # 2 halaman Chrome lewat URL PUBLIK
```

Hasil (25 Nov 2026, setelah perbaikan): **semua lulus**, termasuk game Lagu
20 soal penuh lewat URL publik dengan **nol disconnect** (payload soal
terbesar 603 byte, durasi game 57 detik), dan test browser publik yang
secara eksplisit memeriksa halaman tamu dari link undangan **tanpa popup
error palsu**. Test publik memakai agent HTTP CONNECT kecil di dalam
skripnya: forward raw-TCP socat terbukti dijawab 502 oleh edge
localhost.run, sedangkan klien CONNECT murni (seperti curl) lolos 101 —
itu jebakan alat ukur di sandbox ini, bukan perilaku tunnel ke user asli.

## Batasan (jujur)

- Tepat **2 pemain per room**; belum ada mode penonton atau >2 pemain.
- Reconnect ada, tapi dibatasi masa tenggang **60 detik**: putus lebih lama
  dari itu dianggap keluar (lawan dapat pemberitahuan, room balik lobby).
  Sesi juga hilang kalau server restart (semua state di memori).
- Tunnel localhost.run gratis **menunda (throttle)** saat traffic ramai:
  klip/foto bisa loading lebih lambat di jam sibuk, dan URL **rotasi**
  tiap tunnel di-restart. Server + tunnel adalah proses latar (nohup):
  mati kalau VM diganti/direstart. Buat pemakaian permanen, deploy ke
  hosting Node biasa (cukup `node server/server.js`, satu port, tanpa
  build step) dan arahkan domain ke sana.

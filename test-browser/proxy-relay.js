// proxy-relay.js — proxy CONNECT lokal tanpa auth buat Chrome headless.
// Chrome tidak bisa pakai proxy ber-credential dari --proxy-server, dan
// forward raw-TCP socat terbukti dijawab 502 oleh edge localhost.run.
// Relay ini menerima CONNECT dari Chrome, lalu membuka CONNECT sendiri ke
// egress proxy sandbox (dengan auth dari env) — persis pola curl/Python
// yang terbukti lolos. Pakai: node test-browser/proxy-relay.js [port]
const http = require('http');

const PORT = +(process.argv[2] || 18080);
const purl = new URL(process.env.https_proxy || process.env.http_proxy || '');
const AUTH = 'Basic ' + Buffer.from(
  decodeURIComponent(purl.username) + ':' + decodeURIComponent(purl.password)).toString('base64');

const server = http.createServer();
server.on('connect', (req, clientSocket, head) => {
  const up = http.request({ host: purl.hostname, port: purl.port, method: 'CONNECT',
    path: req.url, headers: { Host: req.url, 'Proxy-Authorization': AUTH } });
  up.on('connect', (res, upSocket) => {
    if (res.statusCode !== 200) {
      clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      upSocket.destroy();
      return;
    }
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length) upSocket.write(head);
    upSocket.pipe(clientSocket);
    clientSocket.pipe(upSocket);
    upSocket.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upSocket.destroy());
  });
  up.on('error', () => clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));
  up.end();
});
server.listen(PORT, '127.0.0.1', () => console.log('proxy relay jalan di 127.0.0.1:' + PORT));

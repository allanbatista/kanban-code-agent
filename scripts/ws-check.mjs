// Dependency-free WebSocket handshake check.
// Usage: node scripts/ws-check.mjs [ws-url]
//   default url: ws://localhost:35000/ws
// Exits 0 and prints OK if the server completes the WS upgrade (HTTP 101);
// exits 1 with a diagnosis otherwise. Use it against the server you actually
// have running to confirm whether its /ws endpoint is alive.

import http from 'node:http';
import crypto from 'node:crypto';

const raw = process.argv[2] ?? 'ws://localhost:35000/ws';
const u = new URL(raw.replace(/^ws/, 'http'));
const key = crypto.randomBytes(16).toString('base64');

const req = http.request({
  hostname: u.hostname.replace(/^\[|\]$/g, ''),
  port: u.port || 80,
  path: u.pathname + u.search,
  method: 'GET',
  headers: {
    Connection: 'Upgrade',
    Upgrade: 'websocket',
    'Sec-WebSocket-Version': '13',
    'Sec-WebSocket-Key': key,
    // Mimic a browser served from a different origin (e.g. Vite on :8888).
    Origin: process.env.WS_CHECK_ORIGIN ?? 'http://localhost:8888',
  },
});

const timer = setTimeout(() => {
  console.log(`FALHOU: timeout conectando em ${raw} (servidor nao respondeu).`);
  req.destroy();
  process.exit(1);
}, 4000);

req.on('upgrade', () => {
  clearTimeout(timer);
  console.log(`OK: ${raw} respondeu 101 Switching Protocols. O /ws esta funcionando.`);
  process.exit(0);
});

req.on('response', (res) => {
  clearTimeout(timer);
  console.log(
    `FALHOU: ${raw} respondeu HTTP ${res.statusCode} (esperava 101). ` +
      'O /ws nao aceitou o upgrade — servidor provavelmente antigo/quebrado. Reinicie-o a partir do codigo atual.',
  );
  process.exit(1);
});

req.on('error', (e) => {
  clearTimeout(timer);
  console.log(`FALHOU: nao foi possivel conectar em ${raw}: ${e.message}`);
  process.exit(1);
});

req.end();

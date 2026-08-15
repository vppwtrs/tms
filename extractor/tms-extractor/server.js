/**
 * TMS Extractor — local server
 *
 * ทำ 2 อย่างเท่านั้น:
 *   1. เสิร์ฟไฟล์ static ใน public/
 *   2. proxy /proxy/* -> https://pdi.vespiario.net/tms-api/*  (แก้ปัญหา CORS)
 *
 * ไม่เก็บ ไม่ log ไม่แตะ credential — header Authorization ถูกส่งผ่านตรง ๆ
 * และไม่เคยถูกเขียนลงดิสก์
 *
 * zero dependency — รันด้วย `node server.js`
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 5173;
const UPSTREAM = 'https://pdi.vespiario.net/tms-api';
const PUBLIC = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

/* ---------------- proxy ---------------- */
function proxy(req, res) {
  const target = new URL(UPSTREAM + req.url.replace(/^\/proxy/, ''));

  const headers = {
    host: target.host,
    accept: 'application/json',
    'content-type': req.headers['content-type'] || 'application/json',
    // tenant header ที่ TMS ต้องการตอน login
    tenant: req.headers['tenant'] || 'root'
  };
  if (req.headers.authorization) headers.authorization = req.headers.authorization;

  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (body.length) headers['content-length'] = body.length;

    const up = https.request(
      { hostname: target.hostname, port: 443, path: target.pathname + target.search, method: req.method, headers },
      r => {
        res.writeHead(r.statusCode, {
          'content-type': r.headers['content-type'] || 'application/json',
          'cache-control': 'no-store'
        });
        r.pipe(res);
      }
    );

    up.on('error', e => {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'upstream unreachable', detail: e.message }));
    });

    if (body.length) up.write(body);
    up.end();
  });
}

/* ---------------- static ---------------- */
function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';

  const file = path.join(PUBLIC, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403).end('forbidden'); return; }

  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

/* ---------------- server ---------------- */
http
  .createServer((req, res) => {
    if (req.url.startsWith('/proxy/')) return proxy(req, res);
    serveStatic(req, res);
  })
  .listen(PORT, () => {
    console.log('');
    console.log('  TMS Extractor');
    console.log('  ─────────────────────────────────────────');
    console.log(`  เปิดเบราว์เซอร์ที่  http://localhost:${PORT}`);
    console.log(`  proxy ไปที่          ${UPSTREAM}`);
    console.log('  หยุดด้วย Ctrl+C');
    console.log('');
  });

/**
 * Production Web Server for Pokémon Black: Legendary Edition
 * Supports Railway, Render, Fly.io, Heroku, Docker, and local hosting.
 * Serves with Cross-Origin Isolation headers for WebAssembly performance.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = '0.0.0.0';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.nds': 'application/octet-stream'
};

const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg']);

const server = http.createServer((req, res) => {
  // CORS & Cross-Origin Isolation Headers for WebAssembly
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Accept-Ranges', 'bytes');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let reqPath = decodeURI(req.url.split('?')[0]);
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  // Safe path resolution
  const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(__dirname, safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const indexPath = path.join(__dirname, 'index.html');
      fs.readFile(indexPath, (indexErr, indexData) => {
        if (indexErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(indexData);
        }
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const etag = `W/"${stats.size}-${stats.mtimeMs}"`;

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304);
      res.end();
      return;
    }

    // ROM chunks are pre-deflated, so only text assets go through gzip.
    const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const shouldCompress = acceptsGzip && COMPRESSIBLE.has(ext);

    const headers = {
      'Content-Type': contentType,
      'Cache-Control': ext === '.bin'
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600, must-revalidate',
      ETag: etag
    };

    if (shouldCompress) {
      headers['Content-Encoding'] = 'gzip';
      headers.Vary = 'Accept-Encoding';
      res.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(zlib.createGzip({ level: 6 })).pipe(res);
      return;
    }

    headers['Content-Length'] = stats.size;
    res.writeHead(200, headers);
    fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 }).pipe(res);
  });
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 70000;

server.listen(PORT, HOST, () => {
  console.log(`========================================================`);
  console.log(` Pokémon Black: Legendary Edition — Production Server`);
  console.log(` Status: Running`);
  console.log(` Host: ${HOST}:${PORT}`);
  console.log(` WebAssembly COOP/COEP Headers: Active`);
  console.log(`========================================================`);
});

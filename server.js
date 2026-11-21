'use strict';
/**
 * Homeland FMS Dashboard: local server.
 *
 * Serves the dashboard on its own port (default 4783) and proxies data from the
 * FMS PostgREST API. The API token stays on this machine (.env) and is never
 * sent to the browser.
 *
 *   node server.js          start
 *   node server.js --open   start and open the browser
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { buildData } = require('./lib/build');

loadEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 4783);
const HOST = process.env.HOST || '127.0.0.1';
const API = (process.env.FMS_API_URL || 'https://asap.homelandgroup.org/api/db').replace(/\/+$/, '');
const TOKEN = (process.env.FMS_API_TOKEN || '').trim();
const CACHE_MS = Number(process.env.CACHE_SECONDS || 60) * 1000;
const PUBLIC = path.join(__dirname, 'public');

if (typeof fetch !== 'function') {
  console.error('This dashboard needs Node.js 18 or newer (built-in fetch). You have ' + process.version + '.');
  process.exit(1);
}
if (!TOKEN) {
  console.error('FMS_API_TOKEN is missing. Copy .env.example to .env and paste the read-only token.');
  process.exit(1);
}

// ---------- PostgREST client ----------
class ApiError extends Error {
  constructor(message, info) { super(message); this.info = info; }
}

async function get(p) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  const started = Date.now();
  let res;
  try {
    res = await fetch(API + '/' + p, {
      headers: { Authorization: 'Bearer ' + TOKEN, Accept: 'application/json' },
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new ApiError(e.name === 'AbortError' ? 'Timed out after 20s' : 'Connection failed: ' + (e.cause?.code || e.message), { request: 'GET /' + p });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  const ms = Date.now() - started;
  if (ms > 5000) console.warn(`[slow] GET /${p} took ${ms} ms`);
  if (!res.ok) {
    let body;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 500); }
    throw new ApiError('HTTP ' + res.status, { request: 'GET /' + p, status: res.status, body });
  }
  return JSON.parse(text);
}

// ---------- cached dataset ----------
let cache = null;      // { at, data }
let inflight = null;   // Promise while a fetch is running

async function getData(force) {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  if (!inflight) {
    inflight = buildData(get)
      .then(data => { cache = { at: Date.now(), data }; return data; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

// ---------- HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });

  if (url.pathname === '/api/data') {
    try {
      const data = await getData(url.searchParams.has('refresh'));
      return send(res, 200, data);
    } catch (e) {
      console.error('[api] ' + e.message, e.info ? JSON.stringify(e.info) : '');
      return send(res, 502, { error: e.message, detail: e.info || null });
    }
  }
  if (url.pathname === '/api/health') {
    return send(res, 200, { ok: true, api: API, cachedAt: cache ? new Date(cache.at).toISOString() : null });
  }

  // static files
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, buf, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Is the dashboard already running? Otherwise set PORT=xxxx in .env.`);
  } else {
    console.error(e);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const link = `http://localhost:${PORT}`;
  console.log(`\n  Homeland FMS Dashboard  →  ${link}\n  Data source: ${API}\n  Press Ctrl+C to stop.\n`);
  if (process.argv.includes('--open')) {
    const cmd = process.platform === 'win32' ? `start "" "${link}"` : process.platform === 'darwin' ? `open "${link}"` : `xdg-open "${link}"`;
    exec(cmd, () => {});
  }
});

// ---------- tiny .env loader (no dependencies) ----------
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

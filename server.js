'use strict';
/**
 * Work Execution (Homeland FMS): local server.
 *
 * Serves the pages on their own port (default 4783) and proxies data from the
 * FMS PostgREST API. The API token stays on this machine (.env) and is never
 * sent to the browser. Every page and data call needs a signed-in user
 * (accounts are managed on the Users page; see lib/auth.js).
 *
 *   node server.js          start
 *   node server.js --open   start and open the browser
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const auth = require('./lib/auth');

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

// ---------- data code (reloaded automatically when lib/build.js changes) ----------
const BUILD = path.join(__dirname, 'lib', 'build.js');
let buildMtime = 0, buildData = null;
function currentBuild() {
  const m = fs.statSync(BUILD).mtimeMs;
  if (m !== buildMtime) {
    delete require.cache[require.resolve(BUILD)];
    buildData = require(BUILD).buildData;
    if (buildMtime) { cache = null; console.log('[reload] lib/build.js changed, using the new version'); }
    buildMtime = m;
  }
  return buildData;
}

// ---------- cached dataset ----------
let cache = null;      // { at, data }
let inflight = null;   // Promise while a fetch is running

async function getData(force) {
  const build = currentBuild();
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  if (!inflight) {
    inflight = build(get)
      .then(data => { cache = { at: Date.now(), data }; return data; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

// ---------- HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp',
};
// files anyone may load before signing in
const PUBLIC_FILES = new Set(['/login.html', '/theme.css', '/theme.js', '/logo.png', '/favicon.png']);
// pages that need a signed-in user (users.html needs an admin)
const PAGES = new Set(['/', '/index.html', '/dashboard.html', '/users.html']);

function send(res, status, body, type = 'application/json', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function redirect(res, to) { res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' }); res.end(); }

// JSON body, max 10 KB
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on('data', c => { size += c.length; if (size > 10240) { reject(new auth.AuthError(413, 'Request too large.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new auth.AuthError(400, 'Invalid request.')); } });
    req.on('error', reject);
  });
}
// state-changing calls must be same-origin JSON (blocks cross-site form posts)
function sameOrigin(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

async function handleAuthApi(req, res, url) {
  const ip = req.socket.remoteAddress || '';
  const user = auth.currentUser(req);
  const p = url.pathname, m = req.method;

  if (p === '/api/session' && m === 'GET') return send(res, 200, { user: user ? auth.pub(user) : null, setupNeeded: auth.setupNeeded() });

  if (m !== 'GET' && !sameOrigin(req)) return send(res, 403, { error: 'Blocked: request must come from this site.' });

  if (p === '/api/setup' && m === 'POST') {
    const u = auth.setup(await readJson(req));
    console.log(`[auth] first admin "${u.username}" created`);
    return send(res, 200, { user: auth.pub(u) }, 'application/json', { 'Set-Cookie': auth.cookieHeader(auth.newSession(u.id), auth.SESSION_HOURS * 3600) });
  }
  if (p === '/api/login' && m === 'POST') {
    const { user: u, token } = auth.login(ip, await readJson(req));
    return send(res, 200, { user: auth.pub(u) }, 'application/json', { 'Set-Cookie': auth.cookieHeader(token, auth.SESSION_HOURS * 3600) });
  }
  if (p === '/api/logout' && m === 'POST') {
    auth.logout(req);
    return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': auth.cookieHeader('', 0) });
  }

  if (!user) return send(res, 401, { error: 'Please sign in.' });

  if (p === '/api/me/password' && m === 'POST') { auth.changeOwnPassword(user, await readJson(req)); return send(res, 200, { ok: true }); }

  if (p === '/api/users' || p.startsWith('/api/users/')) {
    if (user.role !== 'admin') return send(res, 403, { error: 'Only admins can manage users.' });
    const id = p.split('/')[3];
    if (!id && m === 'GET') return send(res, 200, { users: auth.listUsers() });
    if (!id && m === 'POST') { const u = auth.createUser(user, await readJson(req)); console.log(`[auth] ${user.username} created user "${u.username}"`); return send(res, 201, { user: u }); }
    if (id && m === 'PATCH') return send(res, 200, { user: auth.updateUser(user, id, await readJson(req)) });
    if (id && m === 'DELETE') { auth.deleteUser(user, id); return send(res, 200, { ok: true }); }
  }
  return null; // not an auth route
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // accounts and sign-in
  if (url.pathname.startsWith('/api/') && url.pathname !== '/api/data' && url.pathname !== '/api/health') {
    try {
      const done = await handleAuthApi(req, res, url);
      if (done !== null) return;
    } catch (e) {
      if (e instanceof auth.AuthError) return send(res, e.status, { error: e.message });
      console.error('[auth]', e);
      return send(res, 500, { error: 'Something went wrong on the server. See the PowerShell window.' });
    }
    return send(res, 404, { error: 'Not found' });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });

  const user = auth.currentUser(req);
  if (url.pathname.startsWith('/api/') && !user) return send(res, 401, { error: 'Please sign in.' });

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

  // static files: pages need a signed-in user; only the sign-in page and its assets are open
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'Bad request', 'text/plain'); }
  if (PAGES.has(rel)) {
    if (!user) return redirect(res, '/login.html' + (rel === '/' ? '' : '?next=' + encodeURIComponent(rel)));
    if (rel === '/users.html' && user.role !== 'admin') return redirect(res, '/dashboard.html');
  } else if (!PUBLIC_FILES.has(rel) && !user) {
    return redirect(res, '/login.html');
  }
  if (rel === '/login.html' && user) return redirect(res, '/dashboard.html');
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
    console.error(`\nPort ${PORT} is already in use: an older copy of this server is probably still running.\n` +
      `Stop it, then start again. In PowerShell:\n\n` +
      `  Get-NetTCPConnection -LocalPort ${PORT} -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }\n` +
      `  node server.js --open\n`);
  } else {
    console.error(e);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const link = `http://localhost:${PORT}`;
  console.log(`\n  Homeland FMS  →  ${link}\n  Data source: ${API}\n` +
    (auth.setupNeeded() ? `  First run: open the link and create the admin account.\n` : `  Sign in with your user ID and password.\n`) +
    `  Press Ctrl+C to stop.\n`);
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

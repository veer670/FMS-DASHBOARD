'use strict';
/**
 * The dashboard's request handler, shared by:
 *   server.js     on your PC (node server.js)
 *   api/index.js  online on Vercel
 *
 * It serves the pages and proxies data from the FMS PostgREST API. The API
 * token is read from the environment (.env on your PC, Environment Variables on
 * Vercel) and is never sent to the browser. Every page and data call needs a
 * signed-in user (see lib/auth.js).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const auth = require('./auth');
const store = require('./store');
require('./build'); // listed here so Vercel bundles it

const API = (process.env.FMS_API_URL || 'https://asap.homelandgroup.org/api/db').replace(/\/+$/, '');
const TOKEN = () => (process.env.FMS_API_TOKEN || '').trim();
const CACHE_MS = Number(process.env.CACHE_SECONDS || 60) * 1000;
const PUBLIC = path.join(__dirname, '..', 'public');
const HOSTED = store.HOSTED;
const LOG_HINT = HOSTED ? 'See the Logs tab in Vercel.' : 'See the PowerShell window.';

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
      headers: { Authorization: 'Bearer ' + TOKEN(), Accept: 'application/json' },
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

// ---------- data code (on your PC it reloads by itself when lib/build.js changes) ----------
const BUILD = require.resolve('./build');
let buildMtime = 0, buildData = require('./build').buildData;
function currentBuild() {
  if (HOSTED) return buildData;
  const m = fs.statSync(BUILD).mtimeMs;
  if (buildMtime && m !== buildMtime) {
    delete require.cache[BUILD];
    buildData = require(BUILD).buildData;
    cache = null; console.log('[reload] lib/build.js changed, using the new version');
  }
  buildMtime = m;
  return buildData;
}

// ---------- cached dataset (kept as JSON and gzip, ready to send) ----------
let cache = null;      // { at, json, gz }
let inflight = null;   // Promise while a fetch is running

async function getData(force) {
  if (!TOKEN()) throw new ApiError('FMS_API_TOKEN is missing', { fix: HOSTED ? 'Add FMS_API_TOKEN in Vercel > Settings > Environment Variables, then redeploy.' : 'Copy .env.example to .env and paste the read-only token.' });
  const build = currentBuild();
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache;
  if (!inflight) {
    inflight = build(get)
      .then(data => { const json = JSON.stringify(data); cache = { at: Date.now(), json, gz: zlib.gzipSync(json) }; return cache; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

// ---------- HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
};
// files anyone may load before signing in
const PUBLIC_FILES = new Set(['/login.html', '/theme.css', '/theme.js', '/logo.png', '/favicon.png', '/hero.jpg']);
// pages that need a signed-in user (users.html needs an admin)
const PAGES = new Set(['/', '/index.html', '/dashboard.html', '/users.html']);

function send(res, status, body, type = 'application/json', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function redirect(res, to) { res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' }); res.end(); }

// JSON body, max 10 KB (Vercel may have read the body already into req.body)
function readJson(req) {
  if (req.body !== undefined) {
    let b = req.body;
    if (Buffer.isBuffer(b)) b = b.toString('utf8');
    if (typeof b === 'string') {
      if (b.length > 10240) return Promise.reject(new auth.AuthError(413, 'Request too large.'));
      try { b = b ? JSON.parse(b) : {}; } catch { return Promise.reject(new auth.AuthError(400, 'Invalid request.')); }
    }
    return Promise.resolve(b && typeof b === 'object' ? b : {});
  }
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
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
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try { return new URL(origin).host === host; } catch { return false; }
}
// visitor IP: Vercel passes it in a header; on your PC it is the socket address
function clientIp(req) {
  if (HOSTED) return String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  return req.socket?.remoteAddress || 'local';
}

async function handleAuthApi(req, res, p, user) {
  const m = req.method;

  if (p === '/api/session' && m === 'GET') {
    const setupNeeded = user ? false : await auth.setupNeeded();
    return send(res, 200, { user: user ? auth.pub(user) : null, setupNeeded, setupCode: setupNeeded && auth.setupCodeRequired() });
  }

  if (m !== 'GET' && !sameOrigin(req)) return send(res, 403, { error: 'Blocked: request must come from this site.' });

  const maxAge = auth.SESSION_HOURS * 3600;
  if (p === '/api/setup' && m === 'POST') {
    const u = await auth.setup(await readJson(req));
    console.log(`[auth] first admin "${u.username}" created`);
    return send(res, 200, { user: auth.pub(u) }, 'application/json', { 'Set-Cookie': auth.cookieHeader(req, await auth.newSession(u), maxAge) });
  }
  if (p === '/api/login' && m === 'POST') {
    const { user: u, token } = await auth.login(clientIp(req), await readJson(req));
    return send(res, 200, { user: auth.pub(u) }, 'application/json', { 'Set-Cookie': auth.cookieHeader(req, token, maxAge) });
  }
  if (p === '/api/logout' && m === 'POST') {
    return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': auth.cookieHeader(req, '', 0) });
  }

  if (!user) return send(res, 401, { error: 'Please sign in.' });

  if (p === '/api/me/password' && m === 'POST') { await auth.changeOwnPassword(user, await readJson(req)); return send(res, 200, { ok: true }); }

  if (p === '/api/users' || p.startsWith('/api/users/')) {
    if (user.role !== 'admin') return send(res, 403, { error: 'Only admins can manage users.' });
    const id = p.split('/')[3];
    if (!id && m === 'GET') return send(res, 200, { users: await auth.listUsers() });
    if (!id && m === 'POST') { const u = await auth.createUser(user, await readJson(req)); console.log(`[auth] ${user.username} created user "${u.username}"`); return send(res, 201, { user: u }); }
    if (id && m === 'PATCH') return send(res, 200, { user: await auth.updateUser(user, id, await readJson(req)) });
    if (id && m === 'DELETE') { await auth.deleteUser(user, id); return send(res, 200, { ok: true }); }
  }
  return null; // not an auth route
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  // on Vercel every address is routed to this one function as /api/index?__path=...
  let pathname = url.pathname;
  if (url.searchParams.has('__path')) {
    if (pathname === '/api/index' || pathname === '/api/index.js') pathname = '/' + url.searchParams.get('__path');
    url.searchParams.delete('__path');
  }

  let user = null;
  try {
    user = await auth.currentUser(req);
  } catch (e) {
    console.error('[store]', e.message);
    if (pathname.startsWith('/api/')) return send(res, e.status || 500, { error: e.message });
    if (pathname !== '/login.html' && !PUBLIC_FILES.has(pathname)) return redirect(res, '/login.html');
  }

  // accounts and sign-in
  if (pathname.startsWith('/api/') && pathname !== '/api/data' && pathname !== '/api/health') {
    try {
      const done = await handleAuthApi(req, res, pathname, user);
      if (done !== null) return;
    } catch (e) {
      if (e instanceof auth.AuthError || e instanceof store.StoreError) return send(res, e.status, { error: e.message });
      console.error('[auth]', e);
      return send(res, 500, { error: 'Something went wrong on the server. ' + LOG_HINT });
    }
    return send(res, 404, { error: 'Not found' });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });

  if (pathname.startsWith('/api/') && !user) return send(res, 401, { error: 'Please sign in.' });

  if (pathname === '/api/data') {
    try {
      const c = await getData(url.searchParams.has('refresh'));
      if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) return send(res, 200, c.gz, 'application/json', { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
      return send(res, 200, c.json);
    } catch (e) {
      console.error('[api] ' + e.message, e.info ? JSON.stringify(e.info) : '');
      return send(res, 502, { error: e.message, detail: e.info || null });
    }
  }
  if (pathname === '/api/health') {
    return send(res, 200, { ok: true, api: API, store: store.KIND, cachedAt: cache ? new Date(cache.at).toISOString() : null });
  }

  // static files: pages need a signed-in user; only the sign-in page and its assets are open
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, 'Bad request', 'text/plain'); }
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
  let buf;
  try { buf = await fs.promises.readFile(file); } catch { return send(res, 404, 'Not found', 'text/plain'); }
  send(res, 200, buf, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
}

module.exports = { handler, API, hasToken: () => !!TOKEN() };

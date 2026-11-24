'use strict';
/**
 * Where accounts are kept.
 *
 * - On your PC (default): data/users.json and data/session-secret.txt (git-ignored).
 * - Online (Vercel): an Upstash Redis database, used automatically when its
 *   REST URL and token are present in the environment
 *   (KV_REST_API_URL + KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN).
 *   Vercel's own disk is read-only and forgets everything, so a file cannot be used there.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, 'session-secret.txt');

// also accept a custom prefix chosen in Vercel, e.g. STORAGE_KV_REST_API_URL
const envEnding = end => process.env[end] || process.env[Object.keys(process.env).find(k => k.endsWith('_' + end)) || ''] || '';
const KV_URL = (envEnding('KV_REST_API_URL') || envEnding('UPSTASH_REDIS_REST_URL')).replace(/\/+$/, '');
const KV_TOKEN = envEnding('KV_REST_API_TOKEN') || envEnding('UPSTASH_REDIS_REST_TOKEN');
const KIND = KV_URL && KV_TOKEN ? 'redis' : 'file';
const HOSTED = !!process.env.VERCEL;
const PREFIX = 'fms:';

class StoreError extends Error { constructor(msg) { super(msg); this.status = 503; } }

function assertUsable() {
  if (KIND === 'file' && HOSTED) {
    throw new StoreError('User storage is not set up yet. In Vercel, connect an Upstash Redis database to this project, then redeploy.');
  }
}

// ---------- Redis over HTTPS (Upstash REST API, no packages needed) ----------
async function redis(...cmd) {
  let res;
  try {
    res = await fetch(KV_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    });
  } catch (e) {
    throw new StoreError('Cannot reach the user database: ' + (e.cause?.code || e.message));
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new StoreError('User database error: ' + (j.error || 'HTTP ' + res.status));
  return j.result;
}

// ---------- users ----------
async function loadUsers() {
  assertUsable();
  if (KIND === 'redis') {
    const raw = await redis('GET', PREFIX + 'users');
    if (!raw) return [];
    const j = JSON.parse(raw);
    return Array.isArray(j.users) ? j.users : [];
  }
  try {
    const j = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    return Array.isArray(j.users) ? j.users : [];
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[store] could not read data/users.json:', e.message);
    return [];
  }
}

async function saveUsers(users) {
  assertUsable();
  const text = JSON.stringify({ users }, null, KIND === 'redis' ? 0 : 2);
  if (KIND === 'redis') { await redis('SET', PREFIX + 'users', text); return; }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = USERS_FILE + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, USERS_FILE); // write-then-rename so a crash never leaves a half-written file
}

// ---------- the key that signs sign-in cookies (made once, then kept) ----------
let secret = null;
async function sessionSecret() {
  if (secret) return secret;
  if (process.env.SESSION_SECRET) return (secret = process.env.SESSION_SECRET);
  assertUsable();
  if (KIND === 'redis') {
    await redis('SET', PREFIX + 'secret', crypto.randomBytes(32).toString('hex'), 'NX'); // only the first call wins
    return (secret = await redis('GET', PREFIX + 'secret'));
  }
  try { secret = fs.readFileSync(SECRET_FILE, 'utf8').trim(); } catch {}
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SECRET_FILE, secret);
  }
  return secret;
}

// ---------- wrong-password counter per IP (lock for 10 minutes after 8 misses) ----------
const LOCK_AFTER = 8, LOCK_SECONDS = 600;
const mem = new Map(); // ip -> { n, until }
async function isLocked(ip) {
  if (KIND === 'redis') return Number(await redis('GET', PREFIX + 'fail:' + ip) || 0) >= LOCK_AFTER;
  const f = mem.get(ip);
  return !!f && f.n >= LOCK_AFTER && f.until > Date.now();
}
async function noteFail(ip) {
  if (KIND === 'redis') {
    const n = await redis('INCR', PREFIX + 'fail:' + ip);
    if (n === 1 || n === LOCK_AFTER) await redis('EXPIRE', PREFIX + 'fail:' + ip, LOCK_SECONDS);
    return;
  }
  const f = mem.get(ip);
  const cur = f && f.until > Date.now() ? f : { n: 0, until: Date.now() + LOCK_SECONDS * 1000 };
  cur.n += 1;
  if (cur.n === LOCK_AFTER) cur.until = Date.now() + LOCK_SECONDS * 1000;
  mem.set(ip, cur);
}
async function clearFails(ip) {
  if (KIND === 'redis') await redis('DEL', PREFIX + 'fail:' + ip); else mem.delete(ip);
}

module.exports = { KIND, HOSTED, StoreError, loadUsers, saveUsers, sessionSecret, isLocked, noteFail, clearFails };

'use strict';
/**
 * User accounts and sign-in sessions for the Homeland FMS dashboard.
 *
 * - Accounts live in data/users.json (git-ignored). Passwords are never stored:
 *   only a random salt and a scrypt hash.
 * - Sessions are random tokens in an HttpOnly, SameSite=Strict cookie, held in
 *   memory (restarting the server signs everyone out).
 * - The first account is created on the sign-in page and is always an admin.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);
const COOKIE = 'fms_session';

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const ROLES = ['admin', 'user'];

// ---------- storage ----------
let users = load();

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    return Array.isArray(j.users) ? j.users : [];
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[auth] could not read data/users.json:', e.message);
    return [];
  }
}
function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = USERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ users }, null, 2));
  fs.renameSync(tmp, USERS_FILE); // write-then-rename so a crash never leaves a half-written file
}

// ---------- passwords ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return { salt, hash };
}
function checkPassword(u, pw) {
  const a = Buffer.from(u.hash, 'hex');
  const b = crypto.scryptSync(String(pw), u.salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- public view of a user ----------
const pub = u => ({ id: u.id, username: u.username, name: u.name, role: u.role, active: u.active, createdAt: u.createdAt, createdBy: u.createdBy || null, lastLogin: u.lastLogin || null });

// ---------- validation ----------
class AuthError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
function validate({ username, name, password, role }, { partial = false } = {}) {
  if (!partial || username !== undefined) {
    username = String(username || '').trim().toLowerCase();
    if (!USERNAME_RE.test(username)) throw new AuthError(400, 'User ID must be 3 to 32 characters: lowercase letters, numbers, dot, dash or underscore.');
  }
  if (!partial || name !== undefined) {
    name = String(name || '').trim();
    if (!name || name.length > 60) throw new AuthError(400, 'Enter a name of up to 60 characters.');
  }
  if (!partial || password !== undefined) {
    password = String(password || '');
    if (password.length < 8 || password.length > 128) throw new AuthError(400, 'Password must be at least 8 characters.');
  }
  if (!partial || role !== undefined) {
    if (!ROLES.includes(role)) throw new AuthError(400, 'Role must be admin or user.');
  }
  return { username, name, password, role };
}
const activeAdmins = () => users.filter(u => u.role === 'admin' && u.active);

// ---------- sessions ----------
const sessions = new Map(); // token -> { uid, exp }
function newSession(uid) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { uid, exp: Date.now() + SESSION_HOURS * 3600e3 });
  return token;
}
function dropSessionsFor(uid) { for (const [t, s] of sessions) if (s.uid === uid) sessions.delete(t); }
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const s = sessions.get(token);
  if (!s || s.exp < Date.now()) { if (s) sessions.delete(token); return null; }
  const u = users.find(x => x.id === s.uid);
  if (!u || !u.active) { sessions.delete(token); return null; }
  return u;
}
const cookieHeader = (token, maxAge) => `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;

// ---------- sign-in throttling (per IP) ----------
const fails = new Map(); // ip -> { n, until }
function throttled(ip) { const f = fails.get(ip); return f && f.until > Date.now(); }
function noteFail(ip) {
  const f = fails.get(ip) || { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= 8) { f.until = Date.now() + 10 * 60e3; f.n = 0; }
  fails.set(ip, f);
}

// ---------- operations ----------
function setupNeeded() { return users.length === 0; }

function setup(body) {
  if (!setupNeeded()) throw new AuthError(403, 'An admin account already exists. Sign in instead.');
  const v = validate({ ...body, role: 'admin' });
  const u = { id: crypto.randomUUID(), username: v.username, name: v.name, role: 'admin', active: true, ...hashPassword(v.password), createdAt: new Date().toISOString(), createdBy: null };
  users.push(u); save();
  return u;
}

function login(ip, { username, password }) {
  if (throttled(ip)) throw new AuthError(429, 'Too many wrong attempts. Try again in 10 minutes.');
  const u = users.find(x => x.username === String(username || '').trim().toLowerCase());
  // same message whether the user ID or the password is wrong
  if (!u || !checkPassword(u, password)) { noteFail(ip); throw new AuthError(401, 'User ID or password is incorrect.'); }
  if (!u.active) throw new AuthError(403, 'This account is disabled. Ask an admin to enable it.');
  fails.delete(ip);
  u.lastLogin = new Date().toISOString(); save();
  return { user: u, token: newSession(u.id) };
}

function logout(req) { const t = parseCookies(req)[COOKIE]; if (t) sessions.delete(t); }

function listUsers() { return users.map(pub); }

function createUser(admin, body) {
  const v = validate(body);
  if (users.some(u => u.username === v.username)) throw new AuthError(409, `User ID "${v.username}" is already taken.`);
  const u = { id: crypto.randomUUID(), username: v.username, name: v.name, role: v.role, active: true, ...hashPassword(v.password), createdAt: new Date().toISOString(), createdBy: admin.username };
  users.push(u); save();
  return pub(u);
}

function updateUser(admin, id, body) {
  const u = users.find(x => x.id === id);
  if (!u) throw new AuthError(404, 'User not found.');
  const v = validate(body, { partial: true });
  const self = u.id === admin.id;
  if (v.role !== undefined && v.role !== u.role) {
    if (self) throw new AuthError(400, 'You cannot change your own role.');
    if (u.role === 'admin' && activeAdmins().length <= 1) throw new AuthError(400, 'Keep at least one active admin.');
    u.role = v.role;
  }
  if (body.active !== undefined && !!body.active !== u.active) {
    if (self) throw new AuthError(400, 'You cannot disable your own account.');
    if (!body.active && u.role === 'admin' && activeAdmins().length <= 1) throw new AuthError(400, 'Keep at least one active admin.');
    u.active = !!body.active;
    if (!u.active) dropSessionsFor(u.id);
  }
  if (v.name !== undefined) u.name = v.name;
  if (v.password !== undefined) { Object.assign(u, hashPassword(v.password)); if (!self) dropSessionsFor(u.id); }
  save();
  return pub(u);
}

function deleteUser(admin, id) {
  const u = users.find(x => x.id === id);
  if (!u) throw new AuthError(404, 'User not found.');
  if (u.id === admin.id) throw new AuthError(400, 'You cannot delete your own account.');
  if (u.role === 'admin' && u.active && activeAdmins().length <= 1) throw new AuthError(400, 'Keep at least one active admin.');
  users = users.filter(x => x.id !== id); save();
  dropSessionsFor(id);
}

function changeOwnPassword(user, { current, password }) {
  if (!checkPassword(user, current)) throw new AuthError(400, 'Current password is incorrect.');
  const v = validate({ password }, { partial: true });
  Object.assign(user, hashPassword(v.password)); save();
}

module.exports = {
  AuthError, COOKIE, SESSION_HOURS, cookieHeader, pub,
  setupNeeded, setup, login, logout, currentUser, newSession,
  listUsers, createUser, updateUser, deleteUser, changeOwnPassword,
};

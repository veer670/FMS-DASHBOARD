'use strict';
/**
 * User accounts and sign-in for the Homeland FMS dashboard.
 *
 * - Accounts are kept by lib/store.js (a file on your PC, Redis when online).
 *   Passwords are never stored: only a random salt and a scrypt hash.
 * - Sign-in is a signed cookie (HttpOnly, SameSite=Strict, Secure on https).
 *   It holds no password. It works on every server copy, so it suits Vercel.
 *   Disabling a user or resetting their password signs them out everywhere.
 * - The first account is created on the sign-in page and is always an admin.
 *   Online, that page also asks for the SETUP_CODE set in Vercel, so a stranger
 *   who finds the link first cannot make themselves admin.
 */
const crypto = require('crypto');
const store = require('./store');

const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);
const COOKIE = 'fms_session';
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const ROLES = ['admin', 'user'];

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
// spend the same time when the user ID does not exist, so it can't be guessed from timing
const DUMMY = hashPassword('not-a-real-password');

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
const activeAdmins = users => users.filter(u => u.role === 'admin' && u.active);

// ---------- signed sign-in cookie ----------
const b64 = s => Buffer.from(s).toString('base64url');
async function sign(payload) {
  const body = b64(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', await store.sessionSecret()).update(body).digest('base64url');
  return body + '.' + mac;
}
async function verify(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const good = crypto.createHmac('sha256', await store.sessionSecret()).update(body).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== good.length || !crypto.timingSafeEqual(given, good)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
}
const newSession = u => sign({ u: u.id, v: u.sv || 0, e: Date.now() + SESSION_HOURS * 3600e3 });

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch {} }
  }
  return out;
}
async function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const s = await verify(token);
  if (!s || !(s.e > Date.now())) return null;
  const u = (await store.loadUsers()).find(x => x.id === s.u);
  if (!u || !u.active || (u.sv || 0) !== s.v) return null;
  return u;
}
const isHttps = req => req.headers['x-forwarded-proto'] === 'https' || !!req.socket?.encrypted;
const cookieHeader = (req, token, maxAge) =>
  `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;

// ---------- setup code (needed online for the first admin) ----------
const SETUP_CODE = String(process.env.SETUP_CODE || '').trim();
const setupCodeRequired = () => store.HOSTED || !!SETUP_CODE;
function checkSetupCode(code) {
  if (!setupCodeRequired()) return;
  if (!SETUP_CODE) throw new AuthError(503, 'Set SETUP_CODE in Vercel (Settings > Environment Variables), redeploy, then create the admin.');
  const a = crypto.createHash('sha256').update(String(code || '').trim()).digest();
  const b = crypto.createHash('sha256').update(SETUP_CODE).digest();
  if (!crypto.timingSafeEqual(a, b)) throw new AuthError(403, 'The setup code is not correct.');
}

// ---------- operations ----------
async function setupNeeded() { return (await store.loadUsers()).length === 0; }

async function setup(body) {
  const users = await store.loadUsers();
  if (users.length) throw new AuthError(403, 'An admin account already exists. Sign in instead.');
  checkSetupCode(body.setupCode);
  const v = validate({ ...body, role: 'admin' });
  const u = { id: crypto.randomUUID(), username: v.username, name: v.name, role: 'admin', active: true, sv: 0, ...hashPassword(v.password), createdAt: new Date().toISOString(), createdBy: null };
  users.push(u); await store.saveUsers(users);
  return u;
}

async function login(ip, { username, password }) {
  if (await store.isLocked(ip)) throw new AuthError(429, 'Too many wrong attempts. Try again in 10 minutes.');
  const users = await store.loadUsers();
  const u = users.find(x => x.username === String(username || '').trim().toLowerCase());
  // same message whether the user ID or the password is wrong
  if (!checkPassword(u || DUMMY, password) || !u) { await store.noteFail(ip); throw new AuthError(401, 'User ID or password is incorrect.'); }
  if (!u.active) throw new AuthError(403, 'This account is disabled. Ask an admin to enable it.');
  await store.clearFails(ip);
  u.lastLogin = new Date().toISOString(); await store.saveUsers(users);
  return { user: u, token: await newSession(u) };
}

async function listUsers() { return (await store.loadUsers()).map(pub); }

async function createUser(admin, body) {
  const users = await store.loadUsers();
  const v = validate(body);
  if (users.some(u => u.username === v.username)) throw new AuthError(409, `User ID "${v.username}" is already taken.`);
  const u = { id: crypto.randomUUID(), username: v.username, name: v.name, role: v.role, active: true, sv: 0, ...hashPassword(v.password), createdAt: new Date().toISOString(), createdBy: admin.username };
  users.push(u); await store.saveUsers(users);
  return pub(u);
}

async function updateUser(admin, id, body) {
  const users = await store.loadUsers();
  const u = users.find(x => x.id === id);
  if (!u) throw new AuthError(404, 'User not found.');
  const v = validate(body, { partial: true });
  const self = u.id === admin.id;
  if (v.role !== undefined && v.role !== u.role) {
    if (self) throw new AuthError(400, 'You cannot change your own role.');
    if (u.role === 'admin' && activeAdmins(users).length <= 1) throw new AuthError(400, 'Keep at least one active admin.');
    u.role = v.role;
  }
  if (body.active !== undefined && !!body.active !== u.active) {
    if (self) throw new AuthError(400, 'You cannot disable your own account.');
    if (!body.active && u.role === 'admin' && activeAdmins(users).length <= 1) throw new AuthError(400, 'Keep at least one active admin.');
    u.active = !!body.active;
    if (!u.active) u.sv = (u.sv || 0) + 1; // sign them out everywhere
  }
  if (v.name !== undefined) u.name = v.name;
  if (v.password !== undefined) { Object.assign(u, hashPassword(v.password)); if (!self) u.sv = (u.sv || 0) + 1; }
  await store.saveUsers(users);
  return pub(u);
}

async function deleteUser(admin, id) {
  const users = await store.loadUsers();
  const u = users.find(x => x.id === id);
  if (!u) throw new AuthError(404, 'User not found.');
  if (u.id === admin.id) throw new AuthError(400, 'You cannot delete your own account.');
  if (u.role === 'admin' && u.active && activeAdmins(users).length <= 1) throw new AuthError(400, 'Keep at least one active admin.');
  await store.saveUsers(users.filter(x => x.id !== id));
}

async function changeOwnPassword(user, { current, password }) {
  if (!checkPassword(user, current)) throw new AuthError(400, 'Current password is incorrect.');
  const v = validate({ password }, { partial: true });
  const users = await store.loadUsers();
  const u = users.find(x => x.id === user.id);
  if (!u) throw new AuthError(404, 'User not found.');
  Object.assign(u, hashPassword(v.password)); await store.saveUsers(users);
}

module.exports = {
  AuthError, COOKIE, SESSION_HOURS, cookieHeader, pub, newSession, setupCodeRequired,
  setupNeeded, setup, login, currentUser,
  listUsers, createUser, updateUser, deleteUser, changeOwnPassword,
};

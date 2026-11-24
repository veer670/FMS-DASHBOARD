'use strict';
/**
 * Work Execution (Homeland FMS): runs the dashboard on your PC.
 *
 * Serves the pages on their own port (default 4783). The real work is in
 * lib/app.js, which Vercel also uses (api/index.js) when the dashboard is online.
 * The API token stays in .env and is never sent to the browser.
 *
 *   node server.js          start
 *   node server.js --open   start and open the browser
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

loadEnv(path.join(__dirname, '.env'));

if (typeof fetch !== 'function') {
  console.error('This dashboard needs Node.js 18 or newer (built-in fetch). You have ' + process.version + '.');
  process.exit(1);
}
const app = require('./lib/app');
const store = require('./lib/store');
if (!app.hasToken()) {
  console.error('FMS_API_TOKEN is missing. Copy .env.example to .env and paste the read-only token.');
  process.exit(1);
}

const PORT = Number(process.env.PORT || 4783);
const HOST = process.env.HOST || '127.0.0.1';

const server = http.createServer((req, res) => {
  app.handler(req, res).catch(e => {
    console.error(e);
    if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('Server error. See this window.'); }
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
  console.log(`\n  Homeland FMS  →  ${link}\n  Data source: ${app.API}\n  Accounts kept in: ${store.KIND === 'redis' ? 'Redis (online database)' : 'data/users.json'}\n` +
    `  Sign in with your user ID and password (first run: create the admin account).\n` +
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

// Signed-in user: sidebar card, sign out, change password, admin menu.
// Also exposes window.FMS = { api, dialog, toast } for the Users page.
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(method, url, body) {
    const res = await fetch(url, {
      method, cache: 'no-store',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !url.startsWith('/api/login')) { location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search); }
    return { ok: res.ok, status: res.status, data };
  }

  // Small modal form. fields: [{ name, label, type, value, autocomplete, options }]
  function dialog({ title, text, fields = [], submit = 'Save', danger = false, check }) {
    return new Promise(resolve => {
      const d = document.createElement('dialog');
      d.className = 'dlg';
      d.innerHTML = `<form method="dialog" novalidate>
        <h3>${esc(title)}</h3>${text ? `<p class="dlg-text">${esc(text)}</p>` : ''}
        ${fields.map(f => `<label>${esc(f.label)}${f.type === 'select'
          ? `<select name="${f.name}">${f.options.map(o => `<option value="${esc(o.value)}"${o.value === f.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
          : `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value || '')}" autocomplete="${f.autocomplete || 'off'}">`}</label>`).join('')}
        <p class="dlg-err" role="alert"></p>
        <div class="dlg-act"><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${esc(submit)}</button></div>
      </form>`;
      document.body.appendChild(d);
      const form = d.querySelector('form'), err = d.querySelector('.dlg-err');
      const close = v => { d.close(); d.remove(); resolve(v); };
      d.querySelector('[data-cancel]').onclick = () => close(null);
      d.addEventListener('cancel', e => { e.preventDefault(); close(null); });
      form.onsubmit = async e => {
        e.preventDefault();
        const vals = Object.fromEntries(new FormData(form));
        if (check) {
          const btn = form.querySelector('[type=submit]'); btn.disabled = true;
          const msg = await check(vals); btn.disabled = false;
          if (msg) { err.textContent = msg; return; }
        }
        close(vals);
      };
      d.showModal();
      const first = d.querySelector('input,select'); if (first) first.focus();
    });
  }

  function toast(msg, bad) {
    const t = document.createElement('div');
    t.className = 'toast' + (bad ? ' bad' : '');
    t.setAttribute('role', 'status');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3100);
  }

  window.FMS = { api, dialog, toast, esc };

  (async () => {
    let s;
    try { s = await (await fetch('/api/session', { cache: 'no-store' })).json(); } catch { return; }
    if (!s.user) { location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search); return; }
    const u = s.user;
    window.FMS.user = u;

    const menu = document.querySelector('.menu');
    if (u.role === 'admin' && menu && !menu.querySelector('a[href="users.html"]')) {
      menu.insertAdjacentHTML('beforeend', `<a href="users.html"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="8" cy="7" r="3"/><path d="M2.5 16.5c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/><path d="M13 4.5a2.8 2.8 0 0 1 0 5.2M15.5 12.5c1 .7 1.7 2 2 4"/></svg><span>Users</span></a>`);
    }

    const box = document.getElementById('who');
    if (!box) return;
    const initials = u.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    box.innerHTML = `<div class="who-card"><span class="avatar" aria-hidden="true">${esc(initials)}</span><div class="who-txt"><b>${esc(u.name)}</b><span>${esc(u.username)} · ${u.role === 'admin' ? 'Admin' : 'User'}</span></div></div>
      <div class="who-act"><button type="button" class="link-side" data-out>Sign out</button></div>`;
    box.querySelector('[data-out]').onclick = async () => { await api('POST', '/api/logout', {}); location.href = '/login.html'; };
  })();
})();

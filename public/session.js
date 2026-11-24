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
      menu.insertAdjacentHTML('beforeend', `<a href="users.html"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm7.5 0a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 13c-3.4 0-7 1.7-7 4.6V20h14v-2.4C16 14.7 12.4 13 9 13zm7.5 0c-.6 0-1.2.1-1.8.2 1.4 1 2.3 2.4 2.3 4.4V20H22v-2.6c0-2.6-3-4.4-5.5-4.4z"/></svg><span>Users</span></a>`);
    }

    const box = document.getElementById('who');
    if (!box) return;
    const initials = u.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    box.innerHTML = `<div class="who-card"><span class="avatar" aria-hidden="true">${esc(initials)}</span><div class="who-txt"><b>${esc(u.name)}</b><span>${esc(u.username)} · ${u.role === 'admin' ? 'Admin' : 'User'}</span></div></div>
      <div class="who-act"><button type="button" class="link-side" data-pw>Change password</button><button type="button" class="link-side" data-out>Sign out</button></div>`;
    box.querySelector('[data-out]').onclick = async () => { await api('POST', '/api/logout', {}); location.href = '/login.html'; };
    box.querySelector('[data-pw]').onclick = async () => {
      const ok = await dialog({
        title: 'Change your password', submit: 'Change password',
        fields: [
          { name: 'current', label: 'Current password', type: 'password', autocomplete: 'current-password' },
          { name: 'password', label: 'New password (at least 8 characters)', type: 'password', autocomplete: 'new-password' },
          { name: 'confirm', label: 'Repeat new password', type: 'password', autocomplete: 'new-password' },
        ],
        check: async v => {
          if (v.password !== v.confirm) return 'The new passwords do not match.';
          const r = await api('POST', '/api/me/password', { current: v.current, password: v.password });
          return r.ok ? '' : r.data.error || 'Could not change the password.';
        },
      });
      if (ok) toast('Password changed');
    };
  })();
})();

// Colour theme switcher (sidebar). The choice is remembered in this browser.
(() => {
  const THEMES = [
    { id: 'blueprint', name: 'Blueprint', a: '#0F3D6E', b: '#F2C14E' },
    { id: 'navy', name: 'Homeland Navy', a: '#1F3A5F', b: '#C9973F' },
    { id: 'teal', name: 'Deep Teal', a: '#0F5560', b: '#EBA23A' },
    { id: 'charcoal', name: 'Charcoal', a: '#2E343B', b: '#C4874A' },
  ];
  const root = document.documentElement;
  const box = document.getElementById('themes');
  if (!box) return;
  const paint = () => box.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === (root.dataset.theme || 'blueprint'))));
  box.innerHTML = THEMES.map(t => `<button type="button" data-t="${t.id}" title="${t.name}" aria-label="${t.name} colour theme" style="--a:${t.a};--b:${t.b}"></button>`).join('');
  box.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    root.dataset.theme = b.dataset.t;
    try { localStorage.setItem('fms-theme', b.dataset.t); } catch (err) { /* storage unavailable: theme lasts for this visit */ }
    paint();
  });
  paint();
})();

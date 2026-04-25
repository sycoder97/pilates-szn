(() => {
  const KEY = 'pilatesszn.shortlist';

  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
    catch { return []; }
  };
  const write = list => {
    localStorage.setItem(KEY, JSON.stringify(list));
    document.dispatchEvent(new CustomEvent('shortlist:change', { detail: { list } }));
  };

  const has = name => read().includes(name);
  const add = name => {
    const list = read();
    if (list.includes(name)) return;
    list.push(name);
    write(list);
  };
  const remove = name => write(read().filter(n => n !== name));
  const toggle = name => has(name) ? remove(name) : add(name);
  const count = () => read().length;

  function paintBadge() {
    const el = document.getElementById('saved-count');
    if (el) el.textContent = String(count()).padStart(2, '0');
  }

  document.addEventListener('shortlist:change', paintBadge);
  // Cross-tab sync.
  window.addEventListener('storage', e => { if (e.key === KEY) paintBadge(); });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', paintBadge);
  } else {
    paintBadge();
  }

  window.PILATES_SHORTLIST = { read, add, remove, has, toggle, count };
})();

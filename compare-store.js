(() => {
  const KEY = 'pilatesszn.compare';
  const MAX = 3;

  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
    catch { return []; }
  };
  const write = list => {
    localStorage.setItem(KEY, JSON.stringify(list));
    document.dispatchEvent(new CustomEvent('compare:change', { detail: { list } }));
  };

  const has = name => read().includes(name);
  const add = name => {
    const list = read();
    if (list.includes(name)) return;
    if (list.length >= MAX) list.shift(); // bump the oldest
    list.push(name);
    write(list);
  };
  const remove = name => write(read().filter(n => n !== name));
  const toggle = name => has(name) ? remove(name) : add(name);
  const count = () => read().length;
  const clear = () => write([]);

  function paintBadge() {
    const el = document.getElementById('compare-count');
    if (el) el.textContent = String(count()).padStart(2, '0');
  }

  document.addEventListener('compare:change', paintBadge);
  window.addEventListener('storage', e => { if (e.key === KEY) paintBadge(); });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', paintBadge);
  } else {
    paintBadge();
  }

  window.PILATES_COMPARE = { read, add, remove, has, toggle, count, clear, MAX };
})();

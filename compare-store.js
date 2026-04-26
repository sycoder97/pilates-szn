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

  function paintBar() {
    const bar = document.getElementById('compare-bar');
    if (!bar) return;
    const names = read();
    if (names.length === 0) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const setText = (sel, txt) => { const el = bar.querySelector(sel); if (el) el.textContent = txt; };
    setText('[data-compare-count]', String(names.length));
    setText('[data-compare-noun]', names.length === 1 ? 'studio' : 'studios');
    setText('[data-compare-names]', names.join(' · '));
  }

  function paintAll() { paintBadge(); paintBar(); }

  document.addEventListener('compare:change', paintAll);
  window.addEventListener('storage', e => { if (e.key === KEY) paintAll(); });

  // Wire the bar's Clear button once the DOM is ready.
  function wireBar() {
    const clearBtn = document.getElementById('compare-bar-clear');
    if (clearBtn && !clearBtn.dataset.wired) {
      clearBtn.dataset.wired = '1';
      clearBtn.addEventListener('click', () => { clear(); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { paintAll(); wireBar(); });
  } else {
    paintAll();
    wireBar();
  }

  window.PILATES_COMPARE = { read, add, remove, has, toggle, count, clear, MAX };
})();

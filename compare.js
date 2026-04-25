(() => {
  const tableEl = document.getElementById('compare-table');
  const emptyEl = document.getElementById('empty-state');
  const countEl = document.getElementById('result-count');
  const clearBtn = document.getElementById('clear-compare');
  document.getElementById('year').textContent = new Date().getFullYear();

  let byName = {};

  fetch('studios.json', { cache: 'no-cache' })
    .then(r => r.json())
    .then(data => {
      (data.studios || []).forEach(s => {
        s.minPrice = extractMinPrice(s);
        byName[s.name] = s;
      });
      render();
    });

  document.addEventListener('compare:change', render);

  clearBtn.addEventListener('click', () => {
    if (!confirm('Clear all studios from the comparison?')) return;
    window.PILATES_COMPARE.clear();
  });

  function render() {
    const names = window.PILATES_COMPARE.read();
    const studios = names.map(n => byName[n]).filter(Boolean);
    const n = studios.length;

    emptyEl.hidden = n !== 0;
    clearBtn.hidden = n === 0;
    countEl.textContent = n === 0
      ? 'Nothing to compare'
      : `${n} ${n === 1 ? 'studio' : 'studios'} · pick up to ${window.PILATES_COMPARE.MAX}`;

    if (n === 0) {
      tableEl.innerHTML = '';
      return;
    }

    tableEl.innerHTML = renderTable(studios);
    tableEl.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => window.PILATES_COMPARE.remove(btn.dataset.remove));
    });
    // Force the grid to draw the right number of columns (1 label + N studios).
    tableEl.style.setProperty('--cols', String(n));
  }

  function renderTable(studios) {
    const rows = [
      { label: 'Location', value: s => `${zoneLabel(s.zone)}<br/><span class="cmp-muted">${esc(s.areas)}</span>` },
      { label: 'Methods',  value: s => (s.types || []).map(t => `<span class="tag">${esc(t)}</span>`).join(' ') },
      { label: 'From',     value: s => s.minPrice ? `<strong>£${Math.round(s.minPrice)}</strong> /class` : '<span class="cmp-muted">—</span>' },
      { label: 'Intro',    value: s => s.intro ? esc(s.intro) : '<span class="cmp-muted">—</span>' },
      { label: 'Packages', value: s => s.packages ? esc(s.packages) : '<span class="cmp-muted">—</span>' },
      { label: 'Verified', value: s => `<span class="cmp-muted">${esc(s.lastVerified || '—')}</span>` },
    ];

    const headRow = `
      <div class="cmp-row cmp-head">
        <div class="cmp-cell cmp-label"></div>
        ${studios.map(s => `
          <div class="cmp-cell cmp-studio-head">
            <h3 class="cmp-name">${esc(s.name)}</h3>
            <button class="cmp-remove text-btn" type="button" data-remove="${esc(s.name)}" aria-label="Remove ${esc(s.name)} from comparison">Remove</button>
          </div>
        `).join('')}
      </div>
    `;

    const bodyRows = rows.map(r => `
      <div class="cmp-row">
        <div class="cmp-cell cmp-label">${esc(r.label)}</div>
        ${studios.map(s => `<div class="cmp-cell">${r.value(s)}</div>`).join('')}
      </div>
    `).join('');

    const ctaRow = `
      <div class="cmp-row cmp-cta-row">
        <div class="cmp-cell cmp-label"></div>
        ${studios.map(s => `
          <div class="cmp-cell">
            <a class="btn btn-primary" href="${outboundURL(s)}" target="_blank" rel="noopener sponsored">Book →</a>
          </div>
        `).join('')}
      </div>
    `;

    return headRow + bodyRows + ctaRow;
  }

  // --- helpers (same shapes as app.js) ---
  function zoneLabel(z) {
    return ({ C: 'Central', N: 'North', S: 'South', E: 'East', W: 'West' })[z] || z || '';
  }

  function extractMinPrice(s) {
    const text = s.packages || '';
    if (!text) return null;
    const nums = [];
    const packRe = /(\d+)\s*(?:for|\/|·|x|\s)\s*£\s?(\d+(?:\.\d+)?)/gi;
    let m;
    while ((m = packRe.exec(text)) !== null) {
      const pack = parseInt(m[1]);
      const total = parseFloat(m[2]);
      if (pack >= 2 && pack <= 25) nums.push(total / pack);
    }
    const bareRe = /£\s?(\d+(?:\.\d+)?)/g;
    while ((m = bareRe.exec(text)) !== null) {
      const n = parseFloat(m[1]);
      if (n > 0 && n < 100) nums.push(n);
    }
    return nums.length ? Math.min(...nums) : null;
  }

  function outboundURL(s) {
    const cfg = window.PILATES_CONFIG || { affiliates: {}, utm: {} };
    const affiliate = cfg.affiliates && cfg.affiliates[s.name];
    if (affiliate) return affiliate;
    try {
      const url = new URL(s.website);
      Object.entries(cfg.utm || {}).forEach(([k, v]) => url.searchParams.set(k, v));
      return url.toString();
    } catch { return s.website; }
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }
})();

(() => {
  const grid = document.getElementById('studio-grid');
  const empty = document.getElementById('empty-state');
  const resultCount = document.getElementById('result-count');
  const clearBtn = document.getElementById('clear-shortlist');
  const modal = document.getElementById('studio-modal');
  const modalBody = document.getElementById('modal-body');
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

  document.addEventListener('shortlist:change', render);

  function render() {
    const names = window.PILATES_SHORTLIST.read();
    const studios = names.map(n => byName[n]).filter(Boolean);

    grid.innerHTML = studios.map(cardHTML).join('');
    empty.hidden = studios.length !== 0;
    clearBtn.hidden = studios.length === 0;
    resultCount.textContent = studios.length
      ? `${studios.length} saved`
      : 'Nothing saved';

    grid.querySelectorAll('.card').forEach(el => {
      const handle = e => {
        if (e.target.closest('.book-btn')) return;
        if (e.target.closest('[data-remove]')) {
          e.stopPropagation();
          window.PILATES_SHORTLIST.remove(el.dataset.name);
          return;
        }
        openModal(el.dataset.name);
      };
      el.addEventListener('click', handle);
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handle(e); }
      });
    });
  }

  function cardHTML(s) {
    const types = (s.types || []).map(t => `<span class="tag">${esc(t)}</span>`).join('');
    const zoneLabel = { C: 'Central', N: 'North', S: 'South', E: 'East', W: 'West' }[s.zone] || s.zone;
    return `
      <div class="card" data-name="${esc(s.name)}" role="button" tabindex="0" aria-label="View ${esc(s.name)}">
        <div class="card-head">
          <h3 class="card-name">${esc(s.name)}</h3>
        </div>
        <div class="card-meta">
          <span class="tag">${esc(zoneLabel)} London</span>
          ${types}
        </div>
        <p class="card-areas">${esc(s.areas)}</p>
        <dl class="card-pricing">
          ${s.intro ? `<dt>Intro</dt><dd>${esc(s.intro)}</dd>` : ''}
          ${s.minPrice ? `<dt>From</dt><dd>£${Math.round(s.minPrice)}/class</dd>` : ''}
        </dl>
        <div class="card-foot">
          <button class="text-btn" type="button" data-remove="${esc(s.name)}">Remove</button>
          <a class="book-btn" href="${outboundURL(s)}" target="_blank" rel="noopener sponsored">Book</a>
        </div>
      </div>
    `;
  }

  clearBtn.addEventListener('click', () => {
    if (!confirm('Clear all saved studios from this device?')) return;
    window.PILATES_SHORTLIST.read().forEach(n => window.PILATES_SHORTLIST.remove(n));
  });

  // --- modal (lifted from app.js, scoped to this page) ---
  function openModal(name) {
    const s = byName[name];
    if (!s) return;
    const types = (s.types || []).join(' · ');
    const zoneLabel = { C: 'Central', N: 'North', S: 'South', E: 'East', W: 'West' }[s.zone] || s.zone;
    modalBody.innerHTML = `
      <h2>${esc(s.name)}</h2>
      <p class="sub">${esc(zoneLabel)} London · ${esc(types)}</p>
      <dl>
        <div class="modal-row"><dt>Locations</dt><dd>${esc(s.areas)}</dd></div>
        <div class="modal-row"><dt>Method</dt><dd>${esc(types)}</dd></div>
        ${s.intro ? `<div class="modal-row"><dt>Intro offer</dt><dd>${esc(s.intro)}</dd></div>` : ''}
        ${s.packages ? `<div class="modal-row"><dt>Packages</dt><dd>${esc(s.packages)}</dd></div>` : ''}
        <div class="modal-row"><dt>Last verified</dt><dd>${esc(s.lastVerified || '—')}</dd></div>
      </dl>
      <div class="modal-cta">
        <a class="btn btn-primary" href="${outboundURL(s)}" target="_blank" rel="noopener sponsored">Book at ${esc(s.name)} →</a>
        <a class="btn btn-ghost" href="${esc(s.website)}" target="_blank" rel="noopener">Visit website</a>
        <button class="btn btn-save" type="button" data-save="${esc(s.name)}" aria-pressed="true">✓ Saved</button>
      </div>
    `;
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
  modal.addEventListener('click', e => {
    if (e.target.dataset.close !== undefined) { closeModal(); return; }
    const saveBtn = e.target.closest('[data-save]');
    if (saveBtn) {
      const name = saveBtn.dataset.save;
      window.PILATES_SHORTLIST.toggle(name);
      const saved = window.PILATES_SHORTLIST.has(name);
      saveBtn.textContent = saved ? '✓ Saved' : '+ Save';
      saveBtn.setAttribute('aria-pressed', String(saved));
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') closeModal();
  });

  // --- helpers (mirrored from app.js / landing.js) ---
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

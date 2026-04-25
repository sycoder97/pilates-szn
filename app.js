(() => {
  const state = {
    studios: [],
    filters: { zone: '', type: '', price: '', search: '' },
    byName: {},
  };

  const grid = document.getElementById('studio-grid');
  const resultCount = document.getElementById('result-count');
  const empty = document.getElementById('empty-state');
  const searchInput = document.getElementById('search');
  const modal = document.getElementById('studio-modal');
  const modalBody = document.getElementById('modal-body');

  document.getElementById('year').textContent = new Date().getFullYear();

  // --- data load ---
  fetch('studios.json', { cache: 'no-cache' })
    .then(r => r.json())
    .then(data => {
      state.studios = data.studios || [];
      state.studios.forEach(s => {
        s.minPrice = extractMinPrice(s);
        state.byName[s.name] = s;
      });
      document.getElementById('studio-count').textContent = state.studios.length;
      document.getElementById('last-verified').textContent = formatLatestVerified(state.studios);
      paintStats(state.studios);
      render();
    })
    .catch(err => {
      grid.innerHTML = `<p class="empty-state">Couldn't load the directory. Please refresh.</p>`;
      console.error(err);
    });

  // Stats strip on the merged landing/directory page. No-op if the elements
  // aren't present (e.g. a future page that doesn't show stats).
  function paintStats(studios) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('stat-count', String(studios.length).padStart(2, '0'));

    const prices = studios.map(s => s.minPrice).filter(n => n != null && isFinite(n));
    set('stat-cheapest', prices.length ? `£${Math.round(Math.min(...prices))}` : '—');

    const introCount = studios.filter(s => s.intro && /£|for/.test(s.intro)).length;
    set('stat-intros', String(introCount).padStart(2, '0'));

    const latest = studios.map(s => s.lastVerified).filter(Boolean).sort().pop();
    set('stat-verified', formatQuarter(latest));
  }

  // "2026-04-22" → "Q2·26"
  function formatQuarter(iso) {
    if (!iso) return '—';
    const [y, m] = iso.split('-').map(n => parseInt(n));
    const q = Math.floor((m - 1) / 3) + 1;
    return `Q${q}·${String(y).slice(2)}`;
  }

  // --- price parsing ---
  // Parse the lowest ongoing per-class price from the packages field.
  // Intentionally ignores `intro` — intro offers are one-off new-client
  // discounts, not what a member actually pays long-term.
  function extractMinPrice(studio) {
    const text = studio.packages || '';
    if (!text) return null;
    const nums = [];
    // Normalise "N for £X" or "N/£X" style pack pricing to per-class rate.
    const packRe = /(\d+)\s*(?:for|\/|·|x|\s)\s*£\s?(\d+(?:\.\d+)?)/gi;
    let m;
    while ((m = packRe.exec(text)) !== null) {
      const pack = parseInt(m[1]);
      const total = parseFloat(m[2]);
      if (pack >= 2 && pack <= 25) nums.push(total / pack);
    }
    // Grab bare £-per-class figures (e.g. "Single £30", "Drop-in £22–£28").
    // We only trust figures under £100 as per-class; larger numbers are packs.
    const bareRe = /£\s?(\d+(?:\.\d+)?)/g;
    while ((m = bareRe.exec(text)) !== null) {
      const n = parseFloat(m[1]);
      if (n > 0 && n < 100) nums.push(n);
    }
    if (!nums.length) return null;
    return Math.min(...nums);
  }

  function priceTier(min) {
    if (min == null) return null;
    if (min < 20) return 'under20';
    if (min < 30) return 'mid';
    return 'premium';
  }

  // --- rendering ---
  function render() {
    const list = filtered();
    resultCount.textContent = `${list.length} ${list.length === 1 ? 'studio' : 'studios'}`;
    empty.hidden = list.length !== 0;
    grid.innerHTML = list.map(cardHTML).join('');
    grid.querySelectorAll('.card').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('.book-btn')) return; // let book link through
        openModal(el.dataset.name);
      });
    });
  }

  function filtered() {
    const { zone, type, price, search } = state.filters;
    const q = search.trim().toLowerCase();
    return state.studios.filter(s => {
      if (zone && s.zone !== zone) return false;
      if (type && !(s.types || []).includes(type)) return false;
      if (price && priceTier(s.minPrice) !== price) return false;
      if (q) {
        const hay = `${s.name} ${s.areas} ${(s.types || []).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function cardHTML(s) {
    const types = (s.types || []).map(t => `<span class="tag tag-type">${esc(t)}</span>`).join('');
    const zoneLabel = { C: 'Central', N: 'North', S: 'South', E: 'East', W: 'West' }[s.zone] || s.zone;
    return `
      <button class="card" type="button" data-name="${esc(s.name)}" aria-label="View ${esc(s.name)}">
        ${cardVisual(s)}
        <div class="card-body">
          <div class="card-head">
            <h3 class="card-name">${esc(s.name)}</h3>
          </div>
          <div class="card-meta">
            <span class="tag tag-zone">${esc(zoneLabel)} London</span>
            ${types}
          </div>
          <p class="card-areas">${esc(s.areas)}</p>
          <dl class="card-pricing">
            ${s.intro ? `<dt>Intro</dt><dd>${esc(s.intro)}</dd>` : ''}
            ${s.minPrice ? `<dt>From</dt><dd>£${Math.round(s.minPrice)}/class</dd>` : (s.packages ? `<dt>From</dt><dd class="muted">${esc(s.packages)}</dd>` : '')}
          </dl>
          <div class="card-foot">
            <span class="verified">Verified ${esc(s.lastVerified || '—')}</span>
            <a class="book-btn" href="${outboundURL(s)}" target="_blank" rel="noopener sponsored" data-studio="${esc(s.name)}">Book</a>
          </div>
        </div>
      </button>
    `;
  }

  // Per-method tint applied behind the image so the fallback (or a transparent
  // logo) stays on-brand.
  const METHOD_TINT = {
    Reformer: '#E5E3DC', Mat: '#E8E4DA', Tower: '#E6DFCE',
    Lagree: '#DAD8D0', Barre: '#EAE4D5', Hot: '#DED9CF',
  };

  function cardVisual(s) {
    const tint = METHOD_TINT[(s.types || [])[0]] || '#E5E3DC';
    const placeholder = `repeating-linear-gradient(90deg, ${tint} 0 1px, transparent 1px 6px), ${tint}`;
    if (s.image) {
      return `
        <div class="card-visual" style="background: ${placeholder};">
          <img src="${esc(s.image)}" alt="${esc(s.name)}" loading="lazy" referrerpolicy="no-referrer"
               onload="if(this.naturalWidth && (this.naturalWidth < 400 || this.naturalWidth/this.naturalHeight < 1.15)) this.classList.add('is-logo')"
               onerror="this.style.display='none'" />
        </div>
      `;
    }
    return `<div class="card-visual" style="background: ${placeholder};"></div>`;
  }

  // --- modal ---
  function openModal(name) {
    const s = state.byName[name];
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
        <button class="btn btn-compare" type="button" data-compare="${esc(s.name)}" aria-pressed="${compareHas(s.name)}">${compareLabel(s.name)}</button>
      </div>
      <p class="report-row"><a href="${reportMailto(s)}" class="report-link">Something wrong with this listing? Report it →</a></p>
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
    const cmp = e.target.closest('[data-compare]');
    if (cmp) {
      const name = cmp.dataset.compare;
      window.PILATES_COMPARE.toggle(name);
      cmp.textContent = compareLabel(name);
      cmp.setAttribute('aria-pressed', String(compareHas(name)));
    }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') closeModal(); });

  function compareHas(name) {
    return !!(window.PILATES_COMPARE && window.PILATES_COMPARE.has(name));
  }
  function compareLabel(name) {
    return compareHas(name) ? '✓ Comparing' : '+ Compare';
  }

  // --- filtering events ---
  document.querySelectorAll('.chip-group').forEach(group => {
    const key = group.dataset.group;
    group.addEventListener('click', e => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      group.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.filters[key] = chip.dataset.value;
      render();
    });
  });
  searchInput.addEventListener('input', e => {
    state.filters.search = e.target.value;
    render();
  });
  document.getElementById('clear-filters').addEventListener('click', clearAll);
  document.getElementById('empty-clear').addEventListener('click', clearAll);
  function clearAll() {
    state.filters = { zone: '', type: '', price: '', search: '' };
    searchInput.value = '';
    document.querySelectorAll('.chip-group').forEach(g => {
      g.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.value === ''));
    });
    render();
  }

  // --- report-error link (mailto with prefilled subject + body) ---
  function reportMailto(s) {
    const cfg = window.PILATES_CONFIG || {};
    const email = cfg.contact || 'hi@pilateszn.com';
    const subject = `Listing correction: ${s.name}`;
    const body = [
      `Studio: ${s.name}`,
      `Current URL: ${s.website}`,
      `Areas: ${s.areas}`,
      `Last verified: ${s.lastVerified || '—'}`,
      '',
      'What needs fixing?',
      '',
    ].join('\n');
    return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  // --- outbound link construction ---
  function outboundURL(s) {
    const cfg = window.PILATES_CONFIG || { affiliates: {}, utm: {} };
    const affiliate = cfg.affiliates[s.name];
    if (affiliate) return affiliate;
    try {
      const url = new URL(s.website);
      Object.entries(cfg.utm || {}).forEach(([k, v]) => url.searchParams.set(k, v));
      return url.toString();
    } catch {
      return s.website;
    }
  }

  // --- misc ---
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function formatLatestVerified(studios) {
    const dates = studios.map(s => s.lastVerified).filter(Boolean).sort();
    if (!dates.length) return '—';
    const latest = dates[dates.length - 1];
    return latest;
  }
})();

(() => {
  // --- tints per method (Direction B palette-aligned warm neutrals) ---
  const TINT = {
    Reformer: '#E5E3DC',
    Mat:      '#E8E4DA',
    Tower:    '#E6DFCE',
    Lagree:   '#DAD8D0',
    Barre:    '#EAE4D5',
    Hot:      '#DED9CF',
    default:  '#E5E3DC',
  };

  fetch('studios.json', { cache: 'no-cache' })
    .then(r => r.json())
    .then(d => render(d.studios || []));

  function render(studios) {
    studios.forEach(s => s._minPrice = minPrice(s));

    // --- stats strip ---
    document.getElementById('stat-count').textContent = String(studios.length).padStart(2, '0');

    const prices = studios.map(s => s._minPrice).filter(n => n != null && isFinite(n));
    const cheapest = prices.length ? Math.min(...prices) : null;
    document.getElementById('stat-cheapest').textContent = cheapest != null ? `£${Math.round(cheapest)}` : '—';

    const introCount = studios.filter(s => s.intro && /£|for/.test(s.intro)).length;
    document.getElementById('stat-intros').textContent = String(introCount).padStart(2, '0');

    const latest = studios.map(s => s.lastVerified).filter(Boolean).sort().pop();
    document.getElementById('stat-verified').textContent = formatQuarter(latest);
    document.getElementById('foot-verified').textContent = `Verified ${formatDayMonthYear(latest)}`;

    // --- tile grid (first 6 featured) ---
    const featured = studios.slice(0, 6);
    const grid = document.getElementById('tile-grid');
    grid.innerHTML = featured.map(tileHTML).join('');
  }

  function tileHTML(s) {
    const method = (s.types && s.types[0]) || 'Reformer';
    const tint = TINT[method] || TINT.default;
    const priceDisplay = s._minPrice != null ? `£${Math.round(s._minPrice)}` : '—';
    const zoneLabel = ({ C: 'Central', N: 'North', S: 'South', E: 'East', W: 'West' })[s.zone] || s.zone;
    const areaShort = (s.areas || '').split(',')[0].trim();
    return `
      <a class="tile" href="/directory.html#${encodeURIComponent(s.name)}">
        <div class="b-placeholder" style="background: repeating-linear-gradient(90deg, ${tint} 0 1px, transparent 1px 6px), ${tint}; height: 130px;">${esc(method)}</div>
        <div class="tile-head">
          <h3 class="tile-name">${esc(s.name)}</h3>
          <span class="tile-price">${esc(priceDisplay)}</span>
        </div>
        <p class="tile-meta">${esc(areaShort || zoneLabel)} · ${esc(method)} · from ${esc(priceDisplay)}</p>
      </a>
    `;
  }

  // Parse the cheapest per-class rate from the packages string.
  function minPrice(s) {
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

  // "2026-04-22" → "Q2·26"
  function formatQuarter(iso) {
    if (!iso) return '—';
    const [y, m] = iso.split('-').map(n => parseInt(n));
    const q = Math.floor((m - 1) / 3) + 1;
    return `Q${q}·${String(y).slice(2)}`;
  }

  // "2026-04-22" → "22 / 04 / 26"
  function formatDayMonthYear(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d} / ${m} / ${String(y).slice(2)}`;
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }
})();

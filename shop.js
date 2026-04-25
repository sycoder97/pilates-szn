(() => {
  const state = { products: [], filter: '' };
  const grid = document.getElementById('product-grid');
  document.getElementById('year').textContent = new Date().getFullYear();

  // Soft-gradient palette per category — no stock photos needed.
  // Each product card gets a gradient background based on its category.
  const palette = {
    activewear: ['#f5d5c8', '#e8b8a5'],
    essentials: ['#ede2d2', '#d9c6ac'],
    matcha: ['#d7e0c4', '#b7c79a'],
    recovery: ['#e4d5e8', '#c9b3d0'],
    accessories: ['#f0dcc8', '#debf9f'],
    default: ['#ecdfd0', '#d9c6ac'],
  };

  fetch('products.json', { cache: 'no-cache' })
    .then(r => r.json())
    .then(d => {
      state.products = d.products || [];
      render();
    });

  function render() {
    const list = state.filter
      ? state.products.filter(p => p.category === state.filter)
      : state.products;
    grid.innerHTML = list.map(productHTML).join('');
  }

  function productHTML(p) {
    const [c1, c2] = palette[p.category] || palette.default;
    const initials = (p.brand || p.name).split(/\s+/).map(w => w[0]).slice(0, 2).join('');
    const href = outboundURL(p);
    return `
      <a class="product-card" href="${href}" target="_blank" rel="noopener sponsored" aria-label="${esc(p.name)} by ${esc(p.brand)}">
        <div class="product-visual" style="background: linear-gradient(135deg, ${c1}, ${c2})">
          <span class="product-initials">${esc(initials)}</span>
          ${p.tag ? `<span class="product-tag">${esc(p.tag)}</span>` : ''}
        </div>
        <div class="product-body">
          <p class="product-brand">${esc(p.brand)}</p>
          <h3 class="product-name">${esc(p.name)}</h3>
          <p class="product-desc">${esc(p.description)}</p>
          <div class="product-foot">
            <span class="product-price">${esc(p.priceRange)}</span>
            <span class="product-cta">Shop →</span>
          </div>
        </div>
      </a>
    `;
  }

  document.querySelectorAll('.chip-group').forEach(group => {
    group.addEventListener('click', e => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      group.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.filter = chip.dataset.value;
      render();
    });
  });

  function outboundURL(p) {
    const cfg = (window.PILATES_CONFIG && window.PILATES_CONFIG.utm) || {
      utm_source: 'pilateszn', utm_medium: 'shop', utm_campaign: 'product-card',
    };
    try {
      const url = new URL(p.affiliateUrl);
      Object.entries(cfg).forEach(([k, v]) => url.searchParams.set(k, v));
      return url.toString();
    } catch { return p.affiliateUrl; }
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }
})();

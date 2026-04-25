#!/usr/bin/env node
// Walk products.json and report which affiliateUrls return non-2xx (or fail to
// connect). Run weekly to catch retailers moving / killing product pages.
//
// Usage:
//   node scripts/check-product-links.mjs              # GET each URL
//   node scripts/check-product-links.mjs --json       # machine-readable output
//
// CI exit code is the count of broken links, capped at 1.

import { readFile } from 'node:fs/promises';

const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');

const UA = 'Mozilla/5.0 (compatible; pilates-szn-link-check/1.0; +https://pilates-szn.vercel.app)';
const TIMEOUT_MS = 12_000;
const CONCURRENCY = 6;

const data = JSON.parse(await readFile(new URL('../products.json', import.meta.url), 'utf8'));
const products = data.products || [];

async function check(p) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // Many retailers reject HEAD or return wrong codes; use GET with a tiny body read.
    const res = await fetch(p.affiliateUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' },
    });
    return { ok: res.ok, status: res.status, finalUrl: res.url };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  } finally {
    clearTimeout(t);
  }
}

// Run in batches so we don't hammer one origin and don't open 19 sockets at once.
const results = [];
for (let i = 0; i < products.length; i += CONCURRENCY) {
  const batch = products.slice(i, i + CONCURRENCY);
  const out = await Promise.all(batch.map(async p => ({ product: p, result: await check(p) })));
  results.push(...out);
}

const broken = results.filter(r => !r.result.ok);

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log(`\nChecked ${results.length} affiliate URLs across products.json\n`);
  for (const { product, result } of results) {
    const mark = result.ok ? '✓' : '✗';
    const tail = result.ok
      ? `${result.status}`
      : `${result.status || 'ERR'}${result.error ? ` (${result.error})` : ''}`;
    console.log(`  ${mark}  [${tail}]  ${product.brand} — ${product.name}`);
    if (!result.ok) console.log(`         ${product.affiliateUrl}`);
    if (result.finalUrl && result.finalUrl !== product.affiliateUrl) {
      console.log(`         → ${result.finalUrl}`);
    }
  }
  console.log(`\n${broken.length === 0 ? 'All links resolved.' : `${broken.length} broken link${broken.length === 1 ? '' : 's'}.`}\n`);
}

process.exit(broken.length === 0 ? 0 : 1);

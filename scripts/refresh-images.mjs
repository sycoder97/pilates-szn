#!/usr/bin/env node
/**
 * refresh-images.mjs
 *
 * Walks every studio in studios.json, fetches the studio website, and extracts
 * a hero image URL — preferring og:image, falling back to twitter:image, then
 * apple-touch-icon. Writes the resolved absolute URL into studio.image.
 *
 * Studios with `image` pinned in overrides.json are left alone.
 *
 * Usage:
 *   node scripts/refresh-images.mjs
 *   node scripts/refresh-images.mjs --dry-run
 *   node scripts/refresh-images.mjs --only "Heartcore"
 *   node scripts/refresh-images.mjs --missing-only   # only studios with no image yet
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'studios.json');
const OVERRIDES_PATH = path.join(ROOT, 'overrides.json');

const args = parseArgs(process.argv.slice(2));
const DRY = args['dry-run'] === true;
const ONLY = args.only || null;
const MISSING_ONLY = args['missing-only'] === true;
const TIMEOUT_MS = 12_000;
const CONCURRENCY = 6;

const UA = 'Mozilla/5.0 (compatible; pilates-szn-image-refresh/1.0; +https://pilates-szn.vercel.app)';

const data = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
const overrides = JSON.parse(await fs.readFile(OVERRIDES_PATH, 'utf8').catch(() => '{}'));
const overrideStudios = (overrides && overrides.studios) || {};

let targets = data.studios || [];
if (ONLY) {
  const q = ONLY.toLowerCase();
  targets = targets.filter(s => s.name.toLowerCase().includes(q));
}
if (MISSING_ONLY) {
  targets = targets.filter(s => !s.image);
}

const results = { updated: 0, skipped: 0, failed: 0, lines: [] };

async function processOne(studio) {
  const pinned = overrideStudios[studio.name] && overrideStudios[studio.name].image;
  if (pinned) {
    studio.image = pinned;
    results.skipped++;
    return `· ${studio.name} — pinned via overrides`;
  }

  if (!studio.website) {
    results.skipped++;
    return `· ${studio.name} — no website`;
  }

  try {
    const found = await extractImage(studio.website);
    if (!found) {
      results.failed++;
      return `✗ ${studio.name} — no og/twitter/apple image`;
    }
    if (studio.image === found) {
      results.skipped++;
      return `· ${studio.name} — unchanged`;
    }
    studio.image = found;
    results.updated++;
    return `✓ ${studio.name} — ${found}`;
  } catch (err) {
    results.failed++;
    return `✗ ${studio.name} — ${err.message}`;
  }
}

// Concurrent batches so we don't open 58 sockets at once.
for (let i = 0; i < targets.length; i += CONCURRENCY) {
  const batch = targets.slice(i, i + CONCURRENCY);
  const lines = await Promise.all(batch.map(processOne));
  lines.forEach(l => {
    console.log(l);
    results.lines.push(l);
  });
}

console.log(`\nDone. ${results.updated} updated · ${results.skipped} skipped · ${results.failed} failed.`);

if (!DRY && results.updated > 0) {
  await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`Wrote ${DATA_PATH}`);
}

// --- helpers ---

async function extractImage(websiteUrl) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(websiteUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, 'Accept': 'text/html' },
    });
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const baseUrl = res.url || websiteUrl;

  // Try in priority order. og:image is by far the best for hero photos;
  // the others are fallbacks.
  const patterns = [
    /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i,
    /<meta\s+name=["']og:image["']\s+content=["']([^"']+)["']/i,
    /<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i,
    /<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i,
    /<meta\s+content=["']([^"']+)["']\s+name=["']twitter:image["']/i,
    /<link\s+rel=["']apple-touch-icon[^"']*["']\s+[^>]*href=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) {
      const abs = absolutize(m[1].trim(), baseUrl);
      if (abs && /^https?:/i.test(abs) && !isJunkUrl(abs)) return abs;
    }
  }
  return null;
}

// Drop tracking pixels and other garbage that occasionally slips into og tags.
function isJunkUrl(url) {
  return /facebook\.com\/tr/i.test(url)
      || /google-analytics\.com|googletagmanager\.com|doubleclick\.net/i.test(url)
      || /\.ico(\?|$)/i.test(url);
}

function absolutize(url, base) {
  try { return new URL(url, base).toString(); } catch { return null; }
}

function parseArgs(argv) {
  // Flags that never take a value. Without this, a stray `#` or comment
  // from a clipboard paste gets swallowed as the flag's value.
  const BOOLEAN_FLAGS = new Set(['dry-run', 'missing-only']);
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    const name = eq > -1 ? a.slice(2, eq) : a.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      out[name] = true;
      continue;
    }
    if (eq > -1) { out[name] = a.slice(eq + 1); continue; }
    if (argv[i + 1] && !argv[i + 1].startsWith('--')) { out[name] = argv[++i]; }
    else out[name] = true;
  }
  return out;
}

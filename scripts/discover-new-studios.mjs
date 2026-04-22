#!/usr/bin/env node
/**
 * discover-new-studios.mjs
 *
 * Asks Gemini (with Google Search grounding) to find London pilates studios
 * that aren't already in our directory. Appends candidates to studios.json
 * and writes a markdown report for the PR body.
 *
 * Runs in GitHub Actions monthly. The Action creates a PR; you review
 * each candidate and merge (or close) to decide what goes live.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenerativeAI } from '@google/generative-ai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'studios.json');
const REPORT_PATH = path.join(ROOT, 'discovery-report.md');

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('Missing GEMINI_API_KEY');
  process.exit(1);
}

// Discovery needs full Flash because it uses grounded search (not available
// on flash-lite). Discovery only runs monthly with ~5 calls, so the 200/day
// free-tier limit is plenty.
const SEARCH_MODEL = process.env.GEMINI_SEARCH_MODEL || 'gemini-2.5-flash';
const JSON_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

const genAI = new GoogleGenerativeAI(API_KEY);

const searchModel = genAI.getGenerativeModel({
  model: SEARCH_MODEL,
  tools: [{ googleSearch: {} }],
  generationConfig: { temperature: 0.3 },
});

const jsonModel = genAI.getGenerativeModel({
  model: JSON_MODEL,
  generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
});

async function main() {
  const data = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
  const existing = data.studios;

  console.log(`Existing: ${existing.length} studios`);

  const candidates = await discover(existing);
  console.log(`Gemini returned ${candidates.length} candidates`);

  const novel = dedupe(candidates, existing);
  console.log(`After dedupe: ${novel.length} truly new`);

  if (!novel.length) {
    await writeReport([], 'No new studios found this month.');
    console.log('Nothing new. Report written.');
    return;
  }

  // Hydrate each candidate with pricing + full fields
  const hydrated = [];
  for (const c of novel) {
    console.log(`\n→ Hydrating: ${c.name}  ${c.website}`);
    const full = await hydrate(c);
    if (full) hydrated.push(full);
    await sleep(1500);
  }

  // Append to studios.json
  data.studios.push(...hydrated);
  data.generatedAt = new Date().toISOString().slice(0, 10);
  await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2) + '\n');

  await writeReport(hydrated, null);
  console.log(`\nAdded ${hydrated.length} candidates. Report at ${REPORT_PATH}`);
}

async function discover(existing) {
  const knownNames = existing.map(s => s.name).join(', ');
  const prompt = `You are researching London pilates studios in 2026. Use Google Search to find every independent pilates studio currently operating in London, especially:
- Studios that opened in the last 12–24 months
- Boutique reformer, Lagree, or classical studios
- Do NOT include: hot yoga studios, large gyms with one pilates class, PT studios with a single reformer, or franchise branches of chains we already list.

STUDIOS WE ALREADY HAVE (exclude these and their locations — do not return duplicates):
${knownNames}

Return ONLY a JSON array (no prose, no markdown code fences). Each item must be:
{
  "name": "Studio name",
  "website": "https://...",
  "areas": "Neighbourhood(s), e.g. Shoreditch",
  "zone": "C|N|S|E|W",
  "types": ["Reformer"],
  "why_new": "Brief reason (e.g. 'Opened Oct 2025 in Peckham')"
}

If you cannot find any, return [].`;

  let text;
  try {
    const result = await searchModel.generateContent(prompt);
    text = result.response.text();
  } catch (err) {
    console.error(`Search call failed: ${err.message}`);
    return [];
  }

  return parseJSONArray(text);
}

function parseJSONArray(text) {
  // Strip markdown fences if Gemini ignored our instruction
  const cleaned = text
    .replace(/^```(?:json)?\s*/gim, '')
    .replace(/```\s*$/gim, '')
    .trim();
  // Find the first [ ... ] block
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1) return [];
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (err) {
    console.error(`JSON parse failed: ${err.message}\n--- raw ---\n${cleaned.slice(0, 600)}`);
    return [];
  }
}

function dedupe(candidates, existing) {
  const seenDomains = new Set();
  const seenNames = new Set();
  for (const s of existing) {
    seenDomains.add(domain(s.website));
    seenNames.add(normaliseName(s.name));
  }
  return candidates.filter(c => {
    if (!c.name || !c.website) return false;
    const d = domain(c.website);
    const n = normaliseName(c.name);
    if (seenDomains.has(d) || seenNames.has(n)) return false;
    seenDomains.add(d);
    seenNames.add(n);
    return true;
  });
}

function domain(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
}
function normaliseName(name) {
  return name.toLowerCase()
    .replace(/\b(the|pilates|studio|studios|london|&|and)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Fetch the studio's site and ask Gemini to extract pricing + vibe. Then
// build a full studios.json entry with today's verified date.
async function hydrate(candidate) {
  const today = new Date().toISOString().slice(0, 10);
  const base = {
    name: candidate.name,
    zone: candidate.zone || 'C',
    areas: candidate.areas || '—',
    types: candidate.types || ['Reformer'],
    lat: null,
    lng: null,
    intro: null,
    packages: null,
    website: candidate.website,
    lastVerified: today,
    candidate: true, // flag so it's obvious in the PR
  };

  // Fetch the pricing/home page
  let html;
  try {
    const res = await fetch(candidate.website, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PilatesSznBot/1.0)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return base;
    html = await res.text();
  } catch (err) {
    console.error(`   fetch failed: ${err.message}`);
    return base;
  }

  const trimmed = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 150_000);

  const prompt = `Extract pricing from this London pilates studio's HTML.

Return JSON:
{
  "intro_offer": "3 for £45" or null,
  "drop_in": "£28" or null,
  "packages": "one-line summary of pack pricing and/or membership" or null,
  "types": ["Reformer"|"Mat"|"Tower"|"Lagree"|"Barre"|"Hot"]
}

Studio: ${candidate.name}
URL: ${candidate.website}
HTML: ${trimmed}`;

  try {
    const res = await jsonModel.generateContent(prompt);
    const parsed = JSON.parse(res.response.text());
    if (parsed.intro_offer) base.intro = parsed.intro_offer;
    const pkgs = [parsed.drop_in && `Drop-in ${parsed.drop_in}`, parsed.packages].filter(Boolean).join(' · ');
    if (pkgs) base.packages = pkgs;
    if (Array.isArray(parsed.types) && parsed.types.length) base.types = parsed.types;
  } catch (err) {
    console.error(`   extraction failed: ${err.message}`);
  }
  return base;
}

async function writeReport(studios, note) {
  const lines = [
    '## New studio candidates',
    '',
    note || `${studios.length} candidate${studios.length === 1 ? '' : 's'} found. Review each one below — merge this PR to add them live, or edit/delete entries in \`studios.json\` first.`,
    '',
  ];
  if (studios.length) {
    lines.push('| # | Name | Area | Types | Website | Pricing |');
    lines.push('|---|------|------|-------|---------|---------|');
    studios.forEach((s, i) => {
      lines.push(`| ${i + 1} | **${s.name}** | ${s.areas} (${s.zone}) | ${(s.types || []).join(', ')} | [link](${s.website}) | ${s.packages || '_not found_'} |`);
    });
    lines.push('');
    lines.push('**If a candidate is wrong:**');
    lines.push('- Edit `studios.json` in this branch to fix fields');
    lines.push('- Or delete the entry to reject it');
    lines.push('- Then merge');
  }
  await fs.writeFile(REPORT_PATH, lines.join('\n') + '\n');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

main().catch(err => { console.error(err); process.exit(1); });

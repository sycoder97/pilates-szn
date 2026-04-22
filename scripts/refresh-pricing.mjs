#!/usr/bin/env node
/**
 * refresh-pricing.mjs
 *
 * Fetches each studio's website, sends the HTML to Gemini, asks it to extract
 * current pricing, then writes the merged result to studios.json.
 *
 * Usage:
 *   GEMINI_API_KEY=xxx node scripts/refresh-pricing.mjs
 *   node scripts/refresh-pricing.mjs --dry-run
 *   node scripts/refresh-pricing.mjs --only "Heartcore"
 *   node scripts/refresh-pricing.mjs --stale-days=30  (skip studios verified recently)
 *
 * Overrides in overrides.json always win over extracted values.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenerativeAI } from '@google/generative-ai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'studios.json');
const OVERRIDES_PATH = path.join(ROOT, 'overrides.json');
const LOG_PATH = path.join(ROOT, 'refresh.log');

const args = parseArgs(process.argv.slice(2));
const DRY = args['dry-run'] === true;
const ONLY = args.only || null;
const STALE_DAYS = args['stale-days'] ? parseInt(args['stale-days']) : null;

// flash-lite has ~10× the free-tier daily quota of full flash. The task
// (extracting visible prices from HTML) doesn't need full Flash's reasoning.
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('Missing GEMINI_API_KEY env var. Get one free at https://aistudio.google.com/');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: MODEL_NAME,
  generationConfig: {
    responseMimeType: 'application/json',
    temperature: 0.1,
  },
});

// Separate model used only for URL healing (needs web search grounding,
// which flash-lite doesn't support). Only used when a studio's saved URL
// fails, so the quota impact is tiny.
const searchModel = genAI.getGenerativeModel({
  model: process.env.GEMINI_SEARCH_MODEL || 'gemini-2.0-flash',
  tools: [{ googleSearch: {} }],
  generationConfig: { temperature: 0.1 },
});

const UA =
  'Mozilla/5.0 (compatible; PilatesSznBot/1.0; +https://pilateszn.netlify.app/; directory pricing refresh once per week)';

const EXTRACTION_PROMPT = `You are extracting pricing information from a London pilates studio's website HTML.

Return a JSON object with exactly these fields:
{
  "wrong_studio": boolean,            // TRUE if this page is clearly NOT for the named studio (e.g. different business, parked domain, holding page).
  "intro_offer": string | null,       // New-customer intro offer, e.g. "3 for £45". Null if none advertised.
  "drop_in": string | null,           // Single group class price with currency, e.g. "£30" or "£22–£28". Null if unclear.
  "packages": string | null,          // Main class-pack and membership pricing summary in one line, e.g. "5 for £140 · 10 for £250 · Unlimited £220/mo". Null if not found.
  "confidence": number,               // 0 to 1. How confident are you the pricing is actually visible in this HTML.
  "notes": string | null              // Optional short note, e.g. "Pricing behind booking widget" or "Prices vary by class type". Null otherwise.
}

CRITICAL RULES:
- FIRST check whether this page is actually for the named studio. If the page doesn't mention the studio name anywhere (in title, header, logo alt text, about section), set wrong_studio: true and leave all price fields null.
- Only use prices that appear in the HTML. Do not invent or estimate.
- Focus on GROUP REFORMER or GROUP MAT pilates class pricing (the main offering). Ignore private sessions unless that's all they do.
- If pricing is hidden behind a login/booking widget (Mindbody, Momence, ClassPass widgets with no inline prices), set all price fields to null and note this.
- If multiple tiers exist (peak/off-peak), pick the cheapest standard group rate and note the range.
- Return ONLY valid JSON. No prose, no markdown.`;

// --- main ---
async function main() {
  const data = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
  const overrides = JSON.parse(await fs.readFile(OVERRIDES_PATH, 'utf8')).studios || {};

  let targets = data.studios;
  if (ONLY) {
    targets = targets.filter(s => s.name.toLowerCase().includes(ONLY.toLowerCase()));
    if (!targets.length) {
      console.error(`No studio matches --only "${ONLY}"`);
      process.exit(1);
    }
  }
  if (STALE_DAYS != null) {
    const cutoff = new Date(Date.now() - STALE_DAYS * 86400_000).toISOString().slice(0, 10);
    targets = targets.filter(s => !s.lastVerified || s.lastVerified < cutoff);
  }

  console.log(`Refreshing ${targets.length} / ${data.studios.length} studios (model=${MODEL_NAME}, dry=${DRY})`);
  const log = [];
  const today = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < targets.length; i++) {
    const studio = targets[i];
    console.log(`\n[${i + 1}/${targets.length}] ${studio.name}  ${studio.website}`);
    try {
      let html = await fetchHTML(studio.website);
      // Self-heal broken URLs: if the fetch failed, ask Gemini with search
      // to find the real URL, update studios.json, retry.
      if (!html) {
        console.log(`   URL broken — searching for correct one`);
        const fixed = await findCorrectURL(studio);
        if (fixed && fixed !== studio.website) {
          console.log(`   → ${fixed}`);
          studio.website = fixed;
          html = await fetchHTML(fixed);
        }
      }
      if (!html) {
        log.push({ studio: studio.name, status: 'fetch-failed' });
        continue;
      }
      let trimmed = trimHTML(html);
      let extracted = await extract(trimmed, studio);
      if (!extracted || extracted._error) {
        log.push({
          studio: studio.name,
          status: 'extract-failed',
          error: extracted?._error,
          raw: extracted?._raw,
        });
        console.error(`   ${extracted?._error || 'extract returned null'}`);
        if (extracted?._raw) console.error(`   raw: ${extracted._raw.slice(0, 160)}`);
        continue;
      }
      // If the URL loads but serves the wrong studio (common when a domain
      // changed hands), search for the correct one and retry.
      if (extracted.wrong_studio) {
        console.log(`   URL serves wrong business — searching`);
        const fixed = await findCorrectURL(studio);
        if (fixed && fixed !== studio.website) {
          console.log(`   → ${fixed}`);
          studio.website = fixed;
          const newHtml = await fetchHTML(fixed);
          if (newHtml) {
            trimmed = trimHTML(newHtml);
            extracted = await extract(trimmed, studio);
          }
        }
      }
      const before = { intro: studio.intro, packages: studio.packages };
      const changed = applyExtraction(studio, extracted, today);
      log.push({
        studio: studio.name,
        status: 'ok',
        confidence: extracted.confidence,
        notes: extracted.notes,
        changed,
        before,
        after: { intro: studio.intro, packages: studio.packages },
      });
      console.log(`   → confidence=${extracted.confidence} changed=${changed}`);
      if (extracted.notes) console.log(`   note: ${extracted.notes}`);
    } catch (err) {
      console.error(`   ✗ ${err.message}`);
      log.push({ studio: studio.name, status: 'error', error: err.message });
    }
    // Flash-lite free tier = 30 RPM. Pace at ~24 RPM to leave headroom for
    // retries + the occasional search call during URL healing.
    await sleep(2500);
  }

  // If more than half the studios errored, exit non-zero so GitHub Actions
  // shows the workflow as failed (prevents silent quota issues going green).
  const errorCount = log.filter(l => l.status === 'error').length;
  if (errorCount > targets.length / 2) {
    console.error(`\n⚠ ${errorCount}/${targets.length} studios errored — marking workflow as failed`);
    process.exitCode = 1;
  }

  // Apply manual overrides on top
  data.studios.forEach(s => {
    const ov = overrides[s.name];
    if (ov) Object.assign(s, ov);
  });

  data.generatedAt = today;

  if (DRY) {
    console.log('\n--- DRY RUN — not writing files ---');
    console.log(summarise(log));
    return;
  }

  await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  await fs.writeFile(LOG_PATH, JSON.stringify({ ranAt: new Date().toISOString(), results: log }, null, 2) + '\n');
  console.log('\n' + summarise(log));
  console.log(`\nWrote ${DATA_PATH}`);
}

// --- helpers ---

async function fetchHTML(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) {
      console.error(`   fetch ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.error(`   fetch error: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Strip scripts/styles, collapse whitespace, clamp size. We want pricing-relevant
// content without burning tokens on boilerplate.
function trimHTML(html) {
  let s = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Gemini 2.0 Flash has a huge context but we cap to keep it fast & free-tier friendly
  const MAX = 180_000;
  if (s.length > MAX) s = s.slice(0, MAX);
  return s;
}

// Ask Gemini (with Google search grounding) to find the real URL for a
// studio whose saved URL is broken. Returns a URL string or null.
async function findCorrectURL(studio) {
  const prompt = `I'm looking for the OFFICIAL current website of a London pilates studio. The one I had stopped working.

Studio name: "${studio.name}"
Neighbourhood: ${studio.areas}
Old URL (broken): ${studio.website}

Use Google Search to find the real current website. Requirements:
- Must be the studio's OWN official site (not a directory listing, not ClassPass, not MoveGB, not Instagram)
- Must be for this exact studio in London (not a same-named studio elsewhere)
- Must resolve to a working site

Respond with ONLY the URL, nothing else. If you cannot find it with confidence, respond with "NONE".`;
  const res = await callWithRetry(() => searchModel.generateContent(prompt));
  if (!res || res._isError) return null;
  const text = res.response.text().trim();
  if (text === 'NONE' || !text.startsWith('http')) return null;
  const url = text.replace(/[`"'\s]/g, '').split(/\s/)[0];
  return url;
}

async function extract(html, studio) {
  const prompt = `${EXTRACTION_PROMPT}\n\nStudio: ${studio.name}\nURL: ${studio.website}\n\nHTML:\n${html}`;
  const result = await callWithRetry(() => model.generateContent(prompt));
  if (!result) {
    return { _error: 'gemini call failed (null result)' };
  }
  if (result._isError) {
    return { _error: result._error };
  }
  let text;
  try {
    text = result.response.text();
  } catch (err) {
    return { _error: `response.text() threw: ${err.message}` };
  }
  // Strip markdown code fences if Gemini decided to add them despite
  // responseMimeType: application/json.
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.confidence !== 'number') parsed.confidence = 0;
    return parsed;
  } catch (err) {
    return { _error: `parse failed: ${err.message}`, _raw: text.slice(0, 300) };
  }
}

// Retry wrapper for Gemini calls. Handles 429 rate-limits with exponential
// backoff. On persistent failure, returns null so the caller can continue
// rather than crashing the whole batch.
async function callWithRetry(fn, attempts = 3) {
  let delay = 30_000;
  let lastMsg = 'unknown error';
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err?.message || String(err);
      lastMsg = msg;
      const is429 = msg.includes('429') || msg.includes('Too Many Requests') || msg.includes('RESOURCE_EXHAUSTED');
      if (!is429 || i === attempts - 1) {
        console.error(`   gemini error: ${msg.slice(0, 400)}`);
        const out = { _error: msg.slice(0, 400) };
        Object.defineProperty(out, '_isError', { value: true });
        return out;
      }
      console.log(`   429 rate-limit — waiting ${delay / 1000}s`);
      await sleep(delay);
      delay *= 2;
    }
  }
  return { _error: lastMsg.slice(0, 400), _isError: true };
}

// Mutates studio in place. Returns true if anything changed.
function applyExtraction(studio, x, today) {
  if (!x || x.confidence == null || x.confidence < 0.4) return false;
  let changed = false;
  if (x.intro_offer && x.intro_offer !== studio.intro) {
    studio.intro = x.intro_offer;
    changed = true;
  }
  const packagesStr = [x.drop_in && `Drop-in ${x.drop_in}`, x.packages]
    .filter(Boolean)
    .join(' · ');
  if (packagesStr && packagesStr !== studio.packages) {
    studio.packages = packagesStr;
    changed = true;
  }
  if (changed || x.confidence >= 0.6) {
    studio.lastVerified = today;
  }
  return changed;
}

function summarise(log) {
  const ok = log.filter(l => l.status === 'ok');
  const changed = ok.filter(l => l.changed);
  const lowConf = ok.filter(l => l.confidence < 0.4);
  const failed = log.filter(l => l.status !== 'ok');
  return [
    `=== Summary ===`,
    `Total:      ${log.length}`,
    `Changed:    ${changed.length}`,
    `No change:  ${ok.length - changed.length}`,
    `Low-conf:   ${lowConf.length}`,
    `Failed:     ${failed.length}`,
    failed.length ? `  ${failed.map(f => `- ${f.studio}: ${f.status}`).join('\n  ')}` : '',
  ].filter(Boolean).join('\n');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq >= 0) out[a.slice(2, eq)] = a.slice(eq + 1);
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        out[a.slice(2)] = argv[++i];
      } else {
        out[a.slice(2)] = true;
      }
    }
  }
  return out;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

main().catch(err => {
  console.error(err);
  process.exit(1);
});

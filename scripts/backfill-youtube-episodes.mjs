#!/usr/bin/env node
// Back-fill published slots from a JSON file of historical episodes
// (typically scraped from YouTube). Idempotent on (show_id, episode_number)
// so re-running is safe — existing slots at the same number are skipped.
//
// Why slots (and not a separate "episodes" table): see
// migrations/0011_slot_episode_number.sql. A published slot already
// carries title / body / artwork / media / publish-time / host / show;
// back-filling is just `INSERT INTO slots` with status='published'.
//
// Required args:
//   --slate <slug>      slate slug (e.g. immediate-justice-aemxnvs)
//   --show  <slug>      show slug  (e.g. reformed-labs)
//   --file  <path>      JSON file (shape below)
//
// Optional args:
//   --apply             commit. Without it, dry-run only.
//
// JSON file shape — an array of:
//   {
//     "episode_number":   42,                                 // required, integer
//     "title":            "Episode title",                    // required
//     "published_at":     "2023-01-15T19:30:00Z",             // required, ISO 8601 — used as slot.start_time
//     "youtube_url":      "https://youtube.com/watch?v=xxx",  // required
//     "description":      "Markdown body…",                   // optional → slot.show_notes
//     "duration_minutes": 60,                                 // optional, default 60
//     "host_id":          "<user id>"                         // optional → slot.host_id
//   }
//
// Example:
//   node scripts/backfill-youtube-episodes.mjs \
//     --slate immediate-justice-aemxnvs --show reformed-labs \
//     --file ./scripts/data/reformed-labs-episodes.json --apply

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// ── Arg parsing ───────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { out[key] = true; }
      else { out[key] = next; i++; }
    } else { out._.push(a); }
  }
  return out;
}
const args = parseArgs(process.argv);

function req(name) {
  const v = args[name];
  if (!v || typeof v !== 'string') {
    console.error(`Missing required arg --${name}`);
    process.exit(2);
  }
  return v;
}

const SLATE_SLUG = req('slate');
const SHOW_SLUG  = req('show');
const FILE_PATH  = req('file');
const APPLY      = args.apply === true;

// ── Wrangler helpers ──────────────────────────────────────────────────
function wranglerQuery(sql) {
  const one = sql.replace(/\s+/g, ' ').trim();
  const out = execSync(
    `npx wrangler d1 execute slate-podcast --remote --json --command ${JSON.stringify(one)}`,
    { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 32 * 1024 * 1024 },
  ).toString();
  return JSON.parse(out)[0]?.results ?? [];
}

function wranglerExec(sql) {
  const one = sql.replace(/\s+/g, ' ').trim();
  execSync(
    `npx wrangler d1 execute slate-podcast --remote --command ${JSON.stringify(one)}`,
    { stdio: 'inherit' },
  );
}

function randomId(n = 10) {
  return [...crypto.getRandomValues(new Uint8Array(n))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function sqlEsc(s) {
  return s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`;
}

// ── Step 1: resolve show + slate ──────────────────────────────────────
console.error(`Resolving show "${SHOW_SLUG}" on slate "${SLATE_SLUG}"…`);
const [info] = wranglerQuery(`
  SELECT sh.id AS show_id, sh.name AS show_name,
         sl.id AS slate_id
  FROM shows sh JOIN slates sl ON sl.id = sh.slate_id
  WHERE sl.slug = '${SLATE_SLUG}' AND sh.slug = '${SHOW_SLUG}'
`);
if (!info) {
  console.error(`ERROR: show "${SHOW_SLUG}" on slate "${SLATE_SLUG}" not found`);
  process.exit(1);
}
console.error(`  → show_id=${info.show_id}  name="${info.show_name}"`);

// ── Step 2: load + validate the JSON ──────────────────────────────────
let raw;
try {
  raw = JSON.parse(readFileSync(FILE_PATH, 'utf8'));
} catch (err) {
  console.error(`ERROR: couldn't read JSON file at ${FILE_PATH}: ${err.message}`);
  process.exit(1);
}
if (!Array.isArray(raw)) {
  console.error(`ERROR: top-level JSON must be an array of episode objects`);
  process.exit(1);
}

const episodes = raw.map((e, i) => {
  function need(field) {
    if (e[field] === undefined || e[field] === null || e[field] === '') {
      console.error(`ERROR: entry ${i} missing required field "${field}"`);
      process.exit(1);
    }
  }
  need('episode_number');
  need('title');
  need('published_at');
  need('youtube_url');

  const epoch = Math.floor(new Date(e.published_at).getTime() / 1000);
  if (!Number.isFinite(epoch)) {
    console.error(`ERROR: entry ${i} has invalid published_at "${e.published_at}"`);
    process.exit(1);
  }
  return {
    episode_number:   Number(e.episode_number),
    title:            String(e.title),
    epoch_sec:        epoch,
    youtube_url:      String(e.youtube_url),
    description:      e.description ?? null,
    duration_minutes: e.duration_minutes ?? 60,
    host_id:          e.host_id ?? null,
  };
});

// ── Step 3: look up which episode_numbers already exist for this show ─
const numbers = episodes.map(e => e.episode_number);
const CHUNK = 90;
const existing = new Map();   // episode_number → slot.id
for (let i = 0; i < numbers.length; i += CHUNK) {
  const batch = numbers.slice(i, i + CHUNK);
  const inList = batch.join(',');
  const rows = wranglerQuery(`
    SELECT id, episode_number
    FROM slots
    WHERE show_id = '${info.show_id}' AND episode_number IN (${inList})
  `);
  for (const r of rows) existing.set(r.episode_number, r.id);
}

const toInsert = episodes.filter(e => !existing.has(e.episode_number));
const skipped  = episodes.filter(e =>  existing.has(e.episode_number));

console.error(`\nSummary:`);
console.error(`  already in DB (skip): ${skipped.length}`);
console.error(`  to INSERT:            ${toInsert.length}`);
console.error(`  total in file:        ${episodes.length}\n`);

if (toInsert.length > 0) {
  console.error('Sample NEW episodes:');
  for (const e of toInsert.slice(0, 3)) {
    console.error(`  + #${e.episode_number}  ${new Date(e.epoch_sec * 1000).toISOString().slice(0, 10)}  ${e.title.slice(0, 60)}`);
  }
  if (toInsert.length > 6) console.error('    …');
  for (const e of toInsert.slice(-3)) {
    console.error(`  + #${e.episode_number}  ${new Date(e.epoch_sec * 1000).toISOString().slice(0, 10)}  ${e.title.slice(0, 60)}`);
  }
  console.error();
}

if (!APPLY) {
  console.error('Dry run. Re-run with --apply to commit.');
  process.exit(0);
}

// ── Step 4: insert in batches ─────────────────────────────────────────
// Two-table write (slots + slot_assets) per episode. D1 has no
// multi-statement transactions across the HTTP API, so we batch each
// table separately. If the slots insert succeeds and the assets insert
// fails, we end up with a slot missing its video asset — operator can
// re-run, which will see the slot in `existing` and skip it, leaving
// the orphaned-asset case to a manual fix-up.

const CHUNK_WRITE = 30;     // each slot row has ~15 columns ≈ 450 params; D1 cap is ~100, so 30 stays safe via INSERT … VALUES (…), (…)
const newSlotIds = new Map();   // episode_number → new slot.id

let inserted = 0;
for (let i = 0; i < toInsert.length; i += CHUNK_WRITE) {
  const batch = toInsert.slice(i, i + CHUNK_WRITE);
  const rows = batch.map(e => {
    const id = `slot_${randomId(10)}`;
    newSlotIds.set(e.episode_number, id);
    return `(
      ${sqlEsc(id)},
      ${sqlEsc(info.slate_id)},
      NULL,
      ${sqlEsc(info.show_id)},
      ${e.epoch_sec},
      ${e.duration_minutes},
      'published',
      ${sqlEsc(e.host_id)},
      NULL,
      ${sqlEsc(e.title)},
      NULL,
      ${sqlEsc(e.description)},
      ${e.epoch_sec},
      NULL,
      unixepoch(),
      ${e.episode_number}
    )`;
  }).join(',\n');

  wranglerExec(`
    INSERT INTO slots
      (id, slate_id, rule_id, show_id, start_time, duration_minutes, status,
       host_id, topic_id, custom_title, notes_internal, show_notes,
       show_notes_published_at, promo_image_url, created_at, episode_number)
    VALUES ${rows}
  `);
  inserted += batch.length;
  console.error(`  INSERT slots → ${inserted}/${toInsert.length}`);
}

// ── Step 5: insert YouTube URLs into slot_assets ──────────────────────
let assetsInserted = 0;
for (let i = 0; i < toInsert.length; i += CHUNK_WRITE) {
  const batch = toInsert.slice(i, i + CHUNK_WRITE);
  const rows = batch.map(e => {
    const slotId = newSlotIds.get(e.episode_number);
    const assetId = `sas_${randomId(10)}`;
    return `(${sqlEsc(assetId)}, ${sqlEsc(slotId)}, 'video', ${sqlEsc(e.youtube_url)}, 'YouTube', 0, unixepoch())`;
  }).join(',\n');

  wranglerExec(`
    INSERT INTO slot_assets (id, slot_id, kind, url, title, sort_order, created_at)
    VALUES ${rows}
  `);
  assetsInserted += batch.length;
  console.error(`  INSERT slot_assets → ${assetsInserted}/${toInsert.length}`);
}

console.error(`\nDone.`);
console.error(`  Slots inserted:   ${inserted}`);
console.error(`  Assets inserted:  ${assetsInserted}`);
console.error(`  Skipped (already in DB): ${skipped.length}`);

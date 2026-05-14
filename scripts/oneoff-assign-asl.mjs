#!/usr/bin/env node
// One-off: assign every-other-Friday at 6 PM Central from 2026-05-22
// through 2030-12-31 to the show "abolitionist-story-hour" on the
// "immediate-justice-aemxnvs" slate. CREATES SLOTS THAT DON'T EXIST.
//
// Strategy:
//   1. Generate the target wall-clock list (bi-weekly Fridays at 18:00
//      in America/Chicago between FROM and TO).
//   2. Convert each to a UTC epoch using a DST-aware offset lookup.
//   3. SELECT existing slots at those start_times.
//   4. For each target:
//        - already this show           → skip
//        - exists, owned by other show → skip (won't overwrite)
//        - exists, unassigned          → UPDATE show_id (+ host_id when null)
//        - doesn't exist               → INSERT with show_id + host_id
//   5. Log a single show_slots_assigned activity entry covering the
//      whole operation.
//
//   dry-run:  node scripts/oneoff-assign-asl.mjs
//   apply:    node scripts/oneoff-assign-asl.mjs --apply

import { execSync } from 'node:child_process';

const SLATE_SLUG = 'immediate-justice-aemxnvs';
const SHOW_SLUG  = 'abolitionist-story-hour';
const FROM_YMD   = '2026-05-22';   // Friday
const TO_YMD     = '2030-12-31';
const EVERY_N    = 2;              // bi-weekly
const AT_TIME    = '18:00';
const AT_TZ      = 'America/Chicago';
const DEFAULT_DURATION_MIN = 60;

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

// ── Date helpers ──────────────────────────────────────────────────────

// What's the UTC offset (in minutes) of a given UTC instant when
// projected into a target timezone? Positive = ahead of UTC. Handles DST.
function tzOffsetMinutes(epochMs, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(new Date(epochMs));
  const get = (t) => Number(parts.find(p => p.type === t)?.value ?? 0);
  let h = get('hour');
  // 'hour12: false' sometimes returns "24" for midnight on Node; normalize.
  if (h === 24) h = 0;
  const localUtc = Date.UTC(get('year'), get('month') - 1, get('day'), h, get('minute'), get('second'));
  return (localUtc - epochMs) / 60_000;
}

// Given a wall-clock (Y-M-D h:m) in a target timezone, return the UTC
// epoch (seconds). DST-aware via iterative offset resolution; one pass
// is enough since the offset only depends on the wall-clock day, not
// on the eventual epoch.
function tzWallToEpochSec(y, mo, d, h, mi, tz) {
  const guessMs = Date.UTC(y, mo - 1, d, h, mi);
  const offsetMin = tzOffsetMinutes(guessMs, tz);
  return Math.floor((guessMs - offsetMin * 60_000) / 1000);
}

function ymdInTz(epochSec, tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(epochSec * 1000));
}

function hhmmInTz(epochSec, tz) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(epochSec * 1000)).replace(/^24:/, '00:');
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
  SELECT sh.id AS show_id, sh.host_id, sh.name AS show_name,
         sl.id AS slate_id, sl.timezone AS slate_tz
  FROM shows sh JOIN slates sl ON sl.id = sh.slate_id
  WHERE sl.slug = '${SLATE_SLUG}' AND sh.slug = '${SHOW_SLUG}'
`);
if (!info) {
  console.error(`ERROR: show "${SHOW_SLUG}" on slate "${SLATE_SLUG}" not found`);
  process.exit(1);
}
console.error(`  → show_id=${info.show_id}  name="${info.show_name}"  slate_tz=${info.slate_tz}  default_host=${info.host_id ?? '(none)'}`);

// ── Step 2: generate target wall-clocks → UTC epochs ──────────────────
const [fromY, fromM, fromD] = FROM_YMD.split('-').map(Number);
const [toY, toM, toD] = TO_YMD.split('-').map(Number);
const fromBaseDays = Date.UTC(fromY, fromM - 1, fromD) / 86_400_000;
const toBaseDays   = Date.UTC(toY,   toM   - 1, toD)   / 86_400_000;
const [tH, tMi] = AT_TIME.split(':').map(Number);

const targets = []; // { epoch_sec, ymd }
const stepDays = EVERY_N * 7;
for (let dayN = fromBaseDays; dayN <= toBaseDays; dayN += stepDays) {
  const d = new Date(dayN * 86_400_000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const epochSec = tzWallToEpochSec(y, m, day, tH, tMi, AT_TZ);
  targets.push({ epoch_sec: epochSec, ymd: `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}` });
}
console.error(`Generated ${targets.length} target Fridays at 18:00 ${AT_TZ}.`);

// ── Step 3: look up which targets already have slots ──────────────────
const startTimes = targets.map(t => t.epoch_sec);
const CHUNK_SELECT = 90;
const existingByStart = new Map();
for (let i = 0; i < startTimes.length; i += CHUNK_SELECT) {
  const batch = startTimes.slice(i, i + CHUNK_SELECT);
  const inList = batch.join(',');
  const rows = wranglerQuery(`
    SELECT id, start_time, status, host_id, show_id
    FROM slots
    WHERE slate_id = '${info.slate_id}' AND start_time IN (${inList})
  `);
  for (const r of rows) existingByStart.set(r.start_time, r);
}

let toUpdate = [];   // slot rows to UPDATE
let toInsert = [];   // targets to INSERT
let alreadyMine = 0;
let conflicts  = 0;

for (const t of targets) {
  const existing = existingByStart.get(t.epoch_sec);
  if (!existing) { toInsert.push(t); continue; }
  if (existing.show_id === info.show_id) { alreadyMine++; continue; }
  if (existing.show_id && existing.show_id !== info.show_id) { conflicts++; continue; }
  toUpdate.push(existing);
}

console.error(`\nSummary:`);
console.error(`  already this show : ${alreadyMine}`);
console.error(`  conflicts (skip)  : ${conflicts}`);
console.error(`  to UPDATE         : ${toUpdate.length}`);
console.error(`  to INSERT (new)   : ${toInsert.length}`);
console.error(`  total target dates: ${targets.length}\n`);

const show = (epoch_sec) =>
  `${ymdInTz(epoch_sec, AT_TZ)}  ${hhmmInTz(epoch_sec, AT_TZ)} ${AT_TZ}`;

if (toInsert.length > 0) {
  console.error('Sample NEW slots:');
  for (const t of toInsert.slice(0, 3)) console.error(`  + ${show(t.epoch_sec)}`);
  if (toInsert.length > 6) console.error('    …');
  for (const t of toInsert.slice(-3)) console.error(`  + ${show(t.epoch_sec)}`);
  console.error();
}

if (!process.argv.includes('--apply')) {
  console.error('Dry run. Re-run with --apply to commit.');
  process.exit(0);
}

// ── Step 4: apply ─────────────────────────────────────────────────────
const CHUNK_WRITE = 50;

// UPDATE: assign show_id, fill host_id when null, flip 'open' → 'assigned' if host is set.
let updated = 0;
for (let i = 0; i < toUpdate.length; i += CHUNK_WRITE) {
  const batch = toUpdate.slice(i, i + CHUNK_WRITE);
  const ids = batch.map(s => sqlEsc(s.id)).join(',');
  if (info.host_id) {
    // Set host_id only where it's currently NULL (preserves manual assignments).
    wranglerExec(`
      UPDATE slots
      SET show_id = ${sqlEsc(info.show_id)},
          host_id = COALESCE(host_id, ${sqlEsc(info.host_id)}),
          status = CASE WHEN status = 'open' AND COALESCE(host_id, ${sqlEsc(info.host_id)}) IS NOT NULL THEN 'assigned' ELSE status END
      WHERE id IN (${ids})
    `);
  } else {
    wranglerExec(`UPDATE slots SET show_id = ${sqlEsc(info.show_id)} WHERE id IN (${ids})`);
  }
  updated += batch.length;
  console.error(`  UPDATE → ${updated}/${toUpdate.length}`);
}

// INSERT: build VALUES tuples in batches.
let inserted = 0;
const status = info.host_id ? 'assigned' : 'open';
for (let i = 0; i < toInsert.length; i += CHUNK_WRITE) {
  const batch = toInsert.slice(i, i + CHUNK_WRITE);
  const rows = batch.map(t => {
    const id = `slot_${randomId(10)}`;
    return `(${sqlEsc(id)}, ${sqlEsc(info.slate_id)}, NULL, ${sqlEsc(info.show_id)}, ${t.epoch_sec}, ${DEFAULT_DURATION_MIN}, '${status}', ${sqlEsc(info.host_id)}, NULL, NULL, NULL, NULL, NULL, NULL, unixepoch())`;
  }).join(',\n');
  wranglerExec(`
    INSERT OR IGNORE INTO slots
      (id, slate_id, rule_id, show_id, start_time, duration_minutes, status,
       host_id, topic_id, custom_title, notes_internal, show_notes,
       show_notes_published_at, promo_image_url, created_at)
    VALUES ${rows}
  `);
  inserted += batch.length;
  console.error(`  INSERT → ${inserted}/${toInsert.length}`);
}

// Activity log entry for the whole operation.
const totalAssigned = toUpdate.length + toInsert.length;
if (totalAssigned > 0) {
  const actor = wranglerQuery(`SELECT id FROM users WHERE email = 'ddrscott@gmail.com'`)[0];
  const meta = JSON.stringify({
    show_id: info.show_id,
    show_name: info.show_name,
    count: totalAssigned,
    created: toInsert.length,
    updated: toUpdate.length,
  }).replace(/'/g, "''");
  wranglerExec(`
    INSERT INTO activity (id, slate_id, actor_id, kind, meta, created_at)
    VALUES ('act_${randomId(5)}', ${sqlEsc(info.slate_id)},
            ${actor ? sqlEsc(actor.id) : 'NULL'},
            'show_slots_assigned', '${meta}', unixepoch())
  `);
}

console.error(`\nDone.`);
console.error(`  UPDATEd: ${toUpdate.length}`);
console.error(`  INSERTed: ${toInsert.length}`);
console.error(`  Already this show: ${alreadyMine}`);
console.error(`  Skipped (owned by other shows): ${conflicts}`);
console.error(`  Total target dates: ${targets.length}`);

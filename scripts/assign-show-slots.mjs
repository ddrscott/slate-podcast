#!/usr/bin/env node
// Bulk-assign + create slots for a show on a recurring pattern.
// Run by an operator who has D1 access (i.e., admin team) when a slate
// admin wants to bootstrap a show's recurring schedule.
//
// Does what the bulk-assign UI does AND creates slots that don't exist
// yet at the target wall-clocks — useful when a show's cadence doesn't
// match the slate's existing slot_rules.
//
// Required args:
//   --slate  <slug>        e.g. immediate-justice-aemxnvs
//   --show   <slug>        e.g. abolitionist-story-hour
//   --from   YYYY-MM-DD    inclusive (in --tz)
//   --to     YYYY-MM-DD    inclusive
//   --time   HH:MM         24-hour wall-clock in --tz
//
// Optional args:
//   --every     N           1=weekly, 2=bi-weekly, etc. (default 1)
//   --tz        IANA-tz     defaults to slate.timezone
//   --duration  minutes     new-slot duration in minutes (default 60)
//   --day       sun|mon|... force a weekday; default = whatever day --from is
//   --apply                 commit. Without it, dry-run only.
//
// Strategy:
//   1. Resolve show + slate
//   2. Generate target wall-clock list (stepping --every weeks from --from)
//   3. DST-aware wall-clock → UTC epoch per target
//   4. SELECT existing slots at those start_times (chunked for D1 param cap)
//   5. Per target:
//        - already this show           → skip
//        - exists, owned by other show → skip (won't overwrite)
//        - exists, unassigned          → UPDATE show_id (+ host_id when null)
//        - doesn't exist               → INSERT new slot, status='assigned'
//                                        when the show has a default host,
//                                        else 'open'
//   6. Single show_slots_assigned activity entry per run.
//
// Examples:
//   node scripts/assign-show-slots.mjs \
//     --slate immediate-justice-aemxnvs --show abolitionist-story-hour \
//     --from 2026-05-22 --to 2030-12-31 --every 2 --time 18:00 \
//     --tz America/Chicago --apply
//
//   node scripts/assign-show-slots.mjs \
//     --slate immediate-justice-aemxnvs --show reformed-labs \
//     --from 2026-05-15 --to 2030-12-31 --every 2 --time 20:00 \
//     --tz America/Chicago --apply

import { execSync } from 'node:child_process';

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
const FROM_YMD   = req('from');
const TO_YMD     = req('to');
const AT_TIME    = req('time');
const EVERY_N    = Number(args.every ?? 1);
const DURATION   = Number(args.duration ?? 60);
const FORCED_DAY = (args.day ?? '').toString().toLowerCase() || null;
const APPLY      = args.apply === true;

if (!/^\d{4}-\d{2}-\d{2}$/.test(FROM_YMD) || !/^\d{4}-\d{2}-\d{2}$/.test(TO_YMD)) {
  console.error('--from / --to must be YYYY-MM-DD');
  process.exit(2);
}
if (!/^\d{2}:\d{2}$/.test(AT_TIME)) {
  console.error('--time must be HH:MM (24-hour)');
  process.exit(2);
}
if (!Number.isInteger(EVERY_N) || EVERY_N < 1 || EVERY_N > 12) {
  console.error('--every must be an integer 1..12');
  process.exit(2);
}

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

// ── Date helpers ──────────────────────────────────────────────────────
function tzOffsetMinutes(epochMs, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(new Date(epochMs));
  const get = (t) => Number(parts.find(p => p.type === t)?.value ?? 0);
  let h = get('hour');
  if (h === 24) h = 0;
  const localUtc = Date.UTC(get('year'), get('month') - 1, get('day'), h, get('minute'), get('second'));
  return (localUtc - epochMs) / 60_000;
}

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

function dowInTz(epochSec, tz) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' })
    .format(new Date(epochSec * 1000)).toLowerCase();
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
const AT_TZ = (args.tz ?? info.slate_tz).toString();
console.error(`  → show_id=${info.show_id}  name="${info.show_name}"`);
console.error(`  → slate_tz=${info.slate_tz}  using tz=${AT_TZ}  default_host=${info.host_id ?? '(none)'}`);

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
  const epochSec = tzWallToEpochSec(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), tH, tMi, AT_TZ);
  // Optional weekday guard — if the operator passed --day, verify each
  // generated date is on that weekday. Catches user typos in --from
  // (e.g. a Monday date with --day fri).
  if (FORCED_DAY) {
    const dow = dowInTz(epochSec, AT_TZ);
    if (dow !== FORCED_DAY) {
      console.error(`ERROR: --from ${FROM_YMD} is a ${dow.toUpperCase()} in ${AT_TZ}; --day=${FORCED_DAY} mismatched`);
      process.exit(1);
    }
  }
  targets.push({ epoch_sec: epochSec, ymd: ymdInTz(epochSec, AT_TZ) });
}
const startDow = dowInTz(targets[0].epoch_sec, AT_TZ);
console.error(`Generated ${targets.length} targets, every ${EVERY_N}w on ${startDow.toUpperCase()} at ${AT_TIME} ${AT_TZ}.`);

// ── Step 3: look up existing slots ────────────────────────────────────
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

const toUpdate = [];
const toInsert = [];
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

if (!APPLY) {
  console.error('Dry run. Re-run with --apply to commit.');
  process.exit(0);
}

// ── Step 4: apply ─────────────────────────────────────────────────────
const CHUNK_WRITE = 50;
let updated = 0;
for (let i = 0; i < toUpdate.length; i += CHUNK_WRITE) {
  const batch = toUpdate.slice(i, i + CHUNK_WRITE);
  const ids = batch.map(s => sqlEsc(s.id)).join(',');
  if (info.host_id) {
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

let inserted = 0;
const status = info.host_id ? 'assigned' : 'open';
for (let i = 0; i < toInsert.length; i += CHUNK_WRITE) {
  const batch = toInsert.slice(i, i + CHUNK_WRITE);
  const rows = batch.map(t => {
    const id = `slot_${randomId(10)}`;
    return `(${sqlEsc(id)}, ${sqlEsc(info.slate_id)}, NULL, ${sqlEsc(info.show_id)}, ${t.epoch_sec}, ${DURATION}, '${status}', ${sqlEsc(info.host_id)}, NULL, NULL, NULL, NULL, NULL, NULL, unixepoch())`;
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

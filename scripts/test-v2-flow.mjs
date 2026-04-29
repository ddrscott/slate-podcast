// End-to-end smoke test for Slate v2.
// Generates auth.ljs.app-format JWTs (HMAC-SHA256) using the dev JWT_SECRET
// and walks through the entire flow: admin creates slate, members join,
// topics, upvotes, dup detection, slot assignment, topic marrying,
// boot another host, slug change, show notes publishing, reminders.

import fs from 'node:fs';
import path from 'node:path';

// Read JWT_SECRET from .dev.vars
const devVars = fs.readFileSync(path.join(import.meta.dirname, '..', '.dev.vars'), 'utf8');
const SECRET = devVars.match(/^JWT_SECRET=(.+)$/m)[1];
const BASE = process.env.BASE ?? 'http://localhost:4321';

let pass = 0, fail = 0;
function ok(label) { console.log(`✓ ${label}`); pass++; }
function bad(label, detail) { console.error(`✗ ${label}`); if (detail) console.error('  ', detail); fail++; }

async function generateToken({ email, userId, scopes = [] }) {
  const payload = {
    email, userId, scopes, gravatarHash: 'aaaa',
    exp: Date.now() + 3600_000, iat: Date.now(),
    iss: 'auth.ljs.app',
  };
  const data = JSON.stringify(payload);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  const sigHex = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  return btoa(JSON.stringify({ data, sig: sigHex }));
}

async function signIn(email, userId, scopes = []) {
  const token = await generateToken({ email, userId, scopes });
  const url = `${BASE}/api/auth/callback?next=/me&token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { redirect: 'manual' });
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error(`sign-in failed for ${email}: ${res.status}`);
  return cookie;
}

async function api(cookie, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

// ── Setup ────────────────────────────────────────────────────────────────
console.log('\n── Auth setup ──');
const adminCookie = await signIn('admin@test', 'usr_admin', ['admin']);
const hostCookie = await signIn('jacob@test', 'usr_jacob', []);
const hostBCookie = await signIn('eric@test', 'usr_eric', []);
const memberACookie = await signIn('alice@test', 'usr_alice', []);
const memberBCookie = await signIn('bob@test', 'usr_bob', []);
ok('all five users signed in');

// ── 1. App Admin creates a slate ─────────────────────────────────────────
console.log('\n── 1. Slate creation ──');
let r = await api(adminCookie, 'POST', '/api/slates', {
  name: 'Abolitionist Rising',
  slug: 'ar',
  timezone: 'America/Chicago',
  description: 'Bi-weekly volunteer-run podcast.',
});
r.body?.slate?.id ? ok('admin created slate') : bad('admin slate create', r);
const slateId = r.body.slate.id;

r = await api(hostCookie, 'POST', '/api/slates', { name: 'Should Fail', slug: 'fail' });
r.status === 403 ? ok('non-admin slate create rejected (403)') : bad('non-admin should be 403', r);

// ── 2. App Admin promotes Jacob + Eric to Hosts ──────────────────────
console.log('\n── 2. Host promotions ──');
r = await api(adminCookie, 'POST', `/api/slates/${slateId}/hosts`, { user_id: 'usr_jacob' });
r.status < 300 ? ok('jacob promoted to host') : bad('promote jacob', r);
r = await api(adminCookie, 'POST', `/api/slates/${slateId}/hosts`, { user_id: 'usr_eric' });
r.status < 300 ? ok('eric promoted to host') : bad('promote eric', r);

r = await api(hostCookie, 'POST', `/api/slates/${slateId}/hosts`, { user_id: 'usr_alice' });
r.status === 403 ? ok('host cannot promote (only admin can)') : bad('host promote should 403', r);

// ── 3. Slot rule + regenerate ────────────────────────────────────────────
console.log('\n── 3. Scheduling rules ──');
r = await api(hostCookie, 'POST', `/api/slates/${slateId}/admin/rules`, {
  name: 'Bi-weekly Monday',
  cadence: 'weekly',
  days_of_week: 'mon',
  time_of_day: '19:00',
  duration_minutes: 60,
  start_date: '2026-05-04',
  end_date: '2027-05-03',
});
r.body?.rule?.id ? ok('rule created') : bad('rule create', r);

r = await api(hostCookie, 'POST', `/api/slates/${slateId}/admin/regenerate-slots`, {});
(r.body?.inserted >= 50) ? ok(`generated ${r.body.inserted} slots`) : bad('regenerate', r);

// ── 4. Member signup (open) ──────────────────────────────────────────────
console.log('\n── 4. Member signup ──');
r = await api(memberACookie, 'POST', `/api/slates/${slateId}/join`, {});
(r.body?.role === 'member') ? ok('alice joined as member') : bad('alice join', r);
r = await api(memberBCookie, 'POST', `/api/slates/${slateId}/join`, {});
(r.body?.role === 'member') ? ok('bob joined as member') : bad('bob join', r);

// Re-join is idempotent
r = await api(memberACookie, 'POST', `/api/slates/${slateId}/join`, {});
(r.body?.already_member) ? ok('re-join is idempotent') : bad('re-join', r);

// ── 5. Topic submission ────────────────────────────────────────────
console.log('\n── 5. Topics ──');
r = await api(memberACookie, 'POST', `/api/slates/${slateId}/topics`, {
  title: 'Frederick Douglass on organizing',
  description: 'Primary source from his autobiography.',
  url: 'https://www.gutenberg.org/files/23/23-h/23-h.htm',
  tags: 'history,primary-source',
});
r.body?.topic?.id ? ok('alice posted topic') : bad('alice suggest', r);
const sug1 = r.body.topic.id;

// ── 6. Duplicate detection ──────────────────────────────────────────────
console.log('\n── 6. Duplicate detection ──');
r = await api(memberBCookie, 'POST', `/api/slates/${slateId}/topics`, {
  title: 'frederick douglass on organizing!!',
  description: 'Different person but same topic',
});
(r.status === 409 && r.body?.duplicate?.id === sug1)
  ? ok('case+punctuation duplicate detected → 409 with matching id')
  : bad('dup detection', r);

// Force-submit anyway
r = await api(memberBCookie, 'POST', `/api/slates/${slateId}/topics?force=1`, {
  title: 'frederick douglass on organizing!!',
});
r.body?.topic?.id ? ok('force=1 submits the duplicate') : bad('force submit', r);

// ── 7. Upvotes ──────────────────────────────────────────────────────────
console.log('\n── 7. Upvotes ──');
r = await api(memberBCookie, 'POST', `/api/topics/${sug1}/vote`, {});
(r.body?.has_voted && r.body.upvote_count === 1) ? ok('bob upvoted (count=1)') : bad('bob upvote', r);
r = await api(memberACookie, 'POST', `/api/topics/${sug1}/vote`, {});
(r.body?.has_voted && r.body.upvote_count === 2) ? ok('alice upvoted (count=2)') : bad('alice upvote', r);
r = await api(memberACookie, 'POST', `/api/topics/${sug1}/vote`, {});
(!r.body?.has_voted && r.body.upvote_count === 1) ? ok('alice toggled off (count=1)') : bad('alice toggle', r);

// ── 8. Host claims a slot ────────────────────────────────────────────
console.log('\n── 8. Slot claim + topic ──');
r = await api(hostCookie, 'GET', `/api/slates/${slateId}/admin/rules`);
// Get an open slot id
const slotsCheck = await fetch(`${BASE}/${'ar'}`, { headers: { cookie: hostCookie } });
// Just query D1 indirectly via a dedicated read — use the topics endpoint as proxy or re-call internal
// Easier: call a SELECT on slots via a generic read endpoint we don't have. Use the export.csv.
const csvRes = await fetch(`${BASE}/api/slates/${slateId}/admin/export.csv`, { headers: { cookie: hostCookie } });
const csvText = await csvRes.text();
const firstSlotLine = csvText.split('\n').find(l => l.includes(',open,'));
const slotId = firstSlotLine?.split(',')[0];
slotId ? ok(`picked first open slot: ${slotId}`) : bad('pick slot', csvText.slice(0, 200));

// Jacob claims it
r = await api(hostCookie, 'POST', `/api/slots/${slotId}/assign-host`, {});
(r.body?.host_id === 'usr_jacob' && r.body.status === 'assigned')
  ? ok('jacob claimed slot (status=assigned)')
  : bad('claim slot', r);

// Marry topic to slot
r = await api(hostCookie, 'POST', `/api/slots/${slotId}/topic`, { topic_id: sug1 });
(r.body?.status === 'confirmed') ? ok('topic married → confirmed') : bad('topic', r);

// ── 9. Boot another host ─────────────────────────────────────────────
console.log('\n── 9. Host boot ──');
r = await api(hostBCookie, 'POST', `/api/slots/${slotId}/assign-host`, {});
(r.body?.host_id === 'usr_eric') ? ok('eric booted jacob from the slot') : bad('boot', r);

// Member tries to claim → 403
r = await api(memberACookie, 'POST', `/api/slots/${slotId}/assign-host`, {});
(r.status === 403) ? ok('member cannot claim a slot (403)') : bad('member claim should 403', r);

// ── 10. Slug change + 404 of old URL ────────────────────────────────────
console.log('\n── 10. Slug rename ──');
r = await api(hostCookie, 'PATCH', `/api/slates/${slateId}`, { slug: 'ar-private-x9k2' });
(r.status < 300) ? ok('slug renamed') : bad('slug rename', r);

const oldUrlRes = await fetch(`${BASE}/ar`);
oldUrlRes.status === 404 ? ok('old slug /ar now 404s') : bad('old slug should 404', oldUrlRes.status);
const newUrlRes = await fetch(`${BASE}/ar-private-x9k2`);
newUrlRes.status === 200 ? ok('new slug /ar-private-x9k2 → 200') : bad('new slug fetch', newUrlRes.status);

// Reset slug for any further tests
await api(hostCookie, 'PATCH', `/api/slates/${slateId}`, { slug: 'ar' });

// ── 11. Show notes ─────────────────────────────────────────────────────
console.log('\n── 11. Show notes ──');
r = await api(hostBCookie, 'PATCH', `/api/slots/${slotId}/show-notes`, {
  show_notes: '# UNIQUE_TOKEN_v2_test\n\nEpisode notes here.',
});
(r.status < 300) ? ok('eric (slot host) wrote show notes') : bad('write notes', r);

// Public hidden when draft
let publicHtml = await fetch(`${BASE}/ar/slot/${slotId}`).then(r => r.text());
!publicHtml.includes('UNIQUE_TOKEN_v2_test') ? ok('draft notes hidden publicly') : bad('draft leak');

// Publish
r = await api(hostCookie, 'POST', `/api/admin/slots/${slotId}/publish-notes`, {});
(r.status < 300) ? ok('notes published') : bad('publish', r);

publicHtml = await fetch(`${BASE}/ar/slot/${slotId}`).then(r => r.text());
publicHtml.includes('UNIQUE_TOKEN_v2_test') ? ok('published notes visible publicly') : bad('public render');

// ── Summary ────────────────────────────────────────────────────────────
console.log(`\n══ ${pass} pass / ${fail} fail ══`);
process.exit(fail === 0 ? 0 : 1);

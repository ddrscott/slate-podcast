// Quick smoke test for the recurrence engine.
// Run with: node scripts/test-recurrence.mjs

import { expandRule, zonedDateTimeToUnix } from '../src/lib/recurrence.ts';

let failed = 0;
function eq(actual, expected, label) {
  if (actual === expected) {
    console.log(`✓ ${label}`);
  } else {
    console.error(`✗ ${label}\n  expected: ${expected}\n    actual: ${actual}`);
    failed++;
  }
}

// ── DST sanity: 2026-06-01 07:00 America/Chicago = 2026-06-01 12:00 UTC (CDT, UTC-5)
const cdt = zonedDateTimeToUnix(2026, 6, 1, 7, 0, 'America/Chicago');
eq(new Date(cdt * 1000).toISOString(), '2026-06-01T12:00:00.000Z', 'CDT 07:00 → 12:00 UTC');

// ── 2026-01-15 07:00 America/Chicago = 2026-01-15 13:00 UTC (CST, UTC-6)
const cst = zonedDateTimeToUnix(2026, 1, 15, 7, 0, 'America/Chicago');
eq(new Date(cst * 1000).toISOString(), '2026-01-15T13:00:00.000Z', 'CST 07:00 → 13:00 UTC');

// ── DST boundary: 2026-03-07 vs 2026-03-09 (US DST starts Mar 8 2026 at 02:00)
const before = zonedDateTimeToUnix(2026, 3, 7, 7, 0, 'America/Chicago');
const after = zonedDateTimeToUnix(2026, 3, 9, 7, 0, 'America/Chicago');
eq(new Date(before * 1000).toISOString(), '2026-03-07T13:00:00.000Z', 'pre-DST 07:00 → 13:00 UTC');
eq(new Date(after * 1000).toISOString(), '2026-03-09T12:00:00.000Z', 'post-DST 07:00 → 12:00 UTC');

// ── Weekly rule: weekday mornings, June 2026 (22 weekdays)
const weekdayRule = {
  id: 'r_test',
  cadence: 'weekly',
  days_of_week: 'mon,tue,wed,thu,fri',
  nth_weekday: null,
  time_of_day: '07:00',
  duration_minutes: 30,
  start_date: '2026-06-01',
  end_date: '2026-06-30',
  active: 1,
};
const juneSlots = expandRule(weekdayRule, 'America/Chicago', '2027-06-01');
eq(juneSlots.length, 22, 'June 2026 weekday count');
eq(new Date(juneSlots[0].start_time * 1000).toISOString(), '2026-06-01T12:00:00.000Z', 'first June slot is Mon Jun 1 12:00 UTC');

// ── Weekly rule that spans DST (March 1 - March 15, 2026)
const dstRule = { ...weekdayRule, days_of_week: 'mon,tue,wed,thu,fri,sat,sun', start_date: '2026-03-01', end_date: '2026-03-15' };
const dstSlots = expandRule(dstRule, 'America/Chicago', '2027-06-01');
eq(dstSlots.length, 15, 'Mar 1-15 daily count');
eq(new Date(dstSlots[6].start_time * 1000).toISOString(), '2026-03-07T13:00:00.000Z', 'Mar 7 (CST) at 13:00 UTC');
eq(new Date(dstSlots[8].start_time * 1000).toISOString(), '2026-03-09T12:00:00.000Z', 'Mar 9 (CDT) at 12:00 UTC');

// ── Monthly nth-weekday: first Monday of each month, Jan-Jun 2026
const monthlyRule = {
  id: 'r_monthly',
  cadence: 'monthly',
  days_of_week: null,
  nth_weekday: '1mon',
  time_of_day: '18:00',
  duration_minutes: 60,
  start_date: '2026-01-01',
  end_date: '2026-06-30',
  active: 1,
};
const monthlySlots = expandRule(monthlyRule, 'America/Chicago', '2027-06-01');
eq(monthlySlots.length, 6, 'Six first-Mondays Jan-Jun 2026');
// First Monday of January 2026 is Jan 5
eq(new Date(monthlySlots[0].start_time * 1000).toISOString().slice(0, 10), '2026-01-06', 'Jan 2026 first Monday is the 5th locally → Jan 6 UTC at 00:00');
// More precise: 18:00 Chicago Jan 5 = 00:00 UTC Jan 6 (CST UTC-6)
eq(new Date(monthlySlots[0].start_time * 1000).toISOString(), '2026-01-06T00:00:00.000Z', 'Jan 2026 first-Mon 18:00 CST = Jan 6 00:00 UTC');

// ── Last Friday rule
const lastFri = { ...monthlyRule, nth_weekday: '-1fri', start_date: '2026-06-01', end_date: '2026-06-30' };
const lastFriSlots = expandRule(lastFri, 'America/Chicago', '2027-06-01');
eq(lastFriSlots.length, 1, 'One last-Friday in June 2026');
// Last Friday of June 2026 is June 26
eq(new Date(lastFriSlots[0].start_time * 1000).toISOString().slice(0, 10), '2026-06-26', 'last Fri Jun 2026 = Jun 26 (UTC date)');

console.log(failed === 0 ? '\n✓ all recurrence tests passed' : `\n✗ ${failed} test(s) failed`);
process.exit(failed === 0 ? 0 : 1);

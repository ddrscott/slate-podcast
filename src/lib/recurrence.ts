// Tz-aware expansion of slot_rules → concrete UTC slot start times.
// No external date deps; uses Intl.DateTimeFormat for DST correctness.

export type Cadence = 'weekly' | 'monthly';

export interface SlotRule {
  id: string;
  cadence: Cadence;
  days_of_week: string | null;   // weekly: 'mon,tue,wed,thu,fri'
  nth_weekday: string | null;    // monthly: '1mon' | '-1fri'
  time_of_day: string;           // 'HH:MM'
  duration_minutes: number;
  start_date: string;            // 'YYYY-MM-DD'
  end_date: string | null;
  active: number;                // 0 | 1
}

export interface ExpandedSlot {
  start_time: number;            // unix seconds, UTC
  duration_minutes: number;
  rule_id: string;
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export function expandRule(
  rule: SlotRule,
  showTimezone: string,
  windowEnd: string,                     // 'YYYY-MM-DD' inclusive — caller-supplied horizon
): ExpandedSlot[] {
  if (!rule.active) return [];

  const start = parseDate(rule.start_date);
  const end = parseDate(rule.end_date ?? windowEnd);
  const horizon = parseDate(windowEnd);
  const stop = cmpDate(end, horizon) < 0 ? end : horizon;
  if (cmpDate(start, stop) > 0) return [];

  const [hh, mm] = parseHHMM(rule.time_of_day);

  if (rule.cadence === 'weekly') {
    return expandWeekly(rule, start, stop, hh, mm, showTimezone);
  }
  return expandMonthly(rule, start, stop, hh, mm, showTimezone);
}

function expandWeekly(
  rule: SlotRule,
  start: { y: number; m: number; d: number },
  stop: { y: number; m: number; d: number },
  hh: number, mm: number,
  tz: string,
): ExpandedSlot[] {
  const targetWds = parseDaysOfWeek(rule.days_of_week);
  if (targetWds.size === 0) return [];

  const out: ExpandedSlot[] = [];
  let cursor = utcDate(start);
  const stopMs = utcDate(stop).getTime();

  while (cursor.getTime() <= stopMs) {
    if (targetWds.has(cursor.getUTCDay())) {
      out.push({
        start_time: zonedDateTimeToUnix(
          cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate(),
          hh, mm, tz,
        ),
        duration_minutes: rule.duration_minutes,
        rule_id: rule.id,
      });
    }
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return out;
}

function expandMonthly(
  rule: SlotRule,
  start: { y: number; m: number; d: number },
  stop: { y: number; m: number; d: number },
  hh: number, mm: number,
  tz: string,
): ExpandedSlot[] {
  const parsed = parseNthWeekday(rule.nth_weekday);
  if (!parsed) return [];

  const out: ExpandedSlot[] = [];
  let y = start.y, m = start.m;

  while (y < stop.y || (y === stop.y && m <= stop.m)) {
    const date = nthWeekdayOfMonth(y, m, parsed.n, parsed.wd);
    if (date) {
      const inRange =
        (date.y > start.y || (date.y === start.y && (date.m > start.m || (date.m === start.m && date.d >= start.d)))) &&
        (date.y < stop.y || (date.y === stop.y && (date.m < stop.m || (date.m === stop.m && date.d <= stop.d))));
      if (inRange) {
        out.push({
          start_time: zonedDateTimeToUnix(date.y, date.m, date.d, hh, mm, tz),
          duration_minutes: rule.duration_minutes,
          rule_id: rule.id,
        });
      }
    }
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

// ─── tz conversion (DST-safe) ──────────────────────────────────────────────

export function zonedDateTimeToUnix(
  year: number, month: number, day: number, // 1-indexed
  hour: number, minute: number,
  tz: string,
): number {
  const naiveMs = Date.UTC(year, month - 1, day, hour, minute, 0);

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = fmt.formatToParts(new Date(naiveMs));
  const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value ?? '0', 10);

  const ty = get('year'), tm = get('month'), td = get('day');
  let thHour = get('hour'); if (thHour === 24) thHour = 0;
  const tmin = get('minute'), tsec = get('second');

  const tzAtNaiveMs = Date.UTC(ty, tm - 1, td, thHour, tmin, tsec);
  const offsetMs = naiveMs - tzAtNaiveMs;
  return Math.floor((naiveMs + offsetMs) / 1000);
}

// ─── parsing helpers ───────────────────────────────────────────────────────

function parseDate(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

function cmpDate(a: { y: number; m: number; d: number }, b: { y: number; m: number; d: number }): number {
  if (a.y !== b.y) return a.y - b.y;
  if (a.m !== b.m) return a.m - b.m;
  return a.d - b.d;
}

function utcDate({ y, m, d }: { y: number; m: number; d: number }): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

function parseHHMM(s: string): [number, number] {
  const [h, m] = s.split(':').map(Number);
  return [h, m];
}

export function parseDaysOfWeek(s: string | null): Set<number> {
  const out = new Set<number>();
  if (!s) return out;
  for (const tok of s.split(',').map(t => t.trim().toLowerCase())) {
    const idx = WEEKDAYS.indexOf(tok as typeof WEEKDAYS[number]);
    if (idx >= 0) out.add(idx);
  }
  return out;
}

export function parseNthWeekday(s: string | null): { n: number; wd: number } | null {
  if (!s) return null;
  const m = /^(-?\d+)(sun|mon|tue|wed|thu|fri|sat)$/i.exec(s.trim());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const wd = WEEKDAYS.indexOf(m[2].toLowerCase() as typeof WEEKDAYS[number]);
  if (n === 0 || n > 5 || n < -5 || wd < 0) return null;
  return { n, wd };
}

function nthWeekdayOfMonth(
  year: number, month: number, n: number, weekday: number,
): { y: number; m: number; d: number } | null {
  if (n > 0) {
    const firstWd = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const diff = (weekday - firstWd + 7) % 7;
    const day = 1 + diff + (n - 1) * 7;
    const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (day > lastDayOfMonth) return null;
    return { y: year, m: month, d: day };
  } else {
    const last = new Date(Date.UTC(year, month, 0));
    const lastDay = last.getUTCDate();
    const lastWd = last.getUTCDay();
    const diff = (lastWd - weekday + 7) % 7;
    const day = lastDay - diff + (n + 1) * 7;
    if (day < 1) return null;
    return { y: year, m: month, d: day };
  }
}

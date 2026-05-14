import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireHostOnSlate, requireUser } from '@/lib/access';
import { isAppAdmin } from '@/lib/auth';
import { Enqueue } from '@/lib/activity';

export const prerender = false;

// Bulk-assign open slots to a show by recurrence pattern. Lets a slate
// admin (or the show's host) claim, e.g., "every other Tuesday at 7pm
// Central from now through August" for a show in one operation —
// instead of clicking through individual slot pages.
//
// Body:
//   from_date         "YYYY-MM-DD" inclusive, in the slate's timezone
//   to_date           "YYYY-MM-DD" inclusive
//   days_of_week      array of weekday strings, e.g. ["tue","thu"]
//                     (lowercase 3-letter; "sun" through "sat")
//   every_n_weeks     1 = every week, 2 = bi-weekly, etc.
//                     (an integer; alignment is anchored on from_date's week)
//   at_time           optional "HH:MM" 24-hour. When present, restricts
//                     matches to slots whose local time equals this
//                     value when projected into at_timezone (or the
//                     slate's timezone, when at_timezone is omitted).
//   at_timezone       optional IANA timezone. Pairs with at_time.
//                     Defaults to the slate's timezone.
//   include_assigned  optional bool; default false. When true also picks
//                     up slots in status='assigned' (claimed by a host
//                     but no topic yet). Always skips confirmed /
//                     recorded / published / cancelled.
//   dry_run           optional bool; default false. When true returns
//                     the matched slots without mutating.
//
// Auth: the show's host, slate admin, or App Admin. (Slate admin is the
// intended audience — they arbitrate for busy hosts.)

const DAYS = ['sun','mon','tue','wed','thu','fri','sat'] as const;
type Day = typeof DAYS[number];

interface Body {
  from_date?: string;
  to_date?: string;
  days_of_week?: string[];
  every_n_weeks?: number;
  at_time?: string;
  at_timezone?: string;
  include_assigned?: boolean;
  dry_run?: boolean;
}

function parseYmd(s: unknown): { y: number; m: number; d: number } {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new HttpError(400, 'invalid_date');
  }
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

// Return the day-of-week ("sun" through "sat") that a UTC timestamp
// falls on when projected into a given IANA timezone.
function weekdayInTz(epochSec: number, timezone: string): Day {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
  // Output is "Mon", "Tue", etc.
  const name = fmt.format(new Date(epochSec * 1000)).toLowerCase();
  return name as Day;
}

// Return the ISO date "YYYY-MM-DD" for an epoch in the slate's timezone.
// Used to compute days-since-anchor for the every-N-weeks alignment.
function ymdInTz(epochSec: number, timezone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date(epochSec * 1000));
}

// Return the local "HH:MM" of an epoch when projected into a timezone.
function hhmmInTz(epochSec: number, timezone: string): string {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
  });
  // Intl on Node returns "HH:mm"; one quirk: midnight can be "24:00",
  // which we normalize so equality compares match the input format.
  return fmt.format(new Date(epochSec * 1000)).replace(/^24:/, '00:');
}

function daysBetween(aYmd: string, bYmd: string): number {
  // Both are ISO "YYYY-MM-DD" already projected into the slate's tz, so
  // ms diff at midnight UTC is fine for whole-day arithmetic.
  return Math.round((Date.parse(bYmd) - Date.parse(aYmd)) / 86_400_000);
}

// Validate that a string is a recognizable IANA timezone. We try the
// constructor — invalid zones throw RangeError.
function isValidTimezone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
  catch { return false; }
}

export const POST: APIRoute = async (ctx) => {
  try {
    const caller = requireUser(ctx);
    const slateId = ctx.params.id!;
    const showId = ctx.params.show_id!;
    await requireHostOnSlate(ctx, slateId);

    const db = getDb(ctx);
    const show = await db.prepare(
      `SELECT id, slate_id, host_id, name FROM shows WHERE id = ? AND slate_id = ?`,
    ).bind(showId, slateId).first<{ id: string; slate_id: string; host_id: string | null; name: string }>();
    if (!show) throw new HttpError(404, 'show_not_found');

    // Only the show's host, a slate admin, or App Admin can bulk-assign.
    const isAdmin = isAppAdmin(caller.scopes);
    if (show.host_id !== caller.id && !isAdmin) {
      const adminRow = await db.prepare(
        `SELECT 1 FROM slate_members WHERE slate_id = ? AND user_id = ? AND is_admin = 1`,
      ).bind(slateId, caller.id).first();
      if (!adminRow) throw new HttpError(403, 'not_show_host');
    }

    const slate = await db.prepare(
      `SELECT timezone FROM slates WHERE id = ?`,
    ).bind(slateId).first<{ timezone: string }>();
    if (!slate) throw new HttpError(404, 'slate_not_found');

    const body = await ctx.request.json() as Body;
    const from = parseYmd(body.from_date);
    const to   = parseYmd(body.to_date);
    const fromYmd = `${from.y}-${String(from.m).padStart(2,'0')}-${String(from.d).padStart(2,'0')}`;
    const toYmd   = `${to.y}-${String(to.m).padStart(2,'0')}-${String(to.d).padStart(2,'0')}`;

    if (Date.parse(fromYmd) > Date.parse(toYmd)) {
      throw new HttpError(400, 'from_after_to');
    }

    const days = new Set<Day>();
    for (const d of body.days_of_week ?? []) {
      if (typeof d !== 'string' || !(DAYS as readonly string[]).includes(d.toLowerCase())) {
        throw new HttpError(400, 'invalid_days_of_week');
      }
      days.add(d.toLowerCase() as Day);
    }
    if (days.size === 0) throw new HttpError(400, 'days_of_week_required');

    const every = Number.isInteger(body.every_n_weeks) ? body.every_n_weeks! : 1;
    if (every < 1 || every > 12) throw new HttpError(400, 'invalid_every_n_weeks');

    // Optional time-of-day filter. Defaults: no time filter (match any
    // time on the chosen days), slate timezone for projection.
    let targetTime: string | null = null;
    let timeTz = slate.timezone;
    if (body.at_time !== undefined && body.at_time !== null && body.at_time !== '') {
      if (typeof body.at_time !== 'string' || !/^\d{2}:\d{2}$/.test(body.at_time)) {
        throw new HttpError(400, 'invalid_at_time');
      }
      targetTime = body.at_time;
      if (body.at_timezone && typeof body.at_timezone === 'string') {
        if (!isValidTimezone(body.at_timezone)) {
          throw new HttpError(400, 'invalid_at_timezone');
        }
        timeTz = body.at_timezone;
      }
    }

    const includeAssigned = body.include_assigned === true;
    const dryRun = body.dry_run === true;

    // Pull candidates in [from-1day, to+1day] (1-day buffer for tz edges).
    const fromSec = Math.floor(Date.parse(fromYmd) / 1000) - 86400;
    const toSec   = Math.floor(Date.parse(toYmd)   / 1000) + 2 * 86400;
    const eligibleStatuses = includeAssigned ? ['open', 'assigned'] : ['open'];

    const candidates = await db.prepare(
      `SELECT id, start_time, status, show_id FROM slots
       WHERE slate_id = ?
         AND start_time >= ? AND start_time < ?
         AND status IN (${eligibleStatuses.map(() => '?').join(',')})
       ORDER BY start_time`,
    ).bind(slateId, fromSec, toSec, ...eligibleStatuses).all<{
      id: string; start_time: number; status: string; show_id: string | null;
    }>();

    // Filter: in [from, to] in slate timezone, day-of-week match, every-N
    // alignment, time-of-day match (when supplied), and not already owned
    // by a different show.
    const matched: Array<{
      id: string; start_time: number; status: string;
      already_this_show: boolean;
    }> = [];

    for (const s of candidates.results) {
      const ymd = ymdInTz(s.start_time, slate.timezone);
      if (ymd < fromYmd || ymd > toYmd) continue;
      const dow = weekdayInTz(s.start_time, slate.timezone);
      if (!days.has(dow)) continue;
      if (every > 1) {
        const offset = daysBetween(fromYmd, ymd);
        const wks = Math.floor(offset / 7);
        if (wks % every !== 0) continue;
      }
      if (targetTime) {
        const hhmm = hhmmInTz(s.start_time, timeTz);
        if (hhmm !== targetTime) continue;
      }
      if (s.show_id && s.show_id !== showId) {
        // Already owned by another show — never overwrite silently.
        continue;
      }
      matched.push({
        id: s.id,
        start_time: s.start_time,
        status: s.status,
        already_this_show: s.show_id === showId,
      });
    }

    if (dryRun) {
      return jsonOk({
        dry_run: true,
        matched_count: matched.length,
        matched: matched.slice(0, 200), // cap the preview payload
      });
    }

    // Apply: UPDATE show_id for the matched slots that aren't already
    // pointing at this show. Chunked to stay well under D1's per-statement
    // parameter limit (~100). 50 IDs per batch + the show_id binding = 51
    // parameters; safe by a healthy margin.
    const toAssign = matched.filter(m => !m.already_this_show);
    const CHUNK = 50;
    for (let i = 0; i < toAssign.length; i += CHUNK) {
      const batch = toAssign.slice(i, i + CHUNK);
      const placeholders = batch.map(() => '?').join(',');
      await db.prepare(
        `UPDATE slots SET show_id = ? WHERE id IN (${placeholders})`,
      ).bind(showId, ...batch.map(m => m.id)).run();
    }

    if (toAssign.length > 0) {
      await Enqueue.showSlotsAssigned(ctx, {
        slateId, actorId: caller.id, showId, showName: show.name,
        count: toAssign.length,
      });
    }

    return jsonOk({
      dry_run: false,
      assigned_count: toAssign.length,
      matched_count: matched.length,
      already_count: matched.length - toAssign.length,
    });
  } catch (err) {
    // Surface the actual error to the worker logs so wrangler tail
    // shows the cause when the API returns 500.
    if (!(err instanceof HttpError)) {
      console.error('[assign-slots] unhandled', err);
    }
    return jsonError(err);
  }
};

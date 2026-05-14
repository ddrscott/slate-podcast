import { useState, useCallback } from 'react';

// Form + preview + apply for bulk-assigning slots to a show by
// recurrence pattern. Two-step: Preview → Apply. The preview shows
// matched slots before mutating anything, so an admin can sanity-check
// before claiming a block of dates.

interface Props {
  slateId: string;
  slateSlug: string;
  slateTimezone: string;
  showId: string;
  showName: string;
  showSlug: string;
  defaultFrom: string;
  defaultTo: string;
}

const DAYS = [
  { key: 'sun', label: 'Sun' },
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
] as const;

// Same list the slate-settings page uses; consistent across the app.
const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu',
  'UTC',
  'Europe/London', 'Europe/Berlin', 'Australia/Sydney',
] as const;

interface MatchedSlot {
  id: string;
  start_time: number;
  status: string;
  already_this_show: boolean;
}

interface PreviewResult {
  matched_count: number;
  matched: MatchedSlot[];
}

export default function SlotAssigner({
  slateId, slateSlug, slateTimezone, showId, showName, showSlug,
  defaultFrom, defaultTo,
}: Props) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [days, setDays] = useState<Set<string>>(new Set());
  const [every, setEvery] = useState(1);
  const [atTime, setAtTime] = useState('');           // "" = any time on the chosen days
  const [atTimezone, setAtTimezone] = useState(slateTimezone);
  const [includeAssigned, setIncludeAssigned] = useState(false);

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState('');

  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<{ assigned: number; already: number } | null>(null);

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: slateTimezone, weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });

  function toggleDay(d: string) {
    const next = new Set(days);
    if (next.has(d)) next.delete(d); else next.add(d);
    setDays(next);
    // Invalidate preview when params change.
    setPreview(null);
    setApplied(null);
  }

  function buildBody(dryRun: boolean) {
    return {
      from_date: from,
      to_date: to,
      days_of_week: [...days],
      every_n_weeks: every,
      // Only send time params when the user actually entered a time —
      // empty string means "any time on the chosen days", which the
      // server reads as the absence of the field.
      ...(atTime ? { at_time: atTime, at_timezone: atTimezone } : {}),
      include_assigned: includeAssigned,
      dry_run: dryRun,
    };
  }

  const runPreview = useCallback(async () => {
    setPreviewing(true); setError(''); setApplied(null);
    const res = await fetch(`/api/slates/${slateId}/shows/${showId}/assign-slots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildBody(true)),
    });
    setPreviewing(false);
    if (res.ok) {
      const body = await res.json() as PreviewResult & { ok: boolean };
      setPreview({ matched_count: body.matched_count, matched: body.matched });
    } else {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setError(err.error ?? `Preview failed (${res.status})`);
    }
  }, [slateId, showId, from, to, days, every, atTime, atTimezone, includeAssigned]);

  const apply = useCallback(async () => {
    if (!preview) return;
    const toAssign = preview.matched.filter(m => !m.already_this_show).length;
    if (toAssign === 0) {
      setError('Nothing to assign — every matched slot is already this show.');
      return;
    }
    if (!confirm(`Assign ${toAssign} slot${toAssign === 1 ? '' : 's'} to "${showName}"?`)) return;
    setApplying(true); setError('');
    const res = await fetch(`/api/slates/${slateId}/shows/${showId}/assign-slots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildBody(false)),
    });
    setApplying(false);
    if (res.ok) {
      const body = await res.json() as { assigned_count: number; already_count: number; matched_count: number };
      setApplied({ assigned: body.assigned_count, already: body.already_count });
      setPreview(null);
    } else {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setError(err.error ?? `Apply failed (${res.status})`);
    }
  }, [preview, slateId, showId, showName, from, to, days, every, atTime, atTimezone, includeAssigned]);

  const formInvalid = days.size === 0 || !from || !to || from > to;

  return (
    <div className="space-y-6">
      <div className="card border border-base-300 bg-base-100">
        <div className="card-body py-5 space-y-4">
          <div className="grid md:grid-cols-2 gap-3">
            <label className="form-control block">
              <span className="label-text text-sm">From</span>
              <input type="date" value={from}
                     onChange={(e) => { setFrom(e.target.value); setPreview(null); setApplied(null); }}
                     className="input input-bordered w-full" />
            </label>
            <label className="form-control block">
              <span className="label-text text-sm">Through</span>
              <input type="date" value={to}
                     onChange={(e) => { setTo(e.target.value); setPreview(null); setApplied(null); }}
                     className="input input-bordered w-full" />
            </label>
          </div>

          <div>
            <span className="label-text text-sm">Days of week</span>
            <div className="flex flex-wrap gap-2 mt-1">
              {DAYS.map(d => {
                const on = days.has(d.key);
                return (
                  <button key={d.key} type="button" onClick={() => toggleDay(d.key)}
                          className={`btn btn-sm font-mono ${on ? 'btn-primary' : 'btn-ghost border border-base-300'}`}>
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <label className="form-control block">
              <span className="label-text text-sm">Repeat every</span>
              <select value={every}
                      onChange={(e) => { setEvery(Number(e.target.value)); setPreview(null); setApplied(null); }}
                      className="select select-bordered w-full">
                <option value={1}>Every week</option>
                <option value={2}>Every 2 weeks (bi-weekly)</option>
                <option value={3}>Every 3 weeks</option>
                <option value={4}>Every 4 weeks (~monthly)</option>
              </select>
              <span className="text-xs opacity-60 mt-1 block">
                Alignment is anchored on the "From" date's week.
              </span>
            </label>
            <label className="form-control block">
              <span className="label-text text-sm">Slots to consider</span>
              <div className="flex items-center gap-2 mt-3">
                <input type="checkbox" checked={includeAssigned}
                       onChange={(e) => { setIncludeAssigned(e.target.checked); setPreview(null); setApplied(null); }}
                       className="checkbox" />
                <span className="text-sm">Also include slots already claimed by a host (no topic yet)</span>
              </div>
              <span className="text-xs opacity-60 mt-1 block">
                Confirmed / recorded / published / cancelled slots are never touched.
              </span>
            </label>
          </div>

          {/* Time-of-day filter — optional. Empty `atTime` = match any time
              on the chosen days, which is the previous behavior. Useful
              when a slate generates multiple slot times per day (7pm AND
              9pm Tuesdays) and you only want one of them for this show. */}
          <div className="grid md:grid-cols-[1fr_2fr] gap-3 pt-2 border-t border-base-300/50">
            <label className="form-control block">
              <span className="label-text text-sm">At time (optional)</span>
              <input type="time" value={atTime}
                     onChange={(e) => { setAtTime(e.target.value); setPreview(null); setApplied(null); }}
                     className="input input-bordered w-full font-mono" />
              <span className="text-xs opacity-60 mt-1 block">
                Leave blank to match all times on the chosen days.
              </span>
            </label>
            <label className={`form-control block ${atTime ? '' : 'opacity-50'}`}>
              <span className="label-text text-sm">Timezone for that time</span>
              <select value={atTimezone}
                      disabled={!atTime}
                      onChange={(e) => { setAtTimezone(e.target.value); setPreview(null); setApplied(null); }}
                      className="select select-bordered w-full font-mono">
                {!TIMEZONES.includes(atTimezone as any) && (
                  <option value={atTimezone}>{atTimezone}</option>
                )}
                {TIMEZONES.map(tz => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
              <span className="text-xs opacity-60 mt-1 block">
                Defaults to the slate's timezone ({slateTimezone}).
                Use a different zone when the show records on a different region's clock.
              </span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button type="button" onClick={runPreview}
                    disabled={previewing || formInvalid}
                    className="btn btn-primary">
              {previewing ? 'Looking…' : preview ? 'Refresh preview' : 'Preview match'}
            </button>
            {preview && (
              <button type="button" onClick={apply} disabled={applying}
                      className="btn btn-success">
                {applying
                  ? 'Applying…'
                  : `Assign ${preview.matched.filter(m => !m.already_this_show).length} slot(s)`}
              </button>
            )}
            {formInvalid && (
              <span className="text-xs opacity-60">
                Pick at least one day and a valid range to enable preview.
              </span>
            )}
          </div>

          {error && <p className="text-sm text-error">{error}</p>}
          {applied && (
            <div className="alert alert-success">
              <span>
                Assigned <strong>{applied.assigned}</strong> new slot{applied.assigned === 1 ? '' : 's'} to {showName}.
                {applied.already > 0 && ` (${applied.already} were already this show.)`}
                {' '}
                <a className="link" href={`/${slateSlug}/shows/${showSlug}`}>View the show →</a>
              </span>
            </div>
          )}
        </div>
      </div>

      {preview && (
        <div className="card border border-base-300 bg-base-100">
          <div className="card-body py-5">
            <h2 className="card-title text-base">
              Preview — {preview.matched_count} slot{preview.matched_count === 1 ? '' : 's'}
            </h2>
            {preview.matched_count === 0 ? (
              <p className="text-sm opacity-70">
                No open slots match. Either the slate hasn't generated slots for this date range
                yet (check <code className="font-mono">/edit/rules</code>) or the cadence /
                day filter excludes everything.
              </p>
            ) : (
              <ul className="text-sm divide-y divide-base-300/50">
                {preview.matched.map(m => (
                  <li key={m.id} className="py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-xs opacity-60 w-44 shrink-0 tabular-nums">
                      {fmt.format(new Date(m.start_time * 1000))}
                    </span>
                    <span className={`badge badge-sm ${m.status === 'open' ? 'badge-success' : 'badge-warning'}`}>
                      {m.status}
                    </span>
                    {m.already_this_show && (
                      <span className="text-xs opacity-60">already this show</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

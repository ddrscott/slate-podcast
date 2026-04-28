import { useMemo } from 'react';

export interface PublicSlot {
  id: string;
  start_time: number;        // unix seconds (UTC)
  duration_minutes: number;
  status: 'open' | 'assigned' | 'confirmed' | 'recorded' | 'published' | 'cancelled';
  theme?: string | null;
  title?: string | null;
}

interface Props {
  slots: PublicSlot[];
  timezone: string;
  slateSlug: string;
  // 'window' = current + next month, with a "view full schedule" link.
  // 'all' = every month spanning the slot data (default for the admin grid view).
  view?: 'window' | 'all';
}

const STATUS_COLORS: Record<PublicSlot['status'], string> = {
  open:      'bg-signal-100 text-signal-700 border-signal-200',
  assigned:  'bg-amber-100 text-amber-800 border-amber-200',
  confirmed: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  recorded:  'bg-sky-100 text-sky-800 border-sky-200',
  published: 'bg-violet-100 text-violet-800 border-violet-200',
  cancelled: 'bg-base-200 text-base-content/40 line-through border-base-300',
};

export default function ScheduleGrid({ slots, timezone, slateSlug, view = 'all' }: Props) {
  const fmt = useMemo(() => ({
    monthHeader: new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'long', year: 'numeric' }),
    day: new Intl.DateTimeFormat('en-US', { timeZone: timezone, day: 'numeric' }),
    yearMonth: new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit' }),
    iso: new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }),
    time: new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }),
    dow: new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }),
  }), [timezone]);

  // Group slots by ISO date in the show's timezone
  const slotsByDay = useMemo(() => {
    const map = new Map<string, PublicSlot[]>();
    for (const s of slots) {
      const d = fmt.iso.format(new Date(s.start_time * 1000));
      const arr = map.get(d) ?? [];
      arr.push(s);
      map.set(d, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.start_time - b.start_time);
    return map;
  }, [slots, fmt]);

  // "Today" in the slate's timezone (for the today-cell highlight).
  const todayIso = useMemo(() => fmt.iso.format(new Date()), [fmt]);

  // Determine month range:
  //  - 'window' (default for public schedule): current month + next month.
  //  - 'all': every month spanning the slot data, useful for full-year overview.
  const monthRange = useMemo(() => {
    if (view === 'window') {
      const now = parseISO(todayIso);
      const next = { y: now.y, m: now.m + 1 };
      if (next.m > 12) { next.m = 1; next.y++; }
      return [{ y: now.y, m: now.m }, next];
    }
    if (slots.length === 0) return [] as Array<{ y: number; m: number }>;
    const sorted = [...slots].sort((a, b) => a.start_time - b.start_time);
    const startD = parseISO(fmt.iso.format(new Date(sorted[0].start_time * 1000)));
    const endD = parseISO(fmt.iso.format(new Date(sorted[sorted.length - 1].start_time * 1000)));
    const out: Array<{ y: number; m: number }> = [];
    let y = startD.y, m = startD.m;
    while (y < endD.y || (y === endD.y && m <= endD.m)) {
      out.push({ y, m });
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  }, [slots, fmt, view, todayIso]);

  const { openCount, takenCount, totalCount } = useMemo(() => {
    let open = 0, taken = 0;
    for (const s of slots) {
      if (s.status === 'open') open++;
      else if (s.status !== 'cancelled') taken++;
    }
    return { openCount: open, takenCount: taken, totalCount: slots.length };
  }, [slots]);

  if (slots.length === 0) {
    return (
      <div className="card bg-base-200 border border-base-300">
        <div className="card-body">
          <p className="text-sm opacity-70">No slots have been generated yet. Check back soon.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline gap-3 mb-4 text-sm">
        <span className="font-mono text-signal">{openCount}</span>
        <span className="opacity-60">open</span>
        <span className="font-mono opacity-80">{takenCount}</span>
        <span className="opacity-60">taken</span>
        <span className="opacity-40">·</span>
        <span className="font-mono opacity-60">{totalCount}</span>
        <span className="opacity-60">total · {timezone}</span>
      </div>

      <div className={view === 'window' ? 'grid md:grid-cols-2 gap-6' : 'grid md:grid-cols-2 lg:grid-cols-3 gap-6'}>
        {monthRange.map(({ y, m }) => (
          <MonthCalendar
            key={`${y}-${m}`}
            year={y}
            month={m}
            todayIso={todayIso}
            slotsByDay={slotsByDay}
            slateSlug={slateSlug}
          />
        ))}
      </div>
    </div>
  );
}

function MonthCalendar({
  year, month, slotsByDay, slateSlug, todayIso,
}: {
  year: number;
  month: number;
  slotsByDay: Map<string, PublicSlot[]>;
  slateSlug: string;
  todayIso: string;
}) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(first);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstWd = first.getUTCDay(); // 0=Sun

  const cells: Array<{ day: number | null; iso?: string; slots?: PublicSlot[] }> = [];
  for (let i = 0; i < firstWd; i++) cells.push({ day: null });
  for (let d = 1; d <= lastDay; d++) {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ day: d, iso, slots: slotsByDay.get(iso) });
  }

  return (
    <div className="border border-base-300 rounded p-3 bg-base-100">
      <div className="font-semibold text-sm mb-2">{monthLabel}</div>
      <div className="grid grid-cols-7 gap-1 text-[10px] font-mono opacity-50 mb-1">
        {['S','M','T','W','T','F','S'].map((d, i) => <div key={i} className="text-center">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => (
          <DayCell key={i} cell={c} slateSlug={slateSlug} isToday={c.iso === todayIso} />
        ))}
      </div>
    </div>
  );
}

function DayCell({ cell, slateSlug, isToday }: {
  cell: { day: number | null; iso?: string; slots?: PublicSlot[] };
  slateSlug: string;
  isToday: boolean;
}) {
  if (cell.day === null) return <div />;
  const slots = cell.slots ?? [];
  // Today gets a ring outline regardless of whether there's a slot.
  const todayRing = isToday ? 'ring-2 ring-signal ring-offset-1 ring-offset-base-100' : '';

  if (slots.length === 0) {
    return (
      <div className={`aspect-square text-[11px] flex items-start justify-end p-1 font-mono rounded ${isToday ? 'opacity-90 bg-signal-50 ' + todayRing : 'opacity-30'}`}>
        <span className={isToday ? 'text-signal font-bold' : ''}>{cell.day}</span>
      </div>
    );
  }
  const dominant = pickDominant(slots);
  const cls = STATUS_COLORS[dominant];
  const target = slots.length === 1
    ? `/${slateSlug}/slot/${slots[0].id}`
    : `/${slateSlug}/day/${cell.iso}`;

  return (
    <a
      href={target}
      className={`aspect-square text-[11px] flex flex-col items-stretch p-1 border rounded font-mono ${cls} hover:ring-2 hover:ring-signal transition-all ${todayRing}`}
      title={slots.map(s => `${s.title ?? s.theme ?? '(open)'} — ${s.status}`).join('\n')}
    >
      <div className={`text-right ${isToday ? 'font-bold' : 'opacity-70'}`}>{cell.day}</div>
      {slots.length > 1 && <div className="mt-auto text-[9px]">×{slots.length}</div>}
    </a>
  );
}

function pickDominant(slots: PublicSlot[]): PublicSlot['status'] {
  // Priority: published > confirmed > recorded > assigned > open > cancelled
  const order: PublicSlot['status'][] = ['published','confirmed','recorded','assigned','open','cancelled'];
  for (const s of order) if (slots.some(x => x.status === s)) return s;
  return slots[0].status;
}

function parseISO(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

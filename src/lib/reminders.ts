import { now } from './db';
import { sendEmail } from './email';

interface DueRow {
  slot_id: string;
  slate_id: string;
  slate_name: string;
  slate_timezone: string;
  slate_slug: string;
  start_time: number;
  duration_minutes: number;
  speaker_email: string;
  speaker_id: string;
  episode_title: string;
  topic_description: string | null;
}

interface ReminderConfig {
  kind: '48h' | '24h';
}

const REMINDERS: ReminderConfig[] = [{ kind: '48h' }, { kind: '24h' }];

export async function runReminders(env: Env, db: D1Database): Promise<{ sent: number; skipped: number }> {
  let sent = 0, skipped = 0;
  const t = now();

  for (const cfg of REMINDERS) {
    const lower = cfg.kind === '48h' ? t + 48 * 3600 : t + 24 * 3600;
    const upper = cfg.kind === '48h' ? t + 48 * 3600 + 3600 : t + 24 * 3600 + 3600;

    const due = await db.prepare(
      `SELECT sl.id AS slot_id, sl.slate_id, sl.start_time, sl.duration_minutes,
              s.name AS slate_name, s.timezone AS slate_timezone, s.slug AS slate_slug,
              COALESCE(sl.custom_title, sug.title) AS episode_title,
              sug.description AS topic_description,
              sl.speaker_id, u.email AS speaker_email
       FROM slots sl
       JOIN slates s ON s.id = sl.slate_id
       JOIN users u ON u.id = sl.speaker_id
       LEFT JOIN suggestions sug ON sug.id = sl.suggestion_id
       WHERE sl.status = 'confirmed'
         AND sl.speaker_id IS NOT NULL
         AND sl.start_time >= ? AND sl.start_time < ?
         AND NOT EXISTS (
           SELECT 1 FROM sent_reminders sr
           WHERE sr.slot_id = sl.id AND sr.reminder_kind = ?
                 AND sr.recipient_user_id = sl.speaker_id
         )`,
    ).bind(lower, upper, cfg.kind).all<DueRow>();

    for (const row of due.results) {
      try {
        const fmt = new Intl.DateTimeFormat('en-US', {
          timeZone: row.slate_timezone, weekday: 'long', month: 'long', day: 'numeric',
          hour: 'numeric', minute: '2-digit',
        });
        const when = fmt.format(new Date(row.start_time * 1000));
        const url = `${env.APP_BASE_URL}/${row.slate_slug}/slot/${row.slot_id}`;
        const eta = cfg.kind === '48h' ? 'in 48 hours' : 'in 24 hours';

        await sendEmail(env, {
          to: row.speaker_email,
          subject: `Reminder · ${row.episode_title} (${eta})`,
          text: `You're up ${eta} on ${row.slate_name}: "${row.episode_title}"

  ${when} ${row.slate_timezone}

${row.topic_description ?? ''}

Slot link: ${url}

— Slate`,
          html: `<p>You're up ${eta} on <strong>${escapeHtml(row.slate_name)}</strong>:</p>
<p><strong>${escapeHtml(row.episode_title)}</strong> · ${when} ${row.slate_timezone}</p>
${row.topic_description ? `<p>${escapeHtml(row.topic_description)}</p>` : ''}
<p><a href="${url}">Open slot →</a></p>
<p>— Slate</p>`,
        });

        await db.prepare(
          'INSERT INTO sent_reminders (slot_id, reminder_kind, recipient_user_id, sent_at) VALUES (?, ?, ?, ?)',
        ).bind(row.slot_id, cfg.kind, row.speaker_id, t).run();
        sent++;
      } catch (err) {
        console.error('[reminders] failed for', row.slot_id, err);
        skipped++;
      }
    }
  }
  return { sent, skipped };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

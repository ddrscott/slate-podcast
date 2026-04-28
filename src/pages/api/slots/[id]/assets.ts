import type { APIRoute } from 'astro';
import { getDb, now, randomId } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireUser } from '@/lib/access';
import { isAppAdmin } from '@/lib/auth';

export const prerender = false;

const KINDS = ['audio','video','transcript','image','link'];

export const POST: APIRoute = async (ctx) => {
  try {
    const user = requireUser(ctx);
    const slotId = ctx.params.id!;
    const body = await ctx.request.json() as { kind?: string; url?: string; title?: string | null };

    if (!body.kind || !KINDS.includes(body.kind)) throw new HttpError(400, 'invalid_kind');
    const url = (body.url ?? '').trim();
    if (!url || url.length > 500) throw new HttpError(400, 'invalid_url');
    try { new URL(url); } catch { throw new HttpError(400, 'invalid_url_format'); }

    const db = getDb(ctx);
    const slot = await db.prepare(
      `SELECT sl.slate_id, sl.speaker_id,
              (SELECT 1 FROM slate_members
                WHERE slate_id = sl.slate_id AND user_id = ? AND role = 'speaker') AS is_speaker
       FROM slots sl WHERE sl.id = ?`,
    ).bind(user.id, slotId).first<{ slate_id: string; speaker_id: string | null; is_speaker: number | null }>();
    if (!slot) throw new HttpError(404, 'slot_not_found');

    const allowed = slot.speaker_id === user.id || slot.is_speaker || isAppAdmin(user.scopes);
    if (!allowed) throw new HttpError(403, 'forbidden');

    const id = `ast_${randomId(10)}`;
    await db.prepare(
      `INSERT INTO slot_assets (id, slot_id, kind, url, title, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
    ).bind(id, slotId, body.kind, url, body.title ?? null, now()).run();

    return jsonOk({ asset: { id, kind: body.kind, url, title: body.title ?? null, sort_order: 0 } }, 201);
  } catch (err) { return jsonError(err); }
};

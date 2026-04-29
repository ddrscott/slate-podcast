import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireUser } from '@/lib/access';
import { isAppAdmin } from '@/lib/auth';

export const prerender = false;

export const DELETE: APIRoute = async (ctx) => {
  try {
    const user = requireUser(ctx);
    const id = ctx.params.id!;
    const db = getDb(ctx);

    const asset = await db.prepare(
      `SELECT a.id, sl.host_id
       FROM slot_assets a JOIN slots sl ON sl.id = a.slot_id
       WHERE a.id = ?`,
    ).bind(id).first<{ id: string; host_id: string | null }>();

    if (!asset) throw new HttpError(404, 'not_found');

    const owns = asset.host_id === user.id || isAppAdmin(user.scopes);
    if (!owns) throw new HttpError(403, 'forbidden');

    await db.prepare('DELETE FROM slot_assets WHERE id = ?').bind(id).run();
    return jsonOk();
  } catch (err) { return jsonError(err); }
};

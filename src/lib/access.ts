import type { APIContext } from 'astro';
import { getDb } from './db';
import { isAppAdmin } from './auth';

type ResolvedUser = { id: string; email: string; display_name: string | null; scopes: string[] };

export function requireUser(ctx: APIContext): ResolvedUser {
  const user = ctx.locals.user;
  if (!user) throw new HttpError(401, 'unauthorized');
  return user;
}

export function requireAppAdmin(ctx: APIContext): ResolvedUser {
  const user = requireUser(ctx);
  if (!isAppAdmin(user.scopes)) throw new HttpError(403, 'app_admin_required');
  return user;
}

// Speaker on the slate, OR App Admin (App Admins implicitly have Speaker rights everywhere).
export async function requireSpeakerOnSlate(ctx: APIContext, slateId: string): Promise<void> {
  const user = requireUser(ctx);
  if (isAppAdmin(user.scopes)) return;

  const db = getDb(ctx);
  const row = await db.prepare(
    `SELECT role FROM slate_members WHERE slate_id = ? AND user_id = ? AND role = 'speaker'`,
  ).bind(slateId, user.id).first();
  if (!row) throw new HttpError(403, 'speaker_required');
}

// Member or Speaker on the slate, OR App Admin.
export async function requireMemberOnSlate(ctx: APIContext, slateId: string): Promise<void> {
  const user = requireUser(ctx);
  if (isAppAdmin(user.scopes)) return;

  const db = getDb(ctx);
  const row = await db.prepare(
    `SELECT role FROM slate_members WHERE slate_id = ? AND user_id = ?`,
  ).bind(slateId, user.id).first();
  if (!row) throw new HttpError(403, 'membership_required');
}

export class HttpError extends Error {
  constructor(public status: number, public code: string) {
    super(`${status} ${code}`);
  }
}

export function jsonError(err: unknown): Response {
  if (err instanceof HttpError) {
    return Response.json({ ok: false, error: err.code }, { status: err.status });
  }
  console.error('[api] unhandled error', err);
  return Response.json({ ok: false, error: 'internal' }, { status: 500 });
}

export function jsonOk(body: object = {}, status = 200): Response {
  return Response.json({ ok: true, ...body }, { status });
}

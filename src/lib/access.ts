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

// Host on the slate, OR slate admin (is_admin=1) on the slate, OR App Admin.
// Slate admins inherit host-level privileges so a community manager can
// act on behalf of hosts (configure the slate, upload artwork, claim
// slots, etc.) even if they don't run a show themselves.
export async function requireHostOnSlate(ctx: APIContext, slateId: string): Promise<void> {
  const user = requireUser(ctx);
  if (isAppAdmin(user.scopes)) return;

  const db = getDb(ctx);
  const row = await db.prepare(
    `SELECT role FROM slate_members
     WHERE slate_id = ? AND user_id = ? AND (role = 'host' OR is_admin = 1)`,
  ).bind(slateId, user.id).first();
  if (!row) throw new HttpError(403, 'host_required');
}

// Slate admin on the slate (is_admin=1), OR App Admin. Distinct from the
// host check above — used when an operation needs admin authority that
// a plain host shouldn't have (currently: editing other hosts' show
// identity / wiki / show logo).
export async function requireSlateAdminOnSlate(ctx: APIContext, slateId: string): Promise<void> {
  const user = requireUser(ctx);
  if (isAppAdmin(user.scopes)) return;

  const db = getDb(ctx);
  const row = await db.prepare(
    `SELECT 1 FROM slate_members WHERE slate_id = ? AND user_id = ? AND is_admin = 1`,
  ).bind(slateId, user.id).first();
  if (!row) throw new HttpError(403, 'slate_admin_required');
}

// "Can edit this host's stuff" — the auth shape used by the three
// host-profile endpoints (show_name PATCH, show-logo upload, profile
// wiki). Allows: the host themselves editing their own, OR a slate
// admin on the same slate, OR an App Admin anywhere.
export async function requireCanEditHostOnSlate(
  ctx: APIContext,
  slateId: string,
  targetUserId: string,
): Promise<void> {
  const user = requireUser(ctx);
  if (user.id === targetUserId) return;        // self always ok
  if (isAppAdmin(user.scopes)) return;          // global override

  const db = getDb(ctx);
  const row = await db.prepare(
    `SELECT 1 FROM slate_members WHERE slate_id = ? AND user_id = ? AND is_admin = 1`,
  ).bind(slateId, user.id).first();
  if (!row) throw new HttpError(403, 'cannot_edit_host');
}

// Member or Host on the slate, OR App Admin.
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

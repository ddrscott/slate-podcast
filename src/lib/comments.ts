// Topic comment helpers — server-side fetch + tree assembly.
//
// Volume on this surface is small (slate members, low frequency), so a
// single SELECT + in-memory tree build is fine. No recursive CTE needed.

import type { D1Database } from '@cloudflare/workers-types';

export interface CommentRow {
  id: string;
  parent_id: string | null;
  author_id: string | null;
  body: string;
  created_at: number;
  updated_at: number | null;
  deleted_at: number | null;
  author_email: string | null;
  author_display_name: string | null;
  author_headshot_url: string | null;
}

export interface CommentNode extends CommentRow {
  replies: CommentNode[];
}

export async function fetchTopicComments(
  db: D1Database,
  topicId: string,
): Promise<{ tree: CommentNode[]; count: number }> {
  const flat = await db.prepare(
    `SELECT c.id, c.parent_id, c.author_id, c.body,
            c.created_at, c.updated_at, c.deleted_at,
            u.email        AS author_email,
            u.display_name AS author_display_name,
            u.headshot_url AS author_headshot_url
     FROM comments c
     LEFT JOIN users u ON u.id = c.author_id
     WHERE c.topic_id = ?
     ORDER BY c.created_at ASC`,
  ).bind(topicId).all<CommentRow>();

  const byId = new Map<string, CommentNode>();
  const roots: CommentNode[] = [];

  for (const row of flat.results) {
    byId.set(row.id, { ...row, replies: [] });
  }
  for (const row of flat.results) {
    const node = byId.get(row.id)!;
    if (row.parent_id && byId.has(row.parent_id)) {
      byId.get(row.parent_id)!.replies.push(node);
    } else {
      // parent_id might point at a soft-deleted ancestor that's been
      // filtered out — but we don't filter here. If we ever exclude
      // deleted from the tree at the SQL level, this branch surfaces
      // orphaned replies as top-level. For now (no filter), this only
      // fires for true root comments.
      roots.push(node);
    }
  }

  return { tree: roots, count: flat.results.length };
}

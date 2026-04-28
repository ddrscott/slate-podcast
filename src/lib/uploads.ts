// Image upload helpers backed by R2.
// Public URLs are served through our /media/[...path] worker route, not
// directly from r2.dev (which is blocked for production buckets without a
// custom domain).

import { getEnv, randomId } from './db';
import type { APIContext } from 'astro';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export interface UploadResult { url: string; key: string; }

/**
 * Validate an uploaded image. Returns null on success, or an error code.
 */
export function validateImage(file: File): string | null {
  if (!file) return 'no_file';
  if (!ALLOWED_TYPES.has(file.type)) return 'unsupported_type';
  if (file.size <= 0) return 'empty_file';
  if (file.size > MAX_BYTES) return 'too_large';
  return null;
}

/**
 * Stream the file into R2 under `prefix/<random>.<ext>`. Returns the
 * public URL (under /media/...) and the bucket key. Caller is responsible
 * for cleaning up the previous key if replacing.
 */
export async function putImage(
  ctx: APIContext,
  prefix: string,
  file: File,
): Promise<UploadResult> {
  const env = getEnv(ctx);
  const ext = EXT_BY_TYPE[file.type] ?? 'bin';
  const key = `${prefix}/${randomId(10)}.${ext}`;
  await env.MEDIA.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
  });
  const base = env.APP_BASE_URL ?? '';
  return { url: `${base}/media/${key}`, key };
}

/**
 * Delete an object from R2. Tolerant of missing objects.
 * `urlOrKey` may be a public URL (we'll strip the /media/ prefix) or a raw key.
 */
export async function deleteImage(ctx: APIContext, urlOrKey: string | null): Promise<void> {
  if (!urlOrKey) return;
  const env = getEnv(ctx);
  const key = extractKey(urlOrKey);
  if (!key) return;
  try { await env.MEDIA.delete(key); } catch { /* ignore */ }
}

function extractKey(urlOrKey: string): string | null {
  // If it looks like a URL, extract the path after /media/
  const m = urlOrKey.match(/\/media\/(.+)$/);
  if (m) return m[1];
  // Otherwise treat as a raw key, but defensively reject anything with a scheme
  if (/^https?:\/\//.test(urlOrKey)) return null;
  return urlOrKey;
}

import type { APIContext } from 'astro';

export function getDb(ctx: APIContext | { locals: App.Locals }): D1Database {
  const db = ctx.locals.runtime?.env?.DB;
  if (!db) throw new Error('D1 binding DB not available on locals.runtime.env');
  return db;
}

export function getEnv(ctx: APIContext | { locals: App.Locals }): Env {
  const env = ctx.locals.runtime?.env;
  if (!env) throw new Error('Cloudflare runtime env not available');
  return env as Env;
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

const HEX = '0123456789abcdef';

export function randomId(bytes = 12): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    out += HEX[(buf[i] >>> 4) & 0xf] + HEX[buf[i] & 0xf];
  }
  return out;
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64urlEncode(buf);
}

export function base64urlEncode(buf: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

// Normalized form of a suggestion title for duplicate detection.
// Lowercase, strip non-alphanumeric, collapse whitespace, trim.
// Two titles that fingerprint to the same string are treated as duplicates.
export function fingerprint(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

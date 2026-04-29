import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';

export const prerender = false;

// 1200×630 OG card for a slate. SVG so we don't pay the WASM-rendering tax;
// modern unfurlers (Twitter/X, Slack, Discord, iMessage on macOS 14+) render
// SVG fine. For platforms that won't (Facebook, LinkedIn) the rich text still
// shows; we just lose the image preview there.
export const GET: APIRoute = async (ctx) => {
  const slug = ctx.params.slate;
  if (!slug) return new Response('Not found', { status: 404 });

  const db = getDb(ctx);
  const slate = await db.prepare(
    `SELECT id, name, description FROM slates WHERE slug = ? AND is_public = 1`,
  ).bind(slug).first<{ id: string; name: string; description: string | null }>();
  if (!slate) return new Response('Not found', { status: 404 });

  const counts = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM slate_members WHERE slate_id = ?) AS members,
       (SELECT COUNT(*) FROM topics   WHERE slate_id = ? AND status != 'archived') AS topics,
       (SELECT COUNT(*) FROM slots         WHERE slate_id = ? AND status = 'open') AS open_slots`,
  ).bind(slate.id, slate.id, slate.id).first<{ members: number; topics: number; open_slots: number }>();

  // Wrap title across at most 2 lines. ~18 chars/line at 78px.
  const titleLines = wrapTitle(slate.name, 18, 2);
  // Cap tagline at 2 lines so it never collides with the CTA, even when the
  // title is 2 lines tall. Wider per-line budget than title since font is smaller.
  const tagline = (slate.description?.trim() || 'A community-driven podcast. Members suggest topics, Hosts pick what to record.');
  const taglineLines = wrapText(tagline, 56, 2);

  const stats: string[] = [];
  if (counts) {
    if (counts.members) stats.push(`${counts.members} member${counts.members === 1 ? '' : 's'}`);
    if (counts.topics) stats.push(`${counts.topics} topic${counts.topics === 1 ? '' : 's'}`);
    if (counts.open_slots) stats.push(`${counts.open_slots} open slot${counts.open_slots === 1 ? '' : 's'}`);
  }
  const statsLine = stats.join(' · ');

  // Vertical layout, computed top-down so the CTA always sits below the tagline.
  // 630px frame height; orange bar + brand take y=0..120.
  const TITLE_TOP = 220;
  const TITLE_LEADING = 88;
  const titleBottom = TITLE_TOP + (titleLines.length - 1) * TITLE_LEADING;
  const TAGLINE_TOP = titleBottom + 70;
  const TAGLINE_LEADING = 40;
  const taglineBottom = TAGLINE_TOP + (taglineLines.length - 1) * TAGLINE_LEADING;
  const CTA_TOP = Math.min(taglineBottom + 40, 540);
  const STATS_Y = 590;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif">
  <rect width="1200" height="630" fill="#fafaf8"/>
  <rect width="1200" height="10" fill="#FF6A2A"/>

  <text x="80" y="100" fill="#FF6A2A" font-family="ui-monospace, 'JetBrains Mono', monospace" font-size="22" font-weight="500">// slate.ljs.app</text>

  ${titleLines.map((line, i) => `<text x="80" y="${TITLE_TOP + i * TITLE_LEADING}" fill="#0f172a" font-size="76" font-weight="800" letter-spacing="-1">${esc(line)}</text>`).join('\n  ')}

  ${taglineLines.map((line, i) => `<text x="80" y="${TAGLINE_TOP + i * TAGLINE_LEADING}" fill="#475569" font-size="28" font-weight="400">${esc(line)}</text>`).join('\n  ')}

  <g>
    <rect x="80" y="${CTA_TOP}" width="300" height="60" rx="8" fill="#FF6A2A"/>
    <text x="230" y="${CTA_TOP + 40}" fill="#ffffff" font-size="22" font-weight="600" text-anchor="middle">Join as a Member →</text>
  </g>

  ${statsLine ? `<text x="1120" y="${STATS_Y}" fill="#94a3b8" font-family="ui-monospace, 'JetBrains Mono', monospace" font-size="20" text-anchor="end">${esc(statsLine)}</text>` : ''}
</svg>`;

  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      // Cache 1h at the edge; OG cards should refresh as counts grow.
      'cache-control': 'public, max-age=300, s-maxage=3600',
    },
  });
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Greedy word-wrap to a max char count per line, capped at maxLines.
// Last line gets an ellipsis if input is longer than the cap.
function wrapText(s: string, perLine: number, maxLines: number): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if ((cur + ' ' + w).length <= perLine) cur += ' ' + w;
    else { lines.push(cur); cur = w; if (lines.length >= maxLines) break; }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = (last.length > perLine - 1 ? last.slice(0, perLine - 1) : last) + '…';
  }
  return lines;
}

function wrapTitle(s: string, perLine: number, maxLines: number): string[] {
  const lines = wrapText(s, perLine, maxLines);
  return lines.length === 0 ? [s.slice(0, perLine)] : lines;
}

import type { APIRoute } from 'astro';

export const prerender = false;

// Generic OG card for the landing page (and any page that doesn't pass a
// slate-specific override). 1200×630, same visual language as the per-slate
// card but pitched at coordinators rather than members.
export const GET: APIRoute = () => {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif">
  <rect width="1200" height="630" fill="#fafaf8"/>
  <rect width="1200" height="10" fill="#FF6A2A"/>

  <text x="80" y="110" fill="#FF6A2A" font-family="ui-monospace, 'JetBrains Mono', monospace" font-size="22" font-weight="500">// slate.ljs.app</text>

  <text x="80" y="240" fill="#0f172a" font-size="78" font-weight="800" letter-spacing="-1">A year of empty slots.</text>
  <text x="80" y="320" fill="#0f172a" font-size="78" font-weight="800" letter-spacing="-1" opacity="0.6">A pool of topics.</text>
  <text x="80" y="400" fill="#0f172a" font-size="78" font-weight="800" letter-spacing="-1">Hosts pick. Members vote.</text>

  <text x="80" y="475" fill="#475569" font-size="28" font-weight="400">Community-driven podcast scheduling for volunteer-run shows.</text>

  <g>
    <rect x="80" y="520" width="280" height="64" rx="8" fill="#FF6A2A"/>
    <text x="220" y="562" fill="#ffffff" font-size="24" font-weight="600" text-anchor="middle">Sign up free →</text>
  </g>
</svg>`;

  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=86400',
    },
  });
};

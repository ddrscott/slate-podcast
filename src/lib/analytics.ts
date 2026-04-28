// Self-hosted Plausible (plausible.ljs.app) integration.
// When PLAUSIBLE_HOST is empty, returns '' so dev/preview don't ping the
// production analytics endpoint by accident.

export function analyticsHead(env: Env): string {
  const host = ((env as any).PLAUSIBLE_HOST ?? '').trim();
  if (!host) return '';
  // data-domain is the canonical public hostname; Plausible groups every
  // script.js load (incl. workers.dev fallback) under this string.
  const domain = 'slate.ljs.app';
  return `<script defer data-domain="${domain}" src="https://${host}/js/script.outbound-links.tagged-events.js"></script>
<script>window.plausible = window.plausible || function() { (window.plausible.q = window.plausible.q || []).push(arguments) }</script>`;
}

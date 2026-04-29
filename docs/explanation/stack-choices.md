# Stack rationale

Why this stack, and what we'd consider switching.

## Cloudflare Workers + D1

**Picked because**: zero-maintenance, free tier covers the workload (small per-slate user counts, mostly read-heavy), the `*.ljs.app` ecosystem is already on Cloudflare, custom domain is one TOML line.

**Trade-offs**:
- D1 is SQLite-on-the-edge. Single-region writes, eventually-consistent reads. For a podcast scheduler that's fine; for high-throughput shared state it wouldn't be.
- No long-running connections, no background jobs *inside* the worker. The reminder cron runs against an external scheduler hitting our `/api/cron/reminders` (see [How-to: schedule the reminder cron](../how-to/schedule-reminder-cron.md)). Idempotent endpoint + dedupe table is the cleanest pattern for this constraint.
- Bundle size matters. We code-split the heavy editor (`@uiw/react-md-editor`, ~327 kB gzip) and the AG Grid view (~230 kB gzip) into their own routes via `manualChunks` in `astro.config.mjs`.

## Astro + React islands

**Picked because**: most pages are read-mostly schedules and lists — server-rendered HTML is fastest to first paint. The interactive bits (the AG Grid sheet, the markdown editor, the schedule grid) are React islands hydrated only where needed.

**Trade-off**: writing one feature can mean touching `.astro` for the shell and `.tsx` for the island. We accept this; the island boundary is usually obvious.

## TailwindCSS + DaisyUI

**Picked because**: DaisyUI's component classes (`btn`, `card`, `input`) cut the styling churn down to almost nothing. Tailwind underneath gives the escape hatch when DaisyUI's defaults aren't right.

**Trade-off**: classnames in HTML get long. Worth it to never write a CSS file.

## AG Grid Community (MIT)

**Picked because**: the admin slot view is a sheet. Rebuilding sheet semantics (cell editing, undo, copy/paste, virtualization) is a project. AG Grid Community is free and good enough.

**Considered**: TanStack Table (lighter, but no out-of-the-box cell editing UX), Handsontable (good but commercial license).

## `@uiw/react-md-editor`

**Picked because**: editor + preview + image paste in one component. ~327 kB is acceptable when code-split to a single route.

**Considered**: TipTap (richer, more flexible, but more code to wire), CodeMirror + a custom preview (full control, more work).

## `react-markdown` + `rehype-sanitize`

For *rendering* published show notes on the public side. We don't ship the editor to anonymous viewers — just a sanitized read path. Together these are ~80 kB.

## Resend

**Picked because**: it's what `auth.ljs.app` already uses, and the `ljs.app` sender domain is already verified there. Slate's reminder emails reuse the same Resend account and the same `hello@ljs.app` sender — no new domain to verify.

**Trade-off**: vendor lock-in for transactional email. The cost of switching is wrapping `email.ts` around a different SDK; the dollar cost so far is zero (free tier covers reminders comfortably).

## Things we considered and didn't pick

- **Postgres** (Neon, Supabase): more capable, but D1 is free, edge-local, and good enough. We'd move if we hit a feature D1 lacks (e.g., generated columns for fingerprint, full-text search) and the workaround was uglier than the migration.
- **A separate Worker for the cron**: doable, but an external HTTP scheduler is one fewer thing to deploy. We documented both options.
- **Drizzle / Prisma**: an ORM would be premature. The query surface is small (~20 distinct shapes); raw SQL with `db.prepare(...).bind(...)` is faster to read than the ORM equivalent.

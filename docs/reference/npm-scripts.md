# npm scripts

From `package.json`. Wrappers around `astro` and `wrangler` — nothing custom.

| Script | Command | When to use |
|---|---|---|
| `dev` | `astro dev` | Local dev server on `:4321` (talks to remote D1 — see `wrangler.toml`) |
| `build` | `astro build && echo '_worker.js' > dist/.assetsignore && echo '_routes.json' >> dist/.assetsignore` | Build for Cloudflare. The `.assetsignore` lines exclude the worker bundle and routes file from being served as static assets. |
| `preview` | `wrangler dev` | Preview the *built* worker locally, exactly as Cloudflare will run it |
| `deploy` | `npm run build && wrangler deploy` | Build + deploy to `slate-podcast` Worker |
| `astro` | `astro` | Pass-through to the Astro CLI |
| `typecheck` | `astro check` | TypeScript + Astro check, no emit |
| `db:create` | `wrangler d1 create slate-podcast` | Run **once** when bootstrapping a new environment |
| `db:apply:local` | `wrangler d1 execute slate-podcast --local --file=./schema.sql` | Apply `schema.sql` to the local D1 emulator |
| `db:apply:remote` | `wrangler d1 execute slate-podcast --remote --file=./schema.sql` | Apply `schema.sql` to the production D1 |
| `db:query:local` | `wrangler d1 execute slate-podcast --local --command` | Ad-hoc local SQL: `npm run db:query:local -- "SELECT 1"` |
| `db:query:remote` | `wrangler d1 execute slate-podcast --remote --command` | Ad-hoc prod SQL: `npm run db:query:remote -- "SELECT count(*) FROM slates"` |

## Tip: passing arguments

`db:query:*` needs the SQL string to reach `wrangler` unchanged:

```bash
npm run db:query:remote -- "SELECT id, slug FROM slates"
```

The `--` separator is required.

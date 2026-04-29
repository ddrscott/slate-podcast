# Switch local dev to a local D1 emulator

Default behavior: `npm run dev` talks to the production `slate-podcast` D1. That's fast, no schema drift, real data — but every typo writes to prod.

If you need isolation (e.g., destructive testing, schema experiments), flip the binding to local.

## 1. Edit `wrangler.toml`

Change the `[[d1_databases]]` block:

```toml
[[d1_databases]]
binding = "DB"
database_name = "slate-podcast"
database_id = "f1d33343-8107-4e6a-bf97-aa9b6452a673"
remote = false   # ← was true
```

(The `database_id` is unused when `remote = false`, but keep it set.)

## 2. Apply schema to the local emulator

```bash
npm run db:apply:local
```

This creates a fresh local SQLite file under `.wrangler/state/v3/d1/`.

## 3. Run dev

```bash
npm run dev
```

Now writes hit the local file. Production is untouched.

## 4. Seed (optional)

You'll have an empty DB. To seed your auth.ljs.app user as an App-Admin slate, hand-write rows or adapt `scripts/seed-ar-suggestions.mjs`. There's no canonical local seed — most dev work uses prod data because the data model is simple and the user pool is small.

## Switching back

Edit `wrangler.toml`, set `remote = true`, restart `npm run dev`. Local data is preserved on disk for next time.

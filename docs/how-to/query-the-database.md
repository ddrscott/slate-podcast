# Query the D1 database directly

Slate's data is in a Cloudflare D1 (SQLite) database called `slate-podcast`. You can query it from your dev machine via `wrangler`.

## One-off queries

```bash
# remote (production)
npm run db:query:remote -- "SELECT slug, name FROM slates"

# local (only relevant if you flipped `remote = false` in wrangler.toml)
npm run db:query:local -- "SELECT count(*) FROM slots"
```

The trailing `--` is required so npm passes the SQL string through unmodified.

## Apply a schema migration

`schema.sql` is idempotent. After editing it:

```bash
npm run db:apply:remote
```

Use cases:

- Adding a new `CREATE TABLE IF NOT EXISTS`.
- Adding a new `CREATE INDEX IF NOT EXISTS`.
- Adding a column with a default — `ALTER TABLE` is *not* idempotent in SQLite, so guard with a one-shot script or accept that re-runs error harmlessly on the existing column.

For irreversible structural changes, prefer a separate one-shot SQL file you `wrangler d1 execute --file=...` once and check in to `scripts/migrations/`.

## Rough sizing

```bash
npm run db:query:remote -- "SELECT
    (SELECT count(*) FROM slates) AS slates,
    (SELECT count(*) FROM users) AS users,
    (SELECT count(*) FROM slots) AS slots,
    (SELECT count(*) FROM suggestions) AS suggestions"
```

## Common ad-hoc queries

```sql
-- All slates with member/speaker counts
SELECT s.slug, s.name,
       sum(case when m.role = 'speaker' then 1 else 0 end) AS speakers,
       sum(case when m.role = 'member' then 1 else 0 end) AS members
FROM slates s
LEFT JOIN slate_members m ON m.slate_id = s.id
GROUP BY s.id;

-- Upcoming confirmed slots in next 7 days
SELECT sl.start_time, s.name, u.email
FROM slots sl
JOIN slates s ON s.id = sl.slate_id
JOIN users u ON u.id = sl.speaker_id
WHERE sl.status = 'confirmed'
  AND sl.start_time BETWEEN unixepoch() AND unixepoch() + 7*86400
ORDER BY sl.start_time;

-- Top suggestions by upvote
SELECT title, upvote_count, status
FROM suggestions
WHERE slate_id = '<slate_id>'
ORDER BY upvote_count DESC LIMIT 20;
```

## Caution

`wrangler.toml` sets `remote = true` on the D1 binding, so **`npm run dev` reads and writes the same DB you're querying with `db:query:remote`**. Be careful with `UPDATE`/`DELETE` from the CLI while a dev session is open.

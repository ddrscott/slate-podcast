# Slate documentation

Organized using the [Diataxis](https://diataxis.fr/) framework: tutorials teach, how-to guides solve, reference looks up, explanation discusses.

## Tutorials — *learning-oriented*

Start here if you're new.

- **[Getting started as a Slate user](tutorials/getting-started.md)** — sign in, join, suggest, claim.
- **[Setting up Slate for local development](tutorials/local-dev-setup.md)** — first-time dev environment.

## How-to guides — *task-oriented*

You know what you want to do.

### Operating a slate
- [Create a new slate](how-to/create-a-slate.md)
- [Configure scheduling rules](how-to/configure-scheduling-rules.md)
- [Promote a Member to Host (or demote one)](how-to/promote-a-host.md)
- [Claim a slot and pick a topic](how-to/claim-and-schedule-a-slot.md)
- [Write and publish show notes](how-to/publish-show-notes.md)

### Operating the deployment
- [Deploy to `slate.ljs.app`](how-to/deploy.md)
- [Schedule the reminder cron](how-to/schedule-reminder-cron.md)
- [Query the D1 database directly](how-to/query-the-database.md)
- [Switch local dev to a local D1 emulator](how-to/switch-dev-to-local-d1.md)

## Reference — *information-oriented*

Look up the facts.

- [Project layout](reference/project-layout.md) — every file in `src/`, what it does.
- [Database schema](reference/database-schema.md) — every table, every column.
- [API endpoints](reference/api-endpoints.md) — every route under `/api`.
- [Roles and permissions](reference/roles-and-permissions.md) — Member / Host / App-Admin matrix.
- [Scheduling rules](reference/scheduling-rules.md) — recurrence grammar.
- [Environment, secrets, and bindings](reference/environment.md) — `wrangler.toml`, `.dev.vars`, `Env` type.
- [npm scripts](reference/npm-scripts.md) — every script in `package.json`.

## Explanation — *understanding-oriented*

Why it's built this way.

- [Why "slates" instead of shows + organizations](explanation/why-slates.md)
- [Why auth lives at `auth.ljs.app`, not in Slate](explanation/auth-via-auth-ljs-app.md)
- [Why a shared topic pool](explanation/topic-pool.md)
- [Stack rationale](explanation/stack-choices.md)

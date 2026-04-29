# Slate

Multi-tenant podcast slot manager. Calendly inverted: the host posts a year of empty slots, Members suggest topics, Hosts claim slots and pick from the pool.

Built for volunteer-run shows that don't have time to maintain a spreadsheet *and* enforce the workflow.

**Live:** <https://slate.ljs.app>

## Quick start

```bash
npm install
cp .dev.vars.example .dev.vars   # then fill in JWT_SECRET from auth.ljs.app
npm run dev                      # → http://localhost:4321
```

`wrangler.toml` has `remote = true` on the D1 binding — local dev hits the production database. See [Setting up Slate for local development](docs/tutorials/local-dev-setup.md) for the long version, and [Switch local dev to a local D1 emulator](docs/how-to/switch-dev-to-local-d1.md) if you want isolation.

## Stack

Astro 5 + React islands · TailwindCSS + DaisyUI · Cloudflare Workers + D1 + R2 · Resend · Auth delegated to [`auth.ljs.app`](https://auth.ljs.app).

Why these choices: [docs/explanation/stack-choices.md](docs/explanation/stack-choices.md).

## Documentation

All developer and user docs live in [`docs/`](docs/), organized using the [Diataxis](https://diataxis.fr/) framework. Start at [`docs/README.md`](docs/README.md).

| If you want to… | Read |
|---|---|
| use Slate as a Member or Host | [Tutorial: Getting started](docs/tutorials/getting-started.md) |
| set up the dev env | [Tutorial: Local dev setup](docs/tutorials/local-dev-setup.md) |
| deploy a fresh environment | [How-to: Deploy](docs/how-to/deploy.md) |
| understand the data model | [Reference: Database schema](docs/reference/database-schema.md) |
| understand permissions | [Reference: Roles & permissions](docs/reference/roles-and-permissions.md) |
| know what's where in the code | [Reference: Project layout](docs/reference/project-layout.md) |
| know why it's built this way | [Explanation index](docs/README.md#explanation--understanding-oriented) |

## Status

Beta. Free during beta.

## License

[MIT](LICENSE)

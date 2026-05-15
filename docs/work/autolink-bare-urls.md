# Auto-linkify bare URLs in markdown rendering (ShowNotesView)

## Problem

When a member writes `https://example.com` in a comment (or any wiki body — topic notes, show wiki, host wiki, slot show notes), the renderer leaves it as plain text. To get a clickable link they have to use explicit markdown syntax `[example.com](https://example.com)` or `<https://example.com>`. Members shouldn't have to know markdown to paste a URL and have it work.

The renderer is `src/components/ShowNotesView.tsx` — a thin wrapper around `react-markdown`. It's used by every wiki surface in the app (topic detail, topic edit, show detail, show edit, host detail, host edit, slot detail show notes, AND the comment thread). Fix in one place, fixes everywhere.

User confirmed scope: global. They want bare-URL auto-linking on every wiki surface, not just comments.

## Acceptance Criteria

- A bare URL like `https://example.com` in any markdown body becomes a clickable `<a>` element.
- Existing explicit markdown links (`[text](url)`) continue to render unchanged.
- Sanitization is preserved — the existing `rehypeSanitize` plugin must continue to gate output. Generated links should have `target="_blank" rel="noopener noreferrer"` (or at minimum, NOT lose existing safety).
- The fix applies everywhere `ShowNotesView` is used — comments, topic notes, show/host wikis, slot show notes. No per-surface opt-in needed.

## Relevant Files

- `src/components/ShowNotesView.tsx` — the renderer; add the autolink plugin here.
- `package.json` — likely needs a new dep (`remark-gfm` is the standard react-markdown plugin that enables GitHub-style autolinks).

## Constraints

- **Don't break sanitization.** `rehypeSanitize` runs after the markdown is parsed. Adding a remark plugin happens earlier in the pipeline so it should be safe, but verify with a smoke test (e.g. paste a `javascript:` URL into a comment — should NOT become a clickable link).
- **Don't introduce GFM features the team doesn't want.** `remark-gfm` enables more than autolinks — it also adds tables, strikethrough, task lists, and footnotes. If any of those are undesirable, configure the plugin to enable only autolinks (`remarkGfm` accepts a config object — `{ singleTilde: false }` etc., but for autolink-only behavior, consider `remark-gfm-autolink-literal` or write a small custom plugin).
- **Add `target="_blank" rel="noopener noreferrer"` to external links.** Currently the renderer doesn't set these; you can use a custom `components.a` override on `<Markdown>` to add them. This applies to all links (explicit + autolinked).
- **Verify after deploy:** in a comment on a topic, paste `https://anthropic.com` (no brackets, no formatting). Confirm it renders as a clickable link that opens in a new tab.

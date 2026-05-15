# The slate child-page pattern

Every page under `/[slate]/...` is built from the same three layers:

1. **`Layout.astro`** — site shell. Branded nav with the slate logo + name, account dropdown, "Shows" link, activity icon, "Manage" button (when applicable).
2. **`SlateChildPage.astro`** — body wrapper. Consistent padding (`py-6 md:py-8`), one of three width variants, and an optional breadcrumb at the top.
3. **`Breadcrumb.astro`** — small mono header: `← parent / current`.

The split exists because each layer has a different reason to change. The shell rarely changes. The body wrapper sometimes changes (width, padding tweaks). The breadcrumb's *content* changes on every page.

## Why a breadcrumb at all

The earlier design reinforced the slate name everywhere — pages opened with `// {slate.name}` mono captions, big H1s, and `← {slate.name}` back-links. By the time you reached the actual content, three different elements had reminded you what slate you were on. The site header already carries that identity (logo + name in the nav). Repeating it in the body is wasted space and gives the page two competing headers.

The breadcrumb is the minimum useful version: one line telling you **where in the slate** you are, with a back-target to the category listing.

```
← Topics / Compromise and the Rise and Fall of Scott Herndon
← Shows / Reformed Labs
← The Immediate Justice Network / Activity
```

The parent label is a link; the current label is just text (you don't link to yourself).

## Two flavors of parent

Pages fall into two groups:

- **Items in a category that has a listing page** (`/topics/[id]`, `/shows/[slug]`) — parent points at the listing. `← Topics`, `← Shows`. The breadcrumb works like a normal site hierarchy.
- **Orphan items** without a category listing (`/hosts/[id]`, `/slot/[id]`, `/day/[date]`, `/activity`, `/join`) — parent points at the slate root, label is the slate name. `← The Immediate Justice Network`.

We considered fabricating intermediate categories — adding `/[slate]/hosts` and `/[slate]/schedule` listings just to give those orphans a proper parent. We didn't, because invented hierarchy is worse than honest flatness. If a listing page becomes useful for its own sake (e.g. a public hosts roster), it'll pull those orphan breadcrumbs up to it then.

The "Edit / current" pattern handles sub-actions on a detail page:

```
← Compromise and the Rise and Fall of Scott Herndon / Edit
← Reformed Labs / Assign slots
```

Here the parent is the **item's detail page**, not the category listing. From an `/edit` page, the back arrow goes one level up — to the thing you were editing.

## Why `SlateChildPage` instead of inlining

Before this pattern, every page had its own `<article class="py-6 md:py-8 max-w-Nxl">` wrapper with subtle drift — `py-8` here, `py-6 md:py-8` there, `max-w-3xl` on some, `max-w-4xl` on others, `<section>` instead of `<article>` on a couple. The visual inconsistency was small but accumulated. Standardizing meant either copying the same wrapper into 20+ pages or extracting a component. Extracting won.

```astro
<Layout title="…" slate={…}>
  <SlateChildPage parent={…} current="…" width="medium">
    …page body…
  </SlateChildPage>
</Layout>
```

Three width variants:

- `narrow` (`max-w-2xl`) — forms, settings panes (join, suggest, edit panels)
- `medium` (`max-w-4xl`) — articles, wikis, detail pages (default)
- `wide` (`max-w-6xl`) — dashboards, grids (shows roster)

Listing pages use `SlateChildPage` **without** a `parent` — they get the consistent margins but no breadcrumb (they're top-level within the slate; the site-header logo handles back-to-slate).

## What lives in the site header vs. the breadcrumb

The site header is the one place the slate's identity surfaces — logo + name + "// slate.ljs.app" subtitle, all linking to the slate root. That's enough. Don't repeat it in page bodies.

The site header also carries cross-page affordances: Shows link, Activity icon (with unread badge), Manage button (host/admin), Account menu. These are routes you might want from anywhere on the slate. The breadcrumb only carries the **page's** parent — never global navigation.

If you find yourself wanting to add a global affordance to a page, it goes in the header, not the breadcrumb.

## Timezone-localized times

Adjacent design choice that fits the same "shared utility, used everywhere" pattern: the `<time data-localize>` element.

The server renders dates and times in the slate's own timezone — `Thu, May 14 · 7:30 PM CDT`. That's correct for the no-JS / signed-out case. After hydration, an inline `<script is:inline>` block in `Layout.astro` walks every `<time data-localize>` element and reformats it using the viewer's browser locale + timezone:

```html
<time datetime="2026-05-14T00:30:00Z" data-localize="time-tz">7:30 PM CDT</time>
```

becomes `5:30 PM PDT` in California, `8:30 PM EDT` in New York, etc. No FOUC because the server rendered a sensible fallback first.

The supported format keys are `date`, `time-tz`, `date-time-tz` — defined in the Layout script. To add a new variant, extend that object; every page using `<time data-localize="newKey">` picks it up automatically. There's no per-page wiring.

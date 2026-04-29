# Write and publish show notes

Show notes are the public, archival record of an episode. Markdown in, sanitized HTML out.

You need to be the slot's Speaker (or App-Admin).

## 1. Open the slot's show-notes editor

Slot page → **Edit show notes**.

## 2. Write markdown

Standard CommonMark. The `@uiw/react-md-editor` widget gives you a side-by-side preview.

Headings, lists, links, code blocks, images all work. HTML is sanitized on the public render via `rehype-sanitize`, so don't bother trying to inject `<script>` or `<style>`.

## 3. Attach assets

Below the editor, **Slot assets** — add structured links the public renderer pulls out into a sidebar:

- `audio` — MP3 / OGG URL.
- `video` — YouTube, Vimeo, direct file URL.
- `transcript` — text/Markdown URL or paste.
- `image` — anything that renders as `<img>`.
- `link` — generic external link.

Each asset has a title and a `sort_order`. They render in that order.

## 4. Publish

Click **Publish**. Slate sets `show_notes_published_at` to now. The slot's public page now renders the notes. The slate's activity log gets a `notes_published` event.

You can keep editing after publishing — saves go live immediately. To unpublish, click **Unpublish** (clears the `published_at` timestamp).

## Where the public sees them

```
https://slate.ljs.app/<slug>/slot/<slot-id>
```

Sanitized markdown → HTML, asset list in a sidebar, plus a download link if there's a `transcript` asset.

## Promo image (social share)

Upload via **Promo image** on the slot page. Image goes to R2, served through `/media/<key>`. The slot's `og:image` meta tag picks it up automatically.

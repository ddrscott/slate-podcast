import { useState, useCallback } from 'react';
import MDEditor from '@uiw/react-md-editor';

// Combined editor for a show: metadata form on top (name, description,
// link, listen-on URLs, cover upload) + markdown wiki below. Each section
// saves independently so a host can update a single field without
// re-uploading everything.

interface Props {
  slateId: string;
  slateSlug: string;
  showId: string;
  showSlug: string;
  initialName: string;
  initialDescription: string | null;
  initialLink: string | null;
  initialCoverUrl: string | null;
  initialWiki: string | null;
  initialApple: string | null;
  initialSpotify: string | null;
  initialYoutube: string | null;
  initialRss: string | null;
}

export default function ShowEditor({
  slateId, slateSlug, showId, showSlug,
  initialName, initialDescription, initialLink, initialCoverUrl,
  initialWiki, initialApple, initialSpotify, initialYoutube, initialRss,
}: Props) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [link, setLink] = useState(initialLink ?? '');
  const [apple, setApple] = useState(initialApple ?? '');
  const [spotify, setSpotify] = useState(initialSpotify ?? '');
  const [youtube, setYoutube] = useState(initialYoutube ?? '');
  const [rss, setRss] = useState(initialRss ?? '');
  const [metaStatus, setMetaStatus] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);

  const [coverUrl, setCoverUrl] = useState(initialCoverUrl);
  const [coverStatus, setCoverStatus] = useState('');

  const [wiki, setWiki] = useState(initialWiki ?? '');
  const [wikiSummary, setWikiSummary] = useState('');
  const [wikiStatus, setWikiStatus] = useState('');
  const [savingWiki, setSavingWiki] = useState(false);

  const saveMeta = useCallback(async () => {
    setSavingMeta(true); setMetaStatus('Saving…');
    const res = await fetch(`/api/slates/${slateId}/shows/${showId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        description: description.trim() || null,
        link: link.trim() || null,
        listen_apple_url: apple.trim() || null,
        listen_spotify_url: spotify.trim() || null,
        listen_youtube_url: youtube.trim() || null,
        listen_rss_url: rss.trim() || null,
      }),
    });
    setSavingMeta(false);
    if (res.ok) {
      setMetaStatus('Saved.');
      // Name changes can change the slug; reload to land on the new URL.
      setTimeout(() => window.location.reload(), 400);
    } else {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setMetaStatus(`Save failed: ${err.error ?? res.status}`);
    }
  }, [slateId, showId, name, description, link, apple, spotify, youtube, rss]);

  const onCoverChange = useCallback(async (file: File) => {
    if (file.size > 5 * 1024 * 1024) { setCoverStatus('File too large (max 5 MB).'); return; }
    setCoverStatus('Uploading…');
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/api/slates/${slateId}/shows/${showId}/cover`, { method: 'POST', body: fd });
    if (res.ok) {
      const body = (await res.json()) as { cover_image_url: string };
      setCoverUrl(body.cover_image_url);
      setCoverStatus('Saved.');
    } else {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setCoverStatus(`Failed: ${err.error ?? res.status}`);
    }
  }, [slateId, showId]);

  const removeCover = useCallback(async () => {
    if (!confirm('Remove the show cover?')) return;
    setCoverStatus('Removing…');
    const res = await fetch(`/api/slates/${slateId}/shows/${showId}/cover`, { method: 'DELETE' });
    if (res.ok) {
      setCoverUrl(null);
      setCoverStatus('Removed.');
    } else {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setCoverStatus(`Failed: ${err.error ?? res.status}`);
    }
  }, [slateId, showId]);

  const saveWiki = useCallback(async () => {
    setSavingWiki(true); setWikiStatus('Saving…');
    const res = await fetch(`/api/slates/${slateId}/shows/${showId}/wiki`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: wiki, change_summary: wikiSummary.trim() || null }),
    });
    if (res.ok) {
      window.location.href = `/${slateSlug}/shows/${showSlug}`;
    } else {
      setSavingWiki(false);
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setWikiStatus(`Save failed: ${err.error ?? res.status}`);
    }
  }, [slateId, slateSlug, showId, showSlug, wiki, wikiSummary]);

  return (
    <div className="space-y-10">
      {/* ─── Metadata + cover ──────────────────────────────────────────── */}
      <section className="space-y-6">
        <div className="flex items-start gap-5 flex-wrap">
          <div className="shrink-0">
            <div className="w-32 h-32 md:w-40 md:h-40 rounded border border-base-300 overflow-hidden bg-base-200 flex items-center justify-center text-xs opacity-60">
              {coverUrl
                ? <img src={coverUrl} alt="" className="w-full h-full object-cover" />
                : <span className="font-mono">no cover</span>}
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              <label className="btn btn-xs btn-ghost border border-base-300 cursor-pointer">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onCoverChange(f);
                  }}
                />
                {coverUrl ? 'Replace' : 'Upload'}
              </label>
              {coverUrl && (
                <button type="button" onClick={removeCover}
                        className="btn btn-xs btn-ghost border border-base-300 text-error">
                  Remove
                </button>
              )}
            </div>
            {coverStatus && <p className="text-xs opacity-70 mt-1">{coverStatus}</p>}
          </div>

          <div className="flex-1 min-w-[16rem] space-y-3">
            <label className="form-control block">
              <span className="label-text text-sm">Show name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                className="input input-bordered w-full"
              />
            </label>
            <label className="form-control block">
              <span className="label-text text-sm">Short description</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder="One or two lines, shown under the show name."
                className="textarea textarea-bordered w-full"
              />
            </label>
            <label className="form-control block">
              <span className="label-text text-sm">Show website (optional)</span>
              <input
                type="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                maxLength={500}
                placeholder="https://your-show.com"
                className="input input-bordered w-full"
              />
            </label>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <label className="form-control block">
            <span className="label-text text-sm">Apple Podcasts URL</span>
            <input type="url" value={apple} onChange={(e) => setApple(e.target.value)}
                   maxLength={500} placeholder="https://podcasts.apple.com/..."
                   className="input input-bordered w-full font-mono text-sm" />
          </label>
          <label className="form-control block">
            <span className="label-text text-sm">Spotify URL</span>
            <input type="url" value={spotify} onChange={(e) => setSpotify(e.target.value)}
                   maxLength={500} placeholder="https://open.spotify.com/show/..."
                   className="input input-bordered w-full font-mono text-sm" />
          </label>
          <label className="form-control block">
            <span className="label-text text-sm">YouTube URL</span>
            <input type="url" value={youtube} onChange={(e) => setYoutube(e.target.value)}
                   maxLength={500} placeholder="https://youtube.com/@..."
                   className="input input-bordered w-full font-mono text-sm" />
          </label>
          <label className="form-control block">
            <span className="label-text text-sm">RSS feed URL</span>
            <input type="url" value={rss} onChange={(e) => setRss(e.target.value)}
                   maxLength={500} placeholder="https://example.com/feed.xml"
                   className="input input-bordered w-full font-mono text-sm" />
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button type="button" onClick={saveMeta} disabled={savingMeta} className="btn btn-primary">
            {savingMeta ? 'Saving…' : 'Save show info'}
          </button>
          {metaStatus && <span className="text-sm opacity-70">{metaStatus}</span>}
        </div>
      </section>

      {/* ─── Wiki body ─────────────────────────────────────────────────── */}
      <section className="space-y-3 border-t border-base-300 pt-8">
        <h2 className="text-lg font-bold">Wiki — about the show</h2>
        <p className="text-xs opacity-60">
          Markdown. Recurring segments, links to socials and donations,
          embedded videos — whatever helps listeners find what they need.
        </p>
        <div data-color-mode="light">
          <MDEditor
            value={wiki}
            onChange={(v) => setWiki(v ?? '')}
            preview="edit"
            height={500}
            textareaProps={{
              placeholder: 'Welcome to [Show Name] — every Tuesday at 7pm…',
            }}
          />
        </div>

        <label className="block">
          <span className="text-sm opacity-70 font-mono">// what changed (optional)</span>
          <input
            type="text"
            value={wikiSummary}
            onChange={(e) => setWikiSummary(e.target.value)}
            maxLength={200}
            placeholder="e.g. added Discord invite"
            className="input input-bordered w-full mt-1 font-mono text-sm"
          />
        </label>

        <div className="flex items-center gap-3">
          <button type="button" onClick={saveWiki} disabled={savingWiki} className="btn btn-primary">
            {savingWiki ? 'Saving…' : 'Save wiki'}
          </button>
          <a href={`/${slateSlug}/shows/${showSlug}`} className="btn btn-ghost border border-base-300">
            View public page
          </a>
          {wikiStatus && <span className="text-sm opacity-70">{wikiStatus}</span>}
        </div>
      </section>
    </div>
  );
}

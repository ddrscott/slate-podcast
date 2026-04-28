import { useState, useCallback } from 'react';
import MDEditor from '@uiw/react-md-editor';

interface Asset {
  id: string;
  kind: 'audio' | 'video' | 'transcript' | 'image' | 'link';
  url: string;
  title: string | null;
  sort_order: number;
}

interface Props {
  slotId: string;
  initialMarkdown: string | null;
  initialPublished: boolean;
  initialAssets: Asset[];
  canPublish: boolean;
}

export default function ShowNotesEditor({
  slotId, initialMarkdown, initialPublished, initialAssets, canPublish,
}: Props) {
  const [md, setMd] = useState<string>(initialMarkdown ?? '');
  const [assets, setAssets] = useState<Asset[]>(initialAssets);
  const [published, setPublished] = useState(initialPublished);
  const [status, setStatus] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    setSaving(true); setStatus('Saving…');
    const res = await fetch(`/api/slots/${slotId}/show-notes`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ show_notes: md }),
    });
    setSaving(false);
    if (res.ok) setStatus('Draft saved.');
    else setStatus('Save failed.');
  }, [md, slotId]);

  const togglePublish = useCallback(async () => {
    const path = published ? 'unpublish-notes' : 'publish-notes';
    setSaving(true); setStatus(published ? 'Unpublishing…' : 'Publishing…');
    const res = await fetch(`/api/admin/slots/${slotId}/${path}`, { method: 'POST' });
    setSaving(false);
    if (res.ok) {
      setPublished(!published);
      setStatus(published ? 'Notes unpublished.' : 'Notes published.');
    } else setStatus('Failed.');
  }, [published, slotId]);

  const addAsset = useCallback(async (kind: Asset['kind'], url: string, title: string | null) => {
    const res = await fetch(`/api/slots/${slotId}/assets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, url, title }),
    });
    if (res.ok) {
      const body = await res.json() as { asset: Asset };
      setAssets(prev => [...prev, body.asset]);
    } else setStatus('Asset add failed.');
  }, [slotId]);

  const removeAsset = useCallback(async (assetId: string) => {
    const res = await fetch(`/api/slot-assets/${assetId}`, { method: 'DELETE' });
    if (res.ok) setAssets(prev => prev.filter(a => a.id !== assetId));
  }, []);

  return (
    <div className="space-y-4" data-color-mode="light">
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn btn-primary btn-sm">
          {saving ? 'Working…' : 'Save draft'}
        </button>
        {canPublish && (
          <button onClick={togglePublish} disabled={saving}
                  className={`btn btn-sm ${published ? 'btn-ghost border border-base-300' : 'btn-success'}`}>
            {published ? 'Unpublish' : 'Publish'}
          </button>
        )}
        {published ? (
          <span className="badge badge-success badge-outline">published</span>
        ) : (
          <span className="badge badge-ghost">draft</span>
        )}
        {status && <span className="text-sm opacity-75">{status}</span>}
      </div>

      <MDEditor
        value={md}
        onChange={(v) => setMd(v ?? '')}
        height={420}
        preview="live"
        textareaProps={{ placeholder: 'Episode notes — markdown supported. Headers, lists, links, code, images…' }}
      />

      <div className="card bg-base-200 border border-base-300">
        <div className="card-body py-4">
          <h3 className="font-semibold">Assets</h3>
          <p className="text-xs opacity-60">Links shown alongside the notes once published. Audio/video/transcript/image/link.</p>
          {assets.length > 0 && (
            <ul className="space-y-1 mt-2">
              {assets.map(a => (
                <li key={a.id} className="flex items-center gap-2 text-sm">
                  <span className="badge badge-xs badge-outline font-mono">{a.kind}</span>
                  <a href={a.url} target="_blank" rel="noopener noreferrer" className="link flex-1 truncate">
                    {a.title ?? a.url}
                  </a>
                  <button onClick={() => removeAsset(a.id)} className="btn btn-xs btn-ghost text-error">×</button>
                </li>
              ))}
            </ul>
          )}
          <AssetForm onAdd={addAsset} />
        </div>
      </div>
    </div>
  );
}

function AssetForm({ onAdd }: { onAdd: (kind: Asset['kind'], url: string, title: string | null) => void }) {
  const [kind, setKind] = useState<Asset['kind']>('link');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  return (
    <form
      className="flex flex-wrap gap-2 mt-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!url.trim()) return;
        onAdd(kind, url.trim(), title.trim() || null);
        setUrl(''); setTitle('');
      }}
    >
      <select value={kind} onChange={(e) => setKind(e.target.value as Asset['kind'])}
              className="select select-bordered select-sm">
        <option value="link">link</option>
        <option value="audio">audio</option>
        <option value="video">video</option>
        <option value="transcript">transcript</option>
        <option value="image">image</option>
      </select>
      <input value={title} onChange={(e) => setTitle(e.target.value)}
             placeholder="Title (optional)" className="input input-bordered input-sm w-44" />
      <input value={url} onChange={(e) => setUrl(e.target.value)}
             type="url" placeholder="https://…" required
             className="input input-bordered input-sm flex-1 min-w-[200px]" />
      <button type="submit" className="btn btn-sm btn-primary">+ Add</button>
    </form>
  );
}

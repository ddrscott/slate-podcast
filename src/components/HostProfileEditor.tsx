import { useState, useCallback } from 'react';
import MDEditor from '@uiw/react-md-editor';

// Host wiki body editor — markdown + optional change summary. On save:
// POST /api/slates/[id]/hosts/[user_id]/profile → server appends a
// slate_member_revisions row, updates slate_members.profile_body, logs
// activity. Hard-nav back to the host page so the body re-renders SSR
// and the new revision appears in the history list.

interface Props {
  slateId: string;
  slateSlug: string;
  hostUserId: string;
  initialBody: string | null;
}

export default function HostProfileEditor({ slateId, slateSlug, hostUserId, initialBody }: Props) {
  const [body, setBody] = useState<string>(initialBody ?? '');
  const [summary, setSummary] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    setSaving(true); setStatus('Saving…');
    const res = await fetch(`/api/slates/${slateId}/hosts/${hostUserId}/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body, change_summary: summary.trim() || null }),
    });
    if (res.ok) {
      window.location.href = `/${slateSlug}/hosts/${hostUserId}`;
    } else {
      setSaving(false);
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setStatus(`Save failed: ${err.error ?? res.status}`);
    }
  }, [body, summary, slateId, slateSlug, hostUserId]);

  const cancel = () => {
    if (body !== (initialBody ?? '') || summary.trim() !== '') {
      if (!confirm('Discard your changes?')) return;
    }
    window.location.href = `/${slateSlug}/hosts/${hostUserId}`;
  };

  return (
    <div className="space-y-4">
      <div data-color-mode="light">
        <MDEditor
          value={body}
          onChange={(v) => setBody(v ?? '')}
          preview="edit"
          height={600}
          textareaProps={{
            placeholder:
              "Anything about your show. Platforms you stream on, your bio, your org, donation links, recurring segments, an intro video — all in markdown.",
          }}
        />
      </div>

      <label className="block">
        <span className="text-sm opacity-70 font-mono">// what changed (optional)</span>
        <input
          type="text"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          maxLength={200}
          placeholder="e.g. added Discord invite link"
          className="input input-bordered w-full mt-1 font-mono text-sm"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="btn btn-primary"
        >
          {saving ? 'Saving…' : 'Save page'}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          className="btn btn-ghost border border-base-300"
        >
          Cancel
        </button>
        {status && (
          <span className="text-sm opacity-70">{status}</span>
        )}
      </div>
    </div>
  );
}

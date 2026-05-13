import { useState, useCallback } from 'react';
import MDEditor from '@uiw/react-md-editor';

// Collaborative pre-show notes editor — markdown body + optional one-line
// change summary. On save: POST /api/topics/[id]/notes → server appends a
// topic_revisions row, updates topics.notes, logs the activity event.
// Then we send the user back to the topic detail page.

interface Props {
  slateSlug: string;
  topicId: string;
  initialBody: string | null;
}

export default function TopicNotesEditor({ slateSlug, topicId, initialBody }: Props) {
  const [body, setBody] = useState<string>(initialBody ?? '');
  const [summary, setSummary] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    setSaving(true); setStatus('Saving…');
    const res = await fetch(`/api/topics/${topicId}/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body, change_summary: summary.trim() || null }),
    });
    if (res.ok) {
      // Hard nav back so the new notes render server-side. Avoids stale
      // markdown rendering and ensures the revision row shows up.
      window.location.href = `/${slateSlug}/topics/${topicId}`;
    } else {
      setSaving(false);
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setStatus(`Save failed: ${err.error ?? res.status}`);
    }
  }, [body, summary, slateSlug, topicId]);

  const cancel = () => {
    if (body !== (initialBody ?? '') || summary.trim() !== '') {
      if (!confirm('Discard your changes?')) return;
    }
    window.location.href = `/${slateSlug}/topics/${topicId}`;
  };

  return (
    <div className="space-y-4">
      <div data-color-mode="light">
        <MDEditor
          value={body}
          onChange={(v) => setBody(v ?? '')}
          preview="edit"
          height={500}
          textareaProps={{
            placeholder:
              'Talking points, links, questions, context — anything that helps the host prep.',
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
          placeholder="e.g. added link to Lev's interview"
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
          {saving ? 'Saving…' : 'Save notes'}
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

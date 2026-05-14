import { useCallback, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  ClientSideRowModelModule,
  CommunityFeaturesModule,
  ModuleRegistry,
  type CellValueChangedEvent,
  type ColDef,
  type GridReadyEvent,
} from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';

ModuleRegistry.registerModules([ClientSideRowModelModule, CommunityFeaturesModule]);

export interface SlotRow {
  id: string;
  start_time: number;
  duration_minutes: number;
  status: string;
  custom_title: string | null;
  notes_internal: string | null;
  rule_id: string | null;
  host_id: string | null;
  host_email: string | null;
  host_display_name: string | null;
  topic_id: string | null;
  topic_title: string | null;
  show_id: string | null;
  show_slug: string | null;
  show_name: string | null;
}

interface Props {
  slateId: string;
  timezone: string;
  rows: SlotRow[];
}

const STATUSES = ['open','assigned','confirmed','recorded','published','cancelled'];

export default function SlotsAGGrid({ slateId, timezone, rows: initialRows }: Props) {
  const [rows] = useState<SlotRow[]>(initialRows);
  const [dirty, setDirty] = useState<Map<string, Record<string, unknown>>>(new Map());
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string>('');
  const gridRef = useRef<AgGridReact<SlotRow>>(null);

  const fmtDate = useMemo(() => new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }), [timezone]);

  const columns: ColDef<SlotRow>[] = useMemo(() => [
    {
      headerName: 'When', field: 'start_time', pinned: 'left', width: 200, editable: false,
      valueFormatter: (p) => p.value ? fmtDate.format(new Date(p.value * 1000)) : '',
      sort: 'asc',
    },
    {
      headerName: 'Status', field: 'status', width: 130,
      editable: true, cellEditor: 'agSelectCellEditor',
      cellEditorParams: { values: STATUSES },
      cellClassRules: {
        'text-emerald-700 font-semibold': p => p.value === 'confirmed',
        'text-amber-700': p => p.value === 'assigned',
        'opacity-50 line-through': p => p.value === 'cancelled',
      },
    },
    { headerName: 'Show', field: 'show_name', width: 200, editable: false,
      valueGetter: (p) => p.data?.show_name ?? '',
      cellStyle: { fontWeight: '600' } as Record<string, string> },
    { headerName: 'Host', width: 200, editable: false,
      valueGetter: (p) => {
        const r = p.data;
        if (!r?.host_email) return '';
        if (r.host_display_name?.trim()) return r.host_display_name.trim();
        const at = r.host_email.indexOf('@');
        return at > 0 ? r.host_email.slice(0, at) : r.host_email;
      },
      cellStyle: { opacity: '0.85' } as Record<string, string> },
    { headerName: 'Topic', field: 'topic_title', flex: 1, editable: false,
      cellStyle: { fontStyle: 'italic', opacity: '0.85' } as Record<string, string> },
    { headerName: 'Custom title', field: 'custom_title', flex: 1, editable: true,
      cellEditor: 'agLargeTextCellEditor',
      cellStyle: { opacity: '1' } as Record<string, string> },
    { headerName: 'Internal notes', field: 'notes_internal', flex: 1, editable: true,
      cellEditor: 'agLargeTextCellEditor',
      cellStyle: { opacity: '1' } as Record<string, string> },
    {
      headerName: 'Duration (m)', field: 'duration_minutes', width: 130,
      editable: true, cellEditor: 'agNumberCellEditor',
      cellEditorParams: { min: 1, max: 600, step: 5 },
      cellStyle: { opacity: '1' } as Record<string, string>,
    },
    { headerName: 'Slot ID', field: 'id', width: 200, editable: false,
      cellStyle: { fontFamily: 'monospace', fontSize: '11px', opacity: '0.5' } as Record<string, string> },
  ], [fmtDate]);

  const onCellValueChanged = useCallback((e: CellValueChangedEvent<SlotRow>) => {
    const id = e.data.id;
    const field = e.colDef.field as string;
    if (!field) return;
    setDirty(prev => {
      const next = new Map(prev);
      const cur = next.get(id) ?? {};
      cur[field] = e.newValue;
      next.set(id, cur);
      return next;
    });
  }, []);

  const onGridReady = useCallback((e: GridReadyEvent) => {
    e.api.sizeColumnsToFit();
  }, []);

  const save = useCallback(async () => {
    if (dirty.size === 0) return;
    setSaving(true); setStatus('Saving…');
    const diffs = [...dirty.entries()].map(([id, changes]) => ({ id, changes }));
    try {
      const res = await fetch(`/api/slates/${slateId}/admin/bulk-edit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ diffs }),
      });
      const body = await res.json() as { ok: boolean; updated?: number; error?: string };
      if (res.ok) {
        const n = body.updated ?? 0;
        setStatus(`Saved ${n} row${n === 1 ? '' : 's'}.`);
        setDirty(new Map());
      } else {
        setStatus(`Failed: ${body.error ?? 'unknown'}`);
      }
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [dirty, slateId]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <button onClick={save} disabled={dirty.size === 0 || saving}
                className="btn btn-primary btn-sm">
          {saving ? 'Saving…' : `Save changes${dirty.size > 0 ? ` (${dirty.size})` : ''}`}
        </button>
        {status && <span className="text-sm opacity-75">{status}</span>}
        <span className="text-xs opacity-50 ml-auto font-mono">
          tip: shift-click to multi-select · double-click to edit
        </span>
      </div>
      <div className="ag-theme-quartz" style={{ height: '70vh', width: '100%' }}>
        <AgGridReact<SlotRow>
          ref={gridRef}
          rowData={rows}
          columnDefs={columns}
          getRowId={(p) => p.data.id}
          onGridReady={onGridReady}
          onCellValueChanged={onCellValueChanged}
          rowSelection={{ mode: 'multiRow' }}
          suppressClickEdit={false}
          stopEditingWhenCellsLoseFocus
          enableCellTextSelection
          ensureDomOrder
          defaultColDef={{
            resizable: true,
            sortable: true,
            filter: true,
            floatingFilter: true,
          }}
        />
      </div>
    </div>
  );
}

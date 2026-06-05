import { useCallback, useEffect, useState } from 'react';
import PageHeader from './PageHeader.jsx';
import FileTable from '../components/FileTable.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { usePerms } from '../lib/perms.js';

export default function Reports() {
  const toast = useToast();
  const { canEdit } = usePerms();
  const [reports, setReports] = useState(null);
  const [sessions, setSessions] = useState(null);

  // Compare modal state
  const [showCompare, setShowCompare] = useState(false);
  const [periods, setPeriods]       = useState([]);
  const [selected, setSelected]     = useState([]);

  const loadReports = useCallback(async () => {
    try {
      const data = await (await fetch('/api/reports')).json();
      setReports(data.files || []);
    } catch (e) { toast(String(e), 'err'); }
  }, [toast]);

  const loadSessions = useCallback(async () => {
    try {
      const data = await (await fetch('/api/data/sessions')).json();
      setSessions(data.sessions || []);
    } catch { setSessions([]); }
  }, []);

  useEffect(() => { loadReports(); loadSessions(); }, [loadReports, loadSessions]);

  // Fetch registry periods when Compare modal opens
  useEffect(() => {
    if (!showCompare) return;
    (async () => {
      try {
        const d = await (await fetch('/api/periods')).json();
        setPeriods(d.registry || []);
      } catch { setPeriods([]); }
    })();
  }, [showCompare]);

  const deleteReport = async (name) => {
    if (!confirm(`Delete ${name}?`)) return;
    const res = await fetch(`/api/reports/${encodeURIComponent(name)}`, { method: 'DELETE' });
    toast(res.ok ? `Deleted ${name}` : 'Delete failed', res.ok ? 'ok' : 'err');
    loadReports();
  };

  const deleteSession = async (sid) => {
    if (!confirm(`Delete all files from session ${sid}?`)) return;
    const res = await fetch(`/api/data/sessions/${encodeURIComponent(sid)}`, { method: 'DELETE' });
    toast(res.ok ? `Deleted session ${sid}` : 'Delete failed', res.ok ? 'ok' : 'err');
    loadSessions();
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Step 04 · Reports"
        title="Browse"
        accent="generated reports."
        sub="Word reports rendered by build-report appear here. Download individual files or grab everything as a zip."
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* ─── Reports ─── */}
        <div className="form-section">
          <div className="form-section-title">
            Reports
            <span>Generated .docx files</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => { setSelected([]); setShowCompare(true); }}>
                Compare periods
              </button>
              <button className="btn btn-ghost btn-sm" onClick={loadReports}>↺ Refresh</button>
            </div>
          </div>
          {reports === null && <p className="empty-state" style={{ padding: 12 }}>Loading…</p>}
          {reports?.length === 0 && <p className="empty-state" style={{ padding: 12 }}>No reports yet — run <b>build-report</b> from the Dashboard.</p>}
          {reports?.length > 1 && (
            <a href="/api/reports/download-zip" download="reports.zip" style={{ marginBottom: 12, display: 'inline-block' }}>
              <button className="btn btn-primary btn-sm">↓ Download all as ZIP ({reports.length} files)</button>
            </a>
          )}
          {reports?.length > 0 && (
            <FileTable
              columns={[
                { key: 'name', label: 'File', render: r => <span className="file-name">{r.name}</span> },
                { key: 'size_kb', label: 'Size', render: r => <span style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{r.size_kb} KB</span> },
                { key: 'modified', label: 'Generated', render: r => <span style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{r.modified}</span> },
              ]}
              rows={reports}
              actions={r => (
                <>
                  <a href={`/api/reports/download/${encodeURIComponent(r.name)}`} download>
                    <button className="btn btn-primary btn-sm">↓ Download</button>
                  </a>
                  <button className="btn btn-danger btn-sm" onClick={() => deleteReport(r.name)}
                          disabled={!canEdit}
                          title={canEdit ? '' : 'Viewer access — deleting requires an editor or admin role'}>Delete</button>
                </>
              )}
            />
          )}
        </div>

        {/* ─── Data sessions ─── */}
        <div className="form-section">
          <div className="form-section-title">
            Data files
            <span>Submissions exported by <code style={{ fontFamily: 'var(--font-mono)' }}>download</code>, grouped by run</span>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={loadSessions}>↺ Refresh</button>
          </div>
          {sessions === null && <p className="empty-state" style={{ padding: 12 }}>Loading…</p>}
          {sessions?.length === 0 && <p className="empty-state" style={{ padding: 12 }}>No data files yet. Run <b>download</b> first.</p>}
          {sessions?.length > 0 && (
            <FileTable
              columns={[
                { key: 'label', label: 'Session', render: (s, i) => (
                  <span className="file-name">
                    {s.label}
                    {sessions.indexOf(s) === 0 && <span style={{ fontSize: 10, color: 'var(--accent)', marginLeft: 8 }}>(latest)</span>}
                  </span>
                )},
                { key: 'files', label: 'Files', render: s => <span style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{s.files.length} file{s.files.length !== 1 ? 's' : ''}</span> },
              ]}
              rows={sessions}
              actions={s => (
                <>
                  <a href={`/api/data/sessions/${encodeURIComponent(s.session_id)}/download`} download>
                    <button className="btn btn-primary btn-sm">↓ Download ZIP</button>
                  </a>
                  <button className="btn btn-danger btn-sm" onClick={() => deleteSession(s.session_id)}
                          disabled={!canEdit}
                          title={canEdit ? '' : 'Viewer access — deleting requires an editor or admin role'}>Delete</button>
                </>
              )}
            />
          )}
        </div>
      </div>

      {/* ─── Compare modal ─── */}
      {showCompare && (
        <Modal
          title="Build comparison report"
          onClose={() => setShowCompare(false)}
          onSave={async () => {
            if (selected.length < 2) {
              toast('Pick at least 2 periods', 'err');
              return;
            }
            setShowCompare(false);
            try {
              const r = await fetch('/api/run/build-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ compare: selected.join(',') }),
              });
              if (!r.ok) { toast(`Build failed (${r.status})`, 'err'); return; }
              toast(`Building comparison: ${selected.join(' vs ')}…`, 'ok');
              // Reload reports after a delay so the new docx shows up
              setTimeout(loadReports, 3000);
            } catch (e) { toast(e.message || 'Network error', 'err'); }
          }}
          saveLabel="Build comparison"
          width={520}
        >
          <div style={{ maxHeight: 300, overflow: 'auto' }}>
            <p style={{ color: 'var(--ink-3)', fontSize: 13, marginBottom: 12 }}>Pick 2 or more periods to compare:</p>
            {periods.length === 0 && <p style={{ color: 'var(--ink-3)' }}>No periods configured yet. Add some in the Sources tab.</p>}
            {periods.map(p => (
              <label key={p.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                <input
                  type="checkbox"
                  checked={selected.includes(p.label)}
                  onChange={e => setSelected(prev => e.target.checked ? [...prev, p.label] : prev.filter(x => x !== p.label))}
                />
                <span>{p.label}</span>
              </label>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

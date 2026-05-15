import { useCallback, useEffect, useState } from 'react';
import PageHeader from './PageHeader.jsx';
import FileTable from '../components/FileTable.jsx';
import { useToast } from '../components/Toast.jsx';

export default function Reports() {
  const toast = useToast();
  const [reports, setReports] = useState(null);
  const [sessions, setSessions] = useState(null);

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
    <>
      <PageHeader
        eyebrow="Step 04 · Reports"
        title="Browse"
        accent="generated reports."
        sub="Word reports rendered by build-report appear here. Download individual files or grab everything as a zip."
      />
      <div style={{ padding: '0 28px 40px', display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* ─── Reports ─── */}
        <div className="form-section">
          <div className="form-section-title">
            Reports
            <span>Generated .docx files</span>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={loadReports}>↺ Refresh</button>
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
                  <button className="btn btn-danger btn-sm" onClick={() => deleteReport(r.name)}>Delete</button>
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
                  <button className="btn btn-danger btn-sm" onClick={() => deleteSession(s.session_id)}>Delete</button>
                </>
              )}
            />
          )}
        </div>
      </div>
    </>
  );
}

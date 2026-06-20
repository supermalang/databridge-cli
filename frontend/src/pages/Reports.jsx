import { useCallback, useEffect, useState } from 'react';
import PageHeader from './PageHeader.jsx';
import FileTable from '../components/FileTable.jsx';
import Modal from '../components/Modal.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { useToast } from '../components/Toast.jsx';
import { usePerms } from '../lib/perms.js';
import { useRun } from '../lib/run.js';
import { RailLayout, StatusCard, QuickActionsCard, RailIcons } from '../components/Rail.jsx';
import { loadConfig } from '../lib/config.js';
import BuildOptions from '../components/BuildOptions.jsx';

export default function Reports() {
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const { canEdit } = usePerms();
  const { run } = useRun();
  const [reports, setReports] = useState(null);
  const [sessions, setSessions] = useState(null);
  const [templates, setTemplates] = useState(null);
  const [cfg, setCfg] = useState(null);

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

  const loadTemplates = useCallback(async () => {
    try {
      const data = await (await fetch('/api/templates')).json();
      setTemplates(data.files || []);
    } catch { setTemplates([]); }
  }, []);

  useEffect(() => { loadReports(); loadSessions(); loadTemplates(); }, [loadReports, loadSessions, loadTemplates]);
  useEffect(() => { loadConfig().then(setCfg); }, []);

  // build-report is only runnable once its inputs exist: an API connection,
  // fetched questions, downloaded data, and a report template. Gate the action
  // and tell the user what's still missing.
  // Template check mirrors backend resolution (src/reports/builder.py): build-report
  // uses report.template if set, otherwise falls back to templates/report_template.docx.
  // So "template present" means the file build-report will actually load exists — not
  // merely that report.template was explicitly set via "set active".
  const activeTemplateName = (cfg?.report?.template || 'templates/report_template.docx').split('/').pop();
  const hasTemplate = !!templates?.some((t) => t.name === activeTemplateName);
  const buildMissing = [
    !(cfg?.api?.url && cfg?.api?.token) && 'connection',
    !((cfg?.questions || []).length > 0) && 'questions',
    !(sessions?.length) && 'data',
    !hasTemplate && 'template',
  ].filter(Boolean);
  const buildReady = canEdit && buildMissing.length === 0;
  const buildTitle = !canEdit ? 'Editor access required'
    : buildReady ? 'Render a Word report from the latest data'
    : `Needs: ${buildMissing.join(', ')}`;

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
    if (!await confirm({ title: 'Delete report?', message: `“${name}” will be permanently deleted. This can’t be undone.` })) return;
    const res = await fetch(`/api/reports/${encodeURIComponent(name)}`, { method: 'DELETE' });
    toast(res.ok ? `Deleted ${name}` : 'Delete failed', res.ok ? 'ok' : 'err');
    loadReports();
  };

  const deleteAllReports = async () => {
    if (!await confirm({
      title: 'Delete all reports?',
      message: 'Every generated .docx report will be permanently deleted. This can’t be undone.',
      confirmLabel: 'Delete all',
    })) return;
    const res = await fetch('/api/reports', { method: 'DELETE' });
    toast(res.ok ? 'Deleted all reports' : 'Delete failed', res.ok ? 'ok' : 'err');
    loadReports();
  };

  const deleteSession = async (sid) => {
    if (!await confirm({ title: 'Delete data session?', message: `All files from session ${sid} will be permanently deleted. This can’t be undone.` })) return;
    const res = await fetch(`/api/data/sessions/${encodeURIComponent(sid)}`, { method: 'DELETE' });
    toast(res.ok ? `Deleted session ${sid}` : 'Delete failed', res.ok ? 'ok' : 'err');
    loadSessions();
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Step 5 of 5 · Reports"
        title="Browse"
        accent="generated reports."
        sub="Word reports rendered by build-report appear here. Download individual files or grab everything as a zip."
      />
      <RailLayout rail={
        <>
          <StatusCard checks={[
            { tone: reports?.length ? 'ok' : 'warn',
              label: `${reports?.length || 0} report${reports?.length === 1 ? '' : 's'} generated`,
              sub: reports?.length ? 'ready to download' : 'run build-report to create one' },
            { tone: sessions?.length ? 'ok' : 'warn',
              label: `${sessions?.length || 0} data session${sessions?.length === 1 ? '' : 's'}`,
              sub: sessions?.length ? 'available to build from' : 'run download first' },
          ]} />
          <QuickActionsCard actions={[
            { icon: RailIcons.copy, label: 'Compare periods', onClick: () => { setSelected([]); setShowCompare(true); },
              title: 'Build a comparison report across periods' },
          ]} />
        </>
      }>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* ─── Build ─── */}
        <div className="form-section">
          <div className="form-section-title">
            Build a report
            <span>Render a Word report from the latest data</span>
          </div>
          <BuildOptions
            questions={cfg?.questions || []}
            disabled={!buildReady}
            buildTitle={buildTitle}
            onBuild={(opts) => run('build-report', opts)}
          />
        </div>

        {/* ─── Reports ─── */}
        <div className="form-section">
          <div className="form-section-title">
            Reports
            <span>Generated .docx files</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => { setSelected([]); setShowCompare(true); }}>
                Compare periods
              </button>
              {reports?.length > 0 && (
                <button
                  className="btn btn-danger btn-sm"
                  data-testid="reports-delete-all"
                  onClick={deleteAllReports}
                  disabled={!canEdit}
                  title={canEdit ? 'Permanently delete every generated report' : 'Viewer access — deleting requires an editor or admin role'}>
                  Delete all reports
                </button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={loadReports}>↺ Refresh</button>
            </div>
          </div>
          {reports === null && <p className="empty-state" style={{ padding: 12 }}>Loading…</p>}
          {reports?.length === 0 && <p className="empty-state" style={{ padding: 12 }}>No reports yet — run <b>build-report</b> from the Dashboard.</p>}
          {reports?.length > 1 && (
            <a
              className="btn btn-primary btn-sm"
              href="/api/reports/download-zip"
              download="reports.zip"
              aria-label={`Download all ${reports.length} reports as ZIP`}
              style={{ marginBottom: 12 }}>
              ↓ Download all as ZIP ({reports.length} files)
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
                  <a
                    className="btn btn-primary btn-sm"
                    href={`/api/reports/download/${encodeURIComponent(r.name)}`}
                    download
                    aria-label={`Download ${r.name}`}>
                    ↓ Download
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
                  <a
                    className="btn btn-primary btn-sm"
                    href={`/api/data/sessions/${encodeURIComponent(s.session_id)}/download`}
                    download
                    aria-label={`Download data session ${s.label} as ZIP`}>
                    ↓ Download ZIP
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
      </RailLayout>

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
      {confirmDialog}
    </div>
  );
}

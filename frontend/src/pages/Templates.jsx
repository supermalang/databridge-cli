import { useCallback, useEffect, useRef, useState } from 'react';
import PageHeader from './PageHeader.jsx';
import FileTable from '../components/FileTable.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { useToast } from '../components/Toast.jsx';
import { usePerms } from '../lib/perms.js';
import { useRun } from '../lib/run.js';
import { useAiStatus, AI_LOCK_TIP } from '../lib/aiStatus.js';
import BuildOptions from '../components/BuildOptions.jsx';
import { loadConfig } from '../lib/config.js';

const KINDS = ['chart', 'indicator', 'summary', 'table', 'narrative', 'metadata'];

// What the user must do before Express fill can validate proposals.
const EXPRESS_GATE_HINT = 'Download data and configure questions before using Express fill.';

// Discoverability banner — present on the Dashboard (Home) and the Templates tab.
// Clicking it opens the express flow. On Home it also navigates to Templates.
//
// Gated on /api/state readiness: inference can't validate proposals without real
// columns, so the banner stays disabled + non-actionable (with an accessible
// hint) until BOTH has_questions AND has_data are true (XTF-9).
export function ExpressBanner({ onOpen }) {
  const [ready, setReady] = useState(null);   // null = unknown (treat as not-ready)

  useEffect(() => {
    let alive = true;
    fetch('/api/state')
      .then(r => (r.ok ? r.json() : {}))
      .then(s => { if (alive) setReady(!!(s.has_questions && s.has_data)); })
      .catch(() => { if (alive) setReady(false); });
    return () => { alive = false; };
  }, []);

  const gated = ready !== true;

  return (
    <div className="express-banner-wrap">
      <button
        type="button"
        className="express-banner"
        data-testid="express-banner"
        onClick={() => { if (!gated) onOpen(); }}
        disabled={gated}
        aria-disabled={gated || undefined}
        aria-describedby={gated ? 'express-hint' : undefined}
        title={gated ? EXPRESS_GATE_HINT : undefined}
      >
        <span className="express-banner__icon" aria-hidden="true">⚡</span>
        <span className="express-banner__text">
          In a hurry? Upload a template and let AI fill it
        </span>
        <span className="express-banner__arrow" aria-hidden="true">→</span>
      </button>
      {gated && (
        <p id="express-hint" className="express-hint" data-testid="express-hint">
          {EXPRESS_GATE_HINT}
        </p>
      )}
    </div>
  );
}

// The review/approve panel over inferred proposals. Apply & build is disabled
// while any row is needs_attention (drop or re-kind the flagged rows to enable).
function ExpressFlow({ onClose }) {
  const toast = useToast();
  const { run, running } = useRun();
  const { aiReady } = useAiStatus();
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);   // friendly precondition message
  const [rows, setRows] = useState(null);          // null = not inferred yet
  const [applied, setApplied] = useState(false);
  const [resolved, setResolved] = useState(null);
  // The infer endpoint persists the upload and returns a resolvable ref; we carry
  // that into apply so a freshly-uploaded .docx survives the round-trip (XTF-6).
  const [templateRef, setTemplateRef] = useState(null);
  // config.questions feeds the build-options split-by selector (main-table columns).
  const [questions, setQuestions] = useState([]);
  const [buildOpts, setBuildOpts] = useState({});
  useEffect(() => { loadConfig().then(c => setQuestions(c?.questions || [])); }, []);

  const onPick = (e) => {
    setFile(e.target.files?.[0] || null);
    setError(null); setMessage(null); setRows(null); setApplied(false); setTemplateRef(null);
  };

  const infer = async () => {
    if (!file) { toast('Choose a .docx template first', 'err'); return; }
    setLoading(true); setError(null); setMessage(null); setRows(null); setApplied(false);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/template/infer', { method: 'POST', body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(data.detail || `Request failed (${r.status})`);
        window.dispatchEvent(new CustomEvent('databridge:ai-recheck'));
        return;
      }
      if (data.message && !(data.proposals?.length)) {
        setMessage(data.message);
        return;
      }
      setTemplateRef(data.template || null);
      setRows((data.proposals || []).map((p, i) => ({ ...p, _key: `${p.name || 'row'}-${i}` })));
    } catch (err) {
      setError(err.message || 'Network error');
      window.dispatchEvent(new CustomEvent('databridge:ai-recheck'));
    } finally {
      setLoading(false);
    }
  };

  const updateRow = (key, patch) =>
    setRows(rs => rs.map(r => (r._key === key
      // Editing a flagged row's kind/name is the user vouching for it → clear the flag.
      ? { ...r, ...patch, status: 'ok', reason: '' }
      : r)));

  const dropRow = (key) => setRows(rs => rs.filter(r => r._key !== key));

  const flagged = (rows || []).some(r => r.status === 'needs_attention');
  const canApply = rows && rows.length > 0 && !flagged && !applied && !running;

  const applyAndBuild = async (buildOpts = {}) => {
    if (!canApply) return;
    const proposals = rows.map(({ _key, ...p }) => p);  // strip the local key
    try {
      const r = await fetch('/api/template/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposals, template: templateRef || file?.name }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setError(data.detail || 'Apply failed');
        return;
      }
      setResolved(data.template);
      setApplied(true);
      // Chain into the existing build-report run; logs stream into the terminal.
      // Forward the selected split-by / sample-preview options (XTF-13).
      await run('build-report', buildOpts);
    } catch (err) {
      setError(err.message || 'Network error');
    }
  };

  return (
    <div className="form-section">
      <div className="form-section-title">
        Express fill
        <span>AI-assisted</span>
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>← Back to templates</button>
        </div>
      </div>

      <div className="express-flow">
        <div className="express-upload-row">
          <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer' }}>
            ↑ Choose .docx
            <input
              ref={fileRef}
              data-testid="express-upload"
              type="file" accept=".docx"
              style={{ display: 'none' }}
              onChange={onPick}
            />
          </label>
          {file && <span className="express-filename">{file.name}</span>}
          <button
            className="btn btn-primary btn-sm"
            data-testid="express-infer"
            onClick={infer}
            disabled={!aiReady || !file || loading}
            title={aiReady ? undefined : AI_LOCK_TIP}
          >
            {loading ? 'Inferring…' : 'Infer'}
          </button>
        </div>

        {loading && <p className="empty-state" style={{ padding: 12 }}>Reading the template and inferring specs…</p>}

        {message && !loading && (
          <p className="express-message" data-testid="express-message">{message}</p>
        )}

        {error && !loading && (
          <p className="express-error" role="alert">{error}</p>
        )}

        {rows && !loading && rows.length === 0 && (
          <p className="empty-state" style={{ padding: 12 }}>No placeholders to review.</p>
        )}

        {rows && rows.length > 0 && (
          <div className="express-review-panel" data-testid="express-review-panel">
            <div className="express-review-head">
              <span>Placeholder</span><span>Kind</span><span>Name</span><span>Spec</span><span />
            </div>
            {rows.map(row => (
              <div
                key={row._key}
                className="express-row"
                data-testid="express-row"
                data-status={row.status === 'needs_attention' ? 'needs_attention' : 'ok'}
              >
                <div className="express-row__placeholder">
                  <span className="express-row__token">{row.token_label || `Placeholder #${row.token_index ?? '?'}`}</span>
                  <span className="express-row__canonical">{row.name}</span>
                </div>
                <div>
                  <select
                    className="express-row__select"
                    data-testid="express-row-kind"
                    aria-label="Proposed kind"
                    value={row.kind || 'chart'}
                    onChange={e => updateRow(row._key, { kind: e.target.value })}
                  >
                    {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
                <div>
                  <input
                    className="express-row__name"
                    data-testid="express-row-name"
                    aria-label="Canonical name"
                    value={row.name || ''}
                    onChange={e => updateRow(row._key, { name: e.target.value })}
                  />
                </div>
                <div className="express-row__spec" data-testid="express-row-kind-spec">
                  <code>{summariseSpec(row)}</code>
                </div>
                <div className="express-row__actions">
                  <button
                    className="btn btn-danger btn-sm"
                    data-testid="express-row-drop"
                    onClick={() => dropRow(row._key)}
                    title="Drop this placeholder"
                  >Drop</button>
                </div>
                {row.status === 'needs_attention' && row.reason && (
                  <div className="express-row__reason" data-testid="express-row-reason">
                    ⚠ {row.reason}
                  </div>
                )}
              </div>
            ))}

            {!flagged && (
              <BuildOptions
                questions={questions}
                hideTrigger
                disabled={!canApply}
                onChange={setBuildOpts}
              />
            )}

            <div className="express-review-foot">
              {flagged
                ? <span className="express-foot-hint">Resolve or drop the flagged row(s) to continue.</span>
                : <span className="express-foot-hint">All rows look good.</span>}
              <button
                className="btn btn-primary"
                data-testid="express-apply-build"
                onClick={() => applyAndBuild(buildOpts)}
                disabled={!canApply}
                title={flagged ? 'Resolve the flagged rows first' : ''}
              >
                {running ? 'Building…' : 'Apply & build'}
              </button>
            </div>

            {applied && (
              <div className="express-success" data-testid="express-success">
                ✓ Applied {rows.length} placeholder(s){resolved ? ` · resolved ${shortName(resolved)}` : ''}.
                {' '}The report is building — see the <strong>Reports</strong> tab when it finishes.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function summariseSpec(row) {
  const s = row.spec || {};
  if (row.kind === 'chart') return `${s.type || 'chart'} · ${(s.questions || []).join(', ') || '—'}`;
  if (row.kind === 'indicator') return `${s.stat || 'stat'}${s.question ? ` · ${s.question}` : ''}`;
  if (row.kind === 'summary') return s.prompt ? `summary · ${String(s.prompt).slice(0, 40)}` : 'summary';
  return s.type || s.stat || row.kind || '—';
}

function shortName(path) {
  return String(path).split('/').pop();
}

export default function Templates() {
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const { canAdmin } = usePerms();
  const fileInputRef = useRef(null);
  const [files, setFiles] = useState(null);
  const [active, setActive] = useState('');
  const [express, setExpress] = useState(false);

  const load = useCallback(async () => {
    try {
      const [data, activeData] = await Promise.all([
        fetch('/api/templates').then(r => r.json()),
        fetch('/api/templates/active').then(r => r.json()),
      ]);
      setFiles(data.files || []);
      setActive(activeData.active || '');
    } catch (e) { toast(String(e), 'err'); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  // The Dashboard banner deep-links here and asks the express flow to open.
  useEffect(() => {
    const open = () => setExpress(true);
    window.addEventListener('databridge:open-express', open);
    return () => window.removeEventListener('databridge:open-express', open);
  }, []);

  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/templates/upload', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    toast(res.ok ? `Uploaded ${data.name || file.name}` : (data.detail || 'Upload failed'), res.ok ? 'ok' : 'err');
    e.target.value = ''; // reset so re-upload of same file works
    load();
  };

  const setActiveTemplate = async (name) => {
    const res = await fetch(`/api/templates/set-active/${encodeURIComponent(name)}`, { method: 'POST' });
    toast(res.ok ? `Active template: ${name}` : 'Failed to set active', res.ok ? 'ok' : 'err');
    load();
  };

  const deleteTemplate = async (name) => {
    if (!await confirm({ title: 'Delete template?', message: `“${name}” will be permanently deleted. This can’t be undone.` })) return;
    const res = await fetch(`/api/templates/${encodeURIComponent(name)}`, { method: 'DELETE' });
    toast(res.ok ? `Deleted ${name}` : 'Delete failed', res.ok ? 'ok' : 'err');
    load();
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Step 5 of 5 · Templates"
        title="Word"
        accent="templates."
        sub="Manage the .docx templates used by build-report. Each placeholder ({{ chart_x }}, {{ ind_y }}) gets filled at render time."
      />

      <ExpressBanner onOpen={() => setExpress(true)} />

      <div>
        {express && <ExpressFlow onClose={() => setExpress(false)} />}

        <div className="form-section">
          <div className="form-section-title">
            Templates
            <span>{files?.length ?? 0} on disk</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={load}>↺ Refresh</button>
              <label className="btn btn-primary btn-sm"
                     style={{ cursor: canAdmin ? 'pointer' : 'not-allowed', opacity: canAdmin ? 1 : 0.5 }}
                     title={canAdmin ? '' : 'Admin access required to upload templates'}>
                ↑ Upload .docx
                <input
                  ref={fileInputRef}
                  type="file" accept=".docx"
                  disabled={!canAdmin}
                  style={{ display: 'none' }}
                  onChange={upload}
                />
              </label>
            </div>
          </div>

          {files === null && <p className="empty-state" style={{ padding: 12 }}>Loading…</p>}
          {files?.length === 0 && (
            <p className="empty-state" style={{ padding: 16 }}>
              No templates yet — run <b>generate-template</b> from the Dashboard or upload a <code style={{ fontFamily: 'var(--font-mono)' }}>.docx</code>.
            </p>
          )}
          {files?.length > 0 && (
            <FileTable
              columns={[
                { key: 'name', label: 'File', render: f => (
                  <>
                    <span className="file-name">{f.name}</span>
                    {f.name === active && <span className="badge-active">Active</span>}
                  </>
                )},
                { key: 'size_kb', label: 'Size', render: f => <span style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{f.size_kb} KB</span> },
                { key: 'modified', label: 'Modified', render: f => <span style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{f.modified}</span> },
              ]}
              rows={files}
              actions={f => (
                <>
                  {f.name === active ? (
                    <button className="btn btn-ghost btn-sm" disabled style={{ opacity: 0.5 }}>✓ Active</button>
                  ) : (
                    <button className="btn btn-ghost btn-sm" onClick={() => setActiveTemplate(f.name)}
                            disabled={!canAdmin}
                            title={canAdmin ? '' : 'Admin access required'}>Set as active</button>
                  )}
                  <a href={`/api/templates/download/${encodeURIComponent(f.name)}`} download>
                    <button className="btn btn-primary btn-sm">↓ Download</button>
                  </a>
                  <button className="btn btn-danger btn-sm" onClick={() => deleteTemplate(f.name)}
                          disabled={!canAdmin}
                          title={canAdmin ? '' : 'Admin access required to delete templates'}>Delete</button>
                </>
              )}
            />
          )}
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}

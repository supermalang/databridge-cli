import { useCallback, useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import PageHeader from './PageHeader.jsx';
import StageHelp from '../components/StageHelp.jsx';
import FileTable from '../components/FileTable.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { useToast } from '../components/Toast.jsx';
import { usePerms } from '../lib/perms.js';
import { useRun } from '../lib/run.js';
import { useAiStatus, AI_LOCK_TIP } from '../lib/aiStatus.js';
import BuildOptions from '../components/BuildOptions.jsx';
import { loadConfig } from '../lib/config.js';

const KINDS = ['chart', 'indicator', 'summary', 'table', 'narrative', 'metadata'];

// Discoverability banner — present on the Dashboard (Home) and the Templates tab.
// Clicking it opens the express flow. On Home it also navigates to Templates.
//
// Gated on /api/state readiness: inference can't validate proposals without real
// columns, so the banner stays disabled + non-actionable (with an accessible
// hint) until BOTH has_questions AND has_data are true (XTF-9).
export function ExpressBanner({ onOpen }) {
  const { t } = useTranslation();
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
        title={gated ? t('templates.gateHint') : undefined}
      >
        <span className="express-banner__icon" aria-hidden="true">⚡</span>
        <span className="express-banner__text">
          {t('templates.bannerText')}
        </span>
        <span className="express-banner__arrow" aria-hidden="true">→</span>
      </button>
      {gated && (
        <p id="express-hint" className="express-hint" data-testid="express-hint">
          {t('templates.gateHint')}
        </p>
      )}
    </div>
  );
}

// The review/approve panel over inferred proposals. Apply & build is disabled
// while any row is needs_attention (drop or re-kind the flagged rows to enable).
function ExpressFlow({ onClose }) {
  const { t } = useTranslation();
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
    if (!file) { toast(t('templates.chooseFirst'), 'err'); return; }
    setLoading(true); setError(null); setMessage(null); setRows(null); setApplied(false);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/template/infer', { method: 'POST', body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(data.detail || t('templates.requestFailed', { status: r.status }));
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
      setError(err.message || t('templates.networkError'));
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
        setError(data.detail || t('templates.applyFailed'));
        return;
      }
      setResolved(data.template);
      setApplied(true);
      // Chain into the existing build-report run; logs stream into the terminal.
      // Forward the selected split-by / sample-preview options (XTF-13).
      await run('build-report', buildOpts);
    } catch (err) {
      setError(err.message || t('templates.networkError'));
    }
  };

  return (
    <div className="form-section">
      <div className="form-section-title">
        {t('templates.expressFill')}
        <span>{t('templates.aiAssisted')}</span>
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>{t('templates.backToTemplates')}</button>
        </div>
      </div>

      <div className="express-flow">
        <div className="express-upload-row">
          <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer' }}>
            {t('templates.chooseDocx')}
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
            {loading ? t('templates.inferring') : t('templates.infer')}
          </button>
        </div>

        {loading && <p className="empty-state" style={{ padding: 12 }}>{t('templates.readingTemplate')}</p>}

        {message && !loading && (
          <p className="express-message" data-testid="express-message">{message}</p>
        )}

        {error && !loading && (
          <p className="express-error" role="alert">{error}</p>
        )}

        {rows && !loading && rows.length === 0 && (
          <p className="empty-state" style={{ padding: 12 }}>{t('templates.noPlaceholders')}</p>
        )}

        {rows && rows.length > 0 && (
          <div className="express-review-panel" data-testid="express-review-panel">
            <div className="express-review-head">
              <span>{t('templates.colPlaceholder')}</span><span>{t('templates.colKind')}</span><span>{t('templates.colName')}</span><span>{t('templates.colSpec')}</span><span />
            </div>
            {rows.map(row => (
              <div
                key={row._key}
                className="express-row"
                data-testid="express-row"
                data-status={row.status === 'needs_attention' ? 'needs_attention' : 'ok'}
              >
                <div className="express-row__placeholder">
                  <span className="express-row__token">{row.token_label || t('templates.placeholderN', { n: row.token_index ?? '?' })}</span>
                  <span className="express-row__canonical">{row.name}</span>
                </div>
                <div>
                  <select
                    className="express-row__select"
                    data-testid="express-row-kind"
                    aria-label={t('templates.proposedKind')}
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
                    aria-label={t('templates.canonicalName')}
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
                    title={t('templates.dropPlaceholder')}
                  >{t('templates.drop')}</button>
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
                ? <span className="express-foot-hint">{t('templates.resolveFlagged')}</span>
                : <span className="express-foot-hint">{t('templates.allRowsGood')}</span>}
              <button
                className="btn btn-primary"
                data-testid="express-apply-build"
                onClick={() => applyAndBuild(buildOpts)}
                disabled={!canApply}
                title={flagged ? t('templates.resolveFirst') : ''}
              >
                {running ? t('templates.building') : t('templates.applyBuild')}
              </button>
            </div>

            {applied && (
              <div className="express-success" data-testid="express-success">
                {t('templates.appliedCount', { count: rows.length })}{resolved ? t('templates.resolvedSuffix', { name: shortName(resolved) }) : ''}.
                {' '}<Trans i18nKey="templates.reportBuilding" components={{ s: <strong /> }} />
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
  const { t } = useTranslation();
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
    toast(res.ok ? t('templates.uploaded', { name: data.name || file.name }) : (data.detail || t('templates.uploadFailed')), res.ok ? 'ok' : 'err');
    e.target.value = ''; // reset so re-upload of same file works
    load();
  };

  const setActiveTemplate = async (name) => {
    const res = await fetch(`/api/templates/set-active/${encodeURIComponent(name)}`, { method: 'POST' });
    toast(res.ok ? t('templates.activeTemplate', { name }) : t('templates.failedSetActive'), res.ok ? 'ok' : 'err');
    load();
  };

  const deleteTemplate = async (name) => {
    if (!await confirm({ title: t('templates.deleteTitle'), message: t('templates.deleteMessage', { name }) })) return;
    const res = await fetch(`/api/templates/${encodeURIComponent(name)}`, { method: 'DELETE' });
    toast(res.ok ? t('templates.deleted', { name }) : t('templates.deleteFailed'), res.ok ? 'ok' : 'err');
    load();
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow={t('templates.eyebrow')}
        title={t('templates.title')}
        accent={t('templates.accent')}
        sub={<>{t('templates.subPre')}{'{{ chart_x }}, {{ ind_y }}'}{t('templates.subPost')}</>}
      />

      <StageHelp
        title={t('templates.helpTitle')}
        hint={t('templates.helpHint')}
        body={
          <>
            <p><Trans i18nKey="templates.helpBody1" components={{ b: <b />, c1: <code>{'{{ chart_1 }}'}</code>, c2: <code>{'{{ ind_coverage }}'}</code> }} /></p>
            <p><Trans i18nKey="templates.helpBody2" components={{ b: <b /> }} /></p>
          </>
        }
        docsHref="docs/reference/templates.md"
        docsLabel={t('templates.helpDocsLabel')}
      />

      <ExpressBanner onOpen={() => setExpress(true)} />

      <div>
        {express && <ExpressFlow onClose={() => setExpress(false)} />}

        <div className="form-section">
          <div className="form-section-title">
            {t('templates.listTitle')}
            <span>{t('templates.onDisk', { count: files?.length ?? 0 })}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={load}>{t('common.refresh')}</button>
              <label className="btn btn-primary btn-sm"
                     style={{ cursor: canAdmin ? 'pointer' : 'not-allowed', opacity: canAdmin ? 1 : 0.5 }}
                     title={canAdmin ? '' : t('templates.uploadAdminRequired')}>
                {t('templates.uploadDocx')}
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

          {files === null && <p className="empty-state" style={{ padding: 12 }}>{t('common.loading')}</p>}
          {files?.length === 0 && (
            <p className="empty-state" style={{ padding: 16 }}>
              <Trans i18nKey="templates.noTemplates" components={{ b: <b />, c: <code style={{ fontFamily: 'var(--font-mono)' }} /> }} />
            </p>
          )}
          {files?.length > 0 && (
            <FileTable
              columns={[
                { key: 'name', label: t('templates.fileCol'), render: f => (
                  <>
                    <span className="file-name">{f.name}</span>
                    {f.name === active && <span className="badge-active">{t('templates.activeBadge')}</span>}
                  </>
                )},
                { key: 'size_kb', label: t('templates.sizeCol'), render: f => <span style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{f.size_kb} KB</span> },
                { key: 'modified', label: t('templates.modifiedCol'), render: f => <span style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{f.modified}</span> },
              ]}
              rows={files}
              actions={f => (
                <>
                  {f.name === active ? (
                    <button className="btn btn-ghost btn-sm" disabled style={{ opacity: 0.5 }}>{t('templates.activeAction')}</button>
                  ) : (
                    <button className="btn btn-ghost btn-sm" onClick={() => setActiveTemplate(f.name)}
                            disabled={!canAdmin}
                            title={canAdmin ? '' : t('templates.adminRequired')}>{t('templates.setActive')}</button>
                  )}
                  <a href={`/api/templates/download/${encodeURIComponent(f.name)}`} download>
                    <button className="btn btn-primary btn-sm">{t('templates.download')}</button>
                  </a>
                  <button className="btn btn-danger btn-sm" onClick={() => deleteTemplate(f.name)}
                          disabled={!canAdmin}
                          title={canAdmin ? '' : t('templates.deleteAdminRequired')}>{t('common.delete')}</button>
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

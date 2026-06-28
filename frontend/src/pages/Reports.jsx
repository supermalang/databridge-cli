import { useCallback, useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import PageHeader from './PageHeader.jsx';
import StageHelp from '../components/StageHelp.jsx';
import FileTable from '../components/FileTable.jsx';
import { SkeletonList } from '../components/Skeleton.jsx';
import Modal from '../components/Modal.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { useToast } from '../components/Toast.jsx';
import { usePerms } from '../lib/perms.js';
import { useRun } from '../lib/run.js';
import { RailLayout, StatusCard, QuickActionsCard, RailIcons } from '../components/Rail.jsx';
import { loadConfig } from '../lib/config.js';
import { swr } from '../lib/cache.js';
import BuildOptions from '../components/BuildOptions.jsx';

export default function Reports() {
  const { t } = useTranslation();
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

  // All three are non-sensitive metadata on the persist whitelist (PERF-4), so a
  // hard reload paints the last-known list instantly while it revalidates.
  const loadReports = useCallback(async () => {
    try {
      await swr('/api/reports', async () => (await (await fetch('/api/reports')).json()),
        (data) => setReports(data.files || []));
    } catch (e) { toast(String(e), 'err'); }
  }, [toast]);

  const loadSessions = useCallback(async () => {
    try {
      await swr('/api/data/sessions', async () => (await (await fetch('/api/data/sessions')).json()),
        (data) => setSessions(data.sessions || []));
    } catch { setSessions([]); }
  }, []);

  const loadTemplates = useCallback(async () => {
    try {
      await swr('/api/templates', async () => (await (await fetch('/api/templates')).json()),
        (data) => setTemplates(data.files || []));
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
  const buildTitle = !canEdit ? t('reports.editorRequired')
    : buildReady ? t('reports.buildReadyTitle')
    : t('reports.buildNeeds', { missing: buildMissing.join(', ') });

  // Fetch registry periods when Compare modal opens
  useEffect(() => {
    if (!showCompare) return;
    (async () => {
      try {
        const res = await fetch('/api/periods');
        if (!res.ok) { setPeriods([]); return; }
        const d = await res.json();
        setPeriods(d.registry || []);
      } catch { setPeriods([]); }
    })();
  }, [showCompare]);

  const deleteReport = async (name) => {
    if (!await confirm({ title: t('reports.deleteReportTitle'), message: t('reports.deleteReportMessage', { name }) })) return;
    const res = await fetch(`/api/reports/${encodeURIComponent(name)}`, { method: 'DELETE' });
    toast(res.ok ? t('reports.deletedReport', { name }) : t('reports.deleteFailed'), res.ok ? 'ok' : 'err');
    loadReports();
  };

  const deleteAllReports = async () => {
    if (!await confirm({
      title: t('reports.deleteAllTitle'),
      message: t('reports.deleteAllMessage'),
      confirmLabel: t('common.deleteAll'),
    })) return;
    const res = await fetch('/api/reports', { method: 'DELETE' });
    toast(res.ok ? t('reports.deletedAll') : t('reports.deleteFailed'), res.ok ? 'ok' : 'err');
    loadReports();
  };

  const deleteSession = async (sid) => {
    if (!await confirm({ title: t('reports.deleteSessionTitle'), message: t('reports.deleteSessionMessage', { sid }) })) return;
    const res = await fetch(`/api/data/sessions/${encodeURIComponent(sid)}`, { method: 'DELETE' });
    toast(res.ok ? t('reports.deletedSession', { sid }) : t('reports.deleteFailed'), res.ok ? 'ok' : 'err');
    loadSessions();
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow={t('reports.eyebrow')}
        title={t('reports.title')}
        accent={t('reports.accent')}
        sub={t('reports.sub')}
      />
      <StageHelp
        title={t('reports.helpTitle')}
        hint={t('reports.helpHint')}
        body={
          <>
            <p><Trans i18nKey="reports.helpBody1" components={{ b: <b /> }} /></p>
            <p><Trans i18nKey="reports.helpBody2" components={{ b: <b /> }} /></p>
          </>
        }
        docsHref="docs/reference/templates.md"
        docsLabel={t('reports.helpDocsLabel')}
      />
      <RailLayout rail={
        <>
          <StatusCard checks={[
            { tone: reports?.length ? 'ok' : 'warn',
              label: t('reports.reportsGenerated', { count: reports?.length || 0 }),
              sub: reports?.length ? t('reports.readyToDownload') : t('reports.runBuildToCreate') },
            { tone: sessions?.length ? 'ok' : 'warn',
              label: t('reports.dataSessions', { count: sessions?.length || 0 }),
              sub: sessions?.length ? t('reports.availableToBuild') : t('reports.runDownloadFirst') },
          ]} />
          <QuickActionsCard actions={[
            { icon: RailIcons.copy, label: t('reports.comparePeriods'), onClick: () => { setSelected([]); setShowCompare(true); },
              title: t('reports.comparePeriodsTitle') },
          ]} />
        </>
      }>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* ─── Build ─── */}
        <div className="form-section">
          <div className="form-section-title">
            {t('reports.buildTitle')}
            <span>{t('reports.buildSubtitle')}</span>
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
            {t('reports.reportsTitle')}
            <span>{t('reports.reportsSubtitle')}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => { setSelected([]); setShowCompare(true); }}>
                {t('reports.comparePeriods')}
              </button>
              {reports?.length > 0 && (
                <button
                  className="btn btn-danger btn-sm"
                  data-testid="reports-delete-all"
                  onClick={deleteAllReports}
                  disabled={!canEdit}
                  title={canEdit ? t('reports.deleteAllReportsTitle') : t('reports.viewerDeleteTitle')}>
                  {t('reports.deleteAllReports')}
                </button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={loadReports}>{t('common.refresh')}</button>
            </div>
          </div>
          {reports === null && <SkeletonList rows={3} rowHeight={40} label={t('common.loading')} />}
          {reports?.length === 0 && <p className="empty-state" style={{ padding: 12 }}><Trans i18nKey="reports.noReportsYet" components={{ b: <b /> }} /></p>}
          {reports?.length > 1 && (
            <a
              className="btn btn-primary btn-sm"
              href="/api/reports/download-zip"
              download="reports.zip"
              aria-label={t('reports.downloadAllAria', { count: reports.length })}
              style={{ marginBottom: 12 }}>
              {t('reports.downloadAllZip', { count: reports.length })}
            </a>
          )}
          {reports?.length > 0 && (
            <FileTable
              columns={[
                { key: 'name', label: t('reports.colFile'), render: r => <span className="file-name">{r.name}</span> },
                { key: 'size_kb', label: t('reports.colSize'), render: r => <span style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{r.size_kb} KB</span> },
                { key: 'modified', label: t('reports.colGenerated'), render: r => <span style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{r.modified}</span> },
              ]}
              rows={reports}
              actions={r => (
                <>
                  <a
                    className="btn btn-primary btn-sm"
                    href={`/api/reports/download/${encodeURIComponent(r.name)}`}
                    download
                    aria-label={t('reports.downloadAria', { name: r.name })}>
                    {t('reports.download')}
                  </a>
                  <button className="btn btn-danger btn-sm" onClick={() => deleteReport(r.name)}
                          disabled={!canEdit}
                          title={canEdit ? '' : t('reports.viewerDeleteTitle')}>{t('common.delete')}</button>
                </>
              )}
            />
          )}
        </div>

        {/* ─── Data sessions ─── */}
        <div className="form-section">
          <div className="form-section-title">
            {t('reports.dataFilesTitle')}
            <span>{t('reports.dataFilesSubtitlePre')}<code style={{ fontFamily: 'var(--font-mono)' }}>download</code>{t('reports.dataFilesSubtitlePost')}</span>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={loadSessions}>{t('common.refresh')}</button>
          </div>
          {sessions === null && <SkeletonList rows={3} rowHeight={40} label={t('common.loading')} />}
          {sessions?.length === 0 && <p className="empty-state" style={{ padding: 12 }}><Trans i18nKey="reports.noDataFilesYet" components={{ b: <b /> }} /></p>}
          {sessions?.length > 0 && (
            <FileTable
              columns={[
                { key: 'label', label: t('reports.colSession'), render: (s, i) => (
                  <span className="file-name">
                    {s.label}
                    {sessions.indexOf(s) === 0 && <span style={{ fontSize: 10, color: 'var(--accent)', marginLeft: 8 }}>{t('reports.latest')}</span>}
                  </span>
                )},
                { key: 'files', label: t('reports.colFiles'), render: s => <span style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{s.files.length} file{s.files.length !== 1 ? 's' : ''}</span> },
              ]}
              rows={sessions}
              actions={s => (
                <>
                  <a
                    className="btn btn-primary btn-sm"
                    href={`/api/data/sessions/${encodeURIComponent(s.session_id)}/download`}
                    download
                    aria-label={t('reports.downloadSessionAria', { label: s.label })}>
                    {t('reports.downloadZip')}
                  </a>
                  <button className="btn btn-danger btn-sm" onClick={() => deleteSession(s.session_id)}
                          disabled={!canEdit}
                          title={canEdit ? '' : t('reports.viewerDeleteTitle')}>{t('common.delete')}</button>
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
          title={t('reports.compareModalTitle')}
          onClose={() => setShowCompare(false)}
          onSave={async () => {
            if (selected.length < 2) {
              toast(t('reports.pickAtLeastTwo'), 'err');
              return;
            }
            setShowCompare(false);
            try {
              const r = await fetch('/api/run/build-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ compare: selected.join(',') }),
              });
              if (!r.ok) { toast(t('reports.buildFailed', { status: r.status }), 'err'); return; }
              toast(t('reports.buildingComparison', { periods: selected.join(' vs ') }), 'ok');
              // Reload reports after a delay so the new docx shows up
              setTimeout(loadReports, 3000);
            } catch (e) { toast(e.message || t('reports.networkError'), 'err'); }
          }}
          saveLabel={t('reports.buildComparison')}
          width={520}
        >
          <div style={{ maxHeight: 300, overflow: 'auto' }}>
            <p style={{ color: 'var(--ink-3)', fontSize: 13, marginBottom: 12 }}>{t('reports.pickPeriods')}</p>
            {periods.length === 0 && <p style={{ color: 'var(--ink-3)' }}>{t('reports.noPeriods')}</p>}
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

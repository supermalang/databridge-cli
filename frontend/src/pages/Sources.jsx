import { useCallback, useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import yaml from 'js-yaml';
import { useToast } from '../components/Toast.jsx';
import { loadConfig, loadConfigText, saveConfigPatch, saveConfigText } from '../lib/config.js';
import PageHeader from './PageHeader.jsx';
import StageHelp from '../components/StageHelp.jsx';
import { useRun } from '../lib/run.js';
import { usePerms } from '../lib/perms.js';
import { useAiStatus } from '../lib/aiStatus.js';
import { useUnsavedGuard } from '../hooks/useUnsavedGuard.js';
import { RailLayout, StatusCard } from '../components/Rail.jsx';

const PLATFORMS = [
  { id: 'ona',  name: 'Ona / INFORM', tag: 'ona.io · UNICEF INFORM',        defaultUrl: 'https://api.ona.io/api/v1' },
  { id: 'kobo', name: 'Kobo Toolbox', tag: 'kobotoolbox.org · KPI',         defaultUrl: 'https://kf.kobotoolbox.org/api/v2' },
];

// AI provider presets. Every entry maps to one of the two backends the CLI
// understands (`backend`: openai | anthropic) — the OpenAI-compatible ones just
// differ by base URL + suggested models. A "Custom…" model escape always stays
// available, so stale model lists never block anyone.
const AI_PROVIDERS = [
  { id: 'openai',     name: 'OpenAI',            backend: 'openai',    baseUrl: '',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o3', 'o4-mini'] },
  { id: 'anthropic',  name: 'Anthropic',         backend: 'anthropic', baseUrl: '',
    models: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'] },
  { id: 'gemini',     name: 'Google Gemini',     backend: 'openai',    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'] },
  { id: 'openrouter', name: 'OpenRouter',        backend: 'openai',    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['anthropic/claude-sonnet-4-6', 'openai/gpt-4o', 'google/gemini-2.5-pro', 'meta-llama/llama-3.3-70b-instruct', 'deepseek/deepseek-chat'] },
  { id: 'groq',       name: 'Groq',              backend: 'openai',    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it'] },
  { id: 'deepseek',   name: 'DeepSeek',          backend: 'openai',    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'mistral',    name: 'Mistral',           backend: 'openai',    baseUrl: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest', 'mistral-small-latest'] },
  { id: 'ollama',     name: 'Ollama (local)',    backend: 'openai',    baseUrl: 'http://localhost:11434/v1',
    models: ['llama3.1', 'llama3.2', 'qwen2.5', 'mistral'] },
  { id: 'custom',     name: 'Custom (OpenAI-compatible)', backend: 'openai', baseUrl: '', models: [] },
];

const _normUrl = (u) => (u || '').trim().replace(/\/+$/, '');

// Map a stored config (provider + base_url) back to a preset id for the dropdown.
function detectAiPreset(ai) {
  const backend = (ai.provider || 'openai').toLowerCase();
  if (backend === 'anthropic') return 'anthropic';
  const base = _normUrl(ai.base_url);
  if (!base) return 'openai';
  const hit = AI_PROVIDERS.find(p => p.backend === 'openai' && p.baseUrl && _normUrl(p.baseUrl) === base);
  return hit ? hit.id : 'custom';
}

// CSV + XLSX ship today (they set the format of the data files shown on the
// Reports tab); JSON + database exports are on the roadmap (see docs/ROADMAP.md) and
// render as disabled "soon" chips.
const FORMATS = [
  { id: 'csv',      label: 'CSV',  sub: 'flat' },
  { id: 'xlsx',     label: 'XLSX', sub: 'sheets' },
  { id: 'json',     label: 'JSON', sub: 'array' },
  { id: 'mysql',    label: 'MySQL',              sub: 'table' },
  { id: 'postgres', label: 'PostgreSQL',         sub: 'table' },
];

export default function Sources({ section = 'setup' } = {}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [cfg,      setCfg]      = useState(null);
  const [original, setOriginal] = useState(null);
  const [yamlText, setYamlText] = useState('');
  const [view,     setView]     = useState('form');
  const [showToken,setShowToken]= useState(false);
  const [questionCount, setQuestionCount] = useState(0);
  const [lastCheck, setLastCheck] = useState(null);

  const reload = useCallback(async () => {
    const c = await loadConfig();
    setCfg(c);
    setOriginal(yaml.dump(c, { indent: 2, lineWidth: -1 }));
    setYamlText(await loadConfigText());
    try {
      const d = await (await fetch('/api/questions')).json();
      setQuestionCount(d.questions?.length || 0);
    } catch {}
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const dirty = cfg && original && yaml.dump(cfg, { indent: 2, lineWidth: -1 }) !== original;
  useUnsavedGuard(!!dirty);

  // ── mutators bind directly to the top-level cfg object ───────────────────
  const set = (path) => (value) => setCfg(prev => {
    const next = structuredClone(prev || {});
    const keys = path.split('.');
    let obj = next;
    for (let i = 0; i < keys.length - 1; i++) {
      if (typeof obj[keys[i]] !== 'object' || obj[keys[i]] === null) obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    obj[keys.at(-1)] = value;
    return next;
  });

  const saveAll = async () => {
    if (!cfg) return;
    try {
      const text = yaml.dump(cfg, { indent: 2, lineWidth: -1 });
      await saveConfigText(text);
      setOriginal(text);
      setYamlText(text);
      // Re-check AI status: saving may make a just-tested config the saved one,
      // which unlocks the AI buttons without a manual page refresh.
      window.dispatchEvent(new CustomEvent('databridge:data-changed', { detail: { source: 'sources' } }));
      toast(t('common.saved'), 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };

  const saveYaml = async () => {
    try {
      await saveConfigText(yamlText);
      window.dispatchEvent(new CustomEvent('databridge:data-changed', { detail: { source: 'sources' } }));
      toast(t('common.saved'), 'ok'); reload();
    }
    catch (e) { toast(e.message, 'err'); }
  };

  const platform = cfg?.api?.platform ||
    (cfg?.api?.url?.includes('ona') ? 'ona' : 'kobo');

  const testConnection = async () => {
    setLastCheck({ status: 'pending' });
    try {
      const resp = await fetch('/api/sources/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          url: cfg?.api?.url || '',
          token: cfg?.api?.token || '',
          form_uid: cfg?.form?.uid || '',
        }),
      });
      const r = await resp.json();
      setLastCheck({
        status: r.ok ? 'ok' : 'err',
        time: new Date().toLocaleTimeString().slice(0, 5),
        msg: r.message || (r.ok ? 'Connected' : 'Connection failed'),
        fields: r.fields,
      });
    } catch (e) {
      setLastCheck({
        status: 'err',
        time: new Date().toLocaleTimeString().slice(0, 5),
        msg: `Request failed: ${e.message || e}`,
      });
    }
  };

  // ── early states ─────────────────────────────────────────────────────────
  if (cfg === null) return <div className="page"><p className="empty-state">{t('sources.loadingConfig')}</p></div>;

  // ── render ───────────────────────────────────────────────────────────────
  // The "output" section lives under the Deliver stage; setup + ai are Extract.
  const header = section === 'output'
    ? { eyebrow: t('sources.outputEyebrow'), title: t('sources.outputTitle'), accent: t('sources.outputAccent'),
        sub: t('sources.outputSub') }
    : { eyebrow: t('sources.setupEyebrow'), title: t('sources.setupTitle'), accent: t('sources.setupAccent'),
        sub: t('sources.setupSub') };

  return (
    <div className="page">
      <PageHeader
        eyebrow={header.eyebrow}
        title={header.title}
        accent={header.accent}
        sub={header.sub}
        actions={
          <>
            {section !== 'output' && (
              <div className="config-view-toggle">
                <button className={`view-btn ${view === 'form' ? 'active' : ''}`} onClick={() => setView('form')}>{t('sources.viewForm')}</button>
                <button className={`view-btn ${view === 'yaml' ? 'active' : ''}`} onClick={() => setView('yaml')}>{t('sources.viewYaml')}</button>
              </div>
            )}
            <button className={`btn ${dirty ? 'btn-primary' : ''}`} onClick={view === 'yaml' ? saveYaml : saveAll} disabled={view === 'form' && !dirty}>
              {t('common.saveChanges')}
            </button>
          </>
        }
      />

      {section === 'output' ? (
        <StageHelp
          title={t('sources.outputHelpTitle')}
          hint={t('sources.outputHelpHint')}
          body={
            <>
              <p>{t('sources.outputHelpBody1')}</p>
              <p>{t('sources.outputHelpBody2')}</p>
            </>
          }
          docsHref="docs/reference/config.md"
          docsLabel={t('sources.outputHelpDocsLabel')}
        />
      ) : (
        <StageHelp
          title={t('sources.setupHelpTitle')}
          hint={t('sources.setupHelpHint')}
          body={
            <>
              <p>{t('sources.setupHelpBody1')}</p>
              <p>{t('sources.setupHelpBody2')}</p>
            </>
          }
          docsHref="docs/reference/config.md"
          docsLabel={t('sources.setupHelpDocsLabel')}
        />
      )}

      {view === 'yaml' ? (
        <div className="src-card">
          <textarea
            aria-label={t('sources.yamlEditorAria')}
            spellCheck={false}
            value={yamlText}
            onChange={e => setYamlText(e.target.value)}
            style={{
              width: '100%', minHeight: 480,
              background: 'var(--slate-dark)', color: '#E6EAF2',
              border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
              padding: 16, fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.6,
              resize: 'vertical', outline: 'none',
            }}
          />
        </div>
      ) : section === 'output' ? (
        <RailLayout rail={<OutputRail cfg={cfg} />}>
          <OutputCard cfg={cfg} set={set} />
        </RailLayout>
      ) : section === 'ai' ? (
        <RailLayout rail={<ExtractRail cfg={cfg} questionCount={questionCount} lastCheck={lastCheck}  />}>
          <AINarrativeCard cfg={cfg} set={set} />
        </RailLayout>
      ) : (
        <RailLayout rail={<ExtractRail cfg={cfg} questionCount={questionCount} lastCheck={lastCheck}  />}>
          <ConnectionCard
            cfg={cfg} set={set} platform={platform}
            showToken={showToken} setShowToken={setShowToken}
            testConnection={testConnection} lastCheck={lastCheck}
            clearCheck={() => setLastCheck(null)}
            questionCount={questionCount}
          />
        </RailLayout>
      )}
    </div>
  );
}

// ── Right rail (Extract): Status · Tips ───────────────────────────────────────
function ExtractRail({ cfg, questionCount, lastCheck }) {
  const { t } = useTranslation();
  return (
    <>
      <StatusCard checks={sourceChecks(t, cfg, questionCount, lastCheck)} />
      <TipsRailCard />
    </>
  );
}

// ── Right rail (Deliver → Output): Status ─────────────────────────────────────
function OutputRail({ cfg }) {
  const period = cfg.periods?.current || '';
  const exp = cfg.export || {};
  const fmt = exp.format || 'csv';
  const db = exp.database || {};
  const isSql = fmt === 'mysql' || fmt === 'postgres';
  const dbReady = isSql ? !!(db.host && db.name) : true;
  const checks = [
    { tone: 'ok', label: `Export format: ${fmt.toUpperCase()}`,
      sub: isSql ? 'writes to a database' : 'data files on the Reports tab' },
    isSql && { tone: dbReady ? 'ok' : 'warn',
      label: dbReady ? 'Destination configured' : 'Destination incomplete',
      sub: dbReady ? 'database credentials set' : 'add connection credentials' },
    { tone: period ? 'ok' : 'warn',
      label: period ? `Period: ${period}` : 'No reporting period',
      sub: period ? 'reports filter to this window' : 'all submissions included' },
  ].filter(Boolean);
  return (
    <>
      <StatusCard checks={checks} />
    </>
  );
}

// ── Connection ───────────────────────────────────────────────────────────────
function ConnectionCard({ cfg, set, platform, showToken, setShowToken, testConnection, lastCheck, clearCheck, questionCount }) {
  const { t } = useTranslation();
  const { run, running, activeCmd } = useRun();
  const { canEdit } = usePerms();
  const toast = useToast();
  const [loadingSample, setLoadingSample] = useState(false);
  const fetchQuestions = () => run('fetch-questions');
  const downloadData = () => run('download');

  // PUX-7 — Fetch/Download are destructive/expensive and need a *working form*
  // connection. "Confirmed working" = the most recent Test connection this
  // session returned ok AND counted a positive number of form fields (so a
  // token-valid-but-no/invalid-Form-UID test does NOT qualify — both Fetch and
  // Download need the form). Editing any connection field stales this (clearCheck).
  const connectionConfirmed = lastCheck?.status === 'ok' && Number(lastCheck?.fields) > 0;

  // Wrap a connection-field setter so editing it clears a stale confirmation:
  // a previously-confirmed status must not keep Fetch/Download enabled after the
  // platform / URL / token / Form UID changes.
  const setConn = (path) => (value) => { clearCheck?.(); set(path)(value); };

  // No-credentials sample path (PUX-5): load the bundled synthetic dataset into the
  // active project so the downstream stages have real columns + rows without a token
  // or an AI key. On success, dispatch the existing data-changed event so App.jsx
  // refetches /api/state and the app advances into the data-present state.
  const tryWithSampleData = async () => {
    if (loadingSample) return;
    setLoadingSample(true);
    // Show the "Loading sample…" feedback before the request goes out so the
    // click gives immediate, visible acknowledgement on slower links.
    await new Promise((r) => setTimeout(r, 60));
    try {
      const resp = await fetch('/api/sample-data', { method: 'POST' });
      if (!resp.ok) {
        let msg = t('sources.sampleError');
        try { const j = await resp.json(); if (j?.detail) msg = j.detail; } catch {}
        throw new Error(msg);
      }
      window.dispatchEvent(new CustomEvent('databridge:data-changed', { detail: { source: 'sample-data' } }));
      toast(t('sources.sampleLoaded'), 'ok');
    } catch (e) {
      toast(e.message || t('sources.sampleError'), 'err');
    } finally {
      setLoadingSample(false);
    }
  };
  const onPick = (id) => {
    clearCheck?.();   // platform is a connection field — stale any confirmation
    set('api.platform')(id);
    // also seed the URL if blank
    if (!cfg.api?.url) set('api.url')(PLATFORMS.find(p => p.id === id).defaultUrl);
  };
  const copyToken = async () => {
    if (cfg.api?.token) {
      try { await navigator.clipboard.writeText(cfg.api.token); } catch {}
    }
  };

  // ── token visibility ─────────────────────────────────────────────────────
  // A saved secret is never re-displayed: the field shows a static mask until
  // the user explicitly chooses to replace it. An env: reference is not secret,
  // so we show its variable name plainly. While entering a new token the field
  // is a password input the user can optionally reveal.
  const [editingToken, setEditingToken] = useState(false);
  const [prevToken, setPrevToken] = useState('');
  const savedToken = cfg.api?.token || '';
  const isEnvToken = savedToken.startsWith('env:');
  const tokenInputMode = editingToken || !savedToken;

  // A successful save clears edit mode → the secret collapses back to its mask.
  useEffect(() => {
    const onSaved = () => { setEditingToken(false); setShowToken(false); };
    window.addEventListener('databridge:data-changed', onSaved);
    return () => window.removeEventListener('databridge:data-changed', onSaved);
  }, [setShowToken]);

  const beginReplaceSecret = () => {
    setPrevToken(savedToken); set('api.token')(''); setShowToken(false); setEditingToken(true);
  };
  const beginEditEnv = () => {
    setPrevToken(savedToken); setShowToken(true); setEditingToken(true);
  };
  const cancelTokenEdit = () => {
    set('api.token')(prevToken); setEditingToken(false); setShowToken(false);
  };
  return (
    <div className="src-card">
      <div className="src-card__head">
        <div>
          <div className="src-card__title">{t('sources.connectionTitle')}</div>
          <div className="src-card__sub">{t('sources.connectionSub')}</div>
        </div>
      </div>

      <div className="src-field">
        <div className="src-field__label">
          {t('sources.platform')}
          <div className="src-field__hint">{t('sources.platformHint')}</div>
        </div>
        <div className="platform-pick">
          {PLATFORMS.map(p => (
            <button
              key={p.id}
              type="button"
              className="platform-card"
              data-selected={platform === p.id}
              aria-pressed={platform === p.id}
              onClick={() => onPick(p.id)}
            >
              <div className="platform-card__logo">{p.name[0]}</div>
              <div>
                <div className="platform-card__name">{p.name}</div>
                <div className="platform-card__sub">{p.tag}</div>
              </div>
              {platform === p.id && <span className="platform-card__check">✓</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="src-field">
        <div className="src-field__label">{t('sources.apiBaseUrl')}
          <div className="src-field__hint">{t('sources.apiBaseUrlHint')}</div>
        </div>
        <input
          aria-label={t('sources.apiBaseUrl')}
          className="src-input src-input--mono"
          value={cfg.api?.url || ''}
          placeholder={PLATFORMS.find(p => p.id === platform)?.defaultUrl}
          onChange={e => setConn('api.url')(e.target.value)}
        />
      </div>

      <div className="src-field">
        <div className="src-field__label">{t('sources.apiToken')}
          <div className="src-field__hint"><Trans i18nKey="sources.apiTokenHint" components={{ c: <code /> }} /></div>
        </div>

        {tokenInputMode ? (
          <>
            <div className="token-field">
              <input
                aria-label={t('sources.apiToken')}
                type={showToken ? 'text' : 'password'}
                value={cfg.api?.token || ''}
                placeholder={t('sources.tokenPlaceholder')}
                autoComplete="off"
                onChange={e => setConn('api.token')(e.target.value)}
              />
              <button title={showToken ? t('sources.hide') : t('sources.show')} onClick={() => setShowToken(s => !s)}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/>
                </svg>
              </button>
              <button title={t('sources.copy')} onClick={copyToken}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="5" width="8" height="9" rx="1.5"/><path d="M3 11V3a1 1 0 0 1 1-1h7"/></svg>
              </button>
            </div>
            {editingToken && (
              <button className="btn btn-sm token-cancel" onClick={cancelTokenEdit}>{t('common.cancel')}</button>
            )}
          </>
        ) : isEnvToken ? (
          <div className="token-saved">
            <code className="token-saved__env">{savedToken}</code>
            <span className="token-saved__tag">{t('sources.envVar')}</span>
            <button className="btn btn-sm" onClick={beginEditEnv}>{t('sources.edit')}</button>
          </div>
        ) : (
          <div className="token-saved">
            <span className="token-saved__mask">••••••••••••</span>
            <span className="token-saved__tag">{t('sources.saved')}</span>
            <button className="btn btn-sm" onClick={beginReplaceSecret}>{t('sources.replace')}</button>
          </div>
        )}
      </div>

      <div className="src-field">
        <div className="src-field__label">{t('sources.formUid')}
          <div className="src-field__hint">{t('sources.formUidHint', { platform: platform === 'ona' ? 'Ona / INFORM' : 'Kobo' })}</div>
        </div>
        <input aria-label={t('sources.formUid')} className="src-input src-input--mono" value={cfg.form?.uid || ''} placeholder="aAbBcCdDeEfFgGhH" onChange={e => setConn('form.uid')(e.target.value)} />
      </div>

      <div className="src-field">
        <div className="src-field__label">{t('sources.alias')}
          <div className="src-field__hint">{t('sources.aliasHint')}</div>
        </div>
        <input aria-label={t('sources.alias')} className="src-input src-input--mono" value={cfg.form?.alias || ''} placeholder="monitoring_survey" onChange={e => set('form.alias')(e.target.value)} />
      </div>

      <div className="src-field">
        <div className="src-field__label" />
        <div className="inline-status">
          <button className="btn btn-primary btn-sm" onClick={testConnection}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="3 8 7 12 13 4"/></svg>
            {t('sources.testConnection')}
          </button>
          {lastCheck && lastCheck.status === 'pending' && <span className="inline-status__check">{t('sources.checking')}</span>}
          {lastCheck && lastCheck.status === 'ok' && (
            <span className="inline-status__check"><Trans i18nKey="sources.lastCheck" values={{ time: lastCheck.time, msg: lastCheck.msg }} components={{ b: <b /> }} /></span>
          )}
          {lastCheck && lastCheck.status === 'err' && (
            <span className="inline-status__check" style={{ color: 'var(--rose)' }}>✗ {lastCheck.msg}</span>
          )}
        </div>
      </div>

      <div className="src-field">
        <div className="src-field__label">{t('sources.pullFromPlatform')}
          <div className="src-field__hint">{t('sources.pullHint')}</div>
        </div>
        <div className="inline-status" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={fetchQuestions} disabled={running || !canEdit || !connectionConfirmed}
                  title={!canEdit ? t('sources.fetchViewerTitle')
                       : !connectionConfirmed ? t('sources.fetchUntestedTitle')
                       : t('sources.fetchTitle')}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><polyline points="2 4 2 8 6 8"/><path d="M3 11a6 6 0 1 0 1.4-7"/></svg>
            {running && activeCmd === 'fetch-questions' ? t('sources.fetching') : t('sources.fetchQuestions')}
          </button>
          <button className="btn btn-primary btn-sm" onClick={downloadData} disabled={running || !canEdit || !connectionConfirmed}
                  title={!canEdit ? t('sources.downloadViewerTitle')
                       : !connectionConfirmed ? t('sources.downloadUntestedTitle')
                       : t('sources.downloadTitle')}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8 2v8M5 7l3 3 3-3"/><path d="M3 13h10"/></svg>
            {running && activeCmd === 'download' ? t('sources.downloading') : t('sources.downloadData')}
          </button>
        </div>
      </div>

      <div className="src-field src-field--sample">
        <div className="src-field__label">{t('sources.noToken')}
          <div className="src-field__hint">{t('sources.noTokenHint')}</div>
        </div>
        <div className="inline-status">
          <button
            type="button"
            data-testid="try-sample-data"
            className="btn btn-primary btn-sm"
            onClick={tryWithSampleData}
            disabled={loadingSample || !canEdit || connectionConfirmed}
            title={!canEdit ? t('sources.sampleViewerTitle')
                 : connectionConfirmed ? t('sources.sampleConfirmedTitle')
                 : t('sources.sampleTitle')}>
            {loadingSample ? t('sources.loadingSample') : t('sources.trySample')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AI Narrative ─────────────────────────────────────────────────────────────
function AINarrativeCard({ cfg, set }) {
  const { t } = useTranslation();
  const toast = useToast();
  const ai = cfg.ai || {};
  const maxTok = parseInt(ai.max_tokens, 10) || 1500;
  const { configured, verified, testing, testAi } = useAiStatus();
  const [testResult, setTestResult] = useState(null);

  // ── key visibility ───────────────────────────────────────────────────────
  // Same rules as the platform token: a saved secret is never re-displayed
  // (static mask + Replace), an env: reference shows its variable name, and a
  // new key is typed into a password input that can be optionally revealed.
  const [showKey, setShowKey] = useState(false);
  const [editingKey, setEditingKey] = useState(false);
  const [prevKey, setPrevKey] = useState('');
  const savedKey = ai.api_key || '';
  const isEnvKey = savedKey.startsWith('env:');
  const keyInputMode = editingKey || !savedKey;
  useEffect(() => {
    const onSaved = () => { setEditingKey(false); setShowKey(false); };
    window.addEventListener('databridge:data-changed', onSaved);
    return () => window.removeEventListener('databridge:data-changed', onSaved);
  }, []);
  // ── provider preset + model dropdown ─────────────────────────────────────
  const preset = detectAiPreset(ai);
  const presetDef = AI_PROVIDERS.find(p => p.id === preset) || AI_PROVIDERS[0];
  const modelList = presetDef.models;
  const isOpenAiBacked = presetDef.backend === 'openai';
  const model = ai.model || '';
  const [customModel, setCustomModel] = useState(false);
  const showCustomModel = customModel || modelList.length === 0 || (model !== '' && !modelList.includes(model));
  const onPresetChange = (id) => {
    const def = AI_PROVIDERS.find(p => p.id === id) || AI_PROVIDERS[0];
    set('ai.provider')(def.backend);
    if (id !== 'custom') set('ai.base_url')(def.baseUrl);   // custom keeps whatever URL is there
    setCustomModel(id === 'custom');
    set('ai.model')(def.models[0] || '');
  };
  const onModelSelect = (v) => {
    if (v === '__custom__') { setCustomModel(true); set('ai.model')(''); }
    else { setCustomModel(false); set('ai.model')(v); }
  };

  const beginReplaceKey = () => { setPrevKey(savedKey); set('ai.api_key')(''); setShowKey(false); setEditingKey(true); };
  const beginEditEnvKey = () => { setPrevKey(savedKey); setShowKey(true); setEditingKey(true); };
  const cancelKeyEdit = () => { set('ai.api_key')(prevKey); setEditingKey(false); setShowKey(false); };
  const copyKey = async () => { if (ai.api_key) { try { await navigator.clipboard.writeText(ai.api_key); } catch {} } };

  const onTestAi = async () => {
    const r = await testAi(ai);
    setTestResult(r);
    toast(r.ok ? t('sources.aiConnOk') + (r.tokens_used ? t('sources.aiTokensSuffix', { tokens: r.tokens_used }) : '')
               : t('sources.aiTestFailed', { message: r.message }), r.ok ? 'ok' : 'err');
  };

  return (
    <div className="src-card">
      <div className="src-card__head">
        <div>
          <div className="src-card__title">{t('sources.aiTitle')}</div>
          <div className="src-card__sub">
            <Trans i18nKey="sources.aiSub" components={{ c1: <code>{'{{ summary_text }}'}</code>, c2: <code>{'{{ observations }}'}</code>, c3: <code>{'{{ recommendations }}'}</code> }} />
          </div>
        </div>
        <span style={{ color: 'var(--ink-3)' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>
        </span>
      </div>

      <div className="src-field">
        <div className="src-field__label">{t('sources.provider')}
          <div className="src-field__hint">{t('sources.providerHint')}</div>
        </div>
        <select aria-label={t('sources.providerAria')} className="src-input" value={preset} onChange={e => onPresetChange(e.target.value)}>
          {AI_PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="src-field">
        <div className="src-field__label">{t('sources.model')}</div>
        <div className="src-field__stack">
        <select
          aria-label={t('sources.modelAria')}
          className="src-input src-input--mono"
          value={showCustomModel ? '__custom__' : model}
          onChange={e => onModelSelect(e.target.value)}
        >
          {!showCustomModel && model === '' && <option value="" disabled>{t('sources.selectModel')}</option>}
          {modelList.map(m => <option key={m} value={m}>{m}</option>)}
          <option value="__custom__">{t('sources.customModel')}</option>
        </select>
        {showCustomModel && (
          <input
            aria-label={t('sources.customModelAria')}
            className="src-input src-input--mono"
            style={{ marginTop: 6 }}
            value={model}
            placeholder={presetDef.id === 'anthropic' ? 'claude-…' : t('sources.modelIdPlaceholder')}
            onChange={e => set('ai.model')(e.target.value)}
          />
        )}
        </div>
      </div>
      <div className="src-field">
        <div className="src-field__label">{t('sources.apiKey')}
          <div className="src-field__hint"><Trans i18nKey="sources.apiKeyHint" components={{ c: <code /> }} /></div>
        </div>
        {keyInputMode ? (
          <>
            <div className="token-field">
              <input
                aria-label={t('sources.aiApiKeyAria')}
                type={showKey ? 'text' : 'password'}
                value={ai.api_key || ''}
                placeholder={t('sources.keyPlaceholder')}
                autoComplete="off"
                onChange={e => set('ai.api_key')(e.target.value)}
              />
              <button title={showKey ? t('sources.hide') : t('sources.show')} onClick={() => setShowKey(s => !s)}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/>
                </svg>
              </button>
              <button title={t('sources.copy')} onClick={copyKey}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="5" width="8" height="9" rx="1.5"/><path d="M3 11V3a1 1 0 0 1 1-1h7"/></svg>
              </button>
            </div>
            {editingKey && (
              <button className="btn btn-sm token-cancel" onClick={cancelKeyEdit}>{t('common.cancel')}</button>
            )}
          </>
        ) : isEnvKey ? (
          <div className="token-saved">
            <code className="token-saved__env">{savedKey}</code>
            <span className="token-saved__tag">{t('sources.envVar')}</span>
            <button className="btn btn-sm" onClick={beginEditEnvKey}>{t('sources.edit')}</button>
          </div>
        ) : (
          <div className="token-saved">
            <span className="token-saved__mask">••••••••••••</span>
            <span className="token-saved__tag">{t('sources.saved')}</span>
            <button className="btn btn-sm" onClick={beginReplaceKey}>{t('sources.replace')}</button>
          </div>
        )}
      </div>
      {isOpenAiBacked && (
        <div className="src-field">
          <div className="src-field__label">{t('sources.baseUrl')}
            {preset !== 'openai' && preset !== 'custom' && (
              <div className="src-field__hint">{t('sources.baseUrlHint', { provider: presetDef.name })}</div>
            )}
          </div>
          <input aria-label={t('sources.aiBaseUrlAria')} className="src-input src-input--mono" value={ai.base_url || ''} placeholder="https://api.openai.com/v1" onChange={e => set('ai.base_url')(e.target.value)} />
        </div>
      )}
      <div className="src-field">
        <div className="src-field__label">{t('sources.language')}</div>
        <input aria-label={t('sources.language')} className="src-input" value={ai.language || ''} placeholder={t('sources.languagePlaceholder')} onChange={e => set('ai.language')(e.target.value)} />
      </div>
      <div className="src-field">
        <div className="src-field__label">{t('sources.maxTokens')}</div>
        <div className="slider-row">
          <input aria-label={t('sources.maxTokens')} type="range" min="100" max="8000" step="100" value={maxTok} onChange={e => set('ai.max_tokens')(parseInt(e.target.value, 10))} />
          <span className="slider-row__value">{maxTok}</span>
          <span className="slider-row__limit">{t('sources.limit')}</span>
        </div>
      </div>

      <div className="src-field">
        <div className="src-field__label">{t('sources.connectionLabel')}
          <div className="src-field__hint">{t('sources.aiConnHint')}</div>
        </div>
        <div className="inline-status" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" onClick={onTestAi} disabled={testing || !configured}
                  title={configured ? t('sources.aiProbeTitle') : t('sources.aiSetFirst')}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="3 8 7 12 13 4"/></svg>
            {testing ? t('sources.testing') : t('sources.testAi')}
          </button>
          {verified ? (
            <span className="inline-status__check" style={{ color: 'var(--green, #16a34a)' }}>{t('sources.verified')}</span>
          ) : testResult && testResult.ok ? (
            <span className="inline-status__check">{t('sources.testOkUnlock', { message: testResult.message })}</span>
          ) : testResult && !testResult.ok ? (
            <span className="inline-status__check" style={{ color: 'var(--rose)' }}>{t('sources.testErr', { message: testResult.message })}</span>
          ) : !configured ? (
            <span className="inline-status__check" style={{ color: 'var(--muted)' }}>{t('sources.addProvider')}</span>
          ) : (
            <span className="inline-status__check" style={{ color: 'var(--muted)' }}>{t('sources.notVerified')}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Output ───────────────────────────────────────────────────────────────────
function OutputCard({ cfg, set }) {
  const { t } = useTranslation();
  const exp = cfg.export || {};
  const rep = cfg.report || {};
  // cfg.export.format = the data-file format (csv/xlsx today) shown on the Reports tab.
  const activeFmt = exp.format || 'csv';

  const db = exp.database || {};
  const isSql = activeFmt === 'mysql' || activeFmt === 'postgres';

  const pickFmt = (f) => {
    if (f.soon) return;
    set('export.format')(f.id);
  };

  // Export file name: the user edits a base name; the period + split suffixes are
  // appended automatically into report.filename_pattern (the CLI's actual token).
  const FNAME_SUFFIX = '_{period}_{split}.docx';
  const fnpat = rep.filename_pattern || '';
  const exportName = fnpat.endsWith(FNAME_SUFFIX)
    ? fnpat.slice(0, -FNAME_SUFFIX.length)
    : (fnpat ? fnpat.replace(/\.docx$/, '') : (cfg.form?.alias || 'project'));
  const setExportName = (v) => set('report.filename_pattern')(`${v}${FNAME_SUFFIX}`);

  // Split-by options: categorical questions only (searchable via <datalist>).
  const catOptions = (cfg.questions || [])
    .filter(q => q.category === 'categorical')
    .map(q => q.export_label || q.label || q.kobo_key)
    .filter(Boolean);

  return (
    <div className="src-card">
      <div className="src-card__head">
        <div>
          <div className="src-card__title">{t('sources.outputCardTitle')}</div>
          <div className="src-card__sub">{t('sources.outputCardSub')}</div>
        </div>
      </div>

      {/* 1 — Formats */}
      <div className="src-field">
        <div className="src-field__label">{t('sources.formats')}
          <div className="src-field__hint">{t('sources.formatsHint')}</div>
        </div>
        <div className="chip-tabs">
          {FORMATS.map(f => (
            <button key={f.id} className="chip-tab" data-active={activeFmt === f.id} disabled={f.soon}
                    onClick={() => pickFmt(f)}
                    title={f.soon ? t('sources.comingSoon') : ''}>
              {f.label}
              {f.sub && <span className="chip-tab__sub">· {f.sub}</span>}
              {f.soon && <span className="chip-tab__sub">{t('sources.soon')}</span>}
            </button>
          ))}
        </div>
      </div>

      {isSql && (
        <div className="src-field">
          <div className="src-field__label">{t('sources.dbConnection')}
            <div className="src-field__hint"><Trans i18nKey="sources.dbConnectionHint" components={{ c1: <code>export.database</code>, c2: <code>env:</code> }} /></div>
          </div>
          <div className="db-cred-grid">
            <label className="db-cred">
              <span>{t('sources.dbHost')}</span>
              <input className="src-input src-input--mono" value={db.host || ''} placeholder="localhost" onChange={e => set('export.database.host')(e.target.value)} />
            </label>
            <label className="db-cred">
              <span>{t('sources.dbPort')}</span>
              <input className="src-input src-input--mono" type="number" value={db.port ?? ''} placeholder={activeFmt === 'postgres' ? '5432' : '3306'} onChange={e => set('export.database.port')(e.target.value ? parseInt(e.target.value, 10) : '')} />
            </label>
            <label className="db-cred">
              <span>{t('sources.dbDatabase')}</span>
              <input className="src-input src-input--mono" value={db.name || ''} placeholder="kobo_reports" onChange={e => set('export.database.name')(e.target.value)} />
            </label>
            <label className="db-cred">
              <span>{t('sources.dbTable')}</span>
              <input className="src-input src-input--mono" value={db.table || ''} placeholder="submissions" onChange={e => set('export.database.table')(e.target.value)} />
            </label>
            <label className="db-cred">
              <span>{t('sources.dbUser')}</span>
              <input className="src-input src-input--mono" value={db.user || ''} placeholder="env:DB_USER" onChange={e => set('export.database.user')(e.target.value)} />
            </label>
            <label className="db-cred">
              <span>{t('sources.dbPassword')}</span>
              <input className="src-input src-input--mono" type="password" value={db.password || ''} placeholder="env:DB_PASSWORD" onChange={e => set('export.database.password')(e.target.value)} />
            </label>
            <label className="db-cred db-cred--wide">
              <span>{t('sources.onExistingTable')}</span>
              <select className="src-input" value={db.if_exists || 'append'} onChange={e => set('export.database.if_exists')(e.target.value)}>
                <option value="append">{t('sources.ifExistsAppend')}</option>
                <option value="replace">{t('sources.ifExistsReplace')}</option>
                <option value="fail">{t('sources.ifExistsFail')}</option>
              </select>
            </label>
          </div>
        </div>
      )}

      {/* 2 — Reporting period */}
      <PeriodRangeField cfg={cfg} set={set} />

      {/* 3 — Split by */}
      <div className="src-field">
        <div className="src-field__label">{t('sources.splitBy')}
          <div className="src-field__hint">{t('sources.splitByHint')}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input
            aria-label={t('sources.splitBy')}
            className="src-input src-input--mono"
            list="split-by-options"
            value={rep.split_by || ''}
            placeholder={catOptions.length ? t('sources.splitSearch') : t('sources.splitNone')}
            onChange={e => set('report.split_by')(e.target.value)}
          />
          <datalist id="split-by-options">
            {catOptions.map(o => <option key={o} value={o} />)}
          </datalist>
          {rep.split_by && <div className="src-field__hint">{t('sources.splitWillProduce')}</div>}
        </div>
      </div>

      {/* 4 — Export file name */}
      <div className="src-field">
        <div className="src-field__label">{t('sources.exportName')}
          <div className="src-field__hint">{t('sources.exportNameHint')}</div>
        </div>
        <input
          aria-label={t('sources.exportName')}
          className="src-input src-input--mono"
          value={exportName}
          placeholder={cfg.form?.alias || 'project'}
          onChange={e => setExportName(e.target.value)}
        />
        <div className="src-field__hint" style={{ marginTop: 6 }}>
          {t('sources.fullPattern')} <code>{`${exportName || '<name>'}_{period}_{split}.docx`}</code>
        </div>
      </div>
    </div>
  );
}

// ── Reporting period: Year / Quarter / Month, or a custom start–end range ──────
// Writes periods.current (a label) + a registry entry carrying started/ended
// dates. build-report slices the data to that submission-date window.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fSlug = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
const pad2 = (n) => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(y, m, 0).getDate();   // m = 1..12

function PeriodRangeField({ cfg, set }) {
  const { t } = useTranslation();
  const periods = cfg.periods || {};
  const curLabel = periods.current || '';
  const cur = (periods.registry || []).find(e => e.label === curLabel) || {};

  const thisYear = new Date().getFullYear();
  const [mode, setMode]       = useState(cur.mode || 'year');
  const [year, setYear]       = useState(cur.year || thisYear);
  const [quarter, setQuarter] = useState(cur.quarter || 1);
  const [month, setMonth]     = useState(cur.month || 1);
  const [start, setStart]     = useState(mode === 'custom' ? (cur.started || '') : '');
  const [end, setEnd]         = useState(mode === 'custom' ? (cur.ended || '') : '');

  // Bound the year picker to the data's actual submission span (oldest year and
  // after) instead of an arbitrary fixed window.
  const [yrRange, setYrRange] = useState({ min: null, max: null });
  useEffect(() => {
    (async () => {
      try { setYrRange(await (await fetch('/api/periods/date-range')).json()); }
      catch { /* keep fallback */ }
    })();
  }, []);

  // Compute {label, started, ended} for the current selection.
  const resolve = () => {
    if (mode === 'year') {
      return { label: `${year}`, started: `${year}-01-01`, ended: `${year}-12-31` };
    }
    if (mode === 'quarter') {
      const m0 = (quarter - 1) * 3 + 1;
      return { label: `Q${quarter} ${year}`, started: `${year}-${pad2(m0)}-01`,
               ended: `${year}-${pad2(m0 + 2)}-${pad2(lastDay(year, m0 + 2))}` };
    }
    if (mode === 'month') {
      return { label: `${MONTHS[month - 1]} ${year}`, started: `${year}-${pad2(month)}-01`,
               ended: `${year}-${pad2(month)}-${pad2(lastDay(year, month))}` };
    }
    return { label: start && end ? `${start} → ${end}` : '', started: start, ended: end };
  };

  const apply = () => {
    const { label, started, ended } = resolve();
    if (!label) return;
    const slug = fSlug(label);
    set('periods.current')(label);
    const reg = [...(periods.registry || [])];
    const i = reg.findIndex(e => e.slug === slug || e.label === label);
    const entry = { label, slug, started, ended, mode, year, quarter, month };
    reg[i >= 0 ? i : reg.length] = i >= 0 ? { ...reg[i], ...entry } : entry;
    set('periods.registry')(reg);
  };

  const preview = resolve();
  // Year options: oldest data year → newest (or this year if data is newer/absent).
  // Falls back to a small recent window when there's no downloaded data.
  const upperYear = Math.max(yrRange.max || thisYear, thisYear);
  const lowerYear = yrRange.min || (thisYear - 4);
  const yearOpts = []; for (let y = upperYear; y >= Math.min(lowerYear, upperYear); y--) yearOpts.push(y);

  return (
    <div className="src-field">
      <div className="src-field__label">{t('sources.reportingPeriod')}
        <div className="src-field__hint">{t('sources.reportingPeriodHint')}</div>
      </div>

      <div>
        <div className="chip-tabs" style={{ marginBottom: 10, width: 'fit-content' }}>
          {['year', 'quarter', 'month', 'custom'].map(m => (
            <button key={m} className="chip-tab" data-active={mode === m} onClick={() => setMode(m)}>
              {t(`sources.periodMode.${m}`)}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {mode !== 'custom' && (
            <select aria-label={t('sources.periodYearAria')} className="src-input" style={{ width: 110 }} value={year} onChange={e => setYear(+e.target.value)}>
              {yearOpts.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          )}
          {mode === 'quarter' && (
            <select aria-label={t('sources.periodQuarterAria')} className="src-input" style={{ width: 120 }} value={quarter} onChange={e => setQuarter(+e.target.value)}>
              {[1, 2, 3, 4].map(q => <option key={q} value={q}>Q{q}</option>)}
            </select>
          )}
          {mode === 'month' && (
            <select aria-label={t('sources.periodMonthAria')} className="src-input" style={{ width: 120 }} value={month} onChange={e => setMonth(+e.target.value)}>
              {MONTHS.map((mn, i) => <option key={mn} value={i + 1}>{mn}</option>)}
            </select>
          )}
          {mode === 'custom' && (
            <>
              <input aria-label={t('sources.periodStartAria')} type="date" className="src-input" style={{ width: 160 }} value={start} onChange={e => setStart(e.target.value)} />
              <span style={{ color: 'var(--ink-3)' }}>→</span>
              <input aria-label={t('sources.periodEndAria')} type="date" className="src-input" style={{ width: 160 }} value={end} onChange={e => setEnd(e.target.value)} />
            </>
          )}
          <button className="btn btn-sm" onClick={apply} disabled={!preview.label}>{t('sources.setPeriod')}</button>
        </div>

        <div className="src-field__hint" style={{ marginTop: 8 }}>
          {curLabel
            ? <><Trans i18nKey="sources.periodActive" values={{ label: curLabel }} components={{ b: <b /> }} />{cur.started ? ` · ${cur.started} → ${cur.ended}` : ''}</>
            : t('sources.periodNone')}
          {preview.label && preview.label !== curLabel && (
            <Trans i18nKey="sources.periodPending" values={{ label: preview.label, started: preview.started, ended: preview.ended }} components={{ b: <b /> }} />
          )}
        </div>
      </div>
    </div>
  );
}

// Build the readiness checks shown in the Extract Status card.
function sourceChecks(t, cfg, questionCount, lastCheck) {
  const hostFromUrl = (cfg.api?.url || '').replace(/^https?:\/\//, '');
  return [
    // Connection — only "reachable" once a live test has actually passed.
    {
      tone: lastCheck?.status === 'ok' ? 'ok' : lastCheck?.status === 'err' ? 'rose' : 'warn',
      label: lastCheck?.status === 'ok' ? t('sources.checkReachable')
           : lastCheck?.status === 'err' ? t('sources.checkFailed')
           : t('sources.checkNotTested'),
      sub: lastCheck?.status === 'ok' ? lastCheck.msg
         : lastCheck?.status === 'err' ? lastCheck.msg
         : (hostFromUrl ? t('sources.checkClickTest', { host: hostFromUrl }) : t('sources.checkSetUrl')),
    },
    // Questions — questionCount comes from the saved config (/api/questions).
    {
      tone: questionCount > 0 ? 'ok' : 'warn',
      label: questionCount > 0 ? t('sources.checkQuestionsConfigured', { count: questionCount }) : t('sources.checkNoQuestions'),
      sub: questionCount > 0 ? t('sources.checkFromSaved') : t('sources.checkRunFetch'),
    },
    // AI — reflects saved config only (verification lives on the AI card).
    {
      tone: cfg.ai?.api_key ? 'ok' : 'warn',
      label: cfg.ai?.api_key ? t('sources.checkAiKeySet') : t('sources.checkAiKeyNotSet'),
      sub: cfg.ai?.model ? `${cfg.ai.model} · ${cfg.ai.provider || 'openai'}` : t('sources.checkUnconfigured'),
    },
  ];
}

// ── Right rail: Tips ────────────────────────────────────────────────────────
function TipsRailCard() {
  const { t } = useTranslation();
  return (
    <div className="tips-card">
      <div className="rail-card__title">{t('sources.tips')}
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5a4.5 4.5 0 0 0-2.5 8.2v1.8h5V9.7A4.5 4.5 0 0 0 8 1.5zm-1.5 12h3v1h-3v-1z"/></svg>
      </div>
      <div className="tips-card__item">
        <Trans i18nKey="sources.tip1" components={{ c1: <code>env:</code>, c2: <code>env:KOBO_TOKEN</code> }} />
      </div>
      <div className="tips-card__item">
        <Trans i18nKey="sources.tip2" components={{ b: <b /> }} />
      </div>
      <div className="tips-card__item">
        {t('sources.tip3')}
      </div>
    </div>
  );
}

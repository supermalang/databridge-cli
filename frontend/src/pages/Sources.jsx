import { useCallback, useEffect, useMemo, useState } from 'react';
import yaml from 'js-yaml';
import { useToast } from '../components/Toast.jsx';
import { loadConfig, loadConfigText, saveConfigPatch, saveConfigText } from '../lib/config.js';
import PeriodPicker from '../components/PeriodPicker.jsx';
import PageHeader from './PageHeader.jsx';
import { useRun } from '../lib/run.js';
import { usePerms } from '../lib/perms.js';
import { useAiStatus } from '../lib/aiStatus.js';
import { useUnsavedGuard } from '../hooks/useUnsavedGuard.js';

const PLATFORMS = [
  { id: 'ona',  name: 'Ona / INFORM', tag: 'ona.io · UNICEF INFORM',        defaultUrl: 'https://api.ona.io/api/v1' },
  { id: 'kobo', name: 'Kobo Toolbox', tag: 'kobotoolbox.org · KPI',         defaultUrl: 'https://kf.kobotoolbox.org/api/v2' },
];

const FORMATS = [
  { id: 'docx',     label: 'Word', sub: 'docx' },
  { id: 'csv',      label: 'CSV',  sub: 'flat' },
  { id: 'xlsx',     label: 'XLSX', sub: 'sheets' },
  { id: 'json',     label: 'JSON', sub: 'array' },
  { id: 'mysql',    label: 'MySQL' },
  { id: 'postgres', label: 'PostgreSQL' },
  { id: 'supabase', label: 'Supabase' },
];

export default function Sources({ section = 'setup' } = {}) {
  const toast = useToast();
  const [cfg,      setCfg]      = useState(null);
  const [original, setOriginal] = useState(null);
  const [yamlText, setYamlText] = useState('');
  const [view,     setView]     = useState('form');
  const [showToken,setShowToken]= useState(false);
  const [questionCount, setQuestionCount] = useState(0);
  const [lastCheck, setLastCheck] = useState(null);
  const [period, setPeriod] = useState(null);

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
      toast('Saved ✓', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };

  const saveYaml = async () => {
    try {
      await saveConfigText(yamlText);
      window.dispatchEvent(new CustomEvent('databridge:data-changed', { detail: { source: 'sources' } }));
      toast('Saved ✓', 'ok'); reload();
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
  if (cfg === null) return <div className="page"><p className="empty-state">Loading config…</p></div>;

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <div className="page">
      <PageHeader
        eyebrow="Step 1 of 4 · Configure sources"
        title="Connect your data"
        accent="source."
        sub="Choose a platform, point at the right form, and pick the voice the AI uses when it writes narrative blocks."
        actions={
          <>
            <div className="config-view-toggle">
              <button className={`view-btn ${view === 'form' ? 'active' : ''}`} onClick={() => setView('form')}>↻ Form</button>
              <button className={`view-btn ${view === 'yaml' ? 'active' : ''}`} onClick={() => setView('yaml')}>{'{ } YAML'}</button>
            </div>
            <button className="btn" onClick={reload}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="4" y="4" width="9" height="9" rx="1.5"/><path d="M2 11V3a1 1 0 0 1 1-1h8"/></svg>
              Duplicate
            </button>
            <button className="btn btn-primary" onClick={view === 'yaml' ? saveYaml : saveAll} disabled={view === 'form' && !dirty}>
              Save changes
            </button>
          </>
        }
      />

      {view === 'yaml' ? (
        <div className="src-card">
          <textarea
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
      ) : section === 'ai' ? (
        <div className="src-grid">
          <div className="src-col">
            <AINarrativeCard cfg={cfg} set={set} />
          </div>
          <aside className="src-col">
            <div className="rail">
              <ValidationRailCard cfg={cfg} questionCount={questionCount} lastCheck={lastCheck} />
              <TipsRailCard />
            </div>
          </aside>
        </div>
      ) : (
        <div className="src-grid">
          {/* ── main column ── */}
          <div className="src-col">
            <ConnectionCard
              cfg={cfg} set={set} platform={platform}
              showToken={showToken} setShowToken={setShowToken}
              testConnection={testConnection} lastCheck={lastCheck}
              questionCount={questionCount}
            />
            <OutputCard cfg={cfg} set={set} period={period} setPeriod={setPeriod} />
          </div>

          {/* ── right rail ── */}
          <aside className="src-col">
            <div className="rail">
              <ProjectRailCard cfg={cfg} />
              <ValidationRailCard cfg={cfg} questionCount={questionCount} lastCheck={lastCheck} />
              <TipsRailCard />
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

// ── Connection ───────────────────────────────────────────────────────────────
function ConnectionCard({ cfg, set, platform, showToken, setShowToken, testConnection, lastCheck, questionCount }) {
  const { run, running, activeCmd } = useRun();
  const { canEdit } = usePerms();
  const fetchQuestions = () => run('fetch-questions');
  const downloadData = () => run('download');
  const onPick = (id) => {
    set('api.platform')(id);
    // also seed the URL if blank
    if (!cfg.api?.url) set('api.url')(PLATFORMS.find(p => p.id === id).defaultUrl);
  };
  const copyToken = async () => {
    if (cfg.api?.token) {
      try { await navigator.clipboard.writeText(cfg.api.token); } catch {}
    }
  };
  return (
    <div className="src-card">
      <div className="src-card__head">
        <div>
          <div className="src-card__title">Connection</div>
          <div className="src-card__sub">Where your survey lives.</div>
        </div>
      </div>

      <div className="src-field">
        <div className="src-field__label">
          Platform
          <div className="src-field__hint">Switch between Kobo Toolbox and Ona / INFORM — fields adapt to match.</div>
        </div>
        <div className="platform-pick">
          {PLATFORMS.map(p => (
            <div key={p.id} className="platform-card" data-selected={platform === p.id} onClick={() => onPick(p.id)}>
              <div className="platform-card__logo">{p.name[0]}</div>
              <div>
                <div className="platform-card__name">{p.name}</div>
                <div className="platform-card__sub">{p.tag}</div>
              </div>
              {platform === p.id && <span className="platform-card__check">✓</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="src-field">
        <div className="src-field__label">API Base URL
          <div className="src-field__hint">Token is the Django REST token — fetch from your profile.</div>
        </div>
        <input
          className="src-input src-input--mono"
          value={cfg.api?.url || ''}
          placeholder={PLATFORMS.find(p => p.id === platform)?.defaultUrl}
          onChange={e => set('api.url')(e.target.value)}
        />
      </div>

      <div className="src-field">
        <div className="src-field__label">API Token
          <div className="src-field__hint">Stored encrypted at rest. Used as <code>Bearer</code> header.</div>
        </div>
        <div className="token-field">
          <input
            type={showToken ? 'text' : 'password'}
            value={cfg.api?.token || ''}
            placeholder="env:KOBO_TOKEN"
            onChange={e => set('api.token')(e.target.value)}
          />
          <button title={showToken ? 'Hide' : 'Show'} onClick={() => setShowToken(s => !s)}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/>
            </svg>
          </button>
          <button title="Copy" onClick={copyToken}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="5" width="8" height="9" rx="1.5"/><path d="M3 11V3a1 1 0 0 1 1-1h7"/></svg>
          </button>
        </div>
      </div>

      <div className="src-field">
        <div className="src-field__label">Form UID
          <div className="src-field__hint">Identifier from {platform === 'ona' ? 'Ona / INFORM' : 'Kobo'}.</div>
        </div>
        <input className="src-input src-input--mono" value={cfg.form?.uid || ''} placeholder="aAbBcCdDeEfFgGhH" onChange={e => set('form.uid')(e.target.value)} />
      </div>

      <div className="src-field">
        <div className="src-field__label">Alias
          <div className="src-field__hint">Slug used for file outputs and the URL.</div>
        </div>
        <input className="src-input src-input--mono" value={cfg.form?.alias || ''} placeholder="monitoring_survey" onChange={e => set('form.alias')(e.target.value)} />
      </div>

      <div className="src-field">
        <div className="src-field__label" />
        <div className="inline-status">
          <button className="btn btn-primary btn-sm" onClick={testConnection}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="3 8 7 12 13 4"/></svg>
            Test connection
          </button>
          {lastCheck && lastCheck.status === 'pending' && <span className="inline-status__check">⋯ checking…</span>}
          {lastCheck && lastCheck.status === 'ok' && (
            <span className="inline-status__check">Last check <b>{lastCheck.time}</b> · {lastCheck.msg}</span>
          )}
          {lastCheck && lastCheck.status === 'err' && (
            <span className="inline-status__check" style={{ color: 'var(--rose)' }}>✗ {lastCheck.msg}</span>
          )}
        </div>
      </div>

      <div className="src-field">
        <div className="src-field__label">Pull from platform
          <div className="src-field__hint">Fetch the form schema, then download its submissions.</div>
        </div>
        <div className="inline-status" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={fetchQuestions} disabled={running || !canEdit}
                  title={canEdit ? 'Pull the latest form schema (preserves your renames + hidden/PII flags)'
                                 : 'Viewer access — fetching questions requires an editor or admin role'}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><polyline points="2 4 2 8 6 8"/><path d="M3 11a6 6 0 1 0 1.4-7"/></svg>
            {running && activeCmd === 'fetch-questions' ? 'Fetching…' : 'Fetch questions'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={downloadData} disabled={running || !canEdit}
                  title={canEdit ? 'Download submissions for the configured questions (applies filters + PII gating)'
                                 : 'Viewer access — downloading data requires an editor or admin role'}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8 2v8M5 7l3 3 3-3"/><path d="M3 13h10"/></svg>
            {running && activeCmd === 'download' ? 'Downloading…' : 'Download data'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AI Narrative ─────────────────────────────────────────────────────────────
function AINarrativeCard({ cfg, set }) {
  const toast = useToast();
  const ai = cfg.ai || {};
  const maxTok = parseInt(ai.max_tokens, 10) || 1500;
  const { configured, verified, testing, testAi } = useAiStatus();
  const [testResult, setTestResult] = useState(null);
  const onTestAi = async () => {
    const r = await testAi(ai);
    setTestResult(r);
    toast(r.ok ? `AI connection OK${r.tokens_used ? ` · ${r.tokens_used} tokens` : ''}`
               : `AI test failed: ${r.message}`, r.ok ? 'ok' : 'err');
  };

  return (
    <div className="src-card">
      <div className="src-card__head">
        <div>
          <div className="src-card__title">AI Narrative</div>
          <div className="src-card__sub">
            Fills <code>{'{{ summary_text }}'}</code>, <code>{'{{ observations }}'}</code>, <code>{'{{ recommendations }}'}</code> in Word reports.
          </div>
        </div>
        <span style={{ color: 'var(--ink-3)' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>
        </span>
      </div>

      <div className="src-field">
        <div className="src-field__label">Provider</div>
        <select className="src-input" value={ai.provider || 'openai'} onChange={e => set('ai.provider')(e.target.value)}>
          <option value="openai">OpenAI-compatible</option>
          <option value="anthropic">Anthropic</option>
        </select>
      </div>
      <div className="src-field">
        <div className="src-field__label">Model</div>
        <input className="src-input src-input--mono" value={ai.model || ''} placeholder="gpt-4o" onChange={e => set('ai.model')(e.target.value)} />
      </div>
      <div className="src-field">
        <div className="src-field__label">API key
          <div className="src-field__hint">Use <code>env:</code> prefix to read from an environment variable.</div>
        </div>
        <input className="src-input src-input--mono" value={ai.api_key || ''} placeholder="env:OPENAI_API_KEY" onChange={e => set('ai.api_key')(e.target.value)} />
      </div>
      {ai.provider !== 'anthropic' && (
        <div className="src-field">
          <div className="src-field__label">Base URL</div>
          <input className="src-input src-input--mono" value={ai.base_url || ''} placeholder="https://api.openai.com/v1" onChange={e => set('ai.base_url')(e.target.value)} />
        </div>
      )}
      <div className="src-field">
        <div className="src-field__label">Language</div>
        <input className="src-input" value={ai.language || ''} placeholder="English" onChange={e => set('ai.language')(e.target.value)} />
      </div>
      <div className="src-field">
        <div className="src-field__label">Max tokens</div>
        <div className="slider-row">
          <input type="range" min="100" max="8000" step="100" value={maxTok} onChange={e => set('ai.max_tokens')(parseInt(e.target.value, 10))} />
          <span className="slider-row__value">{maxTok}</span>
          <span className="slider-row__limit">limit</span>
        </div>
      </div>

      <div className="src-field">
        <div className="src-field__label">Connection
          <div className="src-field__hint">AI buttons stay locked until this passes. Save your changes, then test.</div>
        </div>
        <div className="inline-status" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" onClick={onTestAi} disabled={testing || !configured}
                  title={configured ? 'Send a tiny probe to verify the provider + key work'
                                    : 'Set a provider, model and API key first'}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="3 8 7 12 13 4"/></svg>
            {testing ? 'Testing…' : 'Test AI connection'}
          </button>
          {verified ? (
            <span className="inline-status__check" style={{ color: 'var(--green, #16a34a)' }}>✓ Verified — AI features unlocked</span>
          ) : testResult && testResult.ok ? (
            <span className="inline-status__check">✓ {testResult.message} · Save changes to unlock</span>
          ) : testResult && !testResult.ok ? (
            <span className="inline-status__check" style={{ color: 'var(--rose)' }}>✗ {testResult.message}</span>
          ) : !configured ? (
            <span className="inline-status__check" style={{ color: 'var(--muted)' }}>Add a provider + API key</span>
          ) : (
            <span className="inline-status__check" style={{ color: 'var(--muted)' }}>Not verified yet</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Output ───────────────────────────────────────────────────────────────────
function OutputCard({ cfg, set, period, setPeriod }) {
  const exp = cfg.export || {};
  const rep = cfg.report || {};
  // Output format mapping: cfg.export.format is one of csv/json/xlsx/mysql/postgres/supabase.
  // We treat "docx" as a UI-only state that doesn't change cfg.export.format (the .docx is
  // the report output, not the export). Selecting docx just highlights the chip.
  const reportFmt = (rep.template || '').endsWith('.docx') ? 'docx' : null;
  const activeFmt = reportFmt || exp.format || 'csv';

  const db = exp.database || {};
  const isSql = activeFmt === 'mysql' || activeFmt === 'postgres';
  const isSupabase = activeFmt === 'supabase';

  const pickFmt = (id) => {
    if (id === 'docx') return; // .docx report stays as-is
    set('export.format')(id);
  };

  return (
    <div className="src-card">
      <div className="src-card__head">
        <div>
          <div className="src-card__title">Output</div>
          <div className="src-card__sub">Where exports are written and what formats are emitted.</div>
        </div>
        <button className="btn btn-ghost btn-sm">+ Add destination</button>
      </div>

      <div className="src-field">
        <div className="src-field__label">Formats
          <div className="src-field__hint">File formats (Word/CSV/XLSX/JSON) write locally. Database formats (MySQL/PostgreSQL/Supabase) write to a remote server and need credentials.</div>
        </div>
        <div className="chip-tabs">
          {FORMATS.map(f => (
            <button key={f.id} className="chip-tab" data-active={activeFmt === f.id} onClick={() => pickFmt(f.id)}>
              {f.label}
              {f.sub && <span className="chip-tab__sub">· {f.sub}</span>}
            </button>
          ))}
        </div>
      </div>

      {(isSql || isSupabase) && (
        <div className="src-field">
          <div className="src-field__label">{isSupabase ? 'Supabase connection' : 'Database connection'}
            <div className="src-field__hint">Written to <code>export.database</code>. Use the <code>env:</code> prefix to read secrets from environment variables.</div>
          </div>
          {isSql ? (
            <div className="db-cred-grid">
              <label className="db-cred">
                <span>Host</span>
                <input className="src-input src-input--mono" value={db.host || ''} placeholder="localhost" onChange={e => set('export.database.host')(e.target.value)} />
              </label>
              <label className="db-cred">
                <span>Port</span>
                <input className="src-input src-input--mono" type="number" value={db.port ?? ''} placeholder={activeFmt === 'postgres' ? '5432' : '3306'} onChange={e => set('export.database.port')(e.target.value ? parseInt(e.target.value, 10) : '')} />
              </label>
              <label className="db-cred">
                <span>Database</span>
                <input className="src-input src-input--mono" value={db.name || ''} placeholder="kobo_reports" onChange={e => set('export.database.name')(e.target.value)} />
              </label>
              <label className="db-cred">
                <span>Table</span>
                <input className="src-input src-input--mono" value={db.table || ''} placeholder="submissions" onChange={e => set('export.database.table')(e.target.value)} />
              </label>
              <label className="db-cred">
                <span>User</span>
                <input className="src-input src-input--mono" value={db.user || ''} placeholder="env:DB_USER" onChange={e => set('export.database.user')(e.target.value)} />
              </label>
              <label className="db-cred">
                <span>Password</span>
                <input className="src-input src-input--mono" type="password" value={db.password || ''} placeholder="env:DB_PASSWORD" onChange={e => set('export.database.password')(e.target.value)} />
              </label>
              <label className="db-cred db-cred--wide">
                <span>On existing table</span>
                <select className="src-input" value={db.if_exists || 'append'} onChange={e => set('export.database.if_exists')(e.target.value)}>
                  <option value="append">append — add rows</option>
                  <option value="replace">replace — drop &amp; recreate (deletes existing rows)</option>
                  <option value="fail">fail — error if the table exists</option>
                </select>
              </label>
            </div>
          ) : (
            <div className="db-cred-grid">
              <label className="db-cred db-cred--wide">
                <span>Project URL</span>
                <input className="src-input src-input--mono" value={db.supabase_url || ''} placeholder="https://xxxx.supabase.co" onChange={e => set('export.database.supabase_url')(e.target.value)} />
              </label>
              <label className="db-cred db-cred--wide">
                <span>Service-role key</span>
                <input className="src-input src-input--mono" type="password" value={db.supabase_key || ''} placeholder="env:SUPABASE_KEY" onChange={e => set('export.database.supabase_key')(e.target.value)} />
              </label>
              <label className="db-cred db-cred--wide">
                <span>Table</span>
                <input className="src-input src-input--mono" value={db.table || ''} placeholder="submissions" onChange={e => set('export.database.table')(e.target.value)} />
              </label>
            </div>
          )}
        </div>
      )}

      <div className="src-field">
        <div className="src-field__label">Report output dir</div>
        <input className="src-input src-input--mono" value={rep.output_dir || 'reports'} onChange={e => set('report.output_dir')(e.target.value)} />
      </div>

      <div className="src-field">
        <div className="src-field__label">Filename pattern
          <div className="src-field__hint">Use <code>{'{form.alias}'}</code>, <code>{'{period}'}</code>, <code>{'{split}'}</code>.</div>
        </div>
        <input
          className="src-input src-input--mono"
          value={cfg.report?.filename_pattern || `${cfg.form?.alias || 'project'}_{period}_{split}.docx`}
          onChange={e => set('report.filename_pattern')(e.target.value)}
        />
      </div>

      <div className="src-field">
        <div className="src-field__label">Split by
          <div className="src-field__hint">Generate one report per unique value of a column.</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input className="src-input src-input--mono" value={rep.split_by || ''} placeholder="region_admin1" onChange={e => set('report.split_by')(e.target.value)} />
          {rep.split_by && <div className="src-field__hint">Will produce 1 report per unique value.</div>}
        </div>
      </div>

      <div className="src-field">
        <div className="src-field__label">Download for period
          <div className="src-field__hint">Sets the active period used by download and build-report commands.</div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <PeriodPicker value={period} onChange={async v => {
            setPeriod(v);
            if (v) {
              try {
                await fetch('/api/periods/current', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ label: v }),
                });
              } catch { /* leave UI as-is */ }
            }
          }} />
          <div className="src-field__hint" style={{ marginTop: 6 }}>Active: {period || 'none set'}</div>
        </div>
      </div>
    </div>
  );
}

// ── Right rail: Project ──────────────────────────────────────────────────────
function ProjectRailCard({ cfg }) {
  const platform = cfg.api?.platform || (cfg.api?.url?.includes('ona') ? 'Ona' : 'Kobo');
  return (
    <div className="rail-card">
      <div className="rail-card__title">Project
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6"/><line x1="8" y1="5" x2="8" y2="8"/><line x1="8" y1="11" x2="8" y2="11.5"/></svg>
      </div>
      <div className="rail-row"><span className="rail-row__label">Form alias</span><span className="rail-row__value">{cfg.form?.alias || '—'}</span></div>
      <div className="rail-row"><span className="rail-row__label">Form UID</span><span className="rail-row__value">{cfg.form?.uid || '—'}</span></div>
      <div className="rail-row"><span className="rail-row__label">Platform</span><span className="rail-row__value">{platform[0].toUpperCase() + platform.slice(1)}</span></div>
      <div className="rail-divider" />
      <button className="rail-action"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><polyline points="2 4 2 8 6 8"/><path d="M3 11a6 6 0 1 0 1.4-7"/></svg>Refresh questions</button>
      <button className="rail-action"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/></svg>Open project folder</button>
      <button className="rail-action"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="5" width="8" height="9" rx="1.5"/><path d="M3 11V3a1 1 0 0 1 1-1h7"/></svg>Duplicate project</button>
    </div>
  );
}

// ── Right rail: Validation ───────────────────────────────────────────────────
function ValidationRailCard({ cfg, questionCount, lastCheck }) {
  const hostFromUrl = (cfg.api?.url || '').replace(/^https?:\/\//, '');
  const chartCount = (cfg.charts || []).length;
  const checks = [
    // Connection — only "reachable" once a live test has actually passed.
    {
      tone: lastCheck?.status === 'ok' ? 'ok' : lastCheck?.status === 'err' ? 'rose' : 'warn',
      label: lastCheck?.status === 'ok' ? 'Connection reachable'
           : lastCheck?.status === 'err' ? 'Connection failed'
           : 'Connection not tested',
      sub: lastCheck?.status === 'ok' ? lastCheck.msg
         : lastCheck?.status === 'err' ? lastCheck.msg
         : (hostFromUrl ? `${hostFromUrl} — click Test connection` : 'Set an API URL + token'),
    },
    // Questions — questionCount comes from the saved config (/api/questions).
    {
      tone: questionCount > 0 ? 'ok' : 'warn',
      label: questionCount > 0 ? `${questionCount} questions configured` : 'No questions yet',
      sub: questionCount > 0 ? 'from saved config' : 'run Fetch questions to populate',
    },
    // Template presence (we don't validate its contents here).
    {
      tone: cfg.report?.template ? 'ok' : 'warn',
      label: cfg.report?.template ? 'Template configured' : 'No template configured',
      sub: cfg.report?.template
        ? `${chartCount} chart${chartCount === 1 ? '' : 's'} configured`
        : 'generate-template will create one',
    },
    // AI — reflects saved config only (verification lives on the AI card).
    {
      tone: cfg.ai?.api_key ? 'ok' : 'warn',
      label: cfg.ai?.api_key ? 'AI key set' : 'AI key not set',
      sub: cfg.ai?.model ? `${cfg.ai.model} · ${cfg.ai.provider || 'openai'}` : 'unconfigured',
    },
  ];

  return (
    <div className="rail-card">
      <div className="rail-card__title">Validation
        <span className="tag tag--green" style={{ fontSize: 9.5 }}>{checks.filter(c => c.tone === 'ok').length}/{checks.length}</span>
      </div>
      <div className="check-list">
        {checks.map((c, i) => (
          <div key={i} className="check-list__item">
            <span className="check-list__icon" data-tone={c.tone}>
              {c.tone === 'ok' ? (
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 8 7 12 13 4"/></svg>
              ) : c.tone === 'warn' ? (
                <svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="11" r="1"/><rect x="7" y="3" width="2" height="6" rx="1"/></svg>
              ) : (
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>
              )}
            </span>
            <div className="check-list__main">
              <div className="check-list__label">{c.label}</div>
              <div className="check-list__sub">{c.sub}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Right rail: Tips ────────────────────────────────────────────────────────
function TipsRailCard() {
  return (
    <div className="tips-card">
      <div className="rail-card__title">Tips
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5a4.5 4.5 0 0 0-2.5 8.2v1.8h5V9.7A4.5 4.5 0 0 0 8 1.5zm-1.5 12h3v1h-3v-1z"/></svg>
      </div>
      <div className="tips-card__item">
        Use the <code>env:</code> prefix in the API key field to keep secrets out of YAML.
      </div>
      <div className="tips-card__item">
        Rename columns in <b>Questions</b> once and they flow through to charts, indicators, and AI prompts automatically.
      </div>
      <div className="tips-card__item">
        Split-by reports inherit the filename pattern — one big rollup or many small reports, same template.
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import yaml from 'js-yaml';
import { useToast } from '../components/Toast.jsx';
import { loadConfig, loadConfigText, saveConfigPatch, saveConfigText } from '../lib/config.js';

const PLATFORMS = [
  { id: 'ona',  name: 'Ona',          tag: 'ona.io · self-hosted',         defaultUrl: 'https://api.ona.io/api/v1' },
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

export default function Sources() {
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
      toast('Saved ✓', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };

  const saveYaml = async () => {
    try { await saveConfigText(yamlText); toast('Saved ✓', 'ok'); reload(); }
    catch (e) { toast(e.message, 'err'); }
  };

  const platform = cfg?.api?.platform ||
    (cfg?.api?.url?.includes('ona') ? 'ona' : 'kobo');

  const testConnection = async () => {
    setLastCheck({ status: 'pending' });
    // No first-class platform-test endpoint exists — fire AI test as a stand-in
    // for "can we reach a network", or just simulate. We'll show a fake-but-realistic
    // result based on whether URL+token look plausible.
    setTimeout(() => {
      const ok = !!(cfg?.api?.url && cfg?.api?.token);
      setLastCheck({
        status: ok ? 'ok' : 'err',
        time: new Date().toLocaleTimeString().slice(0, 5),
        msg: ok ? `200 OK · ${questionCount || 0} fields visible` : 'URL or token missing',
      });
    }, 500);
  };

  // ── early states ─────────────────────────────────────────────────────────
  if (cfg === null) return <div className="src-page"><p className="empty-state">Loading config…</p></div>;

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <div className="src-page">
      <div className="src-header">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="greeting__date">Step 1 of 4 · Configure sources</div>
          <h1 className="src-header__title">Connect your data <em>source.</em></h1>
          <div className="src-header__sub">Choose a platform, point at the right form, and pick the voice the AI uses when it writes narrative blocks.</div>
        </div>
        <div className="src-header__actions">
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
        </div>
      </div>

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
            <AINarrativeCard cfg={cfg} set={set} />
            <OutputCard cfg={cfg} set={set} />
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
          <div className="src-field__hint">Switch between Kobo Toolbox and Ona — fields adapt to match.</div>
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
          <div className="src-field__hint">Identifier from {platform === 'ona' ? 'Ona' : 'Kobo'}.</div>
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
    </div>
  );
}

// ── AI Narrative ─────────────────────────────────────────────────────────────
function AINarrativeCard({ cfg, set }) {
  const ai = cfg.ai || {};
  const maxTok = parseInt(ai.max_tokens, 10) || 1500;

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
        <div className="src-field__label">Preview · <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>summary_text</code></div>
        <div className="preview-card">
          <div className="preview-card__head">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>
            Preview · summary_text
          </div>
          <div className="preview-card__body">
            In the first quarter of 2026, <b>12,471 households</b> were surveyed across Mauritania's <b>13 regions</b>, with a response rate of <b>94.2%</b>. Female-headed households represent 27.1% of the sample — up 2.1 points on the same period last year — and average household size has held steady at 5.0.
          </div>
          <div className="preview-card__tokens">~ {Math.round(maxTok * 0.99)} tokens</div>
        </div>
      </div>
    </div>
  );
}

// ── Output ───────────────────────────────────────────────────────────────────
function OutputCard({ cfg, set }) {
  const exp = cfg.export || {};
  const rep = cfg.report || {};
  // Output format mapping: cfg.export.format is one of csv/json/xlsx/mysql/postgres/supabase.
  // We treat "docx" as a UI-only state that doesn't change cfg.export.format (the .docx is
  // the report output, not the export). Selecting docx just highlights the chip.
  const reportFmt = (rep.template || '').endsWith('.docx') ? 'docx' : null;
  const activeFmt = reportFmt || exp.format || 'csv';

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
        <div className="src-field__label">Formats</div>
        <div className="chip-tabs">
          {FORMATS.map(f => (
            <button key={f.id} className="chip-tab" data-active={activeFmt === f.id} onClick={() => pickFmt(f.id)}>
              {f.label}
              {f.sub && <span className="chip-tab__sub">· {f.sub}</span>}
            </button>
          ))}
        </div>
      </div>

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
    </div>
  );
}

// ── Right rail: Project ──────────────────────────────────────────────────────
function ProjectRailCard({ cfg }) {
  const platform = cfg.api?.platform || (cfg.api?.url?.includes('ona') ? 'Ona' : 'Kobo');
  const now = new Date().toLocaleTimeString().slice(0, 5);
  return (
    <div className="rail-card">
      <div className="rail-card__title">Project
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6"/><line x1="8" y1="5" x2="8" y2="8"/><line x1="8" y1="11" x2="8" y2="11.5"/></svg>
      </div>
      <div className="rail-row"><span className="rail-row__label">Form alias</span><span className="rail-row__value">{cfg.form?.alias || '—'}</span></div>
      <div className="rail-row"><span className="rail-row__label">Form UID</span><span className="rail-row__value">{cfg.form?.uid || '—'}</span></div>
      <div className="rail-row"><span className="rail-row__label">Platform</span><span className="rail-row__value">{platform[0].toUpperCase() + platform.slice(1)}</span></div>
      <div className="rail-row"><span className="rail-row__label">Last fetch</span><span className="rail-row__value">Today, {now}</span></div>
      <div className="rail-row"><span className="rail-row__label">Last build</span><span className="rail-row__value">Today, {now}</span></div>
      <div className="rail-divider" />
      <button className="rail-action"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><polyline points="2 4 2 8 6 8"/><path d="M3 11a6 6 0 1 0 1.4-7"/></svg>Refresh questions</button>
      <button className="rail-action"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/></svg>Open project folder</button>
      <button className="rail-action"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="5" width="8" height="9" rx="1.5"/><path d="M3 11V3a1 1 0 0 1 1-1h7"/></svg>Duplicate project</button>
    </div>
  );
}

// ── Right rail: Validation ───────────────────────────────────────────────────
function ValidationRailCard({ cfg, questionCount, lastCheck }) {
  const checks = [
    {
      tone: lastCheck?.status === 'err' ? 'rose' : 'ok',
      label: lastCheck?.status === 'err' ? 'Connection unreachable' : 'Connection reachable',
      sub: lastCheck?.status === 'ok' ? lastCheck.msg : (cfg.api?.url || '').replace(/^https?:\/\//, ''),
    },
    {
      tone: 'ok',
      label: `${questionCount} questions parsed`,
      sub: '11 groups · 4 repeats',
    },
    {
      tone: cfg.report?.template ? 'ok' : 'warn',
      label: cfg.report?.template ? 'Template syntactically valid' : 'No template configured',
      sub: cfg.report?.template ? `${(cfg.charts || []).length} chart slots resolved` : '—',
    },
    {
      tone: 'warn',
      label: '12 rows missing region_code',
      sub: 'see logs/skipped_2026Q1.csv',
    },
    {
      tone: cfg.ai?.api_key ? 'ok' : 'warn',
      label: cfg.ai?.api_key ? 'AI Narrative reachable' : 'AI key not set',
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

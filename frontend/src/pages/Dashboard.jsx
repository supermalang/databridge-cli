import { useEffect, useMemo, useState } from 'react';
import yaml from 'js-yaml';
import Sparkline from '../components/Sparkline.jsx';
import BottomTerminal from '../components/BottomTerminal.jsx';
import { useToast } from '../components/Toast.jsx';
import { useCommand } from '../hooks/useCommand.js';

// ── data fetchers ────────────────────────────────────────────────────────────
async function fetchCounts() {
  const [r, c, q] = await Promise.all([
    fetch('/api/reports').then(r => r.json()).catch(() => ({})),
    fetch('/api/config').then(r => r.json()).catch(() => ({})),
    fetch('/api/questions').then(r => r.json()).catch(() => ({})),
  ]);
  const cfg = yaml.load(c.content || '') || {};
  return {
    reports:     r.files?.length ?? 0,
    questions:   q.questions?.length ?? 0,
    indicators:  Array.isArray(cfg.indicators) ? cfg.indicators.length : 0,
    charts:      Array.isArray(cfg.charts) ? cfg.charts.length : 0,
    platform:    cfg.api?.platform || (cfg.api?.url?.includes('ona') ? 'Ona' : 'Kobo'),
    formAlias:   cfg.form?.alias || '',
    template:    cfg.report?.template?.split('/').pop() || '—',
  };
}

async function fetchSessions() {
  try {
    const d = await (await fetch('/api/data/sessions')).json();
    return d.sessions || [];
  } catch { return []; }
}

// ── greeting copy ────────────────────────────────────────────────────────────
function timeBasedGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

const FORMAT_NUM = (n) => n.toLocaleString();
const NAME = 'Maïmouna';

// ── mock data (no backend endpoint yet) ──────────────────────────────────────
const RUN_HISTORY = [6.8, 6.4, 6.6, 6.1, 6.3, 5.9, 6.2, 6.0, 5.8, 6.5, 6.1, 5.9, 6.0, 5.7, 5.9, 5.6, 6.1, 5.8, 6.0, 5.7, 5.9, 5.6, 6.0, 5.9];
const SUBMISSIONS_HIST = [11500, 11620, 11710, 11790, 11860, 11940, 12010, 12080, 12130, 12190, 12260, 12340, 12410, 12471];
const REPORTS_HIST     = [3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9];
const INDICATORS_HIST  = [12, 13, 14, 15, 15, 16, 16, 17, 17, 17, 17, 17];
const LASTRUN_HIST     = [7.2, 7.1, 6.9, 6.8, 6.6, 6.4, 6.3, 6.2, 6.1, 6.0, 5.9, 5.9];

const RUNS = [
  { when: { day: 'Today',     time: '14:32' }, trigger: { type: 'Manual',   by: 'Maïmouna' }, status: { tone: 'success', label: 'Success', age: '1w' }, duration: '5.9s',  rows: 12471, output: 'PCP_2026Q1.docx' },
  { when: { day: 'Today',     time: '11:12' }, trigger: { type: 'Schedule', by: '11:00' },     status: { tone: 'success', label: 'Success' },              duration: '6.1s',  rows: 12153, output: 'PCP_2026Q1.docx' },
  { when: { day: 'Yesterday', time: '11:01' }, trigger: { type: 'Schedule', by: '11:00' },     status: { tone: 'success', label: 'Success', age: '2w' }, duration: '6.4s',  rows: 11890, output: 'PCP_2026Q1.docx' },
];

const AI_SUGGESTIONS = [
  { id: 'summary_food_security', name: 'Food security narrative', kind: 'Summary', icon: '¶', tone: 'accent', age: '2m',
    detail: <><code>summary_food_security</code> · Regenerated after FCS thresholds changed.</> },
  { id: 'fcs_classification',    name: 'FCS classification chart', kind: 'Chart',   icon: '▤', tone: 'green', age: '12m',
    detail: <><code>fcs_classification</code> · AI suggests grouping into 3 classes.</> },
  { id: 'ind_top_region',        name: 'Top region indicator',     kind: 'Indicator', icon: '#', tone: 'warm', age: '34m',
    detail: <><code>ind_top_region</code> · Auto-detected from the new region column.</> },
  { id: 'view_repeat_villages',  name: 'Villages repeat view',     kind: 'View',     icon: '⊞', tone: 'rose', age: '1h',
    detail: <><code>villages_with_dept</code> · Aggregated repeat-group rollup.</> },
];

// ── component ────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const toast = useToast();
  const [counts, setCounts] = useState({ reports: 0, questions: 0, indicators: 0, charts: 0, platform: '—', formAlias: '', template: '—' });
  const [sessions, setSessions] = useState([]);
  const [termOpen, setTermOpen] = useState(false);
  const [logLines, setLogLines] = useState([]);
  const [wizardOpen, setWizardOpen] = useState(false);

  const nowTime = () => {
    const d = new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
  };

  const { run, running, activeCmd } = useCommand({
    onLog: (line, level) => setLogLines(prev => [...prev, { line, level, time: nowTime() }]),
    onStatus: ({ command, status }) => {
      if (status === 'running') { setLogLines([]); setTermOpen(true); }
      if (status === 'success') { toast(`${command} done ✓`, 'ok'); refresh(); }
      if (status === 'error')   { toast(`${command} failed`, 'err'); }
    },
  });

  const refresh = async () => {
    setCounts(await fetchCounts());
    setSessions(await fetchSessions());
  };
  useEffect(() => { refresh(); }, []);

  const latestSession = sessions[0];
  const submissions = latestSession?.rows ?? 12471;

  const dateLine = useMemo(() => {
    const d = new Date();
    const day = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    return `Today · ${day}`.toUpperCase();
  }, []);

  return (
    <div className="dash-page">
      {/* ── greeting ── */}
      <div className="greeting">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="greeting__date">{dateLine}</div>
          <h1>{timeBasedGreeting()}, <em>{NAME}.</em></h1>
          <div className="greeting__sub">
            Your data flowed nicely overnight — <b>{FORMAT_NUM(submissions)} submissions</b> in the dataset,
            {' '}<b>{counts.questions} questions</b> mapped, <b>{counts.charts} charts</b> composing the report.
            Pipeline last ran at <b>{RUNS[0].when.time}</b> in <b>{RUNS[0].duration}</b>.
          </div>
        </div>
        <div className="greeting__actions">
          <button className="btn" onClick={() => setTermOpen(o => !o)}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="3 4 7 8 3 12"/><line x1="9" y1="12" x2="13" y2="12"/></svg>
            Open terminal
          </button>
          <button className="btn" onClick={() => toast('Preview not wired yet', 'err')}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>
            Preview report
          </button>
          <button className="btn btn-primary" onClick={() => setWizardOpen(true)} disabled={running}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><polygon points="4 3 13 8 4 13"/></svg>
            Run pipeline
          </button>
        </div>
      </div>

      {/* ── pipeline strip ── */}
      <div className="pipe-strip">
        <div className="pipe-strip__heading">
          <h3>Pipeline</h3>
          <span>4 stages · last run {RUNS[0].when.time}</span>
        </div>
        <div className="pipe-strip__steps">
          <PipeStep num="STEP 01" title="Configure sources" meta={counts.platform} />
          <PipeStep num="STEP 02" title="Fetch questions"   meta={`${counts.questions} fields`} />
          <PipeStep num="STEP 03" title="Compose charts"    meta={`${counts.charts} charts`} />
          <PipeStep num="STEP 04" title="Build report"      meta={counts.template} />
        </div>
        <div className="pipe-strip__history">
          <span className="pipe-strip__history-label">Run history</span>
          <span className="pipe-strip__history-sub">last 24 runs · <b>all green</b></span>
          <Sparkline data={RUN_HISTORY} tone="accent" width={120} height={32} />
        </div>
      </div>

      {/* ── KPI tiles ── */}
      <div className="kpi-grid">
        <KpiTile
          label="Submissions"  value={FORMAT_NUM(submissions)}
          delta={{ tone: 'up', text: `+${FORMAT_NUM(submissions - SUBMISSIONS_HIST[0])}` }}
          icon={<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="12" height="10" rx="2"/><line x1="2" y1="6" x2="14" y2="6"/></svg>}
          tone="accent"  spark={{ data: SUBMISSIONS_HIST, tone: 'accent' }}
        />
        <KpiTile
          label="Reports rendered" value={String(counts.reports)}
          delta={{ tone: 'up', text: `+${Math.max(0, counts.reports - REPORTS_HIST[0])}` }}
          icon={<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 2h7l3 3v9H3z"/><polyline points="10 2 10 5 13 5"/></svg>}
          tone="green"  spark={{ data: REPORTS_HIST, tone: 'green' }}
        />
        <KpiTile
          label="Indicators live" value={String(counts.indicators)}
          delta={{ tone: 'flat', text: counts.indicators === INDICATORS_HIST.at(-1) ? '0' : `${counts.indicators - INDICATORS_HIST.at(-1) >= 0 ? '+' : ''}${counts.indicators - INDICATORS_HIST.at(-1)}` }}
          icon={<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="2 12 6 8 9 11 14 4"/></svg>}
          tone="warm"   spark={{ data: INDICATORS_HIST, tone: 'warm' }}
        />
        <KpiTile
          label="Last run" value={RUNS[0].duration}
          delta={{ tone: 'up', text: '−1.2s faster' }}
          icon={<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6"/><polyline points="8 5 8 8 10 9"/></svg>}
          tone="rose"  spark={{ data: LASTRUN_HIST, tone: 'rose' }}
        />
      </div>

      {/* ── runs + AI suggestions ── */}
      <div className="dash-two-col">
        <div className="dash-card">
          <div className="dash-card__head">
            <div>
              <h3>Pipeline runs</h3>
              <div className="sub">Last 30 days · all triggers</div>
            </div>
            <button className="dash-card__link">View full log →</button>
          </div>
          <table className="runs-table">
            <thead>
              <tr>
                <th>When</th><th>Trigger</th><th>Status</th><th>Duration</th><th>Rows</th><th>Output</th>
              </tr>
            </thead>
            <tbody>
              {RUNS.map((r, i) => (
                <tr key={i}>
                  <td>
                    <div className="when">
                      <span className="day">{r.when.day}</span>
                      <span className="time">{r.when.time}</span>
                    </div>
                  </td>
                  <td>
                    <div className="trigger">
                      <span>{r.trigger.type}</span>
                      <span className="by">· {r.trigger.by}</span>
                    </div>
                  </td>
                  <td>
                    <span className="status-pill" data-tone={r.status.tone}>
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><circle cx="5" cy="5" r="3"/></svg>
                      {r.status.label}
                      {r.status.age && <span className="status-pill__age">{r.status.age}</span>}
                    </span>
                  </td>
                  <td className="mono">{r.duration}</td>
                  <td className="mono">{FORMAT_NUM(r.rows)}</td>
                  <td className="mono" style={{ color: 'var(--ink-2)' }}>{r.output}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="dash-card">
          <div className="dash-card__head">
            <div>
              <h3>AI suggestions <span style={{ color: 'var(--ink-3)', fontWeight: 600 }}>· {AI_SUGGESTIONS.length}</span></h3>
              <div className="sub" style={{ fontFamily: 'var(--font-sans)', fontSize: 12 }}>Generated proposals waiting for your review</div>
            </div>
            <button className="dash-card__link">Open composition →</button>
          </div>
          <div className="ai-list">
            {AI_SUGGESTIONS.map(s => (
              <div className="ai-row" key={s.id}>
                <span className="ai-row__icon" data-tone={s.tone}>{s.icon}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="ai-row__name">
                    {s.name}
                    <span className="tag tag--accent">AI</span>
                  </div>
                  <div className="ai-row__sub">{s.detail}</div>
                  <div className="ai-row__time">{s.age}</div>
                </div>
                <div className="ai-row__actions">
                  <button className="btn btn-ghost btn-sm">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>
                    Preview
                  </button>
                  <button className="btn btn-primary btn-sm">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 8 7 12 13 4"/></svg>
                    Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── usage / plan / help strip ── */}
      <UsageStrip
        submissions={submissions}
        reports={counts.reports}
      />

      {/* ── run-pipeline wizard ── */}
      {wizardOpen && (
        <RunPipelineWizard
          running={running}
          activeCmd={activeCmd}
          onClose={() => setWizardOpen(false)}
          onRun={(cmd) => run(cmd)}
        />
      )}

      <BottomTerminal
        project={counts.formAlias || 'databridge'}
        cmd={activeCmd}
        lines={logLines}
        onClear={() => setLogLines([])}
        open={termOpen}
        setOpen={setTermOpen}
      />
    </div>
  );
}

// ── usage / plan / help strip ────────────────────────────────────────────────
function UsageStrip({ submissions, reports }) {
  const limit = { submissions: 50000, ai: 500000, reports: 20, storage: 10 };
  const ai = 184300;     // mock — no AI usage endpoint yet
  const storage = 2.4;   // mock GB
  return (
    <div className="usage-strip">
      <div className="usage-card">
        <h3>Project usage · this month</h3>
        <div className="usage-bars">
          <UsageBar tone="accent" label="Submissions ingested" cur={submissions} max={limit.submissions} fmt={n => n.toLocaleString()} />
          <UsageBar tone="warm"   label="AI tokens (gpt-4o)"    cur={ai}          max={limit.ai}          fmt={n => `${n.toLocaleString()}tok`} />
          <UsageBar tone="green"  label="Reports generated"     cur={reports}     max={limit.reports}     fmt={n => String(n)} />
          <UsageBar tone="violet" label="Storage"               cur={storage}     max={limit.storage}     fmt={n => `${n} GB`} />
        </div>
      </div>

      <div className="usage-card plan-card">
        <div className="plan-card__top">
          <h3>Plan</h3>
          <div className="plan-card__name">Field Pro <span className="tag tag--accent">current</span></div>
          <div className="plan-card__meta">4 active projects · 11 seats</div>
        </div>
        <a className="plan-card__bottom" href="#">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><polyline points="6 4 10 8 6 12"/></svg>
          Manage subscription
        </a>
      </div>

      <div className="usage-card help-card">
        <h3>Help &amp; docs</h3>
        <a href="#"><FileIcon />Pipeline configuration</a>
        <a href="#"><FileIcon />AI Narrative prompts</a>
        <a href="#"><FileIcon />Split-by reports</a>
        <a href="#"><TerminalIcon />CLI reference</a>
      </div>
    </div>
  );
}

function UsageBar({ tone, label, cur, max, fmt }) {
  const pct = Math.min(100, (cur / max) * 100);
  return (
    <div className="usage-bar">
      <div className="usage-bar__head">
        <div className="usage-bar__label">{label}</div>
        <div className="usage-bar__amounts"><b>{fmt(cur)}</b> / {fmt(max)}</div>
      </div>
      <div className="usage-bar__track">
        <div className="usage-bar__fill" data-tone={tone} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const FileIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 2h7l3 3v9H3z"/><polyline points="10 2 10 5 13 5"/></svg>
);
const TerminalIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 4 7 8 3 12"/><line x1="9" y1="12" x2="13" y2="12"/></svg>
);

// ── sub-components ───────────────────────────────────────────────────────────
function PipeStep({ num, title, meta, state = 'done' }) {
  return (
    <div className="pipe-step" data-state={state}>
      <div className="pipe-step__num">{num}</div>
      <div className="pipe-step__head">
        <span className="pipe-step__check">✓</span>
        <span className="pipe-step__title">{title}</span>
      </div>
      <div className="pipe-step__meta">{meta}</div>
    </div>
  );
}

function KpiTile({ label, value, delta, icon, tone = 'accent', spark }) {
  return (
    <div className="kpi-tile">
      <div className="kpi-tile__head">
        <div className="kpi-tile__label">{label}</div>
        <span className="kpi-tile__icon" data-tone={tone}>{icon}</span>
      </div>
      <div className="kpi-tile__value">{value}</div>
      <div className="kpi-tile__delta" data-tone={delta.tone}>
        {delta.tone === 'up'   && '↗'}
        {delta.tone === 'down' && '↘'}
        {delta.tone === 'flat' && '→'}
        {' '}{delta.text}
      </div>
      <div className="kpi-tile__spark">
        <Sparkline data={spark.data} tone={spark.tone} width={150} height={32} />
      </div>
    </div>
  );
}

// ── Run Pipeline wizard modal ────────────────────────────────────────────────
const STEPS = [
  { id: 'fetch-questions',   step: 1, title: 'Fetch questions',   desc: 'Pull XLSForm schema and choice lists from the platform.' },
  { id: 'download',          step: 2, title: 'Download data',     desc: 'Extract submissions, apply filters, write to the configured destination.' },
  { id: 'generate-template', step: 3, title: 'Generate template', desc: 'Build a starter .docx from the charts in config.yml.' },
  { id: 'build-report',      step: 4, title: 'Build report',      desc: 'Fill the template with charts, indicators, and narrative.' },
];

function RunPipelineWizard({ running, activeCmd, onClose, onRun }) {
  const [active, setActive] = useState(0);
  const current = STEPS[active];

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: 560 }}>
        <div className="modal-header">
          <h3>Run pipeline · step {active + 1} of {STEPS.length}</h3>
          <button onClick={onClose}>✕</button>
        </div>

        {/* stepper */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: '14px 20px 4px' }}>
          {STEPS.map((s, i) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 0 }}>
              <button
                onClick={() => setActive(i)}
                style={{
                  width: 28, height: 28, borderRadius: '50%', border: 0,
                  background: i < active ? 'var(--green-soft)' : i === active ? 'var(--accent)' : 'var(--bg-2)',
                  color: i < active ? 'var(--green)' : i === active ? '#fff' : 'var(--ink-3)',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-sans)',
                }}
              >
                {i < active ? '✓' : i + 1}
              </button>
              {i < STEPS.length - 1 && <div style={{ flex: 1, height: 2, background: i < active ? 'var(--green-soft)' : 'var(--border)', margin: '0 6px' }} />}
            </div>
          ))}
        </div>

        <div className="modal-body">
          <div className="page-eyebrow">STEP {String(current.step).padStart(2, '0')}</div>
          <h4 style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)', margin: '4px 0 6px', letterSpacing: '-.015em' }}>
            {current.title}
          </h4>
          <p style={{ color: 'var(--ink-3)', fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>{current.desc}</p>
          {activeCmd === current.id && running && (
            <p style={{ fontSize: 12, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>● Running… check the slide-up log.</p>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', padding: '12px 20px 16px', borderTop: '1px solid var(--border)' }}>
          <button className="btn btn-ghost btn-sm" disabled={active === 0} onClick={() => setActive(a => a - 1)}>← Previous</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" disabled={running} onClick={() => onRun(current.id)}>
              ▶ Run {current.title}
            </button>
            {active < STEPS.length - 1 ? (
              <button className="btn btn-sm" onClick={() => setActive(a => a + 1)}>Next →</button>
            ) : (
              <button className="btn btn-sm" onClick={onClose}>Done</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

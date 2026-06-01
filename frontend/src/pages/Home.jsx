import { useEffect, useState } from 'react';
import yaml from 'js-yaml';
import BottomTerminal from '../components/BottomTerminal.jsx';
import { useToast } from '../components/Toast.jsx';
import { useCommand } from '../hooks/useCommand.js';

// The five ordered workflow stages. Each card deep-links into its stage (and a
// specific sub-page). `navigate(stageId, subId)` is provided by App.
const STAGE_CARDS = [
  {
    id: 'extract', step: '01', label: 'Extract', tone: 'accent',
    desc: 'Connect a Kobo/Ona form, authenticate, and choose your output destinations.',
    subs: [{ id: 'sources', label: 'Sources' }],
    icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 1.5 14 5v6l-6 3.5L2 11V5z"/><path d="M2 5l6 3.5L14 5M8 8.5V15"/></svg>,
  },
  {
    id: 'transform', step: '02', label: 'Transform', tone: 'green',
    desc: 'Clean and label questions, hide non-data fields, validate, and profile the dataset.',
    subs: [{ id: 'questions', label: 'Questions' }, { id: 'validate', label: 'Validate' }, { id: 'profile', label: 'Profile' }],
    icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 5h10M3 5l2-2M3 5l2 2"/><path d="M13 11H3M13 11l-2-2M13 11l-2 2"/></svg>,
  },
  {
    id: 'load', step: '03', label: 'Load', tone: 'violet',
    desc: 'Build derived views and virtual tables — joins and aggregates reused downstream.',
    subs: [{ id: 'views', label: 'Views' }],
    icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2.5" y="3" width="11" height="10" rx="1.5"/><line x1="2.5" y1="6.5" x2="13.5" y2="6.5"/><line x1="6" y1="3" x2="6" y2="13"/></svg>,
  },
  {
    id: 'analyze', step: '04', label: 'Analyze', tone: 'warm',
    desc: 'Indicators, charts, summaries, the results framework — or just ask a question.',
    subs: [{ id: 'composition', label: 'Charts & indicators' }, { id: 'ask', label: 'Ask' }],
    icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><line x1="3.5" y1="13" x2="3.5" y2="8"/><line x1="8" y1="13" x2="8" y2="4"/><line x1="12.5" y1="13" x2="12.5" y2="10"/></svg>,
  },
  {
    id: 'present', step: '05', label: 'Present', tone: 'rose',
    desc: 'Generate Word reports from your composition and manage report templates.',
    subs: [{ id: 'reports', label: 'Reports' }, { id: 'templates', label: 'Templates' }],
    icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 2h7l3 3v9H3z"/><polyline points="10 2 10 5 13 5"/></svg>,
  },
];

export default function Home({ navigate }) {
  const toast = useToast();
  const [termOpen, setTermOpen] = useState(false);
  const [logLines, setLogLines] = useState([]);
  const [autoCharts, setAutoCharts] = useState(false);
  const [formAlias, setFormAlias] = useState('');

  const nowTime = () => {
    const d = new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
  };

  const { run, running, activeCmd } = useCommand({
    onLog: (line, level) => setLogLines(prev => [...prev, { line, level, time: nowTime() }]),
    onStatus: ({ command, status }) => {
      if (status === 'running') { setLogLines([]); setTermOpen(true); }
      if (status === 'success') toast(`${command} done ✓`, 'ok');
      if (status === 'error')   toast(`${command} failed`, 'err');
    },
  });

  useEffect(() => {
    (async () => {
      try {
        const c = await (await fetch('/api/config')).json();
        const cfg = yaml.load(c.content || '') || {};
        setFormAlias(cfg.form?.alias || '');
      } catch { /* ignore */ }
    })();
  }, []);

  const go = (stageId, subId) => (e) => { e?.stopPropagation?.(); navigate(stageId, subId); };

  return (
    <div className="home-page">
      <div className="home-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="greeting__date">DATABRIDGE · WORKFLOW</div>
          <h1 className="home-head__title">Your data analysis <em>pipeline.</em></h1>
          <div className="home-head__sub">
            Five stages from raw submissions to a finished report. Jump into any stage below, or run the whole pipeline end to end.
          </div>
        </div>
        <div className="home-head__actions">
          <label className="run-opt" title="If no charts are configured, auto-create a starter set from your questions">
            <input type="checkbox" checked={autoCharts} onChange={(e) => setAutoCharts(e.target.checked)} disabled={running} />
            Auto-create charts
          </label>
          <button className="btn" onClick={() => setTermOpen(o => !o)}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="3 4 7 8 3 12"/><line x1="9" y1="12" x2="13" y2="12"/></svg>
            Terminal
          </button>
          <button className="btn btn-primary" onClick={() => run('run-all', { auto_charts: autoCharts })} disabled={running}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><polygon points="4 3 13 8 4 13"/></svg>
            {running && activeCmd === 'run-all' ? 'Running…' : 'Run pipeline'}
          </button>
        </div>
      </div>

      <div className="home-cards">
        {STAGE_CARDS.map((s, i) => (
          <div
            className="home-card"
            data-tone={s.tone}
            key={s.id}
            role="button"
            tabIndex={0}
            onClick={() => navigate(s.id, s.subs[0].id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(s.id, s.subs[0].id); } }}
          >
            <div className="home-card__top">
              <span className="home-card__step">{s.step}</span>
              <span className="home-card__icon" data-tone={s.tone}>{s.icon}</span>
            </div>
            <div className="home-card__label">{s.label}</div>
            <div className="home-card__desc">{s.desc}</div>
            <div className="home-card__subs">
              {s.subs.map(sub => (
                <button key={sub.id} className="home-card__sub" onClick={go(s.id, sub.id)}>{sub.label}</button>
              ))}
            </div>
            {i < STAGE_CARDS.length - 1 && <span className="home-card__arrow" aria-hidden="true">→</span>}
          </div>
        ))}
      </div>

      <BottomTerminal
        project={formAlias || 'databridge'}
        cmd={activeCmd}
        lines={logLines}
        onClear={() => setLogLines([])}
        open={termOpen}
        setOpen={setTermOpen}
      />
    </div>
  );
}

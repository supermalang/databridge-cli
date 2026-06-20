import { ExpressBanner } from './Templates.jsx';

// The five ordered workflow stages. Each card deep-links into its stage (and a
// specific sub-page). `navigate(stageId, subId)` is provided by App.
const STAGE_CARDS = [
  {
    id: 'extract', step: '01', label: 'Extract', tone: 'accent',
    desc: 'Connect a Kobo, Ona, or INFORM form and configure the AI provider.',
    subs: [{ id: 'connection', label: 'Connection' }, { id: 'ai', label: 'AI configuration' }],
    icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 1.5 14 5v6l-6 3.5L2 11V5z"/><path d="M2 5l6 3.5L14 5M8 8.5V15"/></svg>,
  },
  {
    id: 'transform', step: '02', label: 'Transform', tone: 'green',
    desc: 'Clean and label questions, hide non-data fields, then profile and validate the dataset.',
    subs: [{ id: 'questions', label: 'Questions' }, { id: 'profile', label: 'Profile' }, { id: 'validate', label: 'Validate' }],
    icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 5h10M3 5l2-2M3 5l2 2"/><path d="M13 11H3M13 11l-2-2M13 11l-2 2"/></svg>,
  },
  {
    id: 'model', step: '03', label: 'Model', tone: 'violet',
    desc: 'Build derived views — virtual tables of joins and aggregates, computed once and reused downstream.',
    subs: [{ id: 'views', label: 'Views' }],
    icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 1.8 14.2 5 8 8.2 1.8 5z"/><path d="M2 8l6 3.2L14 8"/><path d="M2 11l6 3.2L14 11"/></svg>,
  },
  {
    id: 'analyze', step: '04', label: 'Analyze', tone: 'warm',
    desc: 'Build charts, indicators, summaries, and the results framework — or just ask a question of your data.',
    subs: [{ id: 'composition', label: 'Charts & indicators' }, { id: 'ask', label: 'Ask' }],
    icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><line x1="3.5" y1="13" x2="3.5" y2="8"/><line x1="8" y1="13" x2="8" y2="4"/><line x1="12.5" y1="13" x2="12.5" y2="10"/></svg>,
  },
  {
    id: 'present', step: '05', label: 'Deliver', tone: 'rose',
    desc: 'Export data to files or a database, set report output options, then generate and manage Word reports.',
    subs: [{ id: 'output', label: 'Output' }, { id: 'reports', label: 'Reports' }, { id: 'templates', label: 'Templates' }],
    icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 2h7l3 3v9H3z"/><polyline points="10 2 10 5 13 5"/></svg>,
  },
];

// The terminal itself now lives in App (one global instance present on every
// tab). Home triggers pipeline runs through the hoisted `run`/`running`/
// `activeCmd` props and toggles the shared terminal via the same event the
// topbar button uses.
export default function Home({ navigate }) {
  const toggleTerminal = () => window.dispatchEvent(new CustomEvent('databridge:toggle-terminal'));

  const go = (stageId, subId) => (e) => { e?.stopPropagation?.(); navigate(stageId, subId); };

  // Discoverability: jump straight to the express template-fill flow on the
  // Templates tab. The 5-step pipeline below remains the default path.
  const openExpress = () => {
    navigate('present', 'templates');
    // Defer so the Templates pane has mounted before it receives the open signal.
    setTimeout(() => window.dispatchEvent(new CustomEvent('databridge:open-express')), 0);
  };

  return (
    <div className="page">
      <ExpressBanner onOpen={openExpress} />

      <div className="home-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="greeting__date">DATABRIDGE · WORKFLOW</div>
          <h1 className="home-head__title">Your data analysis <em>pipeline.</em></h1>
          <div className="home-head__sub">
            Five stages from raw submissions to a finished report. Jump into any stage below, or run the whole pipeline end to end.
          </div>
        </div>
        <div className="home-head__actions">
          <button className="btn" onClick={toggleTerminal}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="3 4 7 8 3 12"/><line x1="9" y1="12" x2="13" y2="12"/></svg>
            Terminal
          </button>
        </div>
      </div>

      <div className="home-cards">
        {STAGE_CARDS.map((s, i) => (
          <div className="home-card-wrap" key={s.id}>
            <button
              type="button"
              className="home-card"
              data-tone={s.tone}
              aria-label={`${s.label} — ${s.desc}`}
              onClick={() => navigate(s.id, s.subs[0].id)}
            >
              <span className="home-card__top">
                <span className="home-card__step">{s.step}</span>
                <span className="home-card__icon" data-tone={s.tone}>{s.icon}</span>
              </span>
              <span className="home-card__label">{s.label}</span>
              <span className="home-card__desc">{s.desc}</span>
            </button>
            <div className="home-card__subs">
              {s.subs.map(sub => (
                <button key={sub.id} type="button" className="home-card__sub" onClick={go(s.id, sub.id)}>{sub.label}</button>
              ))}
            </div>
            {i < STAGE_CARDS.length - 1 && <span className="home-card__arrow" aria-hidden="true">→</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

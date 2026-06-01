import { useEffect, useState } from 'react';
import Home from './pages/Home.jsx';
import Sources from './pages/Sources.jsx';
import Questions from './pages/Questions.jsx';
import Validate from './pages/Validate.jsx';
import Profile from './pages/Profile.jsx';
import Composition from './pages/Composition.jsx';
import Ask from './pages/Ask.jsx';
import Reports from './pages/Reports.jsx';
import Templates from './pages/Templates.jsx';

// Composition backs two stages with different card/section sets.
const VIEWS_SECTIONS   = ['views'];
const ANALYZE_SECTIONS = ['charts', 'indicators', 'tables', 'summaries', 'framework', 'pii'];

// The workflow: Home + five ordered stages. Stages with >1 sub render a
// secondary sub-tab strip; single-sub stages navigate straight to their page.
const STAGES = [
  { id: 'home', label: 'Home', home: true },
  { id: 'extract', label: 'Extract', subs: [
    { id: 'connection', label: 'Connection & output', render: () => <Sources section="setup" /> },
    { id: 'ai',         label: 'AI configuration',     render: () => <Sources section="ai" /> },
  ] },
  { id: 'transform', label: 'Transform', subs: [
    { id: 'questions', label: 'Questions', render: () => <Questions /> },
    { id: 'profile',   label: 'Profile',   render: () => <Profile /> },
    { id: 'validate',  label: 'Validate',  render: () => <Validate /> },
  ] },
  { id: 'load', label: 'Load', subs: [
    { id: 'views', label: 'Views', render: () => <Composition sections={VIEWS_SECTIONS} /> },
  ] },
  { id: 'analyze', label: 'Analyze', subs: [
    { id: 'ask',         label: 'Ask',                  render: () => <Ask /> },
    { id: 'composition', label: 'Charts & indicators', render: () => <Composition sections={ANALYZE_SECTIONS} /> },
  ] },
  { id: 'present', label: 'Present', subs: [
    { id: 'templates', label: 'Templates', render: () => <Templates /> },
    { id: 'reports',   label: 'Reports',   render: () => <Reports /> },
  ] },
];

const PROJECT = { name: 'PCP Mauritania', slug: 'pcp_mauritanie_v1', avatar: 'MR' };
const USER = { initials: 'MK' };

function ActivePeriodChip() {
  const [cur, setCur] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const data = await (await fetch('/api/periods')).json();
        setCur(data.current);
      } catch { /* noop */ }
    })();
  }, []);
  if (!cur) return null;
  return (
    <span className="period-chip">
      Period: <strong>{cur}</strong>
    </span>
  );
}

export default function App() {
  const [stageId, setStageId] = useState('home');
  const [subId, setSubId] = useState(null);

  const navigate = (nextStage, nextSub) => {
    const stage = STAGES.find(s => s.id === nextStage) || STAGES[0];
    setStageId(stage.id);
    setSubId(stage.home ? null : (nextSub || stage.subs[0].id));
  };

  const [visited, setVisited] = useState(() => new Set(['home']));

  const stage = STAGES.find(s => s.id === stageId) || STAGES[0];
  const subs = stage.subs || [];
  const activeSub = stage.home ? null : (subs.find(s => s.id === subId) || subs[0]);
  const showSubBar = !stage.home && subs.length > 1;
  const activeKey = stage.home ? 'home' : `${stage.id}/${activeSub?.id}`;

  // Keep-alive panes: a tab mounts on first visit (lazy), then stays mounted but
  // hidden when you leave — so its fetched data, edits, and scroll are retained.
  const panes = [{ key: 'home', render: () => <Home navigate={navigate} /> }];
  for (const s of STAGES) {
    if (!s.subs) continue;
    for (const sub of s.subs) panes.push({ key: `${s.id}/${sub.id}`, render: sub.render });
  }

  useEffect(() => {
    setVisited(prev => (prev.has(activeKey) ? prev : new Set(prev).add(activeKey)));
  }, [activeKey]);

  return (
    <div className="layout">
      <header>
        <div className="brand">
          <h1>databridge-cli</h1>
          <span className="badge">v1.0</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
          <ActivePeriodChip />
          <button className="project-switcher" title="Switch project" type="button">
            <span className="project-switcher__avatar">{PROJECT.avatar}</span>
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
              <span className="project-switcher__name">{PROJECT.name}</span>
              <span className="project-switcher__slug">{PROJECT.slug}</span>
            </span>
            <span className="project-switcher__chev">▾</span>
          </button>
          <button className="iconbtn" title="Terminal" onClick={() => window.dispatchEvent(new CustomEvent('databridge:toggle-terminal'))}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 4 7 8 3 12"/><line x1="9" y1="12" x2="13" y2="12"/></svg>
          </button>
          <button className="iconbtn" title="Notifications">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2a4 4 0 0 0-4 4v3l-1.5 2h11L12 9V6a4 4 0 0 0-4-4z"/><path d="M6.5 13a1.5 1.5 0 0 0 3 0"/></svg>
          </button>
          <button className="iconbtn iconbtn--avatar" title="Account">{USER.initials}</button>
        </div>
      </header>

      <nav className="tabs-bar">
        {STAGES.map(s => (
          <div
            key={s.id}
            className={`tab ${stageId === s.id ? 'active' : ''}`}
            data-tab={s.id}
            onClick={() => navigate(s.id)}
          >
            {s.label}
          </div>
        ))}
      </nav>

      {showSubBar && (
        <nav className="subtabs-bar">
          {subs.map(sub => (
            <div
              key={sub.id}
              className={`subtab ${activeSub?.id === sub.id ? 'active' : ''}`}
              onClick={() => setSubId(sub.id)}
            >
              {sub.label}
            </div>
          ))}
        </nav>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1, minHeight: 0 }}>
        {panes
          .filter(p => visited.has(p.key) || p.key === activeKey)
          .map(p => (
            <div
              key={p.key}
              className="tab-content"
              style={{
                flex: 1, minHeight: 0, overflow: 'auto', flexDirection: 'column',
                display: p.key === activeKey ? 'flex' : 'none',
              }}
            >
              {p.render()}
            </div>
          ))}
      </div>
    </div>
  );
}

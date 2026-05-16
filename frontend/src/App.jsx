import { useEffect, useState } from 'react';
import yaml from 'js-yaml';
import Dashboard from './pages/Dashboard.jsx';
import Sources from './pages/Sources.jsx';
import Questions from './pages/Questions.jsx';
import Composition from './pages/Composition.jsx';
import Reports from './pages/Reports.jsx';
import Templates from './pages/Templates.jsx';
import Validate from './pages/Validate.jsx';

const TABS = [
  { id: 'dashboard',   label: 'Dashboard',                         component: Dashboard },
  { id: 'sources',     label: 'Sources',     step: '1',            component: Sources },
  { id: 'questions',   label: 'Questions',   step: '2',            component: Questions },
  { id: 'validate',    label: 'Validate',    step: '3',            component: Validate },
  { id: 'composition', label: 'Composition', step: '4',            component: Composition },
  { id: 'reports',     label: 'Reports',     step: '5',            component: Reports },
  { id: 'templates',   label: 'Templates',                         component: Templates, secondary: true },
];

const PROJECT = { name: 'PCP Mauritania', slug: 'pcp_mauritanie_v1', avatar: 'MR' };
const USER = { initials: 'MK' };

export default function App() {
  const [active, setActive] = useState('dashboard');
  const [counts, setCounts] = useState({});

  // Load counts (questions / composition / reports) once so the tabs show real chips.
  useEffect(() => {
    (async () => {
      const next = {};
      try {
        const [q, r, c] = await Promise.all([
          fetch('/api/questions').then(r => r.json()).catch(() => ({})),
          fetch('/api/reports').then(r => r.json()).catch(() => ({})),
          fetch('/api/config').then(r => r.json()).catch(() => ({})),
        ]);
        next.questions = q.questions?.length ?? 0;
        next.reports   = r.files?.length     ?? 0;
        const cfg = yaml.load(c.content || '') || {};
        next.composition = ['charts', 'indicators', 'summaries', 'views']
          .reduce((a, k) => a + (Array.isArray(cfg[k]) ? cfg[k].length : 0), 0);
        next.sources = Object.keys(cfg).filter(k => ['api', 'form'].includes(k)).length;
      } catch { /* ignore */ }
      setCounts(next);
    })();
  }, [active]); // refresh counts after each tab switch

  const ActivePage = TABS.find(t => t.id === active).component;

  return (
    <div className="layout">
      <header>
        <div className="brand">
          <h1>databridge-cli</h1>
          <span className="badge">v1.0</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
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
        {TABS.map(t => (
          <div
            key={t.id}
            className={`tab ${active === t.id ? 'active' : ''}`}
            data-tab={t.id}
            onClick={() => setActive(t.id)}
            style={t.secondary ? { marginLeft: 'auto', color: 'var(--ink-3)', fontSize: 12.5 } : undefined}
          >
            {t.step && <span className="tab__num">{t.step}</span>}
            {t.label}
            {counts[t.id] != null && counts[t.id] > 0 && (
              <span className="tab__num" style={{ marginLeft: 4 }}>{counts[t.id]}</span>
            )}
          </div>
        ))}
      </nav>

      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1, minHeight: 0 }}>
        <div className="tab-content active" id={`tab-${active}`} style={{ overflow: 'auto', flex: 1 }}>
          <ActivePage />
        </div>
      </div>
    </div>
  );
}

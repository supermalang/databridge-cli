import { useEffect, useRef, useState } from 'react';
import yaml from 'js-yaml';
import Home from './pages/Home.jsx';
import Sources from './pages/Sources.jsx';
import Questions from './pages/Questions.jsx';
import Validate from './pages/Validate.jsx';
import Profile from './pages/Profile.jsx';
import Composition from './pages/Composition.jsx';
import Ask from './pages/Ask.jsx';
import Reports from './pages/Reports.jsx';
import Templates from './pages/Templates.jsx';
import BottomTerminal from './components/BottomTerminal.jsx';
import Modal from './components/Modal.jsx';
import ProjectMembersModal from './components/ProjectMembersModal.jsx';
import { useToast } from './components/Toast.jsx';
import { useCommand } from './hooks/useCommand.js';
import { fetchMe } from './lib/auth.js';
import { listProjects, activateProject, createProject } from './lib/projects.js';
import { deleteProject as apiDeleteProject } from './lib/members.js';
import { PermsProvider } from './lib/perms.js';
import { RunProvider } from './lib/run.js';
import { AiStatusProvider } from './lib/aiStatus.js';

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

  // Global terminal: a single instance lives here so it's present on every tab
  // (the panel is position:fixed and .layout reserves space for its collapsed
  // bar). Command/log state lives here too, so pipeline-run logs survive tab
  // switches. The topbar terminal button and Home's button both toggle it via
  // the databridge:toggle-terminal event that BottomTerminal listens for.
  const toast = useToast();
  const [termOpen, setTermOpen] = useState(false);
  const [logLines, setLogLines] = useState([]);
  const [formAlias, setFormAlias] = useState('');
  const [me, setMe] = useState(null);
  useEffect(() => { fetchMe().then(setMe); }, []);

  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [projMenuOpen, setProjMenuOpen] = useState(false);
  const [newProjOpen, setNewProjOpen] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [membersFor, setMembersFor] = useState(null);   // project being managed
  const refreshProjects = async () => {
    const { projects, active_id, is_superadmin } = await listProjects();
    setProjects(projects); setActiveProjectId(active_id); setIsSuperadmin(!!is_superadmin);
    return projects;
  };
  useEffect(() => { refreshProjects(); }, []);
  const activeProject = projects.find(p => p.id === activeProjectId) || null;
  const activeRole = activeProject?.role || (isSuperadmin ? 'superadmin' : null);

  const switchProject = async (id) => {
    await activateProject(id);
    setActiveProjectId(id);
    setProjMenuOpen(false);
    window.dispatchEvent(new CustomEvent('databridge:data-changed', { detail: { project: id } }));
  };
  const submitNewProject = async () => {
    const name = newProjName.trim();
    if (!name) return;
    try {
      const { id } = await createProject(name);
      await refreshProjects();
      setNewProjOpen(false); setNewProjName('');
      await switchProject(id);
      toast(`Project "${name}" created`, 'ok');
    } catch (e) { toast(e.message || 'Create failed', 'err'); }
  };
  const removeProject = async (p) => {
    if (!confirm(`Delete project "${p.name}"? This removes its data, reports and members.`)) return;
    try {
      await apiDeleteProject(p.id);
      const updated = await refreshProjects();
      setProjMenuOpen(false);
      if (p.id === activeProjectId && updated[0]) await switchProject(updated[0].id);
      toast(`Deleted "${p.name}"`, 'ok');
    } catch (e) { toast(e.message || 'Delete failed', 'err'); }
  };

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
  const panes = [{ key: 'home', render: () => <Home navigate={navigate} run={run} running={running} activeCmd={activeCmd} /> }];
  for (const s of STAGES) {
    if (!s.subs) continue;
    for (const sub of s.subs) panes.push({ key: `${s.id}/${sub.id}`, render: sub.render });
  }

  useEffect(() => {
    setVisited(prev => (prev.has(activeKey) ? prev : new Set(prev).add(activeKey)));
  }, [activeKey]);

  // Cache invalidation for the keep-alive panes. `epoch` bumps every hour and on
  // any data change (a command finishing, or questions being saved/fetched). A
  // pane's React key carries the epoch it was last mounted at, and is only
  // bumped when the pane becomes active — so a stale tab refreshes when you next
  // open it, and the tab you're currently editing is never yanked out.
  const [epoch, setEpoch] = useState(0);
  const [keyEpoch, setKeyEpoch] = useState({});
  const epochRef = useRef(0);
  useEffect(() => { epochRef.current = epoch; }, [epoch]);

  useEffect(() => {
    setKeyEpoch(prev => (prev[activeKey] === epochRef.current ? prev : { ...prev, [activeKey]: epochRef.current }));
  }, [activeKey]);

  useEffect(() => {
    const bump = () => setEpoch(e => e + 1);
    const id = setInterval(bump, 60 * 60 * 1000);   // hourly
    window.addEventListener('databridge:data-changed', bump);
    return () => { clearInterval(id); window.removeEventListener('databridge:data-changed', bump); };
  }, []);

  return (
    <div className="layout">
      <header>
        <div className="brand">
          <h1>databridge-cli</h1>
          <span className="badge">v1.0</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
          <ActivePeriodChip />
          <div style={{ position: 'relative' }}>
            <button className="project-switcher" title="Switch project" type="button"
                    onClick={() => setProjMenuOpen(o => !o)}>
              <span className="project-switcher__avatar">
                {(activeProject?.name || '?').slice(0, 2).toUpperCase()}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
                <span className="project-switcher__name">{activeProject?.name || 'No project'}</span>
                <span className="project-switcher__slug">{activeProject?.slug || ''}</span>
              </span>
              <span className="project-switcher__chev">▾</span>
            </button>
            {projMenuOpen && (
              <div className="project-menu">
                {projects.map(p => (
                  <div key={p.id}
                       className={`project-menu__item ${p.id === activeProjectId ? 'active' : ''}`}
                       onClick={() => switchProject(p.id)}>
                    {p.name}
                    {p.role && <span className="project-menu__role">{p.role}</span>}
                  </div>
                ))}
                <div className="project-menu__sep" />
                {activeProject && (
                  <div className="project-menu__item"
                       onClick={() => { setMembersFor(activeProject); setProjMenuOpen(false); }}>
                    Manage members…
                  </div>
                )}
                {activeProject && (activeRole === 'admin' || activeRole === 'superadmin') && (
                  <div className="project-menu__item project-menu__danger"
                       onClick={() => removeProject(activeProject)}>
                    Delete “{activeProject.name}”
                  </div>
                )}
                <div className="project-menu__item project-menu__add"
                     onClick={() => { setProjMenuOpen(false); setNewProjName(''); setNewProjOpen(true); }}>
                  + New project
                </div>
              </div>
            )}
          </div>
          <button className="iconbtn" title="Terminal" onClick={() => window.dispatchEvent(new CustomEvent('databridge:toggle-terminal'))}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 4 7 8 3 12"/><line x1="9" y1="12" x2="13" y2="12"/></svg>
          </button>
          <button className="iconbtn" title="Notifications">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2a4 4 0 0 0-4 4v3l-1.5 2h11L12 9V6a4 4 0 0 0-4-4z"/><path d="M6.5 13a1.5 1.5 0 0 0 3 0"/></svg>
          </button>
          {me && me.sub !== 'dev-local' ? (
            <form method="POST" action="/auth/logout" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
              <span className="topbar-user" title={me.email}>{me.email}</span>
              <button type="submit" className="iconbtn" title="Sign out">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 14H3V2h3"/><polyline points="10 11 13 8 10 5"/><line x1="13" y1="8" x2="6" y2="8"/></svg>
              </button>
            </form>
          ) : (
            <button className="iconbtn iconbtn--avatar" title={me?.email || 'Account'}>{USER.initials}</button>
          )}
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

      <PermsProvider value={{ role: activeRole, isSuperadmin }}>
        <RunProvider value={{ run, running, activeCmd }}>
          <AiStatusProvider>
            <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1, minHeight: 0 }}>
              {panes
                .filter(p => visited.has(p.key) || p.key === activeKey)
                .map(p => (
                  <div
                    key={`${p.key}#${keyEpoch[p.key] ?? epoch}`}
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
          </AiStatusProvider>
        </RunProvider>
      </PermsProvider>

      <BottomTerminal
        project={formAlias || 'databridge'}
        cmd={activeCmd}
        lines={logLines}
        onClear={() => setLogLines([])}
        open={termOpen}
        setOpen={setTermOpen}
      />

      {newProjOpen && (
        <Modal title="New project" onClose={() => setNewProjOpen(false)}
               onSave={submitNewProject} saveLabel="Create">
          <label style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
            Project name
          </label>
          <input autoFocus type="text" value={newProjName}
                 onChange={e => setNewProjName(e.target.value)}
                 onKeyDown={e => { if (e.key === 'Enter') submitNewProject(); }}
                 placeholder="e.g. Q3 Monitoring" style={{ width: '100%' }} />
        </Modal>
      )}

      {membersFor && (
        <ProjectMembersModal project={membersFor} onClose={() => { setMembersFor(null); refreshProjects(); }} />
      )}
    </div>
  );
}

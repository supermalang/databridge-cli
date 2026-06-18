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
import { useConfirm } from './components/ConfirmDialog.jsx';
import UserMenu from './components/UserMenu.jsx';
import ProjectForm from './pages/ProjectForm.jsx';
import ProfileForm from './pages/ProfileForm.jsx';
import { useToast } from './components/Toast.jsx';
import { useCommand } from './hooks/useCommand.js';
import { fetchMe } from './lib/auth.js';
import { listProjects, activateProject } from './lib/projects.js';
import { PermsProvider } from './lib/perms.js';
import { RunProvider } from './lib/run.js';
import { DirtyProvider } from './lib/dirty.js';
import { AiStatusProvider } from './lib/aiStatus.js';

// Human-friendly verbs for the active run alert. Falls back to a generic phrasing.
const RUN_LABELS = {
  'build-report': 'Building report…',
  'run-all': 'Building report…',
  download: 'Downloading data…',
  'fetch-questions': 'Fetching questions…',
  'generate-template': 'Generating template…',
};
const runLabel = (cmd) => RUN_LABELS[cmd] || (cmd ? `Running ${cmd}…` : 'Running…');

// Composition backs two stages with different card/section sets.
const VIEWS_SECTIONS   = ['views'];
const ANALYZE_SECTIONS = ['charts', 'indicators', 'tables', 'summaries', 'pii'];

// The workflow: Home + five ordered stages. Stages with >1 sub render a
// secondary sub-tab strip; single-sub stages navigate straight to their page.
const STAGES = [
  { id: 'home', label: 'Home', home: true },
  { id: 'extract', label: 'Extract', subs: [
    { id: 'connection', label: 'Connection',       render: () => <Sources section="setup" /> },
    { id: 'ai',         label: 'AI configuration',  render: () => <Sources section="ai" /> },
  ] },
  { id: 'transform', label: 'Transform', subs: [
    { id: 'questions', label: 'Questions', render: () => <Questions /> },
    { id: 'profile',   label: 'Profile',   render: () => <Profile /> },
    { id: 'validate',  label: 'Validate',  render: () => <Validate /> },
  ] },
  { id: 'model', label: 'Model', subs: [
    { id: 'views', label: 'Views', render: () => <Composition sections={VIEWS_SECTIONS} /> },
  ] },
  { id: 'analyze', label: 'Analyze', subs: [
    { id: 'ask',         label: 'Ask',                  render: () => <Ask /> },
    { id: 'composition', label: 'Charts & indicators', render: () => <Composition sections={ANALYZE_SECTIONS} /> },
  ] },
  { id: 'present', label: 'Deliver', subs: [
    { id: 'output',    label: 'Output',    render: () => <Sources section="output" /> },
    { id: 'templates', label: 'Templates', render: () => <Templates /> },
    { id: 'reports',   label: 'Reports',   render: () => <Reports /> },
  ] },
];

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
  const { confirm, confirmDialog } = useConfirm();
  const [termOpen, setTermOpen] = useState(false);
  const [logLines, setLogLines] = useState([]);
  const [formAlias, setFormAlias] = useState('');
  const [me, setMe] = useState(null);
  useEffect(() => { fetchMe().then(setMe); }, []);

  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [projMenuOpen, setProjMenuOpen] = useState(false);
  const [projectForm, setProjectForm] = useState(null);     // 'create' | project object | null
  const [projectFormTab, setProjectFormTab] = useState('details');   // initial tab for the form
  const [profileOpen, setProfileOpen] = useState(false);    // user profile page overlay
  const refreshProjects = async () => {
    const { projects, active_id, is_superadmin } = await listProjects();
    setProjects(projects); setActiveProjectId(active_id); setIsSuperadmin(!!is_superadmin);
    return projects;
  };
  useEffect(() => { refreshProjects(); }, []);
  const activeProject = projects.find(p => p.id === activeProjectId) || null;
  const activeRole = activeProject?.role || (isSuperadmin ? 'superadmin' : null);
  const activeProjects   = projects.filter(p => !p.is_archived);
  const archivedProjects = projects.filter(p => p.is_archived);

  // Open the multi-tab project form for create / edit / manage-members.
  const openProjectForm = (target, tab = 'details') => {
    setProjMenuOpen(false);
    setProjectFormTab(tab);
    setProjectForm(target);
  };

  // Project switch remounts the keep-alive panes (via the epoch bump below),
  // which discards any in-progress edits — so confirm first if a page is dirty.
  const dirtyRef = useRef(false);
  const switchProject = async (id) => {
    if (id === activeProjectId) { setProjMenuOpen(false); return; }
    if (dirtyRef.current && !await confirm({
      title: 'Discard unsaved changes?',
      message: 'You have unsaved edits on the current page. Switching projects will discard them.',
      confirmLabel: 'Switch & discard',
    })) { setProjMenuOpen(false); return; }
    dirtyRef.current = false;
    await activateProject(id);
    setActiveProjectId(id);
    setProjMenuOpen(false);
    window.dispatchEvent(new CustomEvent('databridge:data-changed', { detail: { project: id } }));
  };
  const nowTime = () => {
    const d = new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
  };

  // The command whose log lines are currently streaming. Each line is tagged
  // with it so the terminal can attribute lines to a pipeline stage. Kept in a
  // ref because onLog's closure would otherwise see a stale value.
  const LOG_CAP = 1500;
  const runningCmdRef = useRef(null);
  const { run, stop, running, activeCmd } = useCommand({
    onLog: (line, level) => setLogLines(prev =>
      [...prev, { line, level, time: nowTime(), command: runningCmdRef.current }].slice(-LOG_CAP)),
    onStatus: ({ command, status }) => {
      if (status === 'running') {
        // Accumulate across runs — don't wipe. Insert a separator so each run is
        // visually distinct in the (now persistent) buffer.
        runningCmdRef.current = command;
        setLogLines(prev =>
          [...prev, { line: `running ${command}`, level: 'cmd', time: nowTime(), command }].slice(-LOG_CAP));
        setTermOpen(true);
      }
      if (status === 'success' || status === 'error') runningCmdRef.current = null;
      if (status === 'success') {
        toast(`${command} done ✓`, 'ok');
        // Collapse the terminal once a task succeeds — but only after a short beat so
        // the final log + result is visible, and only if no new run has started.
        setTimeout(() => { if (!runningCmdRef.current) setTermOpen(false); }, 1400);
      }
      if (status === 'error') {
        toast(`${command} failed`, 'err');
        setTermOpen(true);   // keep it open on failure so the user can read the log
      }
    },
  });

  // Persist the log buffer per project so it survives navigation AND reload.
  // Hydrate when the active project becomes known or changes; mirror back
  // (debounced) on every change.
  const logKey = activeProjectId ? `databridge:termlog:${activeProjectId}` : null;
  const hydratedKeyRef = useRef(null);
  useEffect(() => {
    if (!logKey || hydratedKeyRef.current === logKey) return;
    hydratedKeyRef.current = logKey;
    try {
      const saved = JSON.parse(localStorage.getItem(logKey) || '[]');
      setLogLines(Array.isArray(saved) ? saved : []);
    } catch { setLogLines([]); }
  }, [logKey]);
  useEffect(() => {
    if (!logKey) return;
    const t = setTimeout(() => {
      try { localStorage.setItem(logKey, JSON.stringify(logLines)); } catch { /* quota */ }
    }, 500);
    return () => clearTimeout(t);
  }, [logLines, logKey]);

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
  //
  // The pane key is ALSO scoped to the active project id (see the render below),
  // so switching projects changes every pane's identity and forces a remount +
  // fresh fetch — otherwise the tab open at switch time would keep showing the
  // previous project's settings/files (pages fetch on mount, not on switch).
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
      {running && (
        <div className="run-alert" data-testid="run-alert" role="status" aria-live="polite">
          <span className="run-alert__dot" aria-hidden="true" />
          <span className="run-alert__label">{runLabel(activeCmd)}</span>
          <button
            type="button"
            className="run-alert__logs"
            onClick={() => window.dispatchEvent(new CustomEvent('databridge:toggle-terminal'))}
          >
            View logs
          </button>
          <button
            type="button"
            className="run-alert__stop"
            data-testid="run-stop"
            aria-label="Stop the running task"
            onClick={() => stop()}
          >
            Stop
          </button>
        </div>
      )}
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
                {activeProjects.map(p => (
                  <div key={p.id}
                       className={`project-menu__item ${p.id === activeProjectId ? 'active' : ''}`}
                       onClick={() => switchProject(p.id)}>
                    <span className="project-menu__label">{p.name}</span>
                    <span className="project-menu__right">
                      {p.role && <span className="project-menu__role">{p.role}</span>}
                      {(p.role === 'admin' || p.role === 'superadmin' || isSuperadmin) && (
                        <button className="project-menu__gear" title="Project settings"
                                onClick={(e) => { e.stopPropagation(); openProjectForm(p); }}>
                          ⚙
                        </button>
                      )}
                    </span>
                  </div>
                ))}
                {archivedProjects.length > 0 && (
                  <>
                    <div className="project-menu__sep" />
                    <div className="project-menu__grouplabel">Archived</div>
                    {archivedProjects.map(p => (
                      <div key={p.id} className="project-menu__item project-menu__archived">
                        <span className="project-menu__label">{p.name}</span>
                        {(p.role === 'admin' || p.role === 'superadmin' || isSuperadmin) && (
                          <button className="project-menu__gear" title="Project settings"
                                  onClick={(e) => { e.stopPropagation(); openProjectForm(p); }}>
                            ⚙
                          </button>
                        )}
                      </div>
                    ))}
                  </>
                )}
                <div className="project-menu__sep" />
                {activeProject && (
                  <div className="project-menu__item"
                       onClick={() => openProjectForm(activeProject, 'members')}>
                    Manage members…
                  </div>
                )}
                <div className="project-menu__item project-menu__add"
                     onClick={() => openProjectForm('create')}>
                  + New project
                </div>
              </div>
            )}
          </div>
          <button className="iconbtn" title="Terminal" onClick={() => window.dispatchEvent(new CustomEvent('databridge:toggle-terminal'))}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 4 7 8 3 12"/><line x1="9" y1="12" x2="13" y2="12"/></svg>
          </button>
          <UserMenu me={me} role={activeRole} isSuperadmin={isSuperadmin}
                    onOpenProfile={() => setProfileOpen(true)} />
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
        <RunProvider value={{ run, stop, running, activeCmd }}>
         <DirtyProvider value={dirtyRef}>
          <AiStatusProvider>
            <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1, minHeight: 0 }}>
              {panes
                .filter(p => visited.has(p.key) || p.key === activeKey)
                .map(p => (
                  <div
                    key={`${p.key}@${activeProjectId ?? 'none'}#${keyEpoch[p.key] ?? epoch}`}
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
         </DirtyProvider>
        </RunProvider>
      </PermsProvider>

      <BottomTerminal
        project={formAlias || 'databridge'}
        cmd={activeCmd}
        lines={logLines}
        open={termOpen}
        setOpen={setTermOpen}
      />

      {projectForm && (
        <div className="project-form-overlay">
          <ProjectForm
            mode={projectForm}
            initialTab={projectFormTab}
            canAdmin={projectForm !== 'create' &&
                      (projectForm.role === 'admin' || projectForm.role === 'superadmin' || isSuperadmin)}
            onChanged={refreshProjects}
            onDone={async (pid) => {
              const wasCreate = projectForm === 'create';
              setProjectForm(null);
              const updated = await refreshProjects();
              // If the form created a new project, switch to it.
              if (wasCreate && pid && updated.some(p => p.id === pid)) {
                await switchProject(pid);
              }
            }}
          />
        </div>
      )}

      {profileOpen && (
        <div className="project-form-overlay">
          <ProfileForm
            me={me}
            onDone={() => setProfileOpen(false)}
            onSaved={(u) => setMe(prev => ({ ...prev, ...u }))}
          />
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

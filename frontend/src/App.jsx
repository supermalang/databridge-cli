import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { listProjects, activateProject, archiveProject } from './lib/projects.js';
import { PermsProvider } from './lib/perms.js';
import { RunProvider } from './lib/run.js';
import { DirtyProvider } from './lib/dirty.js';
import { AiStatusProvider } from './lib/aiStatus.js';
import { tabProps, panelProps, panelId, makeTabKeydown } from './lib/tabs.js';
import { setLanguage } from './lib/i18n.js';
import { setActiveProject as setCacheProject, swr } from './lib/cache.js';

// Human-friendly verbs for the active run alert. Falls back to a generic phrasing.
// `t` is the i18next translator threaded in from the component (labels localized).
const RUN_LABEL_KEYS = {
  'build-report': 'shell.runBuilding',
  'run-all': 'shell.runBuilding',
  download: 'shell.runDownloading',
  'fetch-questions': 'shell.runFetching',
  'generate-template': 'shell.runGenerating',
};
const runLabel = (t, cmd) =>
  (RUN_LABEL_KEYS[cmd] && t(RUN_LABEL_KEYS[cmd])) ||
  (cmd ? t('shell.runGeneric', { cmd }) : t('shell.runDefault'));

// Project identity swatch (avatar) styling. The color is user-chosen IDENTITY, not
// an action color (One Voice Rule: it never competes with teal CTAs). Pick legible
// text (white vs ink) per-color by WCAG relative luminance so even a light project
// color keeps the emoji / two-letter fallback readable (AA target).
const _srgb = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const swatchTextColor = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  const L = 0.2126 * _srgb((n >> 16) & 255) + 0.7152 * _srgb((n >> 8) & 255) + 0.0722 * _srgb(n & 255);
  // Contrast of white (L=1) vs ink (#0B1220, L≈0.0086) against this bg; pick the higher.
  const cWhite = 1.05 / (L + 0.05);
  const cInk = (L + 0.05) / (0.0086 + 0.05);
  return cWhite >= cInk ? '#fff' : '#0B1220';
};
const swatchStyle = (color) => (color ? { background: color, color: swatchTextColor(color) } : undefined);

// How long the terminal stays open at the start of a run before auto-collapsing
// to its bar (the run keeps going). Overridable via window.__TERM_COLLAPSE_MS so
// the E2E can drive the timing in a few ms instead of waiting the real ~5s.
const DEFAULT_TERM_COLLAPSE_MS = 5000;
const termCollapseMs = () => {
  const v = typeof window !== 'undefined' ? window.__TERM_COLLAPSE_MS : undefined;
  return Number.isFinite(v) ? v : DEFAULT_TERM_COLLAPSE_MS;
};

// Composition backs two stages with different card/section sets.
const VIEWS_SECTIONS   = ['views'];
const ANALYZE_SECTIONS = ['charts', 'indicators', 'tables', 'summaries', 'pii'];

// The workflow: Home + five ordered stages. Stages with >1 sub render a
// secondary sub-tab strip; single-sub stages navigate straight to their page.
// `labelKey` resolves through the i18n bundles so both the primary nav tabs
// (I18N-1) and the secondary sub-tab strips (I18N-5, via `home.subs.<id>`)
// switch language live; the primary stages keep an English `label` fallback for
// non-localized uses (aria-labels). Sub-tabs render purely via `t(labelKey)` —
// no user-facing prose literal lives in the data array (guarded by check:i18n).
const STAGES = [
  { id: 'home', label: 'Home', labelKey: 'nav.home', home: true },
  { id: 'extract', label: 'Extract', labelKey: 'nav.extract', subs: [
    { id: 'connection', labelKey: 'home.subs.connection', render: () => <Sources section="setup" /> },
    { id: 'ai',         labelKey: 'home.subs.ai',         render: () => <Sources section="ai" /> },
  ] },
  { id: 'transform', label: 'Transform', labelKey: 'home.stages.transform.label', subs: [
    { id: 'questions', labelKey: 'home.subs.questions', render: () => <Questions /> },
    { id: 'profile',   labelKey: 'home.subs.profile',   render: () => <Profile /> },
    { id: 'validate',  labelKey: 'home.subs.validate',  render: () => <Validate /> },
  ] },
  { id: 'model', label: 'Model', labelKey: 'home.stages.model.label', subs: [
    { id: 'views', labelKey: 'home.subs.views', render: () => <Composition sections={VIEWS_SECTIONS} /> },
  ] },
  { id: 'analyze', label: 'Analyze', labelKey: 'nav.analyze', subs: [
    { id: 'ask',         labelKey: 'home.subs.ask',         render: () => <Ask /> },
    { id: 'composition', labelKey: 'home.subs.composition', render: () => <Composition sections={ANALYZE_SECTIONS} /> },
  ] },
  { id: 'present', label: 'Deliver', labelKey: 'nav.deliver', subs: [
    { id: 'output',    labelKey: 'home.subs.output',    render: () => <Sources section="output" /> },
    { id: 'templates', labelKey: 'home.subs.templates', render: () => <Templates /> },
    { id: 'reports',   labelKey: 'home.subs.reports',   render: () => <Reports /> },
  ] },
];

function ActivePeriodChip({ projectId }) {
  const [cur, setCur] = useState(null);
  useEffect(() => {
    if (!projectId) return;
    (async () => {
      try {
        const data = await (await fetch('/api/periods')).json();
        setCur(data.current);
      } catch { /* noop */ }
    })();
  }, [projectId]);
  if (!cur) return null;
  return (
    <span className="period-chip">
      Period: <strong>{cur}</strong>
    </span>
  );
}

export default function App() {
  const { t } = useTranslation();
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

  // Auto-collapse timing (XTF-11 / hardened in XTF-18): on a build run the
  // terminal opens, then after ~5s auto-collapses to its bar while the run keeps
  // streaming; on error it auto-expands. The arming is anchored to the run
  // LIFECYCLE — the `running` effect below fires when a run starts (running
  // false→true) and is GUARANTEED to arm once per run even if no/late `running`
  // SSE frame is processed. That is what makes the express Apply&build path (which
  // chains run() after an awaited /api/template/apply) collapse on the same timing
  // as the regular build. There is always at most ONE pending timer
  // (collapseTimerRef): both the effect and the onStatus `running` re-anchor go
  // through armAutoCollapse(), which clears before it sets — they never stack.
  // We track that single timer plus whether the user has taken manual control so
  // the auto-timing never yanks a terminal the user opened.
  const collapseTimerRef = useRef(null);
  const userOverrodeTermRef = useRef(false);
  const clearCollapseTimer = () => {
    if (collapseTimerRef.current) { clearTimeout(collapseTimerRef.current); collapseTimerRef.current = null; }
  };
  // Open the terminal and (re)arm the single auto-collapse timer. Always clears any
  // pending timer first so callers never stack two timers — there is at most one
  // collapseTimerRef live at a time. The fire callback collapses only if the user
  // hasn't taken manual control in the meantime.
  const armAutoCollapse = () => {
    setTermOpen(true);
    clearCollapseTimer();
    collapseTimerRef.current = setTimeout(() => {
      collapseTimerRef.current = null;
      if (!userOverrodeTermRef.current) setTermOpen(false);
    }, termCollapseMs());
  };
  // Wrap setTermOpen so any manual toggle (nav button / bar click) marks the
  // terminal as user-controlled and cancels a pending auto-collapse.
  const setTermOpenManual = (next) => {
    userOverrodeTermRef.current = true;
    clearCollapseTimer();
    setTermOpen(next);   // accepts a value or a functional updater (o => !o)
  };
  const [formAlias, setFormAlias] = useState('');
  const [me, setMe] = useState(null);
  useEffect(() => {
    fetchMe().then((u) => {
      setMe(u);
      // Apply the user's saved interface language on load (re-applied on every
      // reload + relogin since it comes from the server). Defaults to English.
      if (u) setLanguage(u.language);
    });
  }, []);
  // Clear any pending auto-collapse timer on unmount.
  useEffect(() => () => clearCollapseTimer(), []);

  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [projMenuOpen, setProjMenuOpen] = useState(false);
  const projSwitcherRef = useRef(null);   // trigger — focus returns here on Escape (mirrors Modal)
  const projMenuRef = useRef(null);        // dropdown — ArrowDown moves roving focus into here
  const [projectForm, setProjectForm] = useState(null);     // 'create' | project object | null
  const [projectFormTab, setProjectFormTab] = useState('details');   // initial tab for the form
  const [profileOpen, setProfileOpen] = useState(false);    // user profile page overlay
  const refreshProjects = async () => {
    const { projects, active_id, is_superadmin } = await listProjects();
    // Namespace the SWR cache to the active project BEFORE the panes (re)mount so
    // each project's reads/writes land in its own namespace (PERF-4).
    setCacheProject(active_id);
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
  // UX-9: a single "switching…" indicator covers the activate + hydrate window.
  // `switching` drives the visible/live-region cue; `switchingRef` coalesces
  // overlapping switches so exactly one indicator ever shows and it never gets
  // stuck on — a second click while a switch is in flight is ignored.
  const [switching, setSwitching] = useState(false);
  const switchingRef = useRef(false);
  const switchProject = async (id) => {
    if (id === activeProjectId) { setProjMenuOpen(false); return; }
    if (switchingRef.current) { setProjMenuOpen(false); return; }
    if (dirtyRef.current && !await confirm({
      title: t('shell.discardTitle'),
      message: t('shell.discardMessage'),
      confirmLabel: t('shell.discardConfirm'),
    })) { setProjMenuOpen(false); return; }
    dirtyRef.current = false;
    switchingRef.current = true;
    setSwitching(true);
    try {
      await activateProject(id);
      // Re-namespace the SWR cache to the target project BEFORE the panes remount,
      // so project B never reads A's cache and a return to A is an instant hit. The
      // data-changed event below carries `detail.project`, so the cache treats it as
      // a switch (no invalidation) — see lib/cache.js (PERF-4).
      setCacheProject(id);
      setActiveProjectId(id);
      setProjMenuOpen(false);
      window.dispatchEvent(new CustomEvent('databridge:data-changed', { detail: { project: id } }));
    } finally {
      switchingRef.current = false;
      setSwitching(false);
    }
  };

  // Bring an archived project back to the active group. Archived rows are not
  // switchable (no body onClick); Unarchive is their only action.
  const unarchiveProject = async (id) => {
    await archiveProject(id, false);
    await refreshProjects();
  };

  // Escape closes the open project menu and returns focus to the trigger —
  // mirrors the Modal.jsx Escape/focus contract. Document-level so it fires
  // wherever focus sits inside the menu (rows are focusable but not modal).
  useEffect(() => {
    if (!projMenuOpen) return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setProjMenuOpen(false);
      projSwitcherRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [projMenuOpen]);

  // ArrowDown from the trigger opens the menu (if needed) and moves roving focus
  // to the first menu item. Enter/Space open the menu (native <button> activation
  // also fires onClick, so this only handles ArrowDown specially).
  const onSwitcherKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setProjMenuOpen(true);
      // Defer until the menu has rendered, then focus its first item.
      requestAnimationFrame(() => {
        projMenuRef.current?.querySelector('.project-menu__item')?.focus();
      });
    }
  };

  // Enter/Space on a focused project row activate it (matches the row onClick).
  const onRowKeyDown = (id) => (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      switchProject(id);
    }
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
        // The auto-collapse is primarily armed by the run-lifecycle effect keyed on
        // `running` (below), so it is GUARANTEED to arm once per run even if no/late
        // `running` SSE frame is processed. As a belt-and-braces re-anchor we also
        // (re)open + (re)arm here on each `running` frame unless the user has taken
        // control — the timer is the SAME single collapseTimerRef (cleared first),
        // so this never stacks multiple timers; it just re-bases the ~delay window
        // onto the latest observed "still running" signal.
        if (!userOverrodeTermRef.current) armAutoCollapse();
      }
      if (status === 'success' || status === 'error') runningCmdRef.current = null;
      if (status === 'success') {
        toast(t('shell.runDone', { cmd: command }), 'ok');
        // Leave the pending auto-collapse timer alone: a build of ANY duration ends
        // up collapsed ~delay after it STARTED (this also collapses short builds
        // that finish before the delay), unless errored or user-overridden.
      }
      if (status === 'error') {
        toast(t('shell.runFailed', { cmd: command }), 'err');
        // Auto-expand so the failure log is visible, unless the user is in control.
        clearCollapseTimer();
        if (!userOverrodeTermRef.current) setTermOpen(true);
      }
    },
  });

  // Run-lifecycle auto-collapse (XTF-18 hardening of XTF-11). Keyed on the run
  // state from useCommand: when a run STARTS (running false→true) we reclaim
  // auto-control, open the terminal, and arm the single collapse timer. Because
  // this is anchored to the lifecycle transition — not to whether any individual
  // `running` SSE frame was processed — arming is GUARANTEED once per run, and it
  // fires identically for the regular build and the express Apply&build path
  // (which only differs by an awaited /api/template/apply before run()). This is
  // the fix for the express path that previously never collapsed. armAutoCollapse
  // shares one collapseTimerRef with the onStatus re-anchor, so timers never stack.
  //
  // The timer fires once and collapses the terminal if the user hasn't taken
  // control, EVEN if the build is still streaming or has just finished — so a
  // build of any duration ends up collapsed ~delay after it started (errors and
  // manual overrides are handled in onStatus / setTermOpenManual respectively).
  const prevRunningRef = useRef(false);
  useEffect(() => {
    if (running && !prevRunningRef.current) {
      // A run just started: reclaim auto-control and arm the single collapse timer.
      userOverrodeTermRef.current = false;
      armAutoCollapse();
    }
    prevRunningRef.current = running;
  }, [running, activeCmd]);

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

  // Onboarding readiness (PUX-2): Home shows a first-run / empty state with a
  // single recommended next action until the project has a connected form AND
  // downloaded data. Reuse the existing /api/state readiness flags
  // (has_questions / has_data) consumed elsewhere (Templates XTF-9). Re-fetch on
  // a data change so the first-run state clears once prerequisites are met.
  // null = readiness not yet resolved (avoids flashing either Home state before
  // /api/state answers; Home holds its card render until this is known).
  const [homeReady, setHomeReady] = useState(null);
  useEffect(() => {
    let alive = true;
    // Reset to unknown on project switch so the previous project's Home state
    // never flashes during a switch — cards are held until the new /api/state
    // resolves (PUX-6).
    setHomeReady(null);
    const load = async () => {
      try {
        // SWR persisted tier (PERF-4): /api/state is small non-sensitive readiness
        // metadata, so it is cached to disk — a hard reload resolves Home's state
        // instantly while it revalidates.
        await swr('/api/state', async () => {
          const res = await fetch('/api/state');
          // A non-OK response (4xx/5xx) must NOT coerce to ready=false — leave
          // readiness unknown (null → cards held) so a returning user is never
          // shown the first-run state on a transient/auth error (PUX-6).
          if (!res.ok) throw new Error(`state ${res.status}`);
          return await res.json();
        }, (s) => {
          if (alive) setHomeReady(!!(s.has_questions && s.has_data));
        });
      } catch { /* parse error / non-JSON / non-OK → leave as-is (unknown, held) */ }
    };
    load();
    window.addEventListener('databridge:data-changed', load);
    return () => { alive = false; window.removeEventListener('databridge:data-changed', load); };
  }, [activeProjectId]);

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
  const panes = [{ key: 'home', render: () => <Home navigate={navigate} ready={homeReady} run={run} running={running} activeCmd={activeCmd} /> }];
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

  // The in-page run alert (XTF-14): rendered in the content flow, below the top
  // nav and the page header, at the content width. Shown whenever a run is live.
  const runAlert = running ? (
    <div className="run-alert" data-testid="run-alert" role="status" aria-live="polite">
      <span className="run-alert__dot" aria-hidden="true" />
      <span className="run-alert__label">{runLabel(t, activeCmd)}</span>
      <button
        type="button"
        className="run-alert__logs"
        onClick={() => window.dispatchEvent(new CustomEvent('databridge:toggle-terminal'))}
      >
        {t('shell.viewLogs')}
      </button>
      <button
        type="button"
        className="run-alert__stop"
        data-testid="run-stop"
        aria-label={t('shell.stopTask')}
        title={t('shell.stopTask')}
        onClick={() => stop()}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="currentColor" />
        </svg>
      </button>
    </div>
  ) : null;

  return (
    <div className="layout">
      <header>
        <div className="brand">
          <h1>databridge-cli</h1>
          <span className="badge">v1.0</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
          <ActivePeriodChip projectId={activeProjectId} />
          <div style={{ position: 'relative' }}>
            <button className="project-switcher" title={t('shell.switchProject')} type="button"
                    ref={projSwitcherRef}
                    aria-haspopup="menu"
                    aria-expanded={projMenuOpen}
                    onClick={() => setProjMenuOpen(o => !o)}
                    onKeyDown={onSwitcherKeyDown}>
              <span className="project-switcher__avatar"
                    style={swatchStyle(activeProject?.color)}>
                {activeProject?.icon || (activeProject?.name || '?').slice(0, 2).toUpperCase()}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
                <span className="project-switcher__name">{activeProject?.name || t('common.noProject')}</span>
                <span className="project-switcher__slug">{activeProject?.slug || ''}</span>
              </span>
              <span className="project-switcher__chev">▾</span>
            </button>
            {projMenuOpen && (
              <div className="project-menu" role="menu" ref={projMenuRef}>
                {activeProjects.map(p => (
                  <div key={p.id}
                       className={`project-menu__item ${p.id === activeProjectId ? 'active' : ''}`}
                       role="menuitem" tabIndex={0}
                       onClick={() => switchProject(p.id)}
                       onKeyDown={onRowKeyDown(p.id)}>
                    <span className="project-menu__avatar"
                          style={swatchStyle(p.color)}>
                      {p.icon || (p.name || '?').slice(0, 2).toUpperCase()}
                    </span>
                    <span className="project-menu__label">{p.name}</span>
                    <span className="project-menu__right">
                      {p.role && <span className="project-menu__role">{p.role}</span>}
                      {(p.role === 'admin' || p.role === 'superadmin' || isSuperadmin) && (
                        <button className="project-menu__gear" title={t('shell.projectSettings')}
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
                    <div className="project-menu__grouplabel">{t('shell.archived')}</div>
                    {archivedProjects.map(p => (
                      <div key={p.id} className="project-menu__item project-menu__archived">
                        <span className="project-menu__label">{p.name}</span>
                        <span className="project-menu__right">
                          <button className="project-menu__unarchive"
                                  type="button"
                                  data-testid="project-unarchive"
                                  title={t('shell.unarchiveTitle')}
                                  onClick={(e) => { e.stopPropagation(); unarchiveProject(p.id); }}>
                            {t('shell.unarchive')}
                          </button>
                          {(p.role === 'admin' || p.role === 'superadmin' || isSuperadmin) && (
                            <button className="project-menu__gear" title={t('shell.projectSettings')}
                                    onClick={(e) => { e.stopPropagation(); openProjectForm(p); }}>
                              ⚙
                            </button>
                          )}
                        </span>
                      </div>
                    ))}
                  </>
                )}
                <div className="project-menu__sep" />
                {activeProject && (
                  <div className="project-menu__item"
                       role="menuitem" tabIndex={0}
                       onClick={() => openProjectForm(activeProject, 'members')}
                       onKeyDown={(e) => {
                         if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                           e.preventDefault(); openProjectForm(activeProject, 'members');
                         }
                       }}>
                    {t('shell.manageMembers')}
                  </div>
                )}
                <div className="project-menu__item project-menu__add"
                     role="menuitem" tabIndex={0}
                     onClick={() => openProjectForm('create')}
                     onKeyDown={(e) => {
                       if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                         e.preventDefault(); openProjectForm('create');
                       }
                     }}>
                  {t('shell.newProject')}
                </div>
              </div>
            )}
          </div>
          {switching && (
            <div className="project-switching" data-testid="project-switching"
                 role="status" aria-live="polite">
              <span className="project-switching__spinner" aria-hidden="true" />
              <span className="project-switching__label">{t('shell.switchingProject')}</span>
            </div>
          )}
          <button className="iconbtn" title={t('shell.terminal')} onClick={() => window.dispatchEvent(new CustomEvent('databridge:toggle-terminal'))}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 4 7 8 3 12"/><line x1="9" y1="12" x2="13" y2="12"/></svg>
          </button>
          <UserMenu me={me} role={activeRole} isSuperadmin={isSuperadmin}
                    onOpenProfile={() => setProfileOpen(true)} />
        </div>
      </header>

      <nav
        className="tabs-bar"
        role="tablist"
        aria-label={t('shell.workflowStages')}
        data-tab-group="primary"
        onKeyDown={makeTabKeydown('primary', STAGES.map(s => s.id), stageId, (id) => navigate(id))}
      >
        {STAGES.map(s => (
          <button
            key={s.id}
            type="button"
            className={`tab ${stageId === s.id ? 'active' : ''}`}
            data-tab={s.id}
            {...tabProps('primary', s.id, stageId === s.id)}
            onClick={() => navigate(s.id)}
          >
            {s.labelKey ? t(s.labelKey) : s.label}
          </button>
        ))}
      </nav>

      {showSubBar && (
        <nav
          className="subtabs-bar"
          role="tablist"
          aria-label={t('shell.stageSections', { stage: stage.labelKey ? t(stage.labelKey) : stage.label })}
          data-tab-group="sub"
          onKeyDown={makeTabKeydown('sub', subs.map(sub => sub.id), activeSub?.id, (id) => setSubId(id))}
        >
          {subs.map(sub => (
            <button
              key={sub.id}
              type="button"
              className={`subtab ${activeSub?.id === sub.id ? 'active' : ''}`}
              {...tabProps('sub', sub.id, activeSub?.id === sub.id)}
              onClick={() => setSubId(sub.id)}
            >
              {sub.labelKey ? t(sub.labelKey) : sub.label}
            </button>
          ))}
        </nav>
      )}

      <PermsProvider value={{ role: activeRole, isSuperadmin }}>
        <RunProvider value={{ run, stop, running, activeCmd }}>
         <DirtyProvider value={dirtyRef}>
          <AiStatusProvider>
            <main style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1, minHeight: 0 }}>
              {runAlert}
              {panes
                .filter(p => visited.has(p.key) || p.key === activeKey)
                .map(p => {
                  const isActive = p.key === activeKey;
                  // The visible pane is the tabpanel controlled by the active
                  // primary tab (aria-controls → panelId('primary', stageId));
                  // when a sub-tab strip is shown it is ALSO the panel controlled
                  // by the active sub tab, so it carries both id refs (primary id
                  // on the wrapper, sub id on the inner content).
                  const wrapperPanel = isActive ? panelProps('primary', stageId) : {};
                  const subPanel = isActive && showSubBar ? panelProps('sub', activeSub?.id) : {};
                  return (
                    <div
                      key={`${p.key}@${activeProjectId ?? 'none'}#${keyEpoch[p.key] ?? epoch}`}
                      className="tab-content"
                      {...wrapperPanel}
                      tabIndex={isActive ? 0 : undefined}
                      style={{
                        flex: 1, minHeight: 0, overflow: 'auto', flexDirection: 'column',
                        display: isActive ? 'flex' : 'none',
                      }}
                    >
                      {showSubBar
                        ? <div {...subPanel} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>{p.render()}</div>
                        : p.render()}
                    </div>
                  );
                })}
            </main>
          </AiStatusProvider>
         </DirtyProvider>
        </RunProvider>
      </PermsProvider>

      <BottomTerminal
        project={formAlias || 'databridge'}
        cmd={activeCmd}
        lines={logLines}
        open={termOpen}
        setOpen={setTermOpenManual}
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

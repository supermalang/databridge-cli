import { useEffect, useRef, useState } from 'react';

const LEVELS = ['info', 'ok', 'warn', 'error'];

// Sessions mirror the app's pipeline: a "Pipeline" parent (shows every line)
// over the same five ordered stages as the top nav (App.jsx STAGES). Selecting a
// stage filters the shared run log to the lines produced by that stage's
// commands; "Pipeline" shows them all. Stages with no /api/run command today
// (Model, Analyze) are kept for parity with the workflow and show an empty state.
const PIPELINE_TREE = [
  { id: 'pipeline',  label: 'Pipeline',  depth: 0, parent: true },
  { id: 'extract',   label: 'Extract',   depth: 1 },
  { id: 'transform', label: 'Transform', depth: 1 },
  { id: 'model',     label: 'Model',     depth: 1 },
  { id: 'analyze',   label: 'Analyze',   depth: 1 },
  { id: 'present',   label: 'Deliver',   depth: 1 },
];

// Maps a run command (from the SSE stream) to the pipeline stage it belongs to.
// Unmapped commands (e.g. run-all, which spans every stage) are only visible
// under the "Pipeline" parent.
const COMMAND_STAGE = {
  'download':          'extract',
  'fetch-questions':   'transform',
  'generate-template': 'present',
  'build-report':      'present',
};

function stageOf(command) {
  return COMMAND_STAGE[command] || null;
}

// Map a raw log-line level (cmd|info|success|warning|error from useCommand) to the
// short label rendered as a colored badge in the terminal view.
function lvlLabel(level) {
  if (!level) return 'INFO';
  const l = level.toLowerCase();
  if (l === 'success') return 'OK';
  if (l === 'warning') return 'WARN';
  if (l === 'error')   return 'ER';
  if (l === 'cmd')     return 'INFO';
  return l.toUpperCase();
}

function lvlGroup(level) {
  const l = (level || 'info').toLowerCase();
  if (l === 'success') return 'ok';
  if (l === 'warning') return 'warn';
  if (l === 'cmd')     return 'info';
  return l; // info | error
}

function nowTime() {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0')).join(':');
}

// Sticky bottom terminal — collapsed to a slim bar, expands to ~50vh.
// Props:
//   project    project alias shown in the bar
//   cmd        currently-running command (or null)
//   lines      array of { line, level, time?, command? }
//   open, setOpen  hoisted state so the topbar terminal icon can toggle it
export default function BottomTerminal({ project = 'databridge', cmd, lines = [], open, setOpen }) {
  const [session, setSession] = useState('pipeline');
  const [filters, setFilters] = useState(() => new Set(LEVELS));
  const bodyRef = useRef(null);

  // auto-scroll on new lines
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [lines, open]);

  // app-wide hotkey: the topbar terminal button dispatches this to toggle us.
  useEffect(() => {
    const onToggle = () => setOpen(o => !o);
    window.addEventListener('databridge:toggle-terminal', onToggle);
    return () => window.removeEventListener('databridge:toggle-terminal', onToggle);
  }, [setOpen]);

  const toggleFilter = (l) => setFilters(prev => {
    const next = new Set(prev);
    if (next.has(l)) next.delete(l); else next.add(l);
    return next;
  });

  const byStage = (l) => session === 'pipeline' || stageOf(l.command) === session;
  const filtered = (lines || []).filter(l => filters.has(lvlGroup(l.level)) && byStage(l));

  return (
    <div className="bottom-term" data-open={open ? 'true' : 'false'}>
      <div className="bottom-term__bar">
        <button
          type="button"
          className="bottom-term__bar-toggle"
          aria-expanded={open}
          aria-label={`Terminal — ${cmd ? `running ${cmd}` : 'idle'}. ${open ? 'Collapse' : 'Expand'}.`}
          onClick={() => setOpen(!open)}
        >
          <span className="dot" style={{ background: cmd ? 'var(--warm)' : 'var(--green)' }} />
          <span className="sr-only">{cmd ? 'Running' : 'Idle'}</span>
          <span className="bottom-term__bar-title">terminal</span>
          <span className="bottom-term__bar-sep">·</span>
          <span>{project}</span>
          {cmd && <>
            <span className="bottom-term__bar-sep">·</span>
            <span className="bottom-term__bar-cmd">databridge run --{cmd}</span>
          </>}
        </button>
        <div className="bottom-term__bar-actions">
          <button title={open ? 'Close' : 'Open'} aria-label={open ? 'Close terminal' : 'Open terminal'} onClick={() => setOpen(!open)}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              {open ? <><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></>
                    : <><polyline points="4 10 8 6 12 10"/></>}
            </svg>
          </button>
        </div>
      </div>

      <div className="bottom-term__body">
        <aside className="bottom-term__side">
          <div className="bottom-term__side-label">Sessions</div>
          <ul>
            {PIPELINE_TREE.map(s => (
              <li
                key={s.id}
                data-depth={s.depth}
                data-active={session === s.id}
                className={s.parent ? 'bottom-term__session-parent' : undefined}
                onClick={() => setSession(s.id)}
              >
                <span
                  className="dot"
                  style={s.parent ? { background: cmd ? 'var(--warm)' : 'var(--green)' } : undefined}
                />{s.label}
              </li>
            ))}
          </ul>
          <div className="bottom-term__side-label">Filter</div>
          <ul>
            {LEVELS.map(l => (
              <li key={l} onClick={() => toggleFilter(l)}>
                <input type="checkbox" checked={filters.has(l)} onChange={() => toggleFilter(l)} />
                <span style={{
                  color: { info: '#7BB6EF', ok: '#74D49D', warn: '#E8C374', error: '#EE8A98' }[l]
                }}>{l}</span>
              </li>
            ))}
          </ul>
        </aside>

        <div className="bottom-term__main" ref={bodyRef} role="log" aria-live="polite" aria-label="Pipeline execution log">
          {filtered.length === 0 ? (
            <div style={{ color: '#5a6473', fontStyle: 'italic' }}>Awaiting log lines…</div>
          ) : (
            filtered.map((l, i) => (
              <div className="log" key={i}>
                <span className="log__time">{l.time || nowTime()}</span>
                <span className="log__lvl" data-lvl={lvlLabel(l.level)}>{lvlLabel(l.level)}</span>
                <span className="log__msg">{l.line}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';

const LEVELS = ['info', 'ok', 'warn', 'error'];

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
//   lines      array of { line, level, time? }
//   onClear    optional callback for the trash icon
//   open, setOpen  hoisted state so the topbar terminal icon can toggle it
export default function BottomTerminal({ project = 'databridge', cmd, lines = [], onClear, open, setOpen }) {
  const [session, setSession] = useState('pipeline.run');
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

  const filtered = (lines || []).filter(l => filters.has(lvlGroup(l.level)));

  return (
    <div className="bottom-term" data-open={open ? 'true' : 'false'}>
      <div className="bottom-term__bar" onClick={() => setOpen(!open)}>
        <span className="dot" style={{ background: cmd ? 'var(--warm)' : 'var(--green)' }} />
        <span className="bottom-term__bar-title">terminal</span>
        <span className="bottom-term__bar-sep">·</span>
        <span>{project}</span>
        <span className="bottom-term__bar-sep">·</span>
        <span>ttyd</span>
        {cmd && <>
          <span className="bottom-term__bar-sep">·</span>
          <span className="bottom-term__bar-cmd">databridge run --{cmd}</span>
        </>}
        <div className="bottom-term__bar-actions" onClick={(e) => e.stopPropagation()}>
          <button title="Clear log" onClick={onClear}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 4h10M6 4V2.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5V4M4.5 4l.5 9a.5.5 0 0 0 .5.5h5a.5.5 0 0 0 .5-.5l.5-9"/></svg>
          </button>
          <button title="Split" onClick={() => setOpen(true)}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="12" height="10" rx="1.5"/><line x1="8" y1="3" x2="8" y2="13"/></svg>
          </button>
          <button title="Settings">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/></svg>
          </button>
          <button title={open ? 'Close' : 'Open'} onClick={() => setOpen(!open)}>
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
            <li data-active={session === 'pipeline.run'} onClick={() => setSession('pipeline.run')}>
              <span className="dot" />pipeline.run
            </li>
            <li data-active={session === 'fetch.questions'} onClick={() => setSession('fetch.questions')}>
              <span className="dot" />fetch.questions
            </li>
            <li data-active={session === 'shell'} onClick={() => setSession('shell')}>
              <span className="dot" />shell (ttyd)
            </li>
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

        <div className="bottom-term__main" ref={bodyRef}>
          {session === 'shell' ? (
            <iframe className="bottom-term__shell" src="/terminal/" title="ttyd terminal" />
          ) : filtered.length === 0 ? (
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

import { useEffect, useRef } from 'react';

// Auto-scrolling dark log panel; receives log entries from the Dashboard.
export default function LogPanel({ title, lines, onClear }) {
  const bodyRef = useRef(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="log-panel">
      <div className="log-header">
        <span>{title}</span>
        <button className="btn btn-ghost btn-sm" onClick={onClear}>Clear</button>
      </div>
      <div className="log-body" ref={bodyRef}>
        {lines.length === 0 ? (
          <span className="log-empty">No commands run yet.</span>
        ) : (
          lines.map((l, i) => (
            <div key={i} className={`log-line ${l.level || 'info'}`}>{l.line}</div>
          ))
        )}
      </div>
    </div>
  );
}

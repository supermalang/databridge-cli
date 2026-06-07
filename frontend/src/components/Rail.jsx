// Shared right-rail toolkit used across data-heavy pages (Extract, Questions,
// Validate, Composition, Reports). One layout + two standard cards (Status,
// Quick actions) so every page's rail looks and behaves the same. Page-specific
// cards (Project info, Tips, reference panels) are passed in as extra children.

// ── Layout: main column + sticky 320px aside ─────────────────────────────────
// Pass `rail` to get the two-column grid; omit it and children render full-width.
export function RailLayout({ children, rail }) {
  if (!rail) return <>{children}</>;
  return (
    <div className="rail-layout">
      <div className="rail-layout__main">{children}</div>
      <aside className="rail-layout__aside">
        <div className="rail">{rail}</div>
      </aside>
    </div>
  );
}

// ── Status card ──────────────────────────────────────────────────────────────
// checks: [{ tone: 'ok'|'warn'|'rose', label, sub }]
const ToneIcon = ({ tone }) => (
  <span className="check-list__icon" data-tone={tone}>
    {tone === 'ok' ? (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 8 7 12 13 4" /></svg>
    ) : tone === 'rose' ? (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" /></svg>
    ) : (
      <svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="11" r="1" /><rect x="7" y="3" width="2" height="6" rx="1" /></svg>
    )}
  </span>
);

export function StatusCard({ checks = [], title = 'Status' }) {
  const okCount = checks.filter(c => c.tone === 'ok').length;
  return (
    <div className="rail-card">
      <div className="rail-card__title">{title}
        <span className="tag tag--green" style={{ fontSize: 9.5 }}>{okCount}/{checks.length}</span>
      </div>
      <div className="check-list">
        {checks.map((c, i) => (
          <div key={i} className="check-list__item">
            <ToneIcon tone={c.tone} />
            <div className="check-list__main">
              <div className="check-list__label">{c.label}</div>
              {c.sub && <div className="check-list__sub">{c.sub}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Quick actions card ───────────────────────────────────────────────────────
// actions: [{ icon, label, onClick, disabled, title }] — falsy entries skipped
export function QuickActionsCard({ actions = [], title = 'Quick actions' }) {
  const items = actions.filter(Boolean);
  if (items.length === 0) return null;
  return (
    <div className="rail-card">
      <div className="rail-card__title">{title}</div>
      {items.map((a, i) => (
        <button key={i} className="rail-action" onClick={a.onClick} disabled={a.disabled} title={a.title || ''}>
          {a.icon}
          {a.label}
        </button>
      ))}
    </div>
  );
}

// ── A few reusable action glyphs (14×14, stroke = currentColor) ───────────────
export const RailIcons = {
  refresh: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><polyline points="2 4 2 8 6 8" /><path d="M3 11a6 6 0 1 0 1.4-7" /></svg>,
  plug: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M5 2v4M11 2v4M4 6h8v2a4 4 0 0 1-8 0z" /><line x1="8" y1="12" x2="8" y2="15" /></svg>,
  folder: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" /></svg>,
  copy: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="5" width="8" height="9" rx="1.5" /><path d="M3 11V3a1 1 0 0 1 1-1h7" /></svg>,
  save: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 8 7 12 13 4" /></svg>,
  sparkle: <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1l1.3 4.2L13.5 6.5 9.3 7.8 8 12 6.7 7.8 2.5 6.5l4.2-1.3z" /></svg>,
  download: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8 2v8" /><polyline points="4.5 7 8 10.5 11.5 7" /><path d="M3 13h10" /></svg>,
  play: <svg viewBox="0 0 16 16" fill="currentColor"><polygon points="4 3 13 8 4 13" /></svg>,
  doc: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M4 2h5l3 3v9H4z" /><path d="M9 2v3h3" /></svg>,
  eye: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" /><circle cx="8" cy="8" r="2" /></svg>,
  shield: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M8 2l5 2v4c0 3-2 5-5 6-3-1-5-3-5-6V4z" /></svg>,
};

// Placeholder body for pages that haven't been ported yet.
export default function Stub({ label }) {
  return (
    <div style={{ padding: '0 28px 40px' }}>
      <div className="form-section">
        <div className="form-section-title">{label} <span>— not yet ported to React</span></div>
        <p style={{ color: 'var(--ink-3)', fontSize: 13, lineHeight: 1.6 }}>
          The visual shell and design tokens are live. The interactive UI for this page
          (forms, tables, log streaming, modals) still lives in the legacy
          <code style={{ fontFamily: 'var(--font-mono)', padding: '1px 5px', background: 'var(--bg-2)', borderRadius: 4, margin: '0 4px' }}>index.html</code>
          and will be ported incrementally.
        </p>
      </div>
    </div>
  );
}

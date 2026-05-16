import { useEffect, useState } from 'react';
import PageHeader from './PageHeader.jsx';

export default function Validate() {
  const [report, setReport] = useState(null);   // null | { n_rows, n_columns, checks, summary }
  const [error,  setError]  = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const r = await fetch('/api/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) { setError(data.detail || `Request failed (${r.status})`); return; }
        setReport(data);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{ padding: '0 0 40px' }}>
      <PageHeader
        eyebrow="Step 03 · Validate"
        title="Check your"
        accent="data."
        sub="Scan the downloaded submissions for missingness, duplicates, outliers, and type problems before composing charts."
      />
      {loading && <div style={{ color: 'var(--ink-3)', textAlign: 'center', padding: 60 }}>Running validation…</div>}
      {error && (
        <div style={{ padding: 24, color: 'var(--danger, #b91c1c)' }}>
          <div style={{ fontWeight: 600 }}>Validation failed</div>
          <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 13, marginTop: 6 }}>{error}</div>
          <div style={{ marginTop: 8, color: 'var(--ink-3)', fontSize: 12 }}>If no data is downloaded yet, run <strong>Download</strong> in the Dashboard first.</div>
        </div>
      )}
      {report && (
        <div style={{ padding: '0 8px' }}>
          <div style={{ color: 'var(--ink-3)', fontSize: 13, marginBottom: 16 }}>
            Scanned {report.n_rows.toLocaleString()} rows · {report.n_columns} columns ·
            <span style={{ marginLeft: 8, color: 'var(--danger, #b91c1c)' }}>{report.summary.error} errors</span> ·
            <span style={{ marginLeft: 8, color: 'var(--warn, #b45309)' }}>{report.summary.warning} warnings</span> ·
            <span style={{ marginLeft: 8 }}>{report.summary.info} notes</span>
          </div>
          {report.checks.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>No issues found — your data looks clean.</div>
          ) : (
            <div className="validate-findings">
              {report.checks.map((f, i) => (
                <div className="validate-finding" data-severity={f.severity} key={`${f.kind}-${f.column}-${i}`}>
                  <div className="validate-finding__bar" />
                  <div>
                    <div>
                      <span className="validate-finding__column">{f.column}</span>
                      <span className="validate-finding__kind">{f.kind}</span>
                    </div>
                    <div className="validate-finding__msg">{f.message}</div>
                    {f.examples?.length > 0 && (
                      <div className="validate-finding__examples">
                        Examples: {f.examples.map(v => JSON.stringify(v)).join(', ')}
                      </div>
                    )}
                  </div>
                  <div className="validate-finding__count">
                    {f.count.toLocaleString()} row{f.count === 1 ? '' : 's'}
                    <br />
                    <span style={{ color: f.severity === 'error' ? 'var(--danger, #b91c1c)' : f.severity === 'warning' ? 'var(--warn, #b45309)' : 'var(--ink-3)' }}>
                      {(f.pct * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

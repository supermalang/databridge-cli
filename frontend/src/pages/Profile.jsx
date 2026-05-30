import { useEffect, useState } from 'react';
import PageHeader from './PageHeader.jsx';

function ColumnRow({ c }) {
  const detail =
    c.role === 'quantitative' && c.min != null
      ? `min ${c.min} · med ${c.median} · max ${c.max}${c.outlier_count ? ` · ${c.outlier_count} outliers` : ''}`
      : c.role === 'date' && c.min_date
      ? `${String(c.min_date).slice(0, 10)} → ${String(c.max_date).slice(0, 10)} (${c.span_days}d)`
      : c.top_values
      ? c.top_values.slice(0, 4).map(t => `${t.value} (${t.count})`).join(', ')
      : c.high_cardinality
      ? `high cardinality (${c.distinct} distinct)`
      : '';
  return (
    <tr>
      <td style={{ fontWeight: 500 }}>{c.name}</td>
      <td style={{ color: 'var(--ink-3)' }}>{c.role}</td>
      <td>{c.missing_pct != null ? (c.missing_pct * 100).toFixed(1) : '0.0'}%</td>
      <td>{c.distinct}</td>
      <td style={{ color: 'var(--ink-3)', fontSize: 12.5 }}>{detail}</td>
    </tr>
  );
}

export default function Profile() {
  const [profiles, setProfiles] = useState(null);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const r = await fetch('/api/profile');
        const data = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) { setError(data.detail || `Request failed (${r.status})`); return; }
        setProfiles(data.profiles || []);
        setMessage(data.message || null);
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
        eyebrow="Data profile"
        title="Understand your"
        accent="tables."
        sub="A read-only EDA snapshot of every base table: completeness, cardinality, ranges, outliers, and correlations."
      />
      {loading && <div style={{ color: 'var(--ink-3)', textAlign: 'center', padding: 60 }}>Profiling…</div>}
      {error && (
        <div style={{ padding: 24, color: 'var(--danger, #b91c1c)' }}>
          <div style={{ fontWeight: 600 }}>Profiling failed</div>
          <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 13, marginTop: 6 }}>{error}</div>
          <div style={{ marginTop: 8, color: 'var(--ink-3)', fontSize: 12 }}>If no data is downloaded yet, run <strong>Download</strong> in the Dashboard first.</div>
        </div>
      )}
      {profiles && profiles.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>
          {message || 'No data to profile. Run Download first.'}
        </div>
      )}
      {profiles && profiles.map(t => (
        <details key={t.name} open style={{ margin: '0 8px 16px', border: '1px solid var(--line, #e5e7eb)', borderRadius: 8 }}>
          <summary style={{ cursor: 'pointer', padding: '10px 14px', fontWeight: 600 }}>
            {t.name} <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>· {(t.rows ?? 0).toLocaleString()} rows · {(t.columns?.length ?? 0)} columns</span>
          </summary>
          <div style={{ padding: '0 14px 14px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--ink-3)' }}>
                  <th style={{ padding: '6px 8px' }}>Column</th>
                  <th style={{ padding: '6px 8px' }}>Role</th>
                  <th style={{ padding: '6px 8px' }}>Missing</th>
                  <th style={{ padding: '6px 8px' }}>Distinct</th>
                  <th style={{ padding: '6px 8px' }}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {(t.columns || []).filter(c => c.role !== 'linkage').map(c => <ColumnRow key={c.name} c={c} />)}
              </tbody>
            </table>
            {t.correlations?.length > 0 && (
              <div style={{ marginTop: 10, color: 'var(--ink-3)', fontSize: 12.5 }}>
                Correlations: {t.correlations.map(p => `${p.a}↔${p.b} (r=${p.r != null ? p.r.toFixed(2) : 'N/A'})`).join('; ')}
              </div>
            )}
            {t.duplicates && (
              <div style={{ marginTop: 6, color: 'var(--warn, #b45309)', fontSize: 12.5 }}>
                {t.duplicates.duplicate_rows} rows share a duplicated {t.duplicates.id_col} across {t.duplicates.groups} group(s).
              </div>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

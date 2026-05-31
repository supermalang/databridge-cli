import { useEffect, useState } from 'react';

// Threshold bands (see spec). completeness: higher is better; rates: lower is better.
function band(metric, v) {
  if (v === null || v === undefined) return 'na';
  if (metric === 'completeness') return v >= 95 ? 'good' : v >= 80 ? 'warn' : 'bad';
  return v < 5 ? 'good' : v <= 15 ? 'warn' : 'bad';   // outlier_rate, duplicate_rate
}

const fmt = (v) => (v === null || v === undefined ? '—' : `${v.toFixed(1)}%`);

const METRICS = [
  { key: 'completeness',   label: 'Completeness' },
  { key: 'outlier_rate',   label: 'Outlier rate' },
  { key: 'duplicate_rate', label: 'Duplicate rate' },
];

// One sortable, threshold-colored table. Each instance sorts independently.
function DQTable({ rows }) {
  const [sort, setSort] = useState({ key: 'completeness', dir: 'asc' }); // ascending = worst-completeness first
  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  const sorted = [...rows].sort((a, b) => {
    const av = a[sort.key], bv = b[sort.key];
    if (av === null || av === undefined) return 1;   // nulls always last
    if (bv === null || bv === undefined) return -1;
    return sort.dir === 'asc' ? av - bv : bv - av;
  });

  return (
    <table className="dq-table">
      <thead>
        <tr>
          <th>Column</th>
          {METRICS.map((m) => (
            <th key={m.key} className="dq-th--metric" onClick={() => toggleSort(m.key)}>
              {m.label}{sort.key === m.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.column}>
            <td className="dq-td--col">{r.column}</td>
            {METRICS.map((m) => (
              <td key={m.key} className="dq-cell" data-band={band(m.key, r[m.key])}>
                {fmt(r[m.key])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function DataQualityPanel() {
  const [data, setData] = useState(null);   // null | { has_data, rows, tables, message? }
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const r = await fetch('/api/data-quality');
        const body = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) { setError(body.detail || `Request failed (${r.status})`); return; }
        setData(body);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="dq-panel dq-panel--muted">Loading data quality…</div>;
  if (error)   return <div className="dq-panel dq-panel--muted">Data quality unavailable: {error}</div>;
  if (!data || !data.has_data)
    return <div className="dq-panel dq-panel--muted">{data?.message || 'No downloaded data — run Download first.'}</div>;

  const tables = data.tables || [];

  return (
    <div className="dq-panel">
      <div className="dq-panel__title">Data quality overview</div>
      <DQTable rows={data.rows} />
      {tables.map((t) => (
        <div key={t.name} className="dq-subtable">
          <div className="dq-panel__subtitle">{t.name}</div>
          <DQTable rows={t.rows} />
        </div>
      ))}
    </div>
  );
}

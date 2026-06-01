import { useEffect, useState } from 'react';
import { isHidden, indexQuestionsByColumn, buildGroupTree } from '../lib/questionGroups.js';
import GroupTree from './GroupTree.jsx';

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
  const [questionsByColumn, setQuestionsByColumn] = useState(() => new Map());
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
    // Questions are best-effort: failure → empty index (everything "Ungrouped",
    // nothing excluded).
    (async () => {
      try {
        const r = await fetch('/api/questions');
        const body = await r.json().catch(() => ({}));
        if (!cancelled && r.ok) setQuestionsByColumn(indexQuestionsByColumn(body.questions));
      } catch { /* keep empty index */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Drop hidden + PII columns, then group the remaining rows by question group.
  const groupRows = (rows) => {
    const visible = (rows || []).filter((r) => {
      const q = questionsByColumn.get(r.column);
      return !(q && (isHidden(q) || q.pii));
    });
    return buildGroupTree(visible, {
      getPath: (r) => {
        const q = questionsByColumn.get(r.column);
        return q ? q.group : 'Ungrouped';
      },
      getHidden: () => false,
    });
  };

  if (loading) return <div className="dq-panel dq-panel--muted">Loading data quality…</div>;
  if (error)   return <div className="dq-panel dq-panel--muted">Data quality unavailable: {error}</div>;
  if (!data || !data.has_data)
    return <div className="dq-panel dq-panel--muted">{data?.message || 'No downloaded data — run Download first.'}</div>;

  const tables = data.tables || [];
  const mainTree = groupRows(data.rows);
  const renderRows = (rows) => <DQTable rows={rows} />;

  return (
    <div className="dq-panel">
      <div className="dq-panel__title">Data quality overview</div>
      {mainTree.length > 0
        ? <GroupTree tree={mainTree} renderVisible={renderRows} />
        : <div className="dq-panel--muted">No visible columns to report.</div>}
      {tables.map((t) => {
        const tree = groupRows(t.rows);
        if (tree.length === 0) return null;
        return (
          <div key={t.name} className="dq-subtable">
            <div className="dq-panel__subtitle">{t.name}</div>
            <GroupTree tree={tree} renderVisible={renderRows} />
          </div>
        );
      })}
    </div>
  );
}

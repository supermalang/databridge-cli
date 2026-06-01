import { useEffect, useState } from 'react';
import PageHeader from './PageHeader.jsx';
import { isHidden, indexQuestionsByColumn, buildGroupTree, GROUP_LABELS } from '../lib/questionGroups.js';
import GroupTree from '../components/GroupTree.jsx';
import TableTree from '../components/TableTree.jsx';

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

function renderCols(cols) {
  return (
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
        {cols.map(c => <ColumnRow key={c.name} c={c} />)}
      </tbody>
    </table>
  );
}

function visibleColumns(profile, questionsByColumn) {
  return (profile.columns || []).filter(
    c => c.role !== 'linkage' && !isHidden(questionsByColumn.get(c.name))
  );
}

// One table's body: columns grouped by SUB-structure (the table's own path
// prefix is stripped so we don't repeat the outer tree), plus correlations/dupes.
function TableBody({ profile, tablePath, questionsByColumn }) {
  const cols = visibleColumns(profile, questionsByColumn);
  const tree = buildGroupTree(cols, {
    getPath: (c) => {
      const q = questionsByColumn.get(c.name);
      let g = q ? (q.group || '') : GROUP_LABELS.UNGROUPED;
      if (tablePath && g.startsWith(tablePath)) g = g.slice(tablePath.length).replace(/^\//, '');
      return g;
    },
    getHidden: () => false,
  });
  // No real sub-groups → render the columns flat (skip the "— no group —" wrapper).
  const flat = tree.length === 1 && tree[0].children.length === 0;
  return (
    <div style={{ padding: '2px 8px 10px' }}>
      {cols.length === 0
        ? <div style={{ color: 'var(--ink-3)', fontSize: 12.5, padding: '4px 0' }}>No visible columns.</div>
        : flat ? renderCols(tree[0].visible) : <GroupTree tree={tree} renderVisible={renderCols} />}
      {profile.correlations?.length > 0 && (
        <div style={{ marginTop: 10, color: 'var(--ink-3)', fontSize: 12.5 }}>
          Correlations: {profile.correlations.map(p => `${p.a}↔${p.b} (r=${p.r != null ? p.r.toFixed(2) : 'N/A'})`).join('; ')}
        </div>
      )}
      {profile.duplicates && (
        <div style={{ marginTop: 6, color: 'var(--warn, #b45309)', fontSize: 12.5 }}>
          {profile.duplicates.duplicate_rows} rows share a duplicated {profile.duplicates.id_col} across {profile.duplicates.groups} group(s).
        </div>
      )}
    </div>
  );
}

export default function Profile() {
  const [profiles, setProfiles] = useState(null);
  const [questionsByColumn, setQuestionsByColumn] = useState(() => new Map());
  const [san2slash, setSan2slash] = useState({});   // sanitized group path → slash path
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
    (async () => {
      try {
        const r = await fetch('/api/questions');
        const data = await r.json().catch(() => ({}));
        if (cancelled || !r.ok) return;
        const qs = data.questions || [];
        setQuestionsByColumn(indexQuestionsByColumn(qs));
        const m = {};
        for (const q of qs) if (q.group) m[q.group.replace(/\//g, '_')] = q.group;
        setSan2slash(m);
      } catch { /* keep flat */ }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{ padding: '0 0 40px' }}>
      <PageHeader
        eyebrow="Data profile"
        title="Understand your"
        accent="tables."
        sub="A read-only EDA snapshot of every base table, arranged as a tree of accordions: main, its repeat groups, and their sub-groups. Open a table to inspect its columns."
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
      {profiles && profiles.length > 0 && (
        <div style={{ padding: '0 8px' }}>
          <TableTree
            tables={profiles}
            resolveSlash={(key) => san2slash[key] || key}
            tableMeta={(p) => `${(p.rows ?? 0).toLocaleString()} rows · ${visibleColumns(p, questionsByColumn).length} columns`}
            renderBody={(p, slash) => <TableBody profile={p} tablePath={slash} questionsByColumn={questionsByColumn} />}
          />
        </div>
      )}
    </div>
  );
}

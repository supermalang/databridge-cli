import { useEffect, useState } from 'react';
import PageHeader from './PageHeader.jsx';
import { isHidden, indexQuestionsByColumn, buildGroupTree, GROUP_LABELS } from '../lib/questionGroups.js';
import GroupTree from '../components/GroupTree.jsx';
import TableTree from '../components/TableTree.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { SkeletonPanel } from '../components/Skeleton.jsx';
import { swr } from '../lib/cache.js';

// Data-quality threshold bands (merged from the former Validate DQ overview).
// completeness: higher is better; outlier/duplicate rates: lower is better.
function dqBand(metric, v) {
  if (v === null || v === undefined) return 'na';
  if (metric === 'completeness') return v >= 95 ? 'good' : v >= 80 ? 'warn' : 'bad';
  return v < 5 ? 'good' : v <= 15 ? 'warn' : 'bad';
}
const dqFmt = (v) => (v === null || v === undefined ? '—' : `${v.toFixed(1)}%`);

function ColumnRow({ c, m }) {
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
      <td className="dq-cell" data-band={dqBand('completeness', m?.completeness)}>{dqFmt(m?.completeness)}</td>
      <td className="dq-cell" data-band={dqBand('outlier_rate', m?.outlier_rate)}>{dqFmt(m?.outlier_rate)}</td>
      <td className="dq-cell" data-band={dqBand('duplicate_rate', m?.duplicate_rate)}>{dqFmt(m?.duplicate_rate)}</td>
      <td>{c.distinct}</td>
      <td style={{ color: 'var(--ink-3)', fontSize: 12.5 }}>{detail}</td>
    </tr>
  );
}

function renderCols(cols, dqMap) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ textAlign: 'left', color: 'var(--ink-3)' }}>
          <th style={{ padding: '6px 8px' }}>Column</th>
          <th style={{ padding: '6px 8px' }}>Role</th>
          <th style={{ padding: '6px 8px' }}>Completeness</th>
          <th style={{ padding: '6px 8px' }}>Outlier rate</th>
          <th style={{ padding: '6px 8px' }}>Dup. rate</th>
          <th style={{ padding: '6px 8px' }}>Distinct</th>
          <th style={{ padding: '6px 8px' }}>Detail</th>
        </tr>
      </thead>
      <tbody>
        {cols.map(c => <ColumnRow key={c.name} c={c} m={dqMap && dqMap.get(c.name)} />)}
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
function TableBody({ profile, tablePath, questionsByColumn, dqMap }) {
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
  const render = (cs) => renderCols(cs, dqMap);
  // No real sub-groups → render the columns flat (skip the "— no group —" wrapper).
  const flat = tree.length === 1 && tree[0].children.length === 0;
  return (
    <div style={{ padding: '2px 8px 10px' }}>
      {cols.length === 0
        ? <div style={{ color: 'var(--ink-3)', fontSize: 12.5, padding: '4px 0' }}>No visible columns.</div>
        : flat ? render(tree[0].visible) : <GroupTree tree={tree} renderVisible={render} />}
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
  const [dq, setDq] = useState({});                 // tableName → Map(column → {completeness, outlier_rate, duplicate_rate})
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        // In-memory SWR tier (PERF-4): profile column stats can expose real data
        // values, so this is never persisted to disk — instant on within-session
        // revisit, skeleton-then-fetch on a hard reload.
        await swr('/api/profile', async () => {
          const r = await fetch('/api/profile');
          const data = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(data.detail || `Request failed (${r.status})`);
          return data;
        }, (data) => {
          if (cancelled) return;
          setProfiles(data.profiles || []);
          setMessage(data.message || null);
          setLoading(false);
        });
      } catch (e) {
        if (!cancelled) { setError(e.message || 'Network error'); setLoading(false); }
      }
    })();
    (async () => {
      try {
        await swr('/api/questions', async () => (await (await fetch('/api/questions')).json()), (data) => {
          if (cancelled) return;
          const qs = data.questions || [];
          setQuestionsByColumn(indexQuestionsByColumn(qs));
          const m = {};
          for (const q of qs) if (q.group) m[q.group.replace(/\//g, '_')] = q.group;
          setSan2slash(m);
        });
      } catch { /* keep flat */ }
    })();
    // Data-quality metrics (completeness / outlier rate / duplicate rate),
    // merged into the column tables. Best-effort.
    (async () => {
      try {
        // In-memory SWR tier (PERF-4): column stats can expose data values → never
        // persisted to disk.
        await swr('/api/data-quality', async () => {
          const r = await fetch('/api/data-quality');
          return await r.json().catch(() => ({}));
        }, (body) => {
          if (cancelled || !body || !body.has_data) return;
          const byCol = (rows) => { const mm = new Map(); for (const row of rows || []) mm.set(row.column, row); return mm; };
          const m = { main: byCol(body.rows) };
          for (const t of body.tables || []) m[t.name] = byCol(t.rows);
          setDq(m);
        });
      } catch { /* no metrics */ }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Step 2 of 5 · Data profile"
        title="Understand your"
        accent="tables."
        sub="A read-only snapshot of every base table, arranged as a tree of accordions. Open a table to inspect its columns — completeness, outlier and duplicate rates (color-coded), distinct counts, ranges and outliers."
      />
      {loading && <SkeletonPanel rows={5} rowHeight={56} label="Profiling…" />}
      {error && (
        <EmptyState tone="error" title="Profiling failed"
          description={`${error} — if you haven’t downloaded submissions yet, run Download from the Dashboard first.`} />
      )}
      {!loading && !error && profiles && profiles.length === 0 && (
        <EmptyState
          title="Nothing to profile yet"
          description={message || 'The data profile is built from your downloaded submissions. Run Download from the Dashboard, then come back here to inspect every table.'}
        />
      )}
      {profiles && profiles.length > 0 && (
        <div>
          <TableTree
            tables={profiles}
            resolveSlash={(key) => san2slash[key] || key}
            tableMeta={(p) => `${(p.rows ?? 0).toLocaleString()} rows · ${visibleColumns(p, questionsByColumn).length} columns`}
            renderBody={(p, slash) => <TableBody profile={p} tablePath={slash} questionsByColumn={questionsByColumn} dqMap={dq[p.name]} />}
          />
        </div>
      )}
    </div>
  );
}

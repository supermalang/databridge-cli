import { useEffect, useMemo, useRef, useState } from 'react';
import PageHeader from './PageHeader.jsx';
import { isHidden, indexQuestionsByColumn, buildGroupTree, GROUP_LABELS } from '../lib/questionGroups.js';
import GroupTree from '../components/GroupTree.jsx';

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

// Build the table forest: `main` plus one node per top-level group; repeat
// tables nest under their group/sub-group folders (from each table's slash path).
function buildTableForest(profiles, resolveSlash) {
  const root = { children: [], _kids: new Map() };
  for (const p of profiles) {
    if (p.name === 'main') continue;
    const segs = resolveSlash(p.name).split('/').filter(Boolean);
    let node = root;
    const acc = [];
    for (const seg of segs) {
      acc.push(seg);
      let child = node._kids.get(seg);
      if (!child) {
        child = { name: seg, path: acc.join('/'), slash: acc.join('/'), profile: null, children: [], _kids: new Map() };
        node._kids.set(seg, child);
        node.children.push(child);
      }
      node = child;
    }
    node.profile = p;
    node.slash = resolveSlash(p.name);
  }
  const strip = (n) => { delete n._kids; n.children.forEach(strip); return n; };
  root.children.forEach(strip);
  const mainProfile = profiles.find(p => p.name === 'main');
  const mainNode = { name: 'main', path: 'main', slash: '', profile: mainProfile || null, children: [] };
  return [mainNode, ...root.children];
}

function countTables(node) {
  let n = node.profile ? 1 : 0;
  for (const c of node.children) n += countTables(c);
  return n;
}

function Chevron() {
  return (
    <svg className="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 4 10 8 6 12" />
    </svg>
  );
}

export default function Profile() {
  const [profiles, setProfiles] = useState(null);
  const [questionsByColumn, setQuestionsByColumn] = useState(() => new Map());
  const [san2slash, setSan2slash] = useState({});   // sanitized group path → slash path
  const [open, setOpen] = useState(() => new Set());
  const initRef = useRef(false);
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

  const forest = useMemo(
    () => (profiles && profiles.length ? buildTableForest(profiles, (key) => san2slash[key] || key) : []),
    [profiles, san2slash]
  );

  // First time the forest is ready, expand the folder skeleton (every node that
  // has children); repeat tables stay collapsed so columns load on demand.
  useEffect(() => {
    if (initRef.current || forest.length === 0) return;
    initRef.current = true;
    const s = new Set();
    const walk = (n) => { if (n.children.length) s.add(n.path); n.children.forEach(walk); };
    forest.forEach(walk);
    setOpen(s);
  }, [forest]);

  const toggle = (path) => setOpen(prev => {
    const next = new Set(prev);
    next.has(path) ? next.delete(path) : next.add(path);
    return next;
  });

  const renderNode = (node, depth) => {
    const isTable = !!node.profile;
    const isOpen = open.has(node.path);
    const colCount = isTable ? visibleColumns(node.profile, questionsByColumn).length : 0;
    const nTables = countTables(node);
    return (
      <div className="gt-node" data-open={isOpen} data-depth={depth} key={node.path}>
        <div className="gt-node__head" onClick={() => toggle(node.path)}>
          <Chevron />
          <span className="gt-node__name">{node.name}</span>
          <span className="gt-node__count">
            {isTable
              ? `${(node.profile.rows ?? 0).toLocaleString()} rows · ${colCount} columns`
              : `${nTables} table${nTables === 1 ? '' : 's'}`}
          </span>
        </div>
        {isOpen && (
          <div className="gt-node__body">
            {isTable && <TableBody profile={node.profile} tablePath={node.slash} questionsByColumn={questionsByColumn} />}
            {node.children.map(c => renderNode(c, depth + 1))}
          </div>
        )}
      </div>
    );
  };

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
      {forest.length > 0 && (
        <div className="gt" style={{ padding: '0 8px' }}>
          {forest.map(node => renderNode(node, 0))}
        </div>
      )}
    </div>
  );
}

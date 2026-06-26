import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Shared base-table arborescence: `main` plus one accordion per top-level group,
// repeat tables nested under their group/sub-group folders (derived from each
// table's slash path). Used by the Profile tab and the Validate DQ overview.
//
// Props:
//   tables       array of table objects, each with a `.name` (one is "main")
//   resolveSlash (name) => slash-delimited path for that table
//   tableMeta    (table) => header text shown for a table node (e.g. "277 rows · 8 columns")
//   renderBody   (table, slash) => JSX shown when a table node is expanded

function Chevron() {
  return (
    <svg className="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 4 10 8 6 12" />
    </svg>
  );
}

export function buildTableForest(tables, resolveSlash) {
  const root = { children: [], _kids: new Map() };
  for (const t of tables) {
    if (t.name === 'main') continue;
    const segs = resolveSlash(t.name).split('/').filter(Boolean);
    let node = root;
    const acc = [];
    for (const seg of segs) {
      acc.push(seg);
      let child = node._kids.get(seg);
      if (!child) {
        child = { name: seg, path: acc.join('/'), slash: acc.join('/'), table: null, children: [], _kids: new Map() };
        node._kids.set(seg, child);
        node.children.push(child);
      }
      node = child;
    }
    node.table = t;
    node.slash = resolveSlash(t.name);
  }
  const strip = (n) => { delete n._kids; n.children.forEach(strip); return n; };
  root.children.forEach(strip);
  const main = tables.find(t => t.name === 'main');
  const mainNode = { name: 'main', path: 'main', slash: '', table: main || null, children: [] };
  return [mainNode, ...root.children];
}

function countTables(node) {
  let n = node.table ? 1 : 0;
  for (const c of node.children) n += countTables(c);
  return n;
}

export default function TableTree({ tables, resolveSlash, tableMeta, renderBody }) {
  const { t } = useTranslation();
  const forest = useMemo(
    () => (tables && tables.length ? buildTableForest(tables, resolveSlash) : []),
    [tables, resolveSlash]
  );

  const [open, setOpen] = useState(() => new Set());
  const initRef = useRef(false);

  // First time the forest is ready, expand the folder skeleton (nodes with
  // children); leaf tables stay collapsed so their bodies load on demand.
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
    const isTable = !!node.table;
    const isOpen = open.has(node.path);
    const nTables = countTables(node);
    return (
      <div className="gt-node" data-open={isOpen} data-depth={depth} key={node.path}>
        <div className="gt-node__head" onClick={() => toggle(node.path)}>
          <Chevron />
          <span className="gt-node__name">{node.name}</span>
          <span className="gt-node__count">
            {isTable ? tableMeta(node.table) : t('components.tableTree.tableCount', { count: nTables })}
          </span>
        </div>
        {isOpen && (
          <div className="gt-node__body">
            {isTable && renderBody(node.table, node.slash)}
            {node.children.map(c => renderNode(c, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (!forest.length) return null;
  return <div className="gt">{forest.map(node => renderNode(node, 0))}</div>;
}

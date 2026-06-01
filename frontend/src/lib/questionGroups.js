// Shared helpers for organizing questions/columns by their XLSForm group path
// (slash-delimited, e.g. "health/children/illness") into a nested tree, and for
// deciding which questions are "hidden" (display-only notes/labels/instructions).
//
// Used by the Questions, Profile, and Validate tabs so grouping + hide behavior
// stays consistent across all three.

const NO_GROUP = '— no group —';
const UNGROUPED = 'Ungrouped';

// A question is hidden if it carries an explicit `hidden` flag; otherwise the
// deterministic default is "notes are hidden" (notes capture no analyzable data).
// This keeps pre-existing config.yml files (no `hidden` key) working unchanged.
export function isHidden(q) {
  if (!q) return false;
  if (typeof q.hidden === 'boolean') return q.hidden;
  return q.type === 'note';
}

// Build a nested group tree from a flat list of items.
//   getPath(item)   → slash-delimited group path string ("" / null → top level)
//   getHidden(item) → boolean (item goes in the node's `hidden` bucket vs `visible`)
// Returns an array of top-level nodes. Each node:
//   { name, path, depth, visible: [item], hidden: [item], children: [node] }
export function buildGroupTree(items, { getPath, getHidden }) {
  const root = { name: '', path: '', depth: -1, visible: [], hidden: [], children: [], _kids: new Map() };
  for (const item of items) {
    const raw = (getPath(item) || '').trim();
    const segments = raw ? raw.split('/').map(s => s.trim()).filter(Boolean) : [NO_GROUP];
    let node = root;
    const acc = [];
    for (const seg of segments) {
      acc.push(seg);
      let child = node._kids.get(seg);
      if (!child) {
        child = { name: seg, path: acc.join('/'), depth: node.depth + 1, visible: [], hidden: [], children: [], _kids: new Map() };
        node._kids.set(seg, child);
        node.children.push(child);
      }
      node = child;
    }
    (getHidden(item) ? node.hidden : node.visible).push(item);
  }
  const strip = (n) => { delete n._kids; n.children.forEach(strip); return n; };
  root.children.forEach(strip);
  return root.children;
}

// Recursive counts of visible/hidden items at a node and all its descendants.
export function nodeCounts(node) {
  let visible = node.visible.length;
  let hidden = node.hidden.length;
  for (const c of node.children) {
    const cc = nodeCounts(c);
    visible += cc.visible;
    hidden += cc.hidden;
  }
  return { visible, hidden };
}

// Map a data-column name back to its source question. Profile/Validate work off
// column names; questions are keyed by export_label/label/bare kobo_key. First
// match wins so the most specific (export_label) takes precedence.
export function indexQuestionsByColumn(questions) {
  const map = new Map();
  for (const q of (questions || [])) {
    const keys = [q.export_label, q.label, (q.kobo_key || '').split('/').pop()].filter(Boolean);
    for (const k of keys) if (!map.has(k)) map.set(k, q);
  }
  return map;
}

// Given column-like rows (each having a `.name`) and a question index, build the
// group tree for the columns. Columns with no matching question land in an
// "Ungrouped" top-level bucket; their hidden state is false.
export function buildColumnTree(columns, questionsByColumn) {
  return buildGroupTree(columns, {
    getPath: (c) => {
      const q = questionsByColumn.get(c.name);
      return q ? q.group : UNGROUPED;
    },
    getHidden: (c) => {
      const q = questionsByColumn.get(c.name);
      return q ? isHidden(q) : false;
    },
  });
}

export const GROUP_LABELS = { NO_GROUP, UNGROUPED };

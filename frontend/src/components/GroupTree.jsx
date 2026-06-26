import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { nodeCounts } from '../lib/questionGroups.js';

// Generic nested-group accordion shared by the Questions, Profile, and Validate
// tabs. Renders root groups → subgroups recursively, with a collapsed
// "Hidden (N)" sub-section inside each node that has hidden items.
//
// Props:
//   tree              array of nodes from buildGroupTree / buildColumnTree
//   renderVisible(items, node)  → render the node's visible items (e.g. a table)
//   renderHidden(items, node)   → optional; defaults to renderVisible
//   renderHeaderExtra(node)     → optional right-aligned header content (breakdown, badges)
//   defaultOpenDepth  nodes at depth <= this start expanded (default 0 = top groups open)

function Chevron() {
  return (
    <svg className="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 4 10 8 6 12" />
    </svg>
  );
}

// Collect the paths of every node at depth <= defaultOpenDepth (the nodes that
// should start expanded).
function defaultOpenPaths(nodes, defaultOpenDepth, acc = new Set()) {
  for (const n of (nodes || [])) {
    if (n.depth <= defaultOpenDepth) acc.add(n.path);
    defaultOpenPaths(n.children, defaultOpenDepth, acc);
  }
  return acc;
}

export default function GroupTree({ tree, renderVisible, renderHidden, renderPii, renderHeaderExtra, defaultOpenDepth = 0 }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(() => defaultOpenPaths(tree, defaultOpenDepth));
  const [openHidden, setOpenHidden] = useState(() => new Set());
  const [openPii, setOpenPii] = useState(() => new Set());

  // The tree can change AFTER mount when its data loads asynchronously (e.g.
  // Validate's findings build under "Ungrouped" until /api/questions resolves,
  // then re-group under their real path; Questions/Profile similarly re-key as
  // questions arrive). The `open` set was seeded once at mount, so a default-open
  // node that only appears on a LATER tree would render collapsed — hiding its
  // contents (A11Y-7). Auto-open each default-open node the FIRST time we see it,
  // tracked in seenRef so a node the user later collapses is not forced back open.
  const seenRef = useRef(null);
  if (seenRef.current === null) seenRef.current = new Set(open);
  useEffect(() => {
    const wanted = defaultOpenPaths(tree, defaultOpenDepth);
    const fresh = [...wanted].filter(p => !seenRef.current.has(p));
    if (fresh.length === 0) return;
    for (const p of fresh) seenRef.current.add(p);
    setOpen(prev => {
      const next = new Set(prev);
      for (const p of fresh) next.add(p);
      return next;
    });
  }, [tree, defaultOpenDepth]);

  const toggle = (setSet, key) => setSet(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const renderNode = (node) => {
    const counts = nodeCounts(node);
    const isOpen = open.has(node.path);
    const hiddenOpen = openHidden.has(node.path);
    const piiOpen = openPii.has(node.path);
    const pii = node.pii || [];
    return (
      <div className="gt-node" data-open={isOpen} data-depth={node.depth} key={node.path}>
        <div className="gt-node__head" onClick={() => toggle(setOpen, node.path)}>
          <Chevron />
          <span className="gt-node__name">{node.name}</span>
          <span className="gt-node__count">
            {counts.visible}{counts.hidden ? <span className="gt-node__hiddencount"> {t('components.groupTree.hiddenCount', { count: counts.hidden })}</span> : null}
            {counts.pii ? <span className="gt-node__piicount"> {t('components.groupTree.piiCount', { count: counts.pii })}</span> : null}
          </span>
          {renderHeaderExtra && <span className="gt-node__extra">{renderHeaderExtra(node)}</span>}
        </div>
        {isOpen && (
          <div className="gt-node__body">
            {node.visible.length > 0 && renderVisible(node.visible, node)}
            {node.children.map(renderNode)}
            {pii.length > 0 && (
              <div className="gt-hidden gt-pii" data-open={piiOpen}>
                <div className="gt-hidden__head" onClick={() => toggle(setOpenPii, node.path)}>
                  <Chevron />
                  <span>{t('components.groupTree.pii', { count: pii.length })}</span>
                  <span className="gt-hidden__hint">{t('components.groupTree.piiHint')}</span>
                </div>
                {piiOpen && (
                  <div className="gt-hidden__body">
                    {(renderPii || renderVisible)(pii, node)}
                  </div>
                )}
              </div>
            )}
            {node.hidden.length > 0 && (
              <div className="gt-hidden" data-open={hiddenOpen}>
                <div className="gt-hidden__head" onClick={() => toggle(setOpenHidden, node.path)}>
                  <Chevron />
                  <span>{t('components.groupTree.hidden', { count: node.hidden.length })}</span>
                  <span className="gt-hidden__hint">{t('components.groupTree.hiddenHint')}</span>
                </div>
                {hiddenOpen && (
                  <div className="gt-hidden__body">
                    {(renderHidden || renderVisible)(node.hidden, node)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  if (!tree || tree.length === 0) return null;
  return <div className="gt">{tree.map(renderNode)}</div>;
}

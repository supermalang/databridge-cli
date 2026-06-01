import { useState } from 'react';
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

export default function GroupTree({ tree, renderVisible, renderHidden, renderHeaderExtra, defaultOpenDepth = 0 }) {
  const [open, setOpen] = useState(() => {
    const s = new Set();
    const walk = (nodes) => nodes.forEach(n => { if (n.depth <= defaultOpenDepth) s.add(n.path); walk(n.children); });
    walk(tree);
    return s;
  });
  const [openHidden, setOpenHidden] = useState(() => new Set());

  const toggle = (setSet, key) => setSet(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const renderNode = (node) => {
    const counts = nodeCounts(node);
    const isOpen = open.has(node.path);
    const hiddenOpen = openHidden.has(node.path);
    return (
      <div className="gt-node" data-open={isOpen} data-depth={node.depth} key={node.path}>
        <div className="gt-node__head" onClick={() => toggle(setOpen, node.path)}>
          <Chevron />
          <span className="gt-node__name">{node.name}</span>
          <span className="gt-node__count">
            {counts.visible}{counts.hidden ? <span className="gt-node__hiddencount"> · {counts.hidden} hidden</span> : null}
          </span>
          {renderHeaderExtra && <span className="gt-node__extra">{renderHeaderExtra(node)}</span>}
        </div>
        {isOpen && (
          <div className="gt-node__body">
            {node.visible.length > 0 && renderVisible(node.visible, node)}
            {node.children.map(renderNode)}
            {node.hidden.length > 0 && (
              <div className="gt-hidden" data-open={hiddenOpen}>
                <div className="gt-hidden__head" onClick={() => toggle(setOpenHidden, node.path)}>
                  <Chevron />
                  <span>Hidden ({node.hidden.length})</span>
                  <span className="gt-hidden__hint">notes &amp; non-analytical fields</span>
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

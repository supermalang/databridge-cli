// A11Y-2 — shared helpers for the ARIA Authoring Practices "tabs" pattern.
//
// Used by every tab strip in the app (primary six-tab nav, secondary sub-tab
// strip, ProjectForm tabs, profile-form tabs) so they all expose the same
// role="tablist"/role="tab"/role="tabpanel" semantics, aria-selected,
// aria-controls, roving tabindex and Left/Right/Home/End arrow-key navigation.

// Derive the stable ids that tie a tab to its panel via aria-controls.
// `group` namespaces the ids so multiple tablists on the page never collide.
export const tabId = (group, id) => `tab-${group}-${id}`;
export const panelId = (group, id) => `panel-${group}-${id}`;

// ARIA + roving-tabindex attributes for a single tab button.
//   group    – tablist namespace (e.g. 'primary', 'projectform')
//   id       – this tab's id
//   selected – whether this tab is the active one
export function tabProps(group, id, selected) {
  return {
    id: tabId(group, id),
    role: 'tab',
    'aria-selected': selected ? 'true' : 'false',
    'aria-controls': panelId(group, id),
    tabIndex: selected ? 0 : -1,
  };
}

// ARIA attributes for the panel a tab controls.
export function panelProps(group, id) {
  return {
    id: panelId(group, id),
    role: 'tabpanel',
    'aria-labelledby': tabId(group, id),
  };
}

// Build an onKeyDown handler for a tablist that implements roving selection.
//   group     – tablist namespace (used to resolve the focus target)
//   ids       – ordered list of tab ids (only enabled/visible tabs)
//   activeId  – currently selected tab id
//   onSelect  – called with the next id to activate it
// Left/Right (and Up/Down) move one step (wrapping); Home/End jump to
// first/last. After selecting, focus moves to the newly activated tab button.
export function makeTabKeydown(group, ids, activeId, onSelect) {
  return (e) => {
    if (!ids.length) return;
    const cur = Math.max(0, ids.indexOf(activeId));
    let next = null;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (cur + 1) % ids.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (cur - 1 + ids.length) % ids.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = ids.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    const nextId = ids[next];
    onSelect(nextId);
    // Move focus to the activated tab after it re-renders with tabindex=0.
    requestAnimationFrame(() => {
      const el = document.getElementById(tabId(group, nextId));
      if (el) el.focus();
    });
  };
}

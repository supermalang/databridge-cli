import { useEffect, useState } from 'react';

/**
 * Dropdown of framework nodes (goal/outcome/output) with breadcrumb labels.
 * Used by IndicatorModal to set framework_ref.
 */
export default function FrameworkPicker({ value, onChange }) {
  const [nodes, setNodes] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const fw = await (await fetch('/api/framework')).json();
        const flat = [];
        if (fw.goal) flat.push({ id: fw.goal.id, level: 'goal', breadcrumb: fw.goal.label });
        const ocLabel = {};
        for (const oc of (fw.outcomes || [])) {
          ocLabel[oc.id] = oc.label;
          const bc = fw.goal ? `${fw.goal.label} › ${oc.label}` : oc.label;
          flat.push({ id: oc.id, level: 'outcome', breadcrumb: bc });
        }
        for (const op of (fw.outputs || [])) {
          const parts = [fw.goal?.label, ocLabel[op.parent], op.label].filter(Boolean);
          flat.push({ id: op.id, level: 'output', breadcrumb: parts.join(' › ') });
        }
        setNodes(flat);
      } catch { setNodes([]); }
    })();
  }, []);

  return (
    <select
      className="src-input"
      value={value || ''}
      onChange={e => onChange?.(e.target.value || null)}
    >
      <option value="">(no framework link)</option>
      {nodes.map(n => (
        <option key={n.id} value={n.id}>
          [{n.level}] {n.id} — {n.breadcrumb}
        </option>
      ))}
    </select>
  );
}

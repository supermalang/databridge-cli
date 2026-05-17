import { useEffect, useState } from 'react';

export default function PeriodPicker({ value, onChange, allowAdd = true }) {
  const [periods, setPeriods] = useState({ current: null, baseline: null, registry: [] });
  const [adding, setAdding]   = useState(false);
  const [draft,  setDraft]    = useState('');

  const reload = async () => {
    try { setPeriods(await (await fetch('/api/periods')).json()); }
    catch { /* leave defaults */ }
  };

  useEffect(() => { reload(); }, []);

  const addPeriod = async () => {
    const label = draft.trim();
    if (!label) return;
    await fetch('/api/periods/registry', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    });
    setAdding(false); setDraft('');
    await reload();
    if (onChange) onChange(label);
  };

  return (
    <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <select
        className="src-input"
        value={value ?? periods.current ?? ''}
        onChange={e => onChange?.(e.target.value)}
        style={{ minWidth: 140 }}
      >
        <option value="">(no period)</option>
        {periods.registry.map(p => (
          <option key={p.slug} value={p.label}>
            {p.label}{p.label === periods.baseline ? ' · baseline' : ''}
          </option>
        ))}
      </select>
      {allowAdd && (
        adding ? (
          <>
            <input
              autoFocus className="src-input"
              value={draft} onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addPeriod(); if (e.key === 'Escape') setAdding(false); }}
              placeholder="e.g. Q3 2026" style={{ width: 140 }}
            />
            <button className="btn btn-primary btn-sm" onClick={addPeriod}>Add</button>
          </>
        ) : (
          <button className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}>+ Period</button>
        )
      )}
    </div>
  );
}

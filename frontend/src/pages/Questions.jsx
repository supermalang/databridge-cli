import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '../components/Toast.jsx';
import { loadConfig } from '../lib/config.js';

// ── helpers ──────────────────────────────────────────────────────────────────
function colName(q) {
  return q.export_label || q.label || q.kobo_key || '';
}
function bareName(q) {
  // The last segment of the kobo_key path — what shows in the NAME column.
  return (q.kobo_key || '').split('/').pop() || '';
}
function groupKey(q) {
  return q.group?.trim() || '— no group —';
}

// "5 select_one · 3 decimal · …"
function buildTypeBreakdown(qs) {
  const counts = {};
  for (const q of qs) {
    const t = q.type || 'unknown';
    counts[t] = (counts[t] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${n} ${t}`);
}

// ── component ────────────────────────────────────────────────────────────────
export default function Questions() {
  const toast = useToast();
  const [questions, setQuestions] = useState(null);
  const [original,  setOriginal]  = useState({});          // { idx: exportLabel } at load
  const [search,    setSearch]    = useState('');
  const [filter,    setFilter]    = useState('all');       // all | renamed | used
  const [openGroups, setOpenGroups] = useState(new Set());
  const [cfg, setCfg] = useState({});

  const load = useCallback(async () => {
    try {
      const data = await (await fetch('/api/questions')).json();
      const list = data.questions || [];
      setQuestions(list);
      setOriginal(Object.fromEntries(list.map((q, i) => [i, q.export_label || ''])));
      setCfg(await loadConfig());
    } catch (e) { toast(String(e), 'err'); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  // Set of column names used by charts / indicators / summaries (for the "used in charts" filter).
  const usedInCharts = useMemo(() => {
    const s = new Set();
    for (const ch of cfg.charts || []) {
      for (const c of ch.questions || []) s.add(c);
    }
    return s;
  }, [cfg]);
  const boundIndicators = useMemo(() => {
    const s = new Set();
    for (const i of cfg.indicators || []) if (i.question) s.add(i.question);
    return s;
  }, [cfg]);

  // Indices of dirty rows (export_label edited since load)
  const dirtyIndices = useMemo(() => {
    if (!questions) return new Set();
    const s = new Set();
    questions.forEach((q, i) => {
      if (original[i] !== undefined && original[i] !== (q.export_label || '')) s.add(i);
    });
    return s;
  }, [questions, original]);

  // Group questions, applying filter + search
  const groups = useMemo(() => {
    if (!questions) return [];
    const sLower = search.trim().toLowerCase();
    const visibleIdx = questions.map((q, i) => i).filter(i => {
      const q = questions[i];
      if (filter === 'renamed' && !dirtyIndices.has(i) && original[i] === undefined) return false;
      if (filter === 'renamed' && original[i] !== undefined && original[i] === (q.export_label || '')) {
        // "renamed" = export_label differs from the underlying label (which is what the
        // fetch-questions auto-default would use). If they match, it's not renamed.
        if ((q.export_label || '') === (q.label || '')) return false;
      }
      if (filter === 'used') {
        if (!usedInCharts.has(colName(q)) && !boundIndicators.has(colName(q))) return false;
      }
      if (sLower) {
        const hay = [q.kobo_key, q.label, q.export_label].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(sLower)) return false;
      }
      return true;
    });

    const byGroup = new Map();
    for (const i of visibleIdx) {
      const g = groupKey(questions[i]);
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(i);
    }
    return Array.from(byGroup.entries()).map(([name, indices]) => ({
      name, indices,
      breakdown: buildTypeBreakdown(indices.map(i => questions[i])),
    }));
  }, [questions, filter, search, dirtyIndices, original, usedInCharts, boundIndicators]);

  const setExportLabel = (idx, value) => {
    setQuestions(prev => prev.map((q, i) => (i === idx ? { ...q, export_label: value } : q)));
  };

  const toggleGroup = (name) => setOpenGroups(prev => {
    const next = new Set(prev);
    next.has(name) ? next.delete(name) : next.add(name);
    return next;
  });

  const save = async () => {
    try {
      const res = await fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Save failed');
      toast(`Saved ${data.saved} questions.`, 'ok');
      setOriginal(Object.fromEntries(questions.map((q, i) => [i, q.export_label || ''])));
    } catch (e) { toast(e.message, 'err'); }
  };

  // ── render ───────────────────────────────────────────────────────────────
  if (questions === null) return <div className="q-page"><p className="empty-state">Loading…</p></div>;
  if (questions.length === 0) {
    return (
      <div className="q-page">
        <Header total={0} groups={0} unsaved={0} onRefresh={load} onSave={save} />
        <div className="src-card"><p className="empty-state">No questions yet — run <b>fetch-questions</b> from the Dashboard.</p></div>
      </div>
    );
  }

  const totalGroups = new Set(questions.map(groupKey)).size;
  const totalUsedInCharts = questions.filter(q => usedInCharts.has(colName(q))).length;
  const totalBoundInd     = questions.filter(q => boundIndicators.has(colName(q))).length;
  const totalRenamed = dirtyIndices.size +
    questions.filter(q => (q.export_label || '') !== '' && (q.export_label || '') !== (q.label || '')).length;

  return (
    <div className="q-page">
      <Header
        total={questions.length}
        groups={totalGroups}
        unsaved={dirtyIndices.size}
        onRefresh={load}
        onSave={save}
      />

      <div className="q-toolbar">
        <div className="q-toolbar__left">
          <div className="q-search">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/></svg>
            <input placeholder="Search by name or label..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="config-view-toggle">
            <button className={`view-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All</button>
            <button className={`view-btn ${filter === 'renamed' ? 'active' : ''}`} onClick={() => setFilter('renamed')}>
              Renamed <span style={{ fontFamily: 'var(--font-mono)', opacity: .7, marginLeft: 2 }}>({totalRenamed})</span>
            </button>
            <button className={`view-btn ${filter === 'used' ? 'active' : ''}`} onClick={() => setFilter('used')}>Used in charts</button>
          </div>
        </div>
        <div className="q-stats">
          <span><b>{questions.length}</b> fields</span>
          <span>·</span>
          <span><b>{totalUsedInCharts}</b> used in charts</span>
          <span>·</span>
          <span><b>{totalBoundInd}</b> bound to indicators</span>
        </div>
      </div>

      <div className="q-groups">
        {groups.map(g => (
          <Group
            key={g.name}
            name={g.name}
            indices={g.indices}
            breakdown={g.breakdown}
            open={openGroups.has(g.name)}
            onToggle={() => toggleGroup(g.name)}
            questions={questions}
            dirtyIndices={dirtyIndices}
            usedInCharts={usedInCharts}
            onChangeLabel={setExportLabel}
            toast={toast}
          />
        ))}
        {groups.length === 0 && <p className="empty-state" style={{ padding: 30 }}>No questions match your filter.</p>}
      </div>
    </div>
  );
}

// ── Header band ──────────────────────────────────────────────────────────────
function Header({ total, groups, unsaved, onRefresh, onSave }) {
  return (
    <div className="q-header">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="greeting__date">Questions · {total} fields · {groups} groups</div>
        <h1 className="q-header__title">Rename what shows up <em>in the report.</em></h1>
        <div className="q-header__sub">
          Each row is a survey question. Edit the <b>Export label</b> to change how that column appears in charts, indicators, and Word placeholders — no YAML required.
        </div>
      </div>
      <div className="q-header__actions">
        {unsaved > 0 && <span className="q-unsaved-pill">{unsaved} unsaved</span>}
        <button className="btn" onClick={onRefresh}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><polyline points="2 4 2 8 6 8"/><path d="M3 11a6 6 0 1 0 1.4-7"/></svg>
          Refresh from form
        </button>
        <button className="btn btn-primary" onClick={onSave} disabled={unsaved === 0}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 8 7 12 13 4"/></svg>
          Save changes
        </button>
      </div>
    </div>
  );
}

// ── Group accordion ──────────────────────────────────────────────────────────
function Group({ name, indices, breakdown, open, onToggle, questions, dirtyIndices, usedInCharts, onChangeLabel, toast }) {
  return (
    <div className="q-group" data-open={open}>
      <div className="q-group__head" onClick={onToggle}>
        <svg className="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 4 10 8 6 12"/></svg>
        <span className="q-group__name">{name}</span>
        <span className="q-group__count">({indices.length})</span>
        <span className="q-group__breakdown">
          {breakdown.map((b, i) => <span key={i}>{b}</span>)}
        </span>
      </div>
      {open && (
        <div className="q-group__body">
          <table className="q-table">
            <thead>
              <tr>
                <th style={{ width: '20%' }}>Name</th>
                <th style={{ width: '12%' }}>Type</th>
                <th style={{ width: '30%' }}>Label (from form)</th>
                <th style={{ width: '30%' }}>Export label · used in charts &amp; template</th>
                <th style={{ width: '8%' }}></th>
              </tr>
            </thead>
            <tbody>
              {indices.map(i => {
                const q = questions[i];
                const dirty = dirtyIndices.has(i);
                const isUsed = usedInCharts.has(colName(q));
                return (
                  <tr key={i}>
                    <td className="q-table__name">{bareName(q)}</td>
                    <td>
                      <span className="q-type-badge" data-cat={q.category || 'undefined'}>{q.type || ''}</span>
                    </td>
                    <td className="q-table__label">{q.label || ''}</td>
                    <td>
                      <input
                        className="q-export-input"
                        data-dirty={dirty}
                        value={q.export_label || ''}
                        placeholder={q.label || q.kobo_key}
                        onChange={e => onChangeLabel(i, e.target.value)}
                      />
                    </td>
                    <td>
                      <div className="q-row-actions">
                        <button title={isUsed ? 'Used in charts' : 'Not currently used'} onClick={() => toast(isUsed ? `${colName(q)} is wired to a chart` : 'Not used yet', isUsed ? 'ok' : 'err')}>
                          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="3" y1="13" x2="3" y2="8"/>
                            <line x1="7" y1="13" x2="7" y2="4"/>
                            <line x1="11" y1="13" x2="11" y2="10"/>
                          </svg>
                        </button>
                        <button title="More" onClick={() => toast('Row actions coming next', 'err')}>
                          <svg viewBox="0 0 16 16" fill="currentColor"><circle cx="4" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12" cy="8" r="1.4"/></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

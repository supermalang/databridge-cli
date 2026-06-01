import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '../components/Toast.jsx';
import { loadConfig } from '../lib/config.js';
import { isHidden, buildGroupTree } from '../lib/questionGroups.js';
import GroupTree from '../components/GroupTree.jsx';

// ── helpers ──────────────────────────────────────────────────────────────────
function colName(q) {
  return q.export_label || q.label || q.kobo_key || '';
}
function bareName(q) {
  // The last segment of the kobo_key path — what shows in the NAME column.
  return (q.kobo_key || '').split('/').pop() || '';
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
  const [original,  setOriginal]  = useState({});          // { idx: {export_label, hidden} } at load
  const [search,    setSearch]    = useState('');
  const [filter,    setFilter]    = useState('all');       // all | renamed | used
  const [suggesting, setSuggesting] = useState(false);
  const [cfg, setCfg] = useState({});

  const snapshot = (list) =>
    Object.fromEntries(list.map((q, i) => [i, { export_label: q.export_label || '', hidden: isHidden(q) }]));

  const load = useCallback(async () => {
    try {
      const data = await (await fetch('/api/questions')).json();
      const list = data.questions || [];
      setQuestions(list);
      setOriginal(Object.fromEntries(list.map((q, i) => [i, { export_label: q.export_label || '', hidden: isHidden(q) }])));
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

  // Indices of dirty rows (export_label OR hidden changed since load)
  const dirtyIndices = useMemo(() => {
    if (!questions) return new Set();
    const s = new Set();
    questions.forEach((q, i) => {
      const o = original[i];
      if (o === undefined) return;
      if (o.export_label !== (q.export_label || '')) { s.add(i); return; }
      if (o.hidden !== isHidden(q)) s.add(i);
    });
    return s;
  }, [questions, original]);

  // Apply filter + search → list of { q, idx }, then build the nested group tree.
  const tree = useMemo(() => {
    if (!questions) return [];
    const sLower = search.trim().toLowerCase();
    const items = [];
    questions.forEach((q, i) => {
      if (filter === 'renamed') {
        const dirty = dirtyIndices.has(i);
        if (!dirty && (q.export_label || '') === (q.label || '')) return;
      }
      if (filter === 'used') {
        if (!usedInCharts.has(colName(q)) && !boundIndicators.has(colName(q))) return;
      }
      if (sLower) {
        const hay = [q.kobo_key, q.label, q.export_label].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(sLower)) return;
      }
      items.push({ q, idx: i });
    });

    return buildGroupTree(items, {
      getPath: ({ q }) => q.group,
      getHidden: ({ q }) => isHidden(q),
    });
  }, [questions, filter, search, dirtyIndices, usedInCharts, boundIndicators]);

  const setExportLabel = (idx, value) => {
    setQuestions(prev => prev.map((q, i) => (i === idx ? { ...q, export_label: value } : q)));
  };

  const toggleHidden = (idx) => {
    setQuestions(prev => prev.map((q, i) => (i === idx ? { ...q, hidden: !isHidden(q) } : q)));
  };

  const suggestHidden = async () => {
    setSuggesting(true);
    try {
      const res = await fetch('/api/questions/suggest-hidden', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Request failed');
      const suggestions = data.suggestions || [];
      if (suggestions.length) {
        const flag = new Set(suggestions);
        setQuestions(prev => prev.map(q => (flag.has(q.kobo_key) ? { ...q, hidden: true } : q)));
        toast(`Flagged ${suggestions.length} field(s) to hide — review and Save`, 'ok');
      } else {
        toast(data.message || 'AI found no extra fields to hide', 'ok');
      }
    } catch (e) {
      toast(String(e.message || e), 'err');
    } finally {
      setSuggesting(false);
    }
  };

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
      setOriginal(snapshot(questions));
    } catch (e) { toast(e.message, 'err'); }
  };

  // Row renderer shared by visible and hidden buckets. `items` = [{ q, idx }].
  const renderRows = (items) => (
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
        {items.map(({ q, idx }) => {
          const dirty = dirtyIndices.has(idx);
          const isUsed = usedInCharts.has(colName(q));
          const hidden = isHidden(q);
          return (
            <tr key={idx}>
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
                  onChange={e => setExportLabel(idx, e.target.value)}
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
                  <button
                    title={hidden ? 'Unhide — show in report' : 'Hide — exclude from analysis'}
                    onClick={() => toggleHidden(idx)}
                  >
                    {hidden ? (
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 2l12 12"/>
                        <path d="M6.5 6.6a2 2 0 0 0 2.8 2.8"/>
                        <path d="M4.3 4.4C2.7 5.4 1.5 8 1.5 8s2.5 4 6.5 4c1 0 1.9-.2 2.7-.6"/>
                        <path d="M7 4.1A6 6 0 0 1 8 4c4 0 6.5 4 6.5 4a12 12 0 0 1-1.6 2"/>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1.5 8S4 4 8 4s6.5 4 6.5 4-2.5 4-6.5 4-6.5-4-6.5-4z"/>
                        <circle cx="8" cy="8" r="2"/>
                      </svg>
                    )}
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  const renderHeaderExtra = (node) => {
    const breakdown = buildTypeBreakdown(node.visible.map(({ q }) => q));
    return (
      <span className="q-group__breakdown">
        {breakdown.map((b, i) => <span key={i}>{b}</span>)}
      </span>
    );
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

  const totalGroups = tree.length;
  const totalUsedInCharts = questions.filter(q => usedInCharts.has(colName(q))).length;
  const totalBoundInd     = questions.filter(q => boundIndicators.has(colName(q))).length;
  const totalRenamed = questions.filter((q, i) =>
    dirtyIndices.has(i) || ((q.export_label || '') !== '' && (q.export_label || '') !== (q.label || ''))
  ).length;

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
          <button className="ai-btn" onClick={suggestHidden} disabled={suggesting}>
            {suggesting ? 'Asking AI…' : 'Suggest fields to hide'}
          </button>
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
        {tree.length > 0 ? (
          <GroupTree
            tree={tree}
            renderVisible={renderRows}
            renderHidden={renderRows}
            renderHeaderExtra={renderHeaderExtra}
          />
        ) : (
          <p className="empty-state" style={{ padding: 30 }}>No questions match your filter.</p>
        )}
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

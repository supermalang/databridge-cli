import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../components/Toast.jsx';
import { loadConfig } from '../lib/config.js';
import { usePerms } from '../lib/perms.js';
import { useAiStatus, AI_LOCK_TIP } from '../lib/aiStatus.js';
import { isHidden, buildGroupTree } from '../lib/questionGroups.js';
import GroupTree from '../components/GroupTree.jsx';
import Modal from '../components/Modal.jsx';
import PageHeader from './PageHeader.jsx';
import { useUnsavedGuard } from '../hooks/useUnsavedGuard.js';
import { useRun } from '../lib/run.js';
import { RailLayout, StatusCard, QuickActionsCard, RailIcons } from '../components/Rail.jsx';

// ── helpers ──────────────────────────────────────────────────────────────────
function colName(q) {
  return q.export_label || q.label || q.kobo_key || '';
}
function bareName(q) {
  // The last segment of the kobo_key path — what shows in the NAME column.
  return (q.kobo_key || '').split('/').pop() || '';
}

// Deterministic name cleanup used to propose unique export labels for duplicates.
// Derives from a field's unique kobo_key: drops a leading group_ prefix, trailing
// XLSForm type affixes, and filler/stop words (FR + EN), e.g.
//   group_permanence_de_la_fin_select → permanence_fin
const _PREFIX_NOISE = new Set(['group', 'grp', 'section', 'sec', 'repeat', 'rpt', 'q', 'question']);
const _TYPE_NOISE = new Set([
  'select', 'one', 'multiple', 'sel', 'int', 'integer', 'number', 'num', 'decimal',
  'dec', 'text', 'txt', 'note', 'calc', 'calculate', 'calculation', 'date', 'datetime',
  'time', 'gps', 'geopoint', 'geo', 'geotrace', 'geoshape', 'bool', 'boolean', 'acknowledge',
]);
const _STOP = new Set([
  'de', 'la', 'le', 'les', 'du', 'des', 'un', 'une', 'et', 'ou', 'au', 'aux', 'en',
  'd', 'l', 'dans', 'avec', 'par', 'pour', 'sur', 'the', 'of', 'and', 'or', 'to', 'in', 'for', 'on',
]);
function cleanBase(raw) {
  let toks = String(raw || '').split(/[^A-Za-z0-9À-ÿ]+/).filter(Boolean).map(t => t.toLowerCase());
  while (toks.length && _PREFIX_NOISE.has(toks[0])) toks.shift();
  while (toks.length && _TYPE_NOISE.has(toks[toks.length - 1])) toks.pop();
  toks = toks.filter(t => !_STOP.has(t));
  return toks.join('_');
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
  const { canEdit } = usePerms();
  const { aiReady } = useAiStatus();
  const { run } = useRun();
  const [questions, setQuestions] = useState(null);
  const [original,  setOriginal]  = useState({});          // { idx: {export_label, hidden} } at load
  const [search,    setSearch]    = useState('');
  const [filter,    setFilter]    = useState('all');       // all | renamed | used
  const [suggesting, setSuggesting] = useState(null);      // null | 'hidden' | 'pii'
  const [reviewModal, setReviewModal] = useState(null);    // null | { kind, title, hint, noun, items:[{idx,name,label,checked}] }
  const [cfg, setCfg] = useState({});
  // When a save is blocked by duplicate export labels we "reveal" just the
  // offending rows: a frozen set of indices (stable membership so an input
  // doesn't vanish mid-edit) + a bump signal that drives the scroll-into-view.
  const [revealedDupIdx, setRevealedDupIdx] = useState(null);  // Set<idx> | null
  const [dupScrollSignal, setDupScrollSignal] = useState(0);
  const scrollElRef = useRef(null);

  const snapshot = (list) =>
    Object.fromEntries(list.map((q, i) => [i, { export_label: q.export_label || '', hidden: isHidden(q), pii: !!q.pii }]));

  const load = useCallback(async () => {
    try {
      const data = await (await fetch('/api/questions')).json();
      const list = data.questions || [];
      setQuestions(list);
      setOriginal(snapshot(list));
      setCfg(await loadConfig());
    } catch (e) { toast(String(e), 'err'); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  // Fetching the schema + downloading data now live on Extract → Connection. A
  // successful run there fires databridge:data-changed, which refreshes this tab
  // when it next becomes active.

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
      if (o.hidden !== isHidden(q)) { s.add(i); return; }
      if (o.pii !== !!q.pii) s.add(i);
    });
    return s;
  }, [questions, original]);

  useUnsavedGuard(dirtyIndices.size > 0);

  // Live duplicate-export-label detection among analyzed (non-hidden) questions.
  // colName collisions make charts/exports reference an ambiguous column, so they
  // block saving. Recomputed on every edit so highlights clear as the user fixes them.
  const dupInfo = useMemo(() => {
    const byCol = new Map();   // colName -> [idx, …]
    (questions || []).forEach((q, i) => {
      if (isHidden(q)) return;
      const c = colName(q);
      if (!c) return;
      if (!byCol.has(c)) byCol.set(c, []);
      byCol.get(c).push(i);
    });
    const indices = new Set();
    const cols = [];
    for (const [c, idxs] of byCol) {
      if (idxs.length > 1) { cols.push(c); idxs.forEach(i => indices.add(i)); }
    }
    return { indices, cols };
  }, [questions]);

  // Count of revealed rows that are STILL duplicated (frozen membership, live state).
  const unresolvedDupCount = useMemo(() =>
    revealedDupIdx ? [...revealedDupIdx].filter(i => dupInfo.indices.has(i)).length : 0,
    [revealedDupIdx, dupInfo]);

  // Smallest revealed index → the row we scroll into view when the reveal opens.
  const scrollTargetIdx = useMemo(() =>
    revealedDupIdx && revealedDupIdx.size ? Math.min(...revealedDupIdx) : null,
    [revealedDupIdx]);

  // Scroll to the first offender once the revealed rows have rendered (the GroupTree
  // remounts fully expanded on reveal, so the target row is mounted by commit time).
  useEffect(() => {
    if (!dupScrollSignal) return;
    scrollElRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [dupScrollSignal]);

  const exitReveal = useCallback(() => setRevealedDupIdx(null), []);

  // Deterministic unique-name proposals for the revealed offenders. Each is the
  // cleaned-up kobo_key, made unique against every other (non-revealed) export
  // label and against the other proposals in this batch. Stable across edits
  // (derived from the immutable kobo_key), so the pills don't shuffle while typing.
  const proposals = useMemo(() => {
    const map = new Map();
    if (!revealedDupIdx || !questions) return map;
    const taken = new Set();
    questions.forEach((q, i) => { if (!revealedDupIdx.has(i)) { const c = colName(q); if (c) taken.add(c); } });
    [...revealedDupIdx].sort((a, b) => a - b).forEach(i => {
      const q = questions[i];
      const base = cleanBase(bareName(q)) || cleanBase(q.kobo_key) || bareName(q).toLowerCase() || 'field';
      let name = base, n = 1;
      while (taken.has(name)) { n += 1; name = `${base}_${n}`; }
      taken.add(name);
      map.set(i, name);
    });
    return map;
  }, [revealedDupIdx, questions]);

  // Apply every proposal to the offenders that are still duplicated (leaves rows the
  // user already fixed by hand untouched). Nothing persists until Save changes.
  const acceptAllProposals = () => {
    setQuestions(prev => prev.map((q, i) => {
      if (revealedDupIdx?.has(i) && dupInfo.indices.has(i)) {
        const p = proposals.get(i);
        if (p && p !== (q.export_label || '')) return { ...q, export_label: p };
      }
      return q;
    }));
    toast('Applied suggested names — review and Save changes', 'ok');
  };

  // Apply filter + search → list of { q, idx }, then build the nested group tree.
  const tree = useMemo(() => {
    if (!questions) return [];
    const sLower = search.trim().toLowerCase();
    const items = [];
    questions.forEach((q, i) => {
      if (revealedDupIdx) {
        // Reveal mode: show ONLY the frozen offenders (membership stays stable while
        // editing so a row doesn't unmount the moment its label becomes unique).
        if (!revealedDupIdx.has(i)) return;
        items.push({ q, idx: i });
        return;
      }
      if (filter === 'renamed') {
        const dirty = dirtyIndices.has(i);
        if (!dirty && (q.export_label || '') === (q.label || '')) return;
      }
      if (filter === 'hidden' && !isHidden(q)) return;
      if (filter === 'pii' && !q.pii) return;
      if (sLower) {
        const hay = [q.kobo_key, q.label, q.export_label].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(sLower)) return;
      }
      items.push({ q, idx: i });
    });

    // Only bucket into the collapsed Hidden / PII sub-sections in the all/renamed
    // views. The Hidden and PII filter views already restrict to those rows, so
    // they render as normal group rows; the reveal view shows every offender plainly.
    const bucket = !revealedDupIdx && (filter === 'all' || filter === 'renamed');
    return buildGroupTree(items, {
      getPath: ({ q }) => q.group,
      getHidden: ({ q }) => (bucket ? isHidden(q) : false),
      getPii: ({ q }) => (bucket ? !!q.pii : false),
    });
  }, [questions, filter, search, dirtyIndices, revealedDupIdx]);

  const setExportLabel = (idx, value) => {
    setQuestions(prev => prev.map((q, i) => (i === idx ? { ...q, export_label: value } : q)));
  };

  const toggleHidden = (idx) => {
    setQuestions(prev => prev.map((q, i) => (i === idx ? { ...q, hidden: !isHidden(q) } : q)));
  };

  const togglePII = (idx) => {
    setQuestions(prev => prev.map((q, i) => (i === idx ? { ...q, pii: !q.pii } : q)));
  };

  // Both metadata-only assistants (hide-clutter, flag-PII) open a confirm modal: the
  // AI's suggestions are pre-checked, the user can uncheck any, and only checked fields
  // get the flag (`hidden` or `pii`) on Apply. Unchecked suggestions are explicitly NOT
  // flagged. Nothing persists until "Save changes".
  const openSuggestReview = async (kind, { endpoint, emptyMsg, title, hint, noun }) => {
    setSuggesting(kind);
    try {
      const res = await fetch(endpoint, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Request failed');
      const flagged = new Set(data.suggestions || []);
      if (!flagged.size) { toast(data.message || emptyMsg, 'ok'); return; }
      const items = [];
      questions.forEach((q, idx) => {
        if (flagged.has(q.kobo_key)) items.push({ idx, name: bareName(q), label: q.label || colName(q), checked: true });
      });
      setReviewModal({ kind, title, hint, noun, items });
    } catch (e) {
      toast(String(e.message || e), 'err');
      // The AI call failed (bad key, no credits, …) — the server re-locked the AI
      // connection; refresh status so the AI buttons disable until re-tested.
      window.dispatchEvent(new CustomEvent('databridge:ai-recheck'));
    } finally {
      setSuggesting(null);
    }
  };

  const suggestHidden = () => openSuggestReview('hidden', {
    endpoint: '/api/questions/suggest-hidden',
    emptyMsg: 'Nothing to tidy — no extra clutter found',
    title: 'Auto-hide clutter',
    hint: 'The AI flagged these fields as non-analytical clutter to hide. Uncheck any you want to keep — only checked fields are hidden.',
    noun: 'field(s) to hide',
  });
  const suggestPII = () => openSuggestReview('pii', {
    endpoint: '/api/questions/suggest-pii',
    emptyMsg: 'No likely-PII fields detected',
    title: 'Flag PII fields',
    hint: "The AI flagged these fields as likely personal data. Uncheck any that shouldn't be treated as PII — only checked fields are marked.",
    noun: 'field(s) as PII',
  });

  const toggleReviewItem = (idx) =>
    setReviewModal(m => ({ ...m, items: m.items.map(it => (it.idx === idx ? { ...it, checked: !it.checked } : it)) }));
  const setAllReview = (checked) =>
    setReviewModal(m => ({ ...m, items: m.items.map(it => ({ ...it, checked })) }));
  const applyReview = () => {
    const { kind, items, noun } = reviewModal;
    const flagKey = kind === 'hidden' ? 'hidden' : 'pii';
    const decided = new Map(items.map(it => [it.idx, it.checked]));
    setQuestions(prev => prev.map((q, i) => (decided.has(i) ? { ...q, [flagKey]: decided.get(i) } : q)));
    const n = items.filter(it => it.checked).length;
    setReviewModal(null);
    toast(`Flagged ${n} ${noun} — review and Save`, 'ok');
  };

  const save = async () => {
    // Guard against export_label collisions among analyzed (non-hidden) questions —
    // duplicates make charts/exports reference an ambiguous column. Reveal the
    // offending rows (highlighted + scrolled into view) so the user can rename them.
    if (dupInfo.indices.size) {
      setSearch('');
      setRevealedDupIdx(new Set(dupInfo.indices));
      setDupScrollSignal(s => s + 1);
      toast(`Fix duplicate export labels before saving: ${dupInfo.cols.slice(0, 5).join(', ')}${dupInfo.cols.length > 5 ? '…' : ''}`, 'err');
      return;
    }
    setRevealedDupIdx(null);
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
      // Questions changed → let other keep-alive tabs (Profile/Validate/…) refresh.
      window.dispatchEvent(new CustomEvent('databridge:data-changed', { detail: { source: 'questions' } }));
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
          const pii = !!q.pii;
          const liveDup = dupInfo.indices.has(idx);
          const isScrollTarget = idx === scrollTargetIdx;
          return (
            <tr key={idx} id={`q-row-${idx}`}
                ref={isScrollTarget ? scrollElRef : undefined}
                className={liveDup ? 'q-row--dup' : undefined}>
              <td className="q-table__name">
                {bareName(q)}
                {pii && <span className="q-pii-badge" title="Flagged as PII — excluded from AI metadata">PII</span>}
              </td>
              <td>
                <span className="q-type-badge" data-cat={q.category || 'undefined'}>{q.type || ''}</span>
              </td>
              <td className="q-table__label">{q.label || ''}</td>
              <td>
                <input
                  className="q-export-input"
                  data-dirty={dirty}
                  data-dup={liveDup || undefined}
                  title={liveDup ? 'Duplicate export label — rename so it is unique' : undefined}
                  value={q.export_label || ''}
                  placeholder={q.label || q.kobo_key}
                  onChange={e => setExportLabel(idx, e.target.value)}
                  disabled={hidden}
                />
                {liveDup && proposals.get(idx) && proposals.get(idx) !== (q.export_label || '') && (
                  <div className="q-proposal">
                    <span className="q-proposal__old">{colName(q)}</span>
                    <span className="q-proposal__arrow">→</span>
                    <code className="q-proposal__new">{proposals.get(idx)}</code>
                    <button type="button" className="q-proposal__use"
                            onClick={() => setExportLabel(idx, proposals.get(idx))}>Use</button>
                  </div>
                )}
              </td>
              <td>
                <div className="q-row-actions">
                  <button disabled={hidden} className={isUsed ? 'q-act--used' : ''} title={isUsed ? 'Used in charts' : 'Not currently used'} onClick={() => toast(isUsed ? `${colName(q)} is wired to a chart` : 'Not used yet', isUsed ? 'ok' : 'err')}>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="3" y1="13" x2="3" y2="8"/>
                      <line x1="7" y1="13" x2="7" y2="4"/>
                      <line x1="11" y1="13" x2="11" y2="10"/>
                    </svg>
                  </button>
                  <button
                    disabled={hidden}
                    className={pii ? 'q-act--pii' : ''}
                    title={pii ? 'Unflag PII' : 'Flag as PII — exclude from AI metadata'}
                    onClick={() => togglePII(idx)}
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 1.5l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6v-4z"/>
                    </svg>
                  </button>
                  <button
                    className={hidden ? 'q-act--hidden' : ''}
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
  if (questions === null) return <div className="page"><p className="empty-state">Loading…</p></div>;
  if (questions.length === 0) {
    return (
      <div className="page">
        <Header
          total={0}
          groups={0}
          unsaved={0}
          onSave={save}
          canEdit={canEdit}
        />
        <div className="src-card"><p className="empty-state">No questions yet — go to <b>Extract → Connection &amp; output</b> and click <b>Fetch questions</b> to pull the schema from your platform.</p></div>
      </div>
    );
  }

  const totalGroups = tree.length;
  const totalUsedInCharts = questions.filter(q => usedInCharts.has(colName(q))).length;
  const totalBoundInd     = questions.filter(q => boundIndicators.has(colName(q))).length;
  const totalRenamed = questions.filter((q, i) =>
    dirtyIndices.has(i) || ((q.export_label || '') !== '' && (q.export_label || '') !== (q.label || ''))
  ).length;
  const totalHidden = questions.filter(q => isHidden(q)).length;
  const totalPii = questions.filter(q => !!q.pii).length;

  return (
    <div className="page">
      <Header
        total={questions.length}
        groups={totalGroups}
        unsaved={dirtyIndices.size}
        onSave={save}
        canEdit={canEdit}
      />

      <RailLayout rail={
        <>
          <StatusCard checks={[
            { tone: questions.length > 0 ? 'ok' : 'warn',
              label: `${questions.length} fields configured`, sub: `${totalGroups} groups` },
            { tone: dupInfo.indices.size > 0 ? 'rose' : 'ok',
              label: dupInfo.indices.size > 0 ? `${dupInfo.cols.length} duplicate labels` : 'No duplicate labels',
              sub: dupInfo.indices.size > 0 ? 'fix before saving' : 'export labels are unique' },
            { tone: totalUsedInCharts > 0 ? 'ok' : 'warn',
              label: `${totalUsedInCharts} used in charts`, sub: `${totalBoundInd} bound to indicators` },
            { tone: 'ok',
              label: `${totalPii} PII-flagged`, sub: `${totalHidden} hidden from report` },
          ]} />
          <QuickActionsCard actions={[
            { icon: RailIcons.refresh, label: 'Fetch questions', onClick: () => run('fetch-questions'),
              disabled: !canEdit, title: canEdit ? 'Re-fetch the form schema (preserves your edits)' : 'Editor access required' },
            { icon: RailIcons.sparkle, label: 'Auto-hide clutter', onClick: suggestHidden,
              disabled: !!suggesting || !aiReady, title: aiReady ? 'Ask the AI to flag non-analytical fields' : AI_LOCK_TIP },
            { icon: RailIcons.shield, label: 'Flag PII', onClick: suggestPII,
              disabled: !!suggesting || !aiReady, title: aiReady ? 'Ask the AI to flag personal-data fields' : AI_LOCK_TIP },
            { icon: RailIcons.save, label: 'Save changes', onClick: save,
              disabled: dirtyIndices.size === 0 || !canEdit, title: canEdit ? '' : 'Editor access required' },
          ]} />
        </>
      }>

      <div className="q-toolbar">
        <div className="q-toolbar__left">
          <div className="q-search">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/></svg>
            <input placeholder="Search by name or label..." value={search} onChange={e => { setSearch(e.target.value); exitReveal(); }} />
          </div>
          <div className="config-view-toggle">
            <button className={`view-btn ${filter === 'all' && !revealedDupIdx ? 'active' : ''}`} onClick={() => { setFilter('all'); exitReveal(); }}>All</button>
            <button className={`view-btn ${filter === 'renamed' && !revealedDupIdx ? 'active' : ''}`} onClick={() => { setFilter('renamed'); exitReveal(); }}>
              Renamed <span style={{ fontFamily: 'var(--font-mono)', opacity: .7, marginLeft: 2 }}>({totalRenamed})</span>
            </button>
            <button className={`view-btn ${filter === 'hidden' && !revealedDupIdx ? 'active' : ''}`} onClick={() => { setFilter('hidden'); exitReveal(); }}>
              Hidden <span style={{ fontFamily: 'var(--font-mono)', opacity: .7, marginLeft: 2 }}>({totalHidden})</span>
            </button>
            <button className={`view-btn ${filter === 'pii' && !revealedDupIdx ? 'active' : ''}`} onClick={() => { setFilter('pii'); exitReveal(); }}>
              PII <span style={{ fontFamily: 'var(--font-mono)', opacity: .7, marginLeft: 2 }}>({totalPii})</span>
            </button>
          </div>
          <button className="ai-btn" onClick={suggestHidden} disabled={!!suggesting || !aiReady}
                  title={aiReady ? 'Ask the AI to flag non-analytical clutter to hide (reads only field metadata)' : AI_LOCK_TIP}>
            {suggesting === 'hidden' ? 'Asking AI…' : '✦ Auto-hide clutter'}
          </button>
          <button className="ai-btn" onClick={suggestPII} disabled={!!suggesting || !aiReady}
                  title={aiReady ? 'Ask the AI to flag fields that likely contain personal data (reads only field metadata)' : AI_LOCK_TIP}>
            {suggesting === 'pii' ? 'Asking AI…' : '✦ Flag PII'}
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

      {revealedDupIdx && (
        <div className="dup-banner" role="alert">
          <div className="dup-banner__text">
            {unresolvedDupCount > 0 ? (
              <>
                <b>{unresolvedDupCount} field{unresolvedDupCount === 1 ? '' : 's'}</b> still share a duplicate export
                label. Accept a suggested name (<b>Use</b> / <b>Accept all proposals</b>) or rename each manually,
                then Save changes.
              </>
            ) : (
              <>All duplicates resolved — click <b>Save changes</b> to continue.</>
            )}
          </div>
          <div className="dup-banner__actions">
            {unresolvedDupCount > 0 && (
              <button className="btn btn-primary btn-sm" onClick={acceptAllProposals}>Accept all proposals</button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={exitReveal}>Show all fields</button>
          </div>
        </div>
      )}

      <div className="q-groups">
        {tree.length > 0 ? (
          <GroupTree
            key={revealedDupIdx ? 'reveal' : 'normal'}
            defaultOpenDepth={revealedDupIdx ? 99 : 0}
            tree={tree}
            renderVisible={renderRows}
            renderHidden={renderRows}
            renderPii={renderRows}
            renderHeaderExtra={renderHeaderExtra}
          />
        ) : (
          <p className="empty-state" style={{ padding: 30 }}>No questions match your filter.</p>
        )}
      </div>

      </RailLayout>

      {reviewModal && (
        <Modal title={reviewModal.title} onClose={() => setReviewModal(null)} onSave={applyReview} saveLabel="Apply">
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 8 }}>
            {reviewModal.hint} (Then <b>Save changes</b> to persist.)
          </p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {reviewModal.items.filter(i => i.checked).length} of {reviewModal.items.length} selected
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setAllReview(true)}>Select all</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setAllReview(false)}>Select none</button>
            </div>
          </div>
          <div style={{ maxHeight: 340, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            {reviewModal.items.map(it => (
              <label key={it.idx}
                     style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                              borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                <input type="checkbox" checked={it.checked} onChange={() => toggleReviewItem(it.idx)} />
                <span style={{ fontWeight: 600 }}>{it.name}</span>
                {it.label && it.label !== it.name &&
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>{it.label}</span>}
              </label>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Header band ──────────────────────────────────────────────────────────────
function Header({ total, groups, unsaved, onSave, canEdit }) {
  return (
    <PageHeader
      eyebrow={`Step 2 of 5 · Questions · ${total} fields · ${groups} groups`}
      title="Rename what shows up"
      accent="in the report."
      sub="Each row is a survey question. Edit the Export label to change how that column appears in charts, indicators, and Word placeholders — no YAML required."
      actions={
        <>
          {unsaved > 0 && <span className="q-unsaved-pill">{unsaved} unsaved</span>}
          <button className="btn btn-primary" onClick={onSave} disabled={unsaved === 0 || !canEdit}
                  title={canEdit ? '' : 'You have viewer access — editing questions requires an editor or admin role'}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 8 7 12 13 4"/></svg>
            Save changes
          </button>
        </>
      }
    />
  );
}

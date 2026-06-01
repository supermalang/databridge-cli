import { useEffect, useMemo, useState } from 'react';
import PageHeader from './PageHeader.jsx';
import { useToast } from '../components/Toast.jsx';
import { isHidden, indexQuestionsByColumn, buildGroupTree } from '../lib/questionGroups.js';
import GroupTree from '../components/GroupTree.jsx';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const SEV_RANK = { error: 0, warning: 1, info: 2 };

export default function Validate() {
  const toast = useToast();
  const [report, setReport] = useState(null);   // null | { n_rows, n_columns, checks, summary }
  const [questions, setQuestions] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadQuestions = async () => {
    try {
      const r = await fetch('/api/questions');
      const d = await r.json().catch(() => ({}));
      if (r.ok) setQuestions(d.questions || []);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const vr = await fetch('/api/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await vr.json().catch(() => ({}));
        if (cancelled) return;
        if (!vr.ok) { setError(data.detail || `Request failed (${vr.status})`); return; }
        setReport(data);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    loadQuestions();
    return () => { cancelled = true; };
  }, []);

  // Robust column → question match: exact, then normalized (case/punctuation-
  // insensitive) so findings reliably resolve to their group + question.
  const questionsByColumn = useMemo(() => indexQuestionsByColumn(questions), [questions]);
  const normIndex = useMemo(() => {
    const m = new Map();
    for (const [k, q] of questionsByColumn) { const nk = norm(k); if (nk && !m.has(nk)) m.set(nk, q); }
    return m;
  }, [questionsByColumn]);
  const findQuestion = (column) => questionsByColumn.get(column) || normIndex.get(norm(column)) || null;

  // Inline remediation: set a flag on the finding's question (by kobo_key),
  // optimistic + persisted. The flagged column then drops out of the findings.
  const setFlag = async (column, patch, okMsg) => {
    const q = findQuestion(column);
    if (!q) { toast(`No question matches “${column}” — manage it on the Questions tab.`, 'err'); return; }
    const next = questions.map(x => (x.kobo_key === q.kobo_key ? { ...x, ...patch } : x));
    setQuestions(next);
    try {
      const res = await fetch('/api/questions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: next }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.detail || 'Save failed'); }
      toast(okMsg, 'ok');
      // Questions changed → let other keep-alive tabs (Profile/Questions/…) refresh.
      window.dispatchEvent(new CustomEvent('databridge:data-changed', { detail: { source: 'validate' } }));
    } catch (e) {
      toast(String(e.message || e), 'err');
      loadQuestions();   // resync on failure
    }
  };
  const hideColumn = (column) => setFlag(column, { hidden: true }, `“${column}” hidden — excluded from analysis`);
  const flagPII   = (column) => setFlag(column, { pii: true }, `“${column}” flagged as PII`);

  const groupOf = (chk) => {
    const q = findQuestion(chk.column);
    return q ? (q.group || '') : 'Ungrouped';
  };

  // Show only findings on columns that are NOT hidden and NOT PII.
  const visibleChecks = report
    ? report.checks.filter((chk) => {
        const q = findQuestion(chk.column);
        return !(q && (isHidden(q) || q.pii));
      })
    : [];

  // Organize strictly by group (unmatched 'Ungrouped' last; errors first within a group).
  const orderedChecks = [...visibleChecks].sort((a, b) => {
    const ga = groupOf(a), gb = groupOf(b);
    const ra = ga === 'Ungrouped' ? 1 : 0, rb = gb === 'Ungrouped' ? 1 : 0;
    if (ra !== rb) return ra - rb;
    if (ga !== gb) return ga.localeCompare(gb);
    const sa = SEV_RANK[a.severity] ?? 9, sb = SEV_RANK[b.severity] ?? 9;
    if (sa !== sb) return sa - sb;
    return (b.count || 0) - (a.count || 0);
  });

  const tree = buildGroupTree(orderedChecks, { getPath: groupOf, getHidden: () => false });

  // Counts reflect what's currently shown (so they update after hide/flag).
  const counts = visibleChecks.reduce(
    (a, f) => { if (f.severity in a) a[f.severity] += 1; return a; },
    { error: 0, warning: 0, info: 0 }
  );

  const renderFindings = (checks) => (
    <div className="validate-findings">
      {checks.map((f, i) => {
        const canAct = !!findQuestion(f.column);
        return (
          <div className="validate-finding" data-severity={f.severity} key={`${f.kind}-${f.column}-${i}`}>
            <div className="validate-finding__bar" />
            <div>
              <div>
                <span className="validate-finding__column">{f.column}</span>
                <span className="validate-finding__kind">{f.kind}</span>
              </div>
              <div className="validate-finding__msg">{f.message}</div>
              {f.examples?.length > 0 && (
                <div className="validate-finding__examples">
                  Examples: {f.examples.map(v => JSON.stringify(v)).join(', ')}
                </div>
              )}
            </div>
            <div className="validate-finding__count">
              {f.count.toLocaleString()} row{f.count === 1 ? '' : 's'}
              <br />
              <span style={{ color: f.severity === 'error' ? 'var(--danger, #b91c1c)' : f.severity === 'warning' ? 'var(--warn, #b45309)' : 'var(--ink-3)' }}>
                {(f.pct * 100).toFixed(1)}%
              </span>
            </div>
            <div className="validate-finding__actions">
              <button
                disabled={!canAct}
                title={canAct ? 'Flag as PII — exclude from analysis & AI' : 'No matching question to flag'}
                onClick={() => flagPII(f.column)}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 1.5l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6v-4z"/></svg>
              </button>
              <button
                disabled={!canAct}
                title={canAct ? 'Hide column — exclude from analysis' : 'No matching question to hide'}
                onClick={() => hideColumn(f.column)}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 2l12 12"/><path d="M6.5 6.6a2 2 0 0 0 2.8 2.8"/><path d="M4.3 4.4C2.7 5.4 1.5 8 1.5 8s2.5 4 6.5 4c1 0 1.9-.2 2.7-.6"/><path d="M7 4.1A6 6 0 0 1 8 4c4 0 6.5 4 6.5 4a12 12 0 0 1-1.6 2"/></svg>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="page">
      <PageHeader
        eyebrow="Step 03 · Validate"
        title="Check your"
        accent="data."
        sub="Scan the downloaded submissions for missingness, duplicates, outliers, and type problems. Hide a column or flag it as PII to resolve a finding."
      />
      {loading && <div style={{ color: 'var(--ink-3)', textAlign: 'center', padding: 60 }}>Running validation…</div>}
      {error && (
        <div style={{ padding: 24, color: 'var(--danger, #b91c1c)' }}>
          <div style={{ fontWeight: 600 }}>Validation failed</div>
          <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 13, marginTop: 6 }}>{error}</div>
          <div style={{ marginTop: 8, color: 'var(--ink-3)', fontSize: 12 }}>If no data is downloaded yet, run <strong>Download</strong> in the Dashboard first.</div>
        </div>
      )}
      {report && (
        <div>
          <div style={{ color: 'var(--ink-3)', fontSize: 13, marginBottom: 16 }}>
            Scanned {report.n_rows.toLocaleString()} rows · {report.n_columns} columns ·
            <span style={{ marginLeft: 8, color: 'var(--danger, #b91c1c)' }}>{counts.error} errors</span> ·
            <span style={{ marginLeft: 8, color: 'var(--warn, #b45309)' }}>{counts.warning} warnings</span> ·
            <span style={{ marginLeft: 8 }}>{counts.info} notes</span>
          </div>
          {visibleChecks.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>No issues found on visible columns — your data looks clean.</div>
          ) : (
            <GroupTree tree={tree} renderVisible={renderFindings} />
          )}
        </div>
      )}
    </div>
  );
}

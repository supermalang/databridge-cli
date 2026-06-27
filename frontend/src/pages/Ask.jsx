import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import PageHeader from './PageHeader.jsx';
import Modal from '../components/Modal.jsx';
import EmptyState from '../components/EmptyState.jsx';
import AiThinking from '../components/AiThinking.jsx';
import { useAiStatus, AI_LOCK_TIP } from '../lib/aiStatus.js';

const ASK_MESSAGES = [
  'Reading your question…',
  'Scanning your data…',
  'Computing the answer…',
  'Building the chart…',
  'Writing the caption…',
];

// Generic fallback shown instantly; replaced on mount by data-aware examples from
// /api/ask/examples (AI-generated when available, else derived from the schema).
const ASK_EXAMPLES = [
  'How many submissions by region?',
  'Show the age distribution',
  'Average score by site',
  'How did submissions change over time?',
  'Which regions had the most responses?',
];

// Session-scoped cache so revisiting/remounting the Ask tab reuses the already-
// fetched examples (no refetch, no static→AI flash). The backend caches the LLM
// call itself; this just skips the round-trip. Cleared on data-changed (project
// switch / config save) so a schema change re-fetches fresh examples next mount.
let _examplesCache = null;
if (typeof window !== 'undefined') {
  window.addEventListener('databridge:data-changed', () => { _examplesCache = null; });
}

export default function Ask() {
  const { t } = useTranslation();
  const { aiReady } = useAiStatus();
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState({});
  const [refineInputs, setRefineInputs] = useState({});   // index -> instruction text
  const [refining, setRefining] = useState({});           // index -> bool
  const [examples, setExamples] = useState(_examplesCache || ASK_EXAMPLES);

  // Pull data-aware starter questions on mount (AI when available, else schema).
  // Reuse the session cache if present; otherwise fetch and cache. Falls back
  // silently to the static list if the request fails.
  useEffect(() => {
    if (_examplesCache) return;   // already shown via the initial state
    let alive = true;
    fetch('/api/ask/examples')
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.examples) && d.examples.length) {
          _examplesCache = d.examples;
          if (alive) setExamples(d.examples);
        }
      })
      .catch(() => { /* keep static fallback */ });
    return () => { alive = false; };
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (!question.trim()) return;
    setLoading(true); setError(null); setResult(null); setSaved({});
    try {
      const r = await fetch('/api/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(data.detail || `Request failed (${r.status})`);
        // AI call failed → server re-locked the connection; refresh the guard.
        window.dispatchEvent(new CustomEvent('databridge:ai-recheck'));
        return;
      }
      setResult(data);
    } catch (err) {
      setError(err.message || 'Network error');
      window.dispatchEvent(new CustomEvent('databridge:ai-recheck'));
    } finally {
      setLoading(false);
    }
  }

  async function save(recipe, kind) {
    try {
      const r = await fetch('/api/ask/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipe, kind }),
      });
      const data = await r.json().catch(() => ({}));
      if (data.ok) {
        setSaved(s => ({ ...s, [recipe.name]: true }));
        // The recipe is now in config.charts/indicators/tables — let the kept-alive
        // Charts/Indicators/Tables (Composition) tab refresh so it shows up there.
        window.dispatchEvent(new CustomEvent('databridge:data-changed', { detail: { source: 'ask' } }));
      }
    } catch { /* noop */ }
  }

  async function refine(i, recipe, kind) {
    const instruction = (refineInputs[i] || '').trim();
    if (!instruction) return;
    setRefining(r => ({ ...r, [i]: true }));
    try {
      const resp = await fetch('/api/ask/refine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipe, kind, instruction }),
      });
      const data = await resp.json().catch(() => ({}));
      if (data.proposal) {
        setResult(prev => {
          const proposals = prev.proposals.slice();
          proposals[i] = data.proposal;
          return { ...prev, proposals };
        });
        setRefineInputs(s => ({ ...s, [i]: '' }));
        setSaved(s => {            // the refined version isn't saved yet
          const next = { ...s };
          delete next[data.proposal.recipe?.name];
          return next;
        });
      } else {
        const note = data.skipped ? data.skipped.reason : (data.message || 'No change');
        setResult(prev => {
          const proposals = prev.proposals.slice();
          proposals[i] = { ...proposals[i], refineNote: note };
          return { ...prev, proposals };
        });
      }
    } catch { /* noop */ } finally {
      setRefining(r => ({ ...r, [i]: false }));
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow={t('ask.eyebrow')}
        title={t('ask.title')}
        accent={t('ask.accent')}
        sub={t('ask.sub')}
      />
      {!aiReady && (
        <div className="empty-state" style={{ padding: 12, marginBottom: 10, border: '1px solid var(--border)', borderRadius: 8 }}>
          {AI_LOCK_TIP} to use Ask.
        </div>
      )}
      <form onSubmit={submit} style={{ display: 'flex', gap: 8 }}>
        <input
          value={question}
          onChange={e => setQuestion(e.target.value)}
          disabled={!aiReady}
          placeholder={t('ask.placeholder')}
          style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--line, #e5e7eb)' }}
        />
        <button type="submit" disabled={loading || !aiReady} title={aiReady ? '' : AI_LOCK_TIP}
                style={{ padding: '10px 18px', borderRadius: 8 }}>
          {loading ? 'Asking…' : 'Ask'}
        </button>
      </form>

      {loading && (
        <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}>
          <AiThinking messages={ASK_MESSAGES} />
        </div>
      )}

      {/* First-run guidance: what you can ask + one-click examples. */}
      {!loading && !error && !result && (
        <EmptyState
          title={t('ask.emptyTitle')}
          description={t('ask.emptyBody')}
          action={
            <div className="ask-examples">
              {examples.map(ex => (
                <button key={ex} type="button" className="ask-example"
                        disabled={!aiReady} title={aiReady ? '' : AI_LOCK_TIP}
                        onClick={() => setQuestion(ex)}>{ex}</button>
              ))}
            </div>
          }
        />
      )}

      {error && (
        <EmptyState tone="error" title={t('ask.errorTitle')}
          description={error.includes('data') ? t('validate.errorBody', { error }) : error} />
      )}
      {result?.message && !(result?.proposals?.length) && (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>{result.message}</div>
      )}

      {result?.proposals?.length > 0 && (
        <Modal title={`Results · “${result.question || question}”`} onClose={() => setResult(null)} width={860}>
          {result?.skipped?.length > 0 && (
            <div style={{ marginBottom: 12, color: 'var(--ink-3)', fontSize: 12.5 }}>
              Skipped {result.skipped.length} suggestion(s): {result.skipped.map(s => `${s.title} (${s.reason})`).join('; ')}
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            {result.proposals.map((p, i) => (
              <div key={p.recipe?.name || i}
                   style={{ border: '1px solid var(--line, #e5e7eb)', borderRadius: 10, padding: 12, width: 370, maxWidth: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{ fontWeight: 600, flex: 1 }}>{p.recipe?.title || p.recipe?.name}</span>
                  <span className="tag" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-3)' }}>{p.kind}</span>
                </div>
                {p.kind === 'indicator' ? (
                  <div style={{ fontSize: 34, fontWeight: 700, padding: '12px 0' }}>{p.value}</div>
                ) : (
                  <img src={p.image} alt={p.recipe?.title || p.kind} style={{ width: '100%', borderRadius: 6 }} />
                )}
                <div style={{ color: 'var(--ink-3)', fontSize: 13, margin: '8px 0' }}>{p.caption}</div>
                <button className="btn btn-primary btn-sm" onClick={() => save(p.recipe, p.kind)} disabled={saved[p.recipe?.name]}
                        style={{ padding: '6px 12px', borderRadius: 6 }}>
                  {saved[p.recipe?.name] ? 'Applied ✓' : `Apply to ${p.kind === 'indicator' ? 'indicators' : p.kind === 'table' ? 'tables' : 'charts'}`}
                </button>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <input
                    value={refineInputs[i] || ''}
                    onChange={e => setRefineInputs(s => ({ ...s, [i]: e.target.value }))}
                    placeholder={t('ask.refinePlaceholder')}
                    style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--line, #e5e7eb)', fontSize: 12.5 }}
                  />
                  <button className="btn btn-ghost btn-sm" onClick={() => refine(i, p.recipe, p.kind)} disabled={refining[i]}
                          style={{ padding: '6px 10px', borderRadius: 6, fontSize: 12.5 }}>
                    {refining[i] ? '…' : 'Refine'}
                  </button>
                </div>
                {p.refineNote && (
                  <div style={{ color: 'var(--ink-3)', fontSize: 12, marginTop: 4 }}>{p.refineNote}</div>
                )}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

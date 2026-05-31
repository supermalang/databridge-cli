import { useState } from 'react';
import PageHeader from './PageHeader.jsx';

export default function Ask() {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState({});
  const [refineInputs, setRefineInputs] = useState({});   // index -> instruction text
  const [refining, setRefining] = useState({});           // index -> bool

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
      if (!r.ok) { setError(data.detail || `Request failed (${r.status})`); return; }
      setResult(data);
    } catch (err) {
      setError(err.message || 'Network error');
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
      if (data.ok) setSaved(s => ({ ...s, [recipe.name]: true }));
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
    <div style={{ padding: '0 0 40px' }}>
      <PageHeader
        eyebrow="Ask"
        title="Ask your"
        accent="data."
        sub="Ask a question in plain language — get charts computed from your data, with captions grounded in the actual numbers."
      />
      <form onSubmit={submit} style={{ display: 'flex', gap: 8, padding: '0 8px 16px' }}>
        <input
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="e.g. How many submissions by region?"
          style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--line, #e5e7eb)' }}
        />
        <button type="submit" disabled={loading} style={{ padding: '10px 18px', borderRadius: 8 }}>
          {loading ? 'Asking…' : 'Ask'}
        </button>
      </form>

      {error && <div style={{ padding: 24, color: 'var(--danger, #b91c1c)' }}>{error}</div>}
      {result?.message && (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>{result.message}</div>
      )}
      {result?.skipped?.length > 0 && (
        <div style={{ padding: '0 8px 12px', color: 'var(--ink-3)', fontSize: 12.5 }}>
          Skipped {result.skipped.length} suggestion(s): {result.skipped.map(s => `${s.title} (${s.reason})`).join('; ')}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: '0 8px' }}>
        {result?.proposals?.map((p, i) => (
          <div key={p.recipe?.name || i}
               style={{ border: '1px solid var(--line, #e5e7eb)', borderRadius: 10, padding: 12, width: 380, maxWidth: '100%' }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{p.recipe?.title || p.recipe?.name}</div>
            {p.kind === 'indicator' ? (
              <div style={{ fontSize: 34, fontWeight: 700, padding: '12px 0' }}>{p.value}</div>
            ) : (
              <img src={p.image} alt={p.recipe?.title || 'chart'} style={{ width: '100%', borderRadius: 6 }} />
            )}
            <div style={{ color: 'var(--ink-3)', fontSize: 13, margin: '8px 0' }}>{p.caption}</div>
            <button onClick={() => save(p.recipe, p.kind)} disabled={saved[p.recipe?.name]}
                    style={{ padding: '6px 12px', borderRadius: 6 }}>
              {saved[p.recipe?.name] ? 'Saved ✓' : 'Save to report'}
            </button>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <input
                value={refineInputs[i] || ''}
                onChange={e => setRefineInputs(s => ({ ...s, [i]: e.target.value }))}
                placeholder="Refine — e.g. make it a line chart, split by sex"
                style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--line, #e5e7eb)', fontSize: 12.5 }}
              />
              <button onClick={() => refine(i, p.recipe, p.kind)} disabled={refining[i]}
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
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';

// Debounce window for the live chart-preview pane in the chart editor (PUX-11).
// Field changes (title, type, questions, color, top_n, etc.) collapse into a
// single /api/charts/preview request fired ~600ms after the last change.
const DEBOUNCE_MS = 600;

// Debounced live preview for the chart editor modal (PUX-11).
//
// Pass the current chart draft (name/title/type/questions/options) — any
// change to its serialized form restarts the debounce timer. Returns
// { loading, error, image } so the caller can render a skeleton, an inline
// error, or the rendered chart image without wiring up fetch/debounce itself.
export function useChartPreview(chart) {
  const [state, setState] = useState({ loading: false, error: null, image: null });
  const timerRef = useRef(null);
  const reqIdRef = useRef(0);

  // Stringify so effect deps are stable across re-renders that pass a
  // structurally-equal-but-new chart object (e.g. derived from form state).
  const key = chart ? JSON.stringify(chart) : null;

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!chart) return;

    timerRef.current = setTimeout(() => {
      const reqId = ++reqIdRef.current;
      setState({ loading: true, error: null, image: null });
      fetch('/api/charts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chart }),
      })
        .then(async (resp) => {
          const data = await resp.json().catch(() => ({}));
          if (reqIdRef.current !== reqId) return; // superseded by a newer request
          if (!resp.ok) {
            setState({ loading: false, error: data.detail || `Request failed (${resp.status})`, image: null });
            return;
          }
          setState({ loading: false, error: null, image: data.image });
        })
        .catch((e) => {
          if (reqIdRef.current !== reqId) return;
          setState({ loading: false, error: e.message || 'Network error', image: null });
        });
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import yaml from 'js-yaml';
import Modal from '../components/Modal.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import FrameworkPicker from '../components/FrameworkPicker.jsx';
import { useToast } from '../components/Toast.jsx';
import { useCommand } from '../hooks/useCommand.js';
import { loadConfig, saveConfigPatch } from '../lib/config.js';
import { useAiStatus, AI_LOCK_TIP } from '../lib/aiStatus.js';
import { useFieldErrors } from '../lib/fieldError.js';
import PageHeader from './PageHeader.jsx';
import { RailLayout, StatusCard, QuickActionsCard, RailIcons } from '../components/Rail.jsx';
import AiThinking from '../components/AiThinking.jsx';

// ── chart type catalog ───────────────────────────────────────────────────────
const CHART_TYPES = [
  'bar', 'horizontal_bar', 'stacked_bar', 'grouped_bar', 'pie', 'donut',
  'line', 'area', 'histogram', 'scatter', 'box_plot', 'heatmap', 'treemap',
  'waterfall', 'funnel', 'table', 'bullet_chart', 'likert', 'scorecard',
  'pyramid', 'dot_map', 'period_bar', 'period_line',
];

const INDICATOR_STATS = ['count', 'sum', 'mean', 'median', 'min', 'max', 'mode', 'top', 'pct', 'completeness', 'outlier_rate', 'duplicate_rate'];
const SUMMARY_STATS   = ['distribution', 'numeric', 'crosstab', 'trend', 'ai'];

// What each chart type needs in its Columns field — shown as inline guidance so
// users don't pick a type that can't render with their data.
const CHART_REQS = {
  bar: '1 categorical column', horizontal_bar: '1 categorical column (best for long labels)',
  stacked_bar: '2 categorical columns: [x_axis, stack_by]', grouped_bar: '2 categorical columns: [category, group_by]',
  pie: '1 categorical column', donut: '1 categorical column',
  line: '1–2 columns: a date + a numeric', area: '1–2 columns: a date + a numeric',
  histogram: '1 numeric column', scatter: '2 numeric columns',
  box_plot: '1 categorical + 1 numeric column', heatmap: '2 categorical columns',
  treemap: '1 categorical column', waterfall: '1 categorical column', funnel: '1 categorical column',
  table: '1+ columns to tabulate', bullet_chart: '1 numeric column (set options.target)',
  likert: '1 categorical column (a rating scale)', scorecard: '1+ columns (any type)',
  pyramid: '2 columns: age_group + gender', dot_map: '2 columns: lat + lon',
  period_bar: '1 numeric/categorical column (compared across periods)',
  period_line: '1 numeric/categorical column (trended across periods)',
};

// ── tiny atoms ──────────────────────────────────────────────────────────────
const csv = (a) => Array.isArray(a) ? a.join(', ') : '';
const fromCsv = (s) => s.split(',').map(x => x.trim()).filter(Boolean);

// Lightweight syntactic sanity check for a pandas .query() filter. Not a full
// parser — catches the common mistakes (unbalanced quotes/parens, dangling
// operators) before the user hits a preview/run failure. Returns null if OK.
function validateFilterExpr(expr) {
  const s = (expr || '').trim();
  if (!s) return null;
  let depth = 0, sq = false, dq = false;
  for (const ch of s) {
    if (ch === "'" && !dq) sq = !sq;
    else if (ch === '"' && !sq) dq = !dq;
    else if (!sq && !dq) {
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth < 0) return 'Unbalanced parentheses — too many “)”.'; }
    }
  }
  if (sq || dq) return 'Unbalanced quotes — close the string value.';
  if (depth > 0) return 'Unbalanced parentheses — missing “)”.';
  if (/(\b(and|or|not)\b|[<>=!]=?|[+\-*/])\s*$/i.test(s)) return 'Expression ends with an operator — add the right-hand side.';
  if (/^\s*(and|or)\b/i.test(s)) return 'Expression starts with “and/or”.';
  return null;
}
const fmtNum = (n) => typeof n === 'number' ? n.toLocaleString() : '—';

// Tone class per chart type for the row icon background
function chartTone(type) {
  if (['line', 'area', 'scatter'].includes(type))             return 'rose';
  if (['pie', 'donut', 'treemap', 'heatmap'].includes(type))  return 'violet';
  if (['pyramid', 'likert'].includes(type))                    return 'warm';
  if (['scorecard', 'bullet_chart', 'table'].includes(type))  return 'green';
  return 'accent';
}

// Generic chart icon — small inline SVG that hints at the type.
function ChartIcon({ type }) {
  const t = type || 'bar';
  switch (t) {
    case 'line':
    case 'area':
      return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><polyline points="2 12 6 7 9 10 14 4"/></svg>;
    case 'scatter':
      return <svg viewBox="0 0 16 16" fill="currentColor"><circle cx="4" cy="11" r="1.5"/><circle cx="8" cy="6" r="1.5"/><circle cx="12" cy="9" r="1.5"/></svg>;
    case 'pie':
    case 'donut':
      return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="8" cy="8" r="5.5"/><path d="M8 2.5v5.5h5.5"/></svg>;
    case 'pyramid':
      return <svg viewBox="0 0 16 16" fill="currentColor"><polygon points="8 2 13 13 3 13" fillOpacity=".15" stroke="currentColor" strokeWidth="1.6" /></svg>;
    case 'stacked_bar':
      return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="9" width="3.5" height="4"/><rect x="2" y="6" width="3.5" height="3"/><rect x="6.5" y="11" width="3.5" height="2"/><rect x="6.5" y="7" width="3.5" height="4"/><rect x="11" y="10" width="3.5" height="3"/><rect x="11" y="5" width="3.5" height="5"/></svg>;
    case 'horizontal_bar':
      return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><line x1="2" y1="4" x2="11" y2="4"/><line x1="2" y1="8" x2="14" y2="8"/><line x1="2" y1="12" x2="8" y2="12"/></svg>;
    case 'heatmap':
      return <svg viewBox="0 0 16 16" fill="currentColor" opacity=".85"><rect x="2" y="2" width="3.5" height="3.5"/><rect x="6.5" y="2" width="3.5" height="3.5" opacity=".5"/><rect x="11" y="2" width="3.5" height="3.5" opacity=".3"/><rect x="2" y="6.5" width="3.5" height="3.5" opacity=".5"/><rect x="6.5" y="6.5" width="3.5" height="3.5"/><rect x="11" y="6.5" width="3.5" height="3.5" opacity=".7"/><rect x="2" y="11" width="3.5" height="3.5" opacity=".3"/><rect x="6.5" y="11" width="3.5" height="3.5" opacity=".7"/><rect x="11" y="11" width="3.5" height="3.5"/></svg>;
    case 'likert':
      return <svg viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="3.5" width="4" height="2.5"/><rect x="6.5" y="3.5" width="3" height="2.5" opacity=".5"/><rect x="3" y="7" width="3" height="2.5" opacity=".4"/><rect x="6.5" y="7" width="5" height="2.5"/><rect x="4" y="10.5" width="3" height="2.5"/><rect x="7.5" y="10.5" width="4" height="2.5" opacity=".5"/></svg>;
    default: // bar
      return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><line x1="3.5" y1="13" x2="3.5" y2="8"/><line x1="8" y1="13" x2="8" y2="4"/><line x1="12.5" y1="13" x2="12.5" y2="10"/></svg>;
  }
}

// ── component ────────────────────────────────────────────────────────────────
// `sections` selects which cards render + which config keys this instance saves,
// so the same component backs both the Load (views) and Analyze (charts/etc) tabs.
const ALL_SECTIONS = ['charts', 'indicators', 'tables', 'summaries', 'views', 'templates', 'framework'];

export default function Composition({ sections } = {}) {
  const secs = Array.isArray(sections) && sections.length ? sections : ALL_SECTIONS;
  const has = (k) => secs.includes(k);
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const { markAiFailed } = useAiStatus();
  const [cfg,        setCfg]       = useState({});
  const [filters,    setFilters]   = useState([]);
  const [charts,     setCharts]    = useState([]);
  const [indicators, setIndicators]= useState([]);
  const [tables,     setTables]    = useState([]);
  const [summaries,  setSummaries] = useState([]);
  const [views,      setViews]     = useState([]);
  const [baseline,   setBaseline]  = useState('');   // JSON of editable sections at last load/save
  const [templates,  setTemplates] = useState([]);
  const [activeTpl,  setActiveTpl] = useState('');
  const [editing,    setEditing]   = useState(null);
  const [suggestKind, setSuggestKind] = useState(null); // null | 'chart' | 'view' | 'summary'
  const [suggestText, setSuggestText] = useState('');
  const [suggesting,  setSuggesting]  = useState(null); // null | 'chart' | 'view' | 'summary' (which kind is running)
  const [preview,     setPreview]     = useState(null); // null | { chart, loading?, image?, error? }
  const [viewPreview, setViewPreview] = useState(null); // null | { view, loading?, columns?, rows?, n_rows?, error? }
  const [summaryPreview, setSummaryPreview] = useState(null); // null | { summary, loading?, text?, n_rows?, error? }

  // Dispatch table for batch AI suggestions: maps kind → CLI command, YAML key,
  // setter, and user-facing labels. Keeps the suggest flow generic for all three sections.
  // Keyed by the canonical section key (plural) — the same keys the rail emits via
  // SECTION_LABELS/counts — so onSuggestKind(k) always resolves a spec.
  const suggestSpec = {
    charts:   { command: 'suggest-charts',    key: 'charts',    setter: setCharts,    label: 'chart',   plural: 'charts',
               placeholder: 'e.g. Focus on geographic distribution. Include a stacked bar of food security by region. Avoid simple count charts where possible.' },
    indicators: { command: 'suggest-indicators', key: 'indicators', setter: setIndicators, label: 'indicator', plural: 'indicators',
               placeholder: 'e.g. Headline counts and averages — total households, average household size, % female-headed.' },
    tables:   { command: 'suggest-tables',    key: 'tables',    setter: setTables,    label: 'table',   plural: 'tables',
               placeholder: 'e.g. A breakdown table of households by region, and one of food-security class by wilaya.' },
    views:    { command: 'suggest-views',     key: 'views',     setter: setViews,     label: 'view',    plural: 'views',
               placeholder: 'e.g. Per-Wilaya aggregates for health and education. Join location into all repeat groups.' },
    summaries: { command: 'suggest-summaries', key: 'summaries', setter: setSummaries, label: 'summary', plural: 'summaries',
               placeholder: 'e.g. One paragraph per topic area summarising the most important findings.' },
  };

  // Accumulate streamed log lines while a suggest-* run is active so we can extract
  // the YAML block on completion (or the error on failure).
  const suggestLogRef = useRef([]);
  const { run: runCmd } = useCommand({
    onLog: (line, _level) => { if (suggesting) suggestLogRef.current.push(line); },
    onStatus: ({ status }) => {
      if (!suggesting || (status !== 'success' && status !== 'error')) return;
      const spec = suggestSpec[suggesting];
      const lines = suggestLogRef.current;
      suggestLogRef.current = [];
      setSuggesting(null);
      if (status === 'error') {
        const errLine = [...lines].reverse().find(l => /^[A-Z][A-Za-z]+(Error|Exception):/.test(l.trim()));
        // If the failure looks like an AI/provider error (bad key, no credits, rate
        // limit, …) re-lock the AI connection until it's tested working again.
        const blob = (errLine || lines.map(l => l.line || l).join(' ')).toLowerCase();
        if (/api[ _-]?key|authenticat|unauthorized|\b401\b|rate.?limit|\b429\b|quota|credit|insufficient|openai|anthropic|connection|timed? ?out/.test(blob)) {
          markAiFailed();
        }
        toast(errLine ? errLine.trim() : `${spec.label} suggestion failed (no error detail in logs)`, 'err');
        return;
      }
      // CLI prints a header comment then the YAML block. Find the line starting with "<key>:".
      const yamlStart = lines.findIndex(l => new RegExp(`^\\s*${spec.key}\\s*:`).test(l));
      if (yamlStart < 0) { toast('No suggestions parsed from output', 'err'); return; }
      let parsed;
      try { parsed = yaml.load(lines.slice(yamlStart).join('\n')); }
      catch (e) { toast(`YAML parse error: ${e.message}`, 'err'); return; }
      const suggested = Array.isArray(parsed?.[spec.key]) ? parsed[spec.key] : [];
      if (!suggested.length) { toast('AI returned 0 suggestions', 'err'); return; }
      spec.setter(prev => [...prev, ...suggested]);
      toast(`Added ${suggested.length} suggested ${suggested.length === 1 ? spec.label : spec.plural} — review and Save`, 'ok');
    },
  });

  const openSuggestModal = (kind = 'charts') => { setSuggestText(''); setSuggestKind(kind); };
  const submitSuggestion = () => {
    const kind = suggestKind;
    if (!kind) return;
    setSuggestKind(null);
    suggestLogRef.current = [];
    setSuggesting(kind);
    runCmd(suggestSpec[kind].command, { user_request: suggestText.trim() });
  };

  const openChartPreview = async (i) => {
    const chart = charts[i];
    if (!chart) return;
    setPreview({ chart, loading: true });
    try {
      const resp = await fetch('/api/charts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chart }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setPreview({ chart, error: data.detail || `Request failed (${resp.status})` });
        return;
      }
      setPreview({ chart, image: data.image });
    } catch (e) {
      setPreview({ chart, error: e.message || 'Network error' });
    }
  };

  const openViewPreview = async (i) => {
    const view = views[i];
    if (!view) return;
    // Strip drop_columns AND columns (renames) from the request so the preview returns
    // the ORIGINAL column names — drops and renames are applied client-side so the user
    // works against the raw schema and can change either freely.
    const viewForPreview = { ...view };
    delete viewForPreview.drop_columns;
    delete viewForPreview.columns;
    const initialRemoved = new Set(view.drop_columns || []);
    const initialRenames = new Map();
    for (const cs of view.columns || []) {
      if (cs?.name && cs?.rename && cs.rename !== cs.name) {
        initialRenames.set(cs.name, cs.rename);
      }
    }
    setViewPreview({ view, viewIndex: i, loading: true, removed: initialRemoved, renames: initialRenames });
    try {
      const resp = await fetch('/api/views/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view: viewForPreview }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setViewPreview({ view, viewIndex: i, error: data.detail || `Request failed (${resp.status})`, removed: initialRemoved, renames: initialRenames });
        return;
      }
      setViewPreview({ view, viewIndex: i, columns: data.columns || [], rows: data.data || [], n_rows: data.n_rows, removed: initialRemoved, renames: initialRenames });
    } catch (e) {
      setViewPreview({ view, viewIndex: i, error: e.message || 'Network error', removed: initialRemoved, renames: initialRenames });
    }
  };

  const toggleViewColumnDrop = (colName) => {
    setViewPreview(p => {
      if (!p) return p;
      const next = new Set(p.removed);
      if (next.has(colName)) next.delete(colName); else next.add(colName);
      return { ...p, removed: next };
    });
  };

  const setViewColumnRename = (origName, newName) => {
    setViewPreview(p => {
      if (!p) return p;
      const next = new Map(p.renames);
      const trimmed = (newName || '').trim();
      if (!trimmed || trimmed === origName) next.delete(origName);
      else next.set(origName, trimmed);
      return { ...p, renames: next };
    });
  };

  const applyViewPreviewChanges = () => {
    if (!viewPreview) return;
    const { view, viewIndex, removed, renames, columns: previewCols } = viewPreview;

    // Carry over existing type overrides keyed by original name so we don't lose them.
    const existingByName = (view.columns || []).reduce((acc, cs) => {
      if (cs?.name) acc[cs.name] = cs;
      return acc;
    }, {});

    // Build new columns: list — entries only for columns surviving drops, with a
    // rename or carried-over type override.
    const newColumns = [];
    const droppedSet = removed || new Set();
    for (const c of (previewCols || [])) {
      if (droppedSet.has(c.name)) continue;
      const newName = renames?.get(c.name);
      const existing = existingByName[c.name];
      const entry = { name: c.name };
      if (newName && newName !== c.name) entry.rename = newName;
      if (existing?.type) entry.type = existing.type;
      if (entry.rename || entry.type) newColumns.push(entry);
    }
    const drop = Array.from(droppedSet);

    const updated = { ...view };
    if (newColumns.length) updated.columns = newColumns; else delete updated.columns;
    if (drop.length) updated.drop_columns = drop; else delete updated.drop_columns;

    setViews(prev => prev.map((v, i) => i === viewIndex ? updated : v));
    setViewPreview(null);
    toast('Updated — click Save changes at the top to persist', 'ok');
  };

  // Download the FULL view table as CSV, reflecting the interactive drops/renames
  // applied in the preview. Hidden columns are excluded server-side.
  const downloadViewCsv = async () => {
    if (!viewPreview) return;
    const removed = viewPreview.removed || new Set();
    const renames = viewPreview.renames || new Map();
    const exportView = { ...viewPreview.view };
    delete exportView.drop_columns;
    delete exportView.columns;
    if (removed.size) exportView.drop_columns = [...removed];
    const cols = [];
    for (const [name, rename] of renames) cols.push({ name, rename });
    if (cols.length) exportView.columns = cols;
    try {
      const resp = await fetch('/api/views/export-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view: exportView }),
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        toast(e.detail || `CSV export failed (${resp.status})`, 'err');
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${viewPreview.view?.name || 'view'}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(String(e.message || e), 'err');
    }
  };

  const openSummaryPreview = async (i) => {
    const summary = summaries[i];
    if (!summary) return;
    setSummaryPreview({ summary, loading: true });
    try {
      const resp = await fetch('/api/summaries/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) setSummaryPreview({ summary, error: data.detail || `Request failed (${resp.status})` });
      else setSummaryPreview({ summary, text: data.text || '', n_rows: data.n_rows });
    } catch (e) {
      setSummaryPreview({ summary, error: e.message || 'Network error' });
    }
  };

  // Tables reuse the chart `table` renderer — preview through /api/charts/preview.
  const openTablePreview = async (i) => {
    const t = tables[i];
    if (!t) return;
    const chart = { ...t, type: 'table' };
    setPreview({ chart, loading: true });
    try {
      const resp = await fetch('/api/charts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chart }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) { setPreview({ chart, error: data.detail || `Request failed (${resp.status})` }); return; }
      setPreview({ chart, image: data.image });
    } catch (e) {
      setPreview({ chart, error: e.message || 'Network error' });
    }
  };

  const reload = useCallback(async () => {
    const c = await loadConfig();
    setCfg(c);
    setFilters(Array.isArray(c.filters) ? c.filters : []);
    setCharts(Array.isArray(c.charts) ? c.charts : []);
    setIndicators(Array.isArray(c.indicators) ? c.indicators : []);
    setTables(Array.isArray(c.tables) ? c.tables : []);
    setSummaries(Array.isArray(c.summaries) ? c.summaries : []);
    setViews(Array.isArray(c.views) ? c.views : []);
    setBaseline(JSON.stringify({
      filters: Array.isArray(c.filters) ? c.filters : [],
      charts: Array.isArray(c.charts) ? c.charts : [],
      indicators: Array.isArray(c.indicators) ? c.indicators : [],
      tables: Array.isArray(c.tables) ? c.tables : [],
      summaries: Array.isArray(c.summaries) ? c.summaries : [],
      views: Array.isArray(c.views) ? c.views : [],
    }));
    try {
      const [t, a] = await Promise.all([
        fetch('/api/templates').then(r => r.json()),
        fetch('/api/templates/active').then(r => r.json()),
      ]);
      setTemplates(t.files || []);
      setActiveTpl(a.active || '');
    } catch {}
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const saveAll = async () => {
    try {
      await saveConfigPatch(c => {
        const setOrDelete = (k, v) => {
          if (Array.isArray(v) && v.length === 0) delete c[k];
          else c[k] = v;
        };
        if (has('charts')) {
          setOrDelete('filters', filters.filter(f => f.trim()));
          setOrDelete('charts', charts);
        }
        if (has('indicators')) setOrDelete('indicators', indicators);
        if (has('tables')) setOrDelete('tables', tables);
        if (has('summaries')) setOrDelete('summaries', summaries);
        if (has('views')) setOrDelete('views', views);
      });
      setBaseline(snapshot);   // current edits are now the saved baseline → button reverts to outline
      toast('Saved ✓', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };

  const openEdit = (kind, index) => setEditing({ kind, index });
  const closeEdit = () => setEditing(null);
  const upsert = (setter) => (item, index) => {
    setter(prev => (index === null ? [...prev, item] : prev.map((it, i) => i === index ? item : it)));
    closeEdit();
  };
  const remove = (label, setter) => (i) => async () => {
    if (!await confirm({
      title: `Delete ${label}?`,
      message: `This ${label} will be removed from the report. This can’t be undone (until you save you can reload to restore).`,
    })) return;
    setter(prev => prev.filter((_, j) => j !== i));
  };

  // Dirty tracking: compare the editable sections against the last-saved snapshot
  // so the Save button reads solid only while there are unsaved edits.
  const snapshot = useMemo(
    () => JSON.stringify({ filters, charts, indicators, tables, summaries, views }),
    [filters, charts, indicators, tables, summaries, views]);
  const dirty = snapshot !== baseline;

  const questionCount = (cfg.questions || []).length;
  // Available column names (export labels) for autocomplete in the editors.
  const columnOptions = useMemo(() => {
    const seen = new Set(); const out = [];
    for (const q of (cfg.questions || [])) {
      const c = q.export_label || q.label || q.kobo_key;
      if (c && !seen.has(c)) { seen.add(c); out.push(c); }
    }
    return out;
  }, [cfg.questions]);

  return (
    <div className="page">
      <Header
        questionCount={questionCount}
        sections={secs}
        onSave={saveAll}
        dirty={dirty}
      />
      <RailLayout rail={
        <CompositionRail
          secs={secs}
          counts={{ charts: charts.length, indicators: indicators.length, tables: tables.length, summaries: summaries.length, views: views.length }}
          onSuggestKind={(k) => openSuggestModal(k)}
          suggesting={suggesting}
          showChartHelp={has('charts')}
        />
      }>
        <>
          {has('charts') && (
            <ChartsCard
              charts={charts}
              onAdd={() => openEdit('chart', null)}
              onEdit={(i) => openEdit('chart', i)}
              onRemove={remove('chart', setCharts)}
              onPreview={openChartPreview}
              toast={toast}
            />
          )}
          {has('indicators') && (
            <IndicatorsCard
              indicators={indicators}
              onAdd={() => openEdit('indicator', null)}
              onEdit={(i) => openEdit('indicator', i)}
              onRemove={remove('indicator', setIndicators)}
            />
          )}
          {has('tables') && (
            <TablesCard
              tables={tables}
              onAdd={() => openEdit('table', null)}
              onEdit={(i) => openEdit('table', i)}
              onRemove={remove('table', setTables)}
              onPreview={openTablePreview}
            />
          )}
          {has('summaries') && (
            <SummariesCard
              summaries={summaries}
              onAdd={() => openEdit('summary', null)}
              onEdit={(i) => openEdit('summary', i)}
              onRemove={remove('summary', setSummaries)}
              onPreview={openSummaryPreview}
            />
          )}
          {has('views') && (
            <ViewsCard
              views={views}
              onAdd={() => openEdit('view', null)}
              onEdit={(i) => openEdit('view', i)}
              onRemove={remove('view', setViews)}
              onPreview={openViewPreview}
            />
          )}
          {has('templates') && (
            <TemplatesCard
              templates={templates}
              active={activeTpl}
              onReload={reload}
              toast={toast}
            />
          )}
          {has('framework') && <FrameworkCard />}
        </>
      </RailLayout>

      {editing?.kind === 'chart' && (
        <ChartModal initial={editing.index !== null ? charts[editing.index] : null} columns={columnOptions} onClose={closeEdit} onSave={(item) => upsert(setCharts)(item, editing.index)} />
      )}
      {editing?.kind === 'indicator' && (
        <IndicatorModal initial={editing.index !== null ? indicators[editing.index] : null} columns={columnOptions} onClose={closeEdit} onSave={(item) => upsert(setIndicators)(item, editing.index)} />
      )}
      {editing?.kind === 'summary' && (
        <SummaryModal initial={editing.index !== null ? summaries[editing.index] : null} columns={columnOptions} onClose={closeEdit} onSave={(item) => upsert(setSummaries)(item, editing.index)} />
      )}
      {editing?.kind === 'view' && (
        <ViewModal initial={editing.index !== null ? views[editing.index] : null} onClose={closeEdit} onSave={(item) => upsert(setViews)(item, editing.index)} />
      )}
      {editing?.kind === 'table' && (
        <TableModal initial={editing.index !== null ? tables[editing.index] : null} columns={columnOptions} onClose={closeEdit} onSave={(item) => upsert(setTables)(item, editing.index)} />
      )}

      {suggestKind && (
        <Modal
          title={`Suggest ${suggestSpec[suggestKind].plural} with AI`}
          onClose={() => setSuggestKind(null)}
          onSave={submitSuggestion}
          saveLabel="Suggest"
          width={560}
        >
          <ModalField
            label={`What ${suggestSpec[suggestKind].plural} would you like? (optional)`}
            hint="Free-text guidance the AI will prioritise. Leave blank to let it choose freely from your questions."
          >
            <textarea
              aria-label={`Guidance for AI ${suggestSpec[suggestKind].plural} suggestions`}
              className="src-input"
              rows={5}
              value={suggestText}
              onChange={e => setSuggestText(e.target.value)}
              placeholder={suggestSpec[suggestKind].placeholder}
            />
          </ModalField>
        </Modal>
      )}

      {preview && (
        <Modal
          title={`Preview · ${preview.chart?.title || preview.chart?.name || 'chart'}`}
          onClose={() => setPreview(null)}
          width={760}
        >
          <div style={{ minHeight: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {preview.loading && (
              <div style={{ color: 'var(--ink-3)' }}>Rendering preview…</div>
            )}
            {preview.error && (
              <div style={{ color: 'var(--danger, #b91c1c)', whiteSpace: 'pre-wrap', textAlign: 'left', width: '100%' }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Couldn’t render this chart</div>
                <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 13 }}>{preview.error}</div>
                <div style={{ marginTop: 12, color: 'var(--ink-3)', fontSize: 12 }}>
                  Tip: previews need a downloaded data file in <code>data/processed/</code>. Run <code>Download</code> first if you haven’t.
                </div>
              </div>
            )}
            {preview.image && (
              <img
                src={`data:image/png;base64,${preview.image}`}
                alt={preview.chart?.name || 'chart preview'}
                style={{ maxWidth: '100%', height: 'auto', borderRadius: 4 }}
              />
            )}
          </div>
        </Modal>
      )}

      {viewPreview && (
        <Modal
          title={`Preview · ${viewPreview.view?.name || 'view'}`}
          onClose={() => setViewPreview(null)}
          onSave={viewPreview.columns ? applyViewPreviewChanges : null}
          saveLabel="Apply"
          width={920}
        >
          <div style={{ minHeight: 200 }}>
            {viewPreview.loading && (
              <div style={{ color: 'var(--ink-3)', textAlign: 'center', padding: 40 }}>Computing view…</div>
            )}
            {viewPreview.error && (
              <div style={{ color: 'var(--danger, #b91c1c)', whiteSpace: 'pre-wrap' }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Couldn’t compute this view</div>
                <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 13 }}>{viewPreview.error}</div>
                <div style={{ marginTop: 12, color: 'var(--ink-3)', fontSize: 12 }}>
                  Tip: previews need a downloaded data file in <code>data/processed/</code>. Run <code>Download</code> first if you haven’t.
                </div>
              </div>
            )}
            {viewPreview.columns && (() => {
              const removed = viewPreview.removed || new Set();
              const renames = viewPreview.renames || new Map();
              const visibleCols = viewPreview.columns.filter(c => !removed.has(c.name));
              const hiddenCols  = viewPreview.columns.filter(c =>  removed.has(c.name));
              const displayName = (c) => renames.get(c.name) || c.name;
              return (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <div style={{ color: 'var(--ink-3)', fontSize: 12, flex: 1 }}>
                      Showing {viewPreview.rows.length} of {viewPreview.n_rows?.toLocaleString() ?? viewPreview.rows.length} row{viewPreview.n_rows === 1 ? '' : 's'} · {visibleCols.length} of {viewPreview.columns.length} column{viewPreview.columns.length === 1 ? '' : 's'}
                      <span style={{ marginLeft: 10 }}>Click <strong>×</strong> to drop a column · click the name to rename it.</span>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={downloadViewCsv} title="Download the full view table as CSV">
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="3 9 8 14 13 9"/><line x1="8" y1="2" x2="8" y2="14"/></svg>
                      Download CSV
                    </button>
                  </div>
                  <div style={{ maxHeight: 460, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 4 }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5, fontFamily: 'var(--font-mono, monospace)' }}>
                      <thead>
                        <tr>
                          {visibleCols.map(c => (
                            <ColumnHeader
                              key={c.name}
                              column={c}
                              renamed={renames.get(c.name)}
                              onDrop={() => toggleViewColumnDrop(c.name)}
                              onRename={(newName) => setViewColumnRename(c.name, newName)}
                            />
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {viewPreview.rows.map((row, ri) => (
                          <tr key={ri} style={{ borderBottom: '1px solid var(--border)' }}>
                            {visibleCols.map(c => {
                              const v = row[c.name];
                              const display = v === null || v === undefined ? '' : String(v);
                              const isNum = c.detected_type === 'number';
                              return (
                                <td key={c.name} style={{ padding: '5px 10px', textAlign: isNum ? 'right' : 'left', whiteSpace: 'nowrap', color: display === '' ? 'var(--ink-3)' : 'inherit' }}>
                                  {display === '' ? '—' : display}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                        {viewPreview.rows.length === 0 && (
                          <tr><td colSpan={visibleCols.length || 1} style={{ padding: 20, textAlign: 'center', color: 'var(--ink-3)' }}>0 rows after filter/aggregation</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {hiddenCols.length > 0 && (
                    <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12, color: 'var(--ink-3)', marginRight: 4 }}>
                        Dropped ({hiddenCols.length}):
                      </span>
                      {hiddenCols.map(c => (
                        <button
                          key={c.name}
                          onClick={() => toggleViewColumnDrop(c.name)}
                          title="Restore column"
                          style={{ border: '1px solid var(--border)', background: 'var(--surface-2, #f7f7f7)', color: 'var(--ink-2)', borderRadius: 12, padding: '2px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-mono, monospace)' }}
                        >
                          + {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </Modal>
      )}

      {summaryPreview && (
        <Modal
          title={`Preview · ${summaryPreview.summary?.name || 'summary'}`}
          onClose={() => setSummaryPreview(null)}
          width={720}
        >
          <div style={{ minHeight: 160 }}>
            {summaryPreview.loading && <div style={{ color: 'var(--ink-3)', textAlign: 'center', padding: 30 }}>Computing summary…</div>}
            {summaryPreview.error && (
              <div style={{ color: 'var(--danger, #b91c1c)', whiteSpace: 'pre-wrap' }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Couldn't compute this summary</div>
                <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 13 }}>{summaryPreview.error}</div>
              </div>
            )}
            {summaryPreview.text !== undefined && !summaryPreview.loading && !summaryPreview.error && (
              <>
                {summaryPreview.n_rows !== undefined && (
                  <div style={{ color: 'var(--ink-3)', fontSize: 12, marginBottom: 8 }}>
                    From {summaryPreview.n_rows.toLocaleString()} row{summaryPreview.n_rows === 1 ? '' : 's'}
                  </div>
                )}
                <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                  {summaryPreview.text || <em style={{ color: 'var(--ink-3)' }}>No output returned.</em>}
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
      {confirmDialog}
    </div>
  );
}

// ── Right rail: Status · Quick actions · (chart reference when relevant) ──────
const SECTION_LABELS = { charts: 'charts', indicators: 'indicators', tables: 'tables', summaries: 'summaries', views: 'views' };

function CompositionRail({ secs, counts, onSuggestKind, suggesting, showChartHelp }) {
  const { aiReady } = useAiStatus();
  const enabled = Object.keys(SECTION_LABELS).filter(k => secs.includes(k));
  const checks = enabled.map(k => ({
    tone: counts[k] > 0 ? 'ok' : 'warn',
    label: `${counts[k]} ${SECTION_LABELS[k]}`,
    sub: counts[k] > 0 ? 'configured' : 'none yet — add one',
  }));
  const aiActions = enabled.map(k => ({
    icon: RailIcons.sparkle,
    label: `Suggest ${SECTION_LABELS[k]}`,
    onClick: () => onSuggestKind(k),
    disabled: !!suggesting || !aiReady,
    title: aiReady ? `Let AI propose ${SECTION_LABELS[k]} from your questions` : AI_LOCK_TIP,
  }));
  return (
    <>
      {checks.length > 0 && <StatusCard checks={checks} />}
      <QuickActionsCard actions={aiActions} />
      {suggesting && (
        <AiThinking card messages={[
          'Reading your questions…',
          'Analyzing distributions…',
          'Choosing the best options…',
          `Drafting ${SECTION_LABELS[suggesting] || 'suggestions'}…`,
        ]} />
      )}
      {showChartHelp && <TokenAnatomy />}
      {showChartHelp && <ChartLibrary />}
      {showChartHelp && <TipsCard />}
    </>
  );
}

// ── Header band ──────────────────────────────────────────────────────────────
function Header({ questionCount, sections = ALL_SECTIONS, onSave, dirty }) {
  const has = (k) => sections.includes(k);
  const viewsOnly = has('views') && !has('charts');
  return (
    <PageHeader
      eyebrow={viewsOnly ? 'Step 3 of 5 · Derived views' : 'Step 4 of 5 · Compose'}
      title={viewsOnly ? 'Build your' : 'Shape your'}
      accent={viewsOnly ? 'views.' : 'composition.'}
      sub={viewsOnly
        ? 'Virtual data tables — computed once and reused by charts, summaries, and indicators downstream.'
        : <>Define what shows up in the report — charts, indicators, and summaries. Add manually, or let AI propose a set from your <b>{questionCount}</b> questions.</>}
      actions={
        <button className={`btn ${dirty ? 'btn-primary' : ''}`} onClick={onSave} disabled={!dirty}
                title={dirty ? '' : 'No unsaved changes'}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 8 7 12 13 4"/></svg>
          Save changes
        </button>
      }
    />
  );
}

// ── Charts card ──────────────────────────────────────────────────────────────
function ChartsCard({ charts, onAdd, onEdit, onRemove, onPreview, toast }) {
  return (
    <div className="comp-card">
      <div className="comp-card__head">
        <div className="comp-card__head-text">
          <div className="comp-card__title">Charts</div>
          <div className="comp-card__sub">Each chart → <code>{'{{ chart_<name> }}'}</code> token in Word template</div>
        </div>
        <div className="comp-card__head-actions">
          <button className="btn btn-ghost btn-sm" onClick={onAdd}>+ Add chart</button>
        </div>
      </div>
      <div className="comp-card__body">
        {charts.length === 0 && <p className="empty-state" style={{ padding: 20 }}>No charts configured.</p>}
        {charts.map((ch, i) => (
          <div className="comp-row" key={`${ch.name}-${i}`}>
            <div className="comp-row__icon" data-tone={chartTone(ch.type)}>
              <ChartIcon type={ch.type} />
            </div>
            <div className="comp-row__body">
              <div className="comp-row__name">
                {ch.name || '(unnamed)'}
                {ch.ai && <span className="tag tag--warm">AI</span>}
              </div>
              <div className="comp-row__meta">
                <code>{ch.type}</code>
                <span className="comp-row__sep">·</span>
                <span>{(ch.questions || []).join(', ') || 'no columns'}</span>
              </div>
            </div>
            <div className="comp-row__actions">
              <button className="btn btn-ghost" onClick={() => onPreview(i)}>
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>
                Preview
              </button>
              <button className="icon-btn" title="Edit" onClick={() => onEdit(i)}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 11l8-8 3 3-8 8H2v-3z"/></svg>
              </button>
              <button className="icon-btn" title="Delete" onClick={onRemove(i)}>
                <svg viewBox="0 0 16 16" fill="currentColor"><circle cx="4" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12" cy="8" r="1.4"/></svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Framework card ───────────────────────────────────────────────────────────
function FrameworkCard() {
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [fw, setFw] = useState({ goal: null, outcomes: [], outputs: [] });
  const [editing, setEditing] = useState(null);  // null | { level, index, draft }

  const reload = async () => {
    try { setFw(await (await fetch('/api/framework')).json()); }
    catch { /* leave defaults */ }
  };

  useEffect(() => { reload(); }, []);

  const save = async (next) => {
    try {
      const r = await fetch('/api/framework', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (r.ok) { await reload(); toast('Framework saved', 'ok'); }
      else { toast('Save failed', 'err'); }
    } catch (e) { toast(e.message, 'err'); }
  };

  const startEdit = (level, index = null) => {
    let draft = { id: '', label: '', parent: '' };
    if (level === 'goal' && fw.goal) draft = { ...fw.goal };
    if (level === 'outcome' && index != null) draft = { ...fw.outcomes[index] };
    if (level === 'output'  && index != null) draft = { ...fw.outputs[index] };
    setEditing({ level, index, draft });
  };

  const commitEdit = () => {
    const { level, index, draft } = editing;
    if (!draft.id || !draft.label) { toast('id and label required', 'err'); return; }
    const next = { goal: fw.goal, outcomes: [...fw.outcomes], outputs: [...fw.outputs] };
    if (level === 'goal') next.goal = { id: draft.id, label: draft.label };
    else if (level === 'outcome') {
      const entry = { id: draft.id, label: draft.label, parent: draft.parent || fw.goal?.id || '' };
      if (index == null) next.outcomes.push(entry); else next.outcomes[index] = entry;
    }
    else if (level === 'output') {
      const entry = { id: draft.id, label: draft.label, parent: draft.parent };
      if (!entry.parent) { toast('output needs a parent outcome', 'err'); return; }
      if (index == null) next.outputs.push(entry); else next.outputs[index] = entry;
    }
    setEditing(null);
    save(next);
  };

  const remove = async (level, index) => {
    if (!await confirm({ title: 'Delete framework node?', message: 'This node will be removed from the results framework.' })) return;
    const next = { goal: fw.goal, outcomes: [...fw.outcomes], outputs: [...fw.outputs] };
    if (level === 'goal') {
      // Clear `parent` from outcomes that pointed to the deleted goal so the
      // config doesn't carry a dangling reference.
      const oldGoalId = fw.goal?.id;
      next.goal = null;
      if (oldGoalId) {
        next.outcomes = next.outcomes.map(oc =>
          oc.parent === oldGoalId ? { ...oc, parent: '' } : oc
        );
      }
    } else if (level === 'outcome') {
      // Cascade: also remove any outputs whose parent was this outcome.
      const removedId = fw.outcomes[index].id;
      next.outcomes.splice(index, 1);
      next.outputs = next.outputs.filter(op => op.parent !== removedId);
    } else if (level === 'output') {
      next.outputs.splice(index, 1);
    }
    save(next);
  };

  // Render tree depth-first
  const outputsByOutcome = {};
  for (const op of (fw.outputs || [])) (outputsByOutcome[op.parent] ||= []).push(op);

  return (
    <>
    <div className="comp-card">
      <div className="comp-card__head">
        <div className="comp-card__head-text">
          <div className="comp-card__title">Results framework</div>
          <div className="comp-card__sub">Goal → Outcomes → Outputs. Link indicators to nodes for logframe rendering.</div>
        </div>
        <div className="comp-card__head-actions">
          {!fw.goal && <button className="btn btn-ghost btn-sm" onClick={() => startEdit('goal')}>+ Goal</button>}
          <button className="btn btn-ghost btn-sm" onClick={() => startEdit('outcome')}>+ Outcome</button>
          <button className="btn btn-ghost btn-sm" onClick={() => startEdit('output')}>+ Output</button>
        </div>
      </div>
      <div className="comp-card__body">
        {!fw.goal && (fw.outcomes || []).length === 0 && (
          <p className="empty-state" style={{ padding: 20 }}>No framework configured.</p>
        )}
        <div className="framework-tree">
          {fw.goal && (
            <div className="framework-node" data-level="goal">
              <span className="framework-node__id">{fw.goal.id}</span>
              <span className="framework-node__level">goal</span>
              <span className="framework-node__label">{fw.goal.label}</span>
              <span>
                <button className="icon-btn" title="Edit" onClick={() => startEdit('goal')}>✎</button>
                <button className="icon-btn" title="Delete" onClick={() => remove('goal')}>×</button>
              </span>
            </div>
          )}
          {(fw.outcomes || []).map((oc, i) => (
            <Fragment key={oc.id}>
              <div className="framework-node" data-level="outcome">
                <span className="framework-node__id">{oc.id}</span>
                <span className="framework-node__level">outcome</span>
                <span className="framework-node__label">{oc.label}</span>
                <span>
                  <button className="icon-btn" title="Edit" onClick={() => startEdit('outcome', i)}>✎</button>
                  <button className="icon-btn" title="Delete" onClick={() => remove('outcome', i)}>×</button>
                </span>
              </div>
              {(outputsByOutcome[oc.id] || []).map((op) => {
                const opIdx = fw.outputs.findIndex(o => o.id === op.id);
                return (
                  <div key={op.id} className="framework-node" data-level="output">
                    <span className="framework-node__id">{op.id}</span>
                    <span className="framework-node__level">output</span>
                    <span className="framework-node__label">{op.label}</span>
                    <span>
                      <button className="icon-btn" title="Edit" onClick={() => startEdit('output', opIdx)}>✎</button>
                      <button className="icon-btn" title="Delete" onClick={() => remove('output', opIdx)}>×</button>
                    </span>
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      {editing && (
        <Modal
          title={`${editing.index == null ? 'Add' : 'Edit'} ${editing.level}`}
          onClose={() => setEditing(null)}
          onSave={commitEdit}
          saveLabel="Save"
          width={520}
        >
          <ModalField label="ID" hint="Short opaque identifier (e.g. OP1.1)">
            <input aria-label={`${editing.level} ID`} className="src-input" value={editing.draft.id}
                   onChange={e => setEditing(s => ({ ...s, draft: { ...s.draft, id: e.target.value } }))} />
          </ModalField>
          <ModalField label="Label">
            <input aria-label={`${editing.level} label`} className="src-input" value={editing.draft.label}
                   onChange={e => setEditing(s => ({ ...s, draft: { ...s.draft, label: e.target.value } }))} />
          </ModalField>
          {editing.level === 'output' && (
            <ModalField label="Parent outcome">
              <select aria-label="Parent outcome" className="src-input" value={editing.draft.parent || ''}
                      onChange={e => setEditing(s => ({ ...s, draft: { ...s.draft, parent: e.target.value } }))}>
                <option value="">(pick one)</option>
                {(fw.outcomes || []).map(oc => <option key={oc.id} value={oc.id}>{oc.id} — {oc.label}</option>)}
              </select>
            </ModalField>
          )}
        </Modal>
      )}
    </div>
    {confirmDialog}
    </>
  );
}

// ── Indicators card ──────────────────────────────────────────────────────────
function IndicatorsCard({ indicators, onAdd, onEdit, onRemove }) {
  const [latest, setLatest] = useState({}); // { [indicator.name]: { value, error } }

  useEffect(() => {
    let cancelled = false;
    async function loadOne(ind) {
      try {
        const r = await fetch('/api/indicators/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ indicator: ind }),
        });
        const data = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) {
          setLatest(prev => ({ ...prev, [ind.name]: { error: data.detail || 'error' } }));
        } else {
          // Endpoint returns { value, n_rows, trend, breakdown }; value may be string or number.
          setLatest(prev => ({ ...prev, [ind.name]: { value: data.value, trend: data.trend || [], breakdown: data.breakdown || [] } }));
        }
      } catch {
        if (!cancelled) setLatest(prev => ({ ...prev, [ind.name]: { error: 'network' } }));
      }
    }
    for (const ind of indicators) {
      if (ind?.name && !(ind.name in latest)) loadOne(ind);
    }
    return () => { cancelled = true; };
  }, [indicators]); // re-runs when indicator list changes

  return (
    <div className="comp-card">
      <div className="comp-card__head">
        <div className="comp-card__head-text">
          <div className="comp-card__title">Indicators</div>
          <div className="comp-card__sub">Text/number values → <code>{'{{ ind_<name> }}'}</code> placeholders in template</div>
        </div>
        <div className="comp-card__head-actions">
          <button className="btn btn-ghost btn-sm" onClick={onAdd}>+ Add indicator</button>
        </div>
      </div>
      <div className="comp-card__body">
        {indicators.length === 0 && <p className="empty-state" style={{ padding: 20 }}>No indicators configured.</p>}
        {indicators.length > 0 && (
          <div className="ind-table-head">
            <span />
            <span>Name</span>
            <span>Expression</span>
            <span>Format</span>
            <span>Latest</span>
            <span />
          </div>
        )}
        {indicators.map((ind, i) => (
          <div className="ind-row" key={`${ind.name}-${i}`}>
            <div className="comp-row__icon" data-tone="accent">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><polyline points="2 12 6 8 9 10 14 4"/></svg>
            </div>
            <div className="ind-row__name">{ind.name || '(unnamed)'}</div>
            <div className="ind-row__expr">
              {ind.stat || 'count'}({ind.question || '—'})
              {ind.label && <span style={{ color: 'var(--ink-3)', marginLeft: 6, fontFamily: 'var(--font-sans)' }}>· {ind.label}</span>}
            </div>
            <div className="ind-row__fmt">{ind.format || 'num'}</div>
            <div>
              <span className="value-tag" title={latest[ind.name]?.error ? `Error: ${latest[ind.name].error}` : ''}>
                {latest[ind.name]?.value ?? (latest[ind.name]?.error ? '—' : '…')}
              </span>
              {(latest[ind.name]?.trend?.length || 0) >= 2 && (
                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono, monospace)' }}>
                  {latest[ind.name].trend.map(t => `${t.label}: ${t.value}`).join(' → ')}
                </span>
              )}
              {(latest[ind.name]?.breakdown?.length || 0) > 0 && (
                <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono, monospace)' }}>
                  {latest[ind.name].breakdown.map(b => `${b.group}: ${b.formatted}`).join(' · ')}
                </div>
              )}
            </div>
            <div className="comp-row__actions">
              <button className="icon-btn" title="Edit" onClick={() => onEdit(i)}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 11l8-8 3 3-8 8H2v-3z"/></svg>
              </button>
              <button className="icon-btn" title="Delete" onClick={onRemove(i)}>
                <svg viewBox="0 0 16 16" fill="currentColor"><circle cx="4" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12" cy="8" r="1.4"/></svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tables card ──────────────────────────────────────────────────────────────
// Tables are chart-like recipes rendered with the `table` chart type →
// {{ table_<name> }} placeholders in the Word template.
function TablesCard({ tables, onAdd, onEdit, onRemove, onPreview }) {
  return (
    <div className="comp-card">
      <div className="comp-card__head">
        <div className="comp-card__head-text">
          <div className="comp-card__title">Tables</div>
          <div className="comp-card__sub">Tabular breakdowns → <code>{'{{ table_<name> }}'}</code> token in Word template</div>
        </div>
        <div className="comp-card__head-actions">
          <button className="btn btn-ghost btn-sm" onClick={onAdd}>+ Add table</button>
        </div>
      </div>
      <div className="comp-card__body">
        {tables.length === 0 && <p className="empty-state" style={{ padding: 20 }}>No tables configured.</p>}
        {tables.map((t, i) => (
          <div className="comp-row" key={`${t.name}-${i}`}>
            <div className="comp-row__icon" data-tone="green">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2.5" y="3" width="11" height="10" rx="1.5"/><line x1="2.5" y1="6.5" x2="13.5" y2="6.5"/><line x1="6" y1="3" x2="6" y2="13"/></svg>
            </div>
            <div className="comp-row__body">
              <div className="comp-row__name">
                {t.name || '(unnamed)'}
                {t.ai && <span className="tag tag--warm">AI</span>}
              </div>
              <div className="comp-row__meta">
                <span>{(t.questions || []).join(', ') || 'no columns'}</span>
              </div>
            </div>
            <div className="comp-row__actions">
              <button className="btn btn-ghost" onClick={() => onPreview(i)}>
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>
                Preview
              </button>
              <button className="icon-btn" title="Edit" onClick={() => onEdit(i)}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 11l8-8 3 3-8 8H2v-3z"/></svg>
              </button>
              <button className="icon-btn" title="Delete" onClick={onRemove(i)}>
                <svg viewBox="0 0 16 16" fill="currentColor"><circle cx="4" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12" cy="8" r="1.4"/></svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Summaries card ───────────────────────────────────────────────────────────
function SummariesCard({ summaries, onAdd, onEdit, onRemove, onPreview }) {
  return (
    <div className="comp-card">
      <div className="comp-card__head">
        <div className="comp-card__head-text">
          <div className="comp-card__title">Summaries</div>
          <div className="comp-card__sub">Text paragraphs → <code>{'{{ summary_<name> }}'}</code> placeholders. Composed by the AI narrative.</div>
        </div>
        <div className="comp-card__head-actions">
          <button className="btn btn-ghost btn-sm" onClick={onAdd}>+ Add summary</button>
        </div>
      </div>
      <div className="comp-card__body">
        {summaries.length === 0 && <p className="empty-state" style={{ padding: 20 }}>No summaries configured.</p>}
        {summaries.map((s, i) => (
          <div className="sum-row" key={`${s.name}-${i}`}>
            <div className="comp-row__icon" data-tone="violet">
              <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 3h10v1H3zm0 3h10v1H3zm0 3h7v1H3zm0 3h10v1H3z"/></svg>
            </div>
            <div className="comp-row__body">
              <div className="comp-row__name">
                {s.name || '(unnamed)'}
                {s.stat === 'ai' && <span className="tag tag--warm">AI</span>}
              </div>
              <div className="sum-row__body">
                {s.prompt || `${s.stat || 'distribution'} of ${csv(s.questions) || '—'}${s.label ? ` · ${s.label}` : ''}`}
              </div>
              <span className="sum-row__tokens">~ {Math.round(((s.prompt || '').length || 200) * 0.4 + 80)} tokens</span>
            </div>
            <div className="comp-row__actions">
              <button className="btn btn-ghost" onClick={() => onPreview(i)}>
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>
                Preview
              </button>
              <button className="icon-btn" title="Edit" onClick={() => onEdit(i)}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 11l8-8 3 3-8 8H2v-3z"/></svg>
              </button>
              <button className="icon-btn" title="Delete" onClick={onRemove(i)}>
                <svg viewBox="0 0 16 16" fill="currentColor"><circle cx="4" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12" cy="8" r="1.4"/></svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Views card ───────────────────────────────────────────────────────────────
function ViewsCard({ views, onAdd, onEdit, onRemove, onPreview }) {
  const [dims, setDims] = useState({}); // { [view.name]: { rows, cols, error } }

  useEffect(() => {
    let cancelled = false;
    async function loadOne(v) {
      try {
        const r = await fetch('/api/views/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ view: v }),
        });
        const data = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) {
          setDims(prev => ({ ...prev, [v.name]: { error: data.detail || 'error' } }));
        } else {
          setDims(prev => ({ ...prev, [v.name]: { rows: data.n_rows, cols: (data.columns || []).length } }));
        }
      } catch {
        if (!cancelled) setDims(prev => ({ ...prev, [v.name]: { error: 'network' } }));
      }
    }
    for (const v of views) {
      if (v?.name && !(v.name in dims)) loadOne(v);
    }
    return () => { cancelled = true; };
  }, [views]);

  return (
    <div className="comp-card">
      <div className="comp-card__head">
        <div className="comp-card__head-text">
          <div className="comp-card__title">Views</div>
          <div className="comp-card__sub">Virtual data tables — computed once, reused by charts, summaries, and indicators.</div>
        </div>
        <div className="comp-card__head-actions">
          <button className="btn btn-ghost btn-sm" onClick={onAdd}>+ Add view</button>
        </div>
      </div>
      <div className="comp-card__body">
        {views.length === 0 && <p className="empty-state" style={{ padding: 20 }}>No views configured.</p>}
        {views.map((v, i) => {
          // Build a tiny expression string for the screenshot-style summary.
          const expr = v.group_by
            ? `aggregate(${v.question || '*'}, by=${v.group_by})`
            : v.join_parent
              ? `join(${v.source}, ${csv(v.join_parent)})`
              : v.filter
                ? `${v.source} where ${v.filter}`
                : v.source || '—';
          return (
            <div className="view-row" key={`${v.name}-${i}`}>
              <div className="comp-row__icon" data-tone="green">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2.5" y="3" width="11" height="10" rx="1.5"/><line x1="2.5" y1="6.5" x2="13.5" y2="6.5"/><line x1="6" y1="3" x2="6" y2="13"/></svg>
              </div>
              <div className="comp-row__name">{v.name || '(unnamed)'}</div>
              <div className="ind-row__expr">{expr}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.45 }}>
                {v.filter || '—'}
              </div>
              <div className="view-row__dims">
                {(() => {
                  const d = dims[v.name];
                  if (!d) return '…';
                  if (d.error) return '—';
                  return `${d.rows?.toLocaleString() ?? '?'} rows · ${d.cols ?? '?'} cols`;
                })()}
                <div className="comp-row__actions" style={{ marginTop: 6, justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => onPreview(i)}>
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>
                    Preview
                  </button>
                  <button className="icon-btn" title="Edit" onClick={() => onEdit(i)}>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 11l8-8 3 3-8 8H2v-3z"/></svg>
                  </button>
                  <button className="icon-btn" title="Delete" onClick={onRemove(i)}>
                    <svg viewBox="0 0 16 16" fill="currentColor"><circle cx="4" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12" cy="8" r="1.4"/></svg>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Templates card ───────────────────────────────────────────────────────────
function TemplatesCard({ templates, active, onReload, toast }) {
  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch('/api/templates/upload', { method: 'POST', body: fd });
    toast(res.ok ? `Uploaded ${file.name}` : 'Upload failed', res.ok ? 'ok' : 'err');
    e.target.value = '';
    onReload();
  };
  const setActive = async (name) => {
    const res = await fetch(`/api/templates/set-active/${encodeURIComponent(name)}`, { method: 'POST' });
    toast(res.ok ? `Active: ${name}` : 'Failed', res.ok ? 'ok' : 'err');
    onReload();
  };

  return (
    <div className="comp-card">
      <div className="comp-card__head">
        <div className="comp-card__head-text">
          <div className="comp-card__title">Templates</div>
          <div className="comp-card__sub">The Word version that holds the composition. Drop tokens anywhere you'd just type text.</div>
        </div>
        <div className="comp-card__head-actions">
          {active && (
            <a href={`/api/templates/download/${encodeURIComponent(active)}`} download>
              <button className="btn btn-ghost btn-sm">↓ Download current</button>
            </a>
          )}
          <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer' }}>
            ↑ Upload new version
            <input type="file" accept=".docx" style={{ display: 'none' }} onChange={upload} />
          </label>
        </div>
      </div>
      <div className="comp-card__body">
        {templates.length === 0 && <p className="empty-state" style={{ padding: 20 }}>No templates yet — run <b>generate-template</b> from the Dashboard or upload a <code>.docx</code>.</p>}
        {templates.map((t) => (
          <div className="tpl-row" key={t.name}>
            <div className="comp-row__icon" data-tone="accent">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 2h7l3 3v9H3z"/><polyline points="10 2 10 5 13 5"/></svg>
            </div>
            <div>
              <div className="tpl-row__name">
                {t.name}
                {t.name === active && <span className="tag tag--green">current</span>}
                {t.name !== active && <span className="tag" style={{ background: 'var(--bg-2)', color: 'var(--ink-3)' }}>archive</span>}
              </div>
              <div className="tpl-row__meta">{t.modified}</div>
            </div>
            <div><span className="tpl-row__sample">{'{{chart_resp_rate}}'}</span></div>
            <div className="tpl-row__size">{t.size_kb} KB</div>
            <div className="comp-row__actions">
              {t.name !== active && (
                <button className="icon-btn" title="Set active" onClick={() => setActive(t.name)}>
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 8 7 12 13 4"/></svg>
                </button>
              )}
              <a className="icon-btn" href={`/api/templates/download/${encodeURIComponent(t.name)}`} download title="Download">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="3 9 8 14 13 9"/><line x1="8" y1="2" x2="8" y2="14"/></svg>
              </a>
              <button className="icon-btn" title="More">
                <svg viewBox="0 0 16 16" fill="currentColor"><circle cx="4" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12" cy="8" r="1.4"/></svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Right rail: Token anatomy ────────────────────────────────────────────────
function TokenAnatomy() {
  return (
    <div className="token-card">
      <div>
        <div className="token-card__title">Token anatomy</div>
        <div className="token-card__sub">Drop any of these tokens into the Word template — Databridge fills them in step 4.</div>
      </div>
      <div className="token-card__row"><span className="label">Chart</span><span className="ph">{'{{ chart_<name> }}'}</span></div>
      <div className="token-card__row"><span className="label">Indicator</span><span className="ph">{'{{ ind_<name> }}'}</span></div>
      <div className="token-card__row"><span className="label">Summary</span><span className="ph">{'{{ summary_<name> }}'}</span></div>
      <div className="token-card__row"><span className="label">Split</span><span className="ph">{'{{ split_value }}'}</span></div>
    </div>
  );
}

// ── Right rail: Chart library ────────────────────────────────────────────────
function ChartLibrary() {
  const col = (type) => chartTone(type);
  return (
    <div className="lib-card">
      <div className="lib-card__head">
        <h4>Chart library</h4>
        <span>{CHART_TYPES.length} types</span>
      </div>
      <div className="lib-card__grid">
        {CHART_TYPES.map(t => (
          <div className="lib-card__item" key={t}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: `var(--${col(t)})`, opacity: .8, flexShrink: 0 }} />
            {t.replace(/_/g, ' ')}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Right rail: Tips ────────────────────────────────────────────────────────
function TipsCard() {
  return (
    <div className="tips-card-sm">
      <div className="tips-card-sm__title">Tips</div>
      <div className="tips-card-sm__body">
        Rename questions in the <b>Questions</b> step before you start composing — labels flow through to every chart, indicator, and summary automatically.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modals (chart / indicator / summary / view) — same shape as the previous
// Composition page; condensed here.
// ─────────────────────────────────────────────────────────────────────────────
function ChartModal({ initial, columns = [], onClose, onSave }) {
  const [name, setName]       = useState(initial?.name || '');
  const [title, setTitle]     = useState(initial?.title || '');
  const [type, setType]       = useState(initial?.type || 'bar');
  const [cols, setCols]       = useState(csv(initial?.questions || []));
  const [optsY, setOptsY]     = useState(initial?.options ? yaml.dump(initial.options, { indent: 2, lineWidth: -1 }) : '');
  const [err, setErr]         = useState('');
  const fe = useFieldErrors();

  const submit = () => {
    if (!name.trim()) return fe.setError('name', 'Name is required.');
    const item = { name: name.trim(), title: title.trim(), type, questions: fromCsv(cols) };
    if (optsY.trim()) {
      try { const o = yaml.load(optsY); if (o && Object.keys(o).length) item.options = o; }
      catch (e) { return setErr('Options YAML invalid: ' + e.message); }
    }
    onSave(item);
  };
  return (
    <Modal title={initial ? `Edit chart: ${initial.name}` : 'Add chart'} onClose={onClose} onSave={submit} width={560}>
      <ModalError>{err}</ModalError>
      <ModalField label="Name" error={fe.errorFor('name')} errorId={fe.errorId('name')}><input className="src-input" value={name} {...fe.fieldProps('name')} onChange={e => { setName(e.target.value); if (e.target.value.trim()) fe.clearError('name'); }} placeholder="satisfaction_overview" /></ModalField>
      <ModalField label="Title"><input className="src-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Overall satisfaction" /></ModalField>
      <ModalField label="Name"><input aria-label="Chart name" className="src-input" value={name} onChange={e => setName(e.target.value)} placeholder="satisfaction_overview" /></ModalField>
      <ModalField label="Title"><input aria-label="Chart title" className="src-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Overall satisfaction" /></ModalField>
      <ModalField label="Type" hint={CHART_REQS[type] ? `Needs: ${CHART_REQS[type]}` : undefined}>
        <select aria-label="Chart type" className="src-input" value={type} onChange={e => setType(e.target.value)}>{CHART_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
      </ModalField>
      <ModalField label="Columns" hint="Pick from your questions — type to search; press Enter to add a custom name">
        <ColumnPicker ariaLabel="Chart columns" value={cols} onChange={setCols} options={columns} placeholder="Search columns…" />
      </ModalField>
      <ModalField label="Options" hint="YAML, optional (e.g. top_n: 10)">
        <textarea aria-label="Chart options (YAML)" value={optsY} onChange={e => setOptsY(e.target.value)} rows={5} className="src-input" style={{ height: 'auto', padding: 10, fontFamily: 'var(--font-mono)', fontSize: 12.5 }} placeholder="top_n: 10" />
      </ModalField>
    </Modal>
  );
}

function IndicatorModal({ initial, columns = [], onClose, onSave }) {
  const [name, setName]         = useState(initial?.name || '');
  const [label, setLabel]       = useState(initial?.label || '');
  const [stat, setStat]         = useState(initial?.stat || 'count');
  const [question, setQuestion] = useState(initial?.question || '');
  const [format, setFormat]     = useState(initial?.format || '');
  const [compareTo, setCompareTo] = useState(initial?.compare_to || '');
  const [frameworkRef, setFrameworkRef] = useState(initial?.framework_ref || '');
  const [disagg, setDisagg] = useState(csv(
    Array.isArray(initial?.disaggregate_by) ? initial.disaggregate_by
      : (initial?.disaggregate_by ? [initial.disaggregate_by] : [])));
  const [primary, setPrimary] = useState(!!initial?.primary);
  const [err, setErr] = useState('');
  const fe = useFieldErrors();
  const submit = () => {
    if (!name.trim()) return fe.setError('name', 'Name is required.');
    const item = { name: name.trim(), stat };
    if (label.trim()) item.label = label.trim();
    if (question.trim()) item.question = question.trim();
    if (format.trim()) item.format = format.trim();
    if (compareTo) item.compare_to = compareTo;
    if (frameworkRef) item.framework_ref = frameworkRef;
    const dis = fromCsv(disagg); if (dis.length) item.disaggregate_by = dis;
    if (primary) item.primary = true;
    onSave(item);
  };
  return (
    <Modal title={initial ? `Edit indicator: ${initial.name}` : 'Add indicator'} onClose={onClose} onSave={submit}>
      <ModalError>{err}</ModalError>
      <ModalField label="Name" hint="Becomes {{ ind_<name> }} in the template" error={fe.errorFor('name')} errorId={fe.errorId('name')}><input className="src-input" value={name} {...fe.fieldProps('name')} onChange={e => { setName(e.target.value); if (e.target.value.trim()) fe.clearError('name'); }} placeholder="total_beneficiaries" /></ModalField>
      <ModalField label="Label"><input className="src-input" value={label} onChange={e => setLabel(e.target.value)} /></ModalField>
      <ModalField label="Stat"><select className="src-input" value={stat} onChange={e => setStat(e.target.value)}>{INDICATOR_STATS.map(s => <option key={s} value={s}>{s}</option>)}</select></ModalField>
      <ModalField label="Column"><ColumnPicker value={question} onChange={setQuestion} options={columns} multi={false} placeholder="Number of Students" /></ModalField>
      <ModalField label="Format" hint="Python format string"><input className="src-input" value={format} onChange={e => setFormat(e.target.value)} placeholder="{:,.0f}" /></ModalField>
      <ModalField label="Name" hint="Becomes {{ ind_<name> }} in the template"><input aria-label="Indicator name" className="src-input" value={name} onChange={e => setName(e.target.value)} placeholder="total_beneficiaries" /></ModalField>
      <ModalField label="Label"><input aria-label="Indicator label" className="src-input" value={label} onChange={e => setLabel(e.target.value)} /></ModalField>
      <ModalField label="Stat"><select aria-label="Indicator stat" className="src-input" value={stat} onChange={e => setStat(e.target.value)}>{INDICATOR_STATS.map(s => <option key={s} value={s}>{s}</option>)}</select></ModalField>
      <ModalField label="Column"><ColumnPicker ariaLabel="Indicator column" value={question} onChange={setQuestion} options={columns} multi={false} placeholder="Number of Students" /></ModalField>
      <ModalField label="Format" hint="Python format string"><input aria-label="Indicator format" className="src-input" value={format} onChange={e => setFormat(e.target.value)} placeholder="{:,.0f}" /></ModalField>
      <ModalField label="Compare to" hint="Optional. Set 'baseline' to compute delta + percent change from the baseline period.">
        <select aria-label="Indicator compare to" className="src-input" value={compareTo} onChange={e => setCompareTo(e.target.value)}>
          <option value="">(no comparison)</option>
          <option value="baseline">Baseline</option>
        </select>
      </ModalField>
      <ModalField label="Framework link" hint="Optional. Pick a goal/outcome/output node to link this indicator to.">
        <FrameworkPicker value={frameworkRef} onChange={v => setFrameworkRef(v || '')} />
      </ModalField>
      <ModalField label="Disaggregate by" hint="Optional. Computes the stat per group; adds {{ ind_<name>_breakdown }} + {{ ind_<name>_table }}.">
        <ColumnPicker ariaLabel="Disaggregate by" value={disagg} onChange={setDisagg} options={columns} placeholder="Region, Sex" />
      </ModalField>
      <ModalField label="Primary" hint="Optional. Marks this as the framework node's headline indicator — drives the node's achievement % in the logframe.">
        <label className="run-opt" style={{ paddingTop: 6 }}>
          <input type="checkbox" checked={primary} onChange={e => setPrimary(e.target.checked)} />
          Primary indicator for its framework node
        </label>
      </ModalField>
    </Modal>
  );
}

function SummaryModal({ initial, columns = [], onClose, onSave }) {
  const [name, setName]     = useState(initial?.name || '');
  const [label, setLabel]   = useState(initial?.label || '');
  const [stat, setStat]     = useState(initial?.stat || 'distribution');
  const [cols, setCols]     = useState(csv(initial?.questions || []));
  const [prompt, setPrompt] = useState(initial?.prompt || '');
  const [freq, setFreq]     = useState(initial?.freq || '');
  const [topN, setTopN]     = useState(initial?.top_n ?? '');
  const [err, setErr]       = useState('');
  const fe = useFieldErrors();
  const submit = () => {
    if (!name.trim()) return fe.setError('name', 'Name is required.');
    const item = { name: name.trim(), stat };
    if (label.trim()) item.label = label.trim();
    const qs = fromCsv(cols); if (qs.length) item.questions = qs;
    if (stat === 'trend' && freq) item.freq = freq;
    if (['distribution', 'crosstab'].includes(stat) && topN !== '') { const n = parseInt(topN, 10); if (!isNaN(n)) item.top_n = n; }
    if (stat === 'ai' && prompt.trim()) item.prompt = prompt.trim();
    onSave(item);
  };
  return (
    <Modal title={initial ? `Edit summary: ${initial.name}` : 'Add summary'} onClose={onClose} onSave={submit} width={560}>
      <ModalError>{err}</ModalError>
      <ModalField label="Name" error={fe.errorFor('name')} errorId={fe.errorId('name')}><input className="src-input" value={name} {...fe.fieldProps('name')} onChange={e => { setName(e.target.value); if (e.target.value.trim()) fe.clearError('name'); }} /></ModalField>
      <ModalField label="Label"><input className="src-input" value={label} onChange={e => setLabel(e.target.value)} /></ModalField>
      <ModalField label="Stat"><select className="src-input" value={stat} onChange={e => setStat(e.target.value)}>{SUMMARY_STATS.map(s => <option key={s} value={s}>{s}</option>)}</select></ModalField>
      <ModalField label="Columns"><ColumnPicker value={cols} onChange={setCols} options={columns} /></ModalField>
      {(stat === 'distribution' || stat === 'crosstab') && <ModalField label="Top N"><input className="src-input" type="number" value={topN} onChange={e => setTopN(e.target.value)} /></ModalField>}
      <ModalField label="Name"><input aria-label="Summary name" className="src-input" value={name} onChange={e => setName(e.target.value)} /></ModalField>
      <ModalField label="Label"><input aria-label="Summary label" className="src-input" value={label} onChange={e => setLabel(e.target.value)} /></ModalField>
      <ModalField label="Stat"><select aria-label="Summary stat" className="src-input" value={stat} onChange={e => setStat(e.target.value)}>{SUMMARY_STATS.map(s => <option key={s} value={s}>{s}</option>)}</select></ModalField>
      <ModalField label="Columns"><ColumnPicker ariaLabel="Summary columns" value={cols} onChange={setCols} options={columns} /></ModalField>
      {(stat === 'distribution' || stat === 'crosstab') && <ModalField label="Top N"><input aria-label="Summary top N" className="src-input" type="number" value={topN} onChange={e => setTopN(e.target.value)} /></ModalField>}
      {stat === 'trend' && (
        <ModalField label="Frequency"><select aria-label="Summary frequency" className="src-input" value={freq} onChange={e => setFreq(e.target.value)}>{['', 'day', 'week', 'month', 'year'].map(f => <option key={f} value={f}>{f || '—'}</option>)}</select></ModalField>
      )}
      {stat === 'ai' && <ModalField label="Prompt"><textarea aria-label="Summary prompt" value={prompt} onChange={e => setPrompt(e.target.value)} rows={4} className="src-input" style={{ height: 'auto', padding: 10 }} /></ModalField>}
    </Modal>
  );
}

// Tables are chart recipes of type `table`. Minimal editor: name, title, columns.
function TableModal({ initial, columns = [], onClose, onSave }) {
  const [name, setName]   = useState(initial?.name || '');
  const [title, setTitle] = useState(initial?.title || '');
  const [cols, setCols]   = useState(csv(initial?.questions || []));
  const [err, setErr]     = useState('');
  const fe = useFieldErrors();
  const submit = () => {
    if (!name.trim()) return fe.setError('name', 'Name is required.');
    const item = { name: name.trim(), title: title.trim(), type: 'table', questions: fromCsv(cols) };
    if (initial?.options) item.options = initial.options;
    if (initial?.source) item.source = initial.source;
    if (initial?.join_parent) item.join_parent = initial.join_parent;
    if (initial?.filter) item.filter = initial.filter;
    onSave(item);
  };
  return (
    <Modal title={initial ? `Edit table: ${initial.name}` : 'Add table'} onClose={onClose} onSave={submit} width={560}>
      <ModalError>{err}</ModalError>
      <ModalField label="Name" hint="Used as {{ table_<name> }} in the template" error={fe.errorFor('name')} errorId={fe.errorId('name')}><input className="src-input" value={name} {...fe.fieldProps('name')} onChange={e => { setName(e.target.value); if (e.target.value.trim()) fe.clearError('name'); }} /></ModalField>
      <ModalField label="Title"><input className="src-input" value={title} onChange={e => setTitle(e.target.value)} /></ModalField>
      <ModalField label="Columns" hint="Pick from your questions — type to search; press Enter to add a custom name."><ColumnPicker value={cols} onChange={setCols} options={columns} /></ModalField>
      <ModalField label="Name" hint="Used as {{ table_<name> }} in the template"><input aria-label="Table name" className="src-input" value={name} onChange={e => setName(e.target.value)} /></ModalField>
      <ModalField label="Title"><input aria-label="Table title" className="src-input" value={title} onChange={e => setTitle(e.target.value)} /></ModalField>
      <ModalField label="Columns" hint="Pick from your questions — type to search; press Enter to add a custom name."><ColumnPicker ariaLabel="Table columns" value={cols} onChange={setCols} options={columns} /></ModalField>
    </Modal>
  );
}

function ViewModal({ initial, onClose, onSave }) {
  const { aiReady } = useAiStatus();
  const [name, setName]               = useState(initial?.name || '');
  const [source, setSource]           = useState(initial?.source || 'main');
  const [joinParent, setJoinParent]   = useState(csv(initial?.join_parent || []));
  const [columns, setColumns]         = useState(csv(initial?.keep_columns || []));
  const [filter, setFilter]           = useState(initial?.filter || '');
  const [aggregate, setAggregate]     = useState(!!initial?.group_by);
  const [groupBy, setGroupBy]         = useState(initial?.group_by || '');
  const [question, setQuestion]       = useState(initial?.question || '');
  const [agg, setAgg]                 = useState(initial?.agg || 'sum');
  const [err, setErr]                 = useState('');
  const fe = useFieldErrors();

  // Table catalog from the latest download → powers the source/column dropdowns.
  const [tables, setTables] = useState([]);
  useEffect(() => {
    let alive = true;
    fetch('/api/base-tables').then(r => r.json())
      .then(d => { if (alive && Array.isArray(d.tables)) setTables(d.tables); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const byName = Object.fromEntries(tables.map(t => [t.name, t]));
  const tableNames = tables.map(t => t.name);
  const sourceCols = byName[source]?.columns || [];
  const parentName = byName[source]?.parent;
  const parentCols = (parentName && byName[parentName]?.columns) || [];

  // Describe-box: plain language → AI → prefill the fields below.
  const [describeText, setDescribeText] = useState('');
  const [describing, setDescribing]     = useState(false);
  const build = async () => {
    const d = describeText.trim();
    if (!d) return;
    setDescribing(true); setErr('');
    try {
      const r = await fetch('/api/views/describe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: d }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(data.detail || `Request failed (${r.status})`);
        window.dispatchEvent(new CustomEvent('databridge:ai-recheck'));
        return;
      }
      const v = (data.views || [])[0];
      if (!v) { setErr('AI did not return a view — try rephrasing.'); return; }
      if (v.name) setName(v.name);
      if (v.source) setSource(v.source);
      setJoinParent(csv(v.join_parent || []));
      setColumns(csv(v.keep_columns || []));
      setFilter(v.filter || '');
      if (v.group_by) { setAggregate(true); setGroupBy(v.group_by); setQuestion(v.question || ''); setAgg(v.agg || 'sum'); }
      else { setAggregate(false); setGroupBy(''); setQuestion(''); }
    } catch (e) {
      setErr(e.message || 'Network error');
      window.dispatchEvent(new CustomEvent('databridge:ai-recheck'));
    } finally { setDescribing(false); }
  };

  const filterErr = validateFilterExpr(filter);
  const submit = () => {
    fe.clearAll();
    if (!name.trim()) { fe.setError('name', 'Name is required.'); return; }
    if (!source.trim()) { fe.setError('source', 'Source is required.'); return; }
    if (filterErr) { fe.setError('filter', filterErr); return; }
    const item = { name: name.trim(), source: source.trim() };
    const jp = fromCsv(joinParent); if (jp.length) item.join_parent = jp;
    if (filter.trim()) item.filter = filter.trim();
    const keep = fromCsv(columns); if (keep.length) item.keep_columns = keep;
    // Preserve preview-set drop/rename specs (managed in the view preview, not here).
    if (initial?.drop_columns?.length) item.drop_columns = initial.drop_columns;
    if (Array.isArray(initial?.columns) && initial.columns.length) item.columns = initial.columns;
    if (aggregate && groupBy.trim()) {
      item.group_by = groupBy.trim();
      if (question.trim()) { item.question = question.trim(); if (agg) item.agg = agg; }
    }
    onSave(item);
  };

  return (
    <Modal title={initial ? `Edit view: ${initial.name}` : 'Add view'} onClose={onClose} onSave={submit} width={580}>
      <ModalError>{err}</ModalError>

      <div style={{ padding: '2px 0 12px', borderBottom: '1px dashed var(--border)', marginBottom: 4 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>
          ✨ Describe the view <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>— let AI fill the form below</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input aria-label="Describe the view" className="src-input" style={{ flex: 1 }} value={describeText}
                 onChange={e => setDescribeText(e.target.value)}
                 onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (aiReady && !describing && describeText.trim()) build(); } }}
                 disabled={!aiReady || describing}
                 placeholder={aiReady ? 'e.g. total students per department, only villages with students' : AI_LOCK_TIP} />
          <button className="btn btn-primary btn-sm" onClick={build}
                  disabled={!aiReady || describing || !describeText.trim()}
                  title={aiReady ? '' : AI_LOCK_TIP} style={{ whiteSpace: 'nowrap' }}>Build</button>
        </div>
        {describing && <div style={{ marginTop: 8 }}><AiThinking messages={['Reading your description…', 'Matching tables & columns…', 'Composing the view…']} /></div>}
      </div>

      <ModalField label="Name" error={fe.errorFor('name')} errorId={fe.errorId('name')}><input className="src-input" value={name} {...fe.fieldProps('name')} onChange={e => { setName(e.target.value); if (e.target.value.trim()) fe.clearError('name'); }} placeholder="villages_with_dept" /></ModalField>
      <ModalField label="Source table" hint="Which base table this view draws from" error={fe.errorFor('source')} errorId={fe.errorId('source')}>
        <ColumnPicker value={source} onChange={(v) => { setSource(v); if ((v || '').trim()) fe.clearError('source'); }} options={tableNames} multi={false} placeholder="main, or a repeat table…" />
      <ModalField label="Name"><input aria-label="View name" className="src-input" value={name} onChange={e => setName(e.target.value)} placeholder="villages_with_dept" /></ModalField>
      <ModalField label="Source table" hint="Which base table this view draws from">
        <ColumnPicker ariaLabel="View source table" value={source} onChange={setSource} options={tableNames} multi={false} placeholder="main, or a repeat table…" />
      </ModalField>
      {parentName && (
        <ModalField label="Join from parent" hint={`Columns to bring down from "${parentName}"`}>
          <ColumnPicker ariaLabel="Join from parent" value={joinParent} onChange={setJoinParent} options={parentCols} placeholder="Search parent columns…" />
        </ModalField>
      )}
      <ModalField label="Columns" hint="Which columns to keep — leave blank for all">
        <ColumnPicker ariaLabel="View columns" value={columns} onChange={setColumns} options={sourceCols} placeholder="Search columns…" />
      </ModalField>
      <ModalField label="Filter" hint="pandas query syntax, e.g. Age > 18 and Region == 'North'"
                  error={filterErr || fe.errorFor('filter')} errorId={fe.errorId('filter')}>
        <input className="src-input" value={filter}
               aria-invalid={(filterErr || fe.errorFor('filter')) ? 'true' : 'false'}
               aria-describedby={(filterErr || fe.errorFor('filter')) ? fe.errorId('filter') : undefined}
               onChange={e => { setFilter(e.target.value); fe.clearError('filter'); }}
               placeholder="Age > 18 and Region == 'North'"
               style={(filterErr || fe.errorFor('filter')) ? { borderColor: 'var(--rose)' } : undefined} />
      <ModalField label="Filter" hint="pandas query syntax, e.g. Age > 18 and Region == 'North'">
        <input aria-label="View filter" className="src-input" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Age > 18 and Region == 'North'"
               style={filterErr ? { borderColor: 'var(--rose)' } : undefined} />
        {filterErr && <div style={{ color: 'var(--rose)', fontSize: 11.5, marginTop: 4 }}>{filterErr}</div>}
      </ModalField>
      <ModalField label="Aggregate">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={aggregate} onChange={e => setAggregate(e.target.checked)} />
          Roll rows up into group totals
        </label>
      </ModalField>
      {aggregate && (
        <>
          <ModalField label="Group by">
            <ColumnPicker value={groupBy} onChange={setGroupBy} options={sourceCols} multi={false} placeholder="Column to group by…" />
          </ModalField>
          <ModalField label="Aggregate column">
            <ColumnPicker value={question} onChange={setQuestion} options={sourceCols} multi={false} placeholder="Numeric column to aggregate…" />
          </ModalField>
          <ModalField label="Function"><select aria-label="Aggregate function" className="src-input" value={agg} onChange={e => setAgg(e.target.value)}>{['sum', 'mean', 'count', 'max', 'min'].map(a => <option key={a} value={a}>{a}</option>)}</select></ModalField>
        </>
      )}
    </Modal>
  );
}

// Inline validation banner for modals (replaces window.alert()).
function ModalError({ children }) {
  if (!children) return null;
  return (
    <div role="alert" style={{ background: 'var(--rose-soft)', color: 'var(--rose)', borderRadius: 6, padding: '8px 12px', fontSize: 13, fontWeight: 500, marginBottom: 10 }}>
      {children}
    </div>
  );
}

// Searchable column picker. `value` is a comma-separated string (multi) or a
// single column name; `options` are known export labels. Free-text is allowed
// (Enter adds the typed value) so repeat/derived columns still work.
function ColumnPicker({ value, onChange, options = [], multi = true, placeholder, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef(null);

  const selected = multi ? fromCsv(value) : (value ? [value] : []);
  const q = query.trim().toLowerCase();
  const matches = options
    .filter(o => !selected.includes(o) && (!q || o.toLowerCase().includes(q)))
    .slice(0, 50);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const commit = (col) => {
    const c = col.trim();
    if (!c) return;
    if (multi) { if (!selected.includes(c)) onChange([...selected, c].join(', ')); }
    else { onChange(c); setOpen(false); }
    setQuery('');
  };
  const removeChip = (col) => onChange(selected.filter(c => c !== col).join(', '));

  return (
    <div className="colpick" ref={wrapRef}>
      <div className="colpick__control" onClick={() => setOpen(true)}>
        {multi && selected.map(c => (
          <span key={c} className="colpick__chip">
            {c}
            <button type="button" aria-label={`Remove ${c}`} onClick={(e) => { e.stopPropagation(); removeChip(c); }}>×</button>
          </span>
        ))}
        <input
          className="colpick__input"
          aria-label={ariaLabel || placeholder || 'Search columns…'}
          value={multi ? query : (open ? query : (value || ''))}
          placeholder={selected.length ? '' : (placeholder || 'Search columns…')}
          onFocus={() => { setOpen(true); if (!multi) setQuery(value || ''); }}
          onChange={e => { setQuery(e.target.value); if (!multi) onChange(e.target.value); setOpen(true); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(multi ? query : query); }
            else if (e.key === 'Backspace' && multi && !query && selected.length) removeChip(selected[selected.length - 1]);
          }}
        />
      </div>
      {open && matches.length > 0 && (
        <ul className="colpick__menu" role="listbox">
          {matches.map(o => (
            <li key={o} role="option" aria-selected="false" onMouseDown={(e) => { e.preventDefault(); commit(o); }}>{o}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ModalField({ label, hint, children, error, errorId }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, alignItems: 'start', padding: '8px 0', borderBottom: '1px dashed var(--border)' }}>
      <div style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 500, paddingTop: 6 }}>
        {label}
        {hint && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400, marginTop: 4 }}>{hint}</div>}
      </div>
      <div>
        {children}
        {error && <FieldError id={errorId}>{error}</FieldError>}
      </div>
    </div>
  );
}

// Per-field validation message, programmatically linked to its input via a stable
// `id` (the input's aria-describedby target). role="alert" so assistive tech
// announces it the moment it appears.
function FieldError({ id, children }) {
  if (!children) return null;
  return (
    <div id={id} role="alert" style={{ color: 'var(--rose)', fontSize: 11.5, marginTop: 4 }}>
      {children}
    </div>
  );
}

// Sticky table header cell for the view-preview table. Supports click-to-rename
// (Enter commits, Esc cancels, empty value clears the rename) and an × drop button.
function ColumnHeader({ column, renamed, onDrop, onRename }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');
  const displayName = renamed || column.name;
  const startEdit = () => { setDraft(displayName); setEditing(true); };
  const commit    = () => { onRename(draft); setEditing(false); };
  const cancel    = () => { setEditing(false); };
  return (
    <th style={{ position: 'sticky', top: 0, background: 'var(--surface-2, #f7f7f7)', borderBottom: '1px solid var(--border)', padding: '6px 10px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <button
          onClick={onDrop}
          title={`Drop column "${column.name}"`}
          style={{ border: 'none', background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1, fontFamily: 'var(--font-sans, inherit)' }}
        >×</button>
        {editing ? (
          <input
            autoFocus
            aria-label={`Rename column ${column.name}`}
            className="src-input"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
              else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
            }}
            style={{ padding: '2px 6px', fontSize: 12.5, fontFamily: 'var(--font-mono, monospace)', minWidth: 120 }}
          />
        ) : (
          <span
            onClick={startEdit}
            title="Click to rename"
            style={{ cursor: 'text', borderBottom: renamed ? '1px dashed var(--accent, #0891b2)' : '1px dashed transparent' }}
          >
            {displayName}
          </span>
        )}
        <span style={{ color: 'var(--ink-3)', fontWeight: 400, fontSize: 11 }}>{column.detected_type}</span>
        {renamed && !editing && (
          <span style={{ color: 'var(--ink-3)', fontWeight: 400, fontSize: 11, fontStyle: 'italic' }}>
            was: {column.name}
          </span>
        )}
      </span>
    </th>
  );
}

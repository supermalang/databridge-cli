import { useMemo, useState } from 'react';

/**
 * Shared build-options control for the regular Reports build and the Express
 * Apply&build chain (XTF-13).
 *
 * Two options:
 *   - split-by  — render one report per value of a MAIN-table column. The selector
 *     lists only main-table `export_label`s: a question is main-table when it has NO
 *     `repeat_group` (repeat-group columns are excluded). Sourced from config.questions.
 *   - sample preview — "Build all groups (default)" vs "First N groups", mapping the
 *     chosen N to --split-sample N so a split build can be previewed before the full run.
 *
 * Calls `onBuild({ split_by, split_sample })` with only the fields that are set:
 *   - no split-by → split_by omitted (undefined)
 *   - "Build all groups" → split_sample omitted (undefined)
 *
 * `questions` is config.questions (each {export_label, repeat_group, ...}). When the
 * Express surface renders this inline it passes `hideTrigger` + `onChange` and drives the
 * build from its own Apply&build button.
 */
export default function BuildOptions({
  questions = [],
  onBuild,
  onChange,
  hideTrigger = false,
  disabled = false,
  buildLabel = 'Build report',
  buildTitle,
  busy = false,
}) {
  const [splitBy, setSplitBy] = useState('');
  const [sampleMode, setSampleMode] = useState('all');   // 'all' | 'first-n'
  const [sampleN, setSampleN] = useState('2');

  // Main-table columns only: a question is main-table when it has no repeat_group.
  const splitCols = useMemo(
    () =>
      (questions || [])
        .filter((q) => q && !q.repeat_group && q.export_label)
        .map((q) => q.export_label),
    [questions],
  );

  const splitActive = !!splitBy;

  const buildOpts = (sb, mode, n) => {
    const opts = {};
    if (sb) opts.split_by = sb;
    if (sb && mode === 'first-n') {
      const parsed = parseInt(n, 10);
      if (Number.isFinite(parsed) && parsed > 0) opts.split_sample = parsed;
    }
    return opts;
  };

  // Keep an external consumer (e.g. the Express Apply&build button) in sync with the
  // current selections so it can forward them when it triggers the build itself.
  const emit = (sb, mode, n) => onChange?.(buildOpts(sb, mode, n));

  const handleBuild = () => onBuild?.(buildOpts(splitBy, sampleMode, sampleN));

  return (
    <div className="build-options" data-testid="build-options">
      <div className="build-options__header">
        <span className="build-options__title">Build options</span>
        <p className="build-options__hint">
          Split one report per value of a main-table column, and preview a few groups
          before running the full split build.
        </p>
      </div>

      <div className="build-options__row">
        <label className="build-options__field">
          <span className="build-options__label">Split by</span>
          <select
            className="build-options__select"
            data-testid="build-split-by"
            value={splitBy}
            onChange={(e) => { setSplitBy(e.target.value); emit(e.target.value, sampleMode, sampleN); }}
            disabled={disabled}
          >
            <option value="">No split — one combined report</option>
            {splitCols.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>

        <label className="build-options__field">
          <span className="build-options__label">Groups to build</span>
          <select
            className="build-options__select"
            data-testid="build-sample-mode"
            value={sampleMode}
            onChange={(e) => { setSampleMode(e.target.value); emit(splitBy, e.target.value, sampleN); }}
            disabled={disabled || !splitActive}
            title={splitActive ? undefined : 'Choose a split-by column to preview groups'}
          >
            <option value="all">Build all groups (default)</option>
            <option value="first-n">First N groups (preview)</option>
          </select>
        </label>

        {splitActive && sampleMode === 'first-n' && (
          <label className="build-options__field build-options__field--n">
            <span className="build-options__label">N</span>
            <input
              className="build-options__n"
              data-testid="build-sample-n"
              type="number"
              min="1"
              value={sampleN}
              onChange={(e) => { setSampleN(e.target.value); emit(splitBy, sampleMode, e.target.value); }}
              disabled={disabled}
            />
          </label>
        )}
      </div>

      {splitActive && sampleMode === 'first-n' && (
        <p className="build-options__preview-note">
          Preview only — builds the first {sampleN || 'N'} group(s) so you can check the
          layout before committing to the full split build.
        </p>
      )}

      {!hideTrigger && (
        <div className="build-options__actions">
          <button
            type="button"
            className="btn btn-primary"
            data-testid="build-run"
            onClick={handleBuild}
            disabled={disabled || busy}
            title={buildTitle}
          >
            {busy ? 'Building…' : buildLabel}
          </button>
        </div>
      )}
    </div>
  );
}

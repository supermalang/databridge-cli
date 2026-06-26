import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
  buildLabel,
  buildTitle,
  busy = false,
}) {
  const { t } = useTranslation();
  const [splitBy, setSplitBy] = useState('');
  const [sampleMode, setSampleMode] = useState('all');   // 'all' | 'first-n'
  const [sampleN, setSampleN] = useState('2');

  // Searchable combobox (XTF-17): open state, current typed filter, and the
  // keyboard-highlighted option index over the filtered list (incl. "No split").
  const NO_SPLIT = '__none__';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const comboRef = useRef(null);
  const inputRef = useRef(null);

  // Single-select main-table columns only (XTF-24): a question qualifies when it has no
  // repeat_group, an export_label, AND a kobo `type` starting with `select_one` (covers
  // select_one + select_one_from_file; excludes select_multiple*, numbers, text/note,
  // gps/geo*, date*, and undefined types). Splitting on anything else produces garbage.
  const splitCols = useMemo(
    () =>
      (questions || [])
        .filter(
          (q) =>
            q
            && !q.repeat_group
            && q.export_label
            && typeof q.type === 'string'
            && q.type.startsWith('select_one'),
        )
        .map((q) => q.export_label),
    [questions],
  );

  const splitActive = !!splitBy;

  // The option list shown in the open listbox: a "No split" clear option first, then the
  // main-table columns filtered (case-insensitive substring) by the typed query.
  const filteredCols = useMemo(() => {
    const q = query.trim().toLowerCase();
    return splitCols.filter((c) => !q || c.toLowerCase().includes(q));
  }, [splitCols, query]);

  const options = useMemo(
    () => [{ value: NO_SPLIT, label: t('components.buildOptions.noSplit') },
           ...filteredCols.map((c) => ({ value: c, label: c }))],
    [filteredCols, t],
  );

  // Keep the keyboard highlight in range as the filtered list shrinks/grows.
  useEffect(() => {
    setActive((i) => Math.min(Math.max(i, 0), Math.max(options.length - 1, 0)));
  }, [options.length]);

  // Close on outside click / blur away from the combobox.
  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (comboRef.current && !comboRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const openList = () => { setOpen(true); setActive(0); };

  const chooseOption = (value) => {
    const next = value === NO_SPLIT ? '' : value;
    setSplitBy(next);
    setQuery('');
    setOpen(false);
    emit(next, sampleMode, sampleN);
  };

  const onComboKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { openList(); return; }
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { openList(); return; }
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && options[active]) { e.preventDefault(); chooseOption(options[active].value); }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); setOpen(false); }
    }
  };

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
        <span className="build-options__title">{t('components.buildOptions.title')}</span>
        <p className="build-options__hint">
          {t('components.buildOptions.hint')}
        </p>
      </div>

      <div className="build-options__row">
        <div className="build-options__field">
          <span className="build-options__label" id="build-split-by-label">{t('components.buildOptions.splitBy')}</span>
          <div className="build-combo" ref={comboRef}>
            <input
              ref={inputRef}
              className="build-options__select build-combo__input"
              data-testid="build-split-by"
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-haspopup="listbox"
              aria-controls="build-split-by-listbox"
              aria-labelledby="build-split-by-label"
              aria-autocomplete="list"
              autoComplete="off"
              placeholder={t('components.buildOptions.splitPlaceholder')}
              value={open ? query : (splitBy || '')}
              disabled={disabled}
              onFocus={openList}
              onClick={openList}
              onChange={(e) => {
                const v = e.target.value;
                setQuery(v);
                setOpen(true);
                // Highlight the first real column match when filtering, so Enter picks a
                // column rather than the leading "No split" clear option.
                setActive(v.trim() ? 1 : 0);
              }}
              onKeyDown={onComboKeyDown}
            />
            {open && (
              <ul
                className="build-combo__list"
                id="build-split-by-listbox"
                role="listbox"
                aria-labelledby="build-split-by-label"
              >
                {options.map((opt, i) => (
                  <li
                    key={opt.value}
                    className={`build-combo__option${i === active ? ' is-active' : ''}`}
                    data-testid="build-split-option"
                    role="option"
                    aria-selected={opt.value === NO_SPLIT ? !splitBy : opt.value === splitBy}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => { e.preventDefault(); chooseOption(opt.value); }}
                  >
                    {opt.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <label className="build-options__field">
          <span className="build-options__label">{t('components.buildOptions.groupsToBuild')}</span>
          <select
            className="build-options__select"
            data-testid="build-sample-mode"
            value={sampleMode}
            onChange={(e) => { setSampleMode(e.target.value); emit(splitBy, e.target.value, sampleN); }}
            disabled={disabled || !splitActive}
            title={splitActive ? undefined : t('components.buildOptions.groupsHint')}
          >
            <option value="all">{t('components.buildOptions.buildAll')}</option>
            <option value="first-n">{t('components.buildOptions.firstN')}</option>
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
          {t('components.buildOptions.previewNote', { n: sampleN || 'N' })}
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
            {busy ? t('components.buildOptions.building') : (buildLabel || t('components.buildOptions.buildReport'))}
          </button>
        </div>
      )}
    </div>
  );
}

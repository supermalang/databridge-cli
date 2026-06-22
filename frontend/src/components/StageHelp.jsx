import { useId, useState } from 'react';

// Shared contextual-help affordance for every stage page (PUX-4).
//
// Renders three pieces, consistent across all six stages:
//   - a quiet, neutral "? Help" toggle button (NOT teal — teal stays reserved for
//     each page's real primary action, per the One Voice Rule);
//   - a short inline hint that orients the user WITHOUT opening anything;
//   - a disclosure panel (hidden by default) carrying stage-specific plain-language
//     guidance plus a returnable link to the relevant docs/reference page.
//
// The reveal is in-context: opening the panel never navigates away — the stage's
// heading and content stay mounted. Disclosure semantics (aria-expanded /
// aria-controls) make it reachable by assistive tech; the native <button> is
// keyboard-operable for free.
//
// Props:
//   title    — stage name, used in the panel heading + accessible button name.
//   hint     — the short inline orienting hint (string or node).
//   body     — the fuller plain-language guidance shown when opened (string or node).
//   docsHref — relative href to the matching docs/reference/*.md page.
//   docsLabel — optional link text (defaults to a generic "Read the reference").
export default function StageHelp({ title, hint, body, docsHref, docsLabel }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className="stage-help">
      <div className="stage-help__bar">
        {hint && (
          <span className="stage-help__hint" data-testid="stage-hint">
            {hint}
          </span>
        )}
        <button
          type="button"
          className="stage-help__toggle"
          data-testid="stage-help-toggle"
          aria-expanded={open ? 'true' : 'false'}
          aria-controls={panelId}
          aria-label={`Help — ${title}`}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="stage-help__qmark" aria-hidden="true">?</span>
          Help
        </button>
      </div>

      <div
        id={panelId}
        className="stage-help__panel"
        data-testid="stage-help-panel"
        role="region"
        aria-label={`${title} help`}
        hidden={!open}
      >
        <div className="stage-help__panel-title">{title} — how this stage works</div>
        <div className="stage-help__body">{body}</div>
        <a
          className="stage-help__docs"
          href={docsHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          {docsLabel || 'Open the reference guide'}
          <span className="stage-help__docs-ext" aria-hidden="true"> ↗</span>
        </a>
      </div>
    </div>
  );
}

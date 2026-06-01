// Shared page header used by every page: eyebrow + bold display title (with an
// optional accent word) + subtext, plus an optional right-aligned actions slot
// (Save / Refresh / view toggles). Padding/width come from the `.page` shell.
export default function PageHeader({ eyebrow, title, accent, sub, actions }) {
  return (
    <div className="page-header">
      <div className="page-header__text">
        {eyebrow && <div className="page-eyebrow">{eyebrow}</div>}
        <div className="page-greeting">
          {title} {accent && <em>{accent}</em>}
        </div>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </div>
  );
}

// Shared page header — eyebrow + bold display heading + subtext.
// Matches the `.page-greeting` / `.page-eyebrow` / `.page-sub` design language.
export default function PageHeader({ eyebrow, title, accent, sub }) {
  return (
    <div style={{ padding: '22px 28px 0' }}>
      <div className="page-eyebrow">{eyebrow}</div>
      <div className="page-greeting">
        {title} {accent && <em>{accent}</em>}
      </div>
      <div className="page-sub">{sub}</div>
    </div>
  );
}

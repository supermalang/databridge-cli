// Consistent empty / first-run / prerequisite state across pages.
// Usage: <EmptyState title="…" description="…" action={<button…/>} />
export default function EmptyState({ icon, title, description, action, tone = 'default' }) {
  return (
    <div className="empty-state-card" data-tone={tone}>
      {icon && <div className="empty-state-card__icon">{icon}</div>}
      {title && <div className="empty-state-card__title">{title}</div>}
      {description && <div className="empty-state-card__desc">{description}</div>}
      {action && <div className="empty-state-card__action">{action}</div>}
    </div>
  );
}

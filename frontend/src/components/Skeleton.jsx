// Reusable skeleton placeholder primitive (PERF-3).
//
// A skeleton approximates the shape of content that is still loading, so a tab's
// first mount feels responsive instead of showing a single "Loading…" line on a
// blank panel. The container carries `aria-busy="true"` + a visually-hidden text
// label, and every decorative shimmer block is `aria-hidden="true"` — so assistive
// tech announces ONE loading state, not each block.
//
// Shimmer is a CSS animation on `.skeleton`; it becomes a static placeholder under
// `prefers-reduced-motion: reduce` (handled in styles.css). Colours are tokenised.

import { useTranslation } from 'react-i18next';

// A single shimmer block. Decorative → aria-hidden. Width/height accept any CSS
// length; `radius` and `variant` tune the shape (text line vs block vs circle).
export function SkeletonBlock({ width = '100%', height = 14, radius, variant = 'block', style = {} }) {
  const h = typeof height === 'number' ? `${height}px` : height;
  const w = typeof width === 'number' ? `${width}px` : width;
  const r = radius ?? (variant === 'circle' ? '50%' : variant === 'text' ? '4px' : '6px');
  return (
    <span
      className="skeleton"
      aria-hidden="true"
      style={{ width: w, height: variant === 'circle' ? w : h, borderRadius: r, ...style }}
    />
  );
}

// Skeleton container. Renders its children (composed blocks) and exposes the
// single busy/loading state to assistive tech. `label` overrides the default
// localized "Loading" string.
export default function Skeleton({ children, label, className = '', style = {} }) {
  const { t } = useTranslation();
  const text = label ?? t('common.loading');
  return (
    <div
      className={`skeleton-group ${className}`.trim()}
      data-testid="skeleton"
      role="status"
      aria-busy="true"
      aria-live="polite"
      style={style}
    >
      <span className="sr-only">{text}</span>
      {children}
    </div>
  );
}

// ── Composed layouts the pages reuse ─────────────────────────────────────────

// A list of rows, each a tall block — approximates a table / accordion list.
export function SkeletonList({ rows = 4, rowHeight = 56, gap = 10, label }) {
  return (
    <Skeleton label={label} className="skeleton-list" style={{ display: 'flex', flexDirection: 'column', gap }}>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonBlock key={i} height={rowHeight} />
      ))}
    </Skeleton>
  );
}

// A header line + a list — approximates the Questions / Profile group layouts.
export function SkeletonPanel({ rows = 4, rowHeight = 56, label }) {
  return (
    <Skeleton label={label} className="skeleton-panel">
      <SkeletonBlock variant="text" width="32%" height={18} style={{ marginBottom: 14 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-hidden="true">
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonBlock key={i} height={rowHeight} />
        ))}
      </div>
    </Skeleton>
  );
}

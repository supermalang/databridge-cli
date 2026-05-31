// Tiny inline SVG sparkline. `data` is an array of numbers; `tone` selects color.
// Optional `fill` paints the area under the curve.
const TONES = {
  accent: 'var(--accent)',
  green:  'var(--green)',
  warm:   'var(--warm)',
  rose:   'var(--rose)',
  ink:    'var(--ink-3)',
};

export default function Sparkline({
  data, width = 110, height = 28, tone = 'accent', fill = true, strokeWidth = 1.5,
}) {
  if (!data?.length) return <svg width={width} height={height} />;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = Math.max(max - min, 0.0001);
  const dx = data.length > 1 ? width / (data.length - 1) : 0;
  const y = (v) => height - 2 - ((v - min) / span) * (height - 4);
  const points = data.map((v, i) => [i * dx, y(v)]);
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`;
  const color = TONES[tone] || tone;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {fill && (
        <path d={areaD} fill={color} opacity={0.14} />
      )}
      <path d={pathD} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

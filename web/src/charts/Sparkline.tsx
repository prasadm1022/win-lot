interface Props {
  values: number[]
  width?: number
  height?: number
  label?: string
}

/** Tiny line, no axes: trend only. Used inside the lottery cards. */
export function Sparkline({ values, width = 120, height = 32, label = 'Trend' }: Props) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width
    const y = height - 3 - ((v - min) / span) * (height - 6)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const last = pts[pts.length - 1].split(',')
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${label}: ${values.length} points, latest ${values[values.length - 1]}`}
      style={{ overflow: 'visible' }}
    >
      <polyline points={pts.join(' ')} fill="none" stroke="var(--viz-series-1)" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="3" fill="var(--viz-series-1)" stroke="var(--viz-surface)" strokeWidth="1.5" />
    </svg>
  )
}

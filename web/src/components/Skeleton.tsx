import type { CSSProperties } from 'react'

export function Skeleton({ w = '100%', h = 14, style }: { w?: string | number; h?: string | number; style?: CSSProperties }) {
  return <span className="skeleton" style={{ display: 'block', width: w, height: h, ...style }} aria-hidden="true" />
}

export function SkeletonBalls({ n = 5 }: { n?: number }) {
  return (
    <span className="ball-row" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="skeleton skeleton-ball" />
      ))}
    </span>
  )
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card" aria-busy="true" aria-label="Loading">
      <Skeleton w="40%" h={22} style={{ marginBottom: 14 }} />
      <SkeletonBalls />
      <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} w={`${90 - i * 15}%`} />
        ))}
      </div>
    </div>
  )
}

export function SkeletonChart({ h = 220 }: { h?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading chart">
      <Skeleton h={h} />
    </div>
  )
}

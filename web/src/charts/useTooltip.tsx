// SPDX-License-Identifier: Apache-2.0
import { useCallback, useState, type ReactNode } from 'react'

export interface TooltipState {
  x: number
  y: number
  content: ReactNode
}

/** Shared hover tooltip for the SVG charts; positions relative to the .chart wrapper. */
export function useTooltip() {
  const [tip, setTip] = useState<TooltipState | null>(null)
  const show = useCallback((e: { clientX: number; clientY: number; currentTarget: Element }, content: ReactNode) => {
    const wrap = (e.currentTarget as Element).closest('.chart') as HTMLElement | null
    const rect = wrap?.getBoundingClientRect()
    setTip({
      x: e.clientX - (rect?.left ?? 0),
      y: e.clientY - (rect?.top ?? 0),
      content,
    })
  }, [])
  const hide = useCallback(() => setTip(null), [])
  const el = tip ? (
    <div className="chart-tooltip" style={{ left: tip.x, top: tip.y }} role="tooltip">
      {tip.content}
    </div>
  ) : null
  return { show, hide, el }
}

export function niceTicks(max: number, n = 4): number[] {
  if (max <= 0) return [0]
  const raw = max / n
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const steps = [1, 2, 2.5, 5, 10]
  const step = steps.map((s) => s * pow).find((s) => s >= raw) ?? pow * 10
  const out: number[] = []
  for (let v = 0; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100)
  return out
}

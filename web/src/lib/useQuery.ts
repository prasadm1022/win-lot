// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, useState } from 'react'

export interface QueryState<T> {
  data: T | null
  error: string | null
  loading: boolean
  refetch: () => void
}

/**
 * Minimal fetch hook: runs `fn` whenever `deps` change, exposes loading/error/data
 * and a refetch for recoverable error states. Keeps stale data while refetching.
 */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[]): QueryState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const seq = useRef(0)

  useEffect(() => {
    const id = ++seq.current
    setLoading(true)
    setError(null)
    fn().then(
      (d) => {
        if (seq.current !== id) return
        setData(d)
        setLoading(false)
      },
      (e: unknown) => {
        if (seq.current !== id) return
        setError(e instanceof Error ? e.message : 'Something went wrong')
        setLoading(false)
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const refetch = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, refetch }
}

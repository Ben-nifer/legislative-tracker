'use client'

import { useEffect, useRef, useState } from 'react'
import { previewCountLabel } from '@/lib/feed/announce'
import type { FeedResponse } from '@/lib/feed/types'
import type { Selection } from './types'

// The live preview (spec §6, build plan §5): each change re-asks /api/feed,
// debounced 150 ms, latest request wins. The response's diff against what was
// on screen drives "New ·" and the live-region text.

const DEBOUNCE_MS = 150

export function useFeedPreview(selection: Selection) {
  const [feed, setFeed] = useState<FeedResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const previous = useRef<{ widgets: string[]; pairs: string[] } | undefined>(undefined)
  const body = JSON.stringify(selection)

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/feed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context: JSON.parse(body), size: 3, previous: previous.current }),
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(String(res.status))
        const next = (await res.json()) as FeedResponse
        previous.current = {
          widgets: next.widgets.map((w) => w.key),
          pairs: next.widgets.flatMap((w) => w.items.map((i) => `${w.key}|${i.id}`)),
        }
        setFeed(next)
        setFailed(false)
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setFailed(true)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [body])

  const countLabel = feed ? previewCountLabel(feed, { announceAdded: true }) : ''
  return { feed, loading, failed, countLabel }
}

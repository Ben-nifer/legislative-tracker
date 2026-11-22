'use client'

import type { MouseEvent, ReactNode } from 'react'

// Home page click logging (recommendations-planv1.2.md §3.5): an opened card is
// sent as a beacon, so navigation never waits on it. Cards carry
// data-feed-widget / data-feed-item (FeedItemRow).
export default function FeedClickLogger({ className, children }: { className?: string; children: ReactNode }) {
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button > 1) return // left or middle click only
    const card = (e.target as HTMLElement).closest<HTMLElement>('[data-feed-item]')
    const widget = card?.dataset.feedWidget
    const itemId = card?.dataset.feedItem
    if (!widget || !itemId) return
    const body = new Blob([JSON.stringify({ surface: 'home', widget, itemId, action: 'open' })], { type: 'application/json' })
    try {
      if (!navigator.sendBeacon?.('/api/feed/click', body)) {
        void fetch('/api/feed/click', { method: 'POST', body, keepalive: true }).catch(() => {})
      }
    } catch {
      // Logging never blocks opening the item
    }
  }
  return (
    <div className={className} onClick={onClick} onAuxClick={onClick}>
      {children}
    </div>
  )
}

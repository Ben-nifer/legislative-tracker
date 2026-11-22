import type { FeedResponse } from './types'

// The preview's live-region text (onboarding spec §6): "Added 3 items from New York
// City · 2 sections · 6 items", or "Showing what's popular · 6 items".

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function previewCountLabel(feed: Pick<FeedResponse, 'popular' | 'widgets' | 'added'>, opts: { announceAdded: boolean }): string {
  const items = feed.widgets.reduce((n, w) => n + w.items.length, 0)
  if (feed.popular) return `Showing what's popular · ${plural(items, 'item')}`

  let added = ''
  if (opts.announceAdded && feed.added.titles.length) {
    const names = feed.added.titles.join(' and ')
    added = feed.added.items
      ? `Added ${plural(feed.added.items, 'item')} from ${names} · `
      : `Added ${names} (coming soon) · `
  } else if (opts.announceAdded && feed.added.items) {
    added = `Added ${plural(feed.added.items, 'item')} · `
  }
  return `${added}${plural(feed.widgets.length, 'section')} · ${plural(items, 'item')}`
}

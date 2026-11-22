import { describe, expect, it } from 'vitest'
import { contextLabel, itemHref, statusLabel, typeLabel } from './display'
import { previewCountLabel } from './announce'
import { contextFromGuest } from './context'
import { isPopular } from './getFeed'
import type { FeedWidget } from './types'

// Thursday 2026-11-19, noon in New York
const NOW = new Date('2026-11-19T17:00:00Z')

describe('card labels', () => {
  it('names types and stages in plain words', () => {
    expect(typeLabel('bill')).toBe('Bill')
    expect(typeLabel('announcement')).toBe('Agency notice')
    expect(statusLabel('passed_committee', 'bill')).toBe('Headed to a full vote')
    expect(statusLabel('hearing_scheduled', 'hearing')).toBe('Upcoming')
    expect(statusLabel(null, 'bill')).toBe('Update')
  })

  it('labels upcoming hearings by New York day', () => {
    const item = (nextEventAt: string | null, stage: string | null = 'hearing_scheduled') => ({ itemType: 'bill', stage, nextEventAt })
    expect(contextLabel(item('2026-11-19T22:00:00Z'), NOW)).toBe('Hearing today')
    expect(contextLabel(item('2026-11-24T17:00:00Z'), NOW)).toBe('Hearing Tuesday')
    expect(contextLabel(item('2026-12-02T17:00:00Z'), NOW)).toBe('Hearing Dec 2')
  })

  it('falls back to stage milestones, and is empty otherwise', () => {
    expect(contextLabel({ itemType: 'bill', stage: 'passed_committee', nextEventAt: null }, NOW)).toBe('Passed committee')
    expect(contextLabel({ itemType: 'bill', stage: 'in_committee', nextEventAt: null }, NOW)).toBeNull()
  })

  it('links to the item page when the item is legislation', () => {
    expect(itemHref({ legislationSlug: 'int-0212-2026', url: 'https://legistar' })).toBe('/legislation/int-0212-2026')
    expect(itemHref({ legislationSlug: null, url: 'https://example.org/x' })).toBe('https://example.org/x')
  })
})

describe('preview count label', () => {
  const widget = (title: string, items: number): FeedWidget => ({
    key: title,
    kind: 'jurisdiction',
    title,
    items: Array.from({ length: items }, (_, i) => ({
      id: `${title}${i}`,
      typeLabel: 'Bill',
      statusLabel: 'Introduced',
      title: 't',
      label: null,
      personal: false,
      href: '/',
      isNew: false,
    })),
    total: items,
    comingSoon: null,
    nearby: null,
  })

  it('announces the section that was just added', () => {
    const feed = { popular: false, widgets: [widget('New York City', 3), widget('Park Slope', 3)], added: { titles: ['New York City'], items: 3 } }
    expect(previewCountLabel(feed, { announceAdded: true })).toBe('Added 3 items from New York City · 2 sections · 6 items')
  })

  it('says when an added section is coming soon', () => {
    const feed = { popular: false, widgets: [widget('housing · California', 0)], added: { titles: ['housing · California'], items: 0 } }
    expect(previewCountLabel(feed, { announceAdded: true })).toBe('Added housing · California (coming soon) · 1 section · 0 items')
  })

  it('reads as popular with nothing selected', () => {
    const feed = { popular: true, widgets: [widget('New York City', 3)], added: { titles: [], items: 0 } }
    expect(previewCountLabel(feed, { announceAdded: true })).toBe("Showing what's popular · 3 items")
  })
})

describe('feed context', () => {
  it('maps the guest cookie, chips before typed interests', () => {
    const ctx = contextFromGuest({
      v: 1,
      places: [{ type: 'council_district', id: '39' }],
      jurisdictions: [{ type: 'city', id: 'nyc' }],
      legislatorIds: [],
      topicIds: ['00000000-0000-4000-8000-000000000001'],
      interests: [{ phrase: 'bike lanes', display: 'Bike lanes' }],
    })
    expect(ctx.jurisdictions).toEqual([{ type: 'city', id: 'nyc' }])
    expect(ctx.topics).toEqual([
      { kind: 'topic', id: '00000000-0000-4000-8000-000000000001' },
      { kind: 'interest', phrase: 'bike lanes', display: 'Bike lanes' },
    ])
  })

  it('treats resolved places alone as nothing selected', () => {
    const ctx = contextFromGuest({ v: 1, places: [{ type: 'council_district', id: '39' }], jurisdictions: [], legislatorIds: [], topicIds: [], interests: [] })
    expect(isPopular(ctx)).toBe(true)
    expect(isPopular(contextFromGuest(null))).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { EVENT_SCHEMAS, validateEvent } from './events'

describe('analytics allowlist', () => {
  it('accepts every spec §11 event with valid props', () => {
    const samples: Record<keyof typeof EVENT_SCHEMAS, unknown> = {
      onb_view: { step: 0 },
      onb_skip: { step: 2 },
      onb_explore_exit: { step: 3 },
      onb_address_result: { result: 'success' },
      onb_streeteasy_click: {},
      onb_select: { type: 'neighborhood', id: 'neighborhood:BK0602', source: 'search' },
      onb_freetext_match: { cache_hit: true, latency_ms: 210, topics_count: 2 },
      onb_preview_expand: {},
      onb_notif: { result: 'explainer_decline' },
      onb_complete: { path: 'popular' },
      auth_prompt: { trigger: 'stance' },
      auth_success: { method: 'google', new_account: true },
    }
    for (const [name, props] of Object.entries(samples)) {
      expect(validateEvent({ name, props }), name).toEqual({ name, props })
    }
  })

  it('rejects unknown events', () => {
    expect(validateEvent({ name: 'page_view', props: {} })).toBeNull()
    expect(validateEvent({ name: 'toString', props: {} })).toBeNull()
    expect(validateEvent(null)).toBeNull()
  })

  it('rejects unknown properties, so an address cannot ride along', () => {
    expect(validateEvent({ name: 'onb_address_result', props: { result: 'success', address: '200 5th Ave' } })).toBeNull()
    expect(validateEvent({ name: 'onb_view', props: { step: 1, lat: 40.67, lng: -73.98 } })).toBeNull()
    expect(validateEvent({ name: 'onb_streeteasy_click', props: { url: 'https://streeteasy.com/?q=5th+ave' } })).toBeNull()
  })

  it('rejects free text in ID fields', () => {
    expect(validateEvent({ name: 'onb_select', props: { type: 'interest', id: '200 5th Ave Brooklyn', source: 'freetext' } })).toBeNull()
    expect(validateEvent({ name: 'onb_select', props: { type: 'interest', source: 'freetext' } })).not.toBeNull()
  })

  it('rejects out-of-range values', () => {
    expect(validateEvent({ name: 'onb_skip', props: { step: 0 } })).toBeNull()
    expect(validateEvent({ name: 'onb_freetext_match', props: { cache_hit: true, latency_ms: -1, topics_count: 0 } })).toBeNull()
  })
})

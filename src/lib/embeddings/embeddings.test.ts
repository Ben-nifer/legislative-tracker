import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizePhrase, pickTopicSuggestions } from './interests'
import { itemEmbeddingText, topicEmbeddingText } from './embed-content'
import { EMBEDDING_DIMENSIONS, embed, toPgVector } from './voyage'

describe('normalizePhrase', () => {
  it('lowercases, trims and collapses whitespace', () => {
    expect(normalizePhrase('  High   Speed\tRail ')).toBe('high speed rail')
  })

  it('treats punctuation as a word break so variants share a cache key', () => {
    expect(normalizePhrase('high-speed rail!')).toBe('high speed rail')
    expect(normalizePhrase('"Rent" control, please...')).toBe('rent control please')
  })

  it('returns an empty string for punctuation-only input', () => {
    expect(normalizePhrase(' -- ?! ')).toBe('')
  })
})

describe('pickTopicSuggestions', () => {
  const topic = (id: string, similarity: number) => ({ id, name: id, slug: id, similarity })

  it('keeps only topics close to the best match', () => {
    // "bike lanes": Transportation clearly wins; the rest are generic noise
    const picked = pickTopicSuggestions([topic('transportation', 0.57), topic('parks', 0.48), topic('small-business', 0.44)])
    expect(picked.map((t) => t.id)).toEqual(['transportation'])
  })

  it('caps at 3 and skips topics the user already has', () => {
    const topics = [topic('a', 0.5), topic('b', 0.49), topic('c', 0.48), topic('d', 0.47), topic('e', 0.46)]
    expect(pickTopicSuggestions(topics).map((t) => t.id)).toEqual(['a', 'b', 'c'])
    expect(pickTopicSuggestions(topics, new Set(['a'])).map((t) => t.id)).toEqual(['b', 'c', 'd'])
  })

  it('returns nothing for no topics', () => {
    expect(pickTopicSuggestions([])).toEqual([])
  })
})

describe('embedding text', () => {
  it('formats items as "{item_type}: {title}\\n\\n{summary}"', () => {
    expect(itemEmbeddingText({ item_type: 'bill', title: 'Bike lanes', summary: 'Adds lanes.' })).toBe(
      'bill: Bike lanes\n\nAdds lanes.'
    )
    expect(itemEmbeddingText({ item_type: 'resolution', title: 'Honoring X', summary: null })).toBe(
      'resolution: Honoring X'
    )
  })

  it('adds a description to known topics and falls back to the name', () => {
    expect(topicEmbeddingText({ name: 'Transportation', slug: 'transportation' })).toMatch(/^Transportation: .*bike lanes/)
    expect(topicEmbeddingText({ name: 'Brand New', slug: 'brand-new' })).toBe('Brand New')
  })
})

describe('embed', () => {
  const vector = (seed: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, () => seed)
  const ok = (data: { index: number; embedding: number[] }[]) =>
    new Response(JSON.stringify({ data, usage: { total_tokens: 7 } }), { status: 200 })

  beforeEach(() => vi.stubEnv('VOYAGE_API_KEY', 'test-key'))
  afterEach(() => vi.unstubAllEnvs())

  it('returns vectors in input order even if the API reorders them', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok([{ index: 1, embedding: vector(2) }, { index: 0, embedding: vector(1) }]))
    const result = await embed(['a', 'b'], 'document', { fetchImpl })
    expect(result.embeddings.map((e) => e[0])).toEqual([1, 2])
    expect(result.tokens).toBe(7)
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body).toMatchObject({ input: ['a', 'b'], model: 'voyage-3.5', input_type: 'document' })
  })

  it('retries 429 and 5xx with backoff', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValueOnce(new Response('oops', { status: 503 }))
      .mockResolvedValueOnce(ok([{ index: 0, embedding: vector(1) }]))
    const result = await embed(['a'], 'query', { fetchImpl, baseDelayMs: 0 })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(result.embeddings).toHaveLength(1)
  })

  it('does not retry a 400', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('bad input', { status: 400 }))
    await expect(embed(['a'], 'query', { fetchImpl, baseDelayMs: 0 })).rejects.toThrow('Voyage 400: bad input')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rejects vectors of the wrong dimension', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok([{ index: 0, embedding: [0.1, 0.2] }]))
    await expect(embed(['a'], 'query', { fetchImpl })).rejects.toThrow(/1024-d/)
  })
})

describe('toPgVector', () => {
  it('uses pgvector text format', () => {
    expect(toPgVector([0.5, -1, 2e-7])).toBe('[0.5,-1,2e-7]')
  })
})

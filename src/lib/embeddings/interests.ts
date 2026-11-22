import type { SupabaseClient } from '@supabase/supabase-js'
import { EMBEDDING_MODEL, embed, toPgVector } from './voyage'

// Free-text interest matching (recommendations-plan.md §5.3, D13, D18).
// Chip taps never come through here. A typed phrase costs at most one Voyage
// call, and only the first time anyone types it.

export const MAX_PHRASE_LENGTH = 80
const DEFAULT_ITEM_COUNT = 20
const TOPIC_SUGGESTION_COUNT = 3

// A topic is suggested only above the floor AND within the margin of the
// best-matching topic. Generic topics ("Small Business") score ~0.35–0.45
// against almost any phrase, so a floor alone suggests noise. Set from a
// first pass on real phrases (Phase 2); revisit with Q4 in Phase 5.
export const TOPIC_SUGGESTION_FLOOR = 0.4
export const TOPIC_SUGGESTION_MARGIN = 0.06

// Fallback if ranking_config can't be read; matches the v1 seed in 020
const DEFAULT_SIMILARITY_FLOOR = 0.3

export type JurisdictionLevel = 'federal' | 'state' | 'city' | 'neighborhood'

// §3.2: lowercase, trim, collapse whitespace, strip punctuation.
// Punctuation becomes a space so "high-speed rail" and "high speed rail" share a cache row.
export function normalizePhrase(phrase: string): string {
  return phrase
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface InterestMatch {
  id: string
  itemType: string
  title: string
  jurisdictionLevel: string
  stage: string | null
  url: string
  legislationId: string | null
  similarity: number
}

export interface TopicSuggestion {
  id: string
  name: string
  slug: string
  similarity: number
}

export interface ResolvedInterest {
  displayPhrase: string
  normalizedPhrase: string // the cache key; stored in user_interests on sign-up
  cached: boolean // false = this request made the Voyage call
  model: string
  items: InterestMatch[]
  relatedTopics: TopicSuggestion[]
}

async function loadSimilarityFloor(supabase: SupabaseClient): Promise<number> {
  const { data } = await supabase.from('ranking_config').select('params').eq('active', true).maybeSingle()
  const floor = data?.params?.similarity_floor
  return typeof floor === 'number' ? floor : DEFAULT_SIMILARITY_FLOOR
}

export async function resolveInterest(
  supabase: SupabaseClient,
  phrase: string,
  options: { levels?: JurisdictionLevel[]; itemCount?: number; excludeTopicIds?: string[] } = {}
): Promise<ResolvedInterest> {
  const displayPhrase = phrase.trim().replace(/\s+/g, ' ')
  const normalizedPhrase = normalizePhrase(phrase)
  if (!normalizedPhrase) throw new Error('Phrase is empty after normalization')

  // 1. Cache lookup (bumps hit_count on a hit)
  const { data: hit, error: hitError } = await supabase.rpc('interest_phrase_hit', {
    p_phrase: normalizedPhrase,
    p_model: EMBEDDING_MODEL,
  })
  if (hitError) throw new Error(`Phrase cache lookup failed: ${hitError.message}`)

  // 2. Miss: one query-side embedding, stored for everyone
  if (!hit) {
    const { embeddings } = await embed([normalizedPhrase], 'query')
    const { error } = await supabase.rpc('store_interest_phrase', {
      p_phrase: normalizedPhrase,
      p_model: EMBEDDING_MODEL,
      p_embedding: toPgVector(embeddings[0]),
    })
    if (error) throw new Error(`Phrase cache write failed: ${error.message}`)
  }

  // 3–5. Nearest items (pre-filtered) and related-topic suggestions
  const excluded = new Set(options.excludeTopicIds ?? [])
  const floor = await loadSimilarityFloor(supabase)
  const [items, topics] = await Promise.all([
    supabase.rpc('match_phrase_items', {
      p_phrase: normalizedPhrase,
      p_model: EMBEDDING_MODEL,
      p_count: options.itemCount ?? DEFAULT_ITEM_COUNT,
      p_min_similarity: floor,
      p_levels: options.levels?.length ? options.levels : null,
    }),
    supabase.rpc('match_phrase_topics', {
      p_phrase: normalizedPhrase,
      p_model: EMBEDDING_MODEL,
      p_count: TOPIC_SUGGESTION_COUNT + excluded.size,
      p_min_similarity: TOPIC_SUGGESTION_FLOOR,
    }),
  ])
  if (items.error) throw new Error(`Item match failed: ${items.error.message}`)
  if (topics.error) throw new Error(`Topic match failed: ${topics.error.message}`)

  return {
    displayPhrase,
    normalizedPhrase,
    cached: Boolean(hit),
    model: EMBEDDING_MODEL,
    items: (items.data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      itemType: r.item_type as string,
      title: r.title as string,
      jurisdictionLevel: r.jurisdiction_level as string,
      stage: (r.stage as string | null) ?? null,
      url: r.url as string,
      legislationId: (r.legislation_id as string | null) ?? null,
      similarity: r.similarity as number,
    })),
    relatedTopics: pickTopicSuggestions((topics.data ?? []) as TopicSuggestion[], excluded),
  }
}

// Expects topics sorted by similarity, best first
export function pickTopicSuggestions(topics: TopicSuggestion[], excluded: Set<string> = new Set()): TopicSuggestion[] {
  if (topics.length === 0) return []
  const cutoff = topics[0].similarity - TOPIC_SUGGESTION_MARGIN
  return topics
    .filter((t) => t.similarity >= cutoff && !excluded.has(t.id))
    .slice(0, TOPIC_SUGGESTION_COUNT)
}

import type { SupabaseClient } from '@supabase/supabase-js'
import { sha256 } from '../ingest/run'
import { EMBED_BATCH_SIZE, EMBEDDING_MODEL, embed, toPgVector } from './voyage'

// Item and topic embedding jobs (recommendations-plan.md §5.1, §3.2).
// Shared by /api/cron/embed-content and scripts/backfill-embeddings.ts.

export interface EmbedRunResult {
  model: string
  itemsEmbedded: number
  topicsEmbedded: number
  tokens: number
  remaining: boolean // true if the time budget ran out with items still pending
  error?: string
}

interface PendingItem {
  id: string
  item_type: string
  title: string
  summary: string | null
  content_hash: string
}

// §5.1: "{item_type}: {title}\n\n{summary}"
export function itemEmbeddingText(item: Pick<PendingItem, 'item_type' | 'title' | 'summary'>): string {
  return item.summary ? `${item.item_type}: ${item.title}\n\n${item.summary}` : `${item.item_type}: ${item.title}`
}

// One-line descriptions give the ~30 short topic names enough context to
// match typed phrases (§3.2). Topics missing here embed from their name alone.
const TOPIC_DESCRIPTIONS: Record<string, string> = {
  housing: 'Affordable housing, tenants, landlords, homelessness and building conditions',
  'housing-rent': 'Rent regulation, rent stabilization, tenant protections and evictions',
  transportation: 'Subways, buses, streets, bike lanes, traffic safety, parking and for-hire vehicles',
  'public-safety': 'Police, fire, emergency services, criminal justice and jails',
  education: 'Public schools, CUNY, libraries and student services',
  environment: 'Climate, air quality, energy, flooding, resiliency and green buildings',
  health: 'Public health, hospitals, mental health and healthcare access',
  'economic-development': 'Jobs, business growth, waterfront and neighborhood investment',
  'finance-budget': 'City budget, taxes, spending and financial oversight',
  'budget-finance': 'City budget, taxes, spending and financial oversight',
  'land-use': 'Zoning changes, development applications (ULURP) and land use review',
  'land-use-zoning': 'Zoning changes, development applications (ULURP) and land use review',
  immigration: 'Immigrant services, language access and immigrant protections',
  'civil-rights': 'Discrimination, human rights, equity and civil liberties',
  'civil-rights-equity': 'Discrimination, human rights, equity and civil liberties',
  'parks-recreation': 'Parks, playgrounds, open space, trees and recreation centers',
  sanitation: 'Trash, recycling, composting, street cleaning and waste',
  'small-business': 'Small businesses, street vendors, licensing and commercial rent',
  technology: 'Technology, data privacy, broadband, digital services and AI',
  'senior-services': 'Older adults, senior centers, aging and elder care',
  seniors: 'Older adults, senior centers, aging and elder care',
  'youth-services': 'Youth programs, after-school, child care and families',
  'youth-families': 'Youth programs, after-school, child care and families',
  'social-services': 'Public assistance, food security, shelters and social safety net',
  'cultural-affairs': 'Arts, culture, museums, nightlife and community events',
  'government-operations': 'City agencies, elections, ethics, procurement and how government runs',
  'labor-workers-rights': 'Workers, wages, labor standards, unions and workplace protections',
}

export function topicEmbeddingText(topic: { name: string; slug: string }): string {
  const description = TOPIC_DESCRIPTIONS[topic.slug]
  return description ? `${topic.name}: ${description}` : topic.name
}

// Embeds pending items in batches until none are left or the budget runs out.
// On a Voyage or DB error it stops; unembedded rows are picked up next run.
export async function embedPendingContent(
  supabase: SupabaseClient,
  options: { timeBudgetMs?: number; onBatch?: (embedded: number) => void } = {}
): Promise<Omit<EmbedRunResult, 'topicsEmbedded'>> {
  const deadline = Date.now() + (options.timeBudgetMs ?? Infinity)
  const result: Omit<EmbedRunResult, 'topicsEmbedded'> = {
    model: EMBEDDING_MODEL,
    itemsEmbedded: 0,
    tokens: 0,
    remaining: false,
  }

  try {
    while (true) {
      if (Date.now() >= deadline) {
        result.remaining = true
        break
      }

      const { data, error } = await supabase.rpc('content_items_to_embed', {
        p_model: EMBEDDING_MODEL,
        p_limit: EMBED_BATCH_SIZE,
      })
      if (error) throw new Error(`Pending item lookup failed: ${error.message}`)
      const pending = (data ?? []) as PendingItem[]
      if (pending.length === 0) break

      const { embeddings, tokens } = await embed(pending.map(itemEmbeddingText), 'document')
      result.tokens += tokens

      const { error: writeError } = await supabase.from('content_embeddings').upsert(
        pending.map((item, i) => ({
          content_item_id: item.id,
          model: EMBEDDING_MODEL,
          embedding: toPgVector(embeddings[i]),
          content_hash: item.content_hash,
          embedded_at: new Date().toISOString(),
        })),
        { onConflict: 'content_item_id,model' }
      )
      if (writeError) throw new Error(`Embedding upsert failed: ${writeError.message}`)

      result.itemsEmbedded += pending.length
      options.onBatch?.(result.itemsEmbedded)
      if (pending.length < EMBED_BATCH_SIZE) break
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  }

  return result
}

// Topics with no vector for the model, or whose name/description changed
export async function embedPendingTopics(supabase: SupabaseClient): Promise<{ embedded: number; tokens: number }> {
  const [{ data: topics, error }, { data: existing, error: existingError }] = await Promise.all([
    supabase.from('topics').select('id, name, slug'),
    supabase.from('topic_embeddings').select('topic_id, content_hash').eq('model', EMBEDDING_MODEL),
  ])
  if (error) throw new Error(`Topic lookup failed: ${error.message}`)
  if (existingError) throw new Error(`Topic embedding lookup failed: ${existingError.message}`)

  const hashByTopic = new Map((existing ?? []).map((e) => [e.topic_id, e.content_hash]))
  const pending = (topics ?? [])
    .map((t) => ({ ...t, text: topicEmbeddingText(t) }))
    .map((t) => ({ ...t, hash: sha256(t.text) }))
    .filter((t) => hashByTopic.get(t.id) !== t.hash)
  if (pending.length === 0) return { embedded: 0, tokens: 0 }

  const { embeddings, tokens } = await embed(pending.map((t) => t.text), 'document')
  const { error: writeError } = await supabase.from('topic_embeddings').upsert(
    pending.map((t, i) => ({
      topic_id: t.id,
      model: EMBEDDING_MODEL,
      embedding: toPgVector(embeddings[i]),
      content_hash: t.hash,
      embedded_at: new Date().toISOString(),
    })),
    { onConflict: 'topic_id,model' }
  )
  if (writeError) throw new Error(`Topic embedding upsert failed: ${writeError.message}`)

  return { embedded: pending.length, tokens }
}

export async function embedAll(
  supabase: SupabaseClient,
  options: { timeBudgetMs?: number; onBatch?: (embedded: number) => void } = {}
): Promise<EmbedRunResult> {
  let topicsEmbedded = 0
  let topicTokens = 0
  let topicError: string | undefined
  try {
    const topics = await embedPendingTopics(supabase)
    topicsEmbedded = topics.embedded
    topicTokens = topics.tokens
  } catch (error) {
    topicError = error instanceof Error ? error.message : String(error)
  }

  const items = await embedPendingContent(supabase, options)
  const error = [topicError, items.error].filter(Boolean).join('; ') || undefined
  return { ...items, topicsEmbedded, tokens: items.tokens + topicTokens, error }
}

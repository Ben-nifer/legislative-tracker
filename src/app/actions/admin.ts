'use server'

import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server'
import { summarizeLegislation } from '@/lib/ai/summarize'
import { syncSponsorships } from '@/lib/legistar/sync'

// Predefined topics for NYC Council legislation
const PREDEFINED_TOPICS = [
  { name: 'Housing & Rent', slug: 'housing-rent' },
  { name: 'Transportation', slug: 'transportation' },
  { name: 'Public Safety', slug: 'public-safety' },
  { name: 'Environment', slug: 'environment' },
  { name: 'Education', slug: 'education' },
  { name: 'Health', slug: 'health' },
  { name: 'Economic Development', slug: 'economic-development' },
  { name: 'Immigration', slug: 'immigration' },
  { name: 'Land Use & Zoning', slug: 'land-use-zoning' },
  { name: 'Budget & Finance', slug: 'budget-finance' },
  { name: 'Civil Rights & Equity', slug: 'civil-rights-equity' },
  { name: 'Parks & Recreation', slug: 'parks-recreation' },
  { name: 'Technology', slug: 'technology' },
  { name: 'Small Business', slug: 'small-business' },
  { name: 'Youth & Families', slug: 'youth-families' },
  { name: 'Seniors', slug: 'seniors' },
  { name: 'Labor & Workers\' Rights', slug: 'labor-workers-rights' },
]

async function assertAdmin() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) throw new Error('Not authorized')
}

/**
 * Syncs one batch of sponsorships from Legistar (30 bills at a time).
 */
export async function runSyncSponsorships(
  offset = 0
): Promise<{ synced: number; offset: number; total: number; done: boolean; apiFailed: number; unmatched: number; sponsorsFound: number; error?: string }> {
  try {
    await assertAdmin()
  } catch (e) {
    return { synced: 0, offset, total: 0, done: true, apiFailed: 0, unmatched: 0, sponsorsFound: 0, error: String(e) }
  }

  try {
    const result = await syncSponsorships(offset)
    return result
  } catch (e) {
    return { synced: 0, offset, total: 0, done: true, apiFailed: 0, unmatched: 0, sponsorsFound: 0, error: String(e) }
  }
}

/**
 * Seeds the predefined topics into the topics table.
 * Safe to run multiple times — uses upsert on slug.
 */
export async function seedTopics(): Promise<{ seeded: number; error?: string }> {
  try {
    await assertAdmin()
  } catch (e) {
    return { seeded: 0, error: String(e) }
  }

  const supabase = createServiceClient()

  // Get the NYC Council legislature ID
  const { data: legislature } = await supabase
    .from('legislatures')
    .select('id')
    .eq('slug', 'nyc-council')
    .single()

  if (!legislature) return { seeded: 0, error: 'NYC Council legislature not found' }

  const rows = PREDEFINED_TOPICS.map((t) => ({
    legislature_id: legislature.id,
    name: t.name,
    slug: t.slug,
  }))

  // Fetch existing slugs to avoid duplicates
  const { data: existing } = await supabase
    .from('topics')
    .select('slug')

  const existingSlugs = new Set((existing ?? []).map((t) => t.slug))
  const newRows = rows.filter((r) => !existingSlugs.has(r.slug))

  if (newRows.length === 0) return { seeded: 0 }

  const { error } = await supabase
    .from('topics')
    .insert(newRows)

  if (error) return { seeded: 0, error: error.message }

  return { seeded: rows.length }
}

/**
 * Generates AI summaries + assigns topics for a batch of 10 legislation items
 * that don't have a summary yet.
 */
export async function generateSummariesBatch(): Promise<{
  processed: number
  failed: number
  remaining: number
  error?: string
}> {
  try {
    await assertAdmin()
  } catch (e) {
    return { processed: 0, failed: 0, remaining: 0, error: String(e) }
  }

  const supabase = createServiceClient()

  // Fetch available topics
  const { data: topicsData } = await supabase
    .from('topics')
    .select('id, name, slug')
    .order('name')

  const topics = topicsData ?? []
  const topicsBySlug = new Map(topics.map((t) => [t.slug, t.id]))

  // Fetch batch without summary
  const { data: batch, error } = await supabase
    .from('legislation')
    .select('id, title, official_summary')
    .is('ai_summary', null)
    .not('type', 'is', null)
    .order('intro_date', { ascending: false })
    .limit(25)

  if (error) return { processed: 0, failed: 0, remaining: 0, error: error.message }
  if (!batch || batch.length === 0) return { processed: 0, failed: 0, remaining: 0 }

  let processed = 0
  let failed = 0
  let firstError: string | undefined

  const topicsList = topics.map((t) => ({ name: t.name, slug: t.slug }))

  // Process all 25 concurrently
  const results = await Promise.all(
    batch.map((item) =>
      summarizeLegislation(item.title, null, topicsList, item.official_summary)
        .then((res) => ({ item, ...res }))
    )
  )

  for (const { item, summary, topicSlugs, error } of results) {
    if (error && !firstError) firstError = error
    if (summary) {
      await supabase
        .from('legislation')
        .update({ ai_summary: summary })
        .eq('id', item.id)

      if (topicSlugs.length > 0) {
        const topicRows = topicSlugs
          .map((slug) => topicsBySlug.get(slug))
          .filter((topicId): topicId is string => !!topicId)
          .map((topicId) => ({ legislation_id: item.id, topic_id: topicId }))

        if (topicRows.length > 0) {
          await supabase
            .from('legislation_topics')
            .insert(topicRows)
        }
      }

      processed++
    } else {
      await supabase
        .from('legislation')
        .update({ ai_summary: '' })
        .eq('id', item.id)
      failed++
    }
  }

  const { count: remaining } = await supabase
    .from('legislation')
    .select('*', { count: 'exact', head: true })
    .is('ai_summary', null)
    .not('type', 'is', null)

  return { processed, failed, remaining: remaining ?? 0, ...(firstError ? { error: firstError } : {}) }
}

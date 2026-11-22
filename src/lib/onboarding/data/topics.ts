import type { SupabaseClient } from '@supabase/supabase-js'

// S4 chips (spec §S4): 12–16 existing topics, the most active first. With only
// NYC content today, "active in your jurisdictions" and platform-wide activity
// are the same ranking: live items tagged with the topic.

export interface TopicChip {
  id: string
  slug: string
  name: string
}

const CHIP_COUNT = 16
const CACHE_MS = 60 * 60_000
let cached: { at: number; chips: TopicChip[] } | null = null

export async function getTopicChips(supabase: SupabaseClient): Promise<TopicChip[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.chips

  const { data: topics, error } = await supabase.from('topics').select('id, slug, name')
  if (error) throw new Error(`topics read failed: ${error.message}`)

  const counts = await Promise.all(
    (topics ?? []).map(async (t) => {
      const { count } = await supabase
        .from('content_item_topics')
        .select('content_item_id, content_items!inner(is_dead)', { count: 'exact', head: true })
        .eq('topic_id', t.id)
        .eq('content_items.is_dead', false)
      return { topic: t as TopicChip, count: count ?? 0 }
    })
  )

  const chips = counts
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || a.topic.name.localeCompare(b.topic.name))
    .slice(0, CHIP_COUNT)
    .map((c) => ({ id: c.topic.id, slug: c.topic.slug, name: c.topic.name }))
  cached = { at: Date.now(), chips }
  return chips
}

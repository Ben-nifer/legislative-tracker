import type { SupabaseClient } from '@supabase/supabase-js'

// The active ranking_config row (recommendations-planv1.2.md §3.4), in the v2
// shape seeded by migration 023. Weights are tunable without a deploy (§8).

export interface RankingConfig {
  version: number
  weights: {
    importance: { stage: number; cosponsors: number; hearings: number; engagement: number }
    widgets: {
      jurisdiction: { importance: number; recency: number }
      topic: { relevance: number; recency: number; importance: number }
      politician: { importance: number; recency: number; cosponsor_multiplier: number }
    }
  }
  params: {
    similarity_floor: number
    similarity_ceiling: number
    recency_half_days: number
    upcoming_full_days: number
    upcoming_zero_days: number
    sponsor_cap: number
    topic_candidate_count: number
    neighborhood_min_items: number
    hearings_full_at: number
    engagement: {
      window_days: number
      action_weights: { stance: number; comment: number; save: number; view: number }
      new_account_days: number
      new_account_multiplier: number
      guest_view_multiplier: number
      prior_weight: number
    }
    trending: { window_days: number; gravity: number; offset_hours: number }
    politician_weights: { bills_introduced_30d: number; upcoming_events_14d: number; recent_actions_30d: number }
  }
}

let cached: { at: number; config: RankingConfig } | null = null

// maxAgeMs > 0 serves a recently read config (request paths); the precompute always reads fresh
export async function loadRankingConfig(supabase: SupabaseClient, maxAgeMs = 0): Promise<RankingConfig> {
  if (maxAgeMs > 0 && cached && Date.now() - cached.at < maxAgeMs) return cached.config
  const { data, error } = await supabase
    .from('ranking_config')
    .select('version, weights, params')
    .eq('active', true)
    .single()
  if (error || !data) throw new Error(`No active ranking_config: ${error?.message ?? 'missing'}`)
  if (!data.weights?.widgets || !data.params?.engagement) {
    throw new Error(`ranking_config v${data.version} isn't in the v2 shape (migration 023)`)
  }
  cached = { at: Date.now(), config: data as RankingConfig }
  return cached.config
}

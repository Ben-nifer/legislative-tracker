import type { SupabaseClient } from '@supabase/supabase-js'

// Coverage registry (onboarding-build-planv1.1.md §4.5, B3): which levels are
// live. S2 cards, S3 rep cards and banners read it, so a level lights up by
// itself once its adapter has content. Neighborhood counts only NTA-tagged items.

export type CoverageLevel = 'federal' | 'state' | 'city' | 'neighborhood'
export type Coverage = Record<CoverageLevel, boolean>

const CACHE_MS = 5 * 60_000
let cached: { at: number; coverage: Coverage } | null = null

export function coverageFromRows(rows: { level: string; live: boolean }[]): Coverage {
  const coverage: Coverage = { federal: false, state: false, city: false, neighborhood: false }
  for (const r of rows) if (r.level in coverage) coverage[r.level as CoverageLevel] = r.live
  return coverage
}

export async function getCoverage(supabase: SupabaseClient): Promise<Coverage> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.coverage
  const { data, error } = await supabase.rpc('coverage_levels')
  if (error) {
    console.error('coverage_levels failed:', error.message)
    // Keep serving the last answer; with none, only the city level is assumed live
    return cached?.coverage ?? { federal: false, state: false, city: true, neighborhood: false }
  }
  cached = { at: Date.now(), coverage: coverageFromRows(data ?? []) }
  return cached.coverage
}

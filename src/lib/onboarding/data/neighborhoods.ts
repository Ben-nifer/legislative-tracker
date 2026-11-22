import type { SupabaseClient } from '@supabase/supabase-js'

// searchNeighborhoods (onboarding-build-planv1.1.md §4.6): S2 "Add another
// neighborhood" typeahead over NTA names and aliases (search_neighborhoods, 026).

export interface NeighborhoodMatch {
  ntaCode: string
  name: string
  borough: string // MN | BX | BK | QN | SI
  matched: string | null // the alias or area name that matched, when it isn't the name
}

export async function searchNeighborhoods(
  supabase: SupabaseClient,
  query: string,
  limit = 10
): Promise<NeighborhoodMatch[]> {
  if (query.trim().length < 2) return []
  const { data, error } = await supabase.rpc('search_neighborhoods', { p_query: query, p_limit: limit })
  if (error) throw new Error(`search_neighborhoods failed: ${error.message}`)
  return (data ?? []).map((r: { nta_code: string; name: string; borough: string; matched: string | null }) => ({
    ntaCode: r.nta_code,
    name: r.name,
    borough: r.borough,
    matched: r.matched,
  }))
}

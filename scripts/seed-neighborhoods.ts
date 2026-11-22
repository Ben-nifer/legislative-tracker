// Loads NTA 2020 polygons into `neighborhoods` and computes same-borough adjacency
// (onboarding-build-planv1.1.md §4.2). Needs migration 026. Safe to re-run.
//
//   npm run seed:neighborhoods
//
// Source: NYC Open Data "2020 Neighborhood Tabulation Areas" (9nt8-h7nd), the same set
// the `places` gazetteer was seeded from (scripts/generate-places-seed.ts).

import { createClient } from '@supabase/supabase-js'

interface NtaGeometryRow {
  nta2020: string
  the_geom: { type: string; coordinates: unknown }
}

const BATCH_SIZE = 25 // polygons are large; keep each RPC payload small

async function main() {
  const res = await fetch(
    'https://data.cityofnewyork.us/resource/9nt8-h7nd.json?$select=nta2020,the_geom&$limit=1000',
    { signal: AbortSignal.timeout(60_000) }
  )
  if (!res.ok) throw new Error(`Open Data fetch failed: ${res.status}`)
  const ntas = (await res.json()) as NtaGeometryRow[]
  console.error(`Fetched ${ntas.length} NTAs`)

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: places, error: placesError } = await supabase
    .from('places')
    .select('place_id')
    .eq('place_type', 'neighborhood')
  if (placesError) throw new Error(`places read failed: ${placesError.message}`)
  const known = new Set((places ?? []).map((p) => p.place_id as string))

  const rows = ntas
    .filter((n) => {
      if (known.has(n.nta2020)) return true
      console.error(`  skipping ${n.nta2020}: not in places`)
      return false
    })
    .map((n) => ({ nta_code: n.nta2020, borough: n.nta2020.slice(0, 2), geometry: n.the_geom }))

  let loaded = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const { data, error } = await supabase.rpc('upsert_neighborhoods', { p_rows: rows.slice(i, i + BATCH_SIZE) })
    if (error) throw new Error(`upsert_neighborhoods failed: ${error.message}`)
    loaded += data as number
  }
  console.error(`Loaded ${loaded} polygons`)

  const missing = [...known].filter((code) => !rows.some((r) => r.nta_code === code))
  if (missing.length) console.error(`  places without a polygon: ${missing.join(', ')}`)

  const { data: updated, error: adjError } = await supabase.rpc('refresh_neighborhood_adjacency')
  if (adjError) throw new Error(`refresh_neighborhood_adjacency failed: ${adjError.message}`)

  const { data: isolated } = await supabase.from('neighborhoods').select('nta_code').eq('adjacent_ntas', '{}')
  console.error(`Adjacency computed for ${updated} NTAs; ${isolated?.length ?? 0} have no same-borough neighbor`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

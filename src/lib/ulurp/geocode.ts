import { createServiceClient } from '@/lib/supabase/server'
import { extractAddress } from '@/lib/ai/extract-address'

type GeoSearchFeature = {
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: { borough?: string; confidence?: number }
}

async function geocodeAddress(address: string): Promise<GeoSearchFeature | null> {
  const res = await fetch(
    `https://geosearch.planninglabs.nyc/v2/search?text=${encodeURIComponent(address)}&size=1`,
    { signal: AbortSignal.timeout(8000) }
  )
  if (!res.ok) return null
  const data = await res.json()
  return data?.features?.[0] ?? null
}

/**
 * Upgrades up to 25 ULURP proposals still at their district-centroid
 * fallback location to a real geocoded point, by asking Claude to extract
 * a street address/intersection from the title+description (most ZAP
 * project titles contain one, e.g. "241-251 W 28 Street Parking Special
 * Permit Renewal") and geocoding it via NYC Planning Labs GeoSearch —
 * resolves Open Question 1 from the V2 neighborhood-map plan without a
 * BBL/PLUTO join.
 */
export async function geocodeUlurpProposalsBatch(): Promise<{
  processed: number
  geocoded: number
  noAddressFound: number
  geocodeFailed: number
  remaining: number
  error?: string
}> {
  const supabase = createServiceClient()

  const { data: batch, error } = await supabase
    .from('local_proposals')
    .select('id, title, description, borough')
    .eq('proposal_family', 'ulurp')
    .eq('geometry_precise', false)
    .order('last_action_date', { ascending: false })
    .limit(25)

  if (error) return { processed: 0, geocoded: 0, noAddressFound: 0, geocodeFailed: 0, remaining: 0, error: error.message }
  if (!batch || batch.length === 0) return { processed: 0, geocoded: 0, noAddressFound: 0, geocodeFailed: 0, remaining: 0 }

  let geocoded = 0
  let noAddressFound = 0
  let geocodeFailed = 0
  let firstError: string | undefined

  const CONCURRENCY = 3
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const chunk = batch.slice(i, i + CONCURRENCY)
    await Promise.all(
      chunk.map(async (item) => {
        const { address, error: extractError } = await extractAddress(item.title, item.description, item.borough)
        if (extractError && !firstError) firstError = extractError
        if (!address) {
          noAddressFound++
          return
        }

        let feature: GeoSearchFeature | null
        try {
          feature = await geocodeAddress(address)
        } catch {
          feature = null
        }

        const confidence = feature?.properties.confidence ?? 0
        const featureBorough = feature?.properties.borough?.toLowerCase()
        const proposalBorough = item.borough?.toLowerCase()
        const boroughMatches = !proposalBorough || !featureBorough || featureBorough === proposalBorough

        if (!feature || confidence < 0.5 || !boroughMatches) {
          geocodeFailed++
          return
        }

        const [lng, lat] = feature.geometry.coordinates
        await supabase
          .from('local_proposals')
          .update({
            geometry: { type: 'Point', coordinates: [lng, lat] },
            bbox: [lng, lat, lng, lat],
            geometry_precise: true,
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id)

        geocoded++
      })
    )
  }

  const { count: remaining } = await supabase
    .from('local_proposals')
    .select('*', { count: 'exact', head: true })
    .eq('proposal_family', 'ulurp')
    .eq('geometry_precise', false)

  return {
    processed: batch.length,
    geocoded,
    noAddressFound,
    geocodeFailed,
    remaining: remaining ?? 0,
    ...(firstError ? { error: firstError } : {}),
  }
}
